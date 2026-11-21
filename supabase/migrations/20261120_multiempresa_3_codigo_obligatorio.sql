-- ============================================================================
-- Multiempresa 3/3: tipo y código obligatorios para proyectos NUEVOS.
-- NO ejecutar automáticamente. APLICAR SOLO CUANDO LA FASE 2 ESTÉ PUBLICADA:
-- la app anterior (SW v51) crea proyectos sin tipo y con esta migración
-- dejaría de poder crearlos.
--
-- Qué hace: trigger BEFORE INSERT en proyectos (corre después de
-- trg_proyectos_a_gestora, por orden alfabético):
--   · sin tipo, rechaza el alta;
--   · sin código, lo asigna con proyecto_siguiente_codigo(emisor o, si no tiene, gestora, tipo, año),
--     donde año = el de fecha_inicio o, si falta, el año en curso en Ecuador.
-- Los proyectos existentes no se tocan: pueden seguir sin código hasta que se
-- les asigne con el CSV revisado.
-- ============================================================================

begin;

create or replace function public.proyectos_b_codigo() returns trigger
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $$
declare v_anio integer;
begin
  if new.tipo is null then
    raise exception 'Falta el tipo de proyecto.' using errcode = '23502';
  end if;
  if new.codigo is null then
    v_anio := extract(year from coalesce(new.fecha_inicio, (now() at time zone 'America/Guayaquil')::date))::integer;
    new.codigo := proyecto_siguiente_codigo(coalesce(new.emisor_empresa_id, new.empresa_id), new.tipo, v_anio);
    if new.codigo is null then
      raise exception 'No se pudo asignar el código del proyecto: la empresa emisora (o la gestora) no tiene sigla.'
        using errcode = '23502';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_proyectos_b_codigo on public.proyectos;
create trigger trg_proyectos_b_codigo before insert on public.proyectos
  for each row execute function public.proyectos_b_codigo();

commit;

-- ── Verificación (hace ROLLBACK, no deja nada escrito) ──────────────────────
--   begin;
--     insert into public.proyectos (nombre) values ('zz sin tipo');                         -- ERROR: Falta el tipo de proyecto.
--   rollback;
--   begin;
--     insert into public.proyectos (nombre, tipo, fecha_inicio) values ('zz con tipo', 'pilotes', '2027-03-01')
--       returning codigo;                                                                   -- HDV-PIL-2027-00N (el siguiente libre de HDV en 2027)
--   rollback;

-- ── Reversión ───────────────────────────────────────────────────────────────
-- begin;
--   drop trigger if exists trg_proyectos_b_codigo on public.proyectos;
--   drop function if exists public.proyectos_b_codigo();
-- commit;
