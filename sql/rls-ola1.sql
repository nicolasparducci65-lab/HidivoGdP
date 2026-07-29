-- ============================================================================
-- RLS OLA 1 — Blindaje a nivel de datos del núcleo financiero (15 tablas)
-- ============================================================================
-- ESTADO: APLICADO el 2026-07-29 (43 políticas ola1_*, 0 USING(true)
-- restantes, verificado en pg_policies). Pruebas: PRUEBAS-RLS-OLA1.md (9/9).
-- ============================================================================
-- Especificación: matriz PERMISOS (constantes.js) + PERMISOS.md.
-- Decisiones del mapeo (2026-07-29): D1 fiscalizador puede crear proyectos;
-- D2 UPDATE completo de proyectos para fiscalizador (trigger de columnas →
-- Ola 1.5); D3 residente actualiza rubros sin restricción de columnas
-- (trigger → Ola 1.5, prioridad alta); D4 DELETE de rubros admin+fiscalizador
-- (lo exige importarRubrosExcel); D5 estados de planilla aproximados por
-- política (máquina de estados → Ola 1.5); D6 no-miembros dejan de ver
-- Contrato (muere I-3); D7 visualizador/cliente sin escritura (sella I-8).
-- La regla "liquidado = solo lectura" (I-15) NO va en esta ola.
-- Endurecimientos diferidos: ver OLA-1.5.md.
--
-- Helpers (ya existen, STABLE SECURITY DEFINER):
--   sst_es_admin_global()        → perfiles.rol = 'admin'
--   sst_rol_en_proyecto(uuid)    → proyecto_miembros.rol del usuario, o NULL
-- Rendimiento: sst_es_admin_global() y auth.uid() van SIEMPRE en subselect
-- escalar (se evalúan una vez por consulta, no por fila). sst_rol_en_proyecto
-- depende de la fila y se evalúa por fila (igual que en las políticas sst_*).
--
-- ============================================================================
-- BLOQUE DE REVERSIÓN (rollback en un minuto)
-- ============================================================================
-- Para revertir: ejecutar los DROP de las políticas ola1_* y luego los CREATE
-- de abajo, que reproducen EXACTAMENTE las 23 políticas existentes hoy
-- (extraídas de pg_policies el 2026-07-29, antes de esta ola).
/*
-- 1) Eliminar las políticas de la ola:
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies
           WHERE schemaname='public' AND policyname LIKE 'ola1_%'
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- 2) Restaurar las políticas previas:
CREATE POLICY "auth_all_actas" ON public.actas_recepcion FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_contrato_anticipo" ON public.contrato_anticipo FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "acceso total autenticado" ON public.cronograma_rubros FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_garantias" ON public.garantias FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_lineas_base" ON public.lineas_base FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_liquidaciones" ON public.liquidaciones FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_oc_items" ON public.orden_cambio_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_ordenes_cambio" ON public.ordenes_cambio FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "acceso" ON public.planilla_archivos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "acceso" ON public.planilla_historial FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "acceso" ON public.planilla_rubros FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "acceso" ON public.planillas_pago FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "acceso proyectos" ON public.proyectos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Ver proyectos" ON public.proyectos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Usuarios autenticados pueden crear proyectos" ON public.proyectos FOR INSERT TO public WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Creador puede actualizar su proyecto" ON public.proyectos FOR UPDATE TO public USING (auth.uid() = created_by);
CREATE POLICY "Creador puede eliminar su proyecto" ON public.proyectos FOR DELETE TO public USING (auth.uid() = created_by);
CREATE POLICY "auth_all_reajuste" ON public.reajuste_terminos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "acceso rubros" ON public.rubros FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Miembros ven rubros de su proyecto" ON public.rubros FOR SELECT TO public USING (auth.uid() IN (SELECT proyecto_miembros.perfil_id FROM proyecto_miembros WHERE proyecto_miembros.proyecto_id = rubros.proyecto_id));
CREATE POLICY "Miembros pueden insertar rubros" ON public.rubros FOR INSERT TO public WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Actualizar rubros" ON public.rubros FOR UPDATE TO public USING (auth.uid() IS NOT NULL);
CREATE POLICY "Miembros pueden actualizar rubros" ON public.rubros FOR UPDATE TO public USING (auth.uid() IS NOT NULL);
*/

