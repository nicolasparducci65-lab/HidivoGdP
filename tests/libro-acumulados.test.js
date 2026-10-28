// Acumulados "a la fecha" del Libro de Obra: ejecuta las funciones REALES de index.html
// (acumuladosLibroPorRegistro, compararRegistrosLibro, cargarFilasAcumuladosLibro,
// obtenerAcumuladosLibro, htmlDetalleRubroLibro y verDetalleLibro) contra un fixture sintético
// construido aquí y contra parqueadero.real.json si está presente (está en .gitignore).
//
//   node libro-acumulados.test.js
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, leer, scriptPrincipal, extraerConst, fuenteSiExiste, crearSb, crearContexto, cargarFixture, prueba, resumen, assert } = require('./lib/arnes');

const src = scriptPrincipal(leer(path.join(RAIZ, 'index.html')));
// escAttr y climaIcon viven en expediente.js; el resto en el script principal de index.html.
const FUNCIONES = ['numeroRef', 'fmtCantidadRef', 'escAttr', 'redondear4Libro', 'compararRegistrosLibro', 'acumuladosLibroPorRegistro',
  'cargarFilasAcumuladosLibro', 'obtenerAcumuladosLibro', 'traerPaginado', 'pendientesPorRubroLibro', 'htmlDetalleRubroLibro', 'verDetalleLibro', 'climaIcon'];
const CODIGO = [leer(path.join(RAIZ, 'constantes.js')), leer(path.join(RAIZ, 'expediente.js')), extraerConst(src, '_libroAcumulados'), ...FUNCIONES.map(f => fuenteSiExiste(src, f))].join('\n');

// ── Fixture sintético ───────────────────────────────────────────────────────
// Proyecto inventado. Rubros: R1 contractual (contrato 100), R2 contractual (contrato 0: sin
// cantidad contractual), ROC nacido de una orden de cambio con contrato VIGENTE 150 (el firmado,
// 100, va en cantidad_contractual y NO debe usarse). Registros, en orden de corte esperado:
//   A  2026-07-10 N°1  → R1 10
//   B  2026-07-10 N°2  → R1 20, ROC 50                (mismo día que A: manda el número)
//   C  2026-07-16 N°38 → R1 5                          (fecha anterior a D pero número mayor)
//   D  2026-07-17 N°37 → R1 15, R2 7                   (incluye lo de C: comportamiento deseado)
//   E  2026-07-20 null → R1 1                          (sin número: último de su fecha)
//   F  2026-07-20 N°40 → R1 2                          (va ANTES que E aunque se creó después)
//   G  2026-07-25 N°41 created 09:00 → R1 0.1          (misma fecha y mismo número que H:
//   H  2026-07-25 N°41 created 10:00 → R1 0.2           desempata created_at)
//   X  2026-07-12 N°3  → R1 1000  ELIMINADO: sus filas no existen (no hay anulación en la app)
const P = 'a1000000-0000-4000-8000-000000000001';
const R1 = 'f1000000-0000-4000-8000-000000000001', R2 = 'f1000000-0000-4000-8000-000000000002', ROC = 'f1000000-0000-4000-8000-000000000003';
const reg = (k, fecha, numero, created) => ({ id: '90000000-0000-4000-8000-00000000000' + k, proyecto_id: P, fecha, numero_registro: numero, created_at: created, estado_aprobacion: 'pendiente' });
const REGS = {
  A: reg('a', '2026-07-10', 1, '2026-07-10T20:00:00+00:00'),
  B: reg('b', '2026-07-10', 2, '2026-07-10T21:00:00+00:00'),
  C: reg('c', '2026-07-16', 38, '2026-07-16T22:00:00+00:00'),
  D: reg('d', '2026-07-17', 37, '2026-07-17T22:00:00+00:00'),
  E: reg('e', '2026-07-20', null, '2026-07-20T20:00:00+00:00'),
  F: reg('f', '2026-07-20', 40, '2026-07-20T23:00:00+00:00'),
  G: reg('g', '2026-07-25', 41, '2026-07-25T09:00:00+00:00'),
  H: reg('h', '2026-07-25', 41, '2026-07-25T10:00:00+00:00'),
};
REGS.A.estado_aprobacion = 'aprobado'; REGS.D.estado_aprobacion = 'observado';
const RUBROS = [
  { id: R1, proyecto_id: P, codigo: '1', descripcion: 'Excavación', unidad: 'm3', cantidad_contrato: 100, cantidad_ejecutada: 53.3, es_orden_cambio: false },
  { id: R2, proyecto_id: P, codigo: '2', descripcion: 'Global sin cantidad', unidad: 'gbl', cantidad_contrato: 0, cantidad_ejecutada: 7, es_orden_cambio: false },
  { id: ROC, proyecto_id: P, codigo: 'OC-01-01', descripcion: 'Rubro de orden de cambio', unidad: 'm', cantidad_contrato: 150, cantidad_contractual: 100, cantidad_ejecutada: 50, es_orden_cambio: true },
];
let seq = 0;
const fila = (r, rubro, q) => ({ id: '92000000-0000-4000-8000-' + String(++seq).padStart(12, '0'), registro_id: r.id, rubro_id: rubro, cantidad_dia: q, observacion: null });
const FILAS = [
  fila(REGS.A, R1, 10),
  fila(REGS.B, R1, 20), fila(REGS.B, ROC, 50),
  fila(REGS.C, R1, 5),
  fila(REGS.D, R1, 15), fila(REGS.D, R2, 7),
  fila(REGS.E, R1, 1),
  fila(REGS.F, R1, 2),
  fila(REGS.G, R1, 0.1),
  fila(REGS.H, R1, 0.2),
];
// El registro X existió con R1 = 1000 y fue eliminado: la app borra físicamente (CASCADE), así que
// ni el registro ni sus filas llegan a la consulta. Se representa no incluyéndolo.
const X_ELIMINADO = { registro: reg('x', '2026-07-12', 3, '2026-07-12T20:00:00+00:00'), filas: [{ id: '92000000-0000-4000-8000-ffffffffffff', registro_id: '90000000-0000-4000-8000-00000000000x', rubro_id: R1, cantidad_dia: 1000 }] };
const FIXTURE = { proyectos: [{ id: P, nombre: 'Proyecto sintético' }], libro_obra: Object.values(REGS), libro_obra_rubros: FILAS, rubros: RUBROS, libro_obra_fotos: [] };

