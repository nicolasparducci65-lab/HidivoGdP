-- ============================================================================
-- Órdenes de cambio: aprobación atómica en la base (función oc_aprobar).
-- NO ejecutar automáticamente: revisar y aplicar a mano (SQL Editor o
-- `supabase db push`). Es independiente de 20260927_oc_preaplicada_y_contractual.sql
-- y se puede aplicar antes o después.
--
-- Por qué: la app aprobaba con varias llamadas sueltas (insertar rubros nuevos,
-- modificar cantidades, sellar la orden). PostgREST no ofrece transacción, así
-- que un fallo a medias dejaba el presupuesto tocado y la orden sin aprobar.
-- Dentro de una función todo ocurre en una sola transacción: o se aplica todo
-- o no se aplica nada.
--
-- Revisión 2026-11-05 (regla única de códigos, antes del índice único
-- rubros_proyecto_codigo_uniq (proyecto_id, codigo) WHERE codigo IS NOT NULL):
--   - Un ítem nuevo sin código recibe OC-NN-SS (NN = número de la orden, SS =
--     secuencial del ítem dentro de la orden, saltando los códigos ya usados en
--     la orden o en el proyecto), igual que el editor de la app; el código
--     generado se guarda también en orden_cambio_items para que el ítem y el
--     rubro coincidan. Antes todos recibían el mismo OC-NN y, con el índice,
--     una orden con dos ítems sin código no se podría aprobar.
--   - Antes de insertar rechaza con mensaje claro: código repetido en el
--     proyecto, código repetido dentro de la orden, código con más de 4
--     decimales o racha 0000/9999 (ruido de fórmula de Excel).
--
-- La app (SW v30+) llama a esta función si existe. Mientras no esté instalada,
-- aplica la aprobación desde el navegador, en el mismo orden y con reversión.
--
-- No crea tablas ni columnas y no modifica ningún dato al instalarse.
-- rubros.monto_contrato y rubros.total_produccion son columnas GENERADAS: la
-- función nunca las escribe.
-- ============================================================================

begin;