-- ============================================================================
-- 1. PROYECTOS
-- ============================================================================
DROP POLICY "acceso proyectos" ON public.proyectos;
DROP POLICY "Ver proyectos" ON public.proyectos;
DROP POLICY "Usuarios autenticados pueden crear proyectos" ON public.proyectos;
DROP POLICY "Creador puede actualizar su proyecto" ON public.proyectos;
DROP POLICY "Creador puede eliminar su proyecto" ON public.proyectos;

-- PERMISOS[dashboard/proyectos/cartera]: todo miembro ve sus proyectos;
-- admin global ve todos (Cartera/Reportes/Usuarios del admin dependen de esto).
-- La cláusula created_by es imprescindible para el bootstrap de creación:
-- guardarProyecto hace INSERT ... RETURNING (.select().single()) cuando el
-- creador AÚN no tiene membresía, y la política de proyecto_miembros del
-- Bloque A ("admin o creador agrega miembros") consulta proyectos bajo RLS
-- para validar al creador. Sin este OR, ambos pasos fallan.
CREATE POLICY "ola1_select" ON public.proyectos FOR SELECT TO authenticated
  USING ( (SELECT sst_es_admin_global())
          OR sst_rol_en_proyecto(id) IS NOT NULL
          OR created_by = (SELECT auth.uid()) );

-- PERMISOS[proyectos]: admin y fiscalizador gestionan (D1/I-4: fiscalizador
-- crea; exige created_by propio y ser fiscalizador en ALGÚN proyecto).
-- CASO BORDE aceptado (D1): un fiscalizador sin ninguna membresía todavía no
-- puede crear su primer proyecto — en la operación real el admin siempre
-- otorga la primera membresía, así que el flujo no cambia.
CREATE POLICY "ola1_insert" ON public.proyectos FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT sst_es_admin_global())
    OR ( created_by = (SELECT auth.uid())
         AND EXISTS ( SELECT 1 FROM proyecto_miembros pm
                      WHERE pm.usuario_id = (SELECT auth.uid())
                        AND pm.rol = 'fiscalizador' ) )
  );

-- PERMISOS[proyectos]: edición admin; fiscalizador necesita UPDATE por el
-- cierre (actas/liquidación → estado_cierre) y la extracción IA del contrato.
-- D2: UPDATE completo para fiscalizador en esta ola (columnas → Ola 1.5).
CREATE POLICY "ola1_update" ON public.proyectos FOR UPDATE TO authenticated
  USING ( (SELECT sst_es_admin_global()) OR sst_rol_en_proyecto(id) = 'fiscalizador' )
  WITH CHECK ( (SELECT sst_es_admin_global()) OR sst_rol_en_proyecto(id) = 'fiscalizador' );

-- PERMISOS[proyectos]: eliminar solo admin.
CREATE POLICY "ola1_delete" ON public.proyectos FOR DELETE TO authenticated
  USING ( (SELECT sst_es_admin_global()) );

-- ============================================================================
-- 2. RUBROS
-- ============================================================================
DROP POLICY "acceso rubros" ON public.rubros;
DROP POLICY "Miembros ven rubros de su proyecto" ON public.rubros;
DROP POLICY "Miembros pueden insertar rubros" ON public.rubros;
DROP POLICY "Actualizar rubros" ON public.rubros;
DROP POLICY "Miembros pueden actualizar rubros" ON public.rubros;

-- Lectura transversal: dashboard, cartera, libro, planillas, subcontratistas,
-- curva S y reportes la leen para TODO rol con membresía (incluido cliente).
CREATE POLICY "ola1_select" ON public.rubros FOR SELECT TO authenticated
  USING ( (SELECT sst_es_admin_global()) OR sst_rol_en_proyecto(proyecto_id) IS NOT NULL );

-- PERMISOS[rubros]: gestionan admin y fiscalizador (incluye aprobarOC, que
-- inserta rubros de orden de cambio).
CREATE POLICY "ola1_insert" ON public.rubros FOR INSERT TO authenticated
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );

-- D3: el residente actualiza cantidad_ejecutada/estado desde el Libro de Obra
-- (guardar/editar/eliminar registro + sincronización offline). Sin restricción
-- de columnas en esta ola → trigger en Ola 1.5 (PRIORIDAD ALTA).
CREATE POLICY "ola1_update" ON public.rubros FOR UPDATE TO authenticated
  USING ( (SELECT sst_es_admin_global())
          OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador','residente') )
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador','residente') );

-- D4: DELETE para admin + fiscalizador — importarRubrosExcel (flujo real del
-- fiscalizador) hace DELETE masivo + reinserción. "Eliminar todos" de la UI
-- sigue siendo solo-admin por gate de interfaz.
CREATE POLICY "ola1_delete" ON public.rubros FOR DELETE TO authenticated
  USING ( (SELECT sst_es_admin_global())
          OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );

-- ============================================================================
-- 3. ORDENES_CAMBIO — PERMISOS[rubros]: "OC solo admin/fiscalizador"
-- ============================================================================
DROP POLICY "auth_all_ordenes_cambio" ON public.ordenes_cambio;

CREATE POLICY "ola1_select" ON public.ordenes_cambio FOR SELECT TO authenticated
  USING ( (SELECT sst_es_admin_global())
          OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );
CREATE POLICY "ola1_insert" ON public.ordenes_cambio FOR INSERT TO authenticated
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );
CREATE POLICY "ola1_update" ON public.ordenes_cambio FOR UPDATE TO authenticated
  USING ( (SELECT sst_es_admin_global())
          OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') )
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );
CREATE POLICY "ola1_delete" ON public.ordenes_cambio FOR DELETE TO authenticated
  USING ( (SELECT sst_es_admin_global())
          OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );

-- ============================================================================
-- 4. ORDEN_CAMBIO_ITEMS — alcance vía la orden padre (la tabla no tiene
-- proyecto_id; el guardado es delete-all + insert por orden_id)
-- ============================================================================
DROP POLICY "auth_all_oc_items" ON public.orden_cambio_items;

CREATE POLICY "ola1_select" ON public.orden_cambio_items FOR SELECT TO authenticated
  USING ( EXISTS ( SELECT 1 FROM ordenes_cambio oc WHERE oc.id = orden_id
                   AND ( (SELECT sst_es_admin_global())
                         OR sst_rol_en_proyecto(oc.proyecto_id) IN ('admin','fiscalizador') ) ) );
CREATE POLICY "ola1_insert" ON public.orden_cambio_items FOR INSERT TO authenticated
  WITH CHECK ( EXISTS ( SELECT 1 FROM ordenes_cambio oc WHERE oc.id = orden_id
                        AND ( (SELECT sst_es_admin_global())
                              OR sst_rol_en_proyecto(oc.proyecto_id) IN ('admin','fiscalizador') ) ) );
CREATE POLICY "ola1_delete" ON public.orden_cambio_items FOR DELETE TO authenticated
  USING ( EXISTS ( SELECT 1 FROM ordenes_cambio oc WHERE oc.id = orden_id
                   AND ( (SELECT sst_es_admin_global())
                         OR sst_rol_en_proyecto(oc.proyecto_id) IN ('admin','fiscalizador') ) ) );
-- (sin UPDATE: el código nunca actualiza items, siempre delete+insert)

-- ============================================================================
-- 5. LINEAS_BASE — PERMISOS[curvaS]
-- ============================================================================
DROP POLICY "auth_all_lineas_base" ON public.lineas_base;

-- El Dashboard calcula SPI por proyecto para todo rol → SELECT para miembros.
CREATE POLICY "ola1_select" ON public.lineas_base FOR SELECT TO authenticated
  USING ( (SELECT sst_es_admin_global()) OR sst_rol_en_proyecto(proyecto_id) IS NOT NULL );

-- Escriben admin/fiscalizador (crearNuevaLineaBase y la LB-1 automática de
-- asegurarLineaBaseActiva, disparada por importar rubros / guardar cronograma).
-- Nota: "activar LB solo admin" sigue siendo guard de la app (JS); a nivel de
-- datos el fiscalizador puede tocar `activa` porque crearNuevaLineaBase lo
-- requiere. Distinguirlo exigiría trigger (fuera de esta ola).
CREATE POLICY "ola1_insert" ON public.lineas_base FOR INSERT TO authenticated
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );
CREATE POLICY "ola1_update" ON public.lineas_base FOR UPDATE TO authenticated
  USING ( (SELECT sst_es_admin_global())
          OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') )
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );
CREATE POLICY "ola1_delete" ON public.lineas_base FOR DELETE TO authenticated
  USING ( (SELECT sst_es_admin_global())
          OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );

