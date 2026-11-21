-- ============================================================================
-- Exportación diaria del estado: disparo del workflow desde la base.
-- NO se aplica sola. Requiere la migración 20261121_exportaciones_estado.sql y
-- que la versión de estado-diario.yml que declara el parámetro «origen» esté ya
-- en la rama main del repositorio del workflow (si no, GitHub responde 422).
--
-- Por qué: el programador de GitHub arranca los cron de ese repo con horas de
-- retraso. pg_cron sí es puntual: a las 03:10 de Ecuador (y a las 04:20 si aún
-- no hay corrida buena del día) la base pide a GitHub que lance el workflow
-- estado-diario.yml (evento workflow_dispatch). Los cron del propio workflow
-- quedan como reserva.
--
-- Credencial: un token de GitHub de permisos finos, limitado al repositorio del
-- workflow y con el permiso «Actions: lectura y escritura». Se guarda en Vault
-- con el nombre «github_estado_diario» y, en la descripción, su fecha de
-- caducidad: «caduca=AAAA-MM-DD» (o «caduca=nunca» si se creó sin caducidad).
-- Este archivo NO contiene el token ni el nombre del repositorio: el repositorio
-- va en un segundo secreto, «github_estado_diario_repo», con la forma
-- «propietario/repositorio». Los dos los crea Nicolás en el panel (Vault) o con:
--   select vault.create_secret('<token>', 'github_estado_diario', 'caduca=AAAA-MM-DD');
--   select vault.create_secret('<propietario/repositorio>', 'github_estado_diario_repo', 'repositorio del workflow estado-diario');
-- Al renovar el token: select vault.update_secret((select id from vault.secrets where name = 'github_estado_diario'), '<token nuevo>', 'github_estado_diario', 'caduca=AAAA-MM-DD');
--
-- Qué hace:
--   1) Tabla exportacion_estado_disparos: una fila por intento de disparo, con el
--      identificador de la petición de pg_net para leer después su respuesta.
--   2) exportacion_estado_disparar(p_forzar): si ya hay corrida buena de hoy no
--      hace nada (salvo p_forzar); si falta algún secreto o no se puede leer
--      Vault, avisa por la campana; si no, encola la petición a la API de GitHub.
--   3) exportacion_estado_comprobar_disparo(): tres minutos después lee la
--      respuesta de GitHub; si no fue 204 ni 200, avisa por la campana con el
--      motivo (401 = token rechazado o caducado). No copia el cuerpo de la
--      respuesta a ninguna tabla.
--   4) exportacion_estado_vigilar(): además de lo que ya hacía, avisa cuando al
--      token le quedan 14 días o menos, ya caducó o no tiene fecha anotada; y si
--      no hubo corrida, añade al aviso el motivo del disparo fallido.
--   5) exportacion_estado_registrar(): una corrida buena retira solo los avisos
--      de corrida (falló, no se generó, salió incompleta); los de credencial,
--      disparo y caducidad se conservan, aunque la corrida llegue tarde.
--   6) Cuatro tareas de pg_cron (UTC): disparo 08:10 y 09:20; comprobación 08:13
--      y 09:23.
-- Las funciones nuevas no son ejecutables por anon, authenticated ni
-- service_role: solo las llama pg_cron (rol dueño). El vigilante y el registro
-- conservan service_role, como en la migración anterior.
-- ============================================================================

begin;

-- ── 0) Requisitos (si faltan, no se aplica nada) ────────────────────────────
do $req$
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     or to_regclass('net._http_response') is null
     or to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('public.exportacion_estado_registrar(boolean,text,text)') is null then
    raise exception 'Faltan pg_net, Vault o la migración 20261121: no se puede aplicar el disparo.';
  end if;
end $req$;

-- ── 1) Registro de disparos ─────────────────────────────────────────────────
create table if not exists public.exportacion_estado_disparos (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null,                 -- día de Ecuador
  peticion_id bigint,                        -- id de la petición en pg_net (null si no se llegó a enviar)
  resultado   text not null default 'enviado',   -- enviado | aceptado | rechazado | sin_secreto | sin_respuesta
  detalle     text,
  creado_en   timestamptz not null default now()
);
create index if not exists exportacion_estado_disparos_fecha_idx on public.exportacion_estado_disparos (fecha desc, creado_en desc);

