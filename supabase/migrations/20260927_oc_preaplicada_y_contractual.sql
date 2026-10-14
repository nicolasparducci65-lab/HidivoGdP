-- ============================================================================
-- Órdenes de cambio: valores contractuales de los rubros, historial de la
-- orden, "devolver a borrador" y "aprobar con impactos ya aplicados".
-- NO ejecutar automáticamente: revisar y aplicar a mano (SQL Editor o
-- `supabase db push`). Todo va en una transacción: si algo falla, no queda nada.
--
-- Qué hace:
--   1) rubros.cantidad_contractual / rubros.precio_contractual: lo firmado en
--      el contrato. cantidad_contrato / precio_unitario siguen siendo lo VIGENTE.
--      NULL = el rubro no es contractual (nació de una orden de cambio).
--   2) Migración de datos:
--        - Parqueadero Adoquinado: rubros 1 a 57 desde el presupuesto firmado
--          (precios a 4 decimales); los OC-01-01 a OC-01-19 quedan NULL.
--        - Resto de proyectos: desde los valores vigentes.
--   3) Triggers en rubros: al insertar un rubro contractual se copian los valores
--      vigentes; después solo un admin global puede corregir lo contractual.
--   4) ordenes_cambio.impactos_preaplicados + justificacion_preaplicacion.
--   5) orden_cambio_historial (solo lectura e inserción; nunca se edita ni borra).
--   6) Guard en ordenes_cambio: devolver a borrador y marcar impactos
--      preaplicados solo ocurren dentro de las funciones de abajo.
--   7) Funciones (solo admin): oc_devolver_a_borrador, oc_aprobar_preaplicada,
--      y oc_descuadres_preaplicada (la comparación; un descuadre BLOQUEA).
--
-- Qué NO hace: no cambia cantidad_contrato, precio_unitario ni monto_contrato
-- de ningún rubro, ni el estado ni los ítems de ninguna orden existente.
--
-- ORDEN DE APLICACIÓN: primero supabase/limpieza/20260927_parqueadero_limpieza.sql
-- (deja el precio vigente de Parqueadero igual al firmado) y después esta migración.
-- ESTADO: BLOQUEADA hasta cargar el presupuesto firmado (bloque PRESUPUESTO FIRMADO).
-- ============================================================================

begin;

-- ── 1) Columnas contractuales en rubros ─────────────────────────────────────
alter table public.rubros
  add column if not exists cantidad_contractual numeric,
  add column if not exists precio_contractual   numeric;

comment on column public.rubros.cantidad_contractual is 'Cantidad firmada en el contrato. NULL = rubro no contractual (nació de una orden de cambio). cantidad_contrato es la cantidad VIGENTE.';
comment on column public.rubros.precio_contractual   is 'Precio unitario firmado en el contrato. NULL = rubro no contractual. precio_unitario es el precio VIGENTE.';

-- ── 2) Migración de datos ───────────────────────────────────────────────────
-- Los triggers del paso 3 se crean DESPUÉS de estos UPDATE, así que no interfieren.

-- 2a) Todos los proyectos menos Parqueadero: lo vigente pasa a ser lo contractual,
--     salvo los rubros marcados como nacidos de una orden de cambio.
update public.rubros r
   set cantidad_contractual = r.cantidad_contrato,
       precio_contractual   = r.precio_unitario
 where r.proyecto_id <> 'abf1515f-27dc-4db1-8059-2ac9e14a11f7'
   and coalesce(r.es_orden_cambio, false) = false
   and r.cantidad_contractual is null
   and r.precio_contractual is null;

-- 2b) Parqueadero Adoquinado: presupuesto firmado, 57 rubros con precio a 4 decimales,
--     emparejado por código. El bloque lo rellena
--     supabase/herramientas/cargar_presupuesto_firmado.py tras validar el Excel.
--     Mientras diga PENDIENTE, el guard de abajo aborta toda la migración.
create temporary table _firmado (codigo text primary key, cantidad numeric not null, precio numeric not null) on commit drop;

