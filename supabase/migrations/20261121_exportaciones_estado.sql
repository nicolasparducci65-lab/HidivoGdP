-- ============================================================================
-- Exportación diaria del estado de proyectos: registro de corridas y vigilante.
-- NO se aplica sola. Se aplica DESPUÉS de publicar la app que muestra el aviso
-- en la campana y ANTES de subir el workflow estado-diario.yml al repo de
-- respaldos (el workflow llama a exportacion_estado_registrar y falla si no
-- existe). La aplica el rol dueño de la base (postgres): en el SQL Editor, o
-- con un ensayo previo (begin … rollback) y la reversión del pie a mano.
--
-- Qué hace:
--   1) Tabla exportaciones_estado: una fila por corrida del workflow (fecha de
--      Ecuador, ok, detalle, aviso). Solo la lee el admin global; nadie la
--      escribe desde la app.
--   2) exportacion_estado_registrar(ok, detalle, aviso): la llama el workflow
--      por psql con la cadena de conexión (rol dueño de la base). Inserta la
--      fila y:
--        · ok = false: deja un aviso en la campana de cada admin global
--          (notificaciones, tipo 'exportacion_estado'). El tercer parámetro
--          no se usa.
--        · ok = true y aviso nulo o vacío (corrida buena): borra los avisos de
--          ese tipo creados HOY (un primer intento fallido deja de alarmar
--          cuando el segundo sale bien).
--        · ok = true y aviso con texto (corrida DEGRADADA: los archivos se
--          generaron y subieron, pero con bloques sin calcular): la fila queda
--          ok = true con el aviso guardado, y cada admin global recibe una
--          notificación con ese texto. No borra nada de hoy.
--      En todos los casos borra las filas del registro y los avisos de ese
--      tipo con más de 90 días.
--   3) exportacion_estado_vigilar(): si hoy (Ecuador) no hay ninguna corrida
--      buena, deja el aviso a cada admin global que todavía no tenga uno de hoy.
--      Cubre el caso de que GitHub no llegue a correr.
--   4) Tarea de pg_cron «exportacion-estado-vigilante», '20 10 * * *' (UTC) =
--      05:20 de Ecuador, todos los días.
--
-- Requiere: extensión pg_cron (ya en uso por «resumen-cartera-diario»), la
-- tabla notificaciones (perfil_id, tipo, titulo, mensaje) y sst_es_admin_global().
-- Admin global = perfiles.rol = 'admin' (mismo criterio que sst_es_admin_global
-- y que resumen-cartera).
-- Efecto sobre datos existentes: ninguno al aplicarla. Después, cada llamada a
-- exportacion_estado_registrar borra notificaciones de tipo 'exportacion_estado'
-- (las de hoy si la corrida es buena; siempre las de más de 90 días). Ningún
-- otro tipo de notificación se toca.
-- ============================================================================

begin;

-- ── 1) Tabla ────────────────────────────────────────────────────────────────
create table if not exists public.exportaciones_estado (
  id        uuid primary key default gen_random_uuid(),
  fecha     date not null,                       -- día de Ecuador para el que vale la corrida
  ok        boolean not null,
  detalle   text,
  aviso     text,                                -- solo en corridas degradadas (ok = true con bloques sin calcular)
  creado_en timestamptz not null default now()
);
-- Por si la tabla se creó con una versión anterior de este archivo (sin la columna).
alter table public.exportaciones_estado add column if not exists aviso text;

create index if not exists exportaciones_estado_fecha_idx
  on public.exportaciones_estado (fecha desc, ok);

revoke all on public.exportaciones_estado from public, anon, authenticated;
grant select on public.exportaciones_estado to authenticated;
grant all on public.exportaciones_estado to service_role;

alter table public.exportaciones_estado enable row level security;

drop policy if exists exportaciones_estado_select on public.exportaciones_estado;
create policy exportaciones_estado_select on public.exportaciones_estado
  for select to authenticated
  using ((select sst_es_admin_global()));
-- Sin políticas de INSERT/UPDATE/DELETE: desde la app no se escribe.

-- ── 2) Registro de una corrida (lo llama el workflow) ───────────────────────
-- La versión anterior de este archivo tenía dos parámetros. Si llegó a crearse,
-- se quita: con las dos firmas, una llamada con dos argumentos sería ambigua.
drop function if exists public.exportacion_estado_registrar(boolean, text);

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
    -- Una corrida buena deja sin efecto los avisos de hoy (primer intento fallido, vigilante o corrida degradada).
    delete from notificaciones n
     where n.tipo = 'exportacion_estado'
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

-- ── 3) Vigilante (lo llama pg_cron) ─────────────────────────────────────────
-- Devuelve cuántos avisos dejó (0 si hay corrida buena de hoy o si ya avisó).
create or replace function public.exportacion_estado_vigilar()
  returns integer
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
  v_n   integer := 0;
begin
  if exists (select 1 from exportaciones_estado e where e.fecha = v_hoy and e.ok) then
    return 0;
  end if;

  insert into notificaciones (perfil_id, tipo, titulo, mensaje)
  select p.id, 'exportacion_estado',
         'La exportación diaria del estado no se generó',
         'No hay ninguna corrida buena registrada para hoy (' || to_char(v_hoy, 'YYYY-MM-DD')
           || '). Los archivos de Drive son de un día anterior: mira la fecha «válido para» y lanza la corrida a mano.'
    from perfiles p
   where p.rol = 'admin'
     and not exists (
       select 1 from notificaciones n
        where n.perfil_id = p.id
          and n.tipo = 'exportacion_estado'
          and (n.created_at at time zone 'America/Guayaquil')::date = v_hoy);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.exportacion_estado_vigilar() from public, anon, authenticated;
