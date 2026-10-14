-- ============================================================================
-- Expediente de obra (fase 1): registro de cada generación.
-- NO ejecutar automáticamente: revisar y aplicar a mano en el SQL Editor.
-- Todo va en una transacción: si algo falla, no queda nada.
--
-- Qué hace:
--   1) Tabla expedientes_generados: una fila por expediente generado de un
--      proyecto (versión correlativa, quién, cuándo, preset, secciones, filtros,
--      estado del proyecto al generar y, desde la fase 3, el archivo en Storage).
--   2) Trigger BEFORE INSERT que asigna version = max(version)+1 por proyecto,
--      serializado con un advisory lock para que dos generaciones simultáneas
--      no choquen contra unique (proyecto_id, version).
--   3) Trigger BEFORE UPDATE: el autor solo puede cambiar estado, error_detalle
--      y subtitulo de su propia fila. RLS no distingue columnas, así que la
--      restricción vive aquí. Exentos: service_role / SQL Editor (auth.uid()
--      es null) y admin global, igual que el guard de puntos_360: en la fase 3
--      el runner en servidor actualiza archivo_path, paginas, tamano_bytes,
--      hash_sha256 y estado con la clave de servicio.
--   4) GRANT a authenticated y service_role, RLS y políticas con los helpers
--      existentes sst_es_admin_global() y sst_rol_en_proyecto(uuid).
--
-- Qué NO hace: no toca ninguna tabla existente. No hay en la base ningún
-- trigger que bloquee escrituras en proyectos liquidados (el bloqueo es solo
-- de la app, bloquearSiCerrado), así que no hace falta excluir esta tabla:
-- el expediente final se genera, por definición, después de liquidar.
--
-- Fase 1: la app inserta con origen = 'navegador' y estado = 'listo', recibe
-- la fila (insert().select().single()) para conocer la versión y, si la
-- generación falla, actualiza a estado = 'error' con error_detalle.
-- ============================================================================

begin;

-- ── 1) Tabla ────────────────────────────────────────────────────────────────
create table if not exists public.expedientes_generados (
  id                  uuid primary key default gen_random_uuid(),
  proyecto_id         uuid not null references public.proyectos(id) on delete cascade,
  version             int  not null,
  generado_por        uuid references public.perfiles(id) on delete set null,
  generado_en         timestamptz not null default now(),
  origen              text not null default 'navegador'
                      constraint expedientes_generados_origen_chk check (origen in ('navegador','servidor')),
  estado              text not null default 'solicitado'
                      constraint expedientes_generados_estado_chk check (estado in ('solicitado','generando','listo','error')),
  preset              text,
  secciones           jsonb not null,
  filtros             jsonb not null default '{}'::jsonb,
  estado_proyecto     text,
  subtitulo           text,
  tomos               int not null default 1,
  paginas_estimadas   int,
  archivo_path        text,
  paginas             int,
  tamano_bytes        bigint,
  hash_sha256         text,
  archivo_firmado_id  uuid references public.archivos(id) on delete set null,
  error_detalle       text,
  constraint expedientes_generados_proyecto_version_key unique (proyecto_id, version),
  constraint expedientes_generados_secciones_chk check (jsonb_typeof(secciones) = 'array'),
  constraint expedientes_generados_filtros_chk   check (jsonb_typeof(filtros) = 'object')
);

comment on table  public.expedientes_generados is 'Expediente de obra: una fila por cada generación (PDF) de un proyecto. La versión es correlativa por proyecto y la asigna el trigger.';
comment on column public.expedientes_generados.version           is 'Correlativo por proyecto. Lo asigna exp_asignar_version(); el valor enviado por la app se ignora.';
comment on column public.expedientes_generados.origen            is 'navegador = generado en el cliente (fase 1); servidor = Puppeteer en GitHub Actions (fase 3).';
comment on column public.expedientes_generados.secciones         is 'Arreglo JSON de claves de EXPEDIENTE_SECCIONES incluidas, en orden.';
comment on column public.expedientes_generados.filtros           is 'Objeto JSON con los filtros aplicados (incluirOCsNoAprobadas, detallePlanillas, ...).';
comment on column public.expedientes_generados.estado_proyecto   is 'proyectos.estado_cierre en el momento de generar (en_ejecucion, recepcion_provisional, recepcion_definitiva, liquidado).';
comment on column public.expedientes_generados.archivo_path      is 'Fase 3: ruta del PDF en Storage. Null en la fase 1 (el usuario guarda el PDF desde el navegador).';
comment on column public.expedientes_generados.archivo_firmado_id is 'Fase 3: fila de archivos con el expediente firmado que se adjunta después.';

