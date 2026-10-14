-- ============================================================================
-- Actas de recepción: texto editado persistente.
-- NO ejecutar automáticamente: revisar y aplicar a mano en el SQL Editor.
--
-- Qué hace:
--   1) actas_recepcion.contenido_html: HTML del acta (cuerpo y firmas) editado y
--      guardado desde la ventana de impresión con el botón «Guardar acta».
--      NULL = se usa la plantilla con los datos de la fila (como hasta ahora).
--      actas_recepcion.contenido_actualizado_en: cuándo se guardó por última vez;
--      el expediente lo muestra como «Acta según texto guardado el …».
--   2) Política ola1_update: la tabla solo tenía ola1_insert y ola1_select, así que
--      nadie podía guardar el texto. Mismo predicado que ola1_insert (admin global
--      o admin/fiscalizador del proyecto).
--
-- La app sanea el HTML al guardar y al renderizar (sanitizarHtmlActa): sin
-- script, iframe, object, atributos on* ni URLs javascript:.
-- ============================================================================

begin;

alter table public.actas_recepcion
  add column if not exists contenido_html text,
  add column if not exists contenido_actualizado_en timestamptz;

comment on column public.actas_recepcion.contenido_html is
  'HTML del acta (cuerpo y firmas) editado y guardado desde la ventana de impresión. NULL = se usa la plantilla con los datos de la fila.';
comment on column public.actas_recepcion.contenido_actualizado_en is
  'Última vez que se guardó contenido_html; NULL si no hay texto guardado.';

drop policy if exists ola1_update on public.actas_recepcion;
create policy ola1_update on public.actas_recepcion
  for update to authenticated
  using ((select sst_es_admin_global())
         or sst_rol_en_proyecto(proyecto_id) in ('admin','fiscalizador'))
  with check ((select sst_es_admin_global())
              or sst_rol_en_proyecto(proyecto_id) in ('admin','fiscalizador'));

commit;

-- ── Verificación (solo lectura, salvo la prueba 3 que se revierte) ──────────
-- 1) Columnas:
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_name = 'actas_recepcion' and column_name in ('contenido_html','contenido_actualizado_en');  -- 2 filas, YES
--
-- 2) Políticas: ahora ola1_insert, ola1_select y ola1_update.
--   select policyname, cmd from pg_policies where tablename = 'actas_recepcion' order by 1;
--
-- 3) Guardar desde el SQL Editor y revertir (A = id de un acta):
--   begin;
--     update public.actas_recepcion set contenido_html = '<p>prueba</p>', contenido_actualizado_en = now() where id = 'A';  -- UPDATE 1
--   rollback;
--
-- 4) Consola del navegador, PRUEBAS RLS (A = id de un acta de ese proyecto):
--   Fiscalizador: (await sb.from('actas_recepcion').update({contenido_html:'<p>x</p>'}).eq('id', A)).error   // null
--   Residente:    (await sb.from('actas_recepcion').update({contenido_html:'<p>x</p>'}).eq('id', A)).data    // [] (RLS: 0 filas)
--   En la app, Contrato → Cierre → PDF del acta: botón «Guardar acta»; al reabrir, carga el
--   texto guardado y aparece «Restablecer plantilla».

-- ── Reversión ────────────────────────────────────────────────────────────────
-- Pierde el texto guardado de todas las actas (vuelven a la plantilla).
-- begin;
--   drop policy if exists ola1_update on public.actas_recepcion;
--   alter table public.actas_recepcion
--     drop column if exists contenido_actualizado_en,
--     drop column if exists contenido_html;
-- commit;
