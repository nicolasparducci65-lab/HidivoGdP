-- ============================================================================
-- PÁGINA DEL PLANO EN PUNTOS 360 Y PINES DE OBSERVACIONES
-- NO se ejecuta automáticamente: revisar y aplicar a mano en el SQL Editor, como
-- la 20260922. El cliente que la usa (index.html, js/recorridos360.js) NO debe
-- publicarse antes de aplicarla; si se publicara, sigue funcionando en página 1
-- y rechaza con aviso colocar marcas en otra página.
--
-- Inventario previo (2026-09-29, solo lectura): 18 planos, 8 PDF, los 8 de UNA
-- sola página; 1 pin de observación (OT Morgue) y 25 puntos 360 (Residencia
-- Médica 13, Hematología 10, PRUEBAS RLS 2), todos sobre PDF de una página.
-- Ninguna marca existente está en una página distinta de la 1: el relleno a
-- página 1 de abajo es exacto.
--
-- Problema: los tres visores de planos navegan páginas de un PDF
--   · Observaciones › Planos        (index.html: renderizarPDF / cambiarPaginaPDF)
--   · selector de pin de una observación (index.html: _selPinPdf)
--   · mini-mapa de Recorridos 360   (js/recorridos360.js: r360PdfPagina)
-- pero ni observaciones (plano_id, pin_x, pin_y) ni puntos_360 (plano_id, x, y)
-- guardan en QUÉ página se puso la marca. Hoy una marca puesta en la página 3
-- se dibuja igual en todas las páginas, y el emparejamiento entre fechas de
-- Recorridos 360 junta puntos de páginas distintas si coinciden en x/y.
--
-- Esta migración solo añade las columnas y ajusta los dos triggers de
-- puntos_360. No cambia ninguna política RLS. Es compatible hacia atrás: el
-- cliente actual no envía `pagina` / `pin_pagina` y sigue funcionando (todo
-- queda en página 1, que es lo que ya ocurre en los planos de una sola página).
-- ============================================================================

-- 1) Recorridos 360 -----------------------------------------------------------
alter table public.puntos_360
  add column if not exists pagina integer not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'puntos_360_pagina_chk') then
    alter table public.puntos_360 add constraint puntos_360_pagina_chk check (pagina >= 1);
  end if;
end $$;
comment on column public.puntos_360.pagina is
  'Página del plano (PDF) sobre la que están x/y; 1 en planos de imagen o de una sola página.';

-- El emparejamiento consulta por plano + página + caja x/y
create index if not exists puntos_360_plano_pagina_idx on public.puntos_360 (plano_id, pagina);

-- Trigger B: la página es parte de la POSICIÓN → se congela al publicar.
-- (Cuerpo idéntico al de 20260922 más la línea `new.pagina`.)
create or replace function public.p360_b_guard_publicado()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_estado text; v_estado_dest text; es_admin boolean;
begin
  if auth.uid() is null then return new; end if;   -- service role / mantenimiento
  if sst_es_admin_global() then return new; end if;
  if tg_op = 'INSERT' then
    select estado into v_estado from public.recorridos_360 where id = new.recorrido_id;
    if v_estado = 'publicado' and coalesce(sst_rol_en_proyecto(new.proyecto_id), '') <> 'admin' then
      raise exception 'El recorrido está publicado: solo un administrador puede añadir puntos.' using errcode = '42501';
    end if;
    return new;
  end if;
  es_admin := coalesce(sst_rol_en_proyecto(old.proyecto_id), '') = 'admin';
  select estado into v_estado from public.recorridos_360 where id = old.recorrido_id;
  if v_estado = 'publicado' and not es_admin and (
       new.recorrido_id  is distinct from old.recorrido_id
    or new.plano_id      is distinct from old.plano_id
    or new.pagina        is distinct from old.pagina          -- NUEVO
    or new.x             is distinct from old.x
    or new.y             is distinct from old.y
    or new.waypoint      is distinct from old.waypoint
    or new.archivo_full  is distinct from old.archivo_full
    or new.archivo_web   is distinct from old.archivo_web
    or new.archivo_thumb is distinct from old.archivo_thumb
    or new.fecha_captura is distinct from old.fecha_captura
    or new.hash_sha256   is distinct from old.hash_sha256 )
  then
    raise exception 'El recorrido está publicado: la posición (plano, página, x, y), los archivos, la fecha de captura y el hash del punto solo los puede cambiar un administrador.'
      using errcode = '42501';
  end if;
  if new.recorrido_id is distinct from old.recorrido_id then
    select estado into v_estado_dest from public.recorridos_360 where id = new.recorrido_id;
    if v_estado_dest = 'publicado' and coalesce(sst_rol_en_proyecto(new.proyecto_id), '') <> 'admin' then
      raise exception 'El recorrido de destino está publicado: solo un administrador puede mover puntos a él.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Trigger C: lista blanca del residente. Sin añadir 'pagina', el residente no
