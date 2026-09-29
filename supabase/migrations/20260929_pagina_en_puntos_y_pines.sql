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
-- Verificación (después de aplicar)
--   select column_name, data_type, is_nullable, column_default from information_schema.columns
--    where table_schema = 'public' and (table_name, column_name) in (('puntos_360','pagina'), ('observaciones','pin_pagina'));
--   -- residente, recorrido en borrador:
--   (await sb.from('puntos_360').update({ pagina: 2, x: 10, y: 10 }).eq('id', Q).select('id')).data.length   // 1
--   -- fiscalizador, recorrido publicado:
--   (await sb.from('puntos_360').update({ pagina: 2 }).eq('id', P)).error?.code                              // '42501'
--
-- Inventario previo (solo lectura): planos PDF con marcas, candidatos a revisar
-- a mano porque pueden tener más de una página (el número de páginas no está en
-- la base; se ve abriendo el plano):
--   select pl.id, pl.nombre,
--          (select count(*) from public.observaciones o where o.plano_id = pl.id and o.pin_x is not null) as pines,
--          (select count(*) from public.puntos_360  p where p.plano_id = pl.id and p.x     is not null) as puntos_360
--     from public.planos pl
--    where pl.tipo ilike '%pdf%' or pl.nombre ilike '%.pdf'
--    order by 3 desc, 4 desc;
--
-- Cliente: index.html (pines) y js/recorridos360.js (puntos), mismo commit que este archivo.
-- ============================================================================
