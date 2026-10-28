-- Verificación cruzada del Libro de Obra (SOLO LECTURA, no corrige nada).
-- Por rubro de todos los proyectos:
--   acumulado_por_registros = suma de libro_obra_rubros.cantidad_dia (es el "Acum. a la fecha"
--                             del último registro del rubro, mismas filas que la app);
--   cantidad_ejecutada      = lo que lleva rubros.cantidad_ejecutada;
--   diferencia              = acumulado_por_registros − cantidad_ejecutada (debería ser 0);
--   supera_contrato_en      = cuánto excede el acumulado la cantidad contractual vigente (null si no excede).
-- Lista solo los rubros con diferencia distinta de 0 o que superan el contrato.
--
-- Una línea, igual en PowerShell y Bash (desde la raíz del repo):
--   supabase db query --linked -o json -f tests/herramientas/verificar-acumulados.sql
-- (en Bash, para quedarse solo con el JSON: ... | sed -n '/^{/,/^}/p'). Pasar el texto como
-- argumento no sirve: el archivo empieza por "--" y el CLI lo toma por una bandera.
select p.nombre as proyecto,
       r.codigo,
       r.descripcion,
       r.unidad,
       coalesce(s.suma, 0)                                             as acumulado_por_registros,
       r.cantidad_ejecutada,
       round(coalesce(s.suma, 0) - coalesce(r.cantidad_ejecutada, 0), 4) as diferencia,
       r.cantidad_contrato,
       case when r.cantidad_contrato > 0 and coalesce(s.suma, 0) > r.cantidad_contrato
            then round(coalesce(s.suma, 0) - r.cantidad_contrato, 4) end as supera_contrato_en
  from rubros r
  join proyectos p on p.id = r.proyecto_id
  left join (select rubro_id, sum(cantidad_dia) as suma
               from libro_obra_rubros
              group by rubro_id) s on s.rubro_id = r.id
 where round(coalesce(s.suma, 0) - coalesce(r.cantidad_ejecutada, 0), 4) <> 0
    or (r.cantidad_contrato > 0 and coalesce(s.suma, 0) > r.cantidad_contrato)
 order by p.nombre, r.orden, r.codigo;
