# Auditoría de `index.html`

> Auditoría de solo lectura realizada el 2026-07-24. Ninguna línea de código fue modificada.
> Los números de línea corresponden al estado del archivo en el commit `fa14c12`.

## 1. Tamaño real

| Sección | Líneas | Peso | % del archivo |
|---|---|---|---|
| CSS (`<style>`, líneas 19–298) | 280 | 18,0 KB | 2% |
| HTML (líneas 299–2595) | 2.297 | 135,3 KB | 16% |
| **JS** (líneas 2596–15321, un solo `<script>`) | **12.726** | **700,2 KB** | **82%** |
| **Total** | 15.323 (1.240 vacías) | **844,4 KB** (184 KB con gzip) | |

Otros números que dimensionan el problema: **523 funciones**, 499 llamadas `sb.from(`, **1.892 atributos `style="…"` inline**, 452 `onclick=`, 213 asignaciones a `.innerHTML`. El CSS del `<style>` es minúsculo; el estilo real de la app vive en los 1.892 inline styles dentro de plantillas JS.

## 2. Funciones muertas y lógica duplicada

### Muertas (definidas, cero referencias en todo el archivo)

| Función | Línea | Nota |
|---|---|---|
| `showRegister` | 2874 | Resto de un flujo de registro que ya no existe |
| `ocultarBotonesAccion` | 3181 | Sin llamadas |
| `ajustarOverlayAlPlano` | 6933 | Sin llamadas |
| `describirArchivoIA` | 7540 | Probablemente huérfana tras el commit reciente de backfill de descripciones — confirmar antes de borrar |
| `renderTablaDetalleReportes` | 8987 | Sin llamadas |

También hay una **variable muerta**: `chatNotifCount` (línea 11144), declarada y nunca leída ni escrita.

### Duplicación confirmada (con líneas)

- **Ventanas de impresión**: 4 bloques `window.open` + `document.write` (4646, 8801, 10036, 12790) con `<style>` embebidos casi idénticos en tres de ellos (body Arial, cabecera azul `#0073ea`, bloque de firmas, `@media print`). Solo el grupo de cierre de proyecto está bien factorizado: `abrirVentanaDocCierre` sirve a 6 funciones de imprimir. **Copia literal de 10 líneas** de post-proceso con `DOMParser` + regex entre `generarReportePDF` (13441–13452) y `generarReporteDashboard` (12974–12983) — el propio comentario en 12973 lo admite.
- **Formateo de moneda**: el mismo formateador `'$' + v.toLocaleString('es-EC',…)` está copiado 3 veces (5137, 9745, 9872), la variante con signo negativo otras 3 (4336, 4626, 10013), más variantes cercanas (`fmtEc` 10964, `fmtK` 5138 vs `formatoK` 3444). En total 62 usos de `toLocaleString('es-EC'`.
- **Fechas**: 3 formateadores de fecha corta con opciones casi iguales (6084, 6127, 13275) y 48 `toLocaleDateString` — solo 2 sitios respetan la zona horaria de Ecuador (`hoyEcuador` 5718, `fmtDia` 5016); el resto usa la del navegador.
- **Escapado de HTML**: 3 funciones distintas con semánticas diferentes (`escaparParaAtributo` 5710, `escAttr` 5735, `escapeHtml` 11417 — esta última no escapa `"` y aun así se usa en atributos del módulo SST) más **3 copias inline idénticas** de un escapador arrow (4627, 9997, 10035) y una parcial (13263).
- **Storage**: 20 `.upload()` con el mismo trío upload→check→getPublicUrl, opciones inconsistentes (`contentType`/`upsert` a veces sí, a veces no), dos buckets (`hidivo-fotos` / `hidivo-archivos`) sin criterio claro, y **solo 3–4 sitios borran el objeto del Storage al eliminar la fila** — el resto deja archivos huérfanos (p. ej. `eliminarRegistroHoras` 9650, `eliminarEPPEntrega` 14306).
- **Bloques copiados entre módulos**:
  - Shell de pestañas implementado 4 veces (Materiales 9047, Equipos 9351, SST-EPP 14166, SST-exámenes 15004), con el despacho de tabs repetido dos veces por módulo.
  - Bloque de reportes Materiales vs Equipos: ~40 líneas espejo (9154–9195 vs 9427–9466).
  - 8 funciones `eliminar*` de SST con el mismo cuerpo de 5 líneas (14154, 14229, 14306, 14382, 14545, 14992, 15071, 15167).
  - Guard "Selecciona un proyecto" copiado **23 veces**.
  - `['admin','fiscalizador'].includes(…)` inline **15 veces** pese a existir 6 helpers de rol (`esVisualizador` 3177, `esAprobadorLibro` 5461, `sstPuedeGestionar` 13802, etc.).
  - Mapas de estado reimplementados inline dentro de `generarReportePDF` (13400, 13430) duplicando `ESTADOS_PLANILLA` y `estadoObsLabel`; `estadoLabelMap` (12907) copia el objeto de `estadoLabel()` (3647); `estadoColor` de equipos copiado en 9384 y 9436.
  - La URL de la plantilla de rubros hardcodeada en 7446 y 9552; el logo Hidivo hardcodeado 8 veces con **dos URLs distintas**.