insert into _firmado (codigo, cantidad, precio) values
-- >>> PRESUPUESTO FIRMADO
    ('PENDIENTE', 0, 0)
-- <<< PRESUPUESTO FIRMADO
;

update public.rubros r
   set cantidad_contractual = c.cantidad,
       precio_contractual   = c.precio
  from _firmado c
 where r.proyecto_id = 'abf1515f-27dc-4db1-8059-2ac9e14a11f7'
   and r.codigo = c.codigo;

-- La migración se detiene si Parqueadero no quedó con exactamente 57 rubros contractuales
-- o si su suma no es exactamente el monto del contrato.
do $$
declare v_n int; v_suma numeric;
begin
  select count(*), round(sum(cantidad_contractual * precio_contractual), 2)
    into v_n, v_suma
    from public.rubros
   where proyecto_id = 'abf1515f-27dc-4db1-8059-2ac9e14a11f7'
     and cantidad_contractual is not null;
  if v_n <> 57 then
    raise exception 'Parqueadero: se esperaban 57 rubros contractuales y hay %', v_n;
  end if;
  if v_suma <> 462685.00 then
    raise exception 'Parqueadero: la suma contractual debe ser exactamente 462685.00 y es %', v_suma;
  end if;
end $$;

-- ── 3) Triggers de los valores contractuales ────────────────────────────────
-- Alta: un rubro que no nace de una orden de cambio es contractual; si no trae
-- valores contractuales, se copian los vigentes.
create or replace function public.rubros_contractual_al_insertar()
returns trigger language plpgsql as $$
begin
  if coalesce(new.es_orden_cambio, false) = false then
    new.cantidad_contractual := coalesce(new.cantidad_contractual, new.cantidad_contrato);
    new.precio_contractual   := coalesce(new.precio_contractual,   new.precio_unitario);
  end if;
  return new;
end $$;

drop trigger if exists trg_rubros_contractual_insert on public.rubros;
create trigger trg_rubros_contractual_insert
  before insert on public.rubros
  for each row execute function public.rubros_contractual_al_insertar();

-- Cambio: lo contractual no se toca desde la app. Solo un admin global puede
-- corregirlo (por ejemplo, para cargar los precios de 4 decimales).
create or replace function public.rubros_contractual_inmutable()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null
     or coalesce(current_setting('hidivo.oc_funcion', true), '') = '1' then
    return new;  -- contextos de confianza (SQL Editor, service_role) y funciones de órdenes de cambio
  end if;
  if (new.cantidad_contractual is distinct from old.cantidad_contractual
      or new.precio_contractual is distinct from old.precio_contractual)
     and not sst_es_admin_global() then
    raise exception 'La cantidad y el precio contractuales no se pueden modificar. Un cambio al contrato se registra con una orden de cambio.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_rubros_contractual_inmutable on public.rubros;
create trigger trg_rubros_contractual_inmutable
  before update on public.rubros
  for each row execute function public.rubros_contractual_inmutable();

-- ── 4) Columnas de la orden de cambio ───────────────────────────────────────
alter table public.ordenes_cambio
  add column if not exists impactos_preaplicados      boolean not null default false,
  add column if not exists justificacion_preaplicacion text;

alter table public.ordenes_cambio
  drop constraint if exists ordenes_cambio_preaplicada_justificada;
alter table public.ordenes_cambio
  add constraint ordenes_cambio_preaplicada_justificada
  check (not impactos_preaplicados
         or (estado = 'aprobada' and nullif(btrim(justificacion_preaplicacion), '') is not null));

