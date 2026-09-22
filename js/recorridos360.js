// ============================================================================
// RECORRIDOS 360 — módulo (fase b: validación, metadatos, variantes, cola y
// storage360). Cargado desde index.html DESPUÉS del script principal; usa sus
// globales: sb, currentProyecto, currentPerfil, currentUser, currentPage, toast,
// escAttr, idbGuardar/idbTodos/idbBorrar/idbOp, esErrorDeRed,
// actualizarIndicadorOffline, sincronizarRegistrosOffline, _sincronizandoOffline,
// bloquearSiCerrado, hoyEcuador.
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
  MSG_INSTA: 'Exporta la foto 360 desde la app Insta360 antes de subirla',
  MSG_VIDEO: 'Los videos 360 no se suben desde la app: extrae fotogramas del MP4 (ver README, Recorridos 360) y súbelos como fotos en modo Secuencia',
  MSG_PC: 'Sube este lote desde PC',
  recorridos: [], recorridoActivo: null, puntos: [],
  procesando: false, lote: 0, subiendoIdLocal: null, _progreso: {}, _maxTextura: null
};

const PUEDE_EDITAR_R360   = () => ['admin','fiscalizador','residente'].includes(currentPerfil?.rol);
const PUEDE_PUBLICAR_R360 = () => ['admin','fiscalizador'].includes(currentPerfil?.rol);
const ES_ADMIN_R360       = () => currentPerfil?.rol === 'admin';

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
  // upsert:false a propósito: el residente no tiene UPDATE ni DELETE en el
  // bucket. Si el objeto ya existe (reintento tras una subida parcial) se da
  // por subido en vez de fallar.
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
  async refirmar(path){ _firmas360.delete(path); return storage360.getUrl(path); },
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
  async borrar(paths){
    const { error } = await sb.storage.from(R360.BUCKET).remove(paths.filter(Boolean));
    if(error) throw error;
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
    try{ img.src = await storage360.refirmar(path); }catch(e){ img.onerror = null; }
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
function r360MaxTextura(){
  if(R360._maxTextura) return R360._maxTextura;
  try{
    const gl = document.createElement('canvas').getContext('webgl') || document.createElement('canvas').getContext('experimental-webgl');
    R360._maxTextura = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096;
  }catch(e){ R360._maxTextura = 4096; }
  return R360._maxTextura;
}
function r360VarianteVisor(){ return r360MaxTextura() >= R360.FULL[0] ? 'archivo_full' : 'archivo_web'; }

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

// Sube un ítem de la cola: 3 variantes + fila. Idempotente ante reintentos:
// dedupe por hash en el servidor, objetos ya existentes se aceptan (409), y el
// UNIQUE (recorrido, hash) convierte un insert repetido en éxito. El progreso
// por variante vive en memoria (no se reescriben 7 MB de blobs en IndexedDB).
async function subirPunto360Offline(item){
  R360.subiendoIdLocal = item.idLocal; r360PintarCola();
  const prog = R360._progreso[item.idLocal] = R360._progreso[item.idLocal] || {};
  const rutas = {
    full:  storage360.ruta(item.proyecto_id, item.recorrido_id, item.punto_id, 'full'),
    web:   storage360.ruta(item.proyecto_id, item.recorrido_id, item.punto_id, 'web'),
    thumb: storage360.ruta(item.proyecto_id, item.recorrido_id, item.punto_id, 'thumb')
  };
  // Si otro intento ya dejó la fila (dedupe por hash o UNIQUE), los objetos que
  // este intento hubiera subido bajo OTRO punto_id sobran: se intenta borrarlos
  // (solo lo consigue un admin; para el resto queda como huérfano a limpiar).
  const limpiarSobrantes = async () => {
    const subidas = ['full','web','thumb'].filter(v => prog[v]).map(v => rutas[v]);
    if(subidas.length){ try{ await storage360.borrar(subidas); }catch(e){} }
  };
  try{
    const { data: dup } = await sb.from('puntos_360').select('id')
      .eq('recorrido_id', item.recorrido_id).eq('hash_sha256', item.punto.hash_sha256).maybeSingle();
    if(dup && dup.id !== item.punto_id){ await limpiarSobrantes(); return dup.id; }
    if(dup) return dup.id;
    for(const v of ['thumb','web','full']){
      if(prog[v]) continue;
      await storage360.subir(rutas[v], item.blobs[v]);
      prog[v] = true;
    }
    if(!(await r360ItemSigueEnCola(item.idLocal))){   // el usuario lo descartó mientras subía
      await limpiarSobrantes(); return null;
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
      if(error.code === '23505'){ await limpiarSobrantes(); return item.punto_id; }   // ya insertado por otro intento
      throw error;
    }
    delete R360._progreso[item.idLocal];
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
async function r360DescartarItem(idLocal){
  if(R360.subiendoIdLocal === idLocal){ toast('Esa foto se está subiendo ahora; espera a que termine', 'info'); return; }
  if(!confirm('¿Descartar esta foto de la cola? No se subirá.')) return;
  await idbBorrar(idLocal); delete R360._progreso[idLocal];
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
// (token) y se vacía la caché de firmas. NO se toca subiendoIdLocal: la
// subida en curso del bucle offline termina sola.
function limpiarEstadoR360(){
  R360.recorridos = []; R360.recorridoActivo = null; R360.puntos = [];
  if(R360.procesando){ R360.lote++; R360.procesando = false; }
  storage360.limpiarCache();
}

async function cargarRecorridos360(){
  const cont = document.getElementById('recorridos360Content');
  if(!cont) return;
  if(!currentProyecto){ cont.innerHTML = '<div class="empty-state"><div class="empty-icon">🌐</div><div class="empty-title">Selecciona un proyecto</div></div>'; return; }
  if(R360.recorridoActivo && R360.recorridoActivo.proyecto_id === currentProyecto){ return abrirRecorrido360(R360.recorridoActivo.id); }
  const { data, error } = await sb.from('recorridos_360').select('*, puntos_360(count)')
    .eq('proyecto_id', currentProyecto).order('fecha', { ascending: false }).order('created_at', { ascending: false });
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
      ${puede ? '<button class="btn primary" onclick="r360NuevoRecorridoForm()">+ Nuevo recorrido</button>' : ''}
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

async function abrirRecorrido360(id){
  const cont = document.getElementById('recorridos360Content'); if(!cont) return;
  // Lote en curso en este mismo recorrido: no destruir la barra de progreso;
  // refrescar solo la rejilla de puntos y la cola.
  if(R360.procesando && R360.recorridoActivo?.id === id && document.getElementById('r360Progreso')){
    const { data: puntos } = await sb.from('puntos_360').select('*').eq('recorrido_id', id).order('orden');
    if(puntos) R360.puntos = puntos;
    await r360PintarPuntos(); r360PintarCola(); return;
  }
  cont.innerHTML = '<div class="page-loader"><div class="spinner"></div>Cargando recorrido...</div>';
  const [{ data: rec, error: e1 }, { data: puntos, error: e2 }] = await Promise.all([
    sb.from('recorridos_360').select('*').eq('id', id).single(),
    sb.from('puntos_360').select('*').eq('recorrido_id', id).order('orden')
  ]);
  if(e1 || !rec){ toast('No se pudo abrir el recorrido', 'error'); R360.recorridoActivo = null; return cargarRecorridos360(); }
  if(e2) toast('Puntos: ' + e2.message, 'error');
  R360.recorridoActivo = rec; R360.puntos = puntos || [];
  const puede = PUEDE_EDITAR_R360(), esAdmin = ES_ADMIN_R360();
  const bloqueado = rec.estado === 'publicado' && !esAdmin;
  // Publicar: admin/fiscalizador. Volver a borrador: solo admin (el servidor lo
  // exige; así el congelado de puntos no se evade despublicando).
  const puedeTogglar = rec.estado === 'publicado' ? esAdmin : PUEDE_PUBLICAR_R360();
  cont.innerHTML = `
  <div class="card">
    <div class="card-header">
      <div>
        <div class="card-title"><a href="#" onclick="event.preventDefault();R360.recorridoActivo=null;cargarRecorridos360()" style="color:#676879;text-decoration:none">🌐 Recorridos</a> › ${escAttr(rec.titulo)}
          <span class="r360-estado ${rec.estado}" style="margin-left:6px">${rec.estado === 'publicado' ? 'PUBLICADO' : 'BORRADOR'}</span></div>
        <div class="card-subtitle">${escAttr(rec.fecha || '')} · <span id="r360NumPuntos">${R360.puntos.length}</span> punto(s)${rec.descripcion ? ' · ' + escAttr(rec.descripcion) : ''}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${puedeTogglar ? `<button class="btn" onclick="r360TogglePublicado()">${rec.estado === 'publicado' ? 'Volver a borrador' : '✅ Publicar'}</button>` : ''}
      </div>
    </div>
    ${puede && !bloqueado ? `
    <div style="padding:16px">
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
    <div style="padding:0 16px 16px" id="r360PuntosWrap"></div>
  </div>`;
  await r360PintarPuntos();
  r360PintarCola();
}

// Rejilla de puntos (se puede repintar sin tocar el resto de la página).
async function r360PintarPuntos(){
  const wrap = document.getElementById('r360PuntosWrap'); if(!wrap) return;
  const esAdmin = ES_ADMIN_R360();
  const num = document.getElementById('r360NumPuntos'); if(num) num.textContent = R360.puntos.length;
  wrap.innerHTML = R360.puntos.length ? `<div class="r360-puntos">${R360.puntos.map(p => `
    <div class="r360-punto ${p.x == null ? 'sin-ubicar' : ''}" id="r360p_${p.id}">
      <img alt="" data-path="${escAttr(p.archivo_thumb || '')}" loading="lazy"/>
      <div class="r360-punto-info"><b>#${p.orden}</b>${p.etiqueta ? ' · ' + escAttr(p.etiqueta) : ''}<br>
        ${p.fecha_captura ? new Date(p.fecha_captura).toLocaleString('es-EC', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
        ${p.x == null ? ' · <span style="color:#b8860b">sin ubicar</span>' : ''}${p.notas ? ' · ⚠' : ''}
        ${esAdmin ? `<div style="text-align:right;margin-top:2px"><a href="#" onclick="event.preventDefault();r360EliminarPunto('${p.id}')" style="color:#e2445c;font-size:11px">Eliminar</a></div>` : ''}
      </div>
    </div>`).join('')}</div>`
  : '<div style="padding:18px;text-align:center;color:#676879;font-size:13px">Sin puntos todavía</div>';
  // Miniaturas: UNA firma por recorrido para todas las variantes de todos los puntos
  const rutas = R360.puntos.flatMap(p => [p.archivo_thumb, p.archivo_web, p.archivo_full]).filter(Boolean);
  if(rutas.length){ try{ await storage360.getUrls(rutas); }catch(e){ console.warn('[360] firmas:', e?.message || e); } }
  wrap.querySelectorAll('img[data-path]').forEach(img => r360SetImg(img, img.dataset.path));
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
  abrirRecorrido360(rec.id);
}

async function r360EliminarPunto(id){
  if(!ES_ADMIN_R360()) return;
  const p = R360.puntos.find(x => x.id === id); if(!p) return;
  if(!confirm(`¿Eliminar el punto #${p.orden} y sus 3 archivos?`)) return;
  const { error } = await sb.from('puntos_360').delete().eq('id', id);
  if(error){ toast('Error: ' + error.message, 'error'); return; }
  // Rutas reconstruidas desde los ids (no desde la fila): solo se borran los objetos de ESTE punto
  const rutas = ['full', 'web', 'thumb'].map(v => storage360.ruta(p.proyecto_id, p.recorrido_id, p.id, v));
  try{ await storage360.borrar(rutas); }catch(e){ console.warn('[360] borrar storage:', e?.message || e); }
  toast('Punto eliminado', 'success');
  abrirRecorrido360(R360.recorridoActivo.id);
}
