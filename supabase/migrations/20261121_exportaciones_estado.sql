-- ============================================================================
-- Exportación diaria del estado de proyectos: datos, registro de corridas y
-- vigilante.
-- NO se aplica sola. Se aplica DESPUÉS de publicar la app que muestra el aviso
-- en la campana y ANTES de subir el workflow estado-diario.yml al repo privado
-- HidivoBackups (el workflow llama por la API a exportacion_estado_datos y a
-- exportacion_estado_registrar, y falla si no existen). La aplica el rol dueño
-- de la base (postgres): en el SQL Editor, o con un ensayo previo
-- (begin … rollback) y la reversión del pie a mano.
--
-- Qué hace:
--   1) Tabla exportaciones_estado: una fila por corrida del workflow (fecha de
--      Ecuador, ok, detalle, aviso). Solo la lee el admin global; nadie la
--      escribe desde la app.
--   2) exportacion_estado_registrar(ok, detalle, aviso): la llama el workflow
--      por la API (rpc) con la llave de service_role. Inserta la fila y:
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
--   4) exportacion_estado_datos(): los datos de la exportación en UN ÚNICO valor
--      json (un objeto con una clave por tabla). La llama el workflow por la
--      API (rpc). Como devuelve un solo valor y no filas, el tope de 1.000
--      filas de la API no la corta. Su cuerpo es la consulta de
--      exportacion/consulta.sql; la prueba
--      tests/exportaciones-estado-migracion.test.js falla si dejan de ser iguales.
--      Solo lee.
--   5) Tarea de pg_cron «exportacion-estado-vigilante», '20 10 * * *' (UTC) =
--      05:20 de Ecuador, todos los días.
--   6) PRUEBA de permisos, dentro de la misma transacción: comprueba que anon y
--      authenticated NO pueden ejecutar ninguna de las tres funciones y que
--      service_role sí. Si algo no cuadra, la migración aborta entera y no
--      queda nada aplicado.
--
-- Permisos: las tres funciones son SECURITY DEFINER con search_path fijo y solo
-- las puede ejecutar service_role (además del dueño). Supabase concede EXECUTE
-- por defecto a anon y authenticated sobre cada función nueva del esquema
-- public: por eso el REVOKE los nombra, no basta con quitárselo a PUBLIC.
--
-- Requiere: extensión pg_cron (ya en uso por «resumen-cartera-diario»), la
-- tabla notificaciones (perfil_id, tipo, titulo, mensaje), sst_es_admin_global()
-- y las migraciones 20261120_multiempresa_* (columnas codigo, tipo y
-- emisor_empresa_id de proyectos, y sigla de empresas, que lee la consulta).
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

-- ── 4) Datos de la exportación (lo llama el workflow por la API) ────────────
-- Un ÚNICO valor json: nada de SETOF ni de filas. El cuerpo es la sentencia de
-- exportacion/consulta.sql tal cual (sin su cabecera de comentarios). Si se
-- cambia uno, hay que cambiar el otro: la prueba de la migración los compara.
-- SECURITY DEFINER: lee con los permisos del dueño, sin depender de los GRANT
-- de cada tabla. STABLE: no escribe.
create or replace function public.exportacion_estado_datos()
  returns json
  language sql stable security definer
  set search_path to 'public', 'pg_temp'
