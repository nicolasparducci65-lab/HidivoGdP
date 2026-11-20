-- ============================================================================
-- Multiempresa 1/3: empresas (gestora y emisor) y columnas nuevas de proyectos.
-- NO ejecutar automáticamente: revisar y aplicar a mano en el SQL Editor.
-- Orden: esta → políticas de empresas (repo privado, docs/multiempresa/01) →
--        20261120_multiempresa_2_codigo_emisor.sql → políticas del historial
--        (repo privado, docs/multiempresa/02).
--
-- Qué hace:
--   · Reutiliza public.empresas (ya existía: id, nombre, ruc, logo_url). Le
--     añade sigla, razon_social, color, logo_data, es_gestora y activa.
--   · Las filas que ya había (pruebas de junio) quedan con activa = false.
--     NO se borran: formatos_calidad_plantillas y subcontratistas apuntan a
--     empresas con ON DELETE CASCADE.
--   · Siembra la empresa gestora de la instancia (sigla HDV). Las demás
--     empresas (emisores no gestores, la empresa nueva) se crean desde la app
--     o con el SQL del repo privado.
--   · proyectos: empresa_id (ya existía, vacía) pasa a ser la GESTORA: se
--     rellena con HDV y queda NOT NULL. Columnas nuevas: emisor_empresa_id
--     (NULL = emite la gestora), tipo y codigo (las reglas de codigo van en
--     la migración 2).
--   · Trigger proyectos_a_gestora: si un INSERT llega sin empresa_id (la app
--     publicada todavía no la envía) toma la del perfil del creador y, si no
--     tiene, la única gestora activa. Con dos gestoras activas y sin dato, el
--     INSERT falla con un mensaje claro en vez de adivinar.
--   · Trigger proyectos_guard_gestora: cambiar la gestora de un proyecto es
--     solo del admin global.
--
-- Efecto sobre la app publicada (SW v51): ninguno visible. Crear y editar
-- proyectos sigue funcionando sin enviar las columnas nuevas.
-- ============================================================================

begin;

-- ── empresas ────────────────────────────────────────────────────────────────
alter table public.empresas
  add column if not exists sigla        text,
  add column if not exists razon_social text,
  add column if not exists color        text,
  add column if not exists logo_data    text,
  add column if not exists es_gestora   boolean not null default false,
  add column if not exists activa       boolean not null default true;

comment on column public.empresas.nombre     is 'Nombre corto, el que se muestra en filtros y distintivos.';
comment on column public.empresas.sigla      is 'Prefijo del código de proyecto (2 a 5 mayúsculas o dígitos). Única.';
comment on column public.empresas.logo_data  is 'Logo como data URI (data:image/...;base64,...). NULL = documento sin logo.';
comment on column public.empresas.logo_url   is 'En desuso: el logo vive en logo_data.';
comment on column public.empresas.es_gestora is 'true = administra proyectos en la plataforma. false = solo emite documentos.';

-- Lo que había antes de esta migración no es una empresa del sistema.
update public.empresas set activa = false where sigla is null;

alter table public.empresas
  drop constraint if exists empresas_sigla_chk,
  drop constraint if exists empresas_color_chk,
  drop constraint if exists empresas_logo_data_chk;
alter table public.empresas
  add constraint empresas_sigla_chk     check (sigla is null or sigla ~ '^[A-Z0-9]{2,5}$'),
  add constraint empresas_color_chk     check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint empresas_logo_data_chk check (logo_data is null
                                               or (logo_data like 'data:image/%' and length(logo_data) <= 300000));

create unique index if not exists empresas_sigla_uniq on public.empresas (sigla) where sigla is not null;

-- Gestora de la instancia. Razón social, RUC, color y logo se completan en la
-- pantalla Empresas (fase 2) o con un UPDATE a mano.
insert into public.empresas (nombre, sigla, es_gestora, activa)
select 'HIDIVO', 'HDV', true, true
 where not exists (select 1 from public.empresas where sigla = 'HDV');

grant select, insert, update, delete on public.empresas to authenticated;
grant all on public.empresas to service_role;

-- ── proyectos ───────────────────────────────────────────────────────────────
alter table public.proyectos
  add column if not exists emisor_empresa_id uuid references public.empresas(id),
  add column if not exists tipo   text,
  add column if not exists codigo text;

comment on column public.proyectos.empresa_id        is 'Empresa GESTORA: quién administra el proyecto y en qué cartera aparece.';
comment on column public.proyectos.emisor_empresa_id is 'Emisor documental (membrete, razón social, RUC). NULL = la gestora.';
comment on column public.proyectos.tipo              is 'fiscalizacion | gerencia | disenos | construccion | pilotes | muros_pantalla | puentes';
comment on column public.proyectos.codigo            is 'Identificador corto, único y estable: SIGLA-TIP-AAAA-NNN.';

