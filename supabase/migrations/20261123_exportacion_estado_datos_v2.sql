-- ============================================================================
-- APLICADA en producción el 21-nov-2026.
-- Exportación diaria del estado de proyectos: función de datos, versión 2
-- (usuarios de prueba y columnas de autor).
-- SIN APLICAR. No publica ni cambia nada más: solo reemplaza el cuerpo de
-- public.exportacion_estado_datos(), creada por 20261121_exportaciones_estado.sql
-- (aplicada en producción el 21-nov-2026). La aplica el rol dueño de la base
-- (postgres): en el SQL Editor, o con un ensayo previo (begin … rollback).
--
-- Qué cambia en lo que devuelve (decisiones del 21-nov-2026, tarde):
--   1) perfiles trae el booleano es_prueba. Un perfil es de prueba si su nombre
--      empieza por «Prueba» (sin distinguir mayúsculas) o si su correo lleva un
--      «+» antes de la arroba. El correo se lee dentro de la función y NO se
--      devuelve.
--   2) planillas_pago, ordenes_cambio, ensayos y solicitudes traen creado_por, y
--      sst_incidentes trae created_by (observaciones ya traía creado_por): con
--      eso el generador deja fuera lo creado por usuarios de prueba.
--   3) libro_obra y archivos, que llegan agregados, ya NO cuentan lo creado o
--      subido por usuarios de prueba y devuelven aparte cuántos dejaron fuera
--      (excluidos_prueba).
-- No se quita ninguna clave ni ninguna columna de la versión anterior: solo se
-- añade. El cuerpo es, tal cual, la sentencia de exportacion/consulta.sql; la
-- prueba tests/exportaciones-estado-migracion.test.js falla si dejan de ser
-- iguales.
--
-- Orden de aplicación: indiferente respecto del generador. El generador nuevo
-- (formato 3) funciona con la función anterior (no excluye nada y lo dice en la
-- cabecera del .md: «usuarios de prueba: no se pudieron identificar (función de
-- datos anterior)») y el generador anterior ignora las columnas nuevas.
--
-- Permisos: los mismos de la 20261121. SECURITY DEFINER con search_path fijo,
-- STABLE (solo lee), y solo la ejecuta service_role (además del dueño). El
-- REVOKE nombra a anon y authenticated porque Supabase les concede EXECUTE por
-- defecto sobre las funciones del esquema public. La transacción PRUEBA los
-- permisos antes del commit: si anon o authenticated pueden ejecutarla, o
-- service_role no puede, aborta y no queda nada aplicado.
--
-- Requiere: la migración 20261121 y las columnas perfiles.email,
-- libro_obra.created_by, archivos.subido_por, planillas_pago.creado_por,
-- ordenes_cambio.creado_por, ensayos.creado_por, solicitudes.creado_por y
-- sst_incidentes.created_by (todas existen en la base; si faltara alguna, la
-- función no se crea y la transacción aborta).
-- Efecto sobre datos existentes: ninguno. No borra ni modifica filas: lo de
-- prueba sigue en la base hasta que se limpie a mano.
--
-- OJO: 20261121_exportaciones_estado.sql vuelve a instalar el cuerpo ANTERIOR
-- si se aplica de nuevo (lo pide, por ejemplo, la reversión de la
-- 20261122_exportacion_estado_disparo.sql). Después de reaplicarla hay que
-- aplicar otra vez esta.
-- ============================================================================

begin;

