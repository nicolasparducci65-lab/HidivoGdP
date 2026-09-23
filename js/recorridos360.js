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
  // estado de página
  recorridos: [], recorridoActivo: null, puntos: [], planos: [],
  modo: 'punto', planoId: null, seleccionado: null,
  visor: null, visorPuntoId: null, _visorAbort: null, _precarga: null, _blobs: new Map(), _descargas: new Map(),
  _pdf: { doc: null, url: null, pagina: 1, paginaPedida: 1, tarea: null }, _mapaToken: 0, _drag: null,
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
  R360.recorridos = []; R360.recorridoActivo = null; R360.puntos = []; R360.planos = [];
  R360.planoId = null; R360.seleccionado = null; R360.visorPuntoId = null; r360CancelarArrastre();
  R360._mapaToken++; r360PdfReset();
  r360AbortarDescarga(); if(R360._precarga){ try{ R360._precarga.abort(); }catch(e){} R360._precarga = null; }
  r360VaciarCacheBlobs();
  r360DestruirVisor();
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
  if(R360.recorridoActivo && R360.recorridoActivo.proyecto_id === currentProyecto){ return abrirRecorrido360(R360.recorridoActivo.id); }
  const proy = currentProyecto;
  const { data, error } = await sb.from('recorridos_360').select('*, puntos_360(count)')
    .eq('proyecto_id', proy).order('fecha', { ascending: false }).order('created_at', { ascending: false });
  // Mientras se consultaba pudo cambiar el proyecto, abrirse un recorrido o empezar a
  // escribirse uno nuevo: una lista tardía no pisa nada de eso
  if(proy !== currentProyecto || (R360.recorridoActivo && R360.recorridoActivo.proyecto_id === currentProyecto)) return;
  const formAbierto = document.getElementById('r360NuevoForm');
  if(formAbierto && formAbierto.style.display !== 'none') return;
  if(error){
    // 42P01 = la tabla no existe: la migración 20260922_recorridos_360.sql aún no se aplicó
    cont.innerHTML = error.code === '42P01'
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
      return;
    }
    // el estado cambió (otro dispositivo publicó / despublicó): render completo
  }
  // Vista actual del visor, para restaurarla si se reabre el mismo punto
  let vista = null; const idPrevio = R360.visorPuntoId;
  if(R360.visor && idPrevio){ try{ if(R360.visor.isLoaded()) vista = { yaw: R360.visor.getYaw(), pitch: R360.visor.getPitch(), hfov: R360.visor.getHfov() }; }catch(e){} }
  if(R360.recorridoActivo?.id !== id) r360VaciarCacheBlobs();   // las panorámicas en memoria son de otro recorrido
  r360AbortarDescarga(); r360DestruirVisor(); R360.seleccionado = null; r360CancelarArrastre(); R360._mapaToken++;
  cont.innerHTML = '<div class="page-loader"><div class="spinner"></div>Cargando recorrido...</div>';
  const [{ data: rec, error: e1 }, { data: puntos, error: e2 }, { data: planos }] = await Promise.all([
    sb.from('recorridos_360').select('*').eq('id', id).single(),
    sb.from('puntos_360').select('*').eq('recorrido_id', id).order('orden'),
    sb.from('planos').select('id,nombre,url,tipo').eq('proyecto_id', currentProyecto).order('created_at')
  ]);
  if(e1 || !rec){ toast('No se pudo abrir el recorrido', 'error'); R360.recorridoActivo = null; return cargarRecorridos360(); }
  if(e2) toast('Puntos: ' + e2.message, 'error');
  if(rec.proyecto_id !== currentProyecto){ R360.recorridoActivo = null; return cargarRecorridos360(); }
  R360.recorridoActivo = rec; R360.puntos = puntos || []; R360.planos = planos || [];
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
        ${r360DbgBotonHtml()}
        ${puedeTogglar ? `<button class="btn" onclick="r360TogglePublicado()">${rec.estado === 'publicado' ? 'Volver a borrador' : '✅ Publicar'}</button>` : ''}
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
        <div id="r360Visor" class="r360-visor"><div class="r360-visor-msg">${R360.puntos.length ? 'Toca una foto de la lista o una marca del plano para verla en 360' : 'Sube fotos para empezar'}</div></div>
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
function r360VolverALista(){
  R360.recorridoActivo = null; R360.visorPuntoId = null; R360.seleccionado = null; r360CancelarArrastre();
  r360AbortarDescarga(); r360DestruirVisor(); r360VaciarCacheBlobs(); R360._mapaToken++;
  cargarRecorridos360();
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

async function r360EliminarPunto(id){
  if(!ES_ADMIN_R360()) return;
  const p = r360Punto(id); if(!p) return;
  if(!confirm(`¿Eliminar el punto #${p.orden} y sus 3 archivos?`)) return;
  const recId = p.recorrido_id;
  const { error } = await sb.from('puntos_360').delete().eq('id', id);
  if(error){ toast('Error: ' + error.message, 'error'); return; }
  // Rutas reconstruidas desde los ids (no desde la fila): solo se borran los objetos de ESTE punto
  const rutas = ['full', 'web', 'thumb'].map(v => storage360.ruta(p.proyecto_id, p.recorrido_id, p.id, v));
  try{ await storage360.borrar(rutas); }catch(e){ console.warn('[360] borrar storage:', e?.message || e); }
  rutas.forEach(r360OlvidarBlob);
  toast('Punto eliminado', 'success');
  // Refresco ligero (quita el punto, cierra su visor si era el visible) solo si el usuario sigue en ese recorrido
  if(R360.recorridoActivo?.id === recId) abrirRecorrido360(recId);
  else r360RefrescarTrasSync(true);
}

// ── Guardar cambios de un punto (ubicación, etiqueta) ───────────────────────
// .select('id'): un UPDATE que no alcanza filas (punto borrado en otro
// dispositivo, o filtrado por RLS) no es un error para PostgREST; se detecta
// por la respuesta vacía y NO se toca el estado local.
async function r360GuardarPunto(id, cambios){
  const { data, error } = await sb.from('puntos_360').update(cambios).eq('id', id).select('id');
  if(error){
    toast(esErrorDeRed(error) ? 'Sin señal: la ubicación en el plano se guarda con conexión' : 'No se pudo guardar: ' + error.message, 'error');
    return false;
  }
  if(!data || !data.length){ toast('El punto ya no existe o no tienes permiso para cambiarlo; se recarga el recorrido', 'error'); if(R360.recorridoActivo) abrirRecorrido360(R360.recorridoActivo.id); return false; }
  const p = r360Punto(id); if(p) Object.assign(p, cambios);
  return true;
}
function r360RepintarTrasCambio(){ r360PintarMarcas(); r360PintarVisorBarra(); r360PintarPuntos(); }

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
  const esPDF = (p.tipo || '').includes('pdf') || String(p.nombre || '').toLowerCase().endsWith('.pdf');
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
    const info = document.getElementById('r360PdfInfo'); if(info) info.textContent = `Página ${pagina} de ${st.doc.numPages}`;
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
    const enPlano = R360.puntos.filter(p => p.plano_id === R360.planoId && p.x != null && p.y != null);
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
      const ok = await r360GuardarPunto(d.id, { plano_id: R360.planoId, x: d.c.x, y: d.c.y, waypoint: true });
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
  const previo = { plano_id: p.plano_id, x: p.x, y: p.y, waypoint: p.waypoint };
  const cambios = { plano_id: R360.planoId, x: c.x, y: c.y, waypoint: true };
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
  if(await r360GuardarPunto(id, { plano_id: null, x: null, y: null, waypoint: false })){
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
// waypoints consecutivos (ubicados a mano en ESTE plano), cada punto intermedio
// que no sea waypoint recibe una posición lineal según su índice. Los puntos
// antes del primer waypoint o después del último no se tocan.
function r360CalcularInterpolacion(){
  const lista = r360PuntosOrdenados();
  const wps = lista.map((p, i) => ({ p, i })).filter(o => o.p.waypoint && o.p.x != null && o.p.plano_id === R360.planoId);
  if(wps.length < 2) return { motivo: `Se necesitan al menos 2 puntos ubicados a mano en este plano (hay ${wps.length})` };
  const cambios = [];
  for(let k = 0; k < wps.length - 1; k++){
    const a = wps[k], b = wps[k + 1];
    for(let i = a.i + 1; i < b.i; i++){
      const p = lista[i];
      if(p.waypoint && p.x != null) continue;          // ubicado a mano en otro plano: no se toca
      const t = (i - a.i) / (b.i - a.i);
      const x = +(Number(a.p.x) + (Number(b.p.x) - Number(a.p.x)) * t).toFixed(1);
      const y = +(Number(a.p.y) + (Number(b.p.y) - Number(a.p.y)) * t).toFixed(1);
      if(p.plano_id !== R360.planoId || Number(p.x) !== x || Number(p.y) !== y) cambios.push({ id: p.id, plano_id: R360.planoId, x, y, waypoint: false });
    }
  }
  // Fuera del tramo [primer waypoint, último]: sin ubicar (quedan así) e
  // interpolados antiguos de este plano (conservan su posición: se avisa).
  const primero = wps[0].i, ultimo = wps[wps.length - 1].i;
  let sinUbicar = 0, antiguos = 0;
  lista.forEach((p, i) => {
    if(i >= primero && i <= ultimo) return;
    if(p.x == null) sinUbicar++;
    else if(!p.waypoint && p.plano_id === R360.planoId) antiguos++;
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
      const cambios = { plano_id: c.plano_id, x: c.x, y: c.y, waypoint: false };
      const { data, error } = await sb.from('puntos_360').update(cambios).eq('id', c.id).select('id');
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
  const v = R360.visor; if(!v) return Promise.resolve();
  R360.visor = null;
  // El host propio del visor sale del DOM YA: el destroy() de Pannellum (inmediato
  // o diferido) vacía "su" contenedor, y así nunca toca al visor siguiente ni al
  // mensaje de descarga que ocupa #r360Visor.
  try{ v._r360Host?.remove(); }catch(e){}
  const fin = () => {
    try{ v.destroy(); }catch(e){}
    r360RevocarUrlVisor(v);
  };
  let cargado = true; try{ cargado = v.isLoaded(); }catch(e){}
  if(cargado){ fin(); return Promise.resolve(); }
  // Se destruye al terminar la carga (aunque sea después del tope de 10 s: una
  // carga tardía crearía contexto WebGL y listeners que nadie más liberaría) y,
  // como tope, a los 10 s. destroy() de Pannellum tolera llamarse dos veces.
  const alTerminar = (v._r360Listo || Promise.resolve()).then(fin, fin);
  return Promise.race([alTerminar, new Promise(r => setTimeout(r, 10000))]).then(fin, fin);
}
async function r360AbrirVisor(id, opts = {}){
  const p = r360Punto(id), cont = document.getElementById('r360Visor');
  if(!p || !cont) return;
  // ◀ ▶ conservan la orientación entre puntos consecutivos
  if(opts.mantenerVista && R360.visor){ try{ if(R360.visor.isLoaded()) opts = { ...opts, yaw: R360.visor.getYaw(), pitch: R360.visor.getPitch(), hfov: R360.visor.getHfov() }; }catch(e){} }
  // Doble toque sobre el punto que YA se está descargando: no se aborta ni se reinicia desde 0 %
  const enCurso = R360.visorPuntoId === id && !R360.visor && !!R360._visorAbort && !R360._visorAbort.signal.aborted;
  R360.visorPuntoId = id;
  if(!enCurso){ r360AbortarDescarga(); r360DestruirVisor(); }
  const path = p[r360VarianteVisor()] || p.archivo_web || p.archivo_full;
  r360PintarVisorBarra(); r360PintarMarcas(); r360MarcarThumbActual();
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
  r360CrearVisor(cont, p, path, blob, { ...opts, _dbg: { t0, tDesc: Math.round(performance.now() - t0), enCache } });
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
    compass: p.heading_norte != null, northOffset: Number(p.heading_norte) || 0,
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
  v._r360BlobUrl = bu;
  v._r360Listo = new Promise(res => { v.on('load', res); v.on('error', res); });
  R360.visor = v;
  v.on('load', () => {
    r360RevocarUrlVisor(v);                              // la textura ya está en GPU: el blob: URL sobra
    if(opts._dbg) r360Dbg(`punto #${p.orden}: ${path.endsWith('full.jpg') ? 'full' : 'web'} · ${(blob.size / 1048576).toFixed(2)} MB · descarga ${opts._dbg.tDesc} ms${opts._dbg.enCache ? ' (caché)' : ''} · visible a los ${Math.round(performance.now() - opts._dbg.t0)} ms`);
    if(R360.visor === v) r360Precargar(p.id);          // la siguiente se descarga solo cuando esta ya se ve
  });
  v.on('error', msg => {
    r360RevocarUrlVisor(v);
    console.warn(`[360] visor punto #${p.orden}:`, msg);
  });
}
// Precarga la siguiente panorámica a la caché en memoria (una a la vez; no
// con ahorro de datos ni en 2G).
function r360Precargar(id){
  const con = navigator.connection;
  if(con && (con.saveData || /2g/.test(con.effectiveType || ''))) return;
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
  const ubica = r360PuedeUbicar(), ubicado = !!p.plano_id && p.x != null;
  const plano = ubicado ? R360.planos.find(x => x.id === p.plano_id) : null;
  b.innerHTML = `
    <button class="btn" ${prev ? `onclick="r360AbrirVisor('${prev.id}',{mantenerVista:true})"` : 'disabled'} title="Anterior">◀</button>
    <div class="r360-visor-info"><b>#${p.orden}</b>${p.etiqueta ? ' · ' + escAttr(p.etiqueta) : ''} <span style="color:#676879">(${i + 1}/${lista.length})</span><br>
      <span>${r360Fecha(p.fecha_captura)}${p.camara ? ' · ' + escAttr(p.camara) : ''}${p.heading_norte != null ? ' · 🧭' : ''} · ${ubicado ? (p.waypoint ? '📍 ubicado a mano' : '≈ interpolado') + (plano ? ' en ' + escAttr(plano.nombre) : '') : 'sin ubicar'}${p.notas ? ' · ⚠ ' + escAttr(p.notas) : ''}</span></div>
    <button class="btn" ${next ? `onclick="r360AbrirVisor('${next.id}',{mantenerVista:true})"` : 'disabled'} title="Siguiente">▶</button>
    ${ubica ? `<button class="btn" onclick="r360ArmarUbicacion('${p.id}')">📍 ${ubicado ? 'Reubicar' : 'Ubicar en plano'}</button>` : ''}
    ${ubica && ubicado ? `<button class="btn" onclick="r360QuitarDelPlano('${p.id}')">Quitar del plano</button>` : ''}
    ${PUEDE_PUBLICAR_R360() ? `<button class="btn" onclick="r360EditarEtiqueta('${p.id}')">✏️ Etiqueta</button>` : ''}`;
}

// Arranque del panel de depuración (sin ningún efecto si está apagado)
r360DbgInit();