## 3. Variables globales de estado (~85 declaraciones top-level)

`cambiarProyecto(id)` (línea 3780) **no tiene ninguna rutina de limpieza**: asigna `currentProyecto`, recalcula rol, y recarga solo el loader de la página actual. El único reset explícito es `chatCanalActivo=null` *si estás parado en el chat* (3811). Todo lo demás depende de que cada módulo sobrescriba sus globales al entrar.

### Riesgos reales de fuga entre proyectos (NO se resetean)

1. **`chatCanalActivo` / `chatSuscripcion` / `chatHiloActivo` (11141–11143) — grave, con escritura cruzada.** Si cambias de proyecto estando fuera del chat, `chatCanalActivo` queda apuntando al canal del proyecto anterior; al entrar al chat el guard `if(!chatCanalActivo…)` (11198) impide abrir el canal nuevo, el panel muestra los mensajes viejos y **`enviarMensaje` escribe en el canal del proyecto anterior** (11430); lo mismo aplica a subir archivos (11445) y a `eliminarCanal` (11308). Si cambias estando dentro, la suscripción realtime queda viva sobre el canal viejo si el proyecto nuevo no tiene canales visibles para el rol.
2. **`cronogramaData` (5915)** — solo se recarga si estás en curva S; queda con los rubros/montos del proyecto anterior en memoria. Hoy sus consumidores fuera de esa página se protegen llamando `cargarCurvaS()` antes (p. ej. 13134), pero es un riesgo latente si se añade un consumidor nuevo.
3. **`curvaSGrafico` (5913)** — la instancia Chart.js solo se destruye al re-renderizar (6419); si el proyecto nuevo no tiene rubros, `cargarCurvaS` hace return temprano (5924) y el gráfico queda vivo sobre un canvas huérfano (fuga de memoria + listeners).
4. **`_ensayosFiltro.espec` (4722)** — guarda un UUID de especificación del proyecto anterior que nunca se resetea; al aplicarlo (4762) contra las especificaciones del proyecto nuevo la lista de ensayos queda vacía sin explicación.
5. **`planoActivo` / `pinModo` (6707/6709)** — quedan stale; impacto bajo porque el visor se re-renderiza, pero son referencias vivas al proyecto anterior.

### Se resetean indirectamente y de forma fiable

Todo el estado de modales (libro de obra: 5681–5698; OC: 4378–4380; llenado de formatos: 8376–8390; lightbox: 6991; ensayos: 4750), `pdfDoc` (invalida por URL, 6897–6900), y `sstCache`/`sstConfigActual`/`sstChecklistRespuestasCache` (cada pestaña refetchea por `currentProyecto` antes de pintar, aunque la basura del proyecto anterior permanece en memoria hasta visitarla).