-- podría ubicar un punto en una página distinta de la 1 (la lista protege por
-- defecto toda columna nueva).
create or replace function public.p360_c_guard_residente()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare permitidas text[] := array['plano_id','pagina','x','y','waypoint','orden','etiqueta','rubro_id','heading_norte','notas'];
begin
  if auth.uid() is null then return new; end if;   -- service role / mantenimiento
  if sst_es_admin_global() then return new; end if;
  if coalesce(sst_rol_en_proyecto(old.proyecto_id), '') <> 'residente' then return new; end if;
  if (to_jsonb(new) - permitidas) is distinct from (to_jsonb(old) - permitidas) then
    raise exception 'Como residente solo puedes cambiar la posición (plano, página, x, y), el orden, la etiqueta, el rubro, el norte y las notas del punto.'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- 2) Observaciones (pines) -----------------------------------------------------
-- Nullable como pin_x / pin_y: una observación sin pin no tiene página.
alter table public.observaciones
  add column if not exists pin_pagina integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'observaciones_pin_pagina_chk') then
    alter table public.observaciones add constraint observaciones_pin_pagina_chk check (pin_pagina is null or pin_pagina >= 1);
  end if;
end $$;
comment on column public.observaciones.pin_pagina is
  'Página del plano (PDF) sobre la que están pin_x/pin_y; 1 en planos de imagen o de una sola página.';

-- Pines existentes: quedan en la página 1 (ver inventario de la cabecera: hoy no
-- hay ningún PDF de varias páginas).
update public.observaciones set pin_pagina = 1 where pin_x is not null and pin_pagina is null;

-- ============================================================================
-- VERIFICACIÓN (solo lectura). Una fila por comprobación: nombre, esperado, real,
-- ok. No falla aunque falten columnas o funciones (real = 'no existe', ok = false).
-- Aplicada y verificada el 2026-09-29: 11 de 11 en true.
-- Ojo: las filas «fuera de la página 1» valen para validar la migración recién
-- aplicada; dejarán de dar 0 cuando se coloquen marcas en otras páginas.
-- No cubre las pruebas por rol (hacen falta sesiones reales):
--   residente, recorrido en borrador:
--     (await sb.from('puntos_360').update({ pagina: 2, x: 10, y: 10 }).eq('id', Q).select('id')).data.length   // 1
--   fiscalizador, recorrido publicado:
--     (await sb.from('puntos_360').update({ pagina: 2 }).eq('id', P)).error?.code                              // '42501'
-- ============================================================================
with
col as (
  select
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'puntos_360'    and column_name = 'pagina')     as pagina,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'observaciones' and column_name = 'pin_pagina') as pin_pagina
),
fn as (
  select
    (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'p360_b_guard_publicado') as congelado,
    (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'p360_c_guard_residente') as residente
),
chk (orden, comprobacion, esperado, real) as (
  select 1, 'columna puntos_360.pagina creada', 'true', (select pagina::text from col)
  union all
  select 2, 'puntos_360.pagina: integer, not null, default 1', 'integer / NO / 1',
         (select data_type || ' / ' || is_nullable || ' / ' || coalesce(column_default, 'sin default') from information_schema.columns
           where table_schema = 'public' and table_name = 'puntos_360' and column_name = 'pagina')
  union all
  select 3, 'columna observaciones.pin_pagina creada', 'true', (select pin_pagina::text from col)
  union all
  select 4, 'observaciones.pin_pagina: integer, admite null', 'integer / YES',
         (select data_type || ' / ' || is_nullable from information_schema.columns
           where table_schema = 'public' and table_name = 'observaciones' and column_name = 'pin_pagina')
  union all
  select 5, 'restricciones de página (>= 1) en las dos tablas', '2',
         (select count(*)::text from pg_constraint where conname in ('puntos_360_pagina_chk', 'observaciones_pin_pagina_chk'))
  union all
  select 6, 'índice puntos_360_plano_pagina_idx', '1',
         (select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'puntos_360_plano_pagina_idx')
  union all
  -- to_jsonb(fila) permite leer la columna sin nombrarla: la consulta no falla si todavía no existe
  select 7, 'puntos 360 fuera de la página 1', '0',
         case when (select pagina from col)
              then (select count(*)::text from public.puntos_360 p where coalesce((to_jsonb(p) ->> 'pagina')::int, 1) <> 1) end
  union all
  select 8, 'pines de observaciones fuera de la página 1', '0',
         case when (select pin_pagina from col)
              then (select count(*)::text from public.observaciones o where o.pin_x is not null and coalesce((to_jsonb(o) ->> 'pin_pagina')::int, 1) <> 1) end
  union all
  select 9, 'pines con pin_x pero sin página (relleno a 1 hecho)', '0',
         case when (select pin_pagina from col)
              then (select count(*)::text from public.observaciones o where o.pin_x is not null and (to_jsonb(o) ->> 'pin_pagina') is null) end
  union all
  select 10, 'trigger de congelado (p360_b_guard_publicado) cubre pagina', 'true',
         (select (congelado ~ 'new\.pagina\s+is distinct from\s+old\.pagina')::text from fn)
  union all
  select 11, 'lista blanca del residente (p360_c_guard_residente) incluye pagina', 'true',
         (select (residente ~ 'permitidas[^;]*''pagina''')::text from fn)
)
select comprobacion, esperado, coalesce(real, 'no existe') as real, coalesce(real = esperado, false) as ok
from chk
order by orden;

