-- ============================================================================
-- Recorridos 360 — fase (a): tablas, triggers, columnas en observaciones,
-- bucket PRIVADO 'fotos-360' y políticas. NO ejecutar automáticamente:
-- revisar y aplicar a mano (SQL Editor o `supabase db push`).
--
-- RLS de puntos_360 y recorridos_360: copia literal de observaciones (Ola 2)
-- sobre proyecto_id:
--   SELECT  -> cualquier miembro del proyecto o admin global
--   INSERT  -> admin, fiscalizador o residente del proyecto
--   UPDATE  -> admin o fiscalizador del proyecto. En puntos_360, ADEMÁS, el
--              residente mientras el recorrido esté en 'borrador', y solo sobre
--              posición (plano_id, x, y, waypoint), orden, etiqueta, rubro_id,
--              heading_norte y notas (lista blanca en el trigger
--              p360_c_guard_residente: RLS no distingue columnas).
--   DELETE  -> admin del proyecto
-- Las reglas de integridad que RLS no puede expresar (congelado al publicar,
-- proyecto inmutable, rutas atadas al punto, publicado_* fijados por el
-- servidor) van en triggers BEFORE ROW.
-- Unidades de x/y: porcentaje 0-100 con 1 decimal del overlay del plano,
-- exactamente como observaciones.pin_x / pin_y (coordsPinDesdeEvento).
-- ============================================================================

