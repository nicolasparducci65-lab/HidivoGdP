// ============================================================================
// RECORRIDOS 360 — módulo. Fase (b): validación, metadatos, variantes, cola y
// storage360. Fase (c): visor Pannellum, mini-mapa sobre planos y modos
// Por punto / Secuencia. Cargado desde index.html DESPUÉS del script
// principal; usa sus globales: sb, currentProyecto, currentPerfil, currentUser,
// currentPage, proyectos, toast, escAttr, idbGuardar/idbTodos/idbBorrar/idbOp,
// esErrorDeRed, actualizarIndicadorOffline, sincronizarRegistrosOffline,
// _sincronizandoOffline, bloquearSiCerrado, hoyEcuador, coordsPinDesdeEvento,
// asegurarPdfJs (pdf.js bajo demanda) y la librería vendorizada pannellum.
//
// Entrada válida: JPEG equirectangular 2:1 exportado desde la app Insta360 o
// Insta360 Studio. Nunca se sube el original: se generan full/web/thumb en el
// cliente. Toda lectura del bucket PRIVADO 'fotos-360' pasa por storage360.
// ============================================================================

const R360 = {
  BUCKET: 'fotos-360',
  FULL:  [5760, 2880],       // ≈16,6 MP: bajo el límite de canvas de iOS (≈16,7 MP)
  WEB:   [4096, 2048],       // para dispositivos con MAX_TEXTURE_SIZE < 5760
  THUMB: [1024, 512],
  CALIDAD: 0.82, CALIDAD_MIN: 0.70, PASO_CALIDAD: 0.04, FULL_MAX_BYTES: 5.5 * 1024 * 1024,
  TOLERANCIA_RATIO: 0.01,    // 2:1 ± 1 %
  MAX_REINTENTOS: 5,
  FIRMA_SEGUNDOS: 43200,     // 12 h
  BLOBS_MAX: 5,              // panorámicas descargadas que se conservan en memoria (≤ 5 × 5,5 MB); se vacía al salir del recorrido
  MSG_INSTA: 'Exporta la foto 360 desde la app Insta360 antes de subirla',
  MSG_VIDEO: 'Los videos 360 no se suben desde la app: extrae fotogramas del MP4 (ver README, Recorridos 360) y súbelos como fotos en modo Secuencia',
  MSG_PC: 'Sube este lote desde PC',
  RADIO_DEF: 3, RADIOS: [1, 2, 3, 5, 8],   // emparejamiento entre fechas: radio en % del ancho del plano
  // estado de página
  recorridos: [], recorridoActivo: null, puntos: [], planos: [],
  modo: 'punto', planoId: null, seleccionado: null,
  visor: null, visorPuntoId: null, _visorAbort: null, _visorRuta: null, _precarga: null, _blobs: new Map(), _descargas: new Map(),
  _pdf: { doc: null, url: null, pagina: 1, paginaPedida: 1, tarea: null }, _mapaToken: 0, _drag: null,
  // comparar entre fechas (fase e)
  _parejas: new Map(), _aspectos: new Map(),
  _sinPagina: false,                                            // true si la base aún no tiene puntos_360.pagina (migración 20260929 sin aplicar)
  lt: { puntoId: null, parejas: null, mostrado: null },          // parejas del punto del visor (undefined = buscando, null = falló) y la que se ve en su lugar
  cmp: { activo: false, recId: null, rec: null, par: null, bloqueado: true, ajuste: 0, delta: 0, lider: 'a', visor: null, abort: null, bajando: null, rutas: new Set(), raf: 0 },
  // estado de carga
  procesando: false, lote: 0, subiendoIdLocal: null, _progreso: {}, _maxTextura: null
};
// Prueba de refirmado automático: abrir la app con ?r360exp=5 hace que las URLs
// firmadas venzan a los 5 s (miniaturas y visor deben refirmar solos una vez).
(() => {
  try{
    const v = Number(new URLSearchParams(location.search).get('r360exp'));
    if(v >= 5 && v <= 86400){ R360.FIRMA_SEGUNDOS = v; console.info(`[360] PRUEBA: URLs firmadas con vencimiento de ${v} s (?r360exp)`); }
  }catch(e){}
})();

// ── Panel de depuración 360 ─────────────────────────────────────────────────
// Se activa con el botón «Depuración 360» (admin/fiscalizador) que guarda una
// bandera en localStorage del contexto actual (la app instalada en iOS no
// comparte almacenamiento con Safari: allí hay que pulsar el botón dentro de
// la app). ?r360debug=1 la activa y ?r360debug=0 la apaga (útil en Safari).
// Apagado no tiene ningún efecto: no se envuelve la consola ni se escribe nada.
// Registro: últimas 200 líneas, persistidas en localStorage para sobrevivir a
// una recarga por memoria; al reabrir se anota en qué línea terminó la sesión
// anterior.
const R360DBG = { KEY: 'r360_debug', LOG_KEY: 'r360_debug_log', EXP_KEY: 'r360_exp', PLEG_KEY: 'r360_debug_plegado', MAX: 200,
                  activo: false, lineas: [], _orig: null, _panel: null, _onError: null, _onRej: null };
function r360DbgLS(k, v){
  try{
    if(v === undefined) return localStorage.getItem(k);
    if(v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  }catch(e){ return null; }
}
function r360DbgActivo(){ return r360DbgLS(R360DBG.KEY) === '1'; }
function r360DbgHora(){ const d = new Date(); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); }
function r360DbgFmt(a){
  if(a instanceof Error) return a.message || String(a);
  if(a && typeof a === 'object'){ try{ return JSON.stringify(a).slice(0, 300); }catch(e){ return String(a); } }
  return String(a);
}
function r360DbgLog(nivel, msg){
  const icono = (nivel === 'warn') ? '⚠' : (nivel === 'error') ? '✖' : '·';
  R360DBG.lineas.push(`${r360DbgHora()} ${icono} ${msg}`);
  if(R360DBG.lineas.length > R360DBG.MAX) R360DBG.lineas.splice(0, R360DBG.lineas.length - R360DBG.MAX);
  r360DbgLS(R360DBG.LOG_KEY, JSON.stringify(R360DBG.lineas));
  r360DbgPintar();
}
// Registro del módulo: no hace nada con el panel apagado
function r360Dbg(msg){ if(R360DBG.activo) r360DbgLog('log', msg); }
function r360DbgCache(){
  if(!R360DBG.activo) return;
  let bytes = 0; R360._blobs.forEach(e => { bytes += e.blob?.size || 0; });
  r360DbgLog('log', `caché de panorámicas: ${R360._blobs.size}/${R360.BLOBS_MAX} · ${(bytes / 1048576).toFixed(1)} MB`);
}
function r360DbgInit(){
  try{
    const q = new URLSearchParams(location.search).get('r360debug');
    if(q === '1') r360DbgLS(R360DBG.KEY, '1'); else if(q === '0') r360DbgLS(R360DBG.KEY, null);
  }catch(e){}
  if(r360DbgLS(R360DBG.EXP_KEY) === '1') R360.FIRMA_SEGUNDOS = 5;   // control «firmas 5 s» del panel, persistido
  if(r360DbgActivo()) r360DbgArrancar();
}
function r360DbgArrancar(){
  if(R360DBG.activo) return;
  R360DBG.activo = true;
  try{ R360DBG.lineas = JSON.parse(r360DbgLS(R360DBG.LOG_KEY) || '[]'); }catch(e){ R360DBG.lineas = []; }
  if(!Array.isArray(R360DBG.lineas)) R360DBG.lineas = [];
  const ultima = R360DBG.lineas.length ? R360DBG.lineas[R360DBG.lineas.length - 1] : null;
  // Consola: solo los mensajes del módulo (prefijo [360]); la consola real sigue recibiendo todo
  R360DBG._orig = {};
  ['log', 'info', 'warn', 'error'].forEach(n => {
    const orig = console[n]; R360DBG._orig[n] = orig;
    console[n] = function(...a){
      try{ orig.apply(console, a); }catch(e){}
      try{ if(typeof a[0] === 'string' && a[0].startsWith('[360]')) r360DbgLog(n, a.map(r360DbgFmt).join(' ')); }catch(e){}
    };
  });
  R360DBG._onError = e => r360DbgLog('error', `window.onerror: ${e.message} (${String(e.filename || '').split('/').pop()}:${e.lineno})`);
  R360DBG._onRej = e => r360DbgLog('error', 'unhandledrejection: ' + r360DbgFmt(e.reason?.message || e.reason));
  window.addEventListener('error', R360DBG._onError);
  window.addEventListener('unhandledrejection', R360DBG._onRej);
  r360DbgCrearPanel();
  if(ultima) r360DbgLog('log', `── la sesión anterior terminó en: ${ultima} ──`);
  const standalone = !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
  r360DbgLog('log', `inicio · ${navigator.userAgent.slice(0, 100)} · instalada=${standalone} · online=${navigator.onLine} · memoria=${navigator.deviceMemory ? navigator.deviceMemory + ' GB' : 'n/d'}`);
  const max = r360MaxTextura();
  r360DbgLog('log', `MAX_TEXTURE_SIZE=${max} → variante ${max >= R360.FULL[0] ? 'full (5760×2880)' : 'web (4096×2048)'} · vencimiento de firmas ${R360.FIRMA_SEGUNDOS} s`);
}
function r360DbgParar(){
  if(!R360DBG.activo) return;
  R360DBG.activo = false;
  if(R360DBG._orig){ Object.entries(R360DBG._orig).forEach(([n, f]) => { console[n] = f; }); R360DBG._orig = null; }
  if(R360DBG._onError) window.removeEventListener('error', R360DBG._onError);
  if(R360DBG._onRej) window.removeEventListener('unhandledrejection', R360DBG._onRej);
  R360DBG._panel?.remove(); R360DBG._panel = null;
}
function r360DbgToggle(){
  if(!PUEDE_PUBLICAR_R360()) return;
  if(r360DbgActivo()){ r360DbgLS(R360DBG.KEY, null); r360DbgParar(); toast('Depuración 360 desactivada', 'info'); }
  else { r360DbgLS(R360DBG.KEY, '1'); r360DbgArrancar(); toast('Depuración 360 activada: queda guardada en este dispositivo', 'info'); }
  document.querySelectorAll('.r360-dbg-btn').forEach(b => { b.textContent = `🐞 Depuración 360: ${r360DbgActivo() ? 'ON' : 'OFF'}`; });
}
function r360DbgBotonHtml(){
  return PUEDE_PUBLICAR_R360() ? `<button class="btn r360-dbg-btn" style="font-size:11px;padding:4px 8px" onclick="r360DbgToggle()">🐞 Depuración 360: ${r360DbgActivo() ? 'ON' : 'OFF'}</button>` : '';
}
function r360DbgCrearPanel(){
  if(R360DBG._panel) return;
  const p = document.createElement('div'); p.id = 'r360DbgPanel'; p.className = 'r360-dbg';
  const plegado = r360DbgLS(R360DBG.PLEG_KEY) === '1';
  p.innerHTML = `<div class="r360-dbg-head">
      <button class="r360-dbg-pleg" onclick="r360DbgPlegar()" title="Plegar / desplegar">${plegado ? '▸' : '▾'}</button>
      <b>Depuración 360</b> <span id="r360DbgN"></span>
      <label title="Equivale a abrir la app con ?r360exp=5"><input type="checkbox" id="r360DbgExp" onchange="r360DbgExp(this.checked)" ${R360.FIRMA_SEGUNDOS === 5 ? 'checked' : ''}/> vencimiento de firmas: 5 s</label>
      <button onclick="r360DbgCopiar()">Copiar registro</button>
      <button onclick="r360DbgLimpiar()">Limpiar</button>
      <button onclick="r360DbgToggle()" title="Desactivar la depuración">✕</button>
    </div>
    <pre id="r360DbgPre" class="r360-dbg-pre" style="display:${plegado ? 'none' : 'block'}"></pre>`;
  document.body.appendChild(p); R360DBG._panel = p;
  r360DbgPintar();
}
function r360DbgPintar(){
  const pre = document.getElementById('r360DbgPre'), n = document.getElementById('r360DbgN');
  if(n) n.textContent = `· ${R360DBG.lineas.length} líneas`;
  if(!pre || pre.style.display === 'none') return;
  pre.textContent = R360DBG.lineas.join('\n');
  pre.scrollTop = pre.scrollHeight;
}
function r360DbgPlegar(){
  const pre = document.getElementById('r360DbgPre'), b = document.querySelector('#r360DbgPanel .r360-dbg-pleg'); if(!pre) return;
  const plegar = pre.style.display !== 'none';
  pre.style.display = plegar ? 'none' : 'block'; if(b) b.textContent = plegar ? '▸' : '▾';
  r360DbgLS(R360DBG.PLEG_KEY, plegar ? '1' : '0');
  r360DbgPintar();
}
async function r360DbgCopiar(){
  const texto = R360DBG.lineas.join('\n');
  try{ await navigator.clipboard.writeText(texto); toast('Registro copiado al portapapeles', 'success'); return; }catch(e){}
  try{   // iOS antiguo / sin permiso: selección + execCommand
    const ta = document.createElement('textarea'); ta.value = texto; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px'; document.body.appendChild(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0, texto.length);
    const ok = document.execCommand('copy'); ta.remove();
    toast(ok ? 'Registro copiado al portapapeles' : 'No se pudo copiar', ok ? 'success' : 'error');
  }catch(e){ toast('No se pudo copiar', 'error'); }
}
function r360DbgLimpiar(){ R360DBG.lineas = []; r360DbgLS(R360DBG.LOG_KEY, null); r360DbgPintar(); }
function r360DbgExp(on){
  R360.FIRMA_SEGUNDOS = on ? 5 : 43200;
  r360DbgLS(R360DBG.EXP_KEY, on ? '1' : null);
  storage360.limpiarCache();
  r360Dbg(`vencimiento de firmas: ${R360.FIRMA_SEGUNDOS} s (caché de firmas vaciada; las miniaturas y el visor deben refirmar solos)`);
}

// Roles (copia de las políticas de observaciones): el residente SUBE puntos
// pero no los actualiza; ubicar en el plano, etiquetar y publicar son de
// admin/fiscalizador; eliminar es de admin.
const PUEDE_EDITAR_R360   = () => ['admin','fiscalizador','residente'].includes(currentPerfil?.rol);
const PUEDE_PUBLICAR_R360 = () => ['admin','fiscalizador'].includes(currentPerfil?.rol);
const ES_ADMIN_R360       = () => currentPerfil?.rol === 'admin';
function r360Congelado(){ const r = R360.recorridoActivo; return !!r && r.estado === 'publicado' && !ES_ADMIN_R360(); }
function r360PuedeUbicar(){ return PUEDE_PUBLICAR_R360() && !r360Congelado(); }
// Fijar el norte de un punto: admin y fiscalizador siempre (heading_norte sigue editable en
// publicado); el residente solo con el recorrido en borrador (su política de UPDATE no alcanza
// filas de un recorrido publicado).
function r360PuedeFijarNorte(){
  const r = R360.recorridoActivo; if(!r) return false;
  return PUEDE_PUBLICAR_R360() || (currentPerfil?.rol === 'residente' && r.estado === 'borrador');
}