create index if not exists expedientes_generados_proyecto_idx
  on public.expedientes_generados (proyecto_id, generado_en desc);

-- ── 2) Versión correlativa por proyecto ─────────────────────────────────────
create or replace function public.exp_asignar_version()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Serializa las inserciones del mismo proyecto dentro de la transacción:
  -- sin esto, dos generaciones a la vez leerían el mismo max() y una fallaría
  -- por la restricción unique.
  perform pg_advisory_xact_lock(hashtext('expedientes_generados:' || new.proyecto_id::text));
  select coalesce(max(version), 0) + 1
    into new.version
    from public.expedientes_generados
   where proyecto_id = new.proyecto_id;
  return new;
end $$;

drop trigger if exists trg_exp_asignar_version on public.expedientes_generados;
create trigger trg_exp_asignar_version
  before insert on public.expedientes_generados
  for each row execute function public.exp_asignar_version();

-- ── 3) Guard de UPDATE: el autor solo toca estado, error_detalle y subtitulo ─
create or replace function public.exp_guard_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare permitidas text[] := array['estado','error_detalle','subtitulo'];
begin
  -- Exentos, antes de cualquier otra rama:
  --   · service_role (runner de la fase 3): su JWT trae role = 'service_role' y no trae sub,
  --     así que auth.role() = 'service_role' y auth.uid() es null;
  --   · sesión sin JWT (SQL Editor, psql como postgres): auth.uid() y auth.role() son null.
  -- En ambos casos se devuelve new sin evaluar la rama de autor.
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then return new; end if;
  if sst_es_admin_global() then return new; end if;
  if (to_jsonb(new) - permitidas) is distinct from (to_jsonb(old) - permitidas) then
    raise exception 'De un expediente generado solo se puede cambiar el estado, el detalle del error y el subtítulo.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_exp_guard_update on public.expedientes_generados;
create trigger trg_exp_guard_update
  before update on public.expedientes_generados
  for each row execute function public.exp_guard_update();

-- ── 4) Permisos y RLS ───────────────────────────────────────────────────────
grant select, insert, update, delete on public.expedientes_generados to authenticated;
grant all on public.expedientes_generados to service_role;

alter table public.expedientes_generados enable row level security;

-- Ver: admin global o miembro del proyecto con rol admin/fiscalizador.
drop policy if exists exp_select on public.expedientes_generados;
create policy exp_select on public.expedientes_generados
  for select to authenticated
  using ((select sst_es_admin_global())
         or sst_rol_en_proyecto(proyecto_id) in ('admin','fiscalizador'));

-- Generar: mismos roles, y la fila queda a nombre de quien la inserta.
drop policy if exists exp_insert on public.expedientes_generados;
create policy exp_insert on public.expedientes_generados
  for insert to authenticated
  with check (generado_por = (select auth.uid())
              and ((select sst_es_admin_global())
                   or sst_rol_en_proyecto(proyecto_id) in ('admin','fiscalizador')));

-- Actualizar: el autor su propia fila (las columnas las limita el trigger) o admin global.
drop policy if exists exp_update on public.expedientes_generados;
create policy exp_update on public.expedientes_generados
  for update to authenticated
  using ((select sst_es_admin_global())
         or (generado_por = (select auth.uid())
             and sst_rol_en_proyecto(proyecto_id) in ('admin','fiscalizador')))
  with check ((select sst_es_admin_global())
              or (generado_por = (select auth.uid())
                  and sst_rol_en_proyecto(proyecto_id) in ('admin','fiscalizador')));