revoke all on public.exportacion_estado_disparos from public, anon, authenticated;
grant select on public.exportacion_estado_disparos to authenticated;
grant all on public.exportacion_estado_disparos to service_role;
alter table public.exportacion_estado_disparos enable row level security;
drop policy if exists exportacion_estado_disparos_select on public.exportacion_estado_disparos;
create policy exportacion_estado_disparos_select on public.exportacion_estado_disparos
  for select to authenticated
  using ((select sst_es_admin_global()));

-- Aviso a cada admin global (uno por título y día: no se repite; si cambia el texto, se actualiza).
-- La campana muestra solo el aviso más reciente del día: por eso el de caducidad se guarda con la
-- hora 00:00 de hoy (prioridad más baja) y los de corrida o disparo, con la hora real.
create or replace function public.exportacion_estado_avisar(p_titulo text, p_mensaje text)
  returns integer
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
  v_n   integer := 0;
begin
  -- Si hoy ya existe el aviso con ese título, se queda uno solo, con el texto más reciente.
  update notificaciones n set mensaje = left(p_mensaje, 700), leida = false
   where n.tipo = 'exportacion_estado' and n.titulo = p_titulo
     and (n.created_at at time zone 'America/Guayaquil')::date = v_hoy
     and n.mensaje is distinct from left(p_mensaje, 700);
  insert into notificaciones (perfil_id, tipo, titulo, mensaje)
  select p.id, 'exportacion_estado', p_titulo, left(p_mensaje, 700)
    from perfiles p
   where p.rol = 'admin'
     and not exists (
       select 1 from notificaciones n
        where n.perfil_id = p.id and n.tipo = 'exportacion_estado' and n.titulo = p_titulo
          and (n.created_at at time zone 'America/Guayaquil')::date = v_hoy);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.exportacion_estado_avisar(text, text) from public, anon, authenticated, service_role;

-- ── 2) Disparo ──────────────────────────────────────────────────────────────
create or replace function public.exportacion_estado_disparar(p_forzar boolean default false)
  returns text
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_hoy   date := (now() at time zone 'America/Guayaquil')::date;
  v_token text;
  v_repo  text;
  v_id    bigint;
  v_falta text;
begin
  if not coalesce(p_forzar, false)
     and exists (select 1 from exportaciones_estado e where e.fecha = v_hoy and e.ok) then
    return 'ya hay corrida buena de hoy';
  end if;

  -- Lectura de Vault: un fallo aquí no puede tumbar la función ni copiar el error a una tabla.
  begin
    select btrim(s.decrypted_secret, E' \t\r\n') into v_token from vault.decrypted_secrets s where s.name = 'github_estado_diario';
    select btrim(s.decrypted_secret, E' \t\r\n') into v_repo  from vault.decrypted_secrets s where s.name = 'github_estado_diario_repo';
  exception when others then
    v_falta := 'No se pudo leer Vault.';
  end;
  if v_falta is null and (coalesce(v_token, '') = '' or v_token ~ '\s') then
    v_falta := 'Falta en Vault el token de GitHub (github_estado_diario) o tiene espacios o saltos de línea dentro.';
  elsif v_falta is null and (coalesce(v_repo, '') = '' or v_repo !~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$') then
    v_falta := 'Falta en Vault el repositorio (github_estado_diario_repo) o no tiene la forma propietario/repositorio.';
  end if;
  if v_falta is not null then
    insert into exportacion_estado_disparos (fecha, resultado, detalle) values (v_hoy, 'sin_secreto', v_falta);
    perform exportacion_estado_avisar('No se pudo lanzar la exportación diaria: falta la credencial',
      v_falta || ' La exportación queda a cargo del horario de reserva de GitHub, que llega con horas de retraso.');
    return 'sin secreto';
  end if;

  -- pg_net añade su propio User-Agent (GitHub lo exige); no se envía otro para no duplicarlo.
  begin
  select net.http_post(
    url     := 'https://api.github.com/repos/' || v_repo || '/actions/workflows/estado-diario.yml/dispatches',
    body    := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('origen', 'pg_cron')),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'Content-Type', 'application/json'),
    timeout_milliseconds := 15000
  ) into v_id;
  exception when others then
    insert into exportacion_estado_disparos (fecha, resultado, detalle) values (v_hoy, 'rechazado', 'La base no pudo encolar la petición a GitHub (pg_net).');
    perform exportacion_estado_avisar('GitHub no aceptó lanzar la exportación diaria',
      'La base no pudo encolar la petición a GitHub (pg_net). La exportación queda a cargo del horario de reserva de GitHub, que llega con horas de retraso; se puede lanzar a mano desde Actions.');
    return 'no se pudo encolar';
  end;

  insert into exportacion_estado_disparos (fecha, peticion_id, resultado) values (v_hoy, v_id, 'enviado');
  return 'enviado (petición ' || v_id || ')';
