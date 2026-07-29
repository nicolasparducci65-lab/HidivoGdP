# PRUEBAS — RLS Ola 1

> Aplicado el 2026-07-29 (rama `rls-ola1`). 43 políticas `ola1_*` sobre las 15
> tablas del núcleo financiero; cero políticas `USING(true)` restantes
> (verificado en `pg_policies`). Reversión: bloque comentado al inicio de
> `sql/rls-ola1.sql`.

## Entorno de prueba

- Proyecto **PRUEBAS RLS** = `47a30a1a-ff20-4b1a-913e-27c13af876e0`
- Usuarios (contraseña `Hidivo.Rls1-2026`, todos sin admin global):
  `nicolas+{fiscalizador,residente,visualizador,cliente,sst}@hidivo.com`
- Rubro de prueba sembrado en PRUEBAS RLS = `837fe790-9c59-4194-9309-131678485227`

## Resultado: 9/9 pruebas por API REST directa ✅

Cada una ejecutada con el JWT real del usuario de prueba (grant_type=password),
golpeando `…/rest/v1/…` — la base, no el frontend.

| # | Rol | Acción | Esperado | Resultado |
|---|---|---|---|---|
| T1 | cliente | SELECT `proyectos` | solo PRUEBAS RLS | ✅ 1 fila: "PRUEBAS RLS" |
| T2 | cliente | SELECT `rubros` de Puente Zapote (ajeno) | 0 filas | ✅ 0 filas |
| T3 | visualizador | INSERT `cronograma_rubros` | 403 | ✅ 403 (sella I-8) |
| T4 | residente | UPDATE `garantias` | 0 filas / rechazo | ✅ 0 filas afectadas |
| T5 | residente | UPDATE `rubros.cantidad_ejecutada` (su proyecto) | funciona | ✅ quedó en 25 (Libro de Obra) |
| T6 | visualizador | UPDATE `rubros` | 0 filas / rechazo | ✅ 0 filas afectadas |
| T7 | fiscalizador | **bootstrap**: INSERT `proyectos` + RETURNING, luego INSERT membresía | ambos pasan | ✅ RETURNING devolvió la fila; membresía creada |
| T8 | residente | SELECT `contrato_anticipo` (lo necesita para planillas) | permitido | ✅ sin error (0 filas: no hay anticipo cargado) |
| T9 | residente | INSERT `planillas_pago` con `estado='aprobada'` | 403 | ✅ 403 (guard de estado inicial) |

## Checklist funcional por rol (contra las políticas aplicadas)

### admin global (nicolasparducci65@)
- **Funciona:** todo — SELECT/INSERT/UPDATE/DELETE en las 15 tablas de cualquier
  proyecto (`sst_es_admin_global()` en cada política). Cartera, Reportes
  Globales y Usuarios siguen leyendo toda la plataforma.

### fiscalizador
- **Funciona:** ver sus proyectos; **crear proyecto** (bootstrap T7) y editarlo;
  CRUD de rubros/OC/cronograma/líneas base/garantías/anticipo/reajuste; crear y
  mover planillas (incl. aprobar); registrar actas y liquidación (→ `estado_cierre`).
- **Falla:** ver/tocar proyectos donde no es miembro; eliminar proyectos (solo admin).

### residente
- **Funciona:** ver los datos de su proyecto; **UPDATE `rubros.cantidad_ejecutada`**
  (Libro de Obra, T5); crear planillas en borrador o enviarlas directo; leer
  `contrato_anticipo`/`reajuste_terminos` para calcular la planilla (T8);
  insertar/borrar hijas de planillas en borrador/enviada.
- **Falla:** UPDATE de garantías/anticipo/cronograma/líneas base (T4);
  crear planilla ya aprobada/pagada (T9); aprobar/pagar planillas; INSERT de rubros.

### visualizador
- **Funciona:** SELECT de rubros/curva S/líneas base/cronograma/contrato de su proyecto.
- **Falla:** CUALQUIER escritura en las 15 tablas (T3, T6) — los huecos I-8 quedan
  sellados a nivel de datos, ya no dependen del CSS.

### cliente
- **Funciona:** SELECT de su proyecto y su curva S (T1); nada más de escritura.
- **Falla:** leer proyectos/rubros ajenos (T2); toda escritura.

### tecnico_sst
- **Funciona:** nada en estas 15 tablas (no toca el núcleo financiero; su dominio
  es SST, ya con RLS propio).
- **Falla:** SELECT/escritura en las 15 tablas de esta ola salvo que sea miembro
  con otro rol.

## Edge Functions (service role — inmunes a RLS) ✅

- Las 6 siguen desplegadas: redactar-comunicado, resumen-cartera, extraer-contrato,
  describir-archivo, procesar-observacion-voz, registro-obra-publico *(esta última
  fue retirada en una sesión previa; ver nota)*.
- Verificado que el **service role sigue leyendo** planillas/garantías/anticipos/rubros
  (RLS no aplica al service role): counts devueltos sin bloqueo.
- Endpoints vivos: redactar-comunicado y extraer-contrato → 400 (faltan params),
  resumen-cartera → 401 (exige auth). Ninguno 500 → RLS no rompió su operación.

## Notas
- La prueba T5 dejó `cantidad_ejecutada=25` en el rubro de prueba de PRUEBAS RLS
  (proyecto de descarte, sin efecto en producción).
- Endurecimientos diferidos que esta ola NO cubre: ver `OLA-1.5.md` (trigger de
  columnas residente/rubros — prioridad alta —, máquina de estados de planillas,
  columnas fiscalizador/proyectos, liquidado=solo lectura).
