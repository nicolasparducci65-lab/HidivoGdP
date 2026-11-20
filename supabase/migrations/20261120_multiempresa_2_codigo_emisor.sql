-- ============================================================================
-- Multiempresa 2/3: código de proyecto e historial del emisor documental.
-- NO ejecutar automáticamente: revisar y aplicar a mano en el SQL Editor,
-- DESPUÉS de 20261120_multiempresa_1_empresas.sql.
--
-- Qué hace:
--   · proyectos.codigo: formato SIGLA-TIP-AAAA-NNN e índice único. Sigue
--     siendo opcional para lo existente (la obligatoriedad al crear va en la
--     migración 3, que se aplica cuando la fase 2 esté publicada).
--   · proyecto_tiene_documentos_emitidos(uuid): planilla fuera de borrador,
--     orden de cambio aprobada, acta de recepción, liquidación o expediente.
--   · trg_proyectos_guard_codigo: un código ya asignado no se cambia ni se
--     borra si el proyecto tiene documentos emitidos.
--   · proyecto_siguiente_codigo(empresa, tipo, año): propone el siguiente
--     correlativo de esa sigla y ese año (lo usará el alta de proyectos).
--   · proyecto_emisor_historial: cada vez que cambia el emisor EFECTIVO de un
--     proyecto (coalesce(emisor_empresa_id, empresa_id)), el anterior queda
--     anotado con la fecha de corte `hasta`. Los documentos con fecha anterior
--     a `hasta` se imprimen con ese emisor; los de esa fecha en adelante, con
--     el vigente. `hasta` nace con la fecha del cambio (hora de Ecuador) y el
--     admin global puede corregirla.
--
-- La tabla nueva nace con RLS activado y SIN políticas (nadie autenticado la
-- lee) hasta aplicar docs/multiempresa/02 del repo privado.
-- ============================================================================

begin;

-- ── Código de proyecto ──────────────────────────────────────────────────────
alter table public.proyectos drop constraint if exists proyectos_codigo_chk;
alter table public.proyectos
  add constraint proyectos_codigo_chk
  check (codigo is null or codigo ~ '^[A-Z0-9]{2,5}-[A-Z]{3}-[0-9]{4}-[0-9]{3}$');

create unique index if not exists proyectos_codigo_uniq on public.proyectos (codigo) where codigo is not null;

create or replace function public.proyecto_tipo_abrev(p_tipo text) returns text
  language sql immutable
as $$
  select case p_tipo
    when 'fiscalizacion'  then 'FIS'
    when 'gerencia'       then 'GER'
    when 'disenos'        then 'DIS'
    when 'construccion'   then 'CON'
    when 'pilotes'        then 'PIL'
    when 'muros_pantalla' then 'MUR'
    when 'puentes'        then 'PUE'
  end;
$$;

create or replace function public.proyecto_tiene_documentos_emitidos(pid uuid) returns boolean
  language sql stable security definer
  set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from planillas_pago        where proyecto_id = pid and estado <> 'borrador')
      or exists (select 1 from ordenes_cambio        where proyecto_id = pid and estado = 'aprobada')
      or exists (select 1 from actas_recepcion       where proyecto_id = pid)
      or exists (select 1 from liquidaciones         where proyecto_id = pid)
      or exists (select 1 from expedientes_generados where proyecto_id = pid);
$$;

-- Siguiente código libre de la sigla en el año: el correlativo es por empresa y
-- año, sin importar el tipo. El índice único resuelve dos altas simultáneas.
create or replace function public.proyecto_siguiente_codigo(p_empresa uuid, p_tipo text, p_anio integer) returns text
  language plpgsql volatile security definer
  set search_path to 'public', 'pg_temp'
as $$
declare v_sigla text; v_abrev text; v_n integer;
begin
  select sigla into v_sigla from empresas where id = p_empresa;
  v_abrev := proyecto_tipo_abrev(p_tipo);
  if v_sigla is null or v_abrev is null or p_anio is null then return null; end if;
  select coalesce(max(right(codigo, 3)::integer), 0) + 1 into v_n
    from proyectos
   where codigo like v_sigla || '-___-' || p_anio::text || '-___';
  if v_n > 999 then return null; end if;
  return v_sigla || '-' || v_abrev || '-' || p_anio::text || '-' || lpad(v_n::text, 3, '0');
end $$;

