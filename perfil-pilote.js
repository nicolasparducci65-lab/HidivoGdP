// perfil-pilote.js — Perfil estratigráfico y perfil del pilote de los formatos
// de calidad (FR-001-PIL y afines).
//
// Se carga en index.html DESPUÉS de expediente.js y ANTES del script principal.
// Solo funciones puras: reciben los campos de la plantilla y las respuestas del
// formato y devuelven strings (SVG/HTML). Nada de aquí toca window, document ni
// la red, así que el arnés jsdom de tests/ lo ejecuta tal cual.
//
//   generarDibujoPerfilPilote(campo, filas, campos, valores)
//       → '' | { html, soloSuelo }   bloque completo para el PDF del formato:
//         SVG (suelo + pilote con la misma escala vertical), leyendas, tabla
//         derivada y notas de inconsistencias.
//   perfilEscalaCotas({cotaSup, cotaInf, alto})   escala vertical compartida
//   perfilPiloteDatos(campos, valores)            lectura por nombre de columna
//   perfilPiloteCalculos(d)                       longitudes y volúmenes
//
// Convenciones del formato: la tabla «Cotas» y las cotas de diseño son
// absolutas (m); el «Perfil del Suelo» está en profundidades desde la
// plataforma, así que cota del estrato = CT − profundidad. Los campos se
// localizan por el nombre de la etiqueta y de las columnas (sin tildes ni
// mayúsculas), igual que hacía el perfil del suelo anterior, para que valga
// para FR-001-PIL-V1, V2 y versiones futuras. Las celdas de una tabla
// repetible se guardan por índice de columna, siempre como texto.

// ── Constantes de dibujo ─────────────────────────────────────────────────────
const PP_ALTO = 420;          // alto útil del dibujo (px): el del perfil anterior
const PP_MARGEN = 22;         // margen vertical del SVG para etiquetas y ticks
const PP_ANCHO_SUELO = 360;   // panel del suelo: eje + columna + etiquetas (≈55 %)
const PP_ANCHO_PILOTE = 300;  // panel del pilote: fuste + dimensiones + cotas (≈45 %)
const PP_COL_X = 50, PP_COL_ANCHO = 100;   // columna estratigráfica
const PP_FUSTE_X = 440;                    // eje del fuste
const PP_COTAS_X = 548;                    // fin de las líneas de referencia de cotas
const PP_GAP_TEXTO = 12;                   // separación mínima entre textos (px)

const COLORES_TIPO_SUELO = {
  'relleno':            '#bdb76b',
  'turba':              '#4b3621',
  'arcilla':            '#8b5a2b',
  'limo':               '#c2b280',
  'limo arcilloso':     '#a9854a',
  'arena':              '#f4d35e',
  'arena arcillosa':    '#dcb35c',
  'arena limosa':       '#e3c878',
  'arena con grava':    '#d9a85c',
  'grava':              '#9e9e9e',
  'grava arenosa':      '#b5a888',
  'grava limosa':       '#a8a08a',
  'grava arcillosa':    '#9c8568',
  'roca meteorizada':   '#7d7d7d',
  'roca':               '#4d4d4d'
};

function colorPorTipoSuelo(tipo){
  if(!tipo) return '#e6e9ef';
  return COLORES_TIPO_SUELO[String(tipo).trim().toLowerCase()] || '#cccccc';
}