create or replace function public.oc_aprobar(
  p_orden_id uuid, p_oficio text, p_fecha date, p_archivo_url text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_oc public.ordenes_cambio%rowtype;
  v_codigo text;
  v_lista text;
  v_max_orden int;
  v_nuevos int := 0;
  v_modificados int := 0;
  v_item record;
  v_seq int := 0;
  v_cand text;
begin
  select * into v_oc from public.ordenes_cambio where id = p_orden_id for update;
  if not found then
    raise exception 'La orden de cambio no existe.' using errcode = 'P0002';
  end if;
  -- Mismos roles que hoy pueden aprobar desde la app (políticas ola1 de ordenes_cambio y rubros)
  if not (sst_es_admin_global() or coalesce(sst_rol_en_proyecto(v_oc.proyecto_id) in ('admin','fiscalizador'), false)) then
    raise exception 'Solo admin o fiscalizador del proyecto pueden aprobar una orden de cambio.' using errcode = '42501';
  end if;
  if v_oc.estado <> 'solicitada' then
    raise exception 'Solo se aprueba una orden solicitada (está %).', v_oc.estado using errcode = '23514';
  end if;
  if nullif(btrim(p_oficio), '') is null or p_fecha is null then
    raise exception 'Registra el N° de oficio y la fecha de aprobación.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.orden_cambio_items where orden_id = p_orden_id) then
    raise exception 'La orden no tiene ítems.' using errcode = '23514';
  end if;

  v_codigo := 'OC-' || lpad(v_oc.numero::text, 2, '0');

  -- ── Códigos de los ítems nuevos: los escritos, normalizados; los vacíos reciben OC-NN-SS ──
  drop table if exists _oc_codigos;
  create temporary table _oc_codigos (item_id uuid primary key, codigo text, generado boolean not null default false) on commit drop;
  insert into _oc_codigos (item_id, codigo)
  select id, nullif(regexp_replace(btrim(codigo), '\s+', ' ', 'g'), '')
    from public.orden_cambio_items where orden_id = p_orden_id and tipo = 'nuevo';

  for v_item in select item_id from _oc_codigos c
                 join public.orden_cambio_items i on i.id = c.item_id
                where c.codigo is null order by i.created_at, i.id loop
    loop
      v_seq := v_seq + 1;
      v_cand := v_codigo || '-' || lpad(v_seq::text, 2, '0');
      exit when not exists (select 1 from _oc_codigos where codigo = v_cand)
             and not exists (select 1 from public.rubros where proyecto_id = v_oc.proyecto_id and btrim(codigo) = v_cand);
    end loop;
    update _oc_codigos set codigo = v_cand, generado = true where item_id = v_item.item_id;
  end loop;

  -- Código con ruido de fórmula (más de 4 decimales o racha 0000/9999 al final)
  select string_agg(codigo, ', ') into v_lista from _oc_codigos
   where codigo ~ '^\d+(\.\d+)?$' and (codigo ~ '^\d+\.\d{5,}$' or codigo ~ '\.\d*(0{4,}|9{4,})\d*$');
  if v_lista is not null then
    raise exception 'Código con ruido de cálculo (máximo 4 decimales, sin rachas 0000/9999): %.', v_lista using errcode = '23514';
  end if;

  -- Código repetido dentro de la orden
  select string_agg(codigo, ', ') into v_lista from (select codigo from _oc_codigos group by codigo having count(*) > 1) x;
  if v_lista is not null then
    raise exception 'Código repetido dentro de la orden de cambio: %.', v_lista using errcode = '23505';
  end if;

  -- Código repetido en el proyecto: un rubro nuevo no puede repetir un código que ya existe
  select string_agg(distinct c.codigo, ', ') into v_lista
    from _oc_codigos c
    join public.rubros r on r.proyecto_id = v_oc.proyecto_id and btrim(r.codigo) = c.codigo;
  if v_lista is not null then
    raise exception 'Código repetido en el proyecto: %. Cambia el código del ítem o conviértelo en modificación de cantidad.', v_lista using errcode = '23505';
  end if;

  if exists (select 1 from public.orden_cambio_items
              where orden_id = p_orden_id and tipo = 'nuevo' and nullif(btrim(descripcion), '') is null) then
    raise exception 'Hay rubros nuevos sin descripción.' using errcode = '23514';
  end if;

  -- Las modificaciones deben apuntar a rubros del mismo proyecto
  if exists (select 1 from public.orden_cambio_items i
              left join public.rubros r on r.id = i.rubro_id and r.proyecto_id = v_oc.proyecto_id
              where i.orden_id = p_orden_id and i.tipo = 'modificacion' and r.id is null) then
    raise exception 'Una modificación apunta a un rubro que no existe en el proyecto.' using errcode = '23503';
  end if;

  -- Ninguna cantidad puede quedar negativa
  select string_agg(r.codigo || ' (' || (r.cantidad_contrato + d.delta) || ')', ', ') into v_lista
    from (select rubro_id, sum(cantidad) as delta
            from public.orden_cambio_items
           where orden_id = p_orden_id and tipo = 'modificacion'
           group by rubro_id) d
    join public.rubros r on r.id = d.rubro_id
   where r.cantidad_contrato + d.delta < 0;
  if v_lista is not null then
    raise exception 'La cantidad quedaría negativa en: %.', v_lista using errcode = '23514';
  end if;

  -- 0) Los códigos generados quedan también en los ítems de la orden
  update public.orden_cambio_items i
     set codigo = c.codigo
    from _oc_codigos c
   where c.item_id = i.id and c.generado;

  -- 1) Rubros nuevos
  select coalesce(max(orden), 0) into v_max_orden from public.rubros where proyecto_id = v_oc.proyecto_id;
  insert into public.rubros (proyecto_id, orden, codigo, descripcion, unidad,
                             cantidad_contrato, precio_unitario, cantidad_ejecutada,
                             es_orden_cambio, orden_cambio_codigo, orden_cambio_id)
  select v_oc.proyecto_id,
         v_max_orden + row_number() over (order by i.created_at, i.id),
         c.codigo, i.descripcion, nullif(btrim(i.unidad), ''),
         i.cantidad, i.precio_unitario, 0,
         true, v_codigo, p_orden_id
    from public.orden_cambio_items i
    join _oc_codigos c on c.item_id = i.id
   where i.orden_id = p_orden_id and i.tipo = 'nuevo';
  get diagnostics v_nuevos = row_count;

  -- 2) Modificaciones de cantidad (el precio no cambia)
  update public.rubros r
     set cantidad_contrato = r.cantidad_contrato + d.delta, updated_at = now()
    from (select rubro_id, sum(cantidad) as delta
            from public.orden_cambio_items
           where orden_id = p_orden_id and tipo = 'modificacion'
           group by rubro_id) d
   where r.id = d.rubro_id;
  get diagnostics v_modificados = row_count;

  -- 3) Estado de la orden
  update public.ordenes_cambio
     set estado = 'aprobada', oficio_referencia = btrim(p_oficio), fecha_aprobacion = p_fecha,
         aprobado_por = auth.uid(), archivo_url = coalesce(p_archivo_url, archivo_url)
   where id = p_orden_id;

  -- Historial, si la tabla ya existe (la crea la otra migración)
  if to_regclass('public.orden_cambio_historial') is not null then
    execute 'insert into public.orden_cambio_historial (orden_id, accion, comentario, autor_id) values ($1, $2, $3, $4)'
      using p_orden_id, 'Aprobada y aplicada al presupuesto',
            'Oficio ' || btrim(p_oficio) || ': ' || v_nuevos || ' rubro(s) nuevo(s), ' || v_modificados || ' modificado(s)', auth.uid();
  end if;

  drop table if exists _oc_codigos;
  return jsonb_build_object('orden', v_codigo, 'rubros_nuevos', v_nuevos, 'rubros_modificados', v_modificados);
