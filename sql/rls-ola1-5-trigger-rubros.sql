-- ============================================================================
-- RLS OLA 1.5 — Trigger de columnas para residente en `rubros` (D3, prioridad alta)
-- ============================================================================
-- La política ola1_update de rubros permite al residente hacer UPDATE (lo
-- necesita el Libro de Obra: cantidad_ejecutada). Pero RLS no distingue
-- columnas, así que por API directa un residente podría alterar precio_unitario,
-- cantidad_contrato, descripcion, etc. — datos que alimentan las planillas.
-- Este trigger cierra ese hueco: cuando el actor escribe EN VIRTUD DE SER
-- RESIDENTE (no admin global ni admin/fiscalizador del proyecto), solo puede
-- cambiar `cantidad_ejecutada` y `estado`; cualquier otro cambio se rechaza.
--
-- Columnas exentas del guard:
--   · cantidad_ejecutada, estado         → lo que el residente SÍ modifica
--   · monto_contrato, total_produccion   → GENERATED ALWAYS (recalculan solas)
--   · id, created_at, updated_at         → identidad / housekeeping
-- Helpers: sst_es_admin_global(), sst_rol_en_proyecto(uuid) (STABLE SECURITY DEFINER).
--
-- El service role / conexiones backend (auth.uid() IS NULL) quedan EXENTOS:
-- ya son contextos de confianza que saltan RLS. Ningún Edge Function actualiza
-- rubros hoy; esto lo mantiene a prueba de futuro y no rompe scripts SQL.
--
-- ============================================================================
-- REVERSIÓN (rollback en un minuto)
-- ============================================================================
/*
DROP TRIGGER IF EXISTS trg_rubros_guard_residente ON public.rubros;
DROP FUNCTION IF EXISTS public.rubros_guard_columnas_residente();
*/

CREATE OR REPLACE FUNCTION public.rubros_guard_columnas_residente()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Contextos de confianza que no pasan por RLS: no aplicar el guard.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admin global o admin/fiscalizador del proyecto: sin restricción de columnas.
  IF sst_es_admin_global()
     OR sst_rol_en_proyecto(NEW.proyecto_id) IN ('admin','fiscalizador') THEN
    RETURN NEW;
  END IF;

  -- A partir de aquí, el actor solo llega por ser residente (la política
  -- ola1_update no admite a nadie más). Solo cantidad_ejecutada y estado.
  IF ( NEW.proyecto_id        IS DISTINCT FROM OLD.proyecto_id
    OR NEW.codigo             IS DISTINCT FROM OLD.codigo
    OR NEW.descripcion        IS DISTINCT FROM OLD.descripcion
    OR NEW.unidad             IS DISTINCT FROM OLD.unidad
    OR NEW.cantidad_contrato  IS DISTINCT FROM OLD.cantidad_contrato
    OR NEW.precio_unitario    IS DISTINCT FROM OLD.precio_unitario
    OR NEW.fecha_inicio_plan  IS DISTINCT FROM OLD.fecha_inicio_plan
    OR NEW.fecha_fin_plan     IS DISTINCT FROM OLD.fecha_fin_plan
    OR NEW.orden              IS DISTINCT FROM OLD.orden
    OR NEW.fecha_inicio       IS DISTINCT FROM OLD.fecha_inicio
    OR NEW.fecha_fin          IS DISTINCT FROM OLD.fecha_fin
    OR NEW.es_orden_cambio    IS DISTINCT FROM OLD.es_orden_cambio
    OR NEW.orden_cambio_codigo IS DISTINCT FROM OLD.orden_cambio_codigo
    OR NEW.orden_cambio_id    IS DISTINCT FROM OLD.orden_cambio_id
  ) THEN
    RAISE EXCEPTION 'Como residente solo puedes modificar el avance ejecutado (cantidad_ejecutada) y el estado del rubro; no sus datos contractuales (precio, cantidad, descripción, fechas).'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rubros_guard_residente
  BEFORE UPDATE ON public.rubros
  FOR EACH ROW
  EXECUTE FUNCTION public.rubros_guard_columnas_residente();

-- ============================================================================
-- Verificación sugerida tras aplicar (con JWT de nicolas+residente@):
--   PATCH rubros?id=eq.<rubro> {"cantidad_ejecutada": N}  → OK
--   PATCH rubros?id=eq.<rubro> {"precio_unitario": N}     → 400 check_violation
-- ============================================================================