// uuid v4 con fallback real (Safari antiguo sin crypto.randomUUID). Nunca null:
// el id del punto forma la ruta de storage y la fila.
function r360Uuid(){
  if(crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

// ── storage360: ÚNICA puerta al bucket (subida, URLs firmadas, blobs) ───────
// Aísla el backend (Supabase hoy; R2 mañana) y garantiza que ninguna URL
// pública se construya en otro sitio. Caché en memoria por ruta con vencimiento.
const _firmas360 = new Map();   // ruta -> { url, expira }
const storage360 = {
  ruta(proyectoId, recorridoId, puntoId, variante){
    return `${proyectoId}/${recorridoId}/${puntoId}/${variante}.jpg`;
  },
  // upsert:false a propósito: el residente no tiene UPDATE en el bucket. Si el
  // objeto ya existe (reintento tras una subida parcial) se da por subido.
  async subir(path, blob){
    const { error } = await sb.storage.from(R360.BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if(error){
      if(String(error.statusCode) === '409' || /already exists|duplicate/i.test(error.message || '')) return true;
      throw error;
    }
    return true;
  },
  // UNA llamada por lote (todas las variantes de todos los puntos de un recorrido).
  async getUrls(paths, expiresIn = R360.FIRMA_SEGUNDOS){
    const ahora = Date.now(), res = {}, faltan = [];
    for(const p of paths){
      if(!p) continue;
      const c = _firmas360.get(p);
      if(c && c.expira > ahora) res[p] = c.url; else faltan.push(p);
    }
    if(faltan.length){
      const { data, error } = await sb.storage.from(R360.BUCKET).createSignedUrls(faltan, expiresIn);
      if(error) throw error;
      const expira = ahora + Math.max(expiresIn - 60, 1) * 1000;
      (data || []).forEach(d => {
        if(d.signedUrl && !d.error){ _firmas360.set(d.path, { url: d.signedUrl, expira }); res[d.path] = d.signedUrl; }
      });
    }
    return res;
  },
  async getUrl(path, expiresIn = R360.FIRMA_SEGUNDOS){
    const c = _firmas360.get(path);
    if(c && c.expira > Date.now()) return c.url;
    const { data, error } = await sb.storage.from(R360.BUCKET).createSignedUrl(path, expiresIn);
    if(error) throw error;
    _firmas360.set(path, { url: data.signedUrl, expira: Date.now() + Math.max(expiresIn - 60, 1) * 1000 });
    return data.signedUrl;
  },
  async refirmar(path, motivo){
    _firmas360.delete(path);
    r360Dbg(`refirma${motivo ? ' (' + motivo + ')' : ''}: …/${String(path).split('/').slice(-2).join('/')}`);
    return storage360.getUrl(path);
  },
  // Para informes y exportes: se incrusta la imagen, nunca la URL firmada.
  async getBlob(path){
    const { data, error } = await sb.storage.from(R360.BUCKET).download(path);
    if(error) throw error;
    return data;
  },
  // "Compartir con cliente" (sin UI todavía): solo admin/fiscalizador.
  async getShareUrl(path, dias = 7){
    if(!PUEDE_PUBLICAR_R360()) throw new Error('Solo admin o fiscalizador pueden generar enlaces para compartir');
    const { data, error } = await sb.storage.from(R360.BUCKET).createSignedUrl(path, Math.round(dias * 86400));
    if(error) throw error;
    return data.signedUrl;
  },
  // remove() NO falla cuando la política niega el borrado: devuelve solo los
  // objetos que sí borró. Se devuelve ese número; si es menor y no es esperado
  // (`parcialEsperado`), se avisa en consola.
  async borrar(paths, parcialEsperado = false){
    const lista = paths.filter(Boolean);
    if(!lista.length) return 0;
    const { data, error } = await sb.storage.from(R360.BUCKET).remove(lista);
    if(error) throw error;
    const n = (data || []).length;
    if(n < lista.length && !parcialEsperado) console.warn(`[360] remove(): ${lista.length - n} de ${lista.length} objeto(s) no se borraron (sin permiso o inexistentes)`, lista);
    return n;
  },
  limpiarCache(){ _firmas360.clear(); }
};

// <img> con URL firmada: si falla la carga (403 por vencimiento u otro error),
// refirma y reintenta UNA sola vez; a la segunda muestra un marcador.
function r360SetImg(img, path){
  if(!img || !path) return;
  img.dataset.r360Path = path;
  img.dataset.r360Reintento = '0';
  img.onerror = async () => {
    if(img.dataset.r360Reintento === '1'){ img.onerror = null; img.alt = 'Imagen no disponible'; img.style.opacity = '.4'; return; }
    img.dataset.r360Reintento = '1';
    try{ img.src = await storage360.refirmar(path, 'img onerror'); }catch(e){ img.onerror = null; }
  };
  storage360.getUrl(path).then(u => { img.src = u; }).catch(() => { img.alt = 'Sin acceso'; });
}

// ── Validación de entrada ───────────────────────────────────────────────────
function r360Ext(nombre){ return (String(nombre || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || ''; }

// Lee ancho/alto del marcador SOF del JPEG sin decodificar la imagen.
async function leerDimensionesJPEG(file){
  const MAX = Math.min(file.size, 8 * 1024 * 1024);
  const buf = new DataView(await file.slice(0, MAX).arrayBuffer());
  if(buf.byteLength < 4 || buf.getUint16(0) !== 0xFFD8) return null;
  const SOF = new Set([0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF]);
  let off = 2;
  while(off + 9 < buf.byteLength){
    if(buf.getUint8(off) !== 0xFF){ off++; continue; }
    const marker = buf.getUint8(off + 1);
    if(marker === 0xFF){ off++; continue; }
    if(marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)){ off += 2; continue; }
    if(marker === 0xD9 || marker === 0xDA) return null;      // fin o inicio de scan sin SOF
    const len = buf.getUint16(off + 2);
    if(SOF.has(marker)) return { alto: buf.getUint16(off + 5), ancho: buf.getUint16(off + 7) };
    off += 2 + len;
  }
  return null;
}

async function validarArchivo360(file){
  const ext = r360Ext(file.name);
  if(ext === 'insp' || ext === 'insv') throw new Error(R360.MSG_INSTA);
  if(ext === 'mp4' || (file.type || '').startsWith('video/')) throw new Error(R360.MSG_VIDEO);
  if(!(file.type === 'image/jpeg' || ext === 'jpg' || ext === 'jpeg')) throw new Error(`«${file.name}» no es un JPEG`);
  const dims = await leerDimensionesJPEG(file);
  if(!dims || !dims.ancho || !dims.alto) throw new Error(`No se pudo leer el tamaño de «${file.name}»`);
  if(Math.abs(dims.ancho / dims.alto - 2) / 2 > R360.TOLERANCIA_RATIO){
    throw new Error(`«${file.name}» no es equirectangular 2:1 (${dims.ancho}×${dims.alto}). ${R360.MSG_INSTA}`);
  }
  return dims;
}

// ── Metadatos (exifr) — ANTES de comprimir, porque canvas descarta EXIF/XMP ──
// Mapeo provisional: fecha_captura obligatoria (fallback lastModified con
// aviso), lat/lon/alt y heading opcionales. Se afinará con exportaciones
// reales de la Insta360 (window._r360DiagnosticoMeta = true vuelca las claves).
async function leerMetadatos360(file, dims){
  const meta = { fecha_captura: null, fecha_estimada: false, lat: null, lon: null, alt: null,
                 heading_norte: null, camara: null, ancho_original: dims.ancho, alto_original: dims.alto };
  try{
    if(typeof exifr === 'undefined') throw new Error('exifr no cargado');
    const m = await exifr.parse(file, { tiff: true, ifd0: true, exif: true, gps: true, xmp: true, iptc: false, icc: false, mergeOutput: true });
    if(m){
      const f = m.DateTimeOriginal || m.CreateDate || m.DateTimeDigitized || m.ModifyDate;
      if(f instanceof Date && !isNaN(f)) meta.fecha_captura = f.toISOString();
      else if(typeof f === 'string' && !isNaN(Date.parse(f))) meta.fecha_captura = new Date(f).toISOString();
      if(typeof m.latitude === 'number' && typeof m.longitude === 'number'){ meta.lat = m.latitude; meta.lon = m.longitude; }
      if(typeof m.GPSAltitude === 'number') meta.alt = m.GPSAltitude;
      const h = m.PoseHeadingDegrees ?? m.GPano?.PoseHeadingDegrees ?? m['GPano:PoseHeadingDegrees'];
      if(h != null && isFinite(Number(h))) meta.heading_norte = Number(h);
      const cam = [m.Make, m.Model].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      if(cam) meta.camara = cam;
      if(window._r360DiagnosticoMeta) console.info('[360] metadatos', file.name, Object.keys(m));
    }
  }catch(e){ console.warn('[360] exifr:', e?.message || e); }
  if(!meta.fecha_captura){
    meta.fecha_captura = new Date(file.lastModified || Date.now()).toISOString();
    meta.fecha_estimada = true;
  }
  return meta;
}

async function sha256Archivo(file){
  const h = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Variantes (de a una imagen; bitmap y canvas liberados en TODOS los caminos) ──
function r360ErrorPC(codigo){ const e = new Error(R360.MSG_PC); e.codigo = codigo; return e; }
function r360Blob(canvas, q){
  return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(r360ErrorPC('CANVAS')), 'image/jpeg', q));
}
async function r360Escalar(src, [w, h], q){
  const c = document.createElement('canvas');
  try{
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(src, 0, 0, w, h);
    return await r360Blob(c, q);
  }finally{ c.width = c.height = 0; }
}

async function procesarPanoramica(file, dims, onProgreso){
  const objW = Math.min(R360.FULL[0], dims.ancho), objH = Math.round(objW / 2);
  let bitmap;
  try{
    // resize en el decodificador: nunca se materializan los 72 MP
    bitmap = await createImageBitmap(file, { resizeWidth: objW, resizeHeight: objH, resizeQuality: 'high' });
  }catch(e1){
    try{ bitmap = await createImageBitmap(file); }              // navegadores sin opciones de resize
    catch(e2){ throw r360ErrorPC('DECODIFICACION'); }
  }
  const canvasFull = document.createElement('canvas');
  try{
    try{
      canvasFull.width = objW; canvasFull.height = objH;
      canvasFull.getContext('2d').drawImage(bitmap, 0, 0, objW, objH);
    }catch(e){ throw r360ErrorPC('CANVAS'); }
    finally{ bitmap.close?.(); bitmap = null; }
    onProgreso?.('full');
    // Calidad adaptativa: si full supera 5,5 MB baja de 0,04 en 0,04 hasta 0,70
    let q = R360.CALIDAD, full = await r360Blob(canvasFull, q);
    while(full.size > R360.FULL_MAX_BYTES && q - R360.PASO_CALIDAD >= R360.CALIDAD_MIN - 1e-9){
      q = +(q - R360.PASO_CALIDAD).toFixed(2);
      full = await r360Blob(canvasFull, q);
    }
    const web = await r360Escalar(canvasFull, [Math.min(R360.WEB[0], objW), Math.min(R360.WEB[1], objH)], 0.82);
    onProgreso?.('web');
    const thumb = await r360Escalar(canvasFull, R360.THUMB, 0.80);
    onProgreso?.('thumb');
    return { full, web, thumb, calidadFull: q, anchoProcesado: objW, altoProcesado: objH };
  }finally{
    canvasFull.width = canvasFull.height = 0;   // libera ~66 MB también si algo falló
  }
}

// MAX_TEXTURE_SIZE del dispositivo: decide si el visor carga 'full' o 'web'.
// El contexto de prueba se libera enseguida (cuentan para el cupo del navegador).
function r360MaxTextura(){
  if(R360._maxTextura) return R360._maxTextura;
  try{
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    R360._maxTextura = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096;
    try{ gl?.getExtension('WEBGL_lose_context')?.loseContext(); }catch(e){}
  }catch(e){ R360._maxTextura = 4096; }
  return R360._maxTextura;
}
function r360VarianteVisor(){
  const max = r360MaxTextura(), full = max >= R360.FULL[0];
  if(!R360._logVariante){ R360._logVariante = true; console.info(`[360] MAX_TEXTURE_SIZE=${max} → el visor usa la variante ${full ? 'full (5760×2880)' : 'web (4096×2048)'}`); }
  if(R360.cmp.activo && r360EsTelefono()) return 'archivo_web';   // dos panorámicas a la vez: la ligera en ambos visores
  return full ? 'archivo_full' : 'archivo_web';
}

// ── Cola de subida (IndexedDB 'hidivo-offline', store 'pendientes', tipo 'punto360') ──
function r360Pausada(){ try{ return localStorage.getItem('r360_pausa') === '1'; }catch(e){ return false; } }
function r360SetPausa(v){ try{ localStorage.setItem('r360_pausa', v ? '1' : '0'); }catch(e){} }
// Lo consulta el bucle de sincronización de index.html: pausada o agotada = saltar.
function r360ColaSaltar(item){ return r360Pausada() || !!item.errorDefinitivo; }

// Programa la sincronización; si ya hay una en curso reintenta unas veces y
// luego deja que la recoja el intervalo de 180 s de index.html.
function r360ProgramarSync(intento = 0){
  if(!navigator.onLine || r360Pausada()) return;
  if(typeof _sincronizandoOffline !== 'undefined' && _sincronizandoOffline){
    if(intento < 20) setTimeout(() => r360ProgramarSync(intento + 1), 3000);
    return;
  }
  sincronizarRegistrosOffline();
}

async function r360ItemSigueEnCola(idLocal){
  try{ return !!(await idbOp('readonly', s => s.get(idLocal))); }catch(e){ return true; }
}
function r360RutasItem(item){
  return { full:  storage360.ruta(item.proyecto_id, item.recorrido_id, item.punto_id, 'full'),
           web:   storage360.ruta(item.proyecto_id, item.recorrido_id, item.punto_id, 'web'),
           thumb: storage360.ruta(item.proyecto_id, item.recorrido_id, item.punto_id, 'thumb') };
}
// Borra los objetos de un ítem abandonado (dedupe, descarte). Se intentan las
// TRES rutas siempre, no solo las que esta sesión recuerda haber subido: tras
// recargar la página el progreso en memoria se pierde, y remove() es
// idempotente. La política "fotos360 eliminar propios sin punto" impide borrar
// objetos referenciados por una fila o ajenos. Falla en silencio hacia el
// usuario, pero SIEMPRE deja rastro en consola.
async function r360LimpiarSobrantes(item, motivo, prog){
  prog = prog || R360._progreso[item.idLocal] || {};
  const rutas = Object.values(r360RutasItem(item));
  const enSesion = ['full','web','thumb'].filter(v => prog[v]).length;
  try{
    const n = await storage360.borrar(rutas, true);
    console.info(`[360] limpieza (${motivo}): ${n} objeto(s) borrados de ${rutas.length} posibles (${enSesion} subidos en esta sesión)`);
    return { ok: true, red: false };
  }catch(e){
    const red = esErrorDeRed(e);
    console.warn(`[360] limpieza (${motivo}) falló${red ? ' por red (se reintentará)' : ''}; pueden quedar objetos huérfanos:`, e?.message || e, rutas);
    return { ok: false, red };
  }
}
// Lápida: pendiente de limpieza sin blobs; el bucle de sincronización la
// ejecuta (r360EjecutarLapida) al tener conexión.
async function r360GuardarLapida(item){
  try{
    await idbGuardar({ idLocal: r360Uuid(), creadoOffline: new Date().toISOString(), tipo: 'punto360_limpieza',
      punto_id: item.punto_id, recorrido_id: item.recorrido_id, proyecto_id: item.proyecto_id, rutas: Object.values(r360RutasItem(item)) });
  }catch(e){ console.warn('[360] no se pudo guardar la lápida de limpieza:', e?.message || e); }
}
// ¿El punto de este ítem ya tiene fila en el servidor? (true/false; lanza si la consulta falla)
async function r360PuntoRegistrado(item){
  const { data, error } = await sb.from('puntos_360').select('id').eq('id', item.punto_id).maybeSingle();
  if(error) throw error;
  return !!data;
}
// Ejecuta una lápida (la llama index.html): si el punto quedó registrado no se
// borra nada (un admin sí podría borrar objetos con fila). Lanza en error de red.
async function r360EjecutarLapida(item){
  if(item.punto_id && await r360PuntoRegistrado(item)){ console.info('[360] lápida: el punto ya está registrado, no se borra nada'); return; }
  await storage360.borrar(item.rutas || [], true);
}

// Sube un ítem de la cola: 3 variantes + fila. Idempotente ante reintentos:
// dedupe por hash en el servidor, objetos ya existentes se aceptan (409), y el
// UNIQUE (recorrido, hash) convierte un insert repetido en éxito. El progreso
// por variante vive en memoria (no se reescriben 7 MB de blobs en IndexedDB).
// Devuelve el id del punto, o null si el ítem fue descartado (no cuenta como
// sincronizado).
async function subirPunto360Offline(item){
  R360.subiendoIdLocal = item.idLocal; r360PintarCola();
  const prog = R360._progreso[item.idLocal] = R360._progreso[item.idLocal] || {};
  const rutas = r360RutasItem(item);
  let terminado = false;
  const buscarPorHash = async () => {
    const { data, error } = await sb.from('puntos_360').select('id')
      .eq('recorrido_id', item.recorrido_id).eq('hash_sha256', item.punto.hash_sha256).maybeSingle();
    if(error) throw error;
    return data;
  };
  // Limpieza cuyo fallo de red debe reintentarse con el ítem (sigue en cola): se relanza como error de red
  const limpiarOFallar = async motivo => {
    const r = await r360LimpiarSobrantes(item, motivo, prog);
    if(!r.ok && r.red) throw new Error('Failed to fetch (limpieza de sobrantes: ' + motivo + ')');
  };
  // Limpieza de un ítem que YA salió de la cola: si falla, queda una lápida
  const limpiarOLapida = async motivo => { const r = await r360LimpiarSobrantes(item, motivo, prog); if(!r.ok) await r360GuardarLapida(item); };
  try{
    // Ya no está en cola: quien lo descartó (r360DescartarItem) limpió o dejó lápida; aquí no se borra nada
    // (podría ser un punto cuya fila SÍ llegó al servidor, y un admin sí puede borrar objetos con fila)
    if(!(await r360ItemSigueEnCola(item.idLocal))){ terminado = true; return null; }
    // Otro intento (u otro dispositivo) ya registró esta foto: lo que este ítem
    // hubiera subido bajo OTRO punto_id sobra.
    const dup = await buscarPorHash();
    if(dup){ if(dup.id !== item.punto_id) await limpiarOFallar('foto ya registrada en otro punto'); terminado = true; return dup.id; }
    for(const v of ['thumb','web','full']){
      if(prog[v]) continue;
      await storage360.subir(rutas[v], item.blobs[v]);
      prog[v] = true;
    }
    if(!(await r360ItemSigueEnCola(item.idLocal))){   // el usuario lo descartó mientras subía
      terminado = true; await limpiarOLapida('ítem descartado durante la subida'); return null;
    }
    const p = item.punto;
    const { error } = await sb.from('puntos_360').insert({
      id: item.punto_id, recorrido_id: item.recorrido_id,
      plano_id: p.plano_id || null, x: p.x ?? null, y: p.y ?? null, orden: p.orden || 0, etiqueta: p.etiqueta || null,
      fecha_captura: p.fecha_captura, lat: p.lat, lon: p.lon, alt: p.alt, heading_norte: p.heading_norte,
      archivo_full: rutas.full, archivo_web: rutas.web, archivo_thumb: rutas.thumb,
      ancho_original: p.ancho_original, alto_original: p.alto_original, camara: p.camara,
      hash_sha256: p.hash_sha256,
      notas: p.fecha_estimada ? 'Fecha de captura estimada: el archivo no traía EXIF, se usó la fecha del archivo.' : null
    });
    if(error){
      if(error.code === '23505'){
        // ¿Chocó por (recorrido, hash) con OTRO punto, o por id con la misma fila
        // (insert repetido)? Solo en el primer caso los objetos de este ítem sobran.
        const existente = await buscarPorHash();
        if(existente && existente.id !== item.punto_id){ await limpiarOFallar('UNIQUE por hash: otro punto ya tiene esta foto'); terminado = true; return existente.id; }
        terminado = true;
        return item.punto_id;
      }
      throw error;
    }
    terminado = true;
    return item.punto_id;
  }catch(e){
    if(!esErrorDeRed(e)){
      item.intentos = (item.intentos || 0) + 1;
      item.ultimoError = e?.message || String(e);
      if(item.intentos >= R360.MAX_REINTENTOS) item.errorDefinitivo = true;
      if(await r360ItemSigueEnCola(item.idLocal)) await idbGuardar(item);
    }
    throw e;
  }finally{
    if(terminado) delete R360._progreso[item.idLocal];   // si sigue en cola, prog evita resubir variantes
    R360.subiendoIdLocal = null;
    if(currentPage === 'recorridos360') r360PintarCola();
  }
}

async function r360ItemsCola(recorridoId){
  let todos = []; try{ todos = await idbTodos(); }catch(e){}
  return todos.filter(i => i.tipo === 'punto360' && (!recorridoId || i.recorrido_id === recorridoId))
              .sort((a, b) => (a.punto?.orden || 0) - (b.punto?.orden || 0));
}
async function r360ReintentarItem(idLocal){
  const it = (await r360ItemsCola()).find(i => i.idLocal === idLocal);
  if(!it) return;
  it.intentos = 0; it.errorDefinitivo = false; it.ultimoError = null;
  await idbGuardar(it); actualizarIndicadorOffline(); r360PintarCola(); r360ProgramarSync();
}
// Descartar: quita el ítem de la cola y limpia sus objetos. Sin conexión deja
// una "lápida" (tipo punto360_limpieza, sin blobs) que el bucle de
// sincronización ejecuta al volver la señal.
async function r360DescartarItem(idLocal){
  if(R360.subiendoIdLocal === idLocal){ toast('Esa foto se está subiendo ahora; espera a que termine', 'info'); return; }
  if(!confirm('¿Descartar esta foto de la cola? No se subirá.')) return;
  const it = (await r360ItemsCola()).find(i => i.idLocal === idLocal);
  if(R360.subiendoIdLocal === idLocal){ toast('Esa foto empezó a subirse; espera a que termine', 'info'); return; }
  if(!it){ r360PintarCola(); return; }
  await idbBorrar(idLocal);
  const prog = R360._progreso[idLocal] || {};
  delete R360._progreso[idLocal];
  if(navigator.onLine){
    // Si la fila ya existe en el servidor (el INSERT llegó pero su respuesta se
    // perdió) NO se borra nada: los objetos son de un punto registrado.
    let registrado = null;
    try{ registrado = await r360PuntoRegistrado(it); }catch(e){ registrado = null; }   // null = no se pudo saber
    if(registrado === true) toast('Esa foto ya estaba registrada en el servidor; se quitó de la cola sin borrar nada', 'info');
    else if(registrado === false){ const r = await r360LimpiarSobrantes(it, 'ítem descartado de la cola', prog); if(!r.ok) await r360GuardarLapida(it); }
    else await r360GuardarLapida(it);
  } else await r360GuardarLapida(it);
  actualizarIndicadorOffline(); r360PintarCola();
}
function r360TogglePausa(){
  r360SetPausa(!r360Pausada());
  toast(r360Pausada() ? '⏸ Subida de fotos 360 pausada' : '▶ Subida de fotos 360 reanudada', 'info');
  actualizarIndicadorOffline(); r360PintarCola(); r360ProgramarSync();
}

// ── Flujo de carga: seleccionar N fotos → validar → metadatos+hash → ordenar →
//    procesar de a una → encolar → sincronizar ──────────────────────────────
async function subirFotos360(input){
  const archivos = Array.from(input.files || []); input.value = '';
  const rec = R360.recorridoActivo;
  if(!archivos.length || !rec) return;
  if(bloquearSiCerrado()) return;
  if(!PUEDE_EDITAR_R360()){ toast('Tu rol no puede subir fotos 360', 'error'); return; }
  if(rec.estado === 'publicado' && !ES_ADMIN_R360()){ toast('El recorrido está publicado: solo un administrador puede añadir fotos', 'error'); return; }
  if(R360.procesando){ toast('Ya hay un lote en proceso; espera a que termine', 'info'); return; }
  R360.procesando = true;
  const lote = R360.lote;                       // token: cambiar de proyecto cancela el lote entre fotos
  const cancelado = () => R360.lote !== lote;
  const ui = r360ProgresoUI(); const errores = []; const validos = [];
  try{
    // 1) validar + metadatos + hash (sin decodificar), y ordenar por fecha_captura
    const hashesExistentes = new Set([...R360.puntos.map(p => p.hash_sha256), ...(await r360ItemsCola(rec.id)).map(i => i.punto.hash_sha256)].filter(Boolean));
    for(let i = 0; i < archivos.length; i++){
      if(cancelado()) return;
      const f = archivos[i];
      ui.set(`Leyendo ${i + 1}/${archivos.length}: ${f.name}`, (i / archivos.length) * 30);
      try{
        const dims = await validarArchivo360(f);
        const hash = await sha256Archivo(f);
        if(hashesExistentes.has(hash)){ errores.push(`«${f.name}»: ya está en este recorrido (duplicada)`); continue; }
        hashesExistentes.add(hash);
        const meta = await leerMetadatos360(f, dims);
        validos.push({ f, dims, hash, meta });
      }catch(e){ errores.push(`«${f.name}»: ${e.message}`); }
    }
    validos.sort((a, b) => a.meta.fecha_captura.localeCompare(b.meta.fecha_captura));
    // 2) procesar de a una y encolar (cada foto queda persistida al terminar)
    let ordenBase = R360.puntos.reduce((m, p) => Math.max(m, p.orden || 0), 0);
    ordenBase = (await r360ItemsCola(rec.id)).reduce((m, i) => Math.max(m, i.punto?.orden || 0), ordenBase);
    let encoladas = 0, sinFecha = 0;
    for(let i = 0; i < validos.length; i++){
      if(cancelado()) return;
      const v = validos[i];
      const base = 30 + (i / validos.length) * 70, tramo = 70 / validos.length;
      ui.set(`Procesando ${i + 1}/${validos.length}: ${v.f.name}`, base);
      try{
        const variantes = await procesarPanoramica(v.f, v.dims, etapa => {
          ui.set(`Procesando ${i + 1}/${validos.length}: ${v.f.name} · ${etapa}`, base + tramo * ({ full: .6, web: .85, thumb: 1 }[etapa] || 0));
        });
        if(cancelado()) return;
        if(v.meta.fecha_estimada) sinFecha++;
        await idbGuardar({
          idLocal: r360Uuid(), creadoOffline: new Date().toISOString(), tipo: 'punto360',
          proyecto_id: rec.proyecto_id, recorrido_id: rec.id, punto_id: r360Uuid(),
          punto: { ...v.meta, hash_sha256: v.hash, orden: ++ordenBase, nombre_original: v.f.name, plano_id: null, x: null, y: null, etiqueta: null,
                   calidad_full: variantes.calidadFull, ancho_procesado: variantes.anchoProcesado, alto_procesado: variantes.altoProcesado },
          blobs: { full: variantes.full, web: variantes.web, thumb: variantes.thumb },
          intentos: 0, autorId: currentUser?.id
        });
        encoladas++;
      }catch(e){
        errores.push(`«${v.f.name}»: ${e.message}`);
        if(e.codigo){ errores.push('Este dispositivo no pudo decodificar la imagen. ' + R360.MSG_PC + '.'); break; }
      }
      actualizarIndicadorOffline();
    }
    ui.set(`Listo: ${encoladas} foto(s) en cola${sinFecha ? ` · ${sinFecha} sin fecha EXIF (se usó la fecha del archivo)` : ''}`, 100);
    if(errores.length) ui.errores(errores);
    if(encoladas){
      toast(navigator.onLine ? `${encoladas} foto(s) 360 en cola: subiendo…` : `📴 ${encoladas} foto(s) 360 guardadas en el dispositivo; se subirán con conexión`, 'success');
      r360ProgramarSync();
    }
  }finally{
    if(!cancelado()){ R360.procesando = false; r360PintarCola(); }
  }
}

function r360ProgresoUI(){
  const mostrar = () => { const c = document.getElementById('r360Progreso'); if(c) c.style.display = 'block'; };
  mostrar();
  return {
    set(texto, pct){
      mostrar();   // un re-render parcial puede haber recreado el contenedor
      const t = document.getElementById('r360ProgresoTexto'), b = document.getElementById('r360ProgresoBarra');
      if(t) t.textContent = texto; if(b) b.style.width = Math.max(0, Math.min(100, pct)) + '%';
    },
    errores(lista){
      mostrar();
      const e = document.getElementById('r360ProgresoErrores');
      if(e){ e.style.display = 'block'; e.innerHTML = '<b>No se subieron:</b><ul style="margin:4px 0 0 16px">' + lista.map(x => `<li>${escAttr(x)}</li>`).join('') + '</ul>'; }
    }
  };
}

// ── Página ──────────────────────────────────────────────────────────────────
// Al cambiar de proyecto: se descarta la vista, se cancela un lote en curso
// (token), se destruye el visor, se abortan descargas y se vacían cachés.
// NO se toca subiendoIdLocal: la subida en curso del bucle offline termina sola.
function limpiarEstadoR360(){
  r360CerrarComparacion();
  R360.recorridos = []; R360.recorridoActivo = null; R360.puntos = []; R360.planos = [];
  R360.planoId = null; R360.seleccionado = null; R360.visorPuntoId = null; r360CancelarArrastre();
  R360._mapaToken++; r360PdfReset();
  r360AbortarDescarga(); if(R360._precarga){ try{ R360._precarga.abort(); }catch(e){} R360._precarga = null; }
  r360VaciarCacheBlobs();
  r360DestruirVisor();
  R360._parejas.clear(); R360._aspectos.clear(); R360._sinPagina = false; R360.lt.puntoId = null; R360.lt.parejas = null; R360.lt.mostrado = null;
  if(R360.procesando){ R360.lote++; R360.procesando = false; }
  storage360.limpiarCache();
}
function r360Punto(id){ return R360.puntos.find(p => p.id === id); }
function r360PuntosOrdenados(){
  return [...R360.puntos].sort((a, b) => ((a.orden || 0) - (b.orden || 0)) || String(a.fecha_captura || '').localeCompare(String(b.fecha_captura || '')));
}
function r360Fecha(iso, corta){
  if(!iso) return '—';
  try{ return new Date(iso).toLocaleString('es-EC', corta ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch(e){ return String(iso); }
}
// Módulo activo en el proyecto actual: por la ficha del proyecto (fuente de
// verdad) y por el ítem de menú (aplicarModulosProyecto). Apagado por defecto.
function r360ModuloActivo(){
  const nav = document.querySelector('.nav-item[onclick*="recorridos360"]');
  if(nav && nav.style.display === 'none') return false;
  const proy = (typeof proyectos !== 'undefined' && Array.isArray(proyectos)) ? proyectos.find(x => x.id === currentProyecto) : null;
  if(proy && proy.modulos?.recorridos360 !== true) return false;
  return true;
}

async function cargarRecorridos360(){
  const cont = document.getElementById('recorridos360Content');
  if(!cont) return;
  if(!r360ModuloActivo()){ cont.innerHTML = ''; return; }
  if(!currentProyecto){ cont.innerHTML = '<div class="empty-state"><div class="empty-icon">🌐</div><div class="empty-title">Selecciona un proyecto</div></div>'; return; }
  // Entrar a la sección (menú, «Volver a recorridos», «atrás» del historial) muestra
  // SIEMPRE la lista: el recorrido abierto, si lo había, se descarta.
  r360DescartarRecorridoAbierto();
  const proy = currentProyecto;
  const { data, error } = await sb.from('recorridos_360').select('*, puntos_360(count)')
    .eq('proyecto_id', proy).order('fecha', { ascending: false }).order('created_at', { ascending: false });
  // Mientras se consultaba pudo cambiar el proyecto, abrirse un recorrido (o estar
  // reabriéndose uno desde el historial) o empezar a escribirse uno nuevo: una
  // lista tardía no pisa nada de eso
  if(proy !== currentProyecto || R360._aperturaPendiente || (R360.recorridoActivo && R360.recorridoActivo.proyecto_id === currentProyecto)) return;
  const formAbierto = document.getElementById('r360NuevoForm');
  if(formAbierto && formAbierto.style.display !== 'none') return;
  if(error){
    // Migración 20260922_recorridos_360.sql sin aplicar: PostgREST responde PGRST205 ("Could not
    // find the table … in the schema cache"); una consulta directa daría 42P01. Aviso amistoso.
    const sinMigracion = ['PGRST205', '42P01'].includes(error.code) || /schema cache|does not exist|no existe/i.test(error.message || '');
    cont.innerHTML = sinMigracion
      ? '<div class="r360-aviso" style="margin:16px">El módulo Recorridos 360 todavía no está habilitado en la base de datos (falta aplicar la migración <code>20260922_recorridos_360.sql</code>). Avisa al administrador.</div>'
      : `<div class="r360-error" style="margin:16px">No se pudieron cargar los recorridos: ${escAttr(error.message)}</div>`;
    return;
  }
  R360.recorridos = data || [];
  const puede = PUEDE_EDITAR_R360();
  cont.innerHTML = `
  <div class="card">
    <div class="card-header">
      <div><div class="card-title">🌐 Recorridos 360</div><div class="card-subtitle">${R360.recorridos.length} recorrido(s)</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${r360DbgBotonHtml()}${puede ? '<button class="btn primary" onclick="r360NuevoRecorridoForm()">+ Nuevo recorrido</button>' : ''}</div>
    </div>
    <div id="r360NuevoForm" style="display:none;padding:12px 16px;border-bottom:1px solid #e6e9ef">
      <div style="display:grid;grid-template-columns:140px 1fr;gap:10px">
        <div class="form-group" style="margin:0"><label class="form-label">Fecha</label><input type="date" class="form-control" id="r360NuevoFecha"/></div>
        <div class="form-group" style="margin:0"><label class="form-label">Título</label><input type="text" class="form-control" id="r360NuevoTitulo" placeholder="Ej.: Recorrido semanal — nivel 2"/></div>
      </div>
      <div class="form-group" style="margin:10px 0 0"><label class="form-label">Descripción (opcional)</label><textarea class="form-control" id="r360NuevoDesc" rows="2"></textarea></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button class="btn" onclick="document.getElementById('r360NuevoForm').style.display='none'">Cancelar</button>
        <button class="btn primary" onclick="r360CrearRecorrido()">Crear</button>
      </div>
    </div>
    ${R360.recorridos.length ? `<div class="r360-grid" style="padding:16px">${R360.recorridos.map(r => `
      <div class="r360-card" onclick="abrirRecorrido360('${r.id}')">
        <div class="r360-fecha">${escAttr(r.fecha || '')} · <span class="r360-estado ${r.estado}">${r.estado === 'publicado' ? 'PUBLICADO' : 'BORRADOR'}</span></div>
        <div class="r360-titulo">${escAttr(r.titulo)}</div>
        <div style="font-size:12px;color:#676879">${(r.puntos_360?.[0]?.count ?? 0)} punto(s)${r.descripcion ? ' · ' + escAttr(String(r.descripcion).slice(0, 80)) : ''}</div>
      </div>`).join('')}</div>`
    : `<div style="padding:32px;text-align:center;color:#676879"><div style="font-size:32px;margin-bottom:8px">🌐</div>Aún no hay recorridos 360 en este proyecto${puede ? '<div style="font-size:12px;margin-top:6px">Crea uno y sube las fotos exportadas desde la app Insta360</div>' : ''}</div>`}
  </div>`;
}
// Lo llama index.html al terminar una sincronización que subió fotos 360:
// refresco ligero del recorrido abierto, o de la lista si no hay formulario a medias.
function r360RefrescarTrasSync(ok360){
  if(!ok360 || currentPage !== 'recorridos360') return;
  if(R360.recorridoActivo){ abrirRecorrido360(R360.recorridoActivo.id); return; }
  const form = document.getElementById('r360NuevoForm');
  if(form && form.style.display !== 'none') return;
  cargarRecorridos360();
}

function r360NuevoRecorridoForm(){
  const f = document.getElementById('r360NuevoForm'); if(!f) return;
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
  const fecha = document.getElementById('r360NuevoFecha'); if(fecha && !fecha.value) fecha.value = (typeof hoyEcuador === 'function' ? hoyEcuador() : new Date().toISOString().slice(0, 10));
  document.getElementById('r360NuevoTitulo')?.focus();
}

async function r360CrearRecorrido(){
  if(bloquearSiCerrado()) return;
  const fecha = document.getElementById('r360NuevoFecha')?.value, titulo = (document.getElementById('r360NuevoTitulo')?.value || '').trim();
  const descripcion = (document.getElementById('r360NuevoDesc')?.value || '').trim() || null;
  if(!fecha || !titulo){ toast('Fecha y título son obligatorios', 'error'); return; }
  const { data, error } = await sb.from('recorridos_360').insert({ proyecto_id: currentProyecto, fecha, titulo, descripcion, creado_por: currentUser?.id || null }).select().single();
  if(error){ toast('Error: ' + error.message, 'error'); return; }
  toast('Recorrido creado ✓', 'success');
  abrirRecorrido360(data.id);
}

// Abre un recorrido. Si YA está pintado (mismo id y la página existe) hace un
// refresco ligero: re-consulta y repinta puntos, marcas, barra y cola sin
// destruir el visor, el mapa, el PDF, la selección armada ni un arrastre en
// curso. El render completo queda para la primera apertura, cuando cambia el
// estado del recorrido o cuando se pide con { completo: true } (Publicar).
async function abrirRecorrido360(id, opts = {}){
  const cont = document.getElementById('recorridos360Content'); if(!cont) return;
  const yaPintado = R360.recorridoActivo?.id === id && !!document.getElementById('r360PuntosWrap');
  if(yaPintado && !opts.completo){
    const [{ data: rec, error: eRec }, { data: puntos, error: ePts }, { data: planos, error: ePl }] = await Promise.all([
      sb.from('recorridos_360').select('*').eq('id', id).single(),
      sb.from('puntos_360').select('*').eq('recorrido_id', id).order('orden'),
      sb.from('planos').select('id,nombre,url,tipo').eq('proyecto_id', currentProyecto).order('created_at')
    ]);
    // Mientras se consultaba, el usuario pudo volver a la lista, abrir otro recorrido o cambiar de proyecto: se descarta
    if(R360.recorridoActivo?.id !== id || !document.getElementById('r360PuntosWrap')) return;
    // Error de consulta (sin señal, RLS, timeout): se conserva la vista actual. Solo PGRST116 (0 filas) = recorrido borrado.
    if((eRec && eRec.code !== 'PGRST116') || ePts){ console.warn('[360] refresco:', (eRec || ePts)?.message); return; }
    if(!rec){ R360.recorridoActivo = null; R360.visorPuntoId = null; r360AbortarDescarga(); r360DestruirVisor(); return cargarRecorridos360(); }
    if(rec.estado === R360.recorridoActivo.estado){
      R360.recorridoActivo = rec; if(puntos) R360.puntos = puntos;
      if(R360.visorPuntoId && !r360Punto(R360.visorPuntoId)){
        r360CerrarComparacion();
        R360.visorPuntoId = null; r360AbortarDescarga(); r360DestruirVisor();
        const v = document.getElementById('r360Visor'); if(v) v.innerHTML = '<div class="r360-visor-msg">El punto que veías ya no existe</div>';
      }
      if(R360.seleccionado && !r360Punto(R360.seleccionado)) R360.seleccionado = null;
      // Planos subidos o borrados en Observaciones › Planos desde la última vez
      const firma = ps => (ps || []).map(p => p.id + '|' + p.url + '|' + p.nombre + '|' + (p.tipo || '')).join(';');
      if(!ePl && planos && firma(planos) !== firma(R360.planos)){
        R360.planos = planos; r360RepintarSelectPlanos();
        if(!R360.planos.some(p => p.id === R360.planoId)){ R360.planoId = R360.planos[0]?.id || null; r360PdfReset(); }
        r360PintarMapa().catch(e => console.warn('[360] mapa:', e?.message || e));
      }
      await r360PintarPuntos(); r360PintarMarcas(); r360PintarVisorBarra(); r360PintarCola();
      r360PintarFechas();
      return;
    }
    // el estado cambió (otro dispositivo publicó / despublicó): render completo
  }
  // Vista actual del visor, para restaurarla si se reabre el mismo punto
  let vista = null; const idPrevio = R360.visorPuntoId;
  if(R360.visor && idPrevio){ try{ if(R360.visor.isLoaded()) vista = { yaw: R360.visor.getYaw(), pitch: R360.visor.getPitch(), hfov: R360.visor.getHfov() }; }catch(e){} }
  r360CerrarComparacion();                                      // el render completo reemplaza los dos visores
  if(R360.recorridoActivo?.id !== id) r360VaciarCacheBlobs();   // las panorámicas en memoria son de otro recorrido
  r360AbortarDescarga(); r360DestruirVisor(); R360.seleccionado = null; r360CancelarArrastre(); R360._mapaToken++;
  R360._parejas.clear(); R360.lt.puntoId = null; R360.lt.parejas = null; R360.lt.mostrado = null;   // otros recorridos pudieron publicarse o cambiar
  cont.innerHTML = '<div class="page-loader"><div class="spinner"></div>Cargando recorrido...</div>';
  const [{ data: rec, error: e1 }, { data: puntos, error: e2 }, { data: planos }] = await Promise.all([
    sb.from('recorridos_360').select('*').eq('id', id).single(),
    sb.from('puntos_360').select('*').eq('recorrido_id', id).order('orden'),
    sb.from('planos').select('id,nombre,url,tipo').eq('proyecto_id', currentProyecto).order('created_at')
  ]);
  if(R360._aperturaPendiente === id) R360._aperturaPendiente = null;
  if(e1 || !rec){ toast('No se pudo abrir el recorrido', 'error'); R360.recorridoActivo = null; return cargarRecorridos360(); }
  if(e2) toast('Puntos: ' + e2.message, 'error');
  if(rec.proyecto_id !== currentProyecto){ R360.recorridoActivo = null; return cargarRecorridos360(); }
  R360.recorridoActivo = rec; R360.puntos = puntos || []; R360.planos = planos || [];
  // Entrada en el historial del navegador: «atrás» vuelve a la lista (o a la sección
  // anterior) y «adelante» reabre este recorrido. No se registra al restaurar desde
  // popstate ni al re-render completo del mismo recorrido (Publicar).
  if(!opts.sinHistorial && typeof registrarNavegacion === 'function' && !r360Restaurando() && history.state?.r360 !== id) registrarNavegacion('recorridos360', { r360: id });
  if(R360.visorPuntoId && !r360Punto(R360.visorPuntoId)) R360.visorPuntoId = null;
  const puede = PUEDE_EDITAR_R360(), esAdmin = ES_ADMIN_R360();
  const bloqueado = rec.estado === 'publicado' && !esAdmin;
  // Publicar: admin/fiscalizador. Volver a borrador: solo admin (el servidor lo
  // exige; así el congelado de puntos no se evade despublicando).
  const puedeTogglar = rec.estado === 'publicado' ? esAdmin : PUEDE_PUBLICAR_R360();
  const ubica = r360PuedeUbicar();
  cont.innerHTML = `
  <div class="card">
    <div class="card-header">
      <div>
        <div class="card-title"><a href="#" onclick="event.preventDefault();r360VolverALista()" style="color:#676879;text-decoration:none">🌐 Recorridos</a> › ${escAttr(rec.titulo)}
          <span class="r360-estado ${rec.estado}" style="margin-left:6px">${rec.estado === 'publicado' ? 'PUBLICADO' : 'BORRADOR'}</span></div>
        <div class="card-subtitle">${escAttr(rec.fecha || '')} · <span id="r360NumPuntos">${R360.puntos.length}</span> punto(s)${rec.descripcion ? ' · ' + escAttr(rec.descripcion) : ''}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn" onclick="r360VolverALista()" title="Volver a la lista de recorridos">← Volver a recorridos</button>
        ${r360DbgBotonHtml()}
        ${puedeTogglar ? `<button class="btn" onclick="r360TogglePublicado()">${rec.estado === 'publicado' ? 'Volver a borrador' : '✅ Publicar'}</button>` : ''}
        ${esAdmin ? '<button class="btn" style="color:#e2445c" onclick="r360EliminarRecorrido()" title="Borra el recorrido, sus puntos y sus archivos">🗑 Eliminar recorrido</button>' : ''}
      </div>
    </div>
    ${puede && !bloqueado ? `
    <div style="padding:16px 16px 8px">
      <label class="r360-drop" style="display:block;cursor:pointer">
        <input type="file" accept="image/jpeg,.jpg,.jpeg" multiple style="display:none" onchange="subirFotos360(this)"/>
        <div style="font-size:26px;margin-bottom:6px">📷</div>
        <div><b>Subir fotos 360</b> — JPEG equirectangular 2:1 exportado desde la app Insta360 (una o varias)</div>
        <div style="font-size:11px;margin-top:4px">Se procesan de a una en este dispositivo (≈3 MB por foto) y se suben en segundo plano. Los .insp/.insv y los videos no se aceptan.</div>
      </label>
      <div id="r360Progreso" class="r360-progreso" style="display:none">
        <div id="r360ProgresoTexto"></div>
        <div class="r360-barra"><div id="r360ProgresoBarra"></div></div>
        <div id="r360ProgresoErrores" class="r360-error" style="display:none"></div>
      </div>
      <div id="r360Cola"></div>
    </div>` : (bloqueado ? '<div class="r360-aviso" style="margin:12px 16px">Recorrido publicado: fotos, posiciones y fechas quedan congeladas y no se añaden puntos (solo un administrador). Etiquetas, notas y norte siguen editables.</div>' : '')}
    <div class="r360-layout">
      <div class="r360-col-visor">
        <div class="r360-duo">
          <div class="r360-visor-marco" id="r360MarcoA" data-slot="a">
            <div id="r360Visor" class="r360-visor"><div class="r360-visor-msg">${R360.puntos.length ? 'Toca una foto de la lista o una marca del plano para verla en 360' : 'Sube fotos para empezar'}</div></div>
            <div id="r360Fechas" class="r360-fechas"></div>
          </div>
          <div class="r360-visor-marco" id="r360MarcoB" data-slot="b" style="display:none">
            <div id="r360VisorB" class="r360-visor"></div>
            <div id="r360FechasB" class="r360-fechas"></div>
            <div id="r360CmpAjuste" class="r360-ajuste" style="display:none"></div>
          </div>
        </div>
        <div id="r360CmpBarra" class="r360-visor-barra"></div>
        <div id="r360VisorBarra" class="r360-visor-barra"></div>
      </div>
      <div class="r360-col-mapa">
        <div class="r360-mapa-head">
          <select id="r360PlanoSel" class="form-control" onchange="r360SetPlano(this.value)" ${R360.planos.length ? '' : 'disabled'}>
            ${R360.planos.length ? R360.planos.map(p => `<option value="${p.id}">${escAttr(p.nombre)}</option>`).join('') : '<option value="">Sin planos en el proyecto</option>'}
          </select>
          ${ubica ? `<div class="r360-modo"><button data-modo="punto" onclick="r360SetModo('punto')">Por punto</button><button data-modo="secuencia" onclick="r360SetModo('secuencia')">Secuencia</button></div>
          <button id="r360BtnInterpolar" class="btn" onclick="r360Interpolar()" style="display:none;font-size:12px;padding:5px 10px">↔ Interpolar</button>` : ''}
        </div>
        <div id="r360Armado"></div>
        <div id="r360Mapa" class="r360-mapa"></div>
        <div id="r360PdfNav"></div>
        <div class="r360-leyenda"><span><i style="background:#00854d"></i>ubicado a mano</span><span><i style="background:#5b8def"></i>interpolado</span><span><i style="background:#ffcb00"></i>en el visor</span></div>
        <div id="r360Ayuda" class="r360-ayuda"></div>
      </div>
    </div>
    <div style="padding:0 16px 16px" id="r360PuntosWrap"></div>
  </div>`;
  // Plano por defecto: el más usado por los puntos ya ubicados; si no, el primero
  const usados = {}; R360.puntos.forEach(p => { if(p.plano_id) usados[p.plano_id] = (usados[p.plano_id] || 0) + 1; });
  const masUsado = Object.entries(usados).sort((a, b) => b[1] - a[1])[0]?.[0];
  if(!R360.planos.some(p => p.id === R360.planoId)) R360.planoId = (masUsado && R360.planos.some(p => p.id === masUsado)) ? masUsado : (R360.planos[0]?.id || null);
  r360SetModo(R360.modo);
  r360CmpEnlazar();
  await r360PintarPuntos();
  r360PintarCola();
  r360PintarVisorBarra();
  // El mapa no bloquea al visor (pdf.js puede tardar o no estar disponible)
  r360PintarMapa().catch(e => console.warn('[360] mapa:', e?.message || e));
  // En escritorio se abre de entrada el punto visto o el primero; en móvil se
  // espera al toque del usuario (cada panorámica pesa 3-5 MB).
  const inicial = R360.visorPuntoId || (window.innerWidth >= 900 ? r360PuntosOrdenados()[0]?.id : null);
  if(inicial) r360AbrirVisor(inicial, { scroll: false, ...(inicial === idPrevio && vista ? vista : {}) });
}
// Cierra el recorrido abierto (visor, descargas, caché, selección, arrastre) sin pintar nada.
function r360DescartarRecorridoAbierto(){
  r360CerrarComparacion();
  if(!R360.recorridoActivo && !R360.visor && !R360.visorPuntoId && !R360._visorAbort) return;
  R360.recorridoActivo = null; R360.visorPuntoId = null; R360.seleccionado = null; r360CancelarArrastre();
  r360AbortarDescarga(); r360DestruirVisor(); r360VaciarCacheBlobs(); R360._mapaToken++;
  R360._parejas.clear(); R360.lt.puntoId = null; R360.lt.parejas = null; R360.lt.mostrado = null;
}
function r360Restaurando(){ return typeof _restaurandoHistorial !== 'undefined' && !!_restaurandoHistorial; }
// «Volver a recorridos» (botón de la cabecera y miga de pan): lista + entrada
// propia en el historial, así «atrás» desde la lista reabre el recorrido.
function r360VolverALista(){
  r360DescartarRecorridoAbierto();
  cargarRecorridos360();
  if(typeof registrarNavegacion === 'function' && !r360Restaurando()) registrarNavegacion('recorridos360');
}
// popstate (index.html): la entrada restaurada es la lista (id null; navTo ya
// la mostró) o un recorrido abierto, que se reabre sin volver a hacer push.
function r360RestaurarHistorial(id){
  R360._aperturaPendiente = id || null;
  if(id) abrirRecorrido360(id, { sinHistorial: true });
}

// Rejilla de puntos (se puede repintar sin tocar el resto de la página).
async function r360PintarPuntos(){
  const wrap = document.getElementById('r360PuntosWrap'); if(!wrap) return;
  const esAdmin = ES_ADMIN_R360();
  const num = document.getElementById('r360NumPuntos'); if(num) num.textContent = R360.puntos.length;
  const lista = r360PuntosOrdenados();
  wrap.innerHTML = lista.length ? `<div class="r360-puntos">${lista.map(p => `
    <div class="r360-punto ${p.x == null ? 'sin-ubicar' : ''} ${p.id === R360.visorPuntoId ? 'actual' : ''}" id="r360p_${p.id}" onclick="r360AbrirVisor('${p.id}')">
      <img alt="" data-path="${escAttr(p.archivo_thumb || '')}" loading="lazy"/>
      <div class="r360-punto-info"><b>#${p.orden}</b>${p.etiqueta ? ' · ' + escAttr(p.etiqueta) : ''}<br>
        ${r360Fecha(p.fecha_captura, true)}
        ${p.x == null ? ' · <span style="color:#b8860b">sin ubicar</span>' : (p.waypoint ? ' · 📍' : ' · ≈')}${p.notas ? ' · ⚠' : ''}
        ${esAdmin ? `<div style="text-align:right;margin-top:2px"><a href="#" onclick="event.preventDefault();event.stopPropagation();r360EliminarPunto('${p.id}')" style="color:#e2445c;font-size:11px">Eliminar</a></div>` : ''}
      </div>
    </div>`).join('')}</div>`
  : '<div style="padding:18px;text-align:center;color:#676879;font-size:13px">Sin puntos todavía</div>';
  // Miniaturas: UNA firma por recorrido para todas las variantes de todos los puntos
  const rutas = R360.puntos.flatMap(p => [p.archivo_thumb, p.archivo_web, p.archivo_full]).filter(Boolean);
  if(rutas.length){ try{ await storage360.getUrls(rutas); }catch(e){ console.warn('[360] firmas:', e?.message || e); } }
  wrap.querySelectorAll('img[data-path]').forEach(img => r360SetImg(img, img.dataset.path));
}
function r360MarcarThumbActual(){
  document.querySelectorAll('.r360-punto.actual').forEach(el => el.classList.remove('actual'));
  const el = document.getElementById('r360p_' + R360.visorPuntoId); if(el) el.classList.add('actual');
}

async function r360PintarCola(){
  const cont = document.getElementById('r360Cola'); if(!cont) return;
  const rec = R360.recorridoActivo; if(!rec) return;
  const items = await r360ItemsCola(rec.id);
  if(!items.length){ cont.innerHTML = ''; return; }
  const pausada = r360Pausada();
  cont.innerHTML = `<div class="r360-cola">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <b style="font-size:13px">Cola de subida · ${items.length} foto(s)</b>
      <button class="btn" style="font-size:12px;padding:4px 10px" onclick="r360TogglePausa()">${pausada ? '▶ Reanudar subida' : '⏸ Pausar subida'}</button>
    </div>
    ${items.map(i => {
      const enCurso = R360.subiendoIdLocal === i.idLocal;
      const est = enCurso ? ['subiendo', 'Subiendo…'] : i.errorDefinitivo ? ['error', 'Error (' + (i.intentos || 0) + ' intentos)'] : pausada ? ['pausado', 'Pausada'] : ['pendiente', (i.intentos ? `Reintento ${i.intentos}` : 'Pendiente')];
      const prog = R360._progreso[i.idLocal] || {};
      const sub = ['thumb', 'web', 'full'].filter(v => prog[v]).length;
      return `<div class="r360-cola-item">
        <span class="estado ${est[0]}">${est[1]}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">#${i.punto?.orden} ${escAttr(i.punto?.nombre_original || '')}${sub ? ` · ${sub}/3 variantes` : ''}${i.ultimoError ? ` · <span style="color:#e2445c">${escAttr(String(i.ultimoError).slice(0, 80))}</span>` : ''}</span>
        ${i.errorDefinitivo ? `<button class="btn" style="font-size:11px;padding:3px 8px" onclick="r360ReintentarItem('${i.idLocal}')">Reintentar</button>` : ''}
        ${enCurso ? '' : `<button class="btn" style="font-size:11px;padding:3px 8px" onclick="r360DescartarItem('${i.idLocal}')" title="Quitar de la cola">✕</button>`}
      </div>`;
    }).join('')}
    ${pausada ? '<div class="r360-aviso">Subida pausada: las fotos siguen guardadas en este dispositivo.</div>' : ''}
  </div>`;
}

async function r360TogglePublicado(){
  const rec = R360.recorridoActivo; if(!rec) return;
  const publicar = rec.estado !== 'publicado';
  if(publicar && !PUEDE_PUBLICAR_R360()) return;
  if(!publicar && !ES_ADMIN_R360()){ toast('Solo un administrador puede devolver a borrador un recorrido publicado', 'error'); return; }
  if(publicar && !confirm('Publicar congela posiciones, archivos y fechas de los puntos y bloquea nuevas fotos (solo un administrador podrá cambiarlos o devolverlo a borrador). ¿Publicar?')) return;
  // publicado_en / publicado_por los fija el servidor (trigger); el cliente solo manda el estado
  const { error } = await sb.from('recorridos_360').update({ estado: publicar ? 'publicado' : 'borrador' }).eq('id', rec.id);
  if(error){ toast('Error: ' + error.message, 'error'); return; }
  toast(publicar ? 'Recorrido publicado ✓' : 'Recorrido devuelto a borrador', 'success');
  if(R360.recorridoActivo?.id === rec.id) abrirRecorrido360(rec.id, { completo: true });
  else r360RefrescarTrasSync(true);   // el usuario ya volvió a la lista (no pisa un formulario ni otro recorrido)
}

// ── Eliminación (solo admin): PRIMERO los objetos del bucket, DESPUÉS las filas ──
// Si fallan los objetos no se toca ninguna fila (no quedan archivos huérfanos);
// si fallan las filas se avisa y basta reintentar (remove() de objetos ya
// inexistentes no da error). En un recorrido publicado se pide una segunda
// confirmación.
async function r360BorrarObjetos(rutas){
  let borrados = 0;
  for(let i = 0; i < rutas.length; i += 100) borrados += await storage360.borrar(rutas.slice(i, i + 100), true);
  return borrados;
}
async function r360EliminarPunto(id){
  if(!ES_ADMIN_R360()) return;
  const p = r360Punto(id); if(!p) return;
  const rec = R360.recorridoActivo, recId = p.recorrido_id;
  if(!confirm(`¿Eliminar el punto #${p.orden}${p.etiqueta ? ' («' + p.etiqueta + '»)' : ''} del ${r360Fecha(p.fecha_captura)} y sus 3 archivos? No se puede deshacer.`)) return;
  if(rec?.estado === 'publicado' && !confirm('El recorrido está PUBLICADO. ¿Eliminar el punto de todos modos?')) return;
  // Rutas reconstruidas desde los ids (no desde la fila): solo se borran los objetos de ESTE punto
  const rutas = ['full', 'web', 'thumb'].map(v => storage360.ruta(p.proyecto_id, p.recorrido_id, p.id, v));
  try{ const n = await r360BorrarObjetos(rutas); r360Dbg(`eliminar punto #${p.orden}: ${n}/3 objetos borrados`); }
  catch(e){ toast('No se pudieron borrar los archivos del punto; no se eliminó: ' + (e?.message || e), 'error'); return; }
  const { data, error } = await sb.from('puntos_360').delete().eq('id', id).select('id');
  if(error){ toast('Archivos borrados, pero la fila del punto no: ' + error.message + '. Vuelve a intentar.', 'error'); return; }
  rutas.forEach(r360OlvidarBlob);
  toast(data?.length ? `Punto #${p.orden} eliminado` : 'El punto ya no existía; se actualiza la lista', data?.length ? 'success' : 'info');
  // Refresco ligero: quita el punto de la lista y cierra su visor si era el visible
  if(R360.recorridoActivo?.id === recId) abrirRecorrido360(recId);
  else r360RefrescarTrasSync(true);
}
async function r360EliminarRecorrido(){
  if(!ES_ADMIN_R360()) return;
  const rec = R360.recorridoActivo; if(!rec) return;
  if(bloquearSiCerrado()) return;
  // Inventario completo desde el servidor (no solo lo pintado) y fotos aún en cola local
  const { data: puntos, error: ePts } = await sb.from('puntos_360').select('id, orden').eq('recorrido_id', rec.id);
  if(ePts){ toast('No se pudo leer el recorrido: ' + ePts.message, 'error'); return; }
  const enCola = await r360ItemsCola(rec.id);
  const n = (puntos || []).length;
  if(!confirm(`¿Eliminar el recorrido «${rec.titulo}» del ${rec.fecha} con ${n} punto(s) y sus ${n * 3} archivos${enCola.length ? ` (y ${enCola.length} foto(s) aún en cola en este dispositivo)` : ''}? No se puede deshacer.`)) return;
  if(rec.estado === 'publicado' && !confirm('El recorrido está PUBLICADO. ¿Eliminarlo de todos modos? Se perderán sus fotos y posiciones.')) return;
  // 1) objetos del bucket: 3 variantes por punto + lo que hubieran subido las fotos en cola
  const rutas = [];
  (puntos || []).forEach(p => ['full', 'web', 'thumb'].forEach(v => rutas.push(storage360.ruta(rec.proyecto_id, rec.id, p.id, v))));
  enCola.forEach(it => rutas.push(...Object.values(r360RutasItem(it))));
  if(n) toast(`Eliminando ${n} punto(s)…`, 'info');
  try{ const b = await r360BorrarObjetos(rutas); r360Dbg(`eliminar recorrido «${rec.titulo}»: ${b}/${rutas.length} objetos borrados`); }
  catch(e){ toast('No se pudieron borrar los archivos; el recorrido se conserva: ' + (e?.message || e), 'error'); return; }
  // 2) cola local de este recorrido (ya sin recorrido al que subir)
  for(const it of enCola){ try{ await idbBorrar(it.idLocal); }catch(e){} delete R360._progreso[it.idLocal]; }
  // 3) filas: puntos y luego el recorrido
  const { error: e1 } = await sb.from('puntos_360').delete().eq('recorrido_id', rec.id);
  if(e1){ toast('Archivos borrados, pero los puntos no: ' + e1.message + '. Vuelve a intentar.', 'error'); return; }
  const { data: d2, error: e2 } = await sb.from('recorridos_360').delete().eq('id', rec.id).select('id');
  if(e2){ toast('Puntos borrados, pero el recorrido no: ' + e2.message + '. Vuelve a intentar.', 'error'); return; }
  actualizarIndicadorOffline();
  toast(d2?.length ? `Recorrido «${rec.titulo}» eliminado` : 'El recorrido ya no existía', d2?.length ? 'success' : 'info');
  r360VolverALista();
}

// ── Guardar cambios de un punto (ubicación, etiqueta) ───────────────────────
// .select('id'): un UPDATE que no alcanza filas (punto borrado en otro
// dispositivo, o filtrado por RLS) no es un error para PostgREST; se detecta
// por la respuesta vacía y NO se toca el estado local.
// Página del plano (PDF) sobre la que están x/y: columna puntos_360.pagina (migración
// 20260929_pagina_en_puntos_y_pines.sql). Una marca se guarda con la página visible, se dibuja
// solo en ella y solo se empareja con marcas de la misma página. Mientras la migración no esté
// aplicada el módulo sigue como antes (todo en página 1) y solo rechaza ubicar en otra página.
function r360PaginaDe(p){ return Math.max(1, Math.round(Number(p && p.pagina)) || 1); }
function r360PaginaVisible(){
  const pl = R360.planos.find(x => x.id === R360.planoId);
  return (pl && r360EsPdf(pl)) ? Math.max(1, R360._pdf.pagina || 1) : 1;
}
function r360FaltaColumnaPagina(error){
  return !!error && ['PGRST204', '42703'].includes(String(error.code)) && /pagina/i.test(error.message || '');
}
// UPDATE de un punto. Devuelve { data, error } como PostgREST.
async function r360ActualizarPunto(id, cambios){
  let envio = cambios;
  if(R360._sinPagina && 'pagina' in envio){
    if(r360PaginaDe(envio) > 1) return { data: null, error: { code: 'R360_SIN_PAGINA', message: 'para ubicar puntos en otra página del PDF falta aplicar la migración 20260929_pagina_en_puntos_y_pines.sql' } };
    envio = { ...envio }; delete envio.pagina;
  }
  let r = await sb.from('puntos_360').update(envio).eq('id', id).select('id');
  if(r360FaltaColumnaPagina(r.error) && 'pagina' in envio){
    R360._sinPagina = true; R360._parejas.clear();
    console.warn('[360] la base no tiene puntos_360.pagina (migración 20260929 sin aplicar): se trabaja con una sola página');
    return r360ActualizarPunto(id, cambios);
  }
  return r;
}
async function r360GuardarPunto(id, cambios){
  const { data, error } = await r360ActualizarPunto(id, cambios);
  if(error){
    toast(esErrorDeRed(error) ? 'Sin señal: la ubicación en el plano se guarda con conexión' : 'No se pudo guardar: ' + error.message, 'error');
    return false;
  }
  if(!data || !data.length){ toast('El punto ya no existe o no tienes permiso para cambiarlo; se recarga el recorrido', 'error'); if(R360.recorridoActivo) abrirRecorrido360(R360.recorridoActivo.id); return false; }
  const p = r360Punto(id); if(p) Object.assign(p, cambios);
  return true;
}
function r360Posicion(x, y){ return { plano_id: R360.planoId, pagina: r360PaginaVisible(), x, y, waypoint: true }; }
function r360RepintarTrasCambio(){ r360PintarMarcas(); r360PintarVisorBarra(); r360PintarPuntos(); r360PintarFechas(); }

// ── Mini-mapa: plano (imagen o PDF vía pdf.js) + overlay con marcas ─────────
function r360PdfReset(){
  const st = R360._pdf, d = st.doc;
  if(st.tarea){ try{ st.tarea.cancel(); }catch(e){} }
  R360._pdf = { doc: null, url: null, pagina: 1, paginaPedida: 1, tarea: null };
  if(d){ try{ const r = d.destroy(); r?.catch?.(() => {}); }catch(e){} }   // libera el worker de pdf.js y el documento parseado
}
function r360SetPlano(id){
  R360.planoId = id || null;
  r360PdfReset();
  r360PintarMapa();
}
function r360RepintarSelectPlanos(){
  const sel = document.getElementById('r360PlanoSel'); if(!sel) return;
  sel.disabled = !R360.planos.length;
  sel.innerHTML = R360.planos.length ? R360.planos.map(p => `<option value="${p.id}">${escAttr(p.nombre)}</option>`).join('') : '<option value="">Sin planos en el proyecto</option>';
  if(R360.planoId && R360.planos.some(p => p.id === R360.planoId)) sel.value = R360.planoId;
}
function r360SetModo(m){
  R360.modo = m === 'secuencia' ? 'secuencia' : 'punto';
  document.querySelectorAll('.r360-modo button').forEach(b => b.classList.toggle('activo', b.dataset.modo === R360.modo));
  const bi = document.getElementById('r360BtnInterpolar'); if(bi) bi.style.display = (R360.modo === 'secuencia' && r360PuedeUbicar()) ? '' : 'none';
  const ay = document.getElementById('r360Ayuda');
  if(ay){
    if(!r360PuedeUbicar()) ay.textContent = r360Congelado() ? 'Recorrido publicado: las posiciones están congeladas. Toca una marca para ver la foto.' : 'Toca una marca del plano para ver la foto en 360.';
    else if(R360.modo === 'secuencia') ay.innerHTML = '<b>Secuencia:</b> ubica a mano al menos 2 puntos (inicio, esquinas, fin); tras cada toque queda seleccionado el siguiente por orden. Luego <b>Interpolar</b> reparte los intermedios en línea recta entre esos waypoints, sin tocar los ubicados a mano.';
    else ay.innerHTML = '<b>Por punto:</b> abre una foto y pulsa «Ubicar en plano»; después toca el plano donde se tomó. Arrastra una marca para moverla.';
  }
  r360PintarArmado();
}

async function r360PintarMapa(){
  const cont = document.getElementById('r360Mapa'), nav = document.getElementById('r360PdfNav'); if(!cont) return;
  r360CancelarArrastre();                       // el overlay se reemplaza: un arrastre en curso no puede seguir
  const token = ++R360._mapaToken;
  if(nav) nav.innerHTML = '';
  if(!R360.planos.length){ r360PdfReset(); cont.innerHTML = '<div class="r360-mapa-vacio">Este proyecto no tiene planos. Súbelos en Observaciones › Planos para ubicar los puntos.</div>'; return; }
  const p = R360.planos.find(x => x.id === R360.planoId) || R360.planos[0]; R360.planoId = p.id;
  const sel = document.getElementById('r360PlanoSel'); if(sel && sel.value !== p.id) sel.value = p.id;
  const esPDF = r360EsPdf(p);
  if(!esPDF || (R360._pdf.doc && R360._pdf.url !== p.url)) r360PdfReset();   // nunca se pisa un documento vivo sin destruirlo
  cont.innerHTML = `<div class="r360-mapa-inner">${esPDF ? '<canvas id="r360MapaCanvas"></canvas>' : `<img id="r360MapaImg" src="${escAttr(p.url)}" alt=""/>`}<div id="r360Overlay" class="r360-overlay"></div></div>`;
  r360EnlazarOverlay(document.getElementById('r360Overlay'));
  if(esPDF){
    // La barra de páginas va FUERA del contenedor con scroll: nunca queda bajo el overlay de marcas
    if(nav) nav.innerHTML = '<div class="r360-pdfnav"><button onclick="r360PdfPagina(-1)">◀</button><span id="r360PdfInfo">Cargando…</span><button onclick="r360PdfPagina(1)">▶</button></div>';
    // Documento ya cargado (mismo plano tras un render completo): se vuelve a la página que se estaba viendo
    const pag = (R360._pdf.doc && R360._pdf.url === p.url) ? R360._pdf.paginaPedida : 1;
    await r360RenderPdfMapa(p.url, pag, token);
  } else {
    const img = document.getElementById('r360MapaImg');
    if(img) img.onerror = () => { if(token === R360._mapaToken) cont.innerHTML = '<div class="r360-mapa-vacio">No se pudo cargar la imagen del plano</div>'; };
  }
  if(token !== R360._mapaToken) return;
  r360PintarMarcas();
}

// Render de una página del PDF, serializado: cancela el render anterior y
// respeta la última página pedida. Un fallo de página conserva canvas,
// overlay y marcas (solo avisa en la barra); un fallo de documento sí
// reemplaza el mapa por el aviso.
async function r360RenderPdfMapa(url, pagina, token){
  const st = R360._pdf;
  try{
    await asegurarPdfJs();
    if(typeof pdfjsLib === 'undefined') throw new Error('pdf.js no disponible');
    if(token !== R360._mapaToken) return;
    if(!st.doc || st.url !== url){
      if(st.doc){ const viejo = st.doc; st.doc = null; st.url = null; try{ viejo.destroy()?.catch?.(() => {}); }catch(e){} }   // sin fuga de worker
      const doc = await pdfjsLib.getDocument(url).promise;
      if(token !== R360._mapaToken || R360._pdf !== st){ try{ doc.destroy(); }catch(e){} return; }
      st.doc = doc; st.url = url; st.pagina = 1; st.paginaPedida = 1; pagina = 1;
    }
  }catch(e){
    console.warn('[360] pdf plano:', e?.message || e);
    if(token !== R360._mapaToken || R360._pdf !== st) return;   // fallo de un render ya obsoleto: no se toca el mapa vigente
    const c = document.getElementById('r360Mapa');
    if(c) c.innerHTML = `<div class="r360-mapa-vacio">No se pudo cargar el PDF del plano${navigator.onLine ? '' : ' (sin señal)'}</div>`;
    const info = document.getElementById('r360PdfInfo'); if(info) info.textContent = 'PDF no disponible';
    return;
  }
  if(st.tarea){ try{ st.tarea.cancel(); }catch(e){} try{ await st.tarea.promise; }catch(e){} if(st.tarea) st.tarea = null; }
  if(token !== R360._mapaToken || R360._pdf !== st || st.paginaPedida !== pagina) return;   // llegó otra petición
  try{
    const page = await st.doc.getPage(pagina);
    const canvas = document.getElementById('r360MapaCanvas');
    if(!canvas || token !== R360._mapaToken || R360._pdf !== st || st.paginaPedida !== pagina) return;
    const ancho = canvas.parentElement.clientWidth || 600;
    const vp1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: ancho / vp1.width });
    canvas.width = vp.width; canvas.height = vp.height;
    const tarea = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
    st.tarea = tarea;
    await tarea.promise;
    if(st.tarea === tarea) st.tarea = null;
    st.pagina = pagina;
    const info = document.getElementById('r360PdfInfo'); if(info) info.textContent = `Página ${pagina} de ${st.doc.numPages}` + (st.doc.numPages > 1 ? ' · las marcas son de cada página' : '');
  }catch(e){
    if(e?.name === 'RenderingCancelledException') return;
    console.warn('[360] pdf página:', e?.message || e);
    if(token !== R360._mapaToken || R360._pdf !== st) return;   // render obsoleto: no escribe en la barra del plano vigente
    const info = document.getElementById('r360PdfInfo'); if(info) info.textContent = `No se pudo mostrar la página ${pagina}`;
  }
}
function r360PdfPagina(delta){
  const st = R360._pdf, d = st.doc; if(!d) return;
  const n = st.paginaPedida + delta; if(n < 1 || n > d.numPages) return;
  st.paginaPedida = n;
  r360RenderPdfMapa(st.url, n, R360._mapaToken).then(() => r360PintarMarcas());
}

// Marcas: una por punto ubicado en el plano visible. Se repintan sin tocar la
// imagen de fondo. Posición en % (misma convención que los pines de observaciones).
function r360PintarMarcas(){
  const ov = document.getElementById('r360Overlay');
  // Durante un arrastre no se reemplaza el overlay (soltaría la captura del puntero): se repinta al terminar
  if(R360._drag){ R360._drag.repintar = true; return; }
  if(ov){
    const pag = r360PaginaVisible();
    const enPlano = R360.puntos.filter(p => p.plano_id === R360.planoId && p.x != null && p.y != null && r360PaginaDe(p) === pag);
    ov.innerHTML = enPlano.map(p => `<div class="r360-marca ${p.waypoint ? 'waypoint' : 'interp'} ${p.id === R360.visorPuntoId ? 'actual' : ''} ${p.id === R360.seleccionado ? 'sel' : ''}" data-id="${p.id}" style="left:${Number(p.x)}%;top:${Number(p.y)}%" title="#${p.orden}${p.etiqueta ? ' · ' + escAttr(p.etiqueta) : ''}">${p.orden}</div>`).join('');
  }
  const mapa = document.getElementById('r360Mapa'); if(mapa) mapa.classList.toggle('armado', !!R360.seleccionado && r360PuedeUbicar());
  r360PintarArmado();
}
function r360PintarArmado(){
  const a = document.getElementById('r360Armado'); if(!a) return;
  const p = R360.seleccionado ? r360Punto(R360.seleccionado) : null;
  if(!p || !r360PuedeUbicar()){ a.innerHTML = ''; R360.seleccionado = null; return; }
  a.innerHTML = `<div class="r360-armado">📍 Toca el plano donde se tomó el punto <b>#${p.orden}</b>${p.etiqueta ? ' (' + escAttr(p.etiqueta) + ')' : ''}<button class="btn" onclick="r360CancelarUbicacion()">Cancelar</button></div>`;
}
function r360Coords(e, ov){
  const c = coordsPinDesdeEvento(e, ov);
  return { x: Math.min(100, Math.max(0, c.x)), y: Math.min(100, Math.max(0, c.y)) };
}
// Cancela un arrastre en curso (cambio de plano, de recorrido o de proyecto) soltando la captura del puntero
function r360CancelarArrastre(){
  const d = R360._drag; if(!d) return;
  R360._drag = null;
  try{ d.el.releasePointerCapture(d.pointerId); }catch(e){}
}
// Interacción del overlay: toque en vacío = ubicar el punto seleccionado;
// toque en una marca = abrir en el visor; arrastre de una marca = moverla.
function r360EnlazarOverlay(ov){
  if(!ov) return;
  ov.addEventListener('pointerdown', e => {
    const m = e.target.closest('.r360-marca'); if(!m) return;
    if(R360._drag) return;                                   // ya hay un puntero arrastrando
    if(e.button !== 0) return;                               // botón secundario (menú contextual): no arma arrastre
    e.preventDefault();
    R360._drag = { id: m.dataset.id, el: m, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, movible: r360PuedeUbicar(), c: null, repintar: false };
    try{ m.setPointerCapture(e.pointerId); }catch(_){}
  });
  ov.addEventListener('pointermove', e => {
    const d = R360._drag; if(!d || !d.movible || e.pointerId !== d.pointerId) return;
    if(!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
    d.moved = true;
    const c = r360Coords(e, ov); d.c = c;
    d.el.style.left = c.x + '%'; d.el.style.top = c.y + '%';
  });
  const fin = async e => {
    const d = R360._drag; if(!d || e.pointerId !== d.pointerId) return; R360._drag = null;
    if(d.moved && d.c){
      const ok = await r360GuardarPunto(d.id, r360Posicion(d.c.x, d.c.y));
      if(ok) r360RepintarTrasCambio(); else r360PintarMarcas();   // si falló, la marca vuelve a su sitio
    } else if(e.type === 'pointerup' && r360Punto(d.id)){
      r360AbrirVisor(d.id);                                  // repinta marcas (incluye lo diferido durante el arrastre)
    } else {
      r360PintarMarcas();                                    // cancelación, o el punto desapareció mientras se tocaba
    }
  };
  ov.addEventListener('pointerup', fin);
  ov.addEventListener('pointercancel', fin);
  // Captura perdida sin pointerup (p. ej. el sistema tomó el gesto): se cancela el arrastre
  ov.addEventListener('lostpointercapture', e => {
    const d = R360._drag; if(!d || e.pointerId !== d.pointerId) return;
    R360._drag = null; r360PintarMarcas();
  });
  ov.addEventListener('click', e => {
    if(e.target.closest('.r360-marca')) return;
    if(!r360PuedeUbicar()) return;
    if(!R360.seleccionado){ toast('Abre una foto y pulsa «Ubicar en plano»; después toca el plano', 'info'); return; }
    r360UbicarSeleccionado(r360Coords(e, ov));
  });
}
// Ubica el punto seleccionado. La selección avanza y la marca se pinta ANTES de
// esperar al servidor: un segundo toque rápido va al siguiente punto, no
// reubica el mismo. Si el guardado falla se restaura todo.
async function r360UbicarSeleccionado(c){
  const id = R360.seleccionado, p = r360Punto(id);
  if(!p){ R360.seleccionado = null; r360PintarMarcas(); return; }
  let sig = null;
  if(R360.modo === 'secuencia'){ const lista = r360PuntosOrdenados(), i = lista.findIndex(x => x.id === id); sig = lista[i + 1] || null; }
  R360.seleccionado = sig ? sig.id : null;
  const previo = { plano_id: p.plano_id, pagina: r360PaginaDe(p), x: p.x, y: p.y, waypoint: p.waypoint };
  const cambios = r360Posicion(c.x, c.y);
  Object.assign(p, cambios); r360PintarMarcas();                       // marca provisional
  const ok = await r360GuardarPunto(id, cambios);
  if(!ok){
    Object.assign(p, previo);
    if(!R360.seleccionado || R360.seleccionado === sig?.id) R360.seleccionado = id;   // vuelve a quedar armado
    r360PintarMarcas(); return;
  }
  if(R360.modo === 'secuencia') toast(sig ? `#${p.orden} ubicado · ahora toca el plano para #${sig.orden} (o Cancelar)` : `#${p.orden} ubicado · era el último`, 'success');
  else toast(`Punto #${p.orden} ubicado ✓`, 'success');
  r360RepintarTrasCambio();
}
function r360ArmarUbicacion(id){
  if(!r360PuedeUbicar() || !r360Punto(id)) return;
  if(!R360.planos.length){ toast('Este proyecto no tiene planos: súbelos en Observaciones › Planos', 'error'); return; }
  R360.seleccionado = id; r360PintarMarcas();
  const m = document.getElementById('r360Mapa'); if(m && window.innerWidth < 900) m.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function r360CancelarUbicacion(){ R360.seleccionado = null; r360PintarMarcas(); }
async function r360QuitarDelPlano(id){
  if(!r360PuedeUbicar()) return;
  const p = r360Punto(id); if(!p) return;
  const eraWaypoint = !!p.waypoint;
  if(await r360GuardarPunto(id, { plano_id: null, pagina: 1, x: null, y: null, waypoint: false })){
    if(eraWaypoint) toast('Quitado del plano. Los puntos interpolados a partir de él conservan su posición; vuelve a Interpolar si hace falta.', 'info');
    r360RepintarTrasCambio();
  }
}
async function r360EditarEtiqueta(id){
  const p = r360Punto(id); if(!p || !PUEDE_PUBLICAR_R360()) return;
  const v = prompt('Etiqueta del punto (eje, ambiente, nivel…):', p.etiqueta || '');
  if(v === null) return;
  if(await r360GuardarPunto(id, { etiqueta: v.trim() || null })) r360RepintarTrasCambio();
}

// ── Secuencia: interpolación por índice entre waypoints del plano visible ───
// Los puntos se ordenan por `orden` (= fecha de captura al subir). Entre dos
// waypoints consecutivos (ubicados a mano en ESTE plano y ESTA página), cada punto intermedio
// que no sea waypoint recibe una posición lineal según su índice. Los puntos
// antes del primer waypoint o después del último no se tocan.
function r360CalcularInterpolacion(){
  const lista = r360PuntosOrdenados(), pag = r360PaginaVisible();
  const aqui = p => p.plano_id === R360.planoId && r360PaginaDe(p) === pag;
  const wps = lista.map((p, i) => ({ p, i })).filter(o => o.p.waypoint && o.p.x != null && aqui(o.p));
  if(wps.length < 2) return { motivo: `Se necesitan al menos 2 puntos ubicados a mano en ${pag > 1 ? 'esta página del plano' : 'este plano'} (hay ${wps.length})` };
  const cambios = [];
  for(let k = 0; k < wps.length - 1; k++){
    const a = wps[k], b = wps[k + 1];
    for(let i = a.i + 1; i < b.i; i++){
      const p = lista[i];
      if(p.waypoint && p.x != null) continue;          // ubicado a mano en otro plano u otra página: no se toca
      const t = (i - a.i) / (b.i - a.i);
      const x = +(Number(a.p.x) + (Number(b.p.x) - Number(a.p.x)) * t).toFixed(1);
      const y = +(Number(a.p.y) + (Number(b.p.y) - Number(a.p.y)) * t).toFixed(1);
      if(!aqui(p) || Number(p.x) !== x || Number(p.y) !== y) cambios.push({ id: p.id, plano_id: R360.planoId, pagina: pag, x, y, waypoint: false });
    }
  }
  // Fuera del tramo [primer waypoint, último]: sin ubicar (quedan así) e
  // interpolados antiguos de este plano (conservan su posición: se avisa).
  const primero = wps[0].i, ultimo = wps[wps.length - 1].i;
  let sinUbicar = 0, antiguos = 0;
  lista.forEach((p, i) => {
    if(i >= primero && i <= ultimo) return;
    if(p.x == null) sinUbicar++;
    else if(!p.waypoint && aqui(p)) antiguos++;
  });
  return { cambios, waypoints: wps.length, sinUbicar, antiguos };
}
async function r360Interpolar(){
  if(!r360PuedeUbicar()) return;
  const r = r360CalcularInterpolacion();
  if(r.motivo){ toast(r.motivo, 'error'); return; }
  if(!r.cambios.length){ toast('No hay puntos por interpolar entre los waypoints (ya están ubicados)', 'info'); return; }
  const avisos = [];
  if(r.sinUbicar) avisos.push(`${r.sinUbicar} punto(s) fuera del tramo (antes del primer waypoint o después del último) siguen sin ubicar.`);
  if(r.antiguos) avisos.push(`${r.antiguos} punto(s) interpolados antes, fuera del tramo actual, conservan su posición.`);
  if(!confirm(`Se ubicarán ${r.cambios.length} punto(s) por interpolación entre ${r.waypoints} waypoints de este plano. ${avisos.join(' ')} Las posiciones colocadas a mano no cambian. ¿Continuar?`)) return;
  let ok = 0, fallos = 0, ultimoError = null;
  for(let i = 0; i < r.cambios.length; i += 6){
    await Promise.all(r.cambios.slice(i, i + 6).map(async c => {
      const cambios = { plano_id: c.plano_id, pagina: c.pagina, x: c.x, y: c.y, waypoint: false };
      const { data, error } = await r360ActualizarPunto(c.id, cambios);
      if(error || !data || !data.length){ fallos++; ultimoError = error || new Error('el punto ya no existe'); return; }
      const p = r360Punto(c.id); if(p) Object.assign(p, cambios);
      ok++;
    }));
    if(ultimoError && esErrorDeRed(ultimoError)) break;
  }
  toast(fallos ? `${ok} ubicado(s), ${fallos} con error${ultimoError ? ': ' + ultimoError.message : ''}` : `${ok} punto(s) ubicados por interpolación ✓`, fallos ? 'error' : 'success');
  // Fallo que no es de red (punto borrado, recorrido publicado, RLS): el estado local ya no es fiable → refresco
  if(fallos && ultimoError && !esErrorDeRed(ultimoError) && R360.recorridoActivo) abrirRecorrido360(R360.recorridoActivo.id);
  else r360RepintarTrasCambio();
}

// ── Comparar entre fechas (fase e): emparejamiento ──────────────────────────
// Las «parejas» de un punto ubicado son los puntos de OTROS recorridos
// PUBLICADOS del mismo plano Y LA MISMA PÁGINA que caen dentro de un radio, a lo sumo uno por
// recorrido (el más cercano). El radio va en % del ANCHO del plano: como x/y
// se guardan en % del ancho y del alto, la diferencia en y se multiplica por
// la proporción alto/ancho para que el radio sea un círculo y no una elipse.
// Sin migración: se pide al servidor una caja alrededor del punto y el filtro
// exacto se hace aquí.
function r360Radio(){
  const v = Number(r360DbgLS('r360_radio'));
  return (v >= 0.5 && v <= 20) ? v : R360.RADIO_DEF;
}
// Desempate dentro de un mismo recorrido: distancia, ubicado a mano, menor orden
function r360MejorPareja(a, b){
  if(Math.abs(a.distancia - b.distancia) > 1e-9) return a.distancia < b.distancia;
  if(!!a.punto.waypoint !== !!b.punto.waypoint) return !!a.punto.waypoint;
  return (a.punto.orden || 0) < (b.punto.orden || 0);
}
// Función pura. `candidatos`: filas de puntos_360 con su recorrido embebido en
// `recorridos_360` ({ id, titulo, fecha, estado }). Devuelve
// [{ punto, recorrido, distancia }] ordenado por fecha del recorrido.
function r360Emparejar(punto, candidatos, opts = {}){
  const radio = opts.radio > 0 ? Number(opts.radio) : R360.RADIO_DEF, aspecto = opts.aspecto > 0 ? Number(opts.aspecto) : 1;
  if(!punto || !punto.plano_id || punto.x == null || punto.y == null) return [];
  const px = Number(punto.x), py = Number(punto.y), porRec = new Map();
  for(const c of candidatos || []){
    const recorrido = c && c.recorridos_360;
    if(!recorrido || recorrido.estado !== 'publicado') continue;
    if(c.id === punto.id || c.recorrido_id === punto.recorrido_id || c.plano_id !== punto.plano_id || c.x == null || c.y == null) continue;
    if(r360PaginaDe(c) !== r360PaginaDe(punto)) continue;
    const distancia = Math.hypot(Number(c.x) - px, (Number(c.y) - py) * aspecto);
    if(!(distancia <= radio + 1e-9)) continue;
    const e = { punto: c, recorrido, distancia }, previo = porRec.get(c.recorrido_id);
    if(!previo || r360MejorPareja(e, previo)) porRec.set(c.recorrido_id, e);
  }
  return [...porRec.values()].sort((a, b) =>
    String(a.recorrido.fecha || '').localeCompare(String(b.recorrido.fecha || ''))
    || String(a.punto.fecha_captura || '').localeCompare(String(b.punto.fecha_captura || ''))
    || String(a.recorrido.id).localeCompare(String(b.recorrido.id)));
}
// Caja que contiene el círculo (x/y tienen un decimal: se deja medio paso de holgura)
function r360CajaEmparejamiento(punto, radio, aspecto){
  const x = Number(punto.x), y = Number(punto.y), ry = radio / (aspecto > 0 ? aspecto : 1);
  const lim = v => Math.min(100, Math.max(0, +v.toFixed(2)));
  return { x0: lim(x - radio - 0.05), x1: lim(x + radio + 0.05), y0: lim(y - ry - 0.05), y1: lim(y + ry + 0.05) };
}
function r360EsPdf(plano){ return (plano.tipo || '').includes('pdf') || String(plano.nombre || '').toLowerCase().endsWith('.pdf'); }
// Proporción alto/ancho del plano (imagen: tamaño natural; PDF: la página del punto). Si no
// se puede leer (sin señal, pdf.js bloqueado) devuelve 1 y NO se guarda, para
// que el siguiente intento vuelva a medir.
async function r360AspectoPlano(planoId, pagina = 1){
  const pl = R360.planos.find(x => x.id === planoId); if(!pl || !pl.url) return 1;
  const clave = planoId + '|' + pl.url + '|' + pagina;
  if(R360._aspectos.has(clave)) return R360._aspectos.get(clave);
  const tarea = (async () => {
    if(r360EsPdf(pl)){
      await asegurarPdfJs();
      if(typeof pdfjsLib === 'undefined') throw new Error('pdf.js no disponible');
      const st = R360._pdf, propio = !(st.doc && st.url === pl.url);
      const doc = propio ? await pdfjsLib.getDocument(pl.url).promise : st.doc;
      try{ const vp = (await doc.getPage(Math.min(Math.max(1, pagina), doc.numPages))).getViewport({ scale: 1 }); return vp.height / vp.width; }
      finally{ if(propio){ try{ doc.destroy()?.catch?.(() => {}); }catch(e){} } }
    }
    return await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => (img.naturalWidth > 0 ? res(img.naturalHeight / img.naturalWidth) : rej(new Error('imagen sin tamaño')));
      img.onerror = () => rej(new Error('no se pudo cargar la imagen del plano'));
      img.src = pl.url;
    });
  })().then(a => (a > 0 && isFinite(a)) ? +a.toFixed(3) : 1);
  R360._aspectos.set(clave, tarea);
  try{ return await tarea; }
  catch(e){
    if(R360._aspectos.get(clave) === tarea) R360._aspectos.delete(clave);
    console.warn('[360] proporción del plano (se usa 1:1):', e?.message || e);
    return 1;
  }
}
const R360_CAMPOS_PAREJA = 'id,proyecto_id,recorrido_id,plano_id,pagina,x,y,waypoint,orden,etiqueta,notas,fecha_captura,heading_norte,camara,archivo_full,archivo_web,archivo_thumb,recorridos_360!inner(id,titulo,fecha,estado)';
// Parejas de un punto del recorrido abierto. [] si no está ubicado o no hay
// ninguna; null si la consulta falló (no se guarda en caché). La clave de caché
// incluye posición, radio y proporción: mover el punto o cambiar el radio
// vuelve a consultar.
async function r360ParejasDe(p){
  if(!p || !p.plano_id || p.x == null || p.y == null) return [];
  const radio = r360Radio(), aspecto = await r360AspectoPlano(p.plano_id, r360PaginaDe(p));
  const clave = [p.id, p.plano_id, r360PaginaDe(p), p.x, p.y, radio, aspecto].join('|');
  if(R360._parejas.has(clave)) return R360._parejas.get(clave);
  const caja = r360CajaEmparejamiento(p, radio, aspecto);
  const tarea = (async () => {
    const consulta = conPagina => {
      let q = sb.from('puntos_360').select(conPagina ? R360_CAMPOS_PAREJA : R360_CAMPOS_PAREJA.replace(',pagina,', ','))
        .eq('proyecto_id', p.proyecto_id).eq('plano_id', p.plano_id);
      if(conPagina) q = q.eq('pagina', r360PaginaDe(p));
      return q.eq('recorridos_360.estado', 'publicado').neq('recorrido_id', p.recorrido_id)
        .gte('x', caja.x0).lte('x', caja.x1).gte('y', caja.y0).lte('y', caja.y1)
        .order('fecha_captura').limit(1000);
    };
    let { data, error } = await consulta(!R360._sinPagina);
    if(r360FaltaColumnaPagina(error) && !R360._sinPagina){
      R360._sinPagina = true;
      console.warn('[360] la base no tiene puntos_360.pagina (migración 20260929 sin aplicar): se empareja sin página');
      ({ data, error } = await consulta(false));
    }
    if(error) throw error;
    const res = r360Emparejar(p, data || [], { radio, aspecto });
    r360Dbg(`parejas punto #${p.orden}: ${res.length} fecha(s) de ${(data || []).length} candidato(s) · radio ${radio} % · proporción ${aspecto}`);
    return res;
  })();
  R360._parejas.set(clave, tarea);
  try{ return await tarea; }
  catch(e){
    if(R360._parejas.get(clave) === tarea) R360._parejas.delete(clave);
    console.warn('[360] parejas:', e?.message || e);
    return null;
  }
}

// ── Visor Pannellum ─────────────────────────────────────────────────────────
// La panorámica la descarga el módulo (fetch abortable, con reintento de
// firma) y se entrega a Pannellum como blob: URL. Así: (1) cambiar de punto
// aborta la descarga en curso en vez de dejar un visor zombi cargando 3-5 MB;
// (2) la carga en Pannellum es local y casi inmediata; (3) las últimas
// panorámicas quedan en memoria (BLOBS_MAX) y volver atrás no descarga nada.
function r360AbortarDescarga(){
  if(R360._visorAbort){ try{ R360._visorAbort.abort(); }catch(e){} R360._visorAbort = null; }
}
// Caché LRU de panorámicas: como máximo BLOBS_MAX entradas { blob, url }. Al
// expulsar una entrada se revoca su blob: URL si seguía viva; se vacía entera
// al salir del recorrido (r360VolverALista), al abrir otro y al cambiar de
// proyecto (limpiarEstadoR360).
function r360RevocarEntrada(e){ if(e && e.url){ try{ URL.revokeObjectURL(e.url); }catch(_){} e.url = null; } }
function r360OlvidarBlob(path){ const e = R360._blobs.get(path); if(e){ r360RevocarEntrada(e); R360._blobs.delete(path); } }
function r360VaciarCacheBlobs(){ if(!R360._blobs.size) return; R360._blobs.forEach(r360RevocarEntrada); R360._blobs.clear(); r360DbgCache(); }
function r360BlobCache(path, blob){
  if(blob){
    r360OlvidarBlob(path);
    R360._blobs.set(path, { blob, url: null });
    while(R360._blobs.size > R360.BLOBS_MAX) r360OlvidarBlob(R360._blobs.keys().next().value);
    r360DbgCache();
    return blob;
  }
  const e = R360._blobs.get(path); if(!e) return null;
  R360._blobs.delete(path); R360._blobs.set(path, e);   // LRU: la más reciente al final
  return e.blob;
}
// blob: URL para el visor, registrada en la entrada de caché (se revoca al
// cargar, al fallar, al destruir el visor o al expulsar la entrada).
function r360UrlDeBlob(path, blob){
  const u = URL.createObjectURL(blob);
  const e = R360._blobs.get(path); if(e){ r360RevocarEntrada(e); e.url = u; }
  return u;
}
function r360RevocarUrl(path, url){
  if(!url) return;
  const e = R360._blobs.get(path); if(e && e.url === url) e.url = null;
  try{ URL.revokeObjectURL(url); }catch(_){}
}
function r360RevocarUrlVisor(v){ if(v && v._r360BlobUrl){ const u = v._r360BlobUrl; v._r360BlobUrl = null; r360RevocarUrl(v._r360Path, u); } }
async function r360DescargarPanoramica(path, signal, onProgreso){
  const cache = r360BlobCache(path); if(cache) return cache;
  // Ya en vuelo (precarga u otro visor): se comparte, salvo que esa descarga
  // esté abortada (su entrada desaparece en el mismo instante del abort).
  const enVuelo = R360._descargas.get(path);
  if(enVuelo && !enVuelo.signal?.aborted) return enVuelo.tarea;
  const tarea = (async () => {
    let url = await storage360.getUrl(path);
    let resp = await fetch(url, { signal });
    if(!resp.ok && (resp.status === 400 || resp.status === 403)){ url = await storage360.refirmar(path, 'HTTP ' + resp.status); resp = await fetch(url, { signal }); }
    if(!resp.ok) throw new Error('HTTP ' + resp.status);
    if(!resp.body || !onProgreso) return r360BlobCache(path, await resp.blob());
    const total = +resp.headers.get('content-length') || 0, reader = resp.body.getReader(), chunks = [];
    let recibido = 0;
    for(;;){
      const { done, value } = await reader.read(); if(done) break;
      chunks.push(value); recibido += value.length; onProgreso(recibido, total);
    }
    return r360BlobCache(path, new Blob(chunks, { type: 'image/jpeg' }));
  })();
  const entrada = { tarea, signal };
  R360._descargas.set(path, entrada);
  // abort() despacha el evento de forma síncrona: la siguiente llamada del mismo tramo ya no la comparte
  signal?.addEventListener('abort', () => { if(R360._descargas.get(path) === entrada) R360._descargas.delete(path); }, { once: true });
  try{ return await tarea; } finally{ if(R360._descargas.get(path) === entrada) R360._descargas.delete(path); }
}
// Destruye el visor. Si todavía no terminó de cargar (Pannellum solo crea el
// contexto WebGL y sus listeners globales al cargar, y destroy() no cancela
// esa carga), espera a que cargue o falle y recién entonces lo destruye: así
// no quedan contextos ni listeners huérfanos. Devuelve una promesa que los
// llamadores pueden ignorar.
function r360DestruirVisor(){
  const v = R360.visor; R360.visor = null;
  return r360DestruirInstancia(v);
}
function r360DestruirInstancia(v){
  if(!v) return Promise.resolve();
  // El host propio del visor sale del DOM YA: el destroy() de Pannellum (inmediato
  // o diferido) vacía "su" contenedor, y así nunca toca al visor siguiente ni al
  // mensaje de descarga que ocupa #r360Visor.
  try{ v._r360Host?.remove(); }catch(e){}
  let diferido = false, llamadas = 0;
  const fin = () => {
    llamadas++;
    try{ v.destroy(); }catch(e){}
    r360RevocarUrlVisor(v);
    r360Dbg(`visor destroy punto #${v._r360Orden ?? '?'}${diferido ? (llamadas === 1 ? ' (diferido hasta terminar su carga)' : ' (segunda pasada: carga tardía tras el tope)') : ''}`);
  };
  let cargado = true; try{ cargado = v.isLoaded(); }catch(e){}
  if(cargado){ fin(); return Promise.resolve(); }
  // Se destruye al terminar la carga (aunque sea después del tope de 10 s: una
  // carga tardía crearía contexto WebGL y listeners que nadie más liberaría) y,
  // como tope, a los 10 s. destroy() de Pannellum tolera llamarse dos veces.
  diferido = true;
  const alTerminar = (v._r360Listo || Promise.resolve()).then(fin, fin);
  return Promise.race([alTerminar, new Promise(r => setTimeout(r, 10000))]).then(fin, fin);
}
async function r360AbrirVisor(id, opts = {}){
  const p = r360Punto(id), cont = document.getElementById('r360Visor');
  if(!p || !cont) return;
  // Línea de tiempo: `mostrar` es la pareja de otra fecha que se ve en lugar del punto (nunca comparando: ahí va en el visor B)
  const mostrar = (opts.mostrar && !R360.cmp.activo) ? opts.mostrar : null, m = mostrar ? mostrar.punto : p;
  // ◀ ▶ conservan la orientación entre puntos consecutivos; entre fechas del mismo lugar se conserva el RUMBO (norte de cada foto)
  if(opts.mantenerVista && R360.visor){
    try{
      if(R360.visor.isLoaded()){
        const giro = opts.trasladarNorte ? (r360DeltaNorte(R360.visor._r360Punto, m) ?? 0) : 0;
        opts = { ...opts, yaw: r360NormYaw(R360.visor.getYaw() + giro), pitch: R360.visor.getPitch(), hfov: R360.visor.getHfov() };
      }
    }catch(e){}
  }
  // Doble toque sobre lo que YA se está descargando: no se aborta ni se reinicia desde 0 %
  const path = m[r360VarianteVisor()] || m.archivo_web || m.archivo_full;
  const enCurso = R360.visorPuntoId === id && R360._visorRuta === path && !R360.visor && !!R360._visorAbort && !R360._visorAbort.signal.aborted;
  R360.visorPuntoId = id;
  if(!enCurso){ r360AbortarDescarga(); r360DestruirVisor(); }
  R360._visorRuta = path; R360.lt.mostrado = mostrar;
  r360PintarVisorBarra(); r360PintarMarcas(); r360MarcarThumbActual();
  r360PintarFechas();                                            // parejas de otras fechas; comparando, mueve también el segundo visor
  if(enCurso) return;
  if(!path){ cont.innerHTML = '<div class="r360-visor-msg">Este punto no tiene imagen</div>'; return; }
  cont.innerHTML = '<div class="r360-visor-msg" id="r360VisorMsg">Descargando panorámica…</div>';
  if(opts.scroll !== false && window.innerWidth < 900) cont.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const ac = new AbortController(); R360._visorAbort = ac;
  const t0 = performance.now(), enCache = R360._blobs.has(path);
  const progreso = (r, t) => {
    const m = document.getElementById('r360VisorMsg');
    if(m) m.textContent = t ? `Descargando panorámica… ${Math.round(r / t * 100)} %` : `Descargando panorámica… ${(r / 1048576).toFixed(1)} MB`;
  };
  let blob = null;
  for(let intento = 0; intento < 2 && !blob; intento++){
    try{ blob = await r360DescargarPanoramica(path, ac.signal, progreso); }
    catch(e){
      if(R360.visorPuntoId !== id || ac.signal.aborted) return;
      if(e?.name === 'AbortError' && intento === 0) continue;   // era una descarga compartida (precarga) que abortaron: se reintenta con la propia señal
      cont.innerHTML = `<div class="r360-visor-msg">No se pudo descargar la imagen${navigator.onLine ? '' : ' (sin señal)'}</div>`;
      return;
    }
  }
  if(!blob || R360.visorPuntoId !== id || ac.signal.aborted) return;   // el usuario cambió de punto mientras descargaba
  if(R360._visorAbort === ac) R360._visorAbort = null;
  r360CrearVisor(cont, m, path, blob, { ...opts, _dbg: { t0, tDesc: Math.round(performance.now() - t0), enCache } });
}
function r360CrearVisor(cont, p, path, blob, opts){
  if(typeof pannellum === 'undefined'){ cont.innerHTML = '<div class="r360-visor-msg">El visor 360 no está disponible (pannellum no cargó)</div>'; return; }
  cont.innerHTML = '';
  const host = document.createElement('div'); host.className = 'r360-visor-host'; cont.appendChild(host);   // contenedor propio de ESTE visor
  const bu = r360UrlDeBlob(path, blob);
  const cfg = {
    type: 'equirectangular', panorama: bu, autoLoad: true, showControls: true, crossOrigin: 'anonymous',
    hfov: opts.hfov ?? 100, minHfov: 40, maxHfov: 120, yaw: opts.yaw ?? 0, pitch: opts.pitch ?? 0,
    friction: 0.15, draggable: true, mouseZoom: true, keyboardZoom: true,
    compass: r360Norte(p) != null, northOffset: r360Norte(p) ?? 0,   // northOffset = heading_norte (ver «NORTE»)
    strings: { loadingLabel: 'Cargando…', loadButtonLabel: 'Ver', bylineLabel: '', noPanoramaError: 'Sin panorámica',
               fileAccessError: 'No se pudo acceder a la imagen (%s)', malformedURLError: 'URL no válida',
               iOS8WebGLError: 'WebGL no disponible en este navegador', genericWebGLError: 'Este dispositivo no soporta WebGL',
               textureSizeError: 'La imagen (%spx) supera el máximo de este dispositivo (%spx)', unknownError: 'Error desconocido' }
  };
  let v;
  try{ v = pannellum.viewer(host, cfg); }
  catch(e){ r360RevocarUrl(path, bu); cont.innerHTML = `<div class="r360-visor-msg">No se pudo iniciar el visor: ${escAttr(e?.message || e)}</div>`; return; }
  v._r360Host = host;
  v._r360Path = path;
  v._r360Orden = p.orden;
  v._r360Punto = p;
  v._r360BlobUrl = bu;
  v._r360Listo = new Promise(res => { v.on('load', res); v.on('error', res); });
  const esB = opts.slot === 'b', vigente = () => (esB ? R360.cmp.visor : R360.visor) === v;
  if(esB) R360.cmp.visor = v; else R360.visor = v;
  // Eventos del visor: van por consola con prefijo [360] (el panel de depuración los captura)
  v.on('load', () => {
    r360RevocarUrlVisor(v);                              // la textura ya está en GPU: el blob: URL sobra
    const d = opts._dbg;
    console.info(`[360] visor${esB ? ' B' : ''} load punto #${p.orden}: ${path.endsWith('full.jpg') ? 'full' : 'web'} · ${(blob.size / 1048576).toFixed(2)} MB`
      + (d ? ` · descarga ${d.tDesc} ms${d.enCache ? ' (caché)' : ''} · visible a los ${Math.round(performance.now() - d.t0)} ms` : '')
      + (vigente() ? '' : ' · (visor ya reemplazado: se destruye)'));
    if(!vigente()) return;
    if(esB) R360.cmp.lider = 'a';                        // la fecha recién cargada se alinea con la que ya se veía
    else if(!R360.lt.mostrado) r360Precargar(p.id);     // la siguiente se descarga solo cuando esta ya se ve
  });
  v.on('error', msg => {
    r360RevocarUrlVisor(v);
    console.warn(`[360] visor${esB ? ' B' : ''} error punto #${p.orden}:`, msg);
  });
}
// Precarga la siguiente panorámica a la caché en memoria (una a la vez; no
// con ahorro de datos ni en 2G).
function r360Precargar(id){
  const con = navigator.connection;
  if(con && (con.saveData || /2g/.test(con.effectiveType || ''))) return;
  if(R360.cmp.activo && r360EsTelefono()) return;       // comparando en teléfono ya hay dos panorámicas en memoria
  const lista = r360PuntosOrdenados(), i = lista.findIndex(x => x.id === id), sig = lista[i + 1];
  if(!sig || !navigator.onLine) return;
  const path = sig[r360VarianteVisor()] || sig.archivo_web;
  if(!path || R360._blobs.has(path) || R360._descargas.has(path)) return;
  if(R360._precarga){ try{ R360._precarga.abort(); }catch(e){} }
  const ac = new AbortController(); R360._precarga = ac;
  r360DescargarPanoramica(path, ac.signal).catch(() => {}).finally(() => { if(R360._precarga === ac) R360._precarga = null; });
}
function r360PintarVisorBarra(){
  const b = document.getElementById('r360VisorBarra'); if(!b) return;
  const p = r360Punto(R360.visorPuntoId);
  if(!p){ b.innerHTML = ''; return; }
  const lista = r360PuntosOrdenados(), i = lista.findIndex(x => x.id === p.id), prev = lista[i - 1], next = lista[i + 1];
  const otra = R360.lt.puntoId === p.id ? R360.lt.mostrado : null;
  const ubica = r360PuedeUbicar() && !otra, ubicado = !!p.plano_id && p.x != null;
  const plano = ubicado ? R360.planos.find(x => x.id === p.plano_id) : null;
  const parejas = R360.lt.puntoId === p.id ? R360.lt.parejas : undefined, radio = r360Radio();
  const radios = R360.RADIOS.includes(radio) ? R360.RADIOS : [...R360.RADIOS, radio].sort((x, y) => x - y);
  const ayudaCmp = parejas === undefined ? 'Buscando fotos de otras fechas…' : parejas === null ? 'No se pudieron buscar otras fechas (sin señal)'
    : parejas.length ? 'Ver este lugar en dos fechas a la vez' : `Ningún recorrido publicado tiene una foto a menos de ${String(radio).replace('.', ',')} % de este punto en este plano`;
  b.innerHTML = `
    <button class="btn" ${prev ? `onclick="r360AbrirVisor('${prev.id}',{mantenerVista:true})"` : 'disabled'} title="Anterior">◀</button>
    <div class="r360-visor-info"><b>#${p.orden}</b>${p.etiqueta ? ' · ' + escAttr(p.etiqueta) : ''} <span style="color:#676879">(${i + 1}/${lista.length})</span><br>
      <span>${r360Fecha(p.fecha_captura)}${p.camara ? ' · ' + escAttr(p.camara) : ''}${r360Norte(p) != null ? ' · 🧭' : ''} · ${ubicado ? (p.waypoint ? '📍 ubicado a mano' : '≈ interpolado') + (plano ? ' en ' + escAttr(plano.nombre) : '') + (r360PaginaDe(p) > 1 ? ', pág. ' + r360PaginaDe(p) : '') : 'sin ubicar'}${p.notas ? ' · ⚠ ' + escAttr(p.notas) : ''}</span>
      ${otra ? `<br><span class="r360-otra-fecha">Viendo el <b>${escAttr(r360FechaDia(otra.recorrido.fecha))}</b> · ${escAttr(otra.recorrido.titulo || '')} · #${otra.punto.orden}${otra.punto.etiqueta ? ' · ' + escAttr(otra.punto.etiqueta) : ''} (a ${otra.distancia.toFixed(1).replace('.', ',')} % en el plano) · <a href="#" onclick="event.preventDefault();r360VerFecha('${p.recorrido_id}')">volver a este recorrido</a></span>` : ''}</div>
    <button class="btn" ${next ? `onclick="r360AbrirVisor('${next.id}',{mantenerVista:true})"` : 'disabled'} title="Siguiente">▶</button>
    ${ubica ? `<button class="btn" onclick="r360ArmarUbicacion('${p.id}')">📍 ${ubicado ? 'Reubicar' : 'Ubicar en plano'}</button>` : ''}
    ${ubicado && !R360.cmp.activo ? `<button class="btn" onclick="r360Comparar()" ${parejas && parejas.length ? '' : 'disabled'} title="${escAttr(ayudaCmp)}">⇆ Comparar fechas${parejas && parejas.length ? ` (${parejas.length})` : ''}</button>` : ''}
    ${ubicado ? `<label class="r360-radio" title="Radio para buscar el mismo lugar en otros recorridos, en % del ancho del plano">Radio <select onchange="r360SetRadio(this.value)">${radios.map(r => `<option value="${r}" ${r === radio ? 'selected' : ''}>${String(r).replace('.', ',')} %</option>`).join('')}</select></label>` : ''}
    ${ubica && ubicado ? `<button class="btn" onclick="r360QuitarDelPlano('${p.id}')">Quitar del plano</button>` : ''}
    ${r360PuedeFijarNorte() && !otra ? `<button class="btn" onclick="r360FijarNorte('${p.id}')" title="Gira la foto hasta mirar al norte y pulsa: guarda esa dirección como norte del punto${r360Norte(p) != null ? ' (reemplaza el que ya tiene)' : ''}">🧭 Fijar norte</button>` : ''}
    ${PUEDE_PUBLICAR_R360() && !otra ? `<button class="btn" onclick="r360EditarEtiqueta('${p.id}')">✏️ Etiqueta</button>` : ''}
    ${ES_ADMIN_R360() && !otra ? `<button class="btn" style="color:#e2445c" onclick="r360EliminarPunto('${p.id}')" title="Borra el punto y sus 3 archivos">🗑 Eliminar punto</button>` : ''}`;
}

// ── Comparar entre fechas (fase e): vista dividida ──────────────────────────
// Visor A (#r360Visor) = punto del recorrido abierto; visor B (#r360VisorB) =
// su pareja en otro recorrido publicado (R360.cmp.recId). Bloqueados, el que
// el usuario toca por último manda («líder») y el otro copia giro, inclinación
// y zoom en cada cuadro. El giro se traslada por el norte de cada foto (ver
// «NORTE» más abajo). Si a alguna foto le falta el norte, o el norte no es
// exacto, se sueltan los visores, se alinean a mano y al volver a bloquear la
// diferencia queda como ajuste manual (se conserva al pasar de punto).
function r360EsTelefono(){
  try{ return window.innerWidth < 900 || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600); }
  catch(e){ return window.innerWidth < 900; }
}
// 'AAAA-MM-DD' (fecha del recorrido) sin pasar por zona horaria
function r360FechaDia(f){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f || '')); if(!m) return String(f || '—');
  try{ return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch(e){ return m[0]; }
}
function r360NormYaw(y){ return ((Number(y) + 180) % 360 + 360) % 360 - 180; }
// ── NORTE: definición ÚNICA de puntos_360.heading_norte ─────────────────────
// heading_norte = RUMBO DEL CENTRO de la panorámica (yaw 0), en grados desde el
// norte y en sentido horario. Es GPano:PoseHeadingDegrees y es el northOffset
// de Pannellum. De ahí:
//     rumbo de la vista = yaw + heading_norte
//     el norte está en    yaw = −heading_norte
// NO es «el yaw que apunta al norte» (eso es su opuesto). Todo el módulo pasa
// por estas cuatro funciones; el comentario de la columna en la migración y el
// README remiten aquí.
function r360Norte(p){ return (p && p.heading_norte != null && isFinite(Number(p.heading_norte))) ? Number(p.heading_norte) : null; }
// Rumbo (0–360, 0 = norte, 90 = este) hacia el que se mira con ese yaw; null sin norte
function r360Rumbo(p, yaw){ const n = r360Norte(p); return n == null ? null : ((Number(yaw) + n) % 360 + 360) % 360; }
// heading_norte que hay que guardar para que ese yaw mire a ese rumbo («fijar norte»: rumbo 0)
function r360NorteParaYaw(yaw, rumbo = 0){ return +r360NormYaw(Number(rumbo) - Number(yaw)).toFixed(2); }
// «Fijar norte»: el usuario gira el visor hasta mirar al norte y lo guarda. Se escribe
// heading_norte = −yaw (r360NorteParaYaw), así ese yaw pasa a ser rumbo 0. Descarta el ajuste
// manual de la comparación: desde ahora manda el norte guardado.
async function r360FijarNorte(id){
  const p = r360Punto(id);
  if(!p || !r360PuedeFijarNorte()) return false;
  if(R360.lt.mostrado || R360.visorPuntoId !== id){ toast('Vuelve a la foto de este recorrido para fijar su norte', 'info'); return false; }
  const v = R360.visor; let yaw = null;
  try{ if(v && v.isLoaded() && v._r360Punto?.id === id) yaw = v.getYaw(); }catch(e){}
  if(yaw == null){ toast('Espera a que la foto termine de cargar', 'info'); return false; }
  const previo = r360Norte(p);
  if(!confirm(`Gira la foto hasta mirar al NORTE y acepta: el centro de lo que ves ahora quedará como norte del punto #${p.orden}.${previo != null ? ` Reemplaza el norte que ya tenía (${Math.round(previo)}°).` : ''}`)) return false;
  if(bloquearSiCerrado()) return false;
  const heading_norte = r360NorteParaYaw(yaw);
  if(!await r360GuardarPunto(id, { heading_norte })) return false;
  r360Dbg(`fijar norte punto #${p.orden}: yaw ${yaw.toFixed(1)}° → heading_norte ${heading_norte}${previo != null ? ` (antes ${previo})` : ''}`);
  toast(`Norte del punto #${p.orden} guardado ✓`, 'success');
  if(R360.cmp.activo){ R360.cmp.ajuste = 0; R360.cmp.bloqueado = true; r360CmpRecalcularDelta(); r360PintarCmpBarra(); }
  // La brújula de Pannellum se configura al crear el visor: se recrea con la misma vista (la foto está en memoria)
  if(R360.visorPuntoId === id) r360AbrirVisor(id, { mantenerVista: true, scroll: false });
  return true;
}
// Giro que se suma al yaw de `a` para mirar al mismo rumbo en `b`; null si a alguna le falta el norte
function r360DeltaNorte(a, b){
  const na = r360Norte(a), nb = r360Norte(b);
  return (na == null || nb == null) ? null : r360NormYaw(na - nb);
}
function r360CmpRecalcularDelta(){
  const c = R360.cmp;
  c.delta = r360NormYaw((r360DeltaNorte(r360Punto(R360.visorPuntoId), c.par?.punto) ?? 0) + c.ajuste);
}
function r360ParejasVigentes(){
  const id = R360.visorPuntoId;
  return (id && R360.lt.puntoId === id && Array.isArray(R360.lt.parejas)) ? R360.lt.parejas : [];
}
// Fecha por defecto al comparar: la anterior más reciente; si no hay, la siguiente
function r360ParejaPorDefecto(parejas, rec){
  const antes = parejas.filter(e => String(e.recorrido.fecha || '') <= String(rec?.fecha || ''));
  return antes.length ? antes[antes.length - 1] : parejas[0];
}
function r360SetRadio(v){
  v = Number(v); if(!(v >= 0.5 && v <= 20)) return;
  r360DbgLS('r360_radio', String(v));
  R360._parejas.clear();
  r360PintarFechas();
}

// Busca las parejas del punto del visor y pinta pestañas y barras. Comparando,
// lleva el visor B a la pareja del punto nuevo (o avisa que no la hay).
async function r360PintarFechas(){
  const id = R360.visorPuntoId, p = r360Punto(id);
  if(!p){ R360.lt.puntoId = null; R360.lt.parejas = null; R360.lt.mostrado = null; r360PintarTiras(); return; }
  if(R360.lt.puntoId !== id){ R360.lt.puntoId = id; R360.lt.parejas = undefined; r360PintarTiras(); }
  const parejas = await r360ParejasDe(p);
  if(R360.visorPuntoId !== id || !r360Punto(id)) return;      // el usuario ya está en otro punto (o salió)
  R360.lt.parejas = parejas;
  const vista = R360.lt.mostrado;
  if(vista && !(parejas || []).some(e => e.punto.id === vista.punto.id)){ r360VerFecha(p.recorrido_id); return; }
  r360PintarTiras(); r360PintarVisorBarra();
  if(R360.cmp.activo) r360CmpAbrirB();
}
// Línea de tiempo: cambia la fecha que se ve en el visor sin salir del punto ni perder el rumbo
function r360VerFecha(recId){
  const p = r360Punto(R360.visorPuntoId); if(!p || R360.cmp.activo) return;
  const par = recId === p.recorrido_id ? null : r360ParejasVigentes().find(e => e.recorrido.id === recId);
  if(recId !== p.recorrido_id && !par) return;
  if((R360.lt.mostrado?.punto.id || null) === (par?.punto.id || null)) return;
  r360AbrirVisor(p.id, { mostrar: par, mantenerVista: true, trasladarNorte: true, scroll: false });
}
function r360FechaTabHtml(e, activa, accion){
  const t = `${e.propia ? 'Este recorrido: ' : ''}${e.recorrido.titulo || ''} · #${e.punto.orden}${e.distancia != null ? ' · a ' + e.distancia.toFixed(1).replace('.', ',') + ' % en el plano' : ''}`;
  return `<button type="button" class="r360-fecha-tab ${activa ? 'activa' : ''}" ${accion ? `onclick="${accion}"` : 'disabled'} title="${escAttr(t)}">${e.propia ? '● ' : ''}${escAttr(r360FechaDia(e.recorrido.fecha))}${e.punto.etiqueta ? ' · ' + escAttr(e.punto.etiqueta) : ''}</button>`;
}
function r360PintarTiras(){
  const a = document.getElementById('r360Fechas'), b = document.getElementById('r360FechasB');
  const c = R360.cmp, base = r360Punto(R360.visorPuntoId), rec = R360.recorridoActivo, parejas = r360ParejasVigentes();
  const propia = (base && rec) ? { punto: base, recorrido: rec, distancia: null, propia: true } : null;
  if(a){
    if(!propia) a.innerHTML = '';
    else if(c.activo) a.innerHTML = r360FechaTabHtml(propia, true, null);
    else if(!parejas.length) a.innerHTML = '';                 // sin otras fechas no hay línea de tiempo que mostrar
    else {
      const vista = R360.lt.mostrado?.recorrido.id || rec.id;
      const orden = [...parejas, propia].sort((x, y) => String(x.recorrido.fecha || '').localeCompare(String(y.recorrido.fecha || '')) || String(x.punto.fecha_captura || '').localeCompare(String(y.punto.fecha_captura || '')));
      a.innerHTML = orden.map(e => r360FechaTabHtml(e, e.recorrido.id === vista, `r360VerFecha('${e.recorrido.id}')`)).join('');
      a.querySelector('.activa')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }
  if(b) b.innerHTML = c.activo ? parejas.map(e => r360FechaTabHtml(e, e.recorrido.id === c.recId, `r360CmpFecha('${e.recorrido.id}')`)).join('') : '';
}

// El líder es el visor que el usuario tocó por último (las pestañas de fecha no cuentan)
function r360CmpEnlazar(){
  ['r360MarcoA', 'r360MarcoB'].forEach(id => {
    const m = document.getElementById(id); if(!m) return;
    const marcar = e => { if(!e.target.closest?.('.r360-fechas')) R360.cmp.lider = m.dataset.slot; };
    ['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(ev => m.addEventListener(ev, marcar, { capture: true, passive: true }));
  });
}
function r360CmpLayout(on){
  document.querySelector('.r360-layout')?.classList.toggle('comparando', !!on);
  const mb = document.getElementById('r360MarcoB'); if(mb) mb.style.display = on ? '' : 'none';
  // Pannellum no se entera de que su contenedor cambió de tamaño
  requestAnimationFrame(() => { [R360.visor, R360.cmp.visor].forEach(v => { try{ if(v && v.isLoaded()) v.resize(); }catch(e){} }); });
}
function r360Comparar(recId){
  const c = R360.cmp, base = r360Punto(R360.visorPuntoId), rec = R360.recorridoActivo;
  if(!base || !rec || !document.getElementById('r360VisorB')) return;
  const parejas = r360ParejasVigentes();
  if(!parejas.length){ toast('Este punto no tiene fotos de otras fechas dentro del radio', 'info'); return; }
  const destino = parejas.find(e => e.recorrido.id === (recId || R360.lt.mostrado?.recorrido.id)) || r360ParejaPorDefecto(parejas, rec);
  c.activo = true; c.recId = destino.recorrido.id; c.rec = destino.recorrido; c.par = null; c.bloqueado = true; c.ajuste = 0; c.delta = 0; c.lider = 'a';
  r360Dbg(`comparar: punto #${base.orden} con ${destino.recorrido.fecha} · ${r360EsTelefono() ? 'teléfono (variante web en los dos visores)' : 'escritorio'}`);
  // Teléfono: las 'full' que quedaban en memoria dejan sitio a las dos 'web'
  if(r360EsTelefono()){ [...R360._blobs.keys()].filter(k => k.endsWith('/full.jpg')).forEach(r360OlvidarBlob); r360DbgCache(); }
  r360CmpLayout(true);
  if(window.innerWidth < 900) document.querySelector('.r360-duo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if(!c.raf) c.raf = requestAnimationFrame(r360CmpTick);
  // En teléfono el visor A pasa a la variante web; si ya muestra la ruta que toca, no se recarga
  const path = base[r360VarianteVisor()] || base.archivo_web || base.archivo_full;
  if(!R360.visor || R360.visor._r360Path !== path) r360AbrirVisor(base.id, { mantenerVista: true, trasladarNorte: true, scroll: false });   // → r360PintarFechas → visor B
  else { r360PintarTiras(); r360PintarVisorBarra(); r360CmpAbrirB(); }
}
function r360CmpFecha(recId){
  const c = R360.cmp; if(!c.activo || c.recId === recId) return;
  c.recId = recId; c.rec = r360ParejasVigentes().find(e => e.recorrido.id === recId)?.recorrido || c.rec;
  r360PintarTiras(); r360CmpAbrirB();
}
// Cierra la comparación y LIBERA el segundo visor (contexto WebGL, descarga en
// curso y, en teléfono, sus panorámicas en memoria). Se llama también desde
// todos los cierres del recorrido; sin comparación abierta solo repone el estado.
function r360CerrarComparacion(){
  const c = R360.cmp, estaba = c.activo;
  if(c.raf){ try{ cancelAnimationFrame(c.raf); }catch(e){} c.raf = 0; }
  if(c.abort){ try{ c.abort.abort(); }catch(e){} c.abort = null; }
  const v = c.visor; c.visor = null;
  if(v) r360DestruirInstancia(v);
  if(c.rutas.size && r360EsTelefono()){ c.rutas.forEach(r360OlvidarBlob); r360DbgCache(); }
  c.rutas.clear();
  c.activo = false; c.recId = null; c.rec = null; c.par = null; c.bajando = null; c.bloqueado = true; c.ajuste = 0; c.delta = 0; c.lider = 'a';
  const vb = document.getElementById('r360VisorB'); if(vb) vb.innerHTML = '';
  if(estaba){ r360Dbg('comparar: cerrado, segundo visor liberado'); r360CmpLayout(false); r360PintarTiras(); r360PintarCmpBarra(); r360PintarVisorBarra(); }
}

// Visor B: la pareja del punto actual en el recorrido elegido
async function r360CmpAbrirB(){
  const c = R360.cmp, cont = document.getElementById('r360VisorB');
  if(!c.activo || !cont) return;
  const par = r360ParejasVigentes().find(e => e.recorrido.id === c.recId) || null;
  const path = par ? (par.punto[r360VarianteVisor()] || par.punto.archivo_web || par.punto.archivo_full) : null;
  // La misma foto ya está puesta o bajando: solo se refrescan datos y barra
  if(par && path && ((c.visor && c.visor._r360Path === path) || (c.bajando === path && c.abort && !c.abort.signal.aborted))){
    c.par = par; r360CmpRecalcularDelta(); r360PintarCmpBarra(); return;
  }
  // Vista de partida: la del visor A trasladada por el norte; si A aún no cargó, la del B saliente
  c.par = par; r360CmpRecalcularDelta();
  let vista = {};
  try{
    if(R360.visor && R360.visor.isLoaded()) vista = { yaw: r360NormYaw(R360.visor.getYaw() + c.delta), pitch: R360.visor.getPitch(), hfov: R360.visor.getHfov() };
    else if(c.visor && c.visor.isLoaded()) vista = { yaw: c.visor.getYaw(), pitch: c.visor.getPitch(), hfov: c.visor.getHfov() };
  }catch(e){}
  if(c.abort){ try{ c.abort.abort(); }catch(e){} c.abort = null; }
  const viejo = c.visor; c.visor = null; c.bajando = null;
  if(viejo) r360DestruirInstancia(viejo);
  r360PintarCmpBarra();
  if(!par){
    cont.innerHTML = `<div class="r360-visor-msg">${R360.lt.parejas === null ? 'No se pudieron buscar las fotos de otras fechas (sin señal)' : `Sin foto del ${escAttr(r360FechaDia(c.rec?.fecha))} cerca de este punto`}</div>`;
    return;
  }
  if(!path){ cont.innerHTML = '<div class="r360-visor-msg">Esa fecha no tiene imagen</div>'; return; }
  cont.innerHTML = '<div class="r360-visor-msg" id="r360VisorMsgB">Descargando panorámica…</div>';
  const ac = new AbortController(); c.abort = ac; c.bajando = path; c.rutas.add(path);
  const t0 = performance.now(), enCache = R360._blobs.has(path);
  const progreso = (r, t) => {
    const m = document.getElementById('r360VisorMsgB');
    if(m) m.textContent = t ? `Descargando panorámica… ${Math.round(r / t * 100)} %` : `Descargando panorámica… ${(r / 1048576).toFixed(1)} MB`;
  };
  const vigente = () => c.activo && c.abort === ac && !ac.signal.aborted;
  let blob = null;
  for(let intento = 0; intento < 2 && !blob; intento++){
    try{ blob = await r360DescargarPanoramica(path, ac.signal, progreso); }
    catch(e){
      if(!vigente()) return;
      if(e?.name === 'AbortError' && intento === 0) continue;   // descarga compartida que abortó otro: se reintenta con la señal propia
      c.abort = null; c.bajando = null;
      cont.innerHTML = `<div class="r360-visor-msg">No se pudo descargar la imagen${navigator.onLine ? '' : ' (sin señal)'}</div>`;
      return;
    }
  }
  if(!blob || !vigente()) return;
  c.abort = null; c.bajando = null;
  // A pudo moverse mientras B descargaba: la vista de partida se toma ahora
  try{ if(R360.visor && R360.visor.isLoaded()) vista = { yaw: r360NormYaw(R360.visor.getYaw() + c.delta), pitch: R360.visor.getPitch(), hfov: R360.visor.getHfov() }; }catch(e){}
  r360CrearVisor(cont, par.punto, path, blob, { ...vista, slot: 'b', _dbg: { t0, tDesc: Math.round(performance.now() - t0), enCache } });
}

// Sincronía: un cuadro de animación; solo escribe en el seguidor si difiere
function r360CmpTick(){
  const c = R360.cmp; c.raf = 0;
  if(!c.activo) return;
  c.raf = requestAnimationFrame(r360CmpTick);
  if(!c.bloqueado) return;
  const a = R360.visor, b = c.visor; if(!a || !b) return;
  try{
    if(!a.isLoaded() || !b.isLoaded()) return;
    const mandaB = c.lider === 'b', lider = mandaB ? b : a, seg = mandaB ? a : b;
    const yaw = r360NormYaw(lider.getYaw() + (mandaB ? -c.delta : c.delta)), pitch = lider.getPitch(), hfov = lider.getHfov();
    if(Math.abs(r360NormYaw(seg.getYaw() - yaw)) > 0.01) seg.setYaw(yaw, false);
    if(Math.abs(seg.getPitch() - pitch) > 0.01) seg.setPitch(pitch, false);
    if(Math.abs(seg.getHfov() - hfov) > 0.01) seg.setHfov(hfov, false);
  }catch(e){}
}
// Bloquear fija la alineación que se ve: lo que difiera del norte queda como ajuste manual
function r360CmpBloqueo(){
  const c = R360.cmp; if(!c.activo) return;
  if(c.bloqueado) c.bloqueado = false;
  else {
    try{
      const a = R360.visor, b = c.visor;
      if(a && b && a.isLoaded() && b.isLoaded()){
        const norte = r360DeltaNorte(r360Punto(R360.visorPuntoId), c.par?.punto) ?? 0;
        c.ajuste = r360NormYaw(b.getYaw() - a.getYaw() - norte);
        if(Math.abs(c.ajuste) < 0.5) c.ajuste = 0;
      }
    }catch(e){}
    c.bloqueado = true;
  }
  r360CmpRecalcularDelta(); r360PintarCmpBarra();
}
function r360CmpNorte(){
  const c = R360.cmp; if(!c.activo) return;
  c.ajuste = 0; c.bloqueado = true; c.lider = 'a';
  r360CmpRecalcularDelta(); r360PintarCmpBarra();
}
// Indicador DENTRO del visor B: visible mientras haya un ajuste manual de rumbo
// en uso (bloqueado con ajuste ≠ 0). Con norte en las dos fotos, tocarlo lo descarta.
function r360PintarCmpAjuste(){
  const el = document.getElementById('r360CmpAjuste'); if(!el) return;
  const c = R360.cmp, ver = c.activo && c.bloqueado && !!c.ajuste && !!c.par;
  el.style.display = ver ? '' : 'none';
  if(!ver){ el.innerHTML = ''; return; }
  const conNorte = r360DeltaNorte(r360Punto(R360.visorPuntoId), c.par.punto) != null;
  const grados = `${c.ajuste > 0 ? '+' : '−'}${Math.abs(Math.round(c.ajuste)) || '<1'}°`;
  el.innerHTML = `<button type="button" ${conNorte ? 'onclick="r360CmpNorte()"' : 'disabled'} title="${conNorte ? 'Las dos fechas están alineadas a mano, no por el norte de las fotos. Toca para volver a alinear por norte.' : 'Las dos fechas están alineadas a mano: falta el norte en alguna de las fotos.'}">✋ Rumbo ajustado a mano ${grados}${conNorte ? ' · ✕' : ''}</button>`;
}
function r360PintarCmpBarra(){
  r360PintarCmpAjuste();
  const b = document.getElementById('r360CmpBarra'); if(!b) return;
  const c = R360.cmp, base = r360Punto(R360.visorPuntoId), rec = R360.recorridoActivo;
  if(!c.activo || !base || !rec){ b.innerHTML = ''; return; }
  const par = c.par, norte = par ? r360DeltaNorte(base, par.punto) : null;
  let estado;
  if(!par) estado = `El recorrido del ${escAttr(r360FechaDia(c.rec?.fecha))} no tiene foto cerca de este punto: elige otra fecha o pasa de punto con ◀ ▶`;
  else if(!c.bloqueado) estado = 'Visores sueltos: alinea cada uno y pulsa el candado para fijar esa alineación';
  else if(c.ajuste) estado = `Giro, inclinación y zoom sincronizados con tu alineación manual (${c.ajuste > 0 ? '+' : ''}${Math.round(c.ajuste)}°${norte == null ? '' : ' sobre el norte'})`;
  else if(norte == null){
    const faltan = [r360Norte(base) == null ? 'la actual' : null, r360Norte(par.punto) == null ? 'la otra fecha' : null].filter(Boolean).join(' ni ');
    estado = `Sincronizados sin norte (no lo trae ${faltan}): si no coinciden, suelta, alinea a mano y vuelve a bloquear`;
  }
  else estado = 'Giro, inclinación y zoom sincronizados · norte de cada foto aplicado';
  b.innerHTML = `
    <button class="btn" onclick="r360CmpBloqueo()" ${par ? '' : 'disabled'} title="${c.bloqueado ? 'Soltar: mover cada visor por separado' : 'Bloquear: los dos visores se mueven juntos'}">${c.bloqueado ? '🔒 Bloqueado' : '🔓 Suelto'}</button>
    <button class="btn" onclick="r360CmpNorte()" ${par && norte != null && (c.ajuste || !c.bloqueado) ? '' : 'disabled'} title="Descarta la alineación manual y vuelve a alinear por el norte de cada foto">🧭 Alinear por norte</button>
    <div class="r360-visor-info"><b>${escAttr(r360FechaDia(rec.fecha))}</b> (actual)${par ? ` ⇆ <b>${escAttr(r360FechaDia(par.recorrido.fecha))}</b> · ${escAttr(par.recorrido.titulo || '')} · #${par.punto.orden}${par.punto.etiqueta ? ' · ' + escAttr(par.punto.etiqueta) : ''} <span>(a ${par.distancia.toFixed(1).replace('.', ',')} % en el plano)</span>` : ''}<br>
      <span>${estado}</span></div>
    <button class="btn" onclick="r360CerrarComparacion()">✕ Salir de comparar</button>`;
}

// Arranque del panel de depuración (sin ningún efecto si está apagado)
r360DbgInit();