-- El cuerpo es la sentencia de exportacion/consulta.sql tal cual (sin su cabecera
-- de comentarios). Si se cambia uno, hay que cambiar el otro: la prueba los compara.
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
             fecha_aprobacion, fecha_pago, created_at, updated_at, creado_por
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
      select proyecto_id, numero, titulo, estado, monto_total, created_at, creado_por
        from public.ordenes_cambio
    ) t),
  'libro_obra', (
    select coalesce(json_agg(t), '[]'::json) from (
      select proyecto_id,
             max(fecha) filter (where not coalesce(created_by = any(prueba.ids), false)) as ultimo_registro,
             count(*) filter (where estado_aprobacion = 'pendiente' and not coalesce(created_by = any(prueba.ids), false)) as pendientes_aprobacion,
             count(*) filter (where coalesce(created_by = any(prueba.ids), false)) as excluidos_prueba
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
      select id, proyecto_id, cumple, resuelto, reensayo_de, creado_por
        from public.ensayos
    ) t),
  'sst_incidentes', (
    select coalesce(json_agg(t), '[]'::json) from (
      select proyecto_id, estado, created_by
        from public.sst_incidentes
    ) t),
  'solicitudes', (
    select coalesce(json_agg(t), '[]'::json) from (
      select proyecto_id, estado, creado_por
        from public.solicitudes
    ) t),
  'archivos', (
    select coalesce(json_agg(t), '[]'::json) from (
      select proyecto_id, modulo,
             count(*) filter (where not coalesce(subido_por = any(prueba.ids), false)) as cantidad,
             count(*) filter (where coalesce(subido_por = any(prueba.ids), false)) as excluidos_prueba
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
      select id, nombre, apellido, (id = any(prueba.ids)) as es_prueba
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
) as datos
  from (
    select coalesce(array_agg(id), '{}'::uuid[]) as ids
      from public.perfiles
     where btrim(nombre) ilike 'prueba%'
        or position('+' in split_part(coalesce(email, ''), '@', 1)) > 0
  ) prueba;
$datos$;

revoke all on function public.exportacion_estado_datos() from public, anon, authenticated;
grant execute on function public.exportacion_estado_datos() to service_role;

-- ── Prueba de permisos y de forma (si falla, no se aplica nada) ─────────────
-- Intento REAL con cada rol: anon y authenticated tienen que recibir «permission
-- denied» (42501) al llamar a la función. service_role la ejecuta de verdad (solo
-- lee) y lo que devuelve tiene que ser un objeto json cuyos perfiles traen
-- es_prueba y en el que no viaja ningún correo.
do $prueba$
declare
  v_rol   text;
  v_pudo  boolean;
  v_datos json;
begin
  foreach v_rol in array array['anon', 'authenticated'] loop
    execute format('set local role %I', v_rol);
    v_pudo := true;
    begin
      execute 'select public.exportacion_estado_datos()';
    exception when insufficient_privilege then
      v_pudo := false;
    end;
    reset role;
    if v_pudo then
      raise exception 'Permisos mal puestos: el rol % pudo ejecutar exportacion_estado_datos().', v_rol using errcode = '42501';
    end if;
    if has_function_privilege(v_rol, 'public.exportacion_estado_datos()', 'execute') then
      raise exception 'Permisos mal puestos: el rol % conserva EXECUTE sobre exportacion_estado_datos().', v_rol using errcode = '42501';
    end if;
  end loop;
  if has_function_privilege('public', 'public.exportacion_estado_datos()', 'execute') then
    raise exception 'Permisos mal puestos: PUBLIC conserva EXECUTE sobre exportacion_estado_datos().' using errcode = '42501';
  end if;

  if not has_function_privilege('service_role', 'public.exportacion_estado_datos()', 'execute') then
    raise exception 'Permisos mal puestos: service_role no puede ejecutar exportacion_estado_datos().' using errcode = '42501';
  end if;
  set local role service_role;
  select public.exportacion_estado_datos() into v_datos;
  reset role;
  if json_typeof(v_datos) is distinct from 'object' then
    raise exception 'exportacion_estado_datos() no devolvió un objeto json (devolvió %).', coalesce(json_typeof(v_datos), 'null');
  end if;
  if exists (select 1 from json_array_elements(v_datos -> 'perfiles') p where json_typeof(p -> 'es_prueba') is distinct from 'boolean') then
    raise exception 'exportacion_estado_datos() devolvió algún perfil sin el booleano es_prueba.';
  end if;
  if v_datos::text ~ '"(email|correo)"' then
    raise exception 'exportacion_estado_datos() devuelve una columna de correo.';
  end if;
end $prueba$;

commit;

-- ── Verificación (solo lee) ─────────────────────────────────────────────────
--   -- Permisos: anon, authenticated y public en f; service_role en t
--   select r.rol, has_function_privilege(r.rol, 'public.exportacion_estado_datos()', 'execute') as puede
--     from (values ('anon'), ('authenticated'), ('public'), ('service_role')) as r(rol);
--   -- Atributos: json | f | t | s  (un valor, no filas; SECURITY DEFINER; STABLE) y search_path fijo
--   select prorettype::regtype as devuelve, proretset as devuelve_filas, prosecdef, provolatile, proconfig
--     from pg_proc where proname = 'exportacion_estado_datos';
--   -- Intento real con los roles de la app: los dos deben dar «permission denied for function»
--   begin; set local role anon;          select public.exportacion_estado_datos(); rollback;
--   begin; set local role authenticated; select public.exportacion_estado_datos(); rollback;
--   -- Qué perfiles quedan marcados como de prueba (nombre y apellido; el correo no sale)
--   select p ->> 'nombre' as nombre, p ->> 'apellido' as apellido
--     from json_array_elements(public.exportacion_estado_datos() -> 'perfiles') p
--    where (p ->> 'es_prueba')::boolean;
--   -- Cuántos registros del libro y archivos de prueba quedan fuera, por proyecto
--   select 'libro' as que, l ->> 'proyecto_id' as proyecto_id, (l ->> 'excluidos_prueba')::int as n
--     from json_array_elements(public.exportacion_estado_datos() -> 'libro_obra') l where (l ->> 'excluidos_prueba')::int > 0
--   union all
--   select 'archivos', a ->> 'proyecto_id', sum((a ->> 'excluidos_prueba')::int)::int
--     from json_array_elements(public.exportacion_estado_datos() -> 'archivos') a where (a ->> 'excluidos_prueba')::int > 0 group by 2;

-- ── Reversión (vuelve al cuerpo de la 20261121; el generador sigue valiendo) ─
-- Es el bloque 4 de 20261121_exportaciones_estado.sql, copiado tal cual. Quitar
-- el «--   » del principio de cada línea y ejecutar:
--   begin;
--   create or replace function public.exportacion_estado_datos()
--     returns json
--     language sql stable security definer
--     set search_path to 'public', 'pg_temp'
--   as $datos$
--   select json_build_object(
--     'proyectos', (
--       select coalesce(json_agg(t order by t.codigo nulls last, t.nombre, t.id), '[]'::json) from (
--         select id, empresa_id, emisor_empresa_id, codigo, tipo, nombre, descripcion,
--                contratante, contratista, monto_contrato, fecha_inicio, fecha_fin_planificada,
--                fecha_fin_real, estado, estado_cierre, ubicacion
--           from public.proyectos
--       ) t),
--     'empresas', (
--       select coalesce(json_agg(t), '[]'::json) from (
--         select id, nombre, sigla
--           from public.empresas
--       ) t),
--     'rubros', (
--       select coalesce(json_agg(t), '[]'::json) from (
--         select id, proyecto_id, codigo, descripcion, monto_contrato, total_produccion, estado
--           from public.rubros
--       ) t),
--     'cronograma_rubros', (
--       select coalesce(json_agg(t order by t.proyecto_id, t.rubro_id, t.created_at, t.id), '[]'::json) from (
--         select id, proyecto_id, rubro_id, linea_base_id, fecha_inicio, fecha_fin, created_at
--           from public.cronograma_rubros
--       ) t),
--     'lineas_base', (
--       select coalesce(json_agg(t order by t.proyecto_id, t.numero, t.id), '[]'::json) from (
--         select id, proyecto_id, numero, activa
--           from public.lineas_base
--       ) t),
--     'planillas_pago', (
--       select coalesce(json_agg(t order by t.proyecto_id, t.numero, t.created_at, t.id), '[]'::json) from (
--         select id, proyecto_id, numero, fecha_inicio, fecha_fin, estado, total_monto, total_liquido,
--                fecha_aprobacion, fecha_pago, created_at, updated_at
--           from public.planillas_pago
--       ) t),
--     'planilla_historial', (
--       select coalesce(json_agg(t), '[]'::json) from (
--         select planilla_id, accion, created_at
--           from public.planilla_historial
--       ) t),
--     'garantias', (
--       select coalesce(json_agg(t), '[]'::json) from (
--         select proyecto_id, tipo, vigencia_hasta, estado
--           from public.garantias
--       ) t),
--     'ordenes_cambio', (
--       select coalesce(json_agg(t), '[]'::json) from (
--         select proyecto_id, numero, titulo, estado, monto_total, created_at
--           from public.ordenes_cambio
--       ) t),
--     'libro_obra', (
--       select coalesce(json_agg(t), '[]'::json) from (
--         select proyecto_id,
--                max(fecha) as ultimo_registro,
--                count(*) filter (where estado_aprobacion = 'pendiente') as pendientes_aprobacion
--           from public.libro_obra
--          group by proyecto_id
--       ) t),
--     'observaciones', (
--       select coalesce(json_agg(t), '[]'::json) from (
--         select proyecto_id, numero, titulo, estado, creado_por, created_at,
--                (coalesce(descripcion, '') ilike '%Antecedente:%') as con_antecedente
--           from public.observaciones
--       ) t),
--     'ensayos', (
--       select coalesce(json_agg(t), '[]'::json) from (
--         select id, proyecto_id, cumple, resuelto, reensayo_de
--           from public.ensayos
--       ) t),
--     'sst_incidentes', (
--       select coalesce(json_agg(t), '[]'::json) from (
--         select proyecto_id, estado
--           from public.sst_incidentes
--       ) t),
--     'solicitudes', (
--       select coalesce(json_agg(t), '[]'::json) from (
--         select proyecto_id, estado
--           from public.solicitudes
--       ) t),
--     'archivos', (
--       select coalesce(json_agg(t), '[]'::json) from (
--         select proyecto_id, modulo, count(*) as cantidad
--           from public.archivos
--          group by proyecto_id, modulo
--       ) t),
--     'proyecto_miembros', (
--       select coalesce(json_agg(t), '[]'::json) from (
--         select proyecto_id, usuario_id, perfil_id, rol
--           from public.proyecto_miembros
--       ) t),
--     'perfiles', (
--       select coalesce(json_agg(t), '[]'::json) from (
--         select id, nombre, apellido
--           from public.perfiles
--       ) t),
--     'actas_recepcion', (
--       select coalesce(json_agg(t order by t.proyecto_id, t.tipo, t.fecha), '[]'::json) from (
--         select proyecto_id, tipo, fecha
--           from public.actas_recepcion
--       ) t),
--     'liquidaciones', (
--       select coalesce(json_agg(t), '[]'::json) from (
--         select proyecto_id
--           from public.liquidaciones
--       ) t)
--   ) as datos;
--   $datos$;
--   revoke all on function public.exportacion_estado_datos() from public, anon, authenticated;
--   grant execute on function public.exportacion_estado_datos() to service_role;
--   commit;