-- ── recorridos_360 ──────────────────────────────────────────────────────────
create table if not exists public.recorridos_360 (
  id             uuid primary key default gen_random_uuid(),
  proyecto_id    uuid not null references public.proyectos(id) on delete cascade,
  fecha          date not null default current_date,
  titulo         text not null,
  descripcion    text,
  estado         text not null default 'borrador' check (estado in ('borrador','publicado')),
  publicado_en   timestamptz,
  publicado_por  uuid references public.perfiles(id) on delete set null,
  creado_por     uuid references public.perfiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists recorridos_360_proyecto_fecha_idx on public.recorridos_360 (proyecto_id, fecha desc);

-- Integridad del recorrido:
--  * proyecto_id es inmutable (las rutas de storage llevan el proyecto en el nombre).
--  * publicado_en / publicado_por los fija el SERVIDOR (now(), auth.uid()); lo que
--    envíe el cliente se ignora.
--  * Volver a borrador un recorrido publicado: solo admin. Sin esto, el congelado
--    de puntos (p360_b_guard_publicado) se evadiría despublicando, editando y
--    republicando.
create or replace function public.r360_guard_recorrido()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare es_admin boolean;
begin
  if auth.uid() is null then return new; end if;   -- service role / mantenimiento
  if tg_op = 'INSERT' then
    if new.estado = 'publicado' then new.publicado_en := now(); new.publicado_por := auth.uid();
    else new.publicado_en := null; new.publicado_por := null; end if;
    return new;
  end if;
  if new.proyecto_id is distinct from old.proyecto_id then
    raise exception 'Un recorrido 360 no se puede mover de proyecto' using errcode = '42501';
  end if;
  es_admin := sst_es_admin_global() or coalesce(sst_rol_en_proyecto(old.proyecto_id), '') = 'admin';
  if old.estado = 'publicado' and new.estado <> 'publicado' and not es_admin then
    raise exception 'Solo un administrador puede devolver a borrador un recorrido publicado' using errcode = '42501';
  end if;
  if new.estado = 'publicado' and old.estado <> 'publicado' then
    new.publicado_en := now(); new.publicado_por := auth.uid();
  elsif new.estado <> 'publicado' then
    new.publicado_en := null; new.publicado_por := null;
  else
    new.publicado_en := old.publicado_en; new.publicado_por := old.publicado_por;
  end if;
  return new;
end $$;
drop trigger if exists r360_guard_recorrido on public.recorridos_360;
create trigger r360_guard_recorrido before insert or update on public.recorridos_360
  for each row execute function public.r360_guard_recorrido();

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
create table if not exists public.puntos_360 (
  id              uuid primary key default gen_random_uuid(),
  recorrido_id    uuid not null references public.recorridos_360(id) on delete cascade,
  proyecto_id     uuid not null references public.proyectos(id) on delete cascade,  -- lo copia el trigger desde el recorrido
  plano_id        uuid references public.planos(id) on delete set null,
  x               numeric(5,1),                 -- % del ancho del plano, como pin_x
  y               numeric(5,1),                 -- % del alto del plano, como pin_y
  waypoint        boolean not null default false, -- ubicado A MANO; la interpolación (modo Secuencia) solo toca los que no lo son
  orden           integer not null default 0,
  etiqueta        text,
  rubro_id        uuid references public.rubros(id) on delete set null,
  fecha_captura   timestamptz,                  -- EXIF DateTimeOriginal (o lastModified con aviso)
  lat             double precision,
  lon             double precision,
  alt             double precision,
  heading_norte   numeric(6,2),                 -- yaw (grados) que apunta al norte; editable
  archivo_full    text,                         -- <proyecto>/<recorrido>/<punto>/full.jpg (lo valida el trigger)
  archivo_web     text,
  archivo_thumb   text,
  ancho_original  integer,
  alto_original   integer,
  camara          text,                         -- EXIF Make + Model (p. ej. "Insta360 X4")
  hash_sha256     text,                         -- del archivo ORIGINAL, para dedupe
  notas           text,
  created_at      timestamptz not null default now(),
  constraint puntos_360_recorrido_hash_key unique (recorrido_id, hash_sha256)
);
-- (por si la tabla ya existía de una versión previa de esta migración)
alter table public.puntos_360 add column if not exists waypoint boolean not null default false;
create index if not exists puntos_360_recorrido_orden_idx on public.puntos_360 (recorrido_id, orden);
create index if not exists puntos_360_plano_idx           on public.puntos_360 (plano_id);
create index if not exists puntos_360_proyecto_fecha_idx  on public.puntos_360 (proyecto_id, fecha_captura);
-- (la búsqueda por hash dentro del recorrido la cubre el UNIQUE; no hay índice suelto por hash)

-- Trigger A (corre primero: orden alfabético de triggers BEFORE):
--  * proyecto_id lo fija el servidor desde el recorrido en INSERT y lo verifica en
--    UPDATE. Los triggers BEFORE ROW corren antes de NOT NULL y del WITH CHECK
--    de RLS, así que el cliente no envía proyecto_id.
--  * archivo_full/web/thumb, si no son NULL, deben ser EXACTAMENTE
--    <proyecto_id>/<recorrido_id>/<id>/{full,web,thumb}.jpg: así ninguna fila
--    puede apuntar a objetos de otro punto (y un borrado por admin nunca
--    alcanza archivos ajenos).
--  * plano_id, al fijarse o cambiar, debe ser un plano del MISMO proyecto del
--    punto (para todos los roles; también protege el permiso del residente).
-- Sin SECURITY DEFINER: el usuario debe poder ver el recorrido (r360_select);
-- si no lo ve, el insert falla, que es lo correcto.
create or replace function public.p360_a_proyecto()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_proy uuid; v_prefijo text;
begin
  select proyecto_id into v_proy from public.recorridos_360 where id = new.recorrido_id;
  if v_proy is null then
    raise exception 'El recorrido % no existe o no es visible para este usuario', new.recorrido_id using errcode = '23503';
  end if;
  if tg_op = 'INSERT' then
    new.proyecto_id := v_proy;
  elsif new.proyecto_id is distinct from v_proy then
    raise exception 'proyecto_id del punto no coincide con el de su recorrido' using errcode = '23514';
  end if;
  v_prefijo := new.proyecto_id::text || '/' || new.recorrido_id::text || '/' || new.id::text || '/';
  if (new.archivo_full  is not null and new.archivo_full  <> v_prefijo || 'full.jpg')
  or (new.archivo_web   is not null and new.archivo_web   <> v_prefijo || 'web.jpg')
  or (new.archivo_thumb is not null and new.archivo_thumb <> v_prefijo || 'thumb.jpg') then
    raise exception 'Las rutas de archivo del punto deben ser <proyecto>/<recorrido>/<punto>/{full,web,thumb}.jpg' using errcode = '23514';
  end if;
  -- El plano debe ser del mismo proyecto que el punto (se comprueba al fijarlo o cambiarlo)
  if new.plano_id is not null and (tg_op = 'INSERT' or new.plano_id is distinct from old.plano_id) then
    if not exists (select 1 from public.planos pl where pl.id = new.plano_id and pl.proyecto_id = new.proyecto_id) then
      raise exception 'El plano % no pertenece al proyecto del punto (o no es visible para este usuario)', new.plano_id using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists p360_a_proyecto on public.puntos_360;
create trigger p360_a_proyecto before insert or update on public.puntos_360
  for each row execute function public.p360_a_proyecto();

-- Trigger B (corre después de A, cuando proyecto_id ya es fiable):
-- Recorrido publicado -> posición (plano, x, y, waypoint), archivos, fecha de
-- captura, hash y recorrido del punto quedan congelados, y no se añaden puntos,
-- salvo admin (global o del proyecto de ORIGEN; si el punto cambia de
-- recorrido, también del destino). Etiqueta, notas, rubro, heading_norte y
-- orden siguen editables.
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
    or new.x             is distinct from old.x
    or new.y             is distinct from old.y
    or new.waypoint      is distinct from old.waypoint
    or new.archivo_full  is distinct from old.archivo_full
    or new.archivo_web   is distinct from old.archivo_web
    or new.archivo_thumb is distinct from old.archivo_thumb
    or new.fecha_captura is distinct from old.fecha_captura
    or new.hash_sha256   is distinct from old.hash_sha256 )
  then
    raise exception 'El recorrido está publicado: la posición (plano, x, y), los archivos, la fecha de captura y el hash del punto solo los puede cambiar un administrador.'
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
drop trigger if exists p360_b_guard_publicado on public.puntos_360;
create trigger p360_b_guard_publicado before insert or update on public.puntos_360
  for each row execute function public.p360_b_guard_publicado();