as $datos$
select json_build_object(
  'proyectos', (
    select coalesce(json_agg(t order by t.codigo nulls last, t.nombre, t.id), '[]'::json) from (
      select id, empresa_id, emisor_empresa_id, codigo, tipo, nombre, descripcion,
             contratante, contratista, monto_contrato, fecha_inicio, fecha_fin_planificada,
             fecha_fin_real, estado, estado_cierre, ubicacion
        from public.proyectos
    ) t),
  'empresas', (
    select coalesce(json_agg(t), '[]'::json) from (
      select id, nombre, sigla
        from public.empresas
    ) t),
  'rubros', (
    select coalesce(json_agg(t), '[]'::json) from (
      select id, proyecto_id, codigo, descripcion, monto_contrato, total_produccion, estado
        from public.rubros
    ) t),
  'cronograma_rubros', (
    select coalesce(json_agg(t order by t.proyecto_id, t.rubro_id, t.created_at, t.id), '[]'::json) from (
      select id, proyecto_id, rubro_id, linea_base_id, fecha_inicio, fecha_fin, created_at
        from public.cronograma_rubros
    ) t),
  'lineas_base', (
    select coalesce(json_agg(t order by t.proyecto_id, t.numero, t.id), '[]'::json) from (
      select id, proyecto_id, numero, activa
        from public.lineas_base
    ) t),
  'planillas_pago', (
    select coalesce(json_agg(t order by t.proyecto_id, t.numero, t.created_at, t.id), '[]'::json) from (
      select id, proyecto_id, numero, fecha_inicio, fecha_fin, estado, total_monto, total_liquido,
             fecha_aprobacion, fecha_pago, created_at, updated_at
        from public.planillas_pago
    ) t),
  'planilla_historial', (
    select coalesce(json_agg(t), '[]'::json) from (
      select planilla_id, accion, created_at
        from public.planilla_historial
    ) t),
  'garantias', (
    select coalesce(json_agg(t), '[]'::json) from (
      select proyecto_id, tipo, vigencia_hasta, estado
        from public.garantias
    ) t),
  'ordenes_cambio', (
    select coalesce(json_agg(t), '[]'::json) from (
      select proyecto_id, numero, titulo, estado, monto_total, created_at
        from public.ordenes_cambio
    ) t),
  'libro_obra', (
    select coalesce(json_agg(t), '[]'::json) from (
      select proyecto_id,
             max(fecha) as ultimo_registro,
             count(*) filter (where estado_aprobacion = 'pendiente') as pendientes_aprobacion
        from public.libro_obra
       group by proyecto_id
    ) t),
  'observaciones', (
    select coalesce(json_agg(t), '[]'::json) from (
      select proyecto_id, numero, titulo, estado, creado_por, created_at,
             (coalesce(descripcion, '') ilike '%Antecedente:%') as con_antecedente
        from public.observaciones
    ) t),
  'ensayos', (
    select coalesce(json_agg(t), '[]'::json) from (
      select id, proyecto_id, cumple, resuelto, reensayo_de
        from public.ensayos
    ) t),
  'sst_incidentes', (
    select coalesce(json_agg(t), '[]'::json) from (
      select proyecto_id, estado
        from public.sst_incidentes
    ) t),
  'solicitudes', (
    select coalesce(json_agg(t), '[]'::json) from (
      select proyecto_id, estado
        from public.solicitudes
    ) t),
  'archivos', (
    select coalesce(json_agg(t), '[]'::json) from (
      select proyecto_id, modulo, count(*) as cantidad
        from public.archivos
       group by proyecto_id, modulo
    ) t),
  'proyecto_miembros', (
    select coalesce(json_agg(t), '[]'::json) from (
      select proyecto_id, usuario_id, perfil_id, rol
        from public.proyecto_miembros
    ) t),
  'perfiles', (
    select coalesce(json_agg(t), '[]'::json) from (
      select id, nombre, apellido
        from public.perfiles
    ) t),
  'actas_recepcion', (
    select coalesce(json_agg(t order by t.proyecto_id, t.tipo, t.fecha), '[]'::json) from (
      select proyecto_id, tipo, fecha
        from public.actas_recepcion
    ) t),
  'liquidaciones', (
    select coalesce(json_agg(t), '[]'::json) from (
      select proyecto_id
        from public.liquidaciones
    ) t)
) as datos;
$datos$;

revoke all on function public.exportacion_estado_datos() from public, anon, authenticated;
grant execute on function public.exportacion_estado_datos() to service_role;

-- ── 5) Tarea de pg_cron (idempotente: si existe, se reprograma) ─────────────
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

-- ── 6) Prueba de permisos (si falla, no se aplica nada) ─────────────────────
-- Intento REAL con cada rol: anon y authenticated tienen que recibir «permission
-- denied» (42501) al llamar a cada una de las tres funciones. La negativa llega
-- antes de ejecutar nada, así que el intento no escribe. service_role ejecuta de
-- verdad la de datos (solo lee); para las dos que escriben se comprueba el
-- privilegio sin llamarlas.
do $prueba$
declare
  v_rol     text;
  v_llamada text;
  v_pudo    boolean;
  v_tipo    text;
begin
  foreach v_rol in array array['anon', 'authenticated'] loop
    foreach v_llamada in array array[
      'select public.exportacion_estado_datos()',
      'select public.exportacion_estado_registrar(true, ''zz prueba de permisos'', null)',
      'select public.exportacion_estado_vigilar()'] loop
      execute format('set local role %I', v_rol);
      v_pudo := true;
      begin
        execute v_llamada;
      exception when insufficient_privilege then
        v_pudo := false;
      end;
      reset role;
      if v_pudo then
        raise exception 'Permisos mal puestos: el rol % pudo ejecutar «%».', v_rol, v_llamada using errcode = '42501';
      end if;
    end loop;
    if has_function_privilege(v_rol, 'public.exportacion_estado_datos()', 'execute')
       or has_function_privilege(v_rol, 'public.exportacion_estado_registrar(boolean, text, text)', 'execute')
       or has_function_privilege(v_rol, 'public.exportacion_estado_vigilar()', 'execute') then
      raise exception 'Permisos mal puestos: el rol % conserva EXECUTE sobre alguna función de la exportación.', v_rol using errcode = '42501';
    end if;
  end loop;

  if not (has_function_privilege('service_role', 'public.exportacion_estado_datos()', 'execute')
          and has_function_privilege('service_role', 'public.exportacion_estado_registrar(boolean, text, text)', 'execute')
          and has_function_privilege('service_role', 'public.exportacion_estado_vigilar()', 'execute')) then
    raise exception 'Permisos mal puestos: service_role no puede ejecutar alguna función de la exportación.' using errcode = '42501';
  end if;
  set local role service_role;
  select json_typeof(public.exportacion_estado_datos()) into v_tipo;
  reset role;
  if v_tipo is distinct from 'object' then
    raise exception 'exportacion_estado_datos() no devolvió un objeto json (devolvió %).', coalesce(v_tipo, 'null');
  end if;