create or replace function public.proyectos_guard_codigo() returns trigger
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $$
begin
  if old.codigo is null or new.codigo is not distinct from old.codigo then return new; end if;
  -- Exentos: service_role y sesión sin JWT (SQL Editor), para corregir errores.
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then return new; end if;
  if proyecto_tiene_documentos_emitidos(old.id) then
    raise exception 'El código % no se puede cambiar: el proyecto ya tiene documentos emitidos.', old.codigo
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_proyectos_guard_codigo on public.proyectos;
create trigger trg_proyectos_guard_codigo before update of codigo on public.proyectos
  for each row execute function public.proyectos_guard_codigo();

revoke all on function public.proyecto_tiene_documentos_emitidos(uuid) from public;
revoke all on function public.proyecto_siguiente_codigo(uuid, text, integer) from public;
grant execute on function public.proyecto_tiene_documentos_emitidos(uuid) to authenticated, service_role;
grant execute on function public.proyecto_siguiente_codigo(uuid, text, integer) to authenticated, service_role;

-- ── Historial del emisor ────────────────────────────────────────────────────
create table if not exists public.proyecto_emisor_historial (
  id             uuid primary key default gen_random_uuid(),
  proyecto_id    uuid not null references public.proyectos(id) on delete cascade,
  empresa_id     uuid not null references public.empresas(id),
  hasta          date not null,
  registrado_por uuid,
  creado_en      timestamptz not null default now()
);
comment on table public.proyecto_emisor_historial is
  'Emisores anteriores de un proyecto. Un documento con fecha < hasta se imprime con empresa_id; si hay varias filas, la de menor hasta que sea posterior a la fecha.';

create index if not exists proyecto_emisor_historial_proy_idx on public.proyecto_emisor_historial (proyecto_id, hasta);

alter table public.proyecto_emisor_historial enable row level security;

grant select, insert, update, delete on public.proyecto_emisor_historial to authenticated;
grant all on public.proyecto_emisor_historial to service_role;

create or replace function public.proyectos_anotar_emisor() returns trigger
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $$
declare antes uuid := coalesce(old.emisor_empresa_id, old.empresa_id);
        ahora uuid := coalesce(new.emisor_empresa_id, new.empresa_id);
begin
  if antes is not null and antes is distinct from ahora then
    insert into proyecto_emisor_historial (proyecto_id, empresa_id, hasta, registrado_por)
    values (old.id, antes, (now() at time zone 'America/Guayaquil')::date, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_proyectos_anotar_emisor on public.proyectos;
create trigger trg_proyectos_anotar_emisor after update of empresa_id, emisor_empresa_id on public.proyectos
  for each row execute function public.proyectos_anotar_emisor();

commit;

-- ── Verificación (solo lectura salvo el punto 3, que hace ROLLBACK) ─────────
-- 1) Objetos creados:
--   select tgname from pg_trigger where tgrelid = 'public.proyectos'::regclass and not tgisinternal order by 1;
--   -- incluye trg_proyectos_guard_codigo y trg_proyectos_anotar_emisor
--   select relrowsecurity from pg_class where oid = 'public.proyecto_emisor_historial'::regclass;   -- true
-- 2) Siguiente código de la gestora (sin códigos cargados devuelve HDV-FIS-2026-001):
--   select public.proyecto_siguiente_codigo((select id from public.empresas where sigla = 'HDV'), 'fiscalizacion', 2026);
-- 3) El cambio de emisor deja historial y el formato del código se valida (no deja nada escrito):
--   begin;
--     insert into public.empresas (nombre, sigla) values ('Emisor de prueba', 'ZZZ');
--     update public.proyectos set emisor_empresa_id = (select id from public.empresas where sigla = 'ZZZ')
--      where nombre = 'PRUEBAS RLS';
--     select e.sigla, h.hasta from public.proyecto_emisor_historial h join public.empresas e on e.id = h.empresa_id;
--     -- 1 fila: HDV, fecha de hoy
--     update public.proyectos set codigo = 'mal' where nombre = 'PRUEBAS RLS';   -- ERROR proyectos_codigo_chk
--   rollback;

-- ── Reversión ───────────────────────────────────────────────────────────────
-- begin;
--   drop trigger if exists trg_proyectos_anotar_emisor on public.proyectos;
--   drop trigger if exists trg_proyectos_guard_codigo on public.proyectos;
--   drop function if exists public.proyectos_anotar_emisor();
--   drop function if exists public.proyectos_guard_codigo();
--   drop table if exists public.proyecto_emisor_historial;      -- pierde el historial anotado
--   drop function if exists public.proyecto_siguiente_codigo(uuid, text, integer);
--   drop function if exists public.proyecto_tiene_documentos_emitidos(uuid);
--   drop function if exists public.proyecto_tipo_abrev(text);
--   drop index if exists public.proyectos_codigo_uniq;
--   alter table public.proyectos drop constraint if exists proyectos_codigo_chk;
-- commit;