-- Trigger C (corre después de B): el residente, cuando la política
-- p360_update_residente_borrador le deja actualizar (recorrido en borrador),
-- solo puede cambiar posición (plano_id, x, y, waypoint), orden, etiqueta,
-- rubro_id, heading_norte y notas. Lista BLANCA: cualquier otra columna
-- (archivos, fecha de captura, hash, GPS, cámara, recorrido, proyecto, id…)
-- que difiera entre OLD y NEW se rechaza. Comparación por jsonb sin esas
-- claves, así una columna futura queda protegida por defecto.
create or replace function public.p360_c_guard_residente()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare permitidas text[] := array['plano_id','x','y','waypoint','orden','etiqueta','rubro_id','heading_norte','notas'];
begin
  if auth.uid() is null then return new; end if;   -- service role / mantenimiento
  if sst_es_admin_global() then return new; end if;
  if coalesce(sst_rol_en_proyecto(old.proyecto_id), '') <> 'residente' then return new; end if;
  if (to_jsonb(new) - permitidas) is distinct from (to_jsonb(old) - permitidas) then
    raise exception 'Como residente solo puedes cambiar la posición (plano, x, y), el orden, la etiqueta, el rubro, el norte y las notas del punto.'
      using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists p360_c_guard_residente on public.puntos_360;
create trigger p360_c_guard_residente before update on public.puntos_360
  for each row execute function public.p360_c_guard_residente();

alter table public.puntos_360 enable row level security;
revoke all on public.puntos_360 from anon;
grant select, insert, update, delete on public.puntos_360 to authenticated;

-- Copia literal de las políticas de observaciones, sobre puntos_360.proyecto_id.
drop policy if exists "p360_select" on public.puntos_360;
create policy "p360_select" on public.puntos_360 for select to authenticated
  using ( (select sst_es_admin_global()) or sst_rol_en_proyecto(proyecto_id) is not null );
drop policy if exists "p360_insert" on public.puntos_360;
create policy "p360_insert" on public.puntos_360 for insert to authenticated
  with check ( (select sst_es_admin_global()) or sst_rol_en_proyecto(proyecto_id) = any (array['admin','fiscalizador','residente']) );
drop policy if exists "p360_update" on public.puntos_360;
create policy "p360_update" on public.puntos_360 for update to authenticated
  using ( (select sst_es_admin_global()) or sst_rol_en_proyecto(proyecto_id) = any (array['admin','fiscalizador']) )
  with check ( (select sst_es_admin_global()) or sst_rol_en_proyecto(proyecto_id) = any (array['admin','fiscalizador']) );
