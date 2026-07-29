# OLA 1.5 — Endurecimientos diferidos de RLS

> Decisiones tomadas en el mapeo de la Ola 1 (2026-07-29). La Ola 1 se quedó
> deliberadamente en **políticas por rol**; todo lo que requiere triggers o
> distinción por columna/transición va aquí. No ejecutar nada de esto sin
> revisión propia (misma disciplina que la Ola 1: mapeo → SQL → aprobación).

## 1. 🔴 PRIORIDAD ALTA — Trigger de columnas para residente en `rubros` (D3)
La Ola 1 da al residente UPDATE completo de `rubros` porque el Libro de Obra
escribe `cantidad_ejecutada` (guardar/editar/eliminar registro + sincronización
offline). Pero `cantidad_ejecutada` alimenta las planillas y el residente puede
ser personal del contratista: por API directa hoy podría alterar
`monto_contrato`, `cantidad_contrato` o `precio_unitario`.
**Endurecimiento:** trigger BEFORE UPDATE que, cuando `sst_rol_en_proyecto()`
= 'residente', rechace cambios en toda columna distinta de
`cantidad_ejecutada` y `estado`.

## 2. Trigger de máquina de estados de `planillas_pago` (D5)
La política de la Ola 1 confina al residente (solo borrador → enviada) pero no
distingue transiciones entre admin y fiscalizador: un fiscalizador podría
marcar `pagada` por API (la matriz dice "pagar solo admin"). Riesgo residual
aceptado en Ola 1 por ser personal propio.
**Endurecimiento:** trigger BEFORE UPDATE que valide las transiciones
borrador→enviada→en_revision→aprobada→pagada / →rechazada según el rol exacto
(pagar solo `sst_es_admin_global()`), y que impida editar contenido en estados
posteriores a borrador.

## 3. Trigger de columnas para fiscalizador en `proyectos` (D2)
La Ola 1 le da UPDATE completo porque el cierre (actas/liquidación →
`estado_cierre`) y la extracción IA (`contrato_datos`, montos, fechas,
representantes) lo necesitan. La UI solo deja editar al admin, pero por API el
fiscalizador podría cambiar `modulos`, `nombre`, `monto_contrato`, etc.
**Endurecimiento:** trigger BEFORE UPDATE que, para rol 'fiscalizador', limite
las columnas modificables a `estado_cierre`, `contrato_datos` y los campos que
escribe `guardarDatosContrato` (montos/fechas/ubicación/descripción del
contrato extraído).

## 4. Regla "proyecto liquidado = solo lectura" (I-15)
Hoy `window._proyectoCerrado` solo se respeta en 6 de ~60 escrituras del
frontend (PERMISOS.md I-15). La versión de datos: políticas o trigger que
bloqueen INSERT/UPDATE/DELETE en las tablas del proyecto cuando
`proyectos.estado_cierre = 'liquidado'` (con excepción para admin global y
para el propio flujo de reapertura). Decidir si se implementa como condición
extra en las políticas ola1_* o como trigger único compartido.

## Notas
- Los usuarios de prueba de la Ola 1 (nicolas+rol@hidivo.com, proyecto
  PRUEBAS RLS `47a30a1a-ff20-4b1a-913e-27c13af876e0`) sirven tal cual para
  probar estas cuatro piezas.
- Cuando la Ola 2 cubra el resto de tablas (observaciones, solicitudes, libro,
  chat, archivos, equipos, materiales, subcontratistas, ensayos, catálogo),
  revisar también I-11 (gate de Usuarios/Reportes por rol efectivo) y el
  flujo de creación de cuentas (mover signUp/invitaciones a una Edge Function
  con `auth.admin` para poder apagar el sign-up público).