end $$;
revoke all on function public.exportacion_estado_disparar(boolean) from public, anon, authenticated, service_role;

-- ── 3) Comprobación de la respuesta de GitHub ───────────────────────────────
-- Mira los disparos de hoy y de ayer que siguen en «enviado». 204 (o 200, que es
-- lo que devuelve la versión nueva de la API) = aceptado. Cualquier otra
-- respuesta de un disparo de HOY avisa por la campana.
create or replace function public.exportacion_estado_comprobar_disparo()
  returns text
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_hoy  date := (now() at time zone 'America/Guayaquil')::date;
  d      record;
  r      record;
  v_txt  text;
  v_res  text := '';
begin
  for d in select id, fecha, peticion_id, creado_en from exportacion_estado_disparos
            where fecha >= v_hoy - 1 and resultado = 'enviado' and peticion_id is not null
            order by creado_en loop
    select status_code, timed_out, error_msg into r from net._http_response where id = d.peticion_id;
    if not found then
      if d.creado_en < now() - interval '2 minutes' then
        update exportacion_estado_disparos set resultado = 'sin_respuesta', detalle = 'pg_net no guardó respuesta de GitHub.' where id = d.id;
        -- Si la petición sigue en la cola (trabajador de pg_net parado), se retira: lleva el token.
        begin
          delete from net.http_request_queue q where q.id = d.peticion_id;
        exception when others then null;
        end;
        if d.fecha = v_hoy then
          perform exportacion_estado_avisar('No se sabe si la exportación diaria se lanzó',
            'La base pidió a GitHub lanzar la exportación y no quedó respuesta. Si a las 05:20 no hay archivo de hoy, lánzala a mano.');
        end if;
        v_res := v_res || ' sin_respuesta';
      end if;
      continue;
    end if;
    if r.status_code in (200, 204) then
      update exportacion_estado_disparos set resultado = 'aceptado', detalle = 'GitHub aceptó el disparo (' || r.status_code || ').' where id = d.id;
      if d.fecha = v_hoy then
        -- Un disparo aceptado deja sin efecto los avisos de disparo anteriores de hoy (p. ej. un primer intento sin respuesta).
        delete from notificaciones n
         where n.tipo = 'exportacion_estado'
           and n.titulo in ('GitHub no aceptó lanzar la exportación diaria', 'No se sabe si la exportación diaria se lanzó', 'No se pudo lanzar la exportación diaria: falta la credencial')
           and (n.created_at at time zone 'America/Guayaquil')::date = v_hoy;
      end if;
      v_res := v_res || ' aceptado';
    else
      v_txt := case
        when coalesce(r.timed_out, false) or r.status_code is null then 'GitHub no respondió a tiempo' || coalesce(' (' || left(r.error_msg, 120) || ')', '') || '.'
        when r.status_code = 401 then 'GitHub rechazó el token (401): está caducado, revocado o mal guardado en Vault.'
        when r.status_code in (403, 404) then 'GitHub respondió ' || r.status_code || ': el token no tiene el permiso «Actions: lectura y escritura» sobre el repositorio, o el repositorio o el workflow no existen con ese nombre.'
        when r.status_code = 422 then 'GitHub respondió 422: el workflow no acepta ese disparo. ¿Está en la rama main la versión de estado-diario.yml que declara el parámetro «origen»?'
        else 'GitHub respondió ' || r.status_code || '.' end;
      update exportacion_estado_disparos set resultado = 'rechazado', detalle = v_txt where id = d.id;
      if d.fecha = v_hoy then
        perform exportacion_estado_avisar('GitHub no aceptó lanzar la exportación diaria',
          v_txt || ' La exportación queda a cargo del horario de reserva de GitHub, que llega con horas de retraso; se puede lanzar a mano desde Actions.');
      end if;
      v_res := v_res || ' rechazado(' || coalesce(r.status_code::text, 'sin código') || ')';
    end if;
  end loop;
  -- Limpieza: 90 días de registro.
  delete from exportacion_estado_disparos e where e.fecha < v_hoy - 90;
  return coalesce(nullif(btrim(v_res), ''), 'nada que comprobar');
