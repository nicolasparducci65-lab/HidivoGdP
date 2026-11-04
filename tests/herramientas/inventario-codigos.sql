-- Inventario de códigos de rubro (SOLO LECTURA, no corrige nada). Se corre sobre una copia
-- local del dump (nunca contra producción): tests/herramientas/inventario-codigos.js lo carga
-- en Postgres embebido (pglite) y escribe un CSV por consulta.
--
-- Los códigos (rubros.codigo) son identificadores, no numeración ordinal. Tres listas y un
-- resumen, cada una con el proyecto, el rubro, su contrato y ejecutado, si nació de una orden
-- de cambio y si ya tiene filas en el libro de obra (en_libro) o en planillas (en_planilla):
--   A. Ruido flotante: código numérico con 5+ decimales o con una racha 0000/9999 seguida de
--      dígitos al final (2.0199999999999996, 2.1000000000000001). codigo_propuesto = el código
--      redondeado a 4 decimales sin ceros sobrantes; colision = ya existe en otro rubro del
--      mismo proyecto (entonces no se puede redondear directo).
--   B. Sin código: NULL o solo espacios.
--   C. Repetidos: (proyecto_id, btrim(codigo)) con más de un rubro; una fila por rubro.
-- El paso siguiente (normalizar A, asignar B y C a mano, índice único por proyecto) se decide
-- con estas listas en la mano; este archivo no modifica nada.
--
-- Cada consulta va separada por una línea `-- @@ nombre` para que el cargador la ejecute y
-- guarde por separado.

-- @@ base
create temporary view rubros_inv as
select r.id, r.proyecto_id, p.nombre as proyecto, r.codigo, r.descripcion,
       r.cantidad_contrato, r.cantidad_ejecutada, r.es_orden_cambio,
       exists (select 1 from libro_obra_rubros l where l.rubro_id = r.id)  as en_libro,
       exists (select 1 from planilla_rubros  q where q.rubro_id = r.id)  as en_planilla
  from rubros r
  join proyectos p on p.id = r.proyecto_id;

-- @@ A_ruido_flotante
with ruido as (
  select *,
         rtrim(rtrim(round(codigo::numeric, 4)::text, '0'), '.') as codigo_propuesto
    from rubros_inv
   where codigo ~ '^\d+\.\d+$'
     and (codigo ~ '^\d+\.\d{5,}$' or codigo ~ '\.\d*(0{4,}|9{4,})\d*$')
)
select a.proyecto_id, a.proyecto, a.id as rubro_id, a.codigo, a.codigo_propuesto,
       exists (select 1 from rubros_inv b
                where b.proyecto_id = a.proyecto_id and b.id <> a.id
                  and btrim(b.codigo) = a.codigo_propuesto)            as colision,
       a.descripcion, a.cantidad_contrato, a.cantidad_ejecutada, a.es_orden_cambio, a.en_libro, a.en_planilla
  from ruido a
 order by a.proyecto, a.codigo_propuesto::numeric, a.codigo;

-- @@ B_sin_codigo
select proyecto_id, proyecto, id as rubro_id, codigo, descripcion,
       cantidad_contrato, cantidad_ejecutada, es_orden_cambio, en_libro, en_planilla
  from rubros_inv
 where codigo is null or btrim(codigo) = ''
 order by proyecto, descripcion;

-- @@ C_repetidos
select a.proyecto_id, a.proyecto, a.id as rubro_id, a.codigo, a.descripcion,
       a.cantidad_contrato, a.cantidad_ejecutada, a.es_orden_cambio, a.en_libro, a.en_planilla,
       count(*) over (partition by a.proyecto_id, btrim(a.codigo)) as veces
  from rubros_inv a
 where a.codigo is not null and btrim(a.codigo) <> ''
   and exists (select 1 from rubros_inv b
                where b.proyecto_id = a.proyecto_id and b.id <> a.id
                  and btrim(b.codigo) = btrim(a.codigo))
 order by a.proyecto, btrim(a.codigo), a.es_orden_cambio, a.descripcion;

-- @@ resumen
select proyecto_id, proyecto,
       count(*) as total_rubros,
       count(*) filter (where codigo ~ '^\d+\.\d+$'
                          and (codigo ~ '^\d+\.\d{5,}$' or codigo ~ '\.\d*(0{4,}|9{4,})\d*$')) as a_ruido,
       count(*) filter (where codigo is null or btrim(codigo) = '')                              as b_sin_codigo,
       count(*) filter (where codigo is not null and btrim(codigo) <> ''
                          and exists (select 1 from rubros_inv b
                                       where b.proyecto_id = a.proyecto_id and b.id <> a.id
                                         and btrim(b.codigo) = btrim(a.codigo)))               as c_repetidos
  from rubros_inv a
 group by proyecto_id, proyecto
 order by proyecto;