-- ── 5) Historial de la orden de cambio ──────────────────────────────────────
create table if not exists public.orden_cambio_historial (
  id          uuid primary key default gen_random_uuid(),
  orden_id    uuid not null references public.ordenes_cambio(id) on delete cascade,
  accion      text not null,
  comentario  text,
  autor_id    uuid references public.perfiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists orden_cambio_historial_orden_idx on public.orden_cambio_historial (orden_id, created_at);

alter table public.orden_cambio_historial enable row level security;

drop policy if exists och_select on public.orden_cambio_historial;
create policy och_select on public.orden_cambio_historial
  for select to authenticated
  using (exists (select 1 from public.ordenes_cambio oc
                  where oc.id = orden_cambio_historial.orden_id
                    and ((select sst_es_admin_global())
                         or sst_rol_en_proyecto(oc.proyecto_id) in ('admin','fiscalizador'))));

drop policy if exists och_insert on public.orden_cambio_historial;
create policy och_insert on public.orden_cambio_historial
  for insert to authenticated
  with check (autor_id = auth.uid()
              and exists (select 1 from public.ordenes_cambio oc
                           where oc.id = orden_cambio_historial.orden_id
                             and ((select sst_es_admin_global())
                                  or sst_rol_en_proyecto(oc.proyecto_id) in ('admin','fiscalizador'))));
-- Sin políticas UPDATE ni DELETE: el historial no se edita ni se borra desde la app.

-- ── 6) Guard de la orden de cambio ──────────────────────────────────────────
-- La política ola1_update deja al fiscalizador modificar la orden, y RLS no
-- distingue columnas ni transiciones. Este trigger exige que devolver a borrador
-- y marcar impactos preaplicados ocurran DENTRO de las funciones del paso 7
-- (que validan el rol, comparan y escriben el historial).
create or replace function public.ordenes_cambio_guard()
returns trigger language plpgsql as $$
declare v_funcion boolean := coalesce(current_setting('hidivo.oc_funcion', true), '') = '1';
begin
  if auth.uid() is null or v_funcion then
    return new;
  end if;
  if old.estado = 'solicitada' and new.estado = 'borrador' then
    raise exception 'Devolver una orden a borrador es una acción del administrador y queda en el historial.'
      using errcode = '42501';
  end if;
  if new.impactos_preaplicados is distinct from old.impactos_preaplicados
     or new.justificacion_preaplicacion is distinct from old.justificacion_preaplicacion then
    raise exception 'Los impactos preaplicados solo se registran al aprobar la orden con esa opción.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_ordenes_cambio_guard on public.ordenes_cambio;
create trigger trg_ordenes_cambio_guard
  before update on public.ordenes_cambio
  for each row execute function public.ordenes_cambio_guard();

-- ── 7) Funciones ────────────────────────────────────────────────────────────
create or replace function public.oc_es_admin(p_proyecto_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select sst_es_admin_global() or coalesce(sst_rol_en_proyecto(p_proyecto_id) = 'admin', false);
$$;

-- 7a) Devolver a borrador (solo admin, desde 'solicitada', comentario obligatorio).
create or replace function public.oc_devolver_a_borrador(p_orden_id uuid, p_comentario text)
returns void language plpgsql security definer set search_path = public as $$
declare v_oc public.ordenes_cambio%rowtype;
begin
  select * into v_oc from public.ordenes_cambio where id = p_orden_id for update;
  if not found then
    raise exception 'La orden de cambio no existe.' using errcode = 'P0002';
  end if;
  if not oc_es_admin(v_oc.proyecto_id) then
    raise exception 'Solo un administrador puede devolver una orden a borrador.' using errcode = '42501';
  end if;
  if v_oc.estado <> 'solicitada' then
    raise exception 'Solo se devuelve a borrador una orden solicitada (está %).', v_oc.estado using errcode = '23514';
  end if;
  if nullif(btrim(p_comentario), '') is null then
    raise exception 'Indica el motivo de la devolución.' using errcode = '23514';
  end if;

  perform set_config('hidivo.oc_funcion', '1', true);
  update public.ordenes_cambio set estado = 'borrador' where id = p_orden_id;
  perform set_config('hidivo.oc_funcion', '', true);

  insert into public.orden_cambio_historial (orden_id, accion, comentario, autor_id)
  values (p_orden_id, 'Devuelta a borrador', btrim(p_comentario), auth.uid());
end $$;