end $$;

revoke all on function public.oc_aprobar(uuid, text, date, text) from public, anon;
grant execute on function public.oc_aprobar(uuid, text, date, text) to authenticated;

commit;

-- ── Verificación (solo lectura, salvo la nota del punto 3) ───────────────────
-- 1) La función existe y solo la ejecuta un usuario autenticado:
--   select proname, prosecdef from pg_proc where proname = 'oc_aprobar';                      -- 1 fila, prosecdef = true
--   select has_function_privilege('anon', 'public.oc_aprobar(uuid,text,date,text)', 'execute');  -- false
--
-- 2) Rechazos que no escriben nada (consola del navegador, con sesión de fiscalizador):
--   (await sb.rpc('oc_aprobar', { p_orden_id: '<orden en borrador>', p_oficio: 'x', p_fecha: '2026-09-27' })).error?.code   // '23514'
--   (await sb.rpc('oc_aprobar', { p_orden_id: '<orden solicitada>', p_oficio: '',  p_fecha: '2026-09-27' })).error?.code   // '23514'
--   Con un ítem nuevo cuyo código ya exista en el proyecto:                                                                // '23505' «Código repetido en el proyecto: X»
--   Con sesión de residente o de un miembro de otro proyecto:                                                              // '42501'
--
-- 3) Una aprobación real SÍ escribe y no tiene vuelta atrás desde la app. Probarla solo con la
--    orden que se quiere aprobar. Después:
--   select estado, oficio_referencia, fecha_aprobacion from ordenes_cambio where id = '<orden>';           -- aprobada
--   select count(*) from rubros where orden_cambio_id = '<orden>';                                          -- = ítems nuevos de la orden
--   select codigo from rubros where orden_cambio_id = '<orden>' order by orden;                             -- los ítems sin código salen OC-NN-SS
--   select round(sum(monto_contrato), 2) from rubros where orden_cambio_id = '<orden>';                     -- = suma de los ítems nuevos

-- ── Reversión ────────────────────────────────────────────────────────────────
-- Quitar la función no deshace aprobaciones ya hechas; la app vuelve a aprobar desde el navegador
-- (con la misma regla de códigos). Para volver a la versión anterior de la función, reaplicar el
-- archivo del commit 671a124 del repo.
--   drop function if exists public.oc_aprobar(uuid, text, date, text);