alter table public.proyectos drop constraint if exists proyectos_tipo_chk;
alter table public.proyectos
  add constraint proyectos_tipo_chk check (tipo is null or tipo in
    ('fiscalizacion','gerencia','disenos','construccion','pilotes','muros_pantalla','puentes'));

-- Backfill: todo lo existente queda gestionado por HDV y con emisor NULL.
update public.proyectos
   set empresa_id = (select id from public.empresas where sigla = 'HDV')
 where empresa_id is null;

alter table public.proyectos alter column empresa_id set not null;

create index if not exists proyectos_empresa_idx on public.proyectos (empresa_id);

-- ── Gestora por defecto al insertar ─────────────────────────────────────────
create or replace function public.proyectos_a_gestora() returns trigger
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $$
declare n integer;
begin
  if new.empresa_id is null then
    select p.empresa_id into new.empresa_id from perfiles p where p.id = auth.uid();
  end if;
  if new.empresa_id is null then
    select count(*) into n from empresas where es_gestora and activa;
    if n = 1 then
      select id into new.empresa_id from empresas where es_gestora and activa;
    else
      raise exception 'Falta la empresa gestora del proyecto.' using errcode = '23502';
    end if;
  end if;
  if not exists (select 1 from empresas e where e.id = new.empresa_id and e.es_gestora and e.activa) then
    raise exception 'La empresa indicada no es una gestora activa.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_proyectos_a_gestora on public.proyectos;
create trigger trg_proyectos_a_gestora before insert on public.proyectos
  for each row execute function public.proyectos_a_gestora();

-- ── Reasignar la gestora: solo admin global ─────────────────────────────────
create or replace function public.proyectos_guard_gestora() returns trigger
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $$
begin
  if new.empresa_id is not distinct from old.empresa_id then return new; end if;
  if not exists (select 1 from empresas e where e.id = new.empresa_id and e.es_gestora and e.activa) then
    raise exception 'La empresa indicada no es una gestora activa.' using errcode = '23514';
  end if;
  -- Exentos: service_role y sesión sin JWT (SQL Editor).
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then return new; end if;
  if sst_es_admin_global() then return new; end if;
  raise exception 'Solo un administrador global puede reasignar la empresa gestora de un proyecto.'
    using errcode = '42501';
end $$;

drop trigger if exists trg_proyectos_guard_gestora on public.proyectos;
create trigger trg_proyectos_guard_gestora before update of empresa_id on public.proyectos
  for each row execute function public.proyectos_guard_gestora();

commit;

-- ── Verificación (solo lectura) ─────────────────────────────────────────────
-- 1) Una gestora activa (HDV) y las filas viejas inactivas:
--   select nombre, sigla, es_gestora, activa from public.empresas order by activa desc, nombre;
-- 2) Ningún proyecto sin gestora; todos en HDV, emisor/tipo/codigo vacíos:
--   select e.sigla, count(*) as proyectos, count(p.emisor_empresa_id) as con_emisor,
--          count(p.tipo) as con_tipo, count(p.codigo) as con_codigo
--     from public.proyectos p join public.empresas e on e.id = p.empresa_id group by e.sigla;
-- 3) Triggers creados:
--   select tgname from pg_trigger where tgrelid = 'public.proyectos'::regclass and not tgisinternal order by 1;
--   -- incluye trg_proyectos_a_gestora y trg_proyectos_guard_gestora
-- 4) En la app publicada: crear un proyecto de prueba y borrarlo. Debe guardarse
--    y quedar con la gestora HDV.

-- ── Reversión ───────────────────────────────────────────────────────────────
-- (Si ya se aplicó la migración 2, revertir primero aquella.)
-- begin;
--   drop trigger if exists trg_proyectos_guard_gestora on public.proyectos;
--   drop trigger if exists trg_proyectos_a_gestora on public.proyectos;
--   drop function if exists public.proyectos_guard_gestora();
--   drop function if exists public.proyectos_a_gestora();
--   drop index if exists public.proyectos_empresa_idx;
--   alter table public.proyectos alter column empresa_id drop not null;
--   update public.proyectos set empresa_id = null;
--   alter table public.proyectos
--     drop constraint if exists proyectos_tipo_chk,
--     drop column if exists codigo, drop column if exists tipo, drop column if exists emisor_empresa_id;
--   delete from public.empresas where sigla is not null;   -- solo las creadas desde esta migración
--   drop index if exists public.empresas_sigla_uniq;
--   alter table public.empresas
--     drop constraint if exists empresas_sigla_chk, drop constraint if exists empresas_color_chk,
--     drop constraint if exists empresas_logo_data_chk,
--     drop column if exists activa, drop column if exists es_gestora, drop column if exists logo_data,
--     drop column if exists color, drop column if exists razon_social, drop column if exists sigla;
-- commit;
