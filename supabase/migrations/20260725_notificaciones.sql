-- La tabla notificaciones YA EXISTE en la base con este esquema:
--   id uuid, perfil_id uuid, tipo text, titulo text, mensaje text,
--   leida boolean, url_destino text, created_at timestamptz
-- Esta migración solo agrega el índice para las consultas del resumen de
-- cartera y la política RLS para que cada usuario lea sus notificaciones
-- desde el frontend (las inserciones las hace el backend con service role).

create index if not exists notificaciones_perfil_tipo_idx
  on notificaciones (perfil_id, tipo, created_at desc);

alter table notificaciones enable row level security;

drop policy if exists "usuarios leen sus notificaciones" on notificaciones;
create policy "usuarios leen sus notificaciones"
  on notificaciones for select
  using (auth.uid() = perfil_id);