-- ============================================================================
-- REVERSIÓN — comentada a propósito; NO forma parte de la migración.
-- PIERDE DATOS sin vuelta atrás: al quitar las columnas se borra la página de
-- toda marca colocada fuera de la página 1. Antes de revertir, correr la
-- verificación de arriba y mirar las filas «fuera de la página 1».
-- El cliente la tolera: sin las columnas vuelve a trabajar en página 1 y rechaza
-- con aviso colocar marcas en otra página.
-- Para usarla: copiar el bloque y quitar el prefijo «-- » de cada línea.
-- ============================================================================
-- -- 1) Triggers como en 20260922 (sin pagina). VAN PRIMERO: si se quitara antes la columna, el
-- --    trigger de congelado fallaría en cada UPDATE por nombrar una columna que ya no existe.
-- create or replace function public.p360_b_guard_publicado()
-- returns trigger language plpgsql set search_path = public, pg_temp as $$
-- declare v_estado text; v_estado_dest text; es_admin boolean;
-- begin
--   if auth.uid() is null then return new; end if;   -- service role / mantenimiento
--   if sst_es_admin_global() then return new; end if;
--   if tg_op = 'INSERT' then
--     select estado into v_estado from public.recorridos_360 where id = new.recorrido_id;
--     if v_estado = 'publicado' and coalesce(sst_rol_en_proyecto(new.proyecto_id), '') <> 'admin' then
--       raise exception 'El recorrido está publicado: solo un administrador puede añadir puntos.' using errcode = '42501';
--     end if;
--     return new;
--   end if;
--   es_admin := coalesce(sst_rol_en_proyecto(old.proyecto_id), '') = 'admin';
--   select estado into v_estado from public.recorridos_360 where id = old.recorrido_id;
--   if v_estado = 'publicado' and not es_admin and (
--        new.recorrido_id  is distinct from old.recorrido_id
--     or new.plano_id      is distinct from old.plano_id
--     or new.x             is distinct from old.x
--     or new.y             is distinct from old.y
--     or new.waypoint      is distinct from old.waypoint
--     or new.archivo_full  is distinct from old.archivo_full
--     or new.archivo_web   is distinct from old.archivo_web
--     or new.archivo_thumb is distinct from old.archivo_thumb
--     or new.fecha_captura is distinct from old.fecha_captura
--     or new.hash_sha256   is distinct from old.hash_sha256 )
--   then
--     raise exception 'El recorrido está publicado: la posición (plano, x, y), los archivos, la fecha de captura y el hash del punto solo los puede cambiar un administrador.'
--       using errcode = '42501';
--   end if;
--   if new.recorrido_id is distinct from old.recorrido_id then
--     select estado into v_estado_dest from public.recorridos_360 where id = new.recorrido_id;
--     if v_estado_dest = 'publicado' and coalesce(sst_rol_en_proyecto(new.proyecto_id), '') <> 'admin' then
--       raise exception 'El recorrido de destino está publicado: solo un administrador puede mover puntos a él.' using errcode = '42501';
--     end if;
--   end if;
--   return new;
-- end $$;
--
-- create or replace function public.p360_c_guard_residente()
-- returns trigger language plpgsql set search_path = public, pg_temp as $$
-- declare permitidas text[] := array['plano_id','x','y','waypoint','orden','etiqueta','rubro_id','heading_norte','notas'];
-- begin
--   if auth.uid() is null then return new; end if;   -- service role / mantenimiento
--   if sst_es_admin_global() then return new; end if;
--   if coalesce(sst_rol_en_proyecto(old.proyecto_id), '') <> 'residente' then return new; end if;
--   if (to_jsonb(new) - permitidas) is distinct from (to_jsonb(old) - permitidas) then
--     raise exception 'Como residente solo puedes cambiar la posición (plano, x, y), el orden, la etiqueta, el rubro, el norte y las notas del punto.'
--       using errcode = '42501';
--   end if;
--   return new;
-- end $$;
--
-- -- 2) Índice, restricciones y columnas
-- drop index if exists public.puntos_360_plano_pagina_idx;
-- alter table public.puntos_360    drop constraint if exists puntos_360_pagina_chk;
-- alter table public.observaciones drop constraint if exists observaciones_pin_pagina_chk;
-- alter table public.puntos_360    drop column if exists pagina;
-- alter table public.observaciones drop column if exists pin_pagina;
