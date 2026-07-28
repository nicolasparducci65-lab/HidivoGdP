-- PUNTO 5 — PARCHE DE ACCESO ANÓNIMO
-- ====================================================================
-- ESTADO: BLOQUE A EJECUTADO el 2026-07-28 (verificado en pg_policies).
-- BLOQUE B pendiente: ejecutar cuando registro-obra.html (ya migrado a la
-- Edge Function registro-obra-publico con token) esté probado con un
-- registro real de campo.
-- ====================================================================
-- Contexto (diagnóstico 2026-07-28): con la publishable key que está en el
-- HTML, un visitante SIN LOGIN hoy puede:
--   · leer todos los proyectos (montos, contratistas, contrato_datos)
--   · leer y ACTUALIZAR rubros (cantidades/montos)
--   · leer archivos, catalogo_items, libro_obra_fotos, libro_obra_items
--   · insertar en libro_obra, libro_obra_items, libro_obra_rubros,
--     libro_obra_fotos
--   · subir objetos a los buckets hidivo-fotos e hidivo-archivos
--
-- ⚠️ HALLAZGO CLAVE: ese acceso anónimo NO es accidental en su mayoría — es el
-- backend de registro-obra.html, el formulario público del Libro de Obra que
-- se comparte por link al personal de obra (sin cuenta). Flujos anónimos del
-- formulario (registro-obra.html, líneas):
--   321  proyectos SELECT (por id)          → política "Ver proyectos"
--   333  libro_obra SELECT count            → política INSERT/SELECT libro_obra
--   337  catalogo_items SELECT              → política "Ver catalogo"
--   359  rubros SELECT                      → política "Lectura publica rubros"
--   555+ libro_obra / _items / _rubros / _fotos INSERT
--   576  rubros UPDATE (suma cantidad)      → política "Actualizacion publica rubros"
--   522/597 storage upload a ambos buckets  → "Subir fotos publico" / "Subir archivos publicos"
--   600  archivos INSERT — NOTA: esto YA FALLA hoy en silencio (la política
--        exige auth.uid() IS NOT NULL y el error no se comprueba).
--
-- Por eso el parche va en DOS BLOQUES:
--   BLOQUE A: seguro — no rompe ningún flujo actual. Ejecutable ya.
--   BLOQUE B: cierra el resto del acceso anónimo PERO DESHABILITA
--             registro-obra.html hasta que se migre a un flujo con token
--             (Edge Function) en FASE 2. Ejecutar solo si se acepta eso.

-- ====================================================================
-- BLOQUE A — SEGURO (ningún flujo actual lo usa de forma legítima)
-- ====================================================================

-- A1. perfiles: DELETE hoy es USING(true) para cualquier autenticado —
--     cualquiera puede borrar cualquier perfil. Solo el admin global debe
--     poder (la app lo invoca únicamente desde Usuarios). Reutiliza el helper
--     sst_es_admin_global() que ya existe.
DROP POLICY "admin elimina perfiles" ON public.perfiles;
CREATE POLICY "admin global elimina perfiles" ON public.perfiles
  FOR DELETE TO authenticated
  USING (sst_es_admin_global());

-- A2. proyecto_miembros INSERT: hoy basta estar logueado para darse cualquier
--     rol en cualquier proyecto (incluido 'admin' de proyecto → abre Usuarios,
--     PERMISOS.md I-11). Flujos legítimos verificados en la app:
--       · guardarMiembro (Usuarios, la ejecuta el admin)
--       · guardarProyecto (el creador se inserta a sí mismo como fiscalizador;
--         ⚠️ los FISCALIZADORES también crean proyectos — I-4 — así que
--         restringir a solo-admin ROMPERÍA silenciosamente esa creación:
--         el insert de membresía no comprueba error).
--     Política recomendada: admin global, O auto-inserción del creador real
--     del proyecto. (Variante estricta solo-admin al final, comentada.)
DROP POLICY "Propietario puede agregar miembros" ON public.proyecto_miembros;
CREATE POLICY "admin o creador agrega miembros" ON public.proyecto_miembros
  FOR INSERT TO authenticated
  WITH CHECK (
    sst_es_admin_global()
    OR (
      usuario_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.proyectos p
        WHERE p.id = proyecto_id AND p.created_by = auth.uid()
      )
    )
  );
