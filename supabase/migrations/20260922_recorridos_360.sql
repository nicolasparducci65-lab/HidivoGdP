-- ============================================================================
-- Recorridos 360 — fase (a): tablas, índices, columnas en observaciones,
-- bucket 'fotos-360' y políticas. NO ejecutar automáticamente: revisar y
-- aplicar a mano (SQL Editor o `supabase db push`).
--
-- RLS espejo de observaciones (Ola 2):
--   SELECT  -> cualquier miembro del proyecto (sst_rol_en_proyecto no nulo) o admin global
--   INSERT  -> admin, fiscalizador o residente del proyecto (los que crean observaciones)
--   UPDATE  -> admin o fiscalizador del proyecto
--   DELETE  -> admin del proyecto
-- Storage espejo de hidivo-fotos: bucket público, INSERT/DELETE autenticados.
-- Unidades de x/y: porcentaje 0-100 con 1 decimal del overlay del plano,
-- exactamente como observaciones.pin_x / pin_y (coordsPinDesdeEvento).
-- ============================================================================

-- ── recorridos_360 ──────────────────────────────────────────────────────────
create table if not exists public.recorridos_360 (
  id           uuid primary key default gen_random_uuid(),
  proyecto_id  uuid not null references public.proyectos(id) on delete cascade,
  fecha        date not null default current_date,
  titulo       text not null,
  descripcion  text,
  estado       text not null default 'borrador' check (estado in ('borrador','publicado')),
  creado_por   uuid references public.perfiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists recorridos_360_proyecto_fecha_idx on public.recorridos_360 (proyecto_id, fecha desc);

alter table public.recorridos_360 enable row level security;
revoke all on public.recorridos_360 from anon;
grant select, insert, update, delete on public.recorridos_360 to authenticated;

drop policy if exists "r360_select" on public.recorridos_360;
create policy "r360_select" on public.recorridos_360 for select to authenticated
  using ( (select sst_es_admin_global()) or sst_rol_en_proyecto(proyecto_id) is not null );
drop policy if exists "r360_insert" on public.recorridos_360;
create policy "r360_insert" on public.recorridos_360 for insert to authenticated
  with check ( (select sst_es_admin_global()) or sst_rol_en_proyecto(proyecto_id) = any (array['admin','fiscalizador','residente']) );
drop policy if exists "r360_update" on public.recorridos_360;
create policy "r360_update" on public.recorridos_360 for update to authenticated
  using ( (select sst_es_admin_global()) or sst_rol_en_proyecto(proyecto_id) = any (array['admin','fiscalizador']) )
  with check ( (select sst_es_admin_global()) or sst_rol_en_proyecto(proyecto_id) = any (array['admin','fiscalizador']) );
drop policy if exists "r360_delete" on public.recorridos_360;
create policy "r360_delete" on public.recorridos_360 for delete to authenticated
  using ( (select sst_es_admin_global()) or sst_rol_en_proyecto(proyecto_id) = 'admin' );

-- ── puntos_360 ──────────────────────────────────────────────────────────────
-- Helper SECURITY DEFINER para evaluar el rol vía el recorrido sin recursión
-- de RLS (mismo molde que chat_rol_proyecto_de_canal).
create or replace function public.r360_proyecto_de_recorrido(rid uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select proyecto_id from public.recorridos_360 where id = rid
$$;

create table if not exists public.puntos_360 (
  id              uuid primary key default gen_random_uuid(),
  recorrido_id    uuid not null references public.recorridos_360(id) on delete cascade,
  plano_id        uuid references public.planos(id) on delete set null,
  x               numeric(5,1),                 -- % del ancho del plano, como pin_x
  y               numeric(5,1),                 -- % del alto del plano, como pin_y
  orden           integer not null default 0,
  etiqueta        text,
  rubro_id        uuid references public.rubros(id) on delete set null,
  fecha_captura   timestamptz,                  -- EXIF DateTimeOriginal
  lat             double precision,
  lon             double precision,
  alt             double precision,
  heading_norte   numeric(6,2),                 -- yaw (grados) que apunta al norte; editable
  archivo_full    text,                         -- ruta en el bucket: proyecto/recorrido/punto/full.jpg
  archivo_web     text,
  archivo_thumb   text,
  ancho_original  integer,
  alto_original   integer,
  camara          text,                         -- EXIF Model (p. ej. "Insta360 X4")
  hash_sha256     text,                         -- del archivo ORIGINAL, para dedupe en el proyecto
  notas           text,
  created_at      timestamptz not null default now()
);
create index if not exists puntos_360_recorrido_orden_idx on public.puntos_360 (recorrido_id, orden);
create index if not exists puntos_360_plano_idx           on public.puntos_360 (plano_id);
create index if not exists puntos_360_hash_idx            on public.puntos_360 (hash_sha256);
create index if not exists puntos_360_fecha_idx           on public.puntos_360 (fecha_captura);
-- "(proyecto_id vía recorrido, fecha)": puntos_360 no guarda proyecto_id; la
-- consulta por proyecto y fecha entra por recorridos_360(proyecto_id, fecha) y
-- luego por (recorrido_id, orden). Se documenta en vez de desnormalizar.

alter table public.puntos_360 enable row level security;
revoke all on public.puntos_360 from anon;
grant select, insert, update, delete on public.puntos_360 to authenticated;

drop policy if exists "p360_select" on public.puntos_360;
create policy "p360_select" on public.puntos_360 for select to authenticated
  using ( (select sst_es_admin_global()) or sst_rol_en_proyecto(r360_proyecto_de_recorrido(recorrido_id)) is not null );
drop policy if exists "p360_insert" on public.puntos_360;
create policy "p360_insert" on public.puntos_360 for insert to authenticated
  with check ( (select sst_es_admin_global()) or sst_rol_en_proyecto(r360_proyecto_de_recorrido(recorrido_id)) = any (array['admin','fiscalizador','residente']) );
drop policy if exists "p360_update" on public.puntos_360;
create policy "p360_update" on public.puntos_360 for update to authenticated
  using ( (select sst_es_admin_global()) or sst_rol_en_proyecto(r360_proyecto_de_recorrido(recorrido_id)) = any (array['admin','fiscalizador','residente']) )
  with check ( (select sst_es_admin_global()) or sst_rol_en_proyecto(r360_proyecto_de_recorrido(recorrido_id)) = any (array['admin','fiscalizador','residente']) );
-- (UPDATE incluye residente: reposicionar sus propios puntos arrastrándolos y
--  ajustar heading_norte forman parte de la carga, no de la moderación.)
drop policy if exists "p360_delete" on public.puntos_360;
create policy "p360_delete" on public.puntos_360 for delete to authenticated
  using ( (select sst_es_admin_global()) or sst_rol_en_proyecto(r360_proyecto_de_recorrido(recorrido_id)) = any (array['admin','fiscalizador']) );

-- ── observaciones: dónde se marcó dentro de la panorámica ───────────────────
alter table public.observaciones
  add column if not exists punto_360_id uuid references public.puntos_360(id) on delete set null,
  add column if not exists yaw   numeric(6,2),
  add column if not exists pitch numeric(6,2);
create index if not exists observaciones_punto_360_idx on public.observaciones (punto_360_id);

-- ── Storage: bucket 'fotos-360' (público, como hidivo-fotos) ─────────────────
-- Rutas: <proyecto_id>/<recorrido_id>/<punto_id>/{full,web,thumb}.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-360', 'fotos-360', true, 6291456, array['image/jpeg'])   -- 6 MB: la variante full pesa ≈3 MB
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fotos360 leer publico" on storage.objects;
create policy "fotos360 leer publico" on storage.objects for select
  using ( bucket_id = 'fotos-360' );
drop policy if exists "fotos360 subir autenticados" on storage.objects;
create policy "fotos360 subir autenticados" on storage.objects for insert
  with check ( bucket_id = 'fotos-360' and auth.role() = 'authenticated' );
drop policy if exists "fotos360 actualizar autenticados" on storage.objects;
create policy "fotos360 actualizar autenticados" on storage.objects for update to authenticated
  using ( bucket_id = 'fotos-360' ) with check ( bucket_id = 'fotos-360' );
drop policy if exists "fotos360 eliminar autenticados" on storage.objects;
create policy "fotos360 eliminar autenticados" on storage.objects for delete to authenticated
  using ( bucket_id = 'fotos-360' );

-- ── Verificación sugerida tras aplicar ───────────────────────────────────────
-- select tablename, policyname, cmd from pg_policies where tablename in ('recorridos_360','puntos_360') order by 1,3;  -- 8 filas
-- select column_name from information_schema.columns where table_name='observaciones' and column_name in ('punto_360_id','yaw','pitch');
-- select id, public, file_size_limit from storage.buckets where id='fotos-360';

-- ── Reversión ────────────────────────────────────────────────────────────────
-- drop policy if exists "fotos360 leer publico" on storage.objects;
-- drop policy if exists "fotos360 subir autenticados" on storage.objects;
-- drop policy if exists "fotos360 actualizar autenticados" on storage.objects;
-- drop policy if exists "fotos360 eliminar autenticados" on storage.objects;
-- delete from storage.objects where bucket_id='fotos-360'; delete from storage.buckets where id='fotos-360';
-- alter table public.observaciones drop column if exists punto_360_id, drop column if exists yaw, drop column if exists pitch;
-- drop table if exists public.puntos_360; drop table if exists public.recorridos_360;
-- drop function if exists public.r360_proyecto_de_recorrido(uuid);
