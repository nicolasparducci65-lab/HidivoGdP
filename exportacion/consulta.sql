-- ============================================================================
-- Exportación diaria del estado de proyectos: consulta ÚNICA, de solo lectura.
--
-- Es UNA sola sentencia SELECT que devuelve UNA fila con UNA columna «datos»
-- (json): un objeto con una clave por tabla y, en cada una, SOLO las columnas que
-- usa exportacion/estado-proyectos.js. Como el resultado es un único JSON y no
-- filas, el tope de 1.000 filas de la API no lo corta.
-- No trae correos, teléfonos, tokens, cédulas ni los textos de los incidentes de
-- SST. Tampoco descripciones de observaciones (solo la marca «con antecedente»)
-- ni coordenadas (D8: la ubicación sale de la descripción del proyecto).
--
-- Es el cuerpo de la función public.exportacion_estado_datos(), que solo puede
-- ejecutar service_role: se incrusta TAL CUAL, sin el punto y coma final, dentro
-- de «select ( … )» o como cuerpo de una función SQL. Por eso este archivo no
-- lleva comandos de psql, tiene un único punto y coma (el último carácter de la
-- sentencia), no usa el signo de dólar ni comentarios de bloque, y nombra todas
-- las tablas con el esquema public.
-- El generador recibe el JSON así: node exportar.js datos.json carpeta-salida
--
-- Las columnas empresa_id / emisor_empresa_id / tipo / codigo de proyectos y la
-- sigla de empresas vienen de las migraciones 20261120_multiempresa_*.
--
-- Usuarios de prueba (decisión del 21-nov-2026). Un perfil es de prueba si su
-- nombre empieza por «Prueba» (sin distinguir mayúsculas) o si su correo lleva
-- un «+» antes de la arroba. La regla está escrita UNA sola vez, al pie: la
-- subconsulta «prueba» devuelve una fila con el arreglo de sus id. El correo se
-- lee solo ahí y NO se devuelve: de cada perfil sale el booleano es_prueba.
--   · Las tablas que llegan fila a fila traen su columna de autor (creado_por,
--     created_by) y es el generador quien deja fuera lo creado por un usuario de
--     prueba.
--   · libro_obra y archivos llegan AGREGADOS (una fila por proyecto, o por
--     proyecto y módulo) para no traer miles de filas: el agregado ya NO cuenta
--     lo creado o subido por usuarios de prueba y devuelve aparte cuántos dejó
--     fuera (excluidos_prueba). Una fila puede venir con cantidad 0, o sin
--     ultimo_registro, si todo lo que tenía era de prueba.
-- Las claves y columnas de la versión anterior (migración 20261121) siguen todas:
-- esta solo añade.
--
-- Orden: donde el orden de las filas decide el resultado, el json_agg lleva su
-- ORDER BY (no basta el de una subconsulta):
--   · cronograma_rubros: por proyecto, rubro, fecha de creación e id. Sin línea
--     base activa cuenta UNA fila por rubro, la última: así es siempre la más
--     reciente. (El generador vuelve a ordenar por created_at e id, por si los
--     datos le llegan por otro camino.)
--   · lineas_base: por proyecto y número.
--   · planillas_pago y actas_recepcion: orden fijo para que dos filas iguales en
--     número o en tipo no cambien de lugar de un día a otro.
-- ============================================================================
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