-- ============================================================================
-- 6. CRONOGRAMA_RUBROS — PERMISOS[curvaS]; sella I-8 a nivel de datos
-- (guardarCronograma no tiene gate JS: la BD pasa a ser el único freno real
-- para visualizador y cliente)
-- ============================================================================
DROP POLICY "acceso total autenticado" ON public.cronograma_rubros;

CREATE POLICY "ola1_select" ON public.cronograma_rubros FOR SELECT TO authenticated
  USING ( (SELECT sst_es_admin_global()) OR sst_rol_en_proyecto(proyecto_id) IS NOT NULL );
CREATE POLICY "ola1_insert" ON public.cronograma_rubros FOR INSERT TO authenticated
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );
CREATE POLICY "ola1_update" ON public.cronograma_rubros FOR UPDATE TO authenticated
  USING ( (SELECT sst_es_admin_global())
          OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') )
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );
CREATE POLICY "ola1_delete" ON public.cronograma_rubros FOR DELETE TO authenticated
  USING ( (SELECT sst_es_admin_global())
          OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );

-- ============================================================================
-- 7. PLANILLAS_PAGO — PERMISOS[planillas]: crear admin/fisc/residente;
-- revisar/aprobar admin/fisc; pagar solo admin (aprox. D5); eliminar
-- no-borrador solo admin
-- ============================================================================
DROP POLICY "acceso" ON public.planillas_pago;

-- Contrato muestra saldos de planillas a todos los miembros (I-3 controlado).
CREATE POLICY "ola1_select" ON public.planillas_pago FOR SELECT TO authenticated
  USING ( (SELECT sst_es_admin_global()) OR sst_rol_en_proyecto(proyecto_id) IS NOT NULL );

-- El residente crea en 'borrador' o directamente en 'enviada' (envío directo
-- de guardarPlanilla), pero no puede insertar una planilla ya aprobada/pagada.
CREATE POLICY "ola1_insert" ON public.planillas_pago FOR INSERT TO authenticated
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador')
               OR ( sst_rol_en_proyecto(proyecto_id) = 'residente'
                    AND estado IN ('borrador','enviada') ) );

-- D5: el residente solo toca borradores y solo puede llevarlos a 'enviada';
-- admin/fiscalizador mueven el resto de estados. "Pagar solo admin global"
-- exacto queda para el trigger de Ola 1.5 (riesgo residual aceptado:
-- fiscalizador podría marcar 'pagada' por API — personal propio).
CREATE POLICY "ola1_update" ON public.planillas_pago FOR UPDATE TO authenticated
  USING ( (SELECT sst_es_admin_global())
          OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador')
          OR ( sst_rol_en_proyecto(proyecto_id) = 'residente' AND estado = 'borrador' ) )
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador')
               OR ( sst_rol_en_proyecto(proyecto_id) = 'residente'
                    AND estado IN ('borrador','enviada') ) );