grant execute on function public.exportacion_estado_vigilar() to service_role;

-- ── 4) Tarea de pg_cron (idempotente: si existe, se reprograma) ─────────────
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'exportacion-estado-vigilante') then
    perform cron.unschedule('exportacion-estado-vigilante');
  end if;
  perform cron.schedule(
    'exportacion-estado-vigilante',
    '20 10 * * *',                                -- 10:20 UTC = 05:20 de Ecuador
    $job$select public.exportacion_estado_vigilar();$job$
  );
end $do$;

commit;

-- ── Verificación (cada bloque hace ROLLBACK, no deja nada escrito) ──────────
-- 1) Estructura, permisos y tarea (solo lectura):
--   select policyname, cmd, roles from pg_policies where tablename = 'exportaciones_estado';
--   -- exportaciones_estado_select | SELECT | {authenticated}
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'exportaciones_estado' and grantee in ('anon','authenticated')
--    order by 1, 2;                                                          -- solo authenticated | SELECT
--   select has_function_privilege('authenticated', 'public.exportacion_estado_registrar(boolean, text, text)', 'execute'),
--          has_function_privilege('anon',          'public.exportacion_estado_registrar(boolean, text, text)', 'execute'),
--          has_function_privilege('authenticated', 'public.exportacion_estado_vigilar()', 'execute'),
--          has_function_privilege('service_role',  'public.exportacion_estado_registrar(boolean, text, text)', 'execute');
--   -- f | f | f | t
--   select count(*) from pg_proc where proname = 'exportacion_estado_registrar';                     -- 1 (una sola firma)
--   select jobname, schedule, command, active from cron.job where jobname = 'exportacion-estado-vigilante';
--   -- exportacion-estado-vigilante | 20 10 * * * | select public.exportacion_estado_vigilar(); | t
--
-- 2) Una corrida fallida avisa a cada admin global y el vigilante no duplica:
--   begin;
--     select public.exportacion_estado_registrar(false, 'zz prueba: falló el paso «Subir a Drive»');
--     select (select count(*) from public.notificaciones where tipo = 'exportacion_estado' and mensaje like 'zz prueba%')
--          = (select count(*) from public.perfiles where rol = 'admin') as un_aviso_por_admin;      -- t
--     select public.exportacion_estado_vigilar();                                                     -- 0 (ya avisó hoy)
--   rollback;
--
-- 3) Sin corrida buena de hoy, el vigilante avisa una sola vez; una corrida buena retira los avisos:
--   begin;
--     delete from public.exportaciones_estado where fecha = (now() at time zone 'America/Guayaquil')::date;
--     delete from public.notificaciones where tipo = 'exportacion_estado';
--     select public.exportacion_estado_vigilar();                             -- nº de admin globales
--     select public.exportacion_estado_vigilar();                             -- 0
--     select public.exportacion_estado_registrar(true, 'zz prueba');
--     select count(*) from public.notificaciones where tipo = 'exportacion_estado';                  -- 0
--     select public.exportacion_estado_vigilar();                             -- 0 (hay corrida buena)
--   rollback;
--
-- 4) Un usuario de la app no puede llamar a las funciones:
--   begin;
--     set local role authenticated;
--     select public.exportacion_estado_registrar(true, 'zz');                 -- ERROR: permission denied for function
--   rollback;
--
-- 5) Una corrida degradada queda ok = true, avisa a cada admin global y el vigilante calla:
--   begin;
--     delete from public.notificaciones where tipo = 'exportacion_estado';
--     select public.exportacion_estado_registrar(true, 'zz prueba', 'zz aviso: 4 bloques sin calcular');
--     select ok, aviso from public.exportaciones_estado where detalle = 'zz prueba';                 -- t | zz aviso: 4 bloques sin calcular
--     select (select count(*) from public.notificaciones where tipo = 'exportacion_estado' and mensaje like 'zz aviso%')
--          = (select count(*) from public.perfiles where rol = 'admin') as un_aviso_por_admin;      -- t
--     select public.exportacion_estado_vigilar();                                                     -- 0
--   rollback;
--
-- 6) La limpieza de 90 días: se va lo de hace 91 días y se queda lo de hace 90:
--   begin;
--     insert into public.exportaciones_estado (fecha, ok, detalle) values
--       ((now() at time zone 'America/Guayaquil')::date - 91, true, 'zz viejo'),
--       ((now() at time zone 'America/Guayaquil')::date - 90, true, 'zz límite');
--     select public.exportacion_estado_registrar(true, 'zz prueba');
--     select detalle from public.exportaciones_estado where detalle like 'zz%' order by fecha;       -- zz límite, zz prueba
--   rollback;

-- ── Reversión ───────────────────────────────────────────────────────────────
-- Antes, desactivar el workflow estado-diario.yml (si no, cada corrida fallará al registrar).
-- begin;
--   select cron.unschedule('exportacion-estado-vigilante')
--     where exists (select 1 from cron.job where jobname = 'exportacion-estado-vigilante');
--   drop function if exists public.exportacion_estado_vigilar();
--   drop function if exists public.exportacion_estado_registrar(boolean, text, text);
--   drop function if exists public.exportacion_estado_registrar(boolean, text);
--   delete from public.notificaciones where tipo = 'exportacion_estado';
--   drop table if exists public.exportaciones_estado;
-- commit;