end $$;
revoke all on function public.exportacion_estado_comprobar_disparo() from public, anon, authenticated, service_role;

-- ── 4) Vigilante: además avisa de la caducidad del token ────────────────────
-- Devuelve cuántos avisos dejó. Igual que antes, no añade «no se generó» si hoy
-- ya hay un aviso de corrida («falló» o «no se generó»).
create or replace function public.exportacion_estado_vigilar()
  returns integer
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_hoy     date := (now() at time zone 'America/Guayaquil')::date;
  v_n       integer := 0;
  v_m       integer := 0;
  v_desc    text;
  v_cad     text;
  v_caduca  date;
  v_titulo  text;
  v_token   text;
  v_disparo text;
begin
  -- Caducidad del token de GitHub. Un fallo al leer Vault no puede callar la alarma de la corrida.
  begin
    select s.description into v_desc from vault.decrypted_secrets s where s.name = 'github_estado_diario';
    if found then
      v_cad := substring(lower(coalesce(v_desc, '')) from 'caduca\s*=\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|nunca)');
      if v_cad = 'nunca' then
        null;                                  -- token sin caducidad: nada que avisar
      else
        begin
          v_caduca := v_cad::date;
        exception when others then v_caduca := null;
        end;
        if v_caduca is null then
          v_titulo := 'El token de la exportación diaria no tiene fecha de caducidad anotada';
          v_token := 'El token de GitHub que lanza la exportación diaria no tiene anotada en Vault una fecha de caducidad válida (descripción «caduca=AAAA-MM-DD» o «caduca=nunca»): no se podrá avisar antes de que caduque.';
        elsif v_caduca < v_hoy then
          v_titulo := 'El token de la exportación diaria CADUCÓ';
          v_token := 'El token de GitHub que lanza la exportación diaria caducó el ' || to_char(v_caduca, 'YYYY-MM-DD') || '. Hay que crear uno nuevo y guardarlo en Vault (github_estado_diario).';
        elsif v_caduca - v_hoy <= 14 then
          v_titulo := 'El token de la exportación diaria está por caducar';
          v_token := 'El token de GitHub que lanza la exportación diaria caduca '
            || case v_caduca - v_hoy when 0 then 'hoy' when 1 then 'mañana (falta 1 día)' else 'el ' || to_char(v_caduca, 'YYYY-MM-DD') || ' (faltan ' || (v_caduca - v_hoy) || ' días)' end
            || '. Hay que crear uno nuevo y guardarlo en Vault (github_estado_diario).';
        end if;
      end if;
    end if;
  exception when others then
    v_titulo := 'No se pudo comprobar la caducidad del token de la exportación diaria';
    v_token := 'No se pudo leer en Vault la caducidad del token de GitHub que lanza la exportación diaria.';
  end;

  if exists (select 1 from exportaciones_estado e where e.fecha = v_hoy and e.ok) then
    if v_token is not null then
      v_n := exportacion_estado_avisar(v_titulo, v_token);
      update notificaciones n set created_at = (v_hoy::timestamp at time zone 'America/Guayaquil')
       where n.tipo = 'exportacion_estado' and n.titulo = v_titulo and (n.created_at at time zone 'America/Guayaquil')::date = v_hoy;
      return v_n;
    end if;
    return 0;
  end if;

  -- La caducidad va SIEMPRE en su propio aviso (una corrida buena tardía no lo retira), con la hora
  -- 00:00 de hoy para que nunca tape en la campana un aviso de corrida o de disparo; y además va
  -- dentro del texto de «no se generó».
  if v_token is not null then
    v_n := exportacion_estado_avisar(v_titulo, v_token);
    update notificaciones n set created_at = (v_hoy::timestamp at time zone 'America/Guayaquil')
     where n.tipo = 'exportacion_estado' and n.titulo = v_titulo and (n.created_at at time zone 'America/Guayaquil')::date = v_hoy;
  end if;

  -- Sin corrida buena: el aviso dice además por qué no se lanzó, si el disparo de hoy falló.
  -- Solo si el ÚLTIMO disparo de hoy falló (uno posterior aceptado lo deja sin efecto).
  select case when d.resultado in ('rechazado', 'sin_secreto', 'sin_respuesta') then d.detalle end into v_disparo
    from exportacion_estado_disparos d
   where d.fecha = v_hoy
   order by d.creado_en desc, d.peticion_id desc nulls last limit 1;

  insert into notificaciones (perfil_id, tipo, titulo, mensaje)
  select p.id, 'exportacion_estado',
         'La exportación diaria del estado no se generó',
         left('No hay ninguna corrida buena registrada para hoy (' || to_char(v_hoy, 'YYYY-MM-DD')
           || '). Los archivos de Drive son de un día anterior: mira la fecha «válido para» y lanza la corrida a mano.'
           || coalesce(' Disparo de hoy: ' || v_disparo, '')
           || coalesce(' ' || v_token, ''), 900)
    from perfiles p
   where p.rol = 'admin'
     and not exists (
       select 1 from notificaciones n
        where n.perfil_id = p.id
          and n.tipo = 'exportacion_estado'
          and n.titulo in ('La exportación diaria del estado no se generó', 'La exportación diaria del estado falló')
          and (n.created_at at time zone 'America/Guayaquil')::date = v_hoy);
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $$;
revoke all on function public.exportacion_estado_vigilar() from public, anon, authenticated;
grant execute on function public.exportacion_estado_vigilar() to service_role;