// ── Utilidades ───────────────────────────────────────────────────────────────
function ppNorm(s){
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function ppNum(v){
  if(v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function ppEsc(s){
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// Número con coma decimal (es-EC), signo «−» tipográfico y «—» si falta.
// signo=true antepone «+» a los positivos (diferencias con signo explícito).
function ppFmt(v, dec = 2, signo = false){
  if(v == null || !Number.isFinite(v)) return '—';
  const f = Math.pow(10, dec);
  const r = Math.round(v * f) / f;
  const s = Math.abs(r).toLocaleString('es-EC', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return (r < 0 ? '−' : (signo && r > 0 ? '+' : '')) + s;
}
// Diámetro a metros: el formato lo registra en mm; si alguien lo anota en m
// (valores ≤ 10) se respeta.
function ppDiametroM(v){
  const n = ppNum(v);
  if(n == null || n <= 0) return null;
  return n > 10 ? n / 1000 : n;
}

// ── Localización de campos por nombre ────────────────────────────────────────
function ppColumnas(campo){
  return ((campo && campo.columnas) || []).map(c => ppNorm(typeof c === 'string' ? c : c && c.nombre));
}
function ppTabla(campos, re){
  return (campos || []).find(c => c && c.tipo === 'tabla_repetible' && re.test(ppNorm(c.etiqueta))) || null;
}
function ppIdxCol(campo, re, excluir){
  return ppColumnas(campo).findIndex(n => re.test(n) && !(excluir && excluir.test(n)));
}
// Primera celda con valor de esa columna (las tablas de datos del pilote tienen
// una sola fila en la práctica; si hubiera varias, vale la primera llena).
function ppCelda(valores, campo, re, excluir){
  if(!campo) return null;
  const i = ppIdxCol(campo, re, excluir);
  if(i < 0) return null;
  const filas = Array.isArray(valores[campo.id]) ? valores[campo.id] : [];
  for(const f of filas){
    const v = f && f[i];
    if(v != null && String(v).trim() !== '') return v;
  }
  return null;
}
function ppCeldaNum(valores, campo, re, excluir){ return ppNum(ppCelda(valores, campo, re, excluir)); }
// Suma de una columna numérica en todas las filas; null si ninguna tiene valor.
function ppSuma(valores, campo, re){
  if(!campo) return null;
  const i = ppIdxCol(campo, re);
  if(i < 0) return null;
  const filas = Array.isArray(valores[campo.id]) ? valores[campo.id] : [];
  let s = null;
  for(const f of filas){ const n = ppNum(f && f[i]); if(n != null) s = (s || 0) + n; }
  return s;
}
// ¿Es esta tabla repetible un perfil del suelo? (Inicio, Fin, Tipo de Suelo)
function perfilSueloEsTabla(campo){
  return !!campo && campo.tipo === 'tabla_repetible'
    && ppIdxCol(campo, /inicio/) >= 0 && ppIdxCol(campo, /fin/) >= 0 && ppIdxCol(campo, /tipo de suelo|tipo suelo/) >= 0;
}
// Estratos ordenados {inicio, fin, tipo} en profundidad (m); descarta filas
// no numéricas o con fin ≤ inicio, como el dibujo anterior.
function perfilSueloEstratos(campo, filas){
  if(!perfilSueloEsTabla(campo)) return [];
  const iI = ppIdxCol(campo, /inicio/), iF = ppIdxCol(campo, /fin/), iT = ppIdxCol(campo, /tipo de suelo|tipo suelo/);
  return (Array.isArray(filas) ? filas : [])
    .map(f => ({ inicio: ppNum(f && f[iI]), fin: ppNum(f && f[iF]), tipo: (f && f[iT]) || '' }))
    .filter(e => e.inicio != null && e.fin != null && e.fin > e.inicio)
    .sort((a, b) => a.inicio - b.inicio);
}

// ── Datos del pilote ─────────────────────────────────────────────────────────
// Devuelve siempre un objeto; `pilote` es false cuando la plantilla no tiene
// tabla «Cotas» con «Terreno» (formatos sin pilote o respuestas antiguas sin
// cotas): entonces solo se dibuja el suelo. Cotas en m absolutas, D en m.
function perfilPiloteDatos(campos, valores){
  campos = campos || []; valores = valores || {};
  const tCotas = ppTabla(campos, /cotas/);
  const tDiseno = ppTabla(campos, /diseno/);
  const tPilote = ppTabla(campos, /informacion del pilote/);
  const tConcreto = ppTabla(campos, /^concreto/);
  const tArm = ppTabla(campos, /armadura/);
  const tControl = ppTabla(campos, /control de hormigonado/);
  const tSuelo = campos.find(perfilSueloEsTabla) || null;

  const d = {
    pilote: false,
    estratos: tSuelo ? perfilSueloEstratos(tSuelo, valores[tSuelo.id]) : [],
    CT: null, NF: null, D: null, Dreal: null, CPF: null, CFE: null, CH: null, CC: null, CSA: null, CIA: null, CHsig: null,
    longExc: null, longArm: null,
    arm: { n: null, diam: null, transvTipo: null, transvDiam: null, transvPaso: null },
    volReal: null, volTeoricoAnotado: null,
    inconsistencias: [], rojas: []
  };
  const CT = ppCeldaNum(valores, tCotas, /^terreno/);
  if(!tCotas || CT == null) return d;

  d.pilote = true;
  d.CT = CT;
  d.NF = ppCeldaNum(valores, tCotas, /nivel freatico/);
  d.CH = ppCeldaNum(valores, tCotas, /superior concreto/);
  d.CC = ppCeldaNum(valores, tCotas, /descabezado/);
  d.CSA = ppCeldaNum(valores, tCotas, /superior refuerzo/);
  d.CHsig = ppCeldaNum(valores, tCotas, /dia siguiente/);
  d.D = ppDiametroM(ppCelda(valores, tDiseno, /diametro/, /real/));
  d.Dreal = ppDiametroM(ppCelda(valores, tPilote, /diametro real/) ?? ppCelda(valores, tDiseno, /diametro real/));
  d.CPF = ppCeldaNum(valores, tDiseno, /cota de fondo/);
  d.longExc = ppCeldaNum(valores, tPilote, /longitud de excavacion/);
  // CFE: columna explícita «Fondo real» si existe; si no, CT − longitud excavada.
  d.CFE = ppCeldaNum(valores, tCotas, /fondo real/) ?? (d.longExc != null ? CT - d.longExc : null);
  d.longArm = ppCeldaNum(valores, tArm, /longitud total/);
  // CIA: columna explícita «Cota inferior» si existe; si no, CSA − longitud de la jaula.
  d.CIA = ppCeldaNum(valores, tCotas, /inferior/) ?? ppCeldaNum(valores, tArm, /cota inferior/)
    ?? (d.CSA != null && d.longArm != null ? d.CSA - d.longArm : null);
  // Armadura: columnas de la plantilla V2 («Varillas longitudinales (n)», «Diámetro
  // de varillas», «Diámetro de estribos», «Paso de estribos (cm)») o genéricas
  // («Barras long. (n)», «Ø long. (mm)», «Transversal», «Ø transv. (mm)», «Paso»).
  d.arm.n = ppCeldaNum(valores, tArm, /^(barras|varillas)/);
  d.arm.diam = ppCeldaNum(valores, tArm, /long.*\(mm\)|diametro de varillas/);
  const tt = ppCelda(valores, tArm, /^transversal$/);
  d.arm.transvTipo = tt != null ? String(tt).trim() : (ppIdxCol(tArm, /estribo/) >= 0 ? "estribos" : null);
  d.arm.transvDiam = ppCeldaNum(valores, tArm, /transv.*\(mm\)|diametro de estribos|estribo.*\(mm\)/);
  d.arm.transvPaso = ppCeldaNum(valores, tArm, /paso/);
  d.volTeoricoAnotado = ppCeldaNum(valores, tConcreto, /volumen teorico/);
  d.volReal = ppCeldaNum(valores, tConcreto, /volumen real/) ?? ppSuma(valores, tControl, /concreto parcial/);

  // Inconsistencias: se dibujan igual, la cota se marca en rojo y se anota al pie.
  const inc = (clave, texto) => { d.inconsistencias.push({ clave, texto }); if(!d.rojas.includes(clave)) d.rojas.push(clave); };
  if(d.CIA != null && d.CFE != null && d.CIA < d.CFE - 0.005) inc('CIA', `CIA (${ppFmt(d.CIA)}) por debajo del fondo de excavación CFE (${ppFmt(d.CFE)})`);
  if(d.CSA != null && d.CC != null && d.CSA < d.CC - 0.005) inc('CSA', `CSA (${ppFmt(d.CSA)}) por debajo de la cota de corte CC (${ppFmt(d.CC)})`);
  if(d.CH != null && d.CH > CT + 0.005) inc('CH', `CH (${ppFmt(d.CH)}) por encima del terreno CT (${ppFmt(CT)})`);
  if(d.CH != null && d.CC != null && d.CH < d.CC - 0.005) inc('CH', `hormigón bajo cota de corte: CH (${ppFmt(d.CH)}) < CC (${ppFmt(d.CC)})`);
  if(d.CH != null && d.CFE != null && d.CH < d.CFE - 0.005) inc('CH', `CH (${ppFmt(d.CH)}) por debajo del fondo de excavación CFE (${ppFmt(d.CFE)})`);
  if(d.CFE != null && d.CFE > CT + 0.005) inc('CFE', `CFE (${ppFmt(d.CFE)}) por encima del terreno CT (${ppFmt(CT)})`);
  return d;
}

// Longitudes (m), volúmenes (m³) y sobreconsumo (%) derivados; null donde falte dato.
function perfilPiloteCalculos(d){
  const dif = (a, b) => (a != null && b != null) ? a - b : null;
  const longExc = dif(d.CT, d.CFE);
  const sobre = dif(d.CPF, d.CFE);          // > 0 sobreexcavación, < 0 déficit
  const longHorm = dif(d.CH, d.CFE);
  const desc = dif(d.CH, d.CC);
  const longArm = dif(d.CSA, d.CIA);
  const sobresal = dif(d.CSA, d.CC);
  const Duse = d.Dreal ?? d.D;
  const volTeo = (Duse != null && longHorm != null && longHorm > 0) ? Math.PI * Duse * Duse / 4 * longHorm : null;
  const volReal = d.volReal;
  const sobreconsumo = (volTeo != null && volTeo > 0 && volReal != null) ? (volReal - volTeo) / volTeo * 100 : null;
  return { longExc, sobre, longHorm, desc, longArm, sobresal, Duse, volTeo, volReal, sobreconsumo };
}

// ── Escala vertical compartida ───────────────────────────────────────────────
// y(cota) en px desde el borde superior del área útil (0 = cotaSup, alto = cotaInf).
function perfilEscalaCotas({ cotaSup, cotaInf, alto = PP_ALTO }){
  let sup = Number.isFinite(cotaSup) ? cotaSup : 0;
  let inf = Number.isFinite(cotaInf) ? cotaInf : sup - 1;
  if(!(sup - inf >= 0.5)){ sup += 0.5; inf = sup - 1; }   // rango mínimo de 1 m
  const pxPorM = alto / (sup - inf);
  return { cotaSup: sup, cotaInf: inf, alto, pxPorM, y: cota => (sup - cota) * pxPorM };
}
// Rango de cotas que debe cubrir el dibujo: unión de estratos y cotas del pilote.
function perfilPiloteRango(d){
  const vals = [];
  if(d.pilote){
    for(const k of ['CT', 'NF', 'CPF', 'CFE', 'CH', 'CC', 'CSA', 'CIA', 'CHsig']) if(d[k] != null) vals.push(d[k]);
    if(d.estratos.length) vals.push(d.CT - Math.max(...d.estratos.map(e => e.fin)));
  } else if(d.estratos.length){
    vals.push(0, -Math.max(...d.estratos.map(e => e.fin)));
  }
  if(!vals.length) return { cotaSup: 0, cotaInf: -1 };
  return { cotaSup: Math.max(...vals), cotaInf: Math.min(...vals) };
}
// Reparte textos para que no se superpongan: empuja hacia abajo los que quedan a
// menos de `gap` del anterior y, si el último se sale, recoloca hacia arriba.
// `ys` debe venir ordenado ascendente; devuelve un arreglo nuevo.
function ppRepartir(ys, gap, yMax){
  const r = ys.slice();
  for(let i = 1; i < r.length; i++) if(r[i] - r[i - 1] < gap) r[i] = r[i - 1] + gap;
  if(yMax != null && r.length && r[r.length - 1] > yMax){
    r[r.length - 1] = yMax;
    for(let i = r.length - 2; i >= 0; i--) if(r[i + 1] - r[i] < gap) r[i] = r[i + 1] - gap;
  }
  return r;
}
const ppN = v => Math.round(v * 10) / 10;

// ── SVG ──────────────────────────────────────────────────────────────────────
// Un solo <svg> con dos paneles (suelo | pilote) sobre la misma escala. Sin datos
// de pilote devuelve solo el panel del suelo (ancho PP_ANCHO_SUELO) con las marcas
// en profundidad, equivalente al dibujo anterior.
function perfilSvg(d){
  const soloSuelo = !d.pilote;
  const esc = perfilEscalaCotas(perfilPiloteRango(d));
  const Y = c => PP_MARGEN + esc.y(c);
  const W = soloSuelo ? PP_ANCHO_SUELO : PP_ANCHO_SUELO + PP_ANCHO_PILOTE;
  const H = PP_MARGEN * 2 + PP_ALTO + (soloSuelo ? 0 : 14);
  const CT = soloSuelo ? 0 : d.CT;   // en modo suelo, la «cota» es −profundidad
  const yTop = PP_MARGEN, yBot = PP_MARGEN + PP_ALTO;
  const s = [];

  s.push(`<svg class="pp-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;height:auto;display:block;font-family:Arial,sans-serif">`);
  s.push(`<defs>
    <pattern id="pp-horm" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#ececec"/><circle cx="2" cy="2" r="1" fill="#7a7a7a"/><circle cx="6.5" cy="5.5" r="1" fill="#7a7a7a"/><path d="M3 7.5 L4.5 5 L6 7.5 Z" fill="#9a9a9a"/></pattern>
    <pattern id="pp-desc" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff"/><line x1="0" y1="0" x2="0" y2="6" stroke="#c0392b" stroke-width="1.4"/></pattern>
  </defs>`);
  s.push(`<style>.pp-t{font-size:9px;fill:#323338}.pp-tb{font-size:9px;font-weight:700;fill:#323338}.pp-ts{font-size:8px;fill:#676879}.pp-halo{paint-order:stroke;stroke:#fff;stroke-width:2.5px;stroke-linejoin:round}.pp-rojo{fill:#e2445c}</style>`);

  // Eje de cotas (ticks cada metro; se ralean si no caben)
  const paso = esc.pxPorM >= 11 ? 1 : esc.pxPorM >= 6 ? 2 : 5;
  for(let m = Math.ceil(esc.cotaInf); m <= Math.floor(esc.cotaSup); m++){
    const y = Y(m);
    const mayor = m % paso === 0;
    s.push(`<line x1="${mayor ? 40 : 43}" y1="${ppN(y)}" x2="46" y2="${ppN(y)}" stroke="#676879" stroke-width="0.6"/>`);
    if(mayor) s.push(`<text class="pp-ts" x="38" y="${ppN(y + 3)}" text-anchor="end">${soloSuelo ? (-m) + 'm' : ppFmt(m, 0)}</text>`);
  }
  s.push(`<line x1="46" y1="${yTop}" x2="46" y2="${yBot}" stroke="#676879" stroke-width="0.6"/>`);

  // Líneas compartidas (terreno y nivel freático) cruzan ambos paneles; van
  // debajo de las etiquetas del suelo, que llevan halo blanco.
  if(!soloSuelo){
    s.push(`<line id="pp-ct" x1="46" y1="${ppN(Y(d.CT))}" x2="${W}" y2="${ppN(Y(d.CT))}" stroke="#5b3a1e" stroke-width="1.2"/>`);
    if(d.NF != null){
      s.push(`<line id="pp-nf" x1="46" y1="${ppN(Y(d.NF))}" x2="${W}" y2="${ppN(Y(d.NF))}" stroke="#1e6fd9" stroke-width="1" stroke-dasharray="5 3"/>`);
      s.push(`<text x="${PP_ANCHO_SUELO - 10}" y="${ppN(Y(d.NF) - 1)}" font-size="10" fill="#1e6fd9" text-anchor="middle">▽</text>`);
    }

  }

  // Panel del suelo
  const est = d.estratos;
  if(est.length){
    const fondo = CT - Math.max(...est.map(e => e.fin));
    s.push(`<g id="pp-suelo">`);
    est.forEach((e, i) => {
      const y1 = Y(CT - e.inicio), y2 = Y(CT - e.fin);
      s.push(`<rect class="pp-estrato" data-tipo="${ppEsc(e.tipo)}" x="${PP_COL_X}" y="${ppN(y1)}" width="${PP_COL_ANCHO}" height="${ppN(Math.max(0.5, y2 - y1))}" fill="${colorPorTipoSuelo(e.tipo)}" stroke="rgba(0,0,0,.25)" stroke-width="0.5"/>`);
    });
    s.push(`<rect x="${PP_COL_X}" y="${ppN(Y(CT))}" width="${PP_COL_ANCHO}" height="${ppN(Y(fondo) - Y(CT))}" fill="none" stroke="#999" stroke-width="1"/>`);
    // Etiquetas a la derecha de la columna, repartidas para que no se pisen
    const mids = est.map(e => Y(CT - (e.inicio + e.fin) / 2));
    const ys = ppRepartir(mids, 11, yBot);
    est.forEach((e, i) => {
      s.push(`<path d="M${PP_COL_X + PP_COL_ANCHO} ${ppN(mids[i])} L${PP_COL_X + PP_COL_ANCHO + 6} ${ppN(ys[i])}" stroke="#999" stroke-width="0.5" fill="none"/>`);
      s.push(`<text class="pp-t pp-halo" x="${PP_COL_X + PP_COL_ANCHO + 8}" y="${ppN(ys[i] + 3)}">${ppEsc(e.tipo)} (${ppFmt(e.fin - e.inicio)} m)</text>`);
    });
    s.push(`</g>`);
  }

  if(!soloSuelo){
    const rojo = k => d.rojas.includes(k);
    const col = k => rojo(k) ? '#e2445c' : '#323338';
    const w = Math.max(36, Math.min(90, Math.round((d.Dreal ?? d.D ?? 0.6) * 60)));
    const xL = PP_FUSTE_X - w / 2, xR = PP_FUSTE_X + w / 2;
    const xDim = xL - 10;   // dimensiones (sobreexcavación, sobresaliente) a la izquierda del fuste
    const xTxt = xDim - 4;

    s.push(`<g id="pp-pilote">`);
    const encima = [];   // textos que van sobre todo lo demás del panel
    // Excavación: fuste de CT a CFE
    if(d.CFE != null){
      s.push(`<rect id="pp-fuste" x="${ppN(xL)}" y="${ppN(Y(d.CT))}" width="${w}" height="${ppN(Math.max(0.5, Y(d.CFE) - Y(d.CT)))}" fill="none" stroke="${col('CFE')}" stroke-width="1.2"/>`);
    }
    // Hormigón de CFE a CH; franja CH–CC a descabezar
    if(d.CH != null && d.CFE != null && d.CH > d.CFE){
      s.push(`<rect id="pp-hormigon" x="${ppN(xL + 0.6)}" y="${ppN(Y(d.CH))}" width="${w - 1.2}" height="${ppN(Y(d.CFE) - Y(d.CH))}" fill="url(#pp-horm)"/>`);
    }
    if(d.CH != null && d.CC != null){
      if(d.CH > d.CC + 0.005){
        const y1 = Y(d.CH), y2 = Y(d.CC);
        s.push(`<rect id="pp-descabezar" x="${ppN(xL + 0.6)}" y="${ppN(y1)}" width="${w - 1.2}" height="${ppN(y2 - y1)}" fill="url(#pp-desc)" stroke="#c0392b" stroke-width="0.6"/>`);
        // El texto se dibuja al final del panel para que quede sobre la armadura.
        if(y2 - y1 >= 10) encima.push(`<text class="pp-halo" x="${PP_FUSTE_X}" y="${ppN((y1 + y2) / 2 + 2.5)}" font-size="7.5" fill="#c0392b" text-anchor="middle">a descabezar</text>`);
        else encima.push(`<text x="${ppN(xTxt)}" y="${ppN((y1 + y2) / 2 + 2.5)}" font-size="7.5" fill="#c0392b" text-anchor="end">a descabezar</text>`);
      } else if(d.CH < d.CC - 0.005){
        const y1 = Y(d.CC), y2 = Y(d.CH);
        s.push(`<rect id="pp-hormigon-bajo" x="${ppN(xL + 0.6)}" y="${ppN(y1)}" width="${w - 1.2}" height="${ppN(y2 - y1)}" fill="rgba(226,68,92,.25)" stroke="#e2445c" stroke-width="0.8"/>`);
        s.push(`<text x="${ppN(xTxt)}" y="${ppN((y1 + y2) / 2 + 2.5)}" font-size="7.5" fill="#e2445c" text-anchor="end">hormigón bajo cota de corte</text>`);
      }
    }
    // Cota de fondo de proyecto y sobreexcavación / déficit
    if(d.CPF != null){
      s.push(`<line id="pp-cpf" x1="${ppN(xL - 6)}" y1="${ppN(Y(d.CPF))}" x2="${ppN(xR + 6)}" y2="${ppN(Y(d.CPF))}" stroke="#323338" stroke-width="0.8" stroke-dasharray="2 2"/>`);
      if(d.CFE != null && Math.abs(d.CPF - d.CFE) >= 0.005){
        const y1 = Y(Math.max(d.CPF, d.CFE)), y2 = Y(Math.min(d.CPF, d.CFE));
        const texto = (d.CPF > d.CFE ? 'Sobreexcavación ' : 'Déficit ') + ppFmt(Math.abs(d.CPF - d.CFE)) + ' m';
        s.push(`<g id="pp-sobreexc"><line x1="${ppN(xDim)}" y1="${ppN(y1)}" x2="${ppN(xDim)}" y2="${ppN(y2)}" stroke="#323338" stroke-width="0.6"/>
          <line x1="${ppN(xDim - 3)}" y1="${ppN(y1)}" x2="${ppN(xDim + 3)}" y2="${ppN(y1)}" stroke="#323338" stroke-width="0.6"/>
          <line x1="${ppN(xDim - 3)}" y1="${ppN(y2)}" x2="${ppN(xDim + 3)}" y2="${ppN(y2)}" stroke="#323338" stroke-width="0.6"/>
          <text class="pp-ts pp-halo" x="${ppN(xTxt)}" y="${ppN((y1 + y2) / 2 + 3)}" text-anchor="end">${texto}</text></g>`);
      }
    }
    // Armadura: barras extremas de CIA a CSA con marcas de la espiral / estribos
    if(d.CSA != null && d.CIA != null && d.CSA > d.CIA){
      const bx1 = PP_FUSTE_X - (w / 2 - 7), bx2 = PP_FUSTE_X + (w / 2 - 7);
      const y1 = Y(d.CSA), y2 = Y(d.CIA);
      const pasoPx = Math.max(5, (d.arm.transvPaso != null && d.arm.transvPaso > 0 ? d.arm.transvPaso / 100 : 0.2) * esc.pxPorM);
      s.push(`<g id="pp-armadura" stroke="#8a1c1c">`);
      let n = 0;
      for(let y = y1 + pasoPx; y < y2 && n < 400; y += pasoPx, n++) s.push(`<line x1="${ppN(bx1)}" y1="${ppN(y)}" x2="${ppN(bx2)}" y2="${ppN(y - 3)}" stroke-width="0.7"/>`);
      s.push(`<line x1="${ppN(bx1)}" y1="${ppN(y1)}" x2="${ppN(bx1)}" y2="${ppN(y2)}" stroke-width="2.5"/>`);
      s.push(`<line x1="${ppN(bx2)}" y1="${ppN(y1)}" x2="${ppN(bx2)}" y2="${ppN(y2)}" stroke-width="2.5"/>`);
      s.push(`</g>`);
      const L = ppFmt(d.CSA - d.CIA);
      const l1 = (d.arm.n != null && d.arm.diam != null) ? `${ppFmt(d.arm.n, 0)} Ø ${ppFmt(d.arm.diam, 0)} mm · L = ${L} m` : `Armadura L = ${L} m`;
      const l2 = d.arm.transvDiam != null ? `${(d.arm.transvTipo || 'espiral').toLowerCase()} Ø ${ppFmt(d.arm.transvDiam, 0)}${d.arm.transvPaso != null ? ' @ ' + ppFmt(d.arm.transvPaso, 0) + ' cm' : ''}` : '';
      let ya = y1 + (y2 - y1) * 0.42;
      if(d.NF != null && Math.abs(ya - Y(d.NF)) < 14) ya += 16;   // no pisar la línea del NF
      s.push(`<text id="pp-armadura-etq" class="pp-ts pp-halo" style="fill:#8a1c1c" x="${ppN(xTxt)}" y="${ppN(ya)}" text-anchor="end">${ppEsc(l1)}${l2 ? `<tspan x="${ppN(xTxt)}" dy="10">${ppEsc(l2)}</tspan>` : ''}</text>`);
      // Sobresaliente para el cabezal: tramo de armadura sobre la cota de corte
      if(d.CC != null && d.CSA > d.CC + 0.005){
        const ys1 = Y(d.CSA), ys2 = Y(d.CC);
        s.push(`<g id="pp-sobresal"><line x1="${ppN(xDim)}" y1="${ppN(ys1)}" x2="${ppN(xDim)}" y2="${ppN(ys2)}" stroke="#8a1c1c" stroke-width="0.6"/>
          <line x1="${ppN(xDim - 3)}" y1="${ppN(ys1)}" x2="${ppN(xDim + 3)}" y2="${ppN(ys1)}" stroke="#8a1c1c" stroke-width="0.6"/>
          <line x1="${ppN(xDim - 3)}" y1="${ppN(ys2)}" x2="${ppN(xDim + 3)}" y2="${ppN(ys2)}" stroke="#8a1c1c" stroke-width="0.6"/>
          <text class="pp-ts pp-halo" style="fill:#8a1c1c" x="${ppN(xTxt)}" y="${ppN((ys1 + ys2) / 2 + 3)}" text-anchor="end">Sobresal. ${ppFmt(d.CSA - d.CC)} m</text></g>`);
      }
    }
    // Concreto al día siguiente: marca fina
    if(d.CHsig != null){
      s.push(`<line id="pp-chsig" x1="${ppN(xL)}" y1="${ppN(Y(d.CHsig))}" x2="${ppN(xR)}" y2="${ppN(Y(d.CHsig))}" stroke="#676879" stroke-width="0.6" stroke-dasharray="1 2"/>`);
    }
    s.push(...encima);
    s.push(`</g>`);

    // Cotas al borde derecho: línea de referencia en su posición real, texto
    // desplazado si dos cotas caen a menos de PP_GAP_TEXTO px.
    const lista = [
      ['CT', d.CT], ['NF', d.NF], ['CPF', d.CPF], ['CFE', d.CFE], ['CH', d.CH], ['CC', d.CC], ['CSA', d.CSA], ['CIA', d.CIA], ['CH+1', d.CHsig]
    ].filter(c => c[1] != null).map(c => ({ clave: c[0], cota: c[1], y: Y(c[1]) })).sort((a, b) => a.y - b.y);
    const yTexto = ppRepartir(lista.map(c => c.y), PP_GAP_TEXTO, yBot + 10);
    s.push(`<g id="pp-cotas">`);
    lista.forEach((c, i) => {
      const yt = yTexto[i];
      const color = c.clave === 'NF' ? '#1e6fd9' : col(c.clave);
      if(c.clave !== 'CT' && c.clave !== 'NF') s.push(`<line x1="${ppN(xR)}" y1="${ppN(c.y)}" x2="${PP_COTAS_X}" y2="${ppN(c.y)}" stroke="${color}" stroke-width="0.5"/>`);
      if(Math.abs(yt - c.y) > 0.5) s.push(`<path d="M${PP_COTAS_X} ${ppN(c.y)} L${PP_COTAS_X + 4} ${ppN(yt)}" stroke="${color}" stroke-width="0.5" fill="none"/>`);
      s.push(`<text class="pp-cota" data-clave="${c.clave}" x="${PP_COTAS_X + 6}" y="${ppN(yt + 3)}" font-size="9" fill="${color}"><tspan font-weight="700">${c.clave}</tspan><tspan x="${PP_COTAS_X + 36}">${ppFmt(c.cota)}</tspan></text>`);
    });
    s.push(`</g>`);
    s.push(`<text class="pp-ts" x="${W}" y="${H - 4}" text-anchor="end">Sin escala horizontal · cotas en m</text>`);
  }
  s.push(`</svg>`);
  return s.join('\n');
}

// ── Leyendas, tabla y bloque completo ────────────────────────────────────────
function perfilLeyendaSuelo(estratos){
  const tipos = [...new Set(estratos.map(e => e.tipo))];
  if(!tipos.length) return '';
  return `<div class="pp-leyenda-suelo"><div style="font-size:11px;font-weight:700;margin-bottom:6px">Leyenda — Tipos de suelo</div>${tipos.map(t => `
    <div style="display:flex;align-items:center;gap:5px;font-size:10px;margin-bottom:3px">
      <span style="width:12px;height:12px;background:${colorPorTipoSuelo(t)};border-radius:2px;display:inline-block;-webkit-print-color-adjust:exact;print-color-adjust:exact"></span> ${ppEsc(t)}
    </div>`).join('')}</div>`;
}
function perfilLeyendaPilote(){
  const sw = (inner, defs = '') => `<svg width="22" height="12" viewBox="0 0 22 12" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle">${defs}${inner}</svg>`;
  const items = [
    ['Excavación', sw(`<rect x="1" y="1" width="20" height="10" fill="none" stroke="#323338" stroke-width="1.2"/>`)],
    ['Hormigón', sw(`<rect x="1" y="1" width="20" height="10" fill="url(#pp-horm-l)" stroke="#323338" stroke-width="0.6"/>`,
      `<defs><pattern id="pp-horm-l" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#ececec"/><circle cx="2" cy="2" r="1" fill="#7a7a7a"/><circle cx="6.5" cy="5.5" r="1" fill="#7a7a7a"/><path d="M3 7.5 L4.5 5 L6 7.5 Z" fill="#9a9a9a"/></pattern></defs>`)],
    ['A descabezar', sw(`<rect x="1" y="1" width="20" height="10" fill="url(#pp-desc-l)" stroke="#c0392b" stroke-width="0.6"/>`,
      `<defs><pattern id="pp-desc-l" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff"/><line x1="0" y1="0" x2="0" y2="6" stroke="#c0392b" stroke-width="1.4"/></pattern></defs>`)],
    ['Armadura', sw(`<line x1="6" y1="1" x2="6" y2="11" stroke="#8a1c1c" stroke-width="2.5"/><line x1="16" y1="1" x2="16" y2="11" stroke="#8a1c1c" stroke-width="2.5"/><line x1="6" y1="4" x2="16" y2="2" stroke="#8a1c1c" stroke-width="0.7"/><line x1="6" y1="8" x2="16" y2="6" stroke="#8a1c1c" stroke-width="0.7"/>`)],
    ['Nivel freático (NF)', sw(`<line x1="0" y1="6" x2="22" y2="6" stroke="#1e6fd9" stroke-width="1" stroke-dasharray="5 3"/>`)],
    ['Fondo de proyecto (CPF)', sw(`<line x1="0" y1="6" x2="22" y2="6" stroke="#323338" stroke-width="0.8" stroke-dasharray="2 2"/>`)]
  ];
  return `<div class="pp-leyenda-pilote" style="display:flex;flex-wrap:wrap;gap:4px 14px;font-size:10px;margin-top:4px">${items.map(([t, i]) => `<span style="display:inline-flex;align-items:center;gap:4px">${i} ${t}</span>`).join('')}</div>`;
}
// Tabla derivada en dos pares de columnas para que quepa en A4 con el dibujo.
function perfilPiloteTabla(d){
  const c = perfilPiloteCalculos(d);
  const m = v => c && v != null ? ppFmt(v) + ' m' : '—';
  const sobre = c.sobre == null ? '—' : ppFmt(c.sobre, 2, true) + ' m' + (c.sobre > 0.005 ? ' (sobreexcavación)' : c.sobre < -0.005 ? ' (déficit)' : '');
  const volTeo = c.volTeo == null ? '—' : `${ppFmt(c.volTeo)} m³ <span style="color:#676879">(D = ${ppFmt(c.Duse)} m${d.Dreal != null ? ' real' : ''}, L = ${ppFmt(c.longHorm)} m)</span>`;
  const volReal = c.volReal == null ? '—' : `${ppFmt(c.volReal)} m³` + (c.sobreconsumo == null ? '' : ` · ${ppFmt(c.sobreconsumo, 1, true)} %`)
    + (d.volTeoricoAnotado != null ? ` <span style="color:#676879">(teórico anotado ${ppFmt(d.volTeoricoAnotado)} m³)</span>` : '');
  const filas = [
    ['Longitud excavada (CT − CFE)', m(c.longExc), 'Longitud de armadura (CSA − CIA)', m(c.longArm)],
    ['Sobreexcavación / déficit (CPF − CFE)', sobre, 'Sobresaliente de armadura (CSA − CC)', m(c.sobresal)],
    ['Longitud de hormigón (CH − CFE)', m(c.longHorm), 'Volumen teórico π·D²/4·(CH − CFE)', volTeo],
    ['Hormigón a descabezar (CH − CC)', m(c.desc), 'Volumen real / sobreconsumo', volReal]
  ];
  const td = 'border:1px solid #ccc;padding:3px 5px;font-size:10px';
  return `<table class="pp-tabla" style="width:100%;border-collapse:collapse;margin-top:6px;table-layout:fixed">
    <colgroup><col style="width:30%"/><col style="width:20%"/><col style="width:28%"/><col style="width:22%"/></colgroup>
    ${filas.map(f => `<tr><td style="${td};background:#f5f6f8">${f[0]}</td><td style="${td};text-align:right;white-space:nowrap">${f[1]}</td><td style="${td};background:#f5f6f8">${f[2]}</td><td style="${td};text-align:right">${f[3]}</td></tr>`).join('')}
  </table>`;
}

// Bloque completo para el PDF del formato. `campo` es la tabla repetible que se
// está imprimiendo: solo produce salida si es un perfil del suelo (como antes).
// Devuelve '' o { html, soloSuelo }.
function generarDibujoPerfilPilote(campo, filas, campos, valores){
  if(!perfilSueloEsTabla(campo)) return '';
  const d = perfilPiloteDatos(campos, valores);
  d.estratos = perfilSueloEstratos(campo, filas);
  if(!d.estratos.length && !d.pilote) return '';
  if(!d.pilote){
    // Igual que el dibujo anterior: columna con marcas por metro y leyenda al lado.
    return { soloSuelo: true, html: `<div class="pp-bloque" style="display:flex;gap:20px;align-items:flex-start;margin-top:10px;break-inside:avoid;page-break-inside:avoid">
      ${perfilSvg(d)}
      ${perfilLeyendaSuelo(d.estratos)}
    </div>` };
  }
  const notas = d.inconsistencias.length
    ? `<div class="pp-notas" style="font-size:9.5px;color:#e2445c;margin-top:4px">${d.inconsistencias.map(i => `<div>⚠ ${ppEsc(i.texto)}</div>`).join('')}</div>` : '';
  return { soloSuelo: false, html: `<div class="pp-bloque" style="margin-top:10px;break-inside:avoid;page-break-inside:avoid">
    <div style="font-size:11px;font-weight:700;margin-bottom:4px">Perfil estratigráfico y perfil del pilote (misma escala vertical)</div>
    ${perfilSvg(d)}
    <div style="display:flex;gap:24px;align-items:flex-start;margin-top:6px">
      ${perfilLeyendaSuelo(d.estratos)}
      <div style="flex:1">${perfilLeyendaPilote()}</div>
    </div>
    ${perfilPiloteTabla(d)}
    ${notas}
  </div>` };
}
