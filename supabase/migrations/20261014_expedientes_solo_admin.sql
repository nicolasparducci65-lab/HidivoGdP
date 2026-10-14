-- ============================================================================
-- Expediente de obra: solo admin (global o admin del proyecto).
-- NO ejecutar automáticamente: revisar y aplicar a mano en el SQL Editor,
-- DESPUÉS de 20261014_expedientes_generados.sql (que ya está aplicada).
--
-- Qué hace: reemplaza exp_select, exp_insert y exp_update para quitar al
-- fiscalizador. Ver, generar y actualizar expedientes queda para admin global
-- o miembro del proyecto con rol 'admin'. exp_delete (admin global) y los
-- triggers (versión correlativa y guard de columnas) no cambian.
--
-- Efecto sobre filas existentes: ninguna se borra. Si un fiscalizador generó
-- expedientes antes de esta migración, siguen en la tabla y los ve el admin;
-- el fiscalizador deja de verlos.
-- ============================================================================

begin;

drop policy if exists exp_select on public.expedientes_generados;
create policy exp_select on public.expedientes_generados
  for select to authenticated
  using ((select sst_es_admin_global())
         or sst_rol_en_proyecto(proyecto_id) = 'admin');

drop policy if exists exp_insert on public.expedientes_generados;
create policy exp_insert on public.expedientes_generados
  for insert to authenticated
  with check (generado_por = (select auth.uid())
              and ((select sst_es_admin_global())
                   or sst_rol_en_proyecto(proyecto_id) = 'admin'));

drop policy if exists exp_update on public.expedientes_generados;
create policy exp_update on public.expedientes_generados
  for update to authenticated
  using ((select sst_es_admin_global())
         or (generado_por = (select auth.uid())
             and sst_rol_en_proyecto(proyecto_id) = 'admin'))
  with check ((select sst_es_admin_global())
              or (generado_por = (select auth.uid())
                  and sst_rol_en_proyecto(proyecto_id) = 'admin'));

commit;

-- ── Verificación (solo lectura) ─────────────────────────────────────────────
-- 1) Siguen siendo 4 políticas y ninguna menciona al fiscalizador:
--   select policyname, cmd, qual, with_check from pg_policies
--    where tablename = 'expedientes_generados' order by policyname;
--   -- exp_delete, exp_insert, exp_select, exp_update; ningún qual/with_check contiene 'fiscalizador'
--   select count(*) from pg_policies where tablename = 'expedientes_generados'
--      and (coalesce(qual,'') || coalesce(with_check,'')) like '%fiscalizador%';          -- 0
--
-- 2) Consola del navegador, PRUEBAS RLS (P = id del proyecto):
--   Fiscalizador (nicolas+fiscalizador@hidivo.com): ya no ve el bloque en Cierre, y
--     (await sb.from('expedientes_generados').select('id').eq('proyecto_id', P)).data             // []
--     (await sb.from('expedientes_generados').insert({proyecto_id:P, generado_por:(await sb.auth.getUser()).data.user.id,
--        secciones:['portada'], origen:'navegador', estado:'listo'}).select().single()).error?.code  // '42501'
--   Admin (cuenta de Nicolás): genera con normalidad y la lista muestra la fila nueva.

-- ── Reversión (vuelve a las políticas de 20261014_expedientes_generados.sql) ─
-- begin;
--   drop policy if exists exp_select on public.expedientes_generados;
--   create policy exp_select on public.expedientes_generados
--     for select to authenticated
--     using ((select sst_es_admin_global())
--            or sst_rol_en_proyecto(proyecto_id) in ('admin','fiscalizador'));
--   drop policy if exists exp_insert on public.expedientes_generados;
--   create policy exp_insert on public.expedientes_generados
--     for insert to authenticated
--     with check (generado_por = (select auth.uid())
--                 and ((select sst_es_admin_global())
--                      or sst_rol_en_proyecto(proyecto_id) in ('admin','fiscalizador')));
--   drop policy if exists exp_update on public.expedientes_generados;
--   create policy exp_update on public.expedientes_generados
--     for update to authenticated
--     using ((select sst_es_admin_global())
--            or (generado_por = (select auth.uid())
--                and sst_rol_en_proyecto(proyecto_id) in ('admin','fiscalizador')))
--     with check ((select sst_es_admin_global())
--                 or (generado_por = (select auth.uid())
--                     and sst_rol_en_proyecto(proyecto_id) in ('admin','fiscalizador')));
-- commit;