### No dependen del proyecto

Sesión (`currentUser`, `currentPerfil`), navegación (`currentPage`, `_hist*`), `notiDatos` (multi-proyecto por diseño), pestañas/filtros con valores enum (`fiscalTab`, `materialesTab`, `sstTab`, `solicitudFiltro*`, etc.), `presenciaInterval` (por usuario), `suscripcionGlobalChat` (canal global sin filtro), `deferredPrompt`, `_sincronizandoOffline` (la cola IndexedDB guarda su propio `proyecto_id`).

### Fix mínimo sugerido (en `cambiarProyecto`, antes de recargar la página actual)

```js
// limpiar estado ligado al proyecto anterior
if(chatSuscripcion){ sb.removeChannel(chatSuscripcion); chatSuscripcion = null; }
chatCanalActivo = null; chatHiloActivo = null;
if(curvaSGrafico){ curvaSGrafico.destroy(); curvaSGrafico = null; }
cronogramaData = [];
_ensayosFiltro = {estado:'todos', espec:''};
planoActivo = null; pinModo = false;
```

Adicionalmente, el visor de chat debería vaciarse cuando `chatCanalActivo` pasa a `null`, porque `cargarCanalesChat` (11184) solo reescribe la lista lateral y deja el panel derecho con el contenido anterior.

## 4. Las 10 funciones más largas (longitud real, llave a llave)

| # | Función | Líneas | Long. | Responsabilidades mezcladas |
|---|---|---|---|---|
| 1 | `generarReportePDF` | 12991–13461 | **471** | Seis a la vez: fetch de 7+ tablas con bucles N+1, lectura de 12 checkboxes del DOM, cálculo EVM, agregaciones, plantilla HTML de 274 líneas con estilos inline, y post-proceso DOMParser. La peor función del archivo. |
| 2 | `importarRubrosExcel` | 4064–4215 | 152 | Parseo Excel con heurísticas mágicas + confirm() + **DELETE destructivo de rubros** + inserción + recálculo de línea base, todo dentro de un `reader.onload`. Duplica `excelFechaToISO` en un helper anidado. |
| 3 | `cargarCartera` | 5075–5218 | 144 | Fetch de 9 tablas + motor de indicadores financieros + render completo. La mayor concentración de lógica de negocio pegada al DOM. |
| 4 | `cargarNotificacionesGlobales` | 2927–3059 | 133 | Autorización por proyecto + agregación de 4 fuentes + estado global + badge. |
| 5 | `guardarDatosContrato` | 10335–10459 | 125 | Validación + detección de duplicados contra BD + 2 `confirm()` de negocio + escritura en 3 tablas. |
| 6 | `cargarContrato` | 9721–9843 | 123 | 5 queries + cálculo financiero + ~93 líneas de HTML con `JSON.stringify` incrustado en un `onclick`. |
| 7 | `guardarPlanilla` | 10836–10949 | 114 | Cálculo financiero completo + **ramas update/insert que duplican el payload entre sí** + Storage + historial + DM. |
| 8 | `cargarSubcontratistas` | 7588–7697 | 110 | Dos ciclos fetch→render en la misma función (segundo fetch después de pintar, 7684). |
| 9 | `cargarArchivosGlobal` | 7432–7538 | 107 | Fetch + plantillas con URL absoluta hardcodeada + tabla de 88 líneas con derivación de tipos inline. |
| 10 | `renderCurvaS` | 5977–6082 | 106 | Recálculo de pesos + dos `innerHTML` + dispara 3 efectos al final. |

Nota: `eliminarIncidente` aparecía con ~120 líneas en una medición por distancia entre funciones, pero tiene **6** — el resto es la constante de datos `ANEXO1_CHECKLIST` (~108 líneas de texto normativo del MDT), candidata obvia a archivo separado.