-- Borrar: solo admin global.
drop policy if exists exp_delete on public.expedientes_generados;
create policy exp_delete on public.expedientes_generados
  for delete to authenticated
  using ((select sst_es_admin_global()));

commit;

-- ── Verificación (solo lectura, salvo la prueba 3 que se revierte) ──────────
-- 1) Tabla, RLS activo, grants y 4 políticas:
--   select relrowsecurity from pg_class where oid = 'public.expedientes_generados'::regclass;          -- true
--   select grantee, string_agg(privilege_type, ',' order by privilege_type)
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'expedientes_generados'
--    group by grantee;                                                                                 -- authenticated: DELETE,INSERT,SELECT,UPDATE · service_role: todo
--   select policyname, cmd from pg_policies where tablename = 'expedientes_generados' order by 1;      -- exp_delete, exp_insert, exp_select, exp_update
--
-- 2) Triggers instalados:
--   select tgname from pg_trigger where tgrelid = 'public.expedientes_generados'::regclass and not tgisinternal order by 1;
--   -- trg_exp_asignar_version, trg_exp_guard_update
--
-- 3) Versión correlativa (se revierte; P = id de cualquier proyecto):
--   begin;
--     insert into public.expedientes_generados (proyecto_id, secciones, origen, estado)
--       values ('P', '["portada","indice"]', 'navegador', 'listo'),
--              ('P', '["portada","indice"]', 'navegador', 'listo');
--     select version from public.expedientes_generados where proyecto_id = 'P' order by version;      -- 1, 2
--     insert into public.expedientes_generados (proyecto_id, version, secciones)
--       values ('P', 99, '["portada"]');
--     select max(version) from public.expedientes_generados where proyecto_id = 'P';                   -- 3 (el 99 se ignora)
--     -- Guard exento sin JWT: desde el SQL Editor auth.uid() y auth.role() son null y el
--     -- UPDATE de una columna prohibida (preset) pasa sin excepción.
--     select auth.uid(), auth.role();                                                                 -- null, null
--     update public.expedientes_generados set preset = 'editor' where proyecto_id = 'P' and version = 1;  -- UPDATE 1
--   rollback;
--
-- 4) Reglas (consola del navegador, con la sesión indicada; X = id de una fila propia):
--   Fiscalizador del proyecto:
--     (await sb.from('expedientes_generados').update({subtitulo:'prueba'}).eq('id', X)).error          // null
--     (await sb.from('expedientes_generados').update({preset:'otro'}).eq('id', X)).error?.code         // '42501' (guard)
--     (await sb.from('expedientes_generados').delete().eq('id', X)).data                               // [] (sin política: 0 filas)
--   Residente del proyecto (PRUEBAS RLS, nicolas+residente@hidivo.com):
--     (await sb.from('expedientes_generados').select('id').eq('proyecto_id', 'P')).data                // [] (RLS: no ve nada)
--     (await sb.from('expedientes_generados').insert({proyecto_id:'P', generado_por:(await sb.auth.getUser()).data.user.id,
--        secciones:['portada'], origen:'navegador', estado:'listo'}).select().single()).error?.code     // '42501'

-- ── Reversión ────────────────────────────────────────────────────────────────
-- Pierde el registro de todos los expedientes generados (en la fase 1 no hay
-- archivos asociados; en la fase 3 los PDF en Storage quedarían huérfanos).
--
-- begin;
--   drop trigger  if exists trg_exp_guard_update     on public.expedientes_generados;
--   drop trigger  if exists trg_exp_asignar_version  on public.expedientes_generados;
--   drop function if exists public.exp_guard_update();
--   drop function if exists public.exp_asignar_version();
--   drop policy   if exists exp_select on public.expedientes_generados;
--   drop policy   if exists exp_insert on public.expedientes_generados;
--   drop policy   if exists exp_update on public.expedientes_generados;
--   drop policy   if exists exp_delete on public.expedientes_generados;
--   drop index    if exists public.expedientes_generados_proyecto_idx;
--   drop table    if exists public.expedientes_generados;   -- se lleva las restricciones (unique, checks, FKs)
-- commit;