-- PERMISOS[planillas]: borrador lo eliminan los tres roles; el resto solo admin.
CREATE POLICY "ola1_delete" ON public.planillas_pago FOR DELETE TO authenticated
  USING ( (SELECT sst_es_admin_global())
          OR ( estado = 'borrador'
               AND sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador','residente') ) );

-- ============================================================================
-- 8-10. PLANILLA_RUBROS / PLANILLA_ARCHIVOS / PLANILLA_HISTORIAL
-- Alcance vía la planilla padre (las tablas no tienen proyecto_id).
-- El guardado de rubros es delete-all + reinsert; archivos solo se insertan
-- al crear; historial es insert-only. Sin política de UPDATE en las tres
-- (el código nunca lo usa → denegado por defecto).
-- El residente inserta hijas de planillas 'borrador' o 'enviada' (la creación
-- con envío directo inserta el padre ya en 'enviada') y solo borra hijas de
-- 'borrador' (edición delete+reinsert).
-- ============================================================================
DROP POLICY "acceso" ON public.planilla_rubros;
DROP POLICY "acceso" ON public.planilla_archivos;
DROP POLICY "acceso" ON public.planilla_historial;

CREATE POLICY "ola1_select" ON public.planilla_rubros FOR SELECT TO authenticated
  USING ( EXISTS ( SELECT 1 FROM planillas_pago p WHERE p.id = planilla_id
                   AND ( (SELECT sst_es_admin_global())
                         OR sst_rol_en_proyecto(p.proyecto_id) IS NOT NULL ) ) );
CREATE POLICY "ola1_insert" ON public.planilla_rubros FOR INSERT TO authenticated
  WITH CHECK ( EXISTS ( SELECT 1 FROM planillas_pago p WHERE p.id = planilla_id
                        AND ( (SELECT sst_es_admin_global())
                              OR sst_rol_en_proyecto(p.proyecto_id) IN ('admin','fiscalizador')
                              OR ( sst_rol_en_proyecto(p.proyecto_id) = 'residente'
                                   AND p.estado IN ('borrador','enviada') ) ) ) );
CREATE POLICY "ola1_delete" ON public.planilla_rubros FOR DELETE TO authenticated
  USING ( EXISTS ( SELECT 1 FROM planillas_pago p WHERE p.id = planilla_id
                   AND ( (SELECT sst_es_admin_global())
                         OR sst_rol_en_proyecto(p.proyecto_id) IN ('admin','fiscalizador')
                         OR ( sst_rol_en_proyecto(p.proyecto_id) = 'residente'
                              AND p.estado = 'borrador' ) ) ) );

CREATE POLICY "ola1_select" ON public.planilla_archivos FOR SELECT TO authenticated
  USING ( EXISTS ( SELECT 1 FROM planillas_pago p WHERE p.id = planilla_id
                   AND ( (SELECT sst_es_admin_global())
                         OR sst_rol_en_proyecto(p.proyecto_id) IS NOT NULL ) ) );
CREATE POLICY "ola1_insert" ON public.planilla_archivos FOR INSERT TO authenticated
  WITH CHECK ( EXISTS ( SELECT 1 FROM planillas_pago p WHERE p.id = planilla_id
                        AND ( (SELECT sst_es_admin_global())
                              OR sst_rol_en_proyecto(p.proyecto_id) IN ('admin','fiscalizador')
                              OR ( sst_rol_en_proyecto(p.proyecto_id) = 'residente'
                                   AND p.estado IN ('borrador','enviada') ) ) ) );
CREATE POLICY "ola1_delete" ON public.planilla_archivos FOR DELETE TO authenticated
  USING ( EXISTS ( SELECT 1 FROM planillas_pago p WHERE p.id = planilla_id
                   AND ( (SELECT sst_es_admin_global())
                         OR sst_rol_en_proyecto(p.proyecto_id) IN ('admin','fiscalizador')
                         OR ( sst_rol_en_proyecto(p.proyecto_id) = 'residente'
                              AND p.estado = 'borrador' ) ) ) );

CREATE POLICY "ola1_select" ON public.planilla_historial FOR SELECT TO authenticated
  USING ( EXISTS ( SELECT 1 FROM planillas_pago p WHERE p.id = planilla_id
                   AND ( (SELECT sst_es_admin_global())
                         OR sst_rol_en_proyecto(p.proyecto_id) IS NOT NULL ) ) );
CREATE POLICY "ola1_insert" ON public.planilla_historial FOR INSERT TO authenticated
  WITH CHECK ( EXISTS ( SELECT 1 FROM planillas_pago p WHERE p.id = planilla_id
                        AND ( (SELECT sst_es_admin_global())
                              OR sst_rol_en_proyecto(p.proyecto_id) IN ('admin','fiscalizador')
                              OR ( sst_rol_en_proyecto(p.proyecto_id) = 'residente'
                                   AND p.estado IN ('borrador','enviada') ) ) ) );
CREATE POLICY "ola1_delete" ON public.planilla_historial FOR DELETE TO authenticated
  USING ( EXISTS ( SELECT 1 FROM planillas_pago p WHERE p.id = planilla_id
                   AND ( (SELECT sst_es_admin_global())
                         OR sst_rol_en_proyecto(p.proyecto_id) IN ('admin','fiscalizador')
                         OR ( sst_rol_en_proyecto(p.proyecto_id) = 'residente'
                              AND p.estado = 'borrador' ) ) ) );

-- ============================================================================
-- 11. GARANTIAS — PERMISOS[contrato]: gestionan admin/fiscalizador; leen
-- todos los miembros (notificaciones multi-proyecto, cartera, contrato)
-- ============================================================================
DROP POLICY "auth_all_garantias" ON public.garantias;

CREATE POLICY "ola1_select" ON public.garantias FOR SELECT TO authenticated
  USING ( (SELECT sst_es_admin_global()) OR sst_rol_en_proyecto(proyecto_id) IS NOT NULL );
CREATE POLICY "ola1_insert" ON public.garantias FOR INSERT TO authenticated
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );
CREATE POLICY "ola1_update" ON public.garantias FOR UPDATE TO authenticated
  USING ( (SELECT sst_es_admin_global())
          OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') )
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );
CREATE POLICY "ola1_delete" ON public.garantias FOR DELETE TO authenticated
  USING ( (SELECT sst_es_admin_global())
          OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );

-- ============================================================================
-- 12. CONTRATO_ANTICIPO — upsert (INSERT+UPDATE) de admin/fiscalizador;
-- el residente DEBE poder leer (cargarConfigAnticipo calcula amortización
-- y retención al crear planillas). Sin DELETE en el código.
-- ============================================================================
DROP POLICY "auth_all_contrato_anticipo" ON public.contrato_anticipo;

CREATE POLICY "ola1_select" ON public.contrato_anticipo FOR SELECT TO authenticated
  USING ( (SELECT sst_es_admin_global()) OR sst_rol_en_proyecto(proyecto_id) IS NOT NULL );
CREATE POLICY "ola1_insert" ON public.contrato_anticipo FOR INSERT TO authenticated
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );
CREATE POLICY "ola1_update" ON public.contrato_anticipo FOR UPDATE TO authenticated
  USING ( (SELECT sst_es_admin_global())
          OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') )
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );

-- ============================================================================
-- 13. LIQUIDACIONES — insert único admin/fiscalizador; sin UPDATE/DELETE
-- ============================================================================
DROP POLICY "auth_all_liquidaciones" ON public.liquidaciones;

CREATE POLICY "ola1_select" ON public.liquidaciones FOR SELECT TO authenticated
  USING ( (SELECT sst_es_admin_global()) OR sst_rol_en_proyecto(proyecto_id) IS NOT NULL );
CREATE POLICY "ola1_insert" ON public.liquidaciones FOR INSERT TO authenticated
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );

-- ============================================================================
-- 14. ACTAS_RECEPCION — insert admin/fiscalizador; sin UPDATE/DELETE
-- ============================================================================
DROP POLICY "auth_all_actas" ON public.actas_recepcion;

CREATE POLICY "ola1_select" ON public.actas_recepcion FOR SELECT TO authenticated
  USING ( (SELECT sst_es_admin_global()) OR sst_rol_en_proyecto(proyecto_id) IS NOT NULL );
CREATE POLICY "ola1_insert" ON public.actas_recepcion FOR INSERT TO authenticated
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );

-- ============================================================================
-- 15. REAJUSTE_TERMINOS — delete-all+insert de admin/fiscalizador; lee todo
-- miembro (Contrato para todos + residente desde Planillas). D6: los
-- no-miembros dejan de ver estos datos — I-3 muere aquí.
-- ============================================================================
DROP POLICY "auth_all_reajuste" ON public.reajuste_terminos;

CREATE POLICY "ola1_select" ON public.reajuste_terminos FOR SELECT TO authenticated
  USING ( (SELECT sst_es_admin_global()) OR sst_rol_en_proyecto(proyecto_id) IS NOT NULL );
CREATE POLICY "ola1_insert" ON public.reajuste_terminos FOR INSERT TO authenticated
  WITH CHECK ( (SELECT sst_es_admin_global())
               OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );
CREATE POLICY "ola1_delete" ON public.reajuste_terminos FOR DELETE TO authenticated
  USING ( (SELECT sst_es_admin_global())
          OR sst_rol_en_proyecto(proyecto_id) IN ('admin','fiscalizador') );

-- ============================================================================
-- Verificación sugerida tras aplicar:
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE schemaname='public' AND tablename IN (…las 15…) ORDER BY 1,3;
-- Endurecimientos diferidos: OLA-1.5.md
-- ============================================================================