-- Residente: UPDATE solo mientras el recorrido del punto esté en 'borrador'
-- (las políticas son permisivas: se suma a p360_update). Qué columnas puede
-- tocar lo limita el trigger p360_c_guard_residente. En 'publicado' esta
-- política no aplica y el UPDATE del residente no alcanza filas (0 filas, sin
-- error). Publicar / volver a borrador siguen en r360_update / r360_guard_recorrido.
drop policy if exists "p360_update_residente_borrador" on public.puntos_360;
create policy "p360_update_residente_borrador" on public.puntos_360 for update to authenticated
  using ( sst_rol_en_proyecto(proyecto_id) = 'residente'
          and exists (select 1 from public.recorridos_360 r where r.id = recorrido_id and r.estado = 'borrador') )
  with check ( sst_rol_en_proyecto(proyecto_id) = 'residente'
               and exists (select 1 from public.recorridos_360 r where r.id = recorrido_id and r.estado = 'borrador') );
drop policy if exists "p360_delete" on public.puntos_360;
create policy "p360_delete" on public.puntos_360 for delete to authenticated
  using ( (select sst_es_admin_global()) or sst_rol_en_proyecto(proyecto_id) = 'admin' );

-- ── observaciones: dónde se marcó dentro de la panorámica ───────────────────
alter table public.observaciones
  add column if not exists punto_360_id uuid references public.puntos_360(id) on delete set null,
  add column if not exists yaw   numeric(6,2),
  add column if not exists pitch numeric(6,2);
create index if not exists observaciones_punto_360_idx on public.observaciones (punto_360_id);

-- ── Storage: bucket 'fotos-360' PRIVADO ─────────────────────────────────────
-- Rutas: <proyecto_id>/<recorrido_id>/<punto_id>/{full,web,thumb}.jpg
-- Toda lectura pasa por URLs firmadas que emite storage360 (js/recorridos360.js);
-- /object/public/ no funciona en buckets privados y no debe construirse nunca.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-360', 'fotos-360', false, 8388608, array['image/jpeg'])   -- 8 MB por objeto
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- proyecto_id = primer segmento de la ruta. La expresión pedida es
-- ((storage.foldername(name))[1]::uuid); va envuelta en un CASE porque un
-- WHERE no garantiza el orden de evaluación y el cast fallaría sobre objetos
-- de OTROS buckets cuyo primer segmento no es un uuid (rompería listados).
-- Función plana (sin SECURITY DEFINER): solo parsea texto.
create or replace function public.r360_proyecto_de_ruta(ruta text)
returns uuid language sql stable strict set search_path = public, pg_temp as $$
  select case when (storage.foldername(ruta))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then ((storage.foldername(ruta))[1])::uuid end
$$;

drop policy if exists "fotos360 leer miembros" on storage.objects;
create policy "fotos360 leer miembros" on storage.objects for select to authenticated
  using ( bucket_id = 'fotos-360'
          and ( (select sst_es_admin_global()) or sst_rol_en_proyecto(r360_proyecto_de_ruta(name)) is not null ) );
drop policy if exists "fotos360 subir gestion y residente" on storage.objects;
create policy "fotos360 subir gestion y residente" on storage.objects for insert to authenticated
  with check ( bucket_id = 'fotos-360'
               and ( (select sst_es_admin_global()) or sst_rol_en_proyecto(r360_proyecto_de_ruta(name)) = any (array['admin','fiscalizador','residente']) ) );
-- UPDATE (sobrescribir un objeto) según especificación: admin/fiscalizador. La app
-- no lo usa (sube con upsert:false). Nota: un fiscalizador podría reemplazar los
-- bytes de una foto de un recorrido publicado sin tocar la fila; si esto debe
-- impedirse, restringir esta política a admin.
drop policy if exists "fotos360 actualizar gestion" on storage.objects;
create policy "fotos360 actualizar gestion" on storage.objects for update to authenticated
  using ( bucket_id = 'fotos-360'
          and ( (select sst_es_admin_global()) or sst_rol_en_proyecto(r360_proyecto_de_ruta(name)) = any (array['admin','fiscalizador']) ) )
  with check ( bucket_id = 'fotos-360'
               and ( (select sst_es_admin_global()) or sst_rol_en_proyecto(r360_proyecto_de_ruta(name)) = any (array['admin','fiscalizador']) ) );
drop policy if exists "fotos360 eliminar admin" on storage.objects;
create policy "fotos360 eliminar admin" on storage.objects for delete to authenticated
  using ( bucket_id = 'fotos-360'
          and ( (select sst_es_admin_global()) or sst_rol_en_proyecto(r360_proyecto_de_ruta(name)) = 'admin' ) );