-- 7b) Comparación: ¿el presupuesto vigente ya refleja exactamente esta orden?
--     p_enlaces: [{"item_id":"<uuid>","rubro_id":"<uuid>"}] para los ítems de tipo 'nuevo'.
--     Devuelve un arreglo JSON de descuadres; vacío = todo cuadra.
--       Modificación: precio vigente = precio contractual, y cantidad vigente =
--                     contractual + deltas de órdenes ya aprobadas + delta de esta.
--       Ítem nuevo:   cantidad y precio del rubro enlazado = los del ítem (4 decimales).
create or replace function public.oc_descuadres_preaplicada(p_orden_id uuid, p_enlaces jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_oc public.ordenes_cambio%rowtype; v_res jsonb;
begin
  select * into v_oc from public.ordenes_cambio where id = p_orden_id;
  if not found then
    raise exception 'La orden de cambio no existe.' using errcode = 'P0002';
  end if;
  if not (sst_es_admin_global() or sst_rol_en_proyecto(v_oc.proyecto_id) in ('admin','fiscalizador')) then
    raise exception 'Sin acceso a esta orden de cambio.' using errcode = '42501';
  end if;

  with enlaces as (
    select e.item_id, e.rubro_id
      from jsonb_to_recordset(coalesce(p_enlaces, '[]'::jsonb)) as e(item_id uuid, rubro_id uuid)
  ),
  nuevos as (
    select i.id as item_id, i.codigo, i.descripcion, i.cantidad, i.precio_unitario, e.rubro_id, r.id as rubro_ok,
           r.codigo as rubro_codigo, r.proyecto_id, r.cantidad_contrato, r.precio_unitario as precio_vigente,
           r.orden_cambio_id,
           (select count(*) from enlaces e2 where e2.item_id = i.id)      as n_enlaces,
           (select count(*) from enlaces e3 where e3.rubro_id = e.rubro_id) as n_usos
      from public.orden_cambio_items i
      left join enlaces e on e.item_id = i.id
      left join public.rubros r on r.id = e.rubro_id
     where i.orden_id = p_orden_id and i.tipo = 'nuevo'
  ),
  d_nuevos as (
    select jsonb_build_object(
             'tipo', 'nuevo', 'item_id', item_id, 'codigo', coalesce(rubro_codigo, codigo),
             'descripcion', descripcion,
             'motivo', case
               when n_enlaces = 0 then 'El ítem no está enlazado con ningún rubro'
               when n_enlaces > 1 then 'El ítem está enlazado más de una vez'
               when rubro_ok is null then 'El rubro enlazado no existe'
               when proyecto_id <> v_oc.proyecto_id then 'El rubro enlazado es de otro proyecto'
               when n_usos > 1 then 'El mismo rubro está enlazado con más de un ítem'
               when orden_cambio_id is not null and orden_cambio_id <> p_orden_id then 'El rubro ya pertenece a otra orden de cambio'
               when round(cantidad_contrato - cantidad, 4) <> 0 then 'La cantidad vigente del rubro no es la del ítem'
               else 'El precio vigente del rubro no es el del ítem' end,
             'cantidad_orden', cantidad, 'cantidad_vigente', cantidad_contrato,
             'precio_orden', precio_unitario, 'precio_vigente', precio_vigente) as d
      from nuevos
     where n_enlaces <> 1 or rubro_ok is null or proyecto_id <> v_oc.proyecto_id or n_usos > 1
        or (orden_cambio_id is not null and orden_cambio_id <> p_orden_id)
        or round(cantidad_contrato - cantidad, 4) <> 0
        or round(precio_vigente - precio_unitario, 4) <> 0
  ),
  mods as (
    select r.id, r.codigo, r.descripcion, r.cantidad_contractual, r.cantidad_contrato,
           r.precio_contractual, r.precio_unitario as precio_vigente,
           sum(i.cantidad) as delta_orden,
           coalesce((select sum(i2.cantidad)
                       from public.orden_cambio_items i2
                       join public.ordenes_cambio o2 on o2.id = i2.orden_id
                      where i2.rubro_id = r.id and i2.tipo = 'modificacion'
                        and o2.estado = 'aprobada' and o2.id <> p_orden_id), 0) as delta_previo
      from public.orden_cambio_items i
      join public.rubros r on r.id = i.rubro_id
     where i.orden_id = p_orden_id and i.tipo = 'modificacion'
     group by r.id
  ),
  d_mods as (
    select jsonb_build_object(
             'tipo', 'modificacion', 'rubro_id', id, 'codigo', codigo, 'descripcion', descripcion,
             'motivo', case when cantidad_contractual is null or precio_contractual is null
                            then 'El rubro no tiene cantidad o precio contractual'
                            when round(precio_vigente - precio_contractual, 4) <> 0
                            then 'El precio vigente del rubro no es el contractual'
                            else 'La cantidad vigente no es la contractual más los cambios aprobados y los de esta orden' end,
             'precio_contractual', precio_contractual, 'precio_vigente', precio_vigente,
             'cantidad_contractual', cantidad_contractual, 'delta_ordenes_aprobadas', delta_previo,
             'delta_orden', delta_orden, 'cantidad_esperada', cantidad_contractual + delta_previo + delta_orden,
             'cantidad_vigente', cantidad_contrato,
             'descuadre', cantidad_contrato - (cantidad_contractual + delta_previo + delta_orden)) as d
      from mods
     where cantidad_contractual is null or precio_contractual is null
        or round(precio_vigente - precio_contractual, 4) <> 0
        or round(cantidad_contrato - (cantidad_contractual + delta_previo + delta_orden), 4) <> 0
  ),
  d_huerfanos as (
    select jsonb_build_object('tipo', 'enlace', 'item_id', e.item_id,
                              'motivo', 'El enlace apunta a un ítem que no es un rubro nuevo de esta orden') as d
      from enlaces e
     where not exists (select 1 from public.orden_cambio_items i
                        where i.id = e.item_id and i.orden_id = p_orden_id and i.tipo = 'nuevo')
  )
  select coalesce(jsonb_agg(d), '[]'::jsonb) into v_res
    from (select d from d_nuevos union all select d from d_mods union all select d from d_huerfanos) t;

  return v_res;
end $$;

-- 7c) Aprobar con impactos ya aplicados en el presupuesto (solo admin).
--     No cambia cantidades, precios ni montos de ningún rubro: enlaza, marca y sella.
create or replace function public.oc_aprobar_preaplicada(
  p_orden_id uuid, p_justificacion text, p_oficio text, p_fecha date,
  p_enlaces jsonb, p_archivo_url text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_oc public.ordenes_cambio%rowtype;
  v_codigo text;
  v_descuadres jsonb;
  v_enlazados int;
begin
  select * into v_oc from public.ordenes_cambio where id = p_orden_id for update;
  if not found then
    raise exception 'La orden de cambio no existe.' using errcode = 'P0002';
  end if;
  if not oc_es_admin(v_oc.proyecto_id) then
    raise exception 'Solo un administrador puede aprobar con impactos ya aplicados.' using errcode = '42501';
  end if;
  if v_oc.estado <> 'solicitada' then
    raise exception 'Solo se aprueba una orden solicitada (está %).', v_oc.estado using errcode = '23514';
  end if;
  if nullif(btrim(p_justificacion), '') is null then
    raise exception 'La justificación es obligatoria.' using errcode = '23514';
  end if;
  if nullif(btrim(p_oficio), '') is null or p_fecha is null then
    raise exception 'Registra el N° de oficio y la fecha de aprobación.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.orden_cambio_items where orden_id = p_orden_id) then
    raise exception 'La orden no tiene ítems.' using errcode = '23514';
  end if;

  v_descuadres := oc_descuadres_preaplicada(p_orden_id, p_enlaces);
  if jsonb_array_length(v_descuadres) > 0 then
    raise exception 'El presupuesto vigente no coincide con la orden en % punto(s). Devuelve la orden a borrador, corrígela y vuelve a solicitarla.',
      jsonb_array_length(v_descuadres)
      using errcode = '23514', detail = v_descuadres::text;
  end if;

  v_codigo := 'OC-' || lpad(v_oc.numero::text, 2, '0');
  perform set_config('hidivo.oc_funcion', '1', true);

  with enlaces as (
    select e.item_id, e.rubro_id
      from jsonb_to_recordset(coalesce(p_enlaces, '[]'::jsonb)) as e(item_id uuid, rubro_id uuid)
  ), it as (
    update public.orden_cambio_items i
       set rubro_id = e.rubro_id,
           codigo   = coalesce(nullif(btrim(i.codigo), ''), r.codigo)
      from enlaces e
      join public.rubros r on r.id = e.rubro_id
     where i.id = e.item_id and i.orden_id = p_orden_id and i.tipo = 'nuevo'
    returning e.rubro_id
  )
  update public.rubros r
     set es_orden_cambio = true, orden_cambio_codigo = v_codigo, orden_cambio_id = p_orden_id,
         cantidad_contractual = null, precio_contractual = null
    from it
   where r.id = it.rubro_id;
  get diagnostics v_enlazados = row_count;

  update public.ordenes_cambio
     set estado = 'aprobada', oficio_referencia = btrim(p_oficio), fecha_aprobacion = p_fecha,
         aprobado_por = auth.uid(), archivo_url = coalesce(p_archivo_url, archivo_url),
         impactos_preaplicados = true, justificacion_preaplicacion = btrim(p_justificacion)
   where id = p_orden_id;
  perform set_config('hidivo.oc_funcion', '', true);

  insert into public.orden_cambio_historial (orden_id, accion, comentario, autor_id)
  values (p_orden_id, 'Aprobada con impactos ya aplicados en el presupuesto', btrim(p_justificacion), auth.uid());

  return jsonb_build_object('orden', v_codigo, 'rubros_enlazados', v_enlazados);
end $$;

revoke all on function public.oc_es_admin(uuid)                                        from public, anon;
revoke all on function public.oc_devolver_a_borrador(uuid, text)                       from public, anon;
revoke all on function public.oc_descuadres_preaplicada(uuid, jsonb)                   from public, anon;
revoke all on function public.oc_aprobar_preaplicada(uuid, text, text, date, jsonb, text) from public, anon;
grant execute on function public.oc_es_admin(uuid)                                        to authenticated;
grant execute on function public.oc_devolver_a_borrador(uuid, text)                       to authenticated;
grant execute on function public.oc_descuadres_preaplicada(uuid, jsonb)                   to authenticated;
grant execute on function public.oc_aprobar_preaplicada(uuid, text, text, date, jsonb, text) to authenticated;

commit;

-- ── Verificación (solo lectura; ejecutar después de aplicar) ─────────────────
-- 1) Parqueadero: 57 rubros contractuales, 19 sin valores contractuales, suma del Excel.
--   select count(*) filter (where cantidad_contractual is not null) contractuales,       -- 57
--          count(*) filter (where cantidad_contractual is null) no_contractuales,        -- 19
--          round(sum(cantidad_contractual * precio_contractual), 2) suma_contractual,    -- 462685.00
--          round(sum(monto_contrato), 2) suma_vigente                                    -- igual que antes de migrar
--     from rubros where proyecto_id = 'abf1515f-27dc-4db1-8059-2ac9e14a11f7';
--
-- 2) Parqueadero, rubros 6, 7 y 8:
--   select codigo, cantidad_contractual, precio_contractual, cantidad_contrato, precio_unitario
--     from rubros where proyecto_id = 'abf1515f-27dc-4db1-8059-2ac9e14a11f7' and codigo in ('6','7','8') order by orden;
--   -- tras la limpieza, precio_contractual = precio_unitario en los tres (6.9776 / 3.5168 / 28.3584 según OC-01);
--   -- cantidades contractuales esperadas 4205.46 / 3534 / 1767 si el firmado coincide con el Excel del 9 de junio.
--   select count(*) from rubros where proyecto_id = 'abf1515f-27dc-4db1-8059-2ac9e14a11f7'
--      and cantidad_contractual is not null and round(precio_unitario - precio_contractual, 4) <> 0;   -- 0
--
-- 3) Resto de proyectos: contractual = vigente; solo quedan sin contractual los marcados como OC.
--   select count(*) filter (where cantidad_contractual is distinct from cantidad_contrato
--                              or precio_contractual is distinct from precio_unitario) distintos,   -- 0
--          count(*) filter (where cantidad_contractual is null) sin_contractual                     -- 0
--     from rubros where proyecto_id <> 'abf1515f-27dc-4db1-8059-2ac9e14a11f7' and coalesce(es_orden_cambio,false) = false;
--
-- 4) Nada vigente cambió: la suma global debe ser la misma antes y después de aplicar.
--   select round(sum(monto_contrato), 2), round(sum(cantidad_contrato * precio_unitario), 2) from rubros;
--
-- 5) Órdenes intactas y columnas nuevas en su valor por defecto:
--   select numero, estado, monto_total, impactos_preaplicados, justificacion_preaplicacion from ordenes_cambio;
--   -- OC-01 de Parqueadero: solicitada, 43447.345216, false, null
--
-- 6) OC-01 contra el presupuesto vigente (con sesión de admin o fiscalizador, consola del navegador):
--   (await sb.rpc('oc_descuadres_preaplicada', { p_orden_id: '4c072bc1-c36d-47a8-81de-7275bc50e488', p_enlaces: [] })).data
--   -- La OC-01 actual (6 ítems) no cuadra: 3 ítems nuevos sin enlazar y los rubros 6, 7 y 8 con otra cantidad.
--   -- Se rehace en borrador con la plantilla de importación completa.
--
-- 7) Reglas (consola del navegador; R = id de un rubro, O = id de una orden solicitada):
--   (await sb.from('rubros').update({precio_contractual: 1}).eq('id', R)).error?.code     // '42501' salvo admin global
--   (await sb.from('ordenes_cambio').update({estado:'borrador'}).eq('id', O)).error?.code  // '42501' para cualquier rol
--   (await sb.from('ordenes_cambio').update({impactos_preaplicados:true, justificacion_preaplicacion:'x'}).eq('id', O)).error?.code  // '42501'
--   (await sb.rpc('oc_devolver_a_borrador', { p_orden_id: O, p_comentario: 'prueba' })).error   // fiscalizador: 42501; admin: null
--   (await sb.from('orden_cambio_historial').select('*').eq('orden_id', O)).data               // la entrada de la devolución