-- ── 5) Registro de una corrida: la buena retira SOLO los avisos de corrida ──
-- Igual que en la migración 20261121, salvo el borrado: los avisos de credencial,
-- de disparo y de caducidad se conservan aunque después llegue una corrida buena
-- (por ejemplo la de reserva, tarde precisamente porque el disparo falló).
create or replace function public.exportacion_estado_registrar(p_ok boolean, p_detalle text, p_aviso text default null)
  returns void
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_hoy     date := (now() at time zone 'America/Guayaquil')::date;
  v_detalle text := nullif(left(btrim(coalesce(p_detalle, '')), 500), '');
  v_aviso   text := nullif(left(btrim(coalesce(p_aviso, '')), 500), '');
begin
  if p_ok is null then
    raise exception 'Falta indicar si la corrida salió bien (p_ok).' using errcode = '22004';
  end if;
  if not p_ok then
    v_aviso := null;                 -- el aviso solo tiene sentido en una corrida que sí dejó archivos
  end if;

  insert into exportaciones_estado (fecha, ok, detalle, aviso) values (v_hoy, p_ok, v_detalle, v_aviso);

  if p_ok and v_aviso is not null then
    -- Corrida degradada: cuenta como buena (el vigilante no alarma), pero avisa. No borra nada de hoy.
    insert into notificaciones (perfil_id, tipo, titulo, mensaje)
    select p.id, 'exportacion_estado',
           'La exportación diaria del estado salió incompleta',
           v_aviso || ' Los archivos de hoy sí están en Drive, pero les faltan partes que no se pudieron calcular.'
      from perfiles p
     where p.rol = 'admin';
  elsif p_ok then
    -- Una corrida buena deja sin efecto los avisos DE CORRIDA de hoy (intento fallido, vigilante o corrida degradada).
    delete from notificaciones n
     where n.tipo = 'exportacion_estado'
       and n.titulo in ('La exportación diaria del estado falló', 'La exportación diaria del estado no se generó', 'La exportación diaria del estado salió incompleta')
       and (n.created_at at time zone 'America/Guayaquil')::date = v_hoy;
  else
    insert into notificaciones (perfil_id, tipo, titulo, mensaje)
    select p.id, 'exportacion_estado',
           'La exportación diaria del estado falló',
           coalesce(v_detalle, 'La corrida no dio detalle.')
             || ' Los archivos de Drive pueden ser de un día anterior: mira la fecha «válido para».'
      from perfiles p
     where p.rol = 'admin';
  end if;

  -- Limpieza: el registro y los avisos de este tipo no se guardan más de 90 días.
  delete from exportaciones_estado e where e.fecha < v_hoy - 90;
  delete from notificaciones n
   where n.tipo = 'exportacion_estado'
     and (n.created_at at time zone 'America/Guayaquil')::date < v_hoy - 90;