end $prueba$;

commit;

-- ── Verificación (cada bloque hace ROLLBACK, no deja nada escrito) ──────────
-- 1) Estructura, permisos y tarea (solo lectura):
--   select policyname, cmd, roles from pg_policies where tablename = 'exportaciones_estado';
--   -- exportaciones_estado_select | SELECT | {authenticated}
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'exportaciones_estado' and grantee in ('anon','authenticated')
--    order by 1, 2;                                                          -- solo authenticated | SELECT
--   select r.rol,
--          has_function_privilege(r.rol, 'public.exportacion_estado_datos()', 'execute')                         as datos,
--          has_function_privilege(r.rol, 'public.exportacion_estado_registrar(boolean, text, text)', 'execute') as registrar,
--          has_function_privilege(r.rol, 'public.exportacion_estado_vigilar()', 'execute')                       as vigilar
--     from (values ('anon'), ('authenticated'), ('service_role')) as r(rol);
--   -- anon | f | f | f      authenticated | f | f | f      service_role | t | t | t
--   select proname, prosecdef, provolatile, proconfig from pg_proc
--    where proname like 'exportacion\_estado\_%' order by 1;
--   -- las tres con prosecdef = t y search_path fijo; exportacion_estado_datos con provolatile = s (STABLE)
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
-- 4) anon y authenticated NO pueden ejecutar ninguna de las tres funciones. Son
--    seis intentos, cada uno en su línea y con su propio rollback (tras el error
--    la transacción queda abortada). Se ejecutan de una en una y TODAS deben dar
--    «ERROR: 42501: permission denied for function …»:
--   begin; set local role anon;          select public.exportacion_estado_datos();                    rollback;
--   begin; set local role anon;          select public.exportacion_estado_registrar(true, 'zz', null); rollback;
--   begin; set local role anon;          select public.exportacion_estado_vigilar();                  rollback;
--   begin; set local role authenticated; select public.exportacion_estado_datos();                    rollback;
--   begin; set local role authenticated; select public.exportacion_estado_registrar(true, 'zz', null); rollback;
--   begin; set local role authenticated; select public.exportacion_estado_vigilar();                  rollback;
--    (Si el editor se queda en «transacción abortada» después de un error, ejecutar «rollback;» suelto.)
--
-- 4b) service_role SÍ puede ejecutar las tres (con rollback: no deja nada escrito):
--   begin;
--     set local role service_role;
--     select json_typeof(d) as tipo, (select count(*) from json_object_keys(d)) as claves,
--            json_array_length(d -> 'proyectos') as proyectos
--       from public.exportacion_estado_datos() as d;                          -- object | 19 | nº de proyectos de la base
--     select public.exportacion_estado_registrar(true, 'zz prueba de service_role', null);            -- sin error
--     select public.exportacion_estado_vigilar();                             -- 0 (acaba de registrarse una corrida buena)
--   rollback;
--
-- 4c) La función de datos devuelve UN valor, no filas (por eso la API no la corta):
--   select prorettype::regtype as devuelve, proretset as devuelve_filas from pg_proc where proname = 'exportacion_estado_datos';
--   -- json | f
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
-- Antes, desactivar el workflow estado-diario.yml (si no, cada corrida fallará al pedir los datos).
-- begin;
--   select cron.unschedule('exportacion-estado-vigilante')
--     where exists (select 1 from cron.job where jobname = 'exportacion-estado-vigilante');
--   drop function if exists public.exportacion_estado_datos();
--   drop function if exists public.exportacion_estado_vigilar();
--   drop function if exists public.exportacion_estado_registrar(boolean, text, text);
--   drop function if exists public.exportacion_estado_registrar(boolean, text);
--   delete from public.notificaciones where tipo = 'exportacion_estado';
--   drop table if exists public.exportaciones_estado;
-- commit;
