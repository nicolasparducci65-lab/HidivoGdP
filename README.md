# HidivoGdP
Gestion de Proyectos de Obra

PWA en vanilla JS sin build: `index.html` (monolítico) + `styles.css` + `constantes.js` +
`service-worker.js`; backend Supabase (Auth, Postgres con RLS, Storage, Edge Functions en
`supabase/functions`); deploy a GitHub Pages desde `master`. **En cada deploy se incrementa
`CACHE_NAME` en `service-worker.js`.**

## Módulo Recorridos 360 (`js/recorridos360.js`, `css/recorridos360.css`)

Registro fotográfico 360 de la obra con cámaras Insta360 serie X (X3/X4/X5), ubicado sobre
los planos del proyecto y comparable entre fechas.

**Entrada válida:** JPEG equirectangular 2:1 exportado desde la app Insta360 o Insta360
Studio (≈11900×5950, 15–25 MB). La app **no** procesa `.insp` ni `.insv` (mensaje: *"Exporta
la foto 360 desde la app Insta360 antes de subirla"*) ni video.

**Video 360 (MP4 equirectangular):** no se sube a Storage. Hasta que exista `scripts/frames_360.sh`
(fase f), extraer fotogramas en PC con ffmpeg y subirlos como fotos en modo Secuencia:
```bash
ffmpeg -i recorrido.mp4 -vf "fps=1/3" -q:v 2 frame_%04d.jpg
```
(`fps=1/3` = un fotograma cada 3 s; ajustar según el ritmo de caminata. Los JPEG resultantes
no traen EXIF: la app usará la fecha del archivo y lo dejará anotado en el punto.)

**Qué hace el cliente con cada foto (de a una, también en móvil):**
1. Valida extensión y proporción 2:1 (tolerancia 1 %) leyendo el marcador SOF, sin decodificar.
2. Calcula `sha256` del original (dedupe por recorrido; `UNIQUE (recorrido_id, hash_sha256)`).
3. Lee metadatos con exifr **antes** de comprimir (canvas descarta EXIF/XMP): `fecha_captura`
   (`DateTimeOriginal`; si falta, fecha del archivo con aviso), lat/lon/alt, heading
   (`GPano:PoseHeadingDegrees`), cámara, ancho/alto originales.
4. Genera tres variantes con `createImageBitmap(resizeWidth/Height)` + `bitmap.close()`:
   `full` 5760×2880 (JPEG 0,82; si supera 5,5 MB baja la calidad de 0,04 en 0,04 hasta 0,70),
   `web` 4096×2048 (dispositivos con `MAX_TEXTURE_SIZE` < 5760) y `thumb` 1024×512.
   Nunca se sube el original. Si el dispositivo no puede decodificar: *"Sube este lote desde PC"*.
5. Encola en IndexedDB (`hidivo-offline` / `pendientes`, `tipo: 'punto360'`) y sube en
   segundo plano con la cola existente: progreso por foto, reintentos (5), pausa manual.
   Descartar un ítem limpia sus objetos (las 3 rutas, sin depender de la memoria de la
   sesión); sin señal deja una lápida `tipo: 'punto360_limpieza'` que el bucle ejecuta al
   volver la conexión.

**Storage:** bucket **privado** `fotos-360`, rutas `<proyecto_id>/<recorrido_id>/<punto_id>/{full,web,thumb}.jpg`,
JPEG, 8 MB por objeto. Políticas por proyecto derivadas del primer segmento de la ruta
(leer = miembro; subir = admin/fiscalizador/residente; sobrescribir = admin/fiscalizador;
borrar = admin, **o el propio uploader mientras ningún punto referencie el objeto**, para
limpiar subidas parciales: `remove()` no falla cuando la política niega, devuelve solo lo
borrado, y el módulo compara y lo deja en consola). Toda lectura pasa por `storage360`
(URLs firmadas de 12 h, **una** firma por recorrido, caché en memoria, refirma única ante
error de carga; `getBlob` para informes; `getShareUrl` solo admin/fiscalizador). Prohibido
construir rutas `/object/public/` para este bucket.

**Roles:** ver = cualquier miembro del proyecto; crear recorridos y subir puntos =
admin/fiscalizador/residente; ubicar en el plano, etiquetar y publicar = admin/fiscalizador.
El **residente** además actualiza puntos **mientras el recorrido está en borrador**, solo en
posición (`plano_id`, `x`, `y`, `waypoint`), `orden`, `etiqueta`, `rubro_id`, `heading_norte` y
`notas` (política `p360_update_residente_borrador` + lista blanca del trigger
`p360_c_guard_residente`; en publicado su UPDATE no alcanza filas). Nota: la interfaz del
módulo todavía ofrece «Ubicar en plano», arrastre e interpolación solo a admin/fiscalizador
(`r360PuedeUbicar`); abrirla al residente en borrador es un ajuste pendiente del módulo.
Eliminar = admin. Un recorrido **publicado** congela posición, archivos, fecha de captura, hash y
recorrido de sus puntos y no admite puntos nuevos; **volver a borrador** es solo de admin (si
no, el congelado se evadiría despublicando). `publicado_en`/`publicado_por` los fija el
servidor y el `proyecto_id` de recorridos y puntos es inmutable; las rutas `archivo_*` de un
punto deben coincidir con sus propios ids y su `plano_id` debe ser un plano del mismo proyecto
(todo por triggers `BEFORE`). Módulo **apagado por
defecto**: se activa por proyecto en la ficha del proyecto (mientras no esté activo no hay
ítem de menú ni aviso).

**Visor y mini-mapa (fase c):** visor Pannellum (variante `full` si `MAX_TEXTURE_SIZE` ≥ 5760,
si no `web`; brújula si el punto trae `heading_norte`). La panorámica la descarga el módulo
con `fetch` abortable (cambiar de punto cancela la descarga; ante 400/403 refirma y reintenta
una vez) y se entrega a Pannellum como `blob:`; las 5 últimas quedan en memoria (LRU; al
expulsar una se revoca su `blob:`; la caché se vacía al salir del recorrido, al abrir otro y
al cambiar de proyecto) y la siguiente se precarga cuando la actual ya se ve (no con ahorro de
datos ni 2G). Cada visor vive en un host propio; uno que aún no cargó no se destruye hasta que
cargue (Pannellum no cancela su carga y dejaría contextos WebGL huérfanos). En consola queda
la decisión `MAX_TEXTURE_SIZE → full/web` y, abriendo la app con `?r360exp=5`, las URLs
firmadas vencen a los 5 s para probar el refirmado automático. Mini-mapa sobre los planos del proyecto (imagen o PDF vía pdf.js con render
serializado, misma convención `x/y` en % que los pines de observaciones): marcas por punto,
arrastrables; toque en marca abre la foto. Los refrescos (sincronización, eliminar punto) son
parciales: no destruyen visor, mapa ni selección. Navegación: entrar a la sección desde el menú
muestra siempre la lista (descarta el recorrido abierto); «← Volver a recorridos» en la cabecera;
abrir un recorrido registra una entrada en el historial del navegador (`{r360: id}` sobre el
esquema de `registrarNavegacion`), así «atrás» vuelve a la lista y «adelante» lo reabre. Modos:
- **Por punto:** «Ubicar en plano» en el visor y toque en el plano (queda `waypoint = true`).
- **Secuencia:** se ubican a mano ≥ 2 puntos (tras cada toque se selecciona el siguiente por
  `orden`) y **Interpolar** reparte los intermedios en línea recta por índice entre waypoints
  consecutivos del plano visible, sin tocar los ubicados a mano; los anteriores al primer
  waypoint o posteriores al último quedan sin ubicar.

**Depuración 360:** botón «🐞 Depuración 360» en la pantalla del módulo (admin/fiscalizador)
que guarda una bandera en `localStorage` del contexto actual; en la app instalada de iOS hay
que pulsarlo dentro de la app (no comparte almacenamiento con Safari), donde además sirve
`?r360debug=1` / `?r360debug=0`. Panel flotante plegable con las últimas 200 líneas
(consola del módulo, `window.onerror` y `unhandledrejection`, `MAX_TEXTURE_SIZE` y variante,
por punto abierto número/variante/MB/ms, cada refirma con motivo, tamaño de la caché),
persistidas en `localStorage` con rotación; al reabrir anota en qué línea terminó la sesión
anterior. Botones «Copiar registro» y «Limpiar», y control «vencimiento de firmas: 5 s»
(equivale a `?r360exp=5`, persiste). Apagado no tiene ningún efecto.

**Librerías vendorizadas** (sin CDN, precacheadas por el SW): `vendor/pannellum` 2.5.6 (MIT)
y `vendor/exifr` 7.1.3 (MIT).

### Aplicar la migración

`supabase/migrations/20260922_recorridos_360.sql` **no se ejecuta automáticamente**: revisar y
aplicar en el SQL Editor (o `supabase db push`). Al pie trae la verificación:
- 9 políticas en `recorridos_360`/`puntos_360` (dos de UPDATE en puntos), 5 en `storage.objects`
  (`fotos360 …`, dos de DELETE), bucket con `public = false`, triggers `r360_guard_recorrido`,
  `p360_a_proyecto`, `p360_b_guard_publicado` y `p360_c_guard_residente`, columnas
  `punto_360_id`/`yaw`/`pitch` en `observaciones`.
- Residente sobre un recorrido en borrador: actualiza etiqueta/posición (1 fila), falla con 42501
  al tocar `fecha_captura`; sobre uno publicado su UPDATE devuelve 0 filas (bloque 5b del pie).
- `plano_id` de otro proyecto → 23514; del mismo proyecto → OK (bloque 5c).
- Un residente borra con `remove()` un objeto propio sin fila (devuelve 1) y no uno con fila
  (devuelve 0), bloque 6 del pie.
- (a) `GET` anónimo a `/object/public/fotos-360/...` → error y firmar con la clave anon → error;
  (b) un residente de otro proyecto no puede firmar rutas ajenas; (c) una URL firmada con
  `expiresIn = 5` responde 200 y, pasados 7 s, 400 (medido con `fetch`).
- Reglas de integridad con un fiscalizador sobre un recorrido publicado (bloque 5 del pie).
- `grep -n "object/public" js/recorridos360.js` y `grep -n "fotos-360" index.html` → sin resultados.

### Estado por fases
(a) migración + bucket ✔ · (b) carga, metadatos, variantes, cola y `storage360` ✔ ·
(c) visor Pannellum, mini-mapa, modos Por punto / Secuencia ✔ · (d) observación desde 360 ·
(e) comparar y línea de tiempo · (f) SW/offline, `scripts/frames_360.sh`.

Fuera de alcance (preparado, no implementado): checklists por hito/rubro, agente IA de visión,
migración a Cloudflare R2 (cambiar solo `storage360.*`), auditoría planillas vs evidencia,
fotogrametría.