end $$;
revoke all on function public.exportacion_estado_registrar(boolean, text, text) from public, anon, authenticated;
grant execute on function public.exportacion_estado_registrar(boolean, text, text) to service_role;

-- ── 6) Tareas de pg_cron (idempotentes) ─────────────────────────────────────
do $do$
declare
  t record;
begin
  for t in select * from (values
      ('exportacion-estado-disparo-1',   '10 8 * * *', 'select public.exportacion_estado_disparar();'),            -- 03:10 de Ecuador
      ('exportacion-estado-comprobar-1', '13 8 * * *', 'select public.exportacion_estado_comprobar_disparo();'),   -- 03:13
      ('exportacion-estado-disparo-2',   '20 9 * * *', 'select public.exportacion_estado_disparar();'),            -- 04:20, solo si no hay corrida buena
      ('exportacion-estado-comprobar-2', '23 9 * * *', 'select public.exportacion_estado_comprobar_disparo();')    -- 04:23
    ) as x(nombre, horario, comando) loop
    if exists (select 1 from cron.job where jobname = t.nombre) then
      perform cron.unschedule(t.nombre);
    end if;
    perform cron.schedule(t.nombre, t.horario, t.comando);
  end loop;
end $do$;

-- ── 7) Prueba de permisos (si falla, no se aplica nada) ─────────────────────
do $prueba$
declare
  v_rol text; v_fn text;
begin
  foreach v_rol in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_fn in array array['public.exportacion_estado_disparar(boolean)', 'public.exportacion_estado_comprobar_disparo()', 'public.exportacion_estado_avisar(text, text)'] loop
      if has_function_privilege(v_rol, v_fn, 'execute') then
        raise exception 'Permisos mal puestos: el rol % puede ejecutar %.', v_rol, v_fn using errcode = '42501';
      end if;
    end loop;
  end loop;
  foreach v_rol in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_rol, 'public.exportacion_estado_vigilar()', 'execute')
       or has_function_privilege(v_rol, 'public.exportacion_estado_registrar(boolean, text, text)', 'execute') then
      raise exception 'Permisos mal puestos: el rol % puede ejecutar el vigilante o el registro.', v_rol using errcode = '42501';
    end if;
  end loop;
  if has_table_privilege('anon', 'public.exportacion_estado_disparos', 'select')
     or has_table_privilege('authenticated', 'public.exportacion_estado_disparos', 'insert')
     or has_table_privilege('authenticated', 'public.exportacion_estado_disparos', 'update')
     or has_table_privilege('authenticated', 'public.exportacion_estado_disparos', 'delete') then
    raise exception 'Permisos mal puestos en la tabla exportacion_estado_disparos.' using errcode = '42501';
  end if;
end $prueba$;

commit;

-- ── Verificación (solo lectura) ─────────────────────────────────────────────
--   select jobname, schedule, command, active from cron.job where jobname like 'exportacion-estado-%' order by jobname;
--   select name, description, updated_at from vault.decrypted_secrets where name like 'github_estado_diario%';   -- sin la columna del secreto
--   select fecha, resultado, detalle, creado_en from public.exportacion_estado_disparos order by creado_en desc limit 10;
-- Probar el disparo a mano (lanza de verdad el workflow; como rol dueño, en el SQL Editor,
-- cada sentencia por separado para que la primera quede confirmada antes de la segunda):
--   select public.exportacion_estado_disparar(true);
--   -- esperar unos segundos
--   select public.exportacion_estado_comprobar_disparo();          -- «aceptado»

-- ── Reversión ───────────────────────────────────────────────────────────────
-- 1) Aplicar de nuevo, entero, 20261121_exportaciones_estado.sql: es idempotente y
--    devuelve el vigilante y el registro a su versión anterior.
-- 2) Después:
-- begin;
--   select cron.unschedule(jobname) from cron.job where jobname in
--     ('exportacion-estado-disparo-1', 'exportacion-estado-comprobar-1', 'exportacion-estado-disparo-2', 'exportacion-estado-comprobar-2');
--   drop function if exists public.exportacion_estado_comprobar_disparo();
--   drop function if exists public.exportacion_estado_disparar(boolean);
--   drop function if exists public.exportacion_estado_avisar(text, text);
--   drop table if exists public.exportacion_estado_disparos;
-- commit;
-- 3) Los secretos de Vault se borran aparte: delete from vault.secrets where name like 'github_estado_diario%';