-- ── Reversión ────────────────────────────────────────────────────────────────
-- Pierde el historial de órdenes y los valores contractuales cargados. Una orden ya
-- aprobada con impactos preaplicados sigue aprobada y sus rubros siguen enlazados
-- (rubro_id del ítem y marca de OC en el rubro), pero se pierde la marca y la justificación.
--
-- begin;
--   revoke execute on function public.oc_aprobar_preaplicada(uuid, text, text, date, jsonb, text) from authenticated;
--   drop function if exists public.oc_aprobar_preaplicada(uuid, text, text, date, jsonb, text);
--   drop function if exists public.oc_descuadres_preaplicada(uuid, jsonb);
--   drop function if exists public.oc_devolver_a_borrador(uuid, text);
--   drop function if exists public.oc_es_admin(uuid);
--   drop trigger  if exists trg_ordenes_cambio_guard on public.ordenes_cambio;
--   drop function if exists public.ordenes_cambio_guard();
--   drop table    if exists public.orden_cambio_historial;
--   alter table public.ordenes_cambio drop constraint if exists ordenes_cambio_preaplicada_justificada;
--   alter table public.ordenes_cambio drop column if exists impactos_preaplicados,
--                                     drop column if exists justificacion_preaplicacion;
--   drop trigger  if exists trg_rubros_contractual_inmutable on public.rubros;
--   drop trigger  if exists trg_rubros_contractual_insert on public.rubros;
--   drop function if exists public.rubros_contractual_inmutable();
--   drop function if exists public.rubros_contractual_al_insertar();
--   alter table public.rubros drop column if exists cantidad_contractual,
--                             drop column if exists precio_contractual;
-- commit;