// Lo que devuelve la consulta real (embeds libro_obra!inner y rubros!inner), armado a mano.
function filasConEmbeds(fx){
  const regs = new Map(fx.libro_obra.map(r => [r.id, r])), rubs = new Map(fx.rubros.map(r => [r.id, r]));
  return fx.libro_obra_rubros.map(f => ({ ...f, libro_obra: regs.get(f.registro_id), rubros: rubs.get(f.rubro_id) })).filter(f => f.libro_obra && f.rubros);
}
const get = (mapa, r, rubro) => mapa.get(r.id) && mapa.get(r.id).get(rubro);

// sb del arnés que, cuando `condicion(tabla, builder)` es cierta, responde {data:null, error} como
// hace supabase-js ante 401/5xx/sin red (no lanza). Cada fallo queda en sb.llamadas con error:true.
function sbConFallos(fixture, condicion){
  const sb = crearSb(fixture);
  const from0 = sb.from;
  sb.from = tabla => {
    const b = from0(tabla), ejecutar = b._ejecutar;
    b._ejecutar = () => {
      if(!condicion(tabla, b)) return ejecutar();
      sb.llamadas.push({ tabla, select: b._select, filtros: b._filtros.length, rango: b._rango, error: true });
      return { data: null, error: { message: 'JWT expired', code: 'PGRST301' } };
    };
    return b;
  };
  return sb;
}
const consolaSinError = { log: console.log, warn: console.warn, error: () => {} };