## 5. Oportunidades de bajo riesgo / alto beneficio, ordenadas

1. **Limpieza de estado en `cambiarProyecto`** (~10 líneas nuevas, riesgo casi nulo, arregla un bug real): ver fix sugerido en la sección 3. Es la única de esta lista que corrige comportamiento visible para el usuario.
2. **Extraer el CSS a `styles.css`** (−18 KB del HTML, cacheable por separado): mover las líneas 19–298 tal cual. Cero cambio de lógica.
3. **Extraer constantes de datos a `constantes.js`**: `ANEXO1_CHECKLIST` (108 líneas de texto legal), `ESTADOS_*`, `TIPOS_*`, `MODULO_LABELS`, las 2 URLs del logo y la URL de la plantilla de rubros como constantes únicas. Copiar/pegar sin tocar lógica; elimina de paso las duplicaciones de URL.
4. **Unificar helpers transversales**: un `fmtMoneda` (elimina 6 copias), un `fmtFecha` (elimina 3+), un solo escapador HTML documentado (elimina 4 copias inline y cierra el hueco de `escapeHtml` sin `"` en atributos), un `subirArchivo(bucket, path, file)` (20 sitios), un `sinProyectoGuard()` (23 copias), un `puedeGestionar()` (15 copias). Cada reemplazo es mecánico y verificable uno a uno.
5. **Extraer las plantillas de impresión**: los 3 `<style>` casi idénticos (4649, 8804, 10038) a una constante compartida, y generalizar el patrón `abrirVentanaDocCierre` — que ya existe y funciona con 6 consumidores — para que `imprimirOC` y `exportarPdfFormato` lo usen.
6. **Borrar las 5 funciones muertas + `chatNotifCount`** (~60 líneas). Beneficio pequeño pero gratis; confirmar `describirArchivoIA` contra el flujo de backfill reciente.

Impacto total en peso: modesto (~30–50 KB del HTML inicial, menos con gzip). El beneficio real es de **mantenibilidad y corrección**, no de peso — con gzip el archivo ya viaja en 184 KB.

## 6. Recomendación

**Hacer ya (una sesión, riesgo bajo, valor alto):**
- La limpieza de estado en `cambiarProyecto` — el bug del chat escribiendo en el proyecto anterior es una fuga de datos real entre proyectos, y el fix son ~10 líneas.
- Borrar las funciones muertas y extraer `ANEXO1_CHECKLIST` + constantes + CSS. Todo copiar/pegar.

**Hacer al tocar cada sección (regla de "boy scout", no como proyecto aparte):**
- Al tocar un módulo, reemplazar sus formateadores locales por el helper unificado, su escapador inline por el común, y su patrón de upload por el helper de Storage. Igual con los 8 `eliminar*` de SST — y aprovechar para añadir el borrado del objeto en Storage, que hoy deja huérfanos.
- `generarReportePDF` (471 líneas): solo cuando haya que modificar el reporte. En ese momento, separar mínimamente "recolectar datos" de "armar HTML" y eliminar los bucles N+1 y los mapas de estado reimplementados. No antes.
- Las 4 copias del shell de pestañas: unificar solo si se añade una quinta.

**No hacer nunca (o no vale la pena):**
- Extraer las plantillas HTML de los módulos a archivos separados: son ~495 template literals entretejidos con la lógica; separarlos sin framework es alto riesgo y bajo beneficio.
- Eliminar los 1.892 estilos inline o migrar a clases CSS de forma masiva: enorme superficie de regresión visual para cero beneficio funcional.
- Partir el JS en módulos ES por partir: siendo una PWA de un archivo que se despliega copiando `index.html`, el monolito es una decisión de despliegue razonable; el problema no es que sea un archivo, es la duplicación y el estado global sin limpieza.