-- Variante estricta (solo admin global) — usar SOLO si antes se restringe la
-- creación de proyectos a admin en la app:
-- CREATE POLICY "solo admin agrega miembros" ON public.proyecto_miembros
--   FOR INSERT TO authenticated WITH CHECK (sst_es_admin_global());

-- A3. proyecto_miembros DELETE: hoy USING(true) — cualquiera puede expulsar a
--     todos. Solo lo usan eliminarUsuario/eliminarMiembro (Usuarios, admin).
DROP POLICY "eliminar miembros" ON public.proyecto_miembros;
CREATE POLICY "admin global elimina miembros" ON public.proyecto_miembros
  FOR DELETE TO authenticated
  USING (sst_es_admin_global());

-- A4. Lectura anónima que el formulario público NO usa (solo inserta):
DROP POLICY "Ver fotos libro obra" ON public.libro_obra_fotos;
CREATE POLICY "Ver fotos libro obra" ON public.libro_obra_fotos
  FOR SELECT TO authenticated USING (true);

DROP POLICY "Ver items libro" ON public.libro_obra_items;
CREATE POLICY "Ver items libro" ON public.libro_obra_items
  FOR SELECT TO authenticated USING (true);

-- A5. archivos SELECT anónimo: la app siempre lo lee logueada y el formulario
--     no lo lee (las URLs públicas de Storage no pasan por esta tabla).
DROP POLICY "Ver archivos" ON public.archivos;
CREATE POLICY "Ver archivos" ON public.archivos
  FOR SELECT TO authenticated USING (true);

-- ====================================================================
-- BLOQUE B — CIERRA EL RESTO DEL ANÓNIMO (⛔ deshabilita registro-obra.html)
-- ====================================================================
-- Ejecutar solo cuando se decida: (a) prescindir del formulario público, o
-- (b) tras migrarlo a una Edge Function con token firmado (FASE 2).

-- B1. proyectos: quitar el "OR true" — solo autenticados leen.
--     (Rompe registro-obra.html:321.)
-- DROP POLICY "Ver proyectos" ON public.proyectos;
-- CREATE POLICY "Ver proyectos" ON public.proyectos
--   FOR SELECT TO authenticated USING (true);

-- B2. rubros: eliminar lectura y sobre todo la ACTUALIZACIÓN anónima.
--     (Rompe registro-obra.html:359 y 576.)
-- DROP POLICY "Lectura publica rubros" ON public.rubros;
-- DROP POLICY "Actualizacion publica rubros" ON public.rubros;
--     (Las políticas duplicadas "Actualizar rubros" y "Miembros pueden
--      actualizar rubros" exigen login; pueden quedarse o consolidarse.)

-- B3. catalogo_items: solo autenticados. (Rompe registro-obra.html:337.)
-- DROP POLICY "Ver catalogo" ON public.catalogo_items;
-- CREATE POLICY "Ver catalogo" ON public.catalogo_items
--   FOR SELECT TO authenticated USING (true);

-- B4. Inserción anónima del Libro de Obra. (Rompe el envío del formulario.)
-- DROP POLICY "Insertar items libro" ON public.libro_obra_items;
-- CREATE POLICY "Insertar items libro" ON public.libro_obra_items
--   FOR INSERT TO authenticated WITH CHECK (true);
-- DROP POLICY "Insertar fotos publico" ON public.libro_obra_fotos;
-- CREATE POLICY "Insertar fotos publico" ON public.libro_obra_fotos
--   FOR INSERT TO authenticated WITH CHECK (true);
--   (Revisar igual las políticas INSERT de libro_obra y libro_obra_rubros,
--    que hoy tienen WITH CHECK (true) para {public}.)

-- B5. Storage: eliminar la subida anónima. Quedan las políticas de subida
--     para autenticados que ya existen ("Authenticated puede subir a …",
--     "Subir archivos autenticados"). La lectura pública por URL se mantiene
--     (la app depende de getPublicUrl). (Rompe registro-obra.html:522/597.)
-- DROP POLICY "Subir fotos publico" ON storage.objects;
-- DROP POLICY "Subir archivos publicos" ON storage.objects;