(async () => {
  console.log('libro-acumulados.test.js');
  const ctx = crearContexto({ codigo: [CODIGO] });
  const acumular = ctx.acumuladosLibroPorRegistro, comparar = ctx.compararRegistrosLibro;

  await prueba('orden de corte: fecha, número (null último), created_at, id', () => {
    const orden = Object.values(REGS).map(r => ({ id: r.id, fecha: r.fecha, numero: r.numero_registro, created_at: r.created_at })).sort(comparar).map(r => r.id.slice(-1));
    assert(orden.join('') === 'abcdfegh', 'orden obtenido ' + orden.join(''));
    // empate total salvo id
    const t = [{ id: 'z', fecha: '2026-01-01', numero: 1, created_at: 'x' }, { id: 'a', fecha: '2026-01-01', numero: 1, created_at: 'x' }].sort(comparar).map(r => r.id);
    assert(t.join('') === 'az', 'desempate por id: ' + t.join(''));
  });

  const mapa = acumular(filasConEmbeds(FIXTURE));

  await prueba('dos registros del mismo día: N°2 acumula lo de N°1 (D1: incluye el propio registro)', () => {
    assert(get(mapa, REGS.A, R1).acumulado === 10 && get(mapa, REGS.A, R1).saldo === 90, 'A: ' + JSON.stringify(get(mapa, REGS.A, R1)));
    assert(get(mapa, REGS.B, R1).acumulado === 30 && get(mapa, REGS.B, R1).saldo === 70 && get(mapa, REGS.B, R1).enRegistro === 20, 'B: ' + JSON.stringify(get(mapa, REGS.B, R1)));
  });

  await prueba('un rubro en varios registros: la suma corre por fecha y el N°37 ya incluye al N°38 (D2)', () => {
    assert(get(mapa, REGS.C, R1).acumulado === 35, 'C (N°38, 16-jul): ' + get(mapa, REGS.C, R1).acumulado);
    assert(get(mapa, REGS.D, R1).acumulado === 50 && get(mapa, REGS.D, R1).saldo === 50, 'D (N°37, 17-jul): ' + JSON.stringify(get(mapa, REGS.D, R1)));
    assert(get(mapa, REGS.F, R1).acumulado === 52, 'F (N°40) va antes que E (sin número): ' + get(mapa, REGS.F, R1).acumulado);
    assert(get(mapa, REGS.E, R1).acumulado === 53, 'E (sin número, último de su fecha): ' + get(mapa, REGS.E, R1).acumulado);
    assert(get(mapa, REGS.G, R1).acumulado === 53.1 && get(mapa, REGS.H, R1).acumulado === 53.3, 'G/H desempatan por created_at y redondean a 4 decimales: ' + get(mapa, REGS.G, R1).acumulado + ' / ' + get(mapa, REGS.H, R1).acumulado);
    // El último registro válido del rubro coincide con la suma total (misma regla que la verificación cruzada)
    const total = FILAS.filter(f => f.rubro_id === R1).reduce((s, f) => s + f.cantidad_dia, 0);
    assert(get(mapa, REGS.H, R1).acumulado === Math.round(total * 1e4) / 1e4 && get(mapa, REGS.H, R1).acumulado === RUBROS[0].cantidad_ejecutada, 'último = suma = cantidad_ejecutada');
  });

  await prueba('el estado de aprobación no cambia nada: aprobado, observado y pendiente suman igual (D3)', () => {
    const fx = JSON.parse(JSON.stringify(FIXTURE));
    fx.libro_obra.forEach(r => { r.estado_aprobacion = 'aprobado'; });
    const m2 = acumular(filasConEmbeds(fx));
    for(const r of Object.values(REGS)) for(const rubro of [R1, R2, ROC]){
      const a = get(mapa, r, rubro), b = get(m2, r, rubro);
      assert((a && a.acumulado) === (b && b.acumulado), 'difiere en ' + r.id + ' ' + rubro);
    }
  });

  await prueba('un registro eliminado no suma: sus filas ya no existen y el mapa ni lo conoce', () => {
    assert(!mapa.has(X_ELIMINADO.registro.id), 'X no debe estar en el mapa');
    assert(get(mapa, REGS.D, R1).acumulado === 50, 'sin X, D acumula 50 (con X serían 1050)');
    // Si las filas de X SÍ llegaran (no eliminado), sumarían: la función no decide por estado ni por nada más
    const conX = acumular(filasConEmbeds({ ...FIXTURE, libro_obra: [...FIXTURE.libro_obra, X_ELIMINADO.registro], libro_obra_rubros: [...FILAS, ...X_ELIMINADO.filas] }));
    assert(get(conX, REGS.D, R1).acumulado === 1050, 'con X presente D acumula 1050');
  });

  await prueba('rubro de OC: el saldo usa el contrato VIGENTE (150), no el firmado (100)', () => {
    const e = get(mapa, REGS.B, ROC);
    assert(e.acumulado === 50 && e.contrato === 150 && e.saldo === 100, JSON.stringify(e));
  });

  await prueba('rubro sin cantidad contractual: saldo null', () => {
    const e = get(mapa, REGS.D, R2);
    assert(e.acumulado === 7 && e.contrato === 0 && e.saldo === null, JSON.stringify(e));
  });

  await prueba('cargarFilasAcumuladosLibro: una consulta por proyecto (paginada) con los embeds; obtenerAcumuladosLibro cachea y comparte la carga', async () => {
    const sb = crearSb(JSON.parse(JSON.stringify(FIXTURE)));
    const c = crearContexto({ codigo: [CODIGO], globals: { sb } });
    const filas = await c.cargarFilasAcumuladosLibro(P);
    assert(filas.length === FILAS.length, 'filas ' + filas.length);
    assert(filas.every(f => f.libro_obra && f.libro_obra.fecha && f.rubros && 'cantidad_contrato' in f.rubros), 'embeds presentes');
    // El sb simulado incrusta la fila relacionada completa sin mirar las columnas pedidas, así que
    // lo que garantiza que la consulta real traiga lo que usa el mapa es el texto del select.
    const sel = sb.llamadas.find(l => l.tabla === 'libro_obra_rubros').select;
    const cols = s => s.split(',').map(x => x.trim()).filter(Boolean);
    const embed = alias => { const m = sel.match(new RegExp(alias + '!inner\\(([^)]*)\\)')); return m ? cols(m[1]) : []; };
    const base = cols(sel.replace(/\w+!inner\([^)]*\)/g, ''));
    assert(['registro_id', 'rubro_id', 'cantidad_dia'].every(c => base.includes(c)), 'columnas base del select: ' + sel);
    assert(['fecha', 'numero_registro', 'created_at', 'proyecto_id'].every(c => embed('libro_obra').includes(c)), 'libro_obra!inner debe traer fecha, numero_registro y created_at (orden de corte D2): ' + sel);
    assert(embed('rubros').includes('cantidad_contrato'), 'rubros!inner debe traer cantidad_contrato: ' + sel);
    assert(sb.llamadas.filter(l => l.tabla === 'libro_obra_rubros').length === 1, 'una sola página para ' + FILAS.length + ' filas');
    const [m1, m2] = await Promise.all([c.obtenerAcumuladosLibro(P), c.obtenerAcumuladosLibro(P)]);
    assert(m1 === m2, 'cargas simultáneas comparten la promesa');
    assert(sb.llamadas.filter(l => l.tabla === 'libro_obra_rubros').length === 2, 'solo una consulta más para el mapa');
    const m3 = await c.obtenerAcumuladosLibro(P);
    assert(m3 === m1 && sb.llamadas.filter(l => l.tabla === 'libro_obra_rubros').length === 2, 'segunda lectura sin consulta');
    assert(get(m1, REGS.D, R1).acumulado === 50, 'mismo resultado que el cálculo directo');
    // otro proyecto invalida
    await c.obtenerAcumuladosLibro('otro');
    assert(c._eval('_libroAcumuladosProyecto') === 'otro' && c._eval('_libroAcumulados').size === 0, 'cambio de proyecto');
  });

  await prueba('fallo de la consulta del mapa: obtenerAcumuladosLibro rechaza, no cachea nada y la siguiente lectura reintenta', async () => {
    let fallos = 1;
    const sb = sbConFallos(JSON.parse(JSON.stringify(FIXTURE)), (tabla, b) => tabla === 'libro_obra_rubros' && String(b._select).includes('libro_obra!inner') && fallos-- > 0);
    const c = crearContexto({ codigo: [CODIGO], globals: { sb, console: consolaSinError } });
    const delMapa = () => sb.llamadas.filter(l => l.tabla === 'libro_obra_rubros' && l.select.includes('libro_obra!inner'));
    let err = null;
    try{ await c.obtenerAcumuladosLibro(P); }catch(e){ err = e; }
    assert(err && err.message === 'JWT expired', 'debe rechazar con el error de la consulta, no resolver con un Map vacío: ' + (err && err.message));
    assert(c._eval('_libroAcumulados') === null && c._eval('_libroAcumuladosPromesa') === null, 'nada cacheado tras el fallo');
    assert(delMapa().length === 1 && delMapa()[0].error === true, 'una consulta, fallida');
    // Vuelve la red: la siguiente lectura reintenta (no sirve la caché) y resuelve con los valores correctos
    const m = await c.obtenerAcumuladosLibro(P);
    assert(delMapa().length === 2 && get(m, REGS.D, R1).acumulado === 50 && c._eval('_libroAcumulados') === m, 'reintento con red: ' + delMapa().length);
    // Página 2 fallida: en modo estricto rechaza (nada parcial); por defecto sigue devolviendo lo leído (otros usos de traerPaginado)
    let fallosP2 = 2;
    const sb2 = sbConFallos(JSON.parse(JSON.stringify(FIXTURE)), (tabla, b) => tabla === 'libro_obra_rubros' && b._rango && b._rango[0] > 0 && fallosP2-- > 0);
    const c2 = crearContexto({ codigo: [CODIGO], globals: { sb: sb2, console: consolaSinError } });
    const consulta = () => sb2.from('libro_obra_rubros').select('id,registro_id').order('id');
    let err2 = null;
    try{ await c2.traerPaginado(consulta, 4, true); }catch(e){ err2 = e; }
    assert(err2 && err2.message === 'JWT expired', 'estricto: rechaza al fallar la página 2');
    const parcial = await c2.traerPaginado(consulta, 4);
    assert(parcial.length === 4 && fallosP2 === 0, 'por defecto devuelve lo leído hasta el fallo: ' + parcial.length);
  });

  await prueba('htmlDetalleRubroLibro: línea D4 con title por parte, % y saldos solo con contrato, ámbar si hoy supera', () => {
    const h = ctx.htmlDetalleRubroLibro({ unidad: 'u', contrato: 100, cantidad: 10, ejecutada: 95, pendiente: 8, aLaFecha: { acumulado: 40, saldo: 60, enRegistro: 10 } });
    const txt = h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
    assert(txt === 'Contrato: 100 u · Anterior: 30 u · Este registro: 10 u · Acum. a la fecha: 40 u (40 %) · Saldo a la fecha: 60 u  |  Acum. hoy: 95 u (8 u por aprobar) · Saldo hoy: 5 u', txt);
    assert((h.match(/title="/g) || []).length === 7 && h.includes('color:#676879') && !h.includes('#b8860b'), 'titles y color gris');
    const h2 = ctx.htmlDetalleRubroLibro({ unidad: 'm³', contrato: 158.4, cantidad: 77.76, ejecutada: 199.2, pendiente: 0, aLaFecha: { acumulado: 121.44, saldo: 36.96, enRegistro: 77.76 } });
    const t2 = h2.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
    assert(t2.endsWith('Acum. hoy: 199,2 m³ · Saldo hoy: -40,8 m³ · ⚠ Supera el contrato en 40,8 m³') && t2.includes('Anterior: 43,68 m³ · Este registro: 77,76 m³ · Acum. a la fecha: 121,44 m³ (76,7 %) · Saldo a la fecha: 36,96 m³'), t2);
    assert(h2.includes('#b8860b') && h2.includes('#fdf6e3'), 'ámbar');
    const h3 = ctx.htmlDetalleRubroLibro({ unidad: 'gbl', contrato: 0, cantidad: 7, ejecutada: 7, pendiente: 0, aLaFecha: { acumulado: 7, saldo: null, enRegistro: 7 } });
    const t3 = h3.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
    assert(t3 === 'Sin cantidad contractual · Anterior: 0 gbl · Este registro: 7 gbl · Acum. a la fecha: 7 gbl  |  Acum. hoy: 7 gbl' && !t3.includes('%'), t3);
    const h4 = ctx.htmlDetalleRubroLibro({ unidad: 'u', contrato: 100, cantidad: 10, ejecutada: 95, pendiente: 0, aLaFecha: null });
    const t4 = h4.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
    assert(t4 === 'Contrato: 100 u · Anterior: — · Este registro: 10 u · Acum. a la fecha: — · Saldo a la fecha: —  |  Acum. hoy: 95 u · Saldo hoy: 5 u', t4);
    // OC aprobada por otro usuario después de cargar el mapa (contrato 100 → 150): el saldo a la fecha
    // sigue al contrato que se muestra, no al a.saldo del mapa (Contrato − Acum. = Saldo en la misma línea)
    const h5 = ctx.htmlDetalleRubroLibro({ unidad: 'u', contrato: 150, cantidad: 50, ejecutada: 50, pendiente: 0, aLaFecha: { acumulado: 50, saldo: 50, contrato: 100, enRegistro: 50 } });
    const t5 = h5.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
    assert(t5 === 'Contrato: 150 u · Anterior: 0 u · Este registro: 50 u · Acum. a la fecha: 50 u (33,3 %) · Saldo a la fecha: 100 u  |  Acum. hoy: 50 u · Saldo hoy: 100 u', t5);
  });

  await prueba('verDetalleLibro (real, en jsdom): la línea del rubro usa el mapa y el pendiente de todos los registros no aprobados (este incluido)', async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="toast"></div><div class="modal-overlay" id="modalDetalleLibro"><div class="modal-body" id="detalleLibroBody"></div></div></body></html>', { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only' });
    const w = dom.window;
    w.sb = crearSb(JSON.parse(JSON.stringify(FIXTURE)));
    w.badgeAprobacionLibro = () => ''; w.toast = () => {}; w.console = console;
    w.eval(CODIGO);
    await w.verDetalleLibro(REGS.D.id);
    const html = w.document.getElementById('detalleLibroBody').innerHTML;
    const txt = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
    // R1 en D: a la fecha 50 (35 anteriores + 15); hoy 53,3; pendiente de aprobación en los registros no
    // aprobados, D (observado) incluido: 20+5+15+1+2+0,1+0,2 = 43,3 (solo A está aprobado: 53,3 − 10)
    assert(txt.includes('Contrato: 100 m3 · Anterior: 35 m3 · Este registro: 15 m3 · Acum. a la fecha: 50 m3 (50 %) · Saldo a la fecha: 50 m3  |  Acum. hoy: 53,3 m3 (43,3 m3 por aprobar) · Saldo hoy: 46,7 m3'), txt);
    // R2 solo está en D (observado): todo lo de hoy está por aprobar
    assert(txt.includes('Sin cantidad contractual · Anterior: 0 gbl · Este registro: 7 gbl · Acum. a la fecha: 7 gbl  |  Acum. hoy: 7 gbl (7 gbl por aprobar)'), txt);
    assert(w.document.getElementById('modalDetalleLibro').classList.contains('show'), 'modal abierto');
    assert(w.sb.llamadas.filter(l => l.tabla === 'libro_obra_rubros' && l.select.includes('libro_obra!inner')).length === 1, 'el mapa se cargó con una sola consulta por proyecto');
    // Segundo registro abierto: el mapa ya está, no se vuelve a consultar
    await w.verDetalleLibro(REGS.B.id);
    assert(w.sb.llamadas.filter(l => l.tabla === 'libro_obra_rubros' && l.select.includes('libro_obra!inner')).length === 1, 'sin consulta nueva del mapa al abrir otro registro');
    const t2 = w.document.getElementById('detalleLibroBody').innerHTML.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
    // ROC solo está en B (pendiente): el único registro del rubro, sin aprobar, también cuenta como «por aprobar»
    assert(t2.includes('Contrato: 150 m · Anterior: 0 m · Este registro: 50 m · Acum. a la fecha: 50 m (33,3 %) · Saldo a la fecha: 100 m  |  Acum. hoy: 50 m (50 m por aprobar) · Saldo hoy: 100 m'), t2);
  });

  const real = cargarFixture('parqueadero.real.json');
  if(real){
    await prueba('parqueadero.real.json: el último registro de cada rubro acumula la suma de sus filas; el N°38 (16-jul) entra antes que el N°37 (17-jul)', () => {
      const filas = filasConEmbeds(real);
      const m = acumular(filas);
      const regs = new Map(real.libro_obra.map(r => [r.id, r]));
      const ordenRegs = [...new Set(filas.map(f => f.registro_id))].map(id => { const r = regs.get(id); return { id, fecha: r.fecha, numero: r.numero_registro, created_at: r.created_at }; }).sort(comparar);
      let rubrosRevisados = 0, distintosDeEjecutada = 0;
      for(const rubro of real.rubros){
        const suyas = filas.filter(f => f.rubro_id === rubro.id);
        if(!suyas.length) continue;
        rubrosRevisados++;
        const ultimo = [...ordenRegs].reverse().find(r => suyas.some(f => f.registro_id === r.id));
        const acum = m.get(ultimo.id).get(rubro.id).acumulado;
        const suma = Math.round(suyas.reduce((s, f) => s + parseFloat(f.cantidad_dia), 0) * 1e4) / 1e4;
        assert(acum === suma, `rubro ${rubro.codigo}: último ${acum} ≠ suma ${suma}`);
        if(Math.round((suma - (parseFloat(rubro.cantidad_ejecutada) || 0)) * 1e4) / 1e4 !== 0) distintosDeEjecutada++;
      }
      assert(rubrosRevisados > 0, 'sin rubros con filas');
      console.log(`    (${rubrosRevisados} rubros con filas; ${distintosDeEjecutada} con cantidad_ejecutada distinta de la suma en esta foto)`);
      const r13 = real.rubros.find(r => r.codigo === '13');
      const u13 = [...ordenRegs].reverse().find(r => filas.some(f => f.registro_id === r.id && f.rubro_id === r13.id));
      assert(m.get(u13.id).get(r13.id).acumulado === 143.04, 'rubro 13 del fixture: ' + m.get(u13.id).get(r13.id).acumulado);
      // En esta foto la suma coincide con cantidad_ejecutada en todos los rubros (si deja de ser así,
      // lo señala tests/herramientas/verificar-acumulados.sql sobre la base viva).
      assert(distintosDeEjecutada === 0, distintosDeEjecutada + ' rubros con cantidad_ejecutada distinta de la suma');
      // D2 con datos reales: lo de arriba pasaría con CUALQUIER orden (el último registro siempre acumula el
      // total). El único par cruzado del fixture (fecha menor con número mayor) es N°38 (16-jul) y N°37
      // (17-jul); comparten un solo rubro, el de la OC de mejoramiento del suelo (sin código: se localiza
      // por id). Con número antes que fecha saldrían N°38 = 867,5 y N°37 = 722.
      const rOC = real.rubros.find(r => r.id === '625a2e6a-c95d-44ed-b9e8-99d4e3dfc15a');
      const n37 = real.libro_obra.find(r => String(r.numero_registro) === '37'), n38 = real.libro_obra.find(r => String(r.numero_registro) === '38');
      assert(rOC && n37 && n38 && n38.fecha < n37.fecha, 'el fixture debe tener el rubro de la OC y el N°38 con fecha anterior al N°37');
      const e38 = m.get(n38.id).get(rOC.id), e37 = m.get(n37.id).get(rOC.id);
      assert(e38.enRegistro === 145.5 && e38.acumulado === 573 && e38.saldo === 1547.4, 'N°38 (16-jul): ' + JSON.stringify(e38));
      assert(e37.enRegistro === 294.5 && e37.acumulado === 867.5 && e37.saldo === 1252.9, 'N°37 (17-jul): ' + JSON.stringify(e37));
    });
  } else {
    console.log('  (parqueadero.real.json no está en este equipo: se omite la prueba con datos reales)');
  }

  resumen();
})();