-- Limpieza de subidas parciales: quien subió un objeto (owner = auth.uid()) puede
-- borrarlo MIENTRAS siga siendo miembro del proyecto y ningún punto lo
-- referencie (el punto_id va en el tercer segmento de la ruta). Así el uploader
-- limpia sus sobrantes (dedupe, descarte en cola) pero no puede borrar los
-- archivos de un punto ya registrado, aunque sea suyo: eso sigue siendo de
-- admin y respeta el congelado al publicar. La condición de membresía cubre el
-- caso del ex-miembro, para quien el NOT EXISTS (evaluado bajo su RLS, que ya
-- no ve la fila) daría verdadero. Se comprueban owner (uuid, heredado) y
-- owner_id (text, actual): Storage rellena ambos con el uid del JWT.
create or replace function public.r360_punto_de_ruta(ruta text)
returns uuid language sql stable strict set search_path = public, pg_temp as $$
  select case when (storage.foldername(ruta))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then ((storage.foldername(ruta))[3])::uuid end
$$;
drop policy if exists "fotos360 eliminar propios sin punto" on storage.objects;
create policy "fotos360 eliminar propios sin punto" on storage.objects for delete to authenticated
  using ( bucket_id = 'fotos-360'
          and ( owner = auth.uid() or owner_id = auth.uid()::text )
          and sst_rol_en_proyecto(r360_proyecto_de_ruta(name)) is not null
          and not exists ( select 1 from public.puntos_360 p where p.id = r360_punto_de_ruta(name) ) );

-- ── Verificación tras aplicar ───────────────────────────────────────────────
-- 1) Objetos y políticas:
--   select tablename, policyname, cmd from pg_policies where tablename in ('recorridos_360','puntos_360') order by 1,3;  -- 9 filas (puntos_360: 2 de UPDATE)
--   select policyname, cmd from pg_policies where schemaname='storage' and policyname like 'fotos360%' order by 2;         -- 5 filas (2 DELETE)
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id='fotos-360';                     -- public = false
--   select tgrelid::regclass, tgname from pg_trigger where tgrelid in ('public.puntos_360'::regclass,'public.recorridos_360'::regclass) and not tgisinternal order by 1,2;
--     -- recorridos_360: r360_guard_recorrido · puntos_360: p360_a_proyecto, p360_b_guard_publicado, p360_c_guard_residente
--   select column_name from information_schema.columns where table_name='observaciones' and column_name in ('punto_360_id','yaw','pitch');
--
-- 2) Bucket privado (a): ni la ruta pública ni la firma con la clave anon devuelven la imagen:
--   curl -s -o /dev/null -w "%{http_code}\n" "https://kpswaoqxaxvhrgxntkcq.supabase.co/storage/v1/object/public/fotos-360/<proyecto>/<recorrido>/<punto>/thumb.jpg"   # 400/404
--   curl -s -X POST -H "apikey: <anon>" -H "Authorization: Bearer <anon>" -H "Content-Type: application/json" -d '{"expiresIn":60}' \
--     "https://kpswaoqxaxvhrgxntkcq.supabase.co/storage/v1/object/sign/fotos-360/<proyecto>/<recorrido>/<punto>/thumb.jpg"   # error, sin signedURL
--
-- 3) Firma restringida (b): con la sesión de un RESIDENTE DE OTRO PROYECTO, en la consola del navegador:
--   (await sb.storage.from('fotos-360').createSignedUrl('<proyecto_ajeno>/<recorrido>/<punto>/thumb.jpg', 60)).error   // debe ser un error, no null
--
-- 4) Vencimiento (c): con un miembro del proyecto, expiresIn = 5 (fetch, no window.open: el navegador bloquea popups diferidos):
--   const { data } = await sb.storage.from('fotos-360').createSignedUrl('<ruta>', 5);
--   console.log((await fetch(data.signedUrl)).status);                              // 200
--   setTimeout(async()=>console.log((await fetch(data.signedUrl)).status), 7000);   // 400
--
-- 5) Reglas de integridad (con un FISCALIZADOR del proyecto, recorrido publicado R con punto P):
--   await sb.from('recorridos_360').update({estado:'borrador'}).eq('id', R)          // error 42501 (solo admin despublica)
--   await sb.from('puntos_360').update({x: 10}).eq('id', P)                            // error 42501 (congelado)
--   await sb.from('puntos_360').update({plano_id: '<otro plano>'}).eq('id', P)         // error 42501 (congelado: plano)
--   await sb.from('puntos_360').update({etiqueta:'Eje 3'}).eq('id', P)                 // OK
--   await sb.from('puntos_360').insert({recorrido_id: R, orden: 99})                   // error 42501 (publicado: sin altas)
--   await sb.from('recorridos_360').update({publicado_por:'<otro uuid>'}).eq('id', R)  // OK pero publicado_por NO cambia (lo fija el servidor)
--
-- 5b) Residente en borrador / publicado (con la sesión de un RESIDENTE del proyecto; recorrido B en
--     'borrador' con punto Q, recorrido R publicado con punto P). Con .select('id') se ve si el
--     UPDATE alcanzó filas: RLS que no aplica = 0 filas SIN error; trigger = error 42501.
--   (await sb.from('puntos_360').update({etiqueta:'Eje 2', x: 40, y: 55}).eq('id', Q).select('id')).data.length   // 1  (borrador: permitido)
--   (await sb.from('puntos_360').update({fecha_captura: new Date().toISOString()}).eq('id', Q).select('id')).error?.code   // '42501' (columna fuera de la lista blanca)
--   (await sb.from('puntos_360').update({etiqueta:'Eje 3'}).eq('id', P).select('id')).data.length   // 0  (publicado: la política no aplica)
--
-- 5c) Plano de otro proyecto (cualquier rol con UPDATE; recorrido en borrador, punto Q):
--   (await sb.from('puntos_360').update({plano_id:'<plano de OTRO proyecto>', x: 10, y: 10}).eq('id', Q)).error?.code   // '23514'
--   (await sb.from('puntos_360').update({plano_id:'<plano del MISMO proyecto>', x: 10, y: 10}).eq('id', Q)).error         // null
--
-- 6) Limpieza de sobrantes (con un RESIDENTE del proyecto). remove() NO devuelve error cuando la
--    política niega el borrado: devuelve la lista de objetos borrados, así que se compara el largo.
--   const ruta = '<proyecto>/<recorrido>/<uuid nuevo sin fila>/thumb.jpg';
--   await sb.storage.from('fotos-360').upload(ruta, new Blob([new Uint8Array([0xFF,0xD8,0xFF,0xD9])],{type:'image/jpeg'}));
--   (await sb.storage.from('fotos-360').remove([ruta])).data.length                          // 1  (propio y sin punto)
--   (await sb.storage.from('fotos-360').remove(['<ruta thumb de un punto registrado>'])).data.length   // 0  (tiene fila: no)
--
-- 7) Disciplina de URLs (ninguna ruta pública construida a mano para 360):
--   grep -n "object/public" js/recorridos360.js            -> sin resultados
--   grep -n "fotos-360" index.html                         -> sin resultados (el bucket solo lo conoce storage360)

-- ── Reversión ────────────────────────────────────────────────────────────────
-- 1) Vaciar y borrar el bucket por la API de Storage (no basta con borrar filas de
--    storage.objects: dejaría los archivos huérfanos en el backend). Desde el panel
--    de Supabase (Storage › fotos-360 › Empty bucket, luego Delete bucket) o con la
--    service_role key (CLI: `supabase storage rm -r ss:///fotos-360 --linked`).
--    NO sirve la consola del navegador con un JWT de usuario: storage.buckets tiene
--    RLS sin políticas, así que emptyBucket()/deleteBucket() responden "not found".
-- 2) Luego, en SQL:
-- drop policy if exists "fotos360 leer miembros" on storage.objects;
-- drop policy if exists "fotos360 subir gestion y residente" on storage.objects;
-- drop policy if exists "fotos360 actualizar gestion" on storage.objects;
-- drop policy if exists "fotos360 eliminar admin" on storage.objects;
-- drop policy if exists "fotos360 eliminar propios sin punto" on storage.objects;
-- drop function if exists public.r360_proyecto_de_ruta(text);
-- drop function if exists public.r360_punto_de_ruta(text);
-- alter table public.observaciones drop column if exists punto_360_id, drop column if exists yaw, drop column if exists pitch;
-- drop table if exists public.puntos_360;   -- arrastra sus triggers y políticas (incluida p360_update_residente_borrador)
-- drop function if exists public.p360_a_proyecto(); drop function if exists public.p360_b_guard_publicado(); drop function if exists public.p360_c_guard_residente();
-- drop table if exists public.recorridos_360; -- arrastra su trigger
-- drop function if exists public.r360_guard_recorrido();
