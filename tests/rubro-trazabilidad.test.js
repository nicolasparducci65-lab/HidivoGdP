// Trazabilidad del rubro: ejecuta las funciones REALES de index.html (armarTrazabilidadLibro,
// armarTrazabilidadPlanillas, los renderizadores, abrirTrazabilidadRubro en jsdom, recalcularRubro
// y recalcularRubros) contra un fixture sintético construido aquí.
//
//   node rubro-trazabilidad.test.js
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, leer, scriptPrincipal, extraerConst, fuenteSiExiste, crearSb, crearContexto, prueba, resumen, assert } = require('./lib/arnes');

const src = scriptPrincipal(leer(path.join(RAIZ, 'index.html')));
// Funciones de una sola línea (gates de rol): extraerFuncion corta en la primera línea `}`, así que se toman por línea.
const lineaFuncion = nombre => { const m = new RegExp('^function ' + nombre + '\\(.*$', 'm').exec(src); if(!m) throw new Error('No se encontró ' + nombre); return m[0] + '\n'; };
const FUNCIONES = ['numeroRef', 'fmtCantidadRef', 'redondear4Libro', 'compararRegistrosLibro', 'traerPaginado', 'badgeAprobacionLibro', 'badgeOrdenCambioRubro',
  'armarTrazabilidadLibro', 'armarTrazabilidadPlanillas', 'htmlCabeceraTrazabilidad', 'tituloBloqueTrazabilidad', 'avisoAmbar', 'htmlTrazabilidadLibro',
  'htmlTrazabilidadPlanillas', 'htmlTrazabilidadRubro', 'abrirTrazabilidadRubro', 'recalcularRubroDesdeTrazabilidad', 'recalcularRubro', 'recalcularRubros'];
const CODIGO = [leer(path.join(RAIZ, 'constantes.js')), leer(path.join(RAIZ, 'expediente.js')),
  extraerConst(src, 'PLANILLAS_EN_TRAMITE'), extraerConst(src, 'TRAZ_TD'), extraerConst(src, 'TRAZ_TH'),
  lineaFuncion('puedeGestionarRubros'), ...FUNCIONES.map(f => fuenteSiExiste(src, f))].join('\n');
const BLOQUEAR = 'function bloquearSiCerrado(){ return !!window._proyectoCerrado; }\n';

// ── Fixture sintético ───────────────────────────────────────────────────────
// Rubro R1 (contrato 100, ejecutado 53,3 = suma de sus filas). Registros en el orden tramposo del
// libro: el N°38 del 16-jul va ANTES que el N°37 del 17-jul; D tiene dos filas de R1 (10 + 5); E no
// tiene número (último de su fecha); B, D y E no están aprobados. Orden de corte esperado: a b c d f e g h.
const P = 'a1000000-0000-4000-8000-000000000001';
const R1 = 'f1000000-0000-4000-8000-000000000001', R2 = 'f1000000-0000-4000-8000-000000000002', R3 = 'f1000000-0000-4000-8000-000000000003';
const R4 = 'f1000000-0000-4000-8000-000000000004', R5 = 'f1000000-0000-4000-8000-000000000005';
const reg = (k, fecha, numero, created, estado) => ({ id: '90000000-0000-4000-8000-00000000000' + k, proyecto_id: P, fecha, numero_registro: numero, created_at: created, estado_aprobacion: estado });
const REGS = {
  A: reg('a', '2026-07-10', 1, '2026-07-10T20:00:00+00:00', 'aprobado'),
  B: reg('b', '2026-07-10', 2, '2026-07-10T21:00:00+00:00', 'pendiente'),
  C: reg('c', '2026-07-16', 38, '2026-07-16T22:00:00+00:00', 'aprobado'),
  D: reg('d', '2026-07-17', 37, '2026-07-17T22:00:00+00:00', 'observado'),
  E: reg('e', '2026-07-20', null, '2026-07-20T20:00:00+00:00', null),
  F: reg('f', '2026-07-20', 40, '2026-07-20T23:00:00+00:00', 'aprobado'),
  G: reg('g', '2026-07-25', 41, '2026-07-25T09:00:00+00:00', 'aprobado'),
  H: reg('h', '2026-07-25', 41, '2026-07-25T10:00:00+00:00', 'aprobado'),
};
const RUBROS = [
  { id: R1, proyecto_id: P, codigo: '7.1', descripcion: 'Excavación <a mano>', unidad: 'm3', cantidad_contrato: 100, cantidad_ejecutada: 53.3, estado: 'trabajando', es_orden_cambio: false },
  { id: R2, proyecto_id: P, codigo: '2', descripcion: 'Importado sin libro', unidad: 'gbl', cantidad_contrato: 0, cantidad_ejecutada: 7, estado: 'trabajando', es_orden_cambio: false },
  { id: R3, proyecto_id: P, codigo: '3', descripcion: 'Todavía sin registros', unidad: 'm', cantidad_contrato: 50, cantidad_ejecutada: 0, estado: 'planificado', es_orden_cambio: false },
  { id: R4, proyecto_id: P, codigo: '4', descripcion: 'Suspendido con avance', unidad: 'm2', cantidad_contrato: 100, cantidad_ejecutada: 0, estado: 'suspendido', es_orden_cambio: true, orden_cambio_codigo: 'OC-01' },
  { id: R5, proyecto_id: P, codigo: '5', descripcion: 'Supera el contrato', unidad: 'kg', cantidad_contrato: 10, cantidad_ejecutada: 0, estado: 'planificado', es_orden_cambio: false },
];
let seq = 0;
const fila = (r, rubro, q) => ({ id: '92000000-0000-4000-8000-' + String(++seq).padStart(12, '0'), registro_id: r.id, rubro_id: rubro, cantidad_dia: q });
const FILAS = [
  fila(REGS.A, R1, 10), fila(REGS.B, R1, 20), fila(REGS.C, R1, 5), fila(REGS.D, R1, 10), fila(REGS.D, R1, 5),
  fila(REGS.E, R1, 1), fila(REGS.F, R1, 2), fila(REGS.G, R1, 0.1), fila(REGS.H, R1, 0.2),
  fila(REGS.A, R4, 10), fila(REGS.C, R5, 12),
];
// Planillas de R1 (dadas en desorden): P1 pagada 10, P2 aprobada 20, P3 rechazada 5, P4 enviada 3, P5 borrador con todo en cero.
const pl = (n, estado, ini, fin) => ({ id: '95000000-0000-4000-8000-00000000000' + n, proyecto_id: P, numero: n, estado, fecha_inicio: ini, fecha_fin: fin });
const PLANILLAS = [pl(1, 'pagada', '2026-07-01', '2026-07-31'), pl(2, 'aprobada', '2026-08-01', '2026-08-31'), pl(3, 'rechazada', '2026-09-01', '2026-09-15'), pl(4, 'enviada', '2026-09-16', '2026-09-30'), pl(5, 'borrador', '2026-10-01', '2026-10-31')];
const pr = (n, periodo, acum) => ({ id: '96000000-0000-4000-8000-00000000000' + n, planilla_id: PLANILLAS[n - 1].id, rubro_id: R1, cantidad_anterior: acum - periodo, cantidad_periodo: periodo, cantidad_acumulada: acum, precio_unitario: 2.5, monto_periodo: periodo * 2.5 });
const PLANILLA_RUBROS = [pr(2, 20, 30), pr(1, 10, 10), pr(4, 3, 33), pr(3, 5, 35), pr(5, 0, 0)];
const FIXTURE = { proyectos: [{ id: P, nombre: 'Proyecto sintético' }], libro_obra: Object.values(REGS), libro_obra_rubros: FILAS, rubros: RUBROS, planillas_pago: PLANILLAS, planilla_rubros: PLANILLA_RUBROS };
const copia = () => JSON.parse(JSON.stringify(FIXTURE));

// Lo que devuelven las consultas reales (embeds !inner), armado a mano.
const filasLibro = (fx, rubro) => fx.libro_obra_rubros.filter(f => f.rubro_id === rubro).map(f => ({ ...f, libro_obra: fx.libro_obra.find(r => r.id === f.registro_id) }));
const filasPlanillas = (fx, rubro) => fx.planilla_rubros.filter(f => f.rubro_id === rubro).map(f => ({ ...f, planillas_pago: fx.planillas_pago.find(p => p.id === f.planilla_id) }));
const rubro = id => RUBROS.find(r => r.id === id);
const texto = html => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

// sb que responde {data:null, error} (como supabase-js ante 401/5xx) cuando condicion(tabla, builder) es cierta.
function sbConFallos(fixture, condicion){
  const sb = crearSb(fixture);
  const from0 = sb.from;
  sb.from = tabla => {
    const b = from0(tabla), ejecutar = b._ejecutar;
    b._ejecutar = () => {
      if(!condicion(tabla, b)) return ejecutar();
      sb.llamadas.push({ tabla, select: b._select, filtros: b._filtros.length, rango: b._rango, error: true });
      return { data: null, error: { message: 'permission denied for table planilla_rubros', code: '42501' } };
    };
    return b;
  };
  return sb;
}

// Contexto jsdom con el modal y las globales que usa abrirTrazabilidadRubro.
function ventana({ sb, rol = 'admin', cerrado = false } = {}){
  const dom = new JSDOM('<!doctype html><html><body><div class="modal-overlay" id="modalTrazabilidadRubro"><div class="modal-body" id="trazRubroBody"></div></div></body></html>', { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only' });
  const w = dom.window;
  w.sb = sb || crearSb(copia());
  w.currentPerfil = { rol }; w.currentProyecto = P; w._proyectoCerrado = cerrado;
  w.toasts = []; w.toast = (msg, tipo) => w.toasts.push({ msg, tipo }); w.cargarRubros = () => { w.recargas = (w.recargas || 0) + 1; };
  w.console = { log: console.log, warn: console.warn, error: () => {} };
  w.eval(CODIGO + BLOQUEAR);
  return w;
}

(async () => {
  console.log('rubro-trazabilidad.test.js');
  const ctx = crearContexto({ codigo: [CODIGO + BLOQUEAR], globals: { currentPerfil: { rol: 'admin' } } });
  const armarLibro = ctx.armarTrazabilidadLibro, armarPlanillas = ctx.armarTrazabilidadPlanillas;

  const m1 = armarLibro(filasLibro(FIXTURE, R1), rubro(R1));

  await prueba('1. orden de filas = compararRegistrosLibro (N°38 antes que N°37, sin número al final de su fecha); acumulado y saldo a 4 decimales', () => {
    assert(m1.registros.map(r => r.id.slice(-1)).join('') === 'abcdfegh', 'orden ' + m1.registros.map(r => r.id.slice(-1)).join(''));
    const esperado = [[10, 10, 90], [20, 30, 70], [5, 35, 65], [15, 50, 50], [2, 52, 48], [1, 53, 47], [0.1, 53.1, 46.9], [0.2, 53.3, 46.7]];
    m1.registros.forEach((r, i) => assert(r.cantidad === esperado[i][0] && r.acumulado === esperado[i][1] && r.saldo === esperado[i][2], r.id.slice(-1) + ': ' + JSON.stringify([r.cantidad, r.acumulado, r.saldo])));
    assert(m1.suma === 53.3 && m1.contrato === 100, 'suma ' + m1.suma);
    // Sin contrato: saldo null en todas las líneas
    const sinContrato = armarLibro(filasLibro(FIXTURE, R1), { cantidad_contrato: 0, cantidad_ejecutada: 53.3 });
    assert(sinContrato.registros.every(r => r.saldo === null), 'saldo null sin contrato');
  });

  await prueba('2. dos filas del mismo rubro en un registro se agrupan en una línea (D: 10 + 5 = 15)', () => {
    const d = m1.registros.find(r => r.id === REGS.D.id);
    assert(d && d.cantidad === 15 && m1.registros.filter(r => r.id === REGS.D.id).length === 1, JSON.stringify(d));
    assert(m1.registros.length === 8 && filasLibro(FIXTURE, R1).length === 9, 'ocho líneas de nueve filas');
  });

  await prueba('3. Σ registros coincide → «✓ coincide» sin aviso; difiere → aviso y botón solo con permiso', () => {
    assert(m1.coincide === true && m1.diferencia === 0, 'coincide: ' + JSON.stringify([m1.coincide, m1.diferencia]));
    const ok = ctx.htmlTrazabilidadLibro(m1, rubro(R1), { puedeRecalcular: true });
    assert(ok.includes('✓ coincide') && !ok.includes('Diferencia') && !ok.includes('Recalcular este rubro'), 'sin aviso ni botón cuando coincide');
    assert(ok.includes('Σ registros = ') && texto(ok).includes('Σ registros = 53,3 m3 · cantidad_ejecutada = 53,3 m3'), texto(ok));
    // Como el 7.1 del Resonador: el rubro lleva 0,7 y el libro suma 0,4
    const filas = [{ id: 'x1', registro_id: REGS.A.id, cantidad_dia: 0.4, libro_obra: REGS.A }];
    const md = armarLibro(filas, { cantidad_contrato: 100, cantidad_ejecutada: 0.7 });
    assert(md.coincide === false && md.diferencia === -0.3 && md.suma === 0.4, JSON.stringify(md));
    const con = ctx.htmlTrazabilidadLibro(md, rubro(R1), { puedeRecalcular: true });
    assert(con.includes('Diferencia de 0,3 m3') && con.includes('no coincide con el libro de obra') && con.includes('recalcularRubroDesdeTrazabilidad(\'' + R1 + '\')'), con);
    const sin = ctx.htmlTrazabilidadLibro(md, rubro(R1), { puedeRecalcular: false });
    assert(sin.includes('Diferencia de 0,3 m3') && !sin.includes('Recalcular este rubro'), 'aviso sin botón sin permiso');
    // Comparación a 4 decimales: una diferencia de 0,00001 no es diferencia
    const casi = armarLibro(filas, { cantidad_contrato: 100, cantidad_ejecutada: 0.40001 });
    assert(casi.coincide === true, 'redondeo a 4 decimales');
  });

  await prueba('4. pendientes de aprobación: no aprobados (null incluido) contados y sumados como pendientesPorRubroLibro', () => {
    assert(m1.pendientes.n === 3 && m1.pendientes.suma === 36, JSON.stringify(m1.pendientes)); // B 20 + D 15 + E 1
    const html = ctx.htmlTrazabilidadLibro(m1, rubro(R1), {});
    assert(texto(html).includes('3 registro(s) pendiente(s) de aprobación suman 36 m3'), texto(html));
    const todo = armarLibro(filasLibro(FIXTURE, R1).map(f => ({ ...f, libro_obra: { ...f.libro_obra, estado_aprobacion: 'aprobado' } })), rubro(R1));
    assert(todo.pendientes.n === 0 && !ctx.htmlTrazabilidadLibro(todo, rubro(R1), {}).includes('pendiente(s)'), 'sin pendientes no hay línea');
  });

  await prueba('5. sin filas: ejecutado > 0 → «sin respaldo»; ejecutado 0 → «aún no aparece»', () => {
    const m2 = armarLibro([], rubro(R2)), m3 = armarLibro([], rubro(R3));
    assert(m2.registros.length === 0 && m3.registros.length === 0);
    const h2 = ctx.htmlTrazabilidadLibro(m2, rubro(R2), { puedeRecalcular: true }), h3 = ctx.htmlTrazabilidadLibro(m3, rubro(R3), { puedeRecalcular: true });
    assert(h2.includes('Ejecutado sin respaldo en el libro de obra (importado o editado a mano)') && !h2.includes('Recalcular este rubro'), h2);
    assert(h3.includes('Este rubro aún no aparece en el libro de obra') && !h3.includes('<table'), h3);
  });

  await prueba('6. planillas: solo aprobadas/pagadas facturan; en trámite aparte; rechazadas tachadas sin sumar; pendiente = ejecutado − facturado; aviso si negativo', () => {
    const mp = armarPlanillas(filasPlanillas(FIXTURE, R1), rubro(R1));
    assert(mp.planillas.map(p => p.numero).join('') === '1234', 'orden por número: ' + mp.planillas.map(p => p.numero).join(''));
    assert(mp.sinCantidad === 1, 'P5 con todo en cero no se lista: ' + mp.sinCantidad);
    assert(mp.facturado === 30 && mp.enTramite === 3 && mp.pendienteFacturar === 23.3 && mp.sobreFacturado === false, JSON.stringify(mp));
    assert(mp.planillas.find(p => p.numero === 3).grupo === null, 'rechazada en ningún grupo');
    const html = ctx.htmlTrazabilidadPlanillas(mp, rubro(R1), { verPlanillas: true });
    const t = texto(html);
    assert(t.includes('Facturado (aprobadas + pagadas) = 30 m3 · Ejecutado = 53,3 m3 → Pendiente de facturar = 23,3 m3 · en trámite: 3 m3'), t);
    assert(html.includes('line-through') && html.includes('❌ Rechazada') && t.includes('En 1 planilla(s) más el rubro aparece sin cantidad'), html);
    assert(html.includes('01 jul. 26 → 31 jul. 26') || html.includes('01 jul 26 → 31 jul 26'), 'periodo con fechas: ' + html.match(/N° 1<\/td>\s*<td[^>]*>([^<]*)/)?.[1]);
    assert((html.match(/verPlanilla\('/g) || []).length === 4, '👁 en cada planilla listada');
    assert(!ctx.htmlTrazabilidadPlanillas(mp, rubro(R1), { verPlanillas: false }).includes('verPlanilla('), 'sin 👁 para roles sin sección Planillas');
    assert(!html.includes('Facturado por encima'), 'sin aviso cuando no está sobrefacturado');
    // Facturado por encima de lo ejecutado
    const sobre = armarPlanillas(filasPlanillas(FIXTURE, R1), { cantidad_ejecutada: 25, unidad: 'm3' });
    assert(sobre.pendienteFacturar === -5 && sobre.sobreFacturado === true, JSON.stringify(sobre));
    assert(texto(ctx.htmlTrazabilidadPlanillas(sobre, rubro(R1), {})).includes('Facturado por encima de lo ejecutado en 5 m3'));
    // Sin planillas
    const nada = armarPlanillas([], rubro(R1));
    assert(nada.planillas.length === 0 && nada.pendienteFacturar === 53.3 && ctx.htmlTrazabilidadPlanillas(nada, rubro(R1), {}).includes('no tiene cantidades en ninguna planilla'));
  });

  await prueba('7. abrirTrazabilidadRubro (real, en jsdom): consultas en paralelo; error RLS en planillas → «Sin acceso» y bloque A intacto', async () => {
    const w = ventana();
    await w.abrirTrazabilidadRubro(R1);
    assert(w.document.getElementById('modalTrazabilidadRubro').classList.contains('show') && w._trazRubroId === R1, 'modal abierto');
    let html = w.document.getElementById('trazRubroBody').innerHTML, t = texto(html);
    assert(t.includes('[7.1] Excavación &lt;a mano&gt; · m3') || html.includes('Excavación &lt;a mano&gt;'), 'cabecera escapada: ' + t.slice(0, 120));
    assert(t.includes('Contrato 100 · Ejecutado 53,3 · 53.3% · Saldo 46,7'), t.slice(0, 200));
    assert((html.match(/verDetalleLibro\('/g) || []).length === 8 && (html.match(/verPlanilla\('/g) || []).length === 4, '8 registros y 4 planillas con 👁');
    assert(html.includes('✓ coincide') && t.includes('Pendiente de facturar = 23,3 m3'), 'pies de ambos bloques');
    const sel = w.sb.llamadas.find(l => l.tabla === 'libro_obra_rubros').select, selP = w.sb.llamadas.find(l => l.tabla === 'planilla_rubros').select;
    assert(/libro_obra!inner\([^)]*fecha[^)]*numero_registro[^)]*estado_aprobacion[^)]*created_at/.test(sel), 'select del libro: ' + sel);
    assert(/planillas_pago!inner\([^)]*numero[^)]*estado[^)]*fecha_inicio[^)]*fecha_fin/.test(selP), 'select de planillas: ' + selP);
    // Rol residente: sin botón de recalcular aunque difiera; con 👁 a planillas. Visualizador: sin 👁 a planillas.
    const fx = copia(); fx.rubros.find(r => r.id === R1).cantidad_ejecutada = 60;
    const wr = ventana({ sb: crearSb(fx), rol: 'residente' });
    await wr.abrirTrazabilidadRubro(R1);
    html = wr.document.getElementById('trazRubroBody').innerHTML;
    assert(html.includes('Diferencia de 6,7 m3') && !html.includes('Recalcular este rubro') && html.includes('verPlanilla('), 'residente: aviso sin botón');
    const wa = ventana({ sb: crearSb(JSON.parse(JSON.stringify(fx))), rol: 'admin' });
    await wa.abrirTrazabilidadRubro(R1);
    assert(wa.document.getElementById('trazRubroBody').innerHTML.includes('Recalcular este rubro'), 'admin: botón');
    const wc = ventana({ sb: crearSb(JSON.parse(JSON.stringify(fx))), rol: 'admin', cerrado: true });
    await wc.abrirTrazabilidadRubro(R1);
    assert(!wc.document.getElementById('trazRubroBody').innerHTML.includes('Recalcular este rubro'), 'proyecto cerrado: sin botón');
    const wv = ventana({ rol: 'visualizador' });
    await wv.abrirTrazabilidadRubro(R1);
    assert(!wv.document.getElementById('trazRubroBody').innerHTML.includes('verPlanilla(') && wv.document.getElementById('trazRubroBody').innerHTML.includes('verDetalleLibro('), 'visualizador: sin 👁 a planillas, con 👁 al libro');
    // RLS: planilla_rubros falla → «Sin acceso a planillas», el libro se muestra igual
    const we = ventana({ sb: sbConFallos(copia(), tabla => tabla === 'planilla_rubros') });
    await we.abrirTrazabilidadRubro(R1);
    html = we.document.getElementById('trazRubroBody').innerHTML;
    assert(html.includes('Sin acceso a planillas') && !html.includes('Facturado (') && (html.match(/verDetalleLibro\('/g) || []).length === 8 && html.includes('✓ coincide'), 'bloque A intacto: ' + texto(html).slice(-200));
    // Libro falla → mensaje en A, planillas igual
    const wl = ventana({ sb: sbConFallos(copia(), tabla => tabla === 'libro_obra_rubros') });
    await wl.abrirTrazabilidadRubro(R1);
    html = wl.document.getElementById('trazRubroBody').innerHTML;
    assert(html.includes('No se pudo leer el libro de obra') && texto(html).includes('Pendiente de facturar = 23,3 m3'), 'bloque B intacto');
    // Rubro OC: badge 🔄 en la cabecera
    const wo = ventana();
    await wo.abrirTrazabilidadRubro(R4);
    assert(wo.document.getElementById('trazRubroBody').innerHTML.includes('🔄 OC-01'), 'badge de orden de cambio');
  });

  await prueba('8. recalcularRubro = recorrido de recalcularRubros para cada rubro, suspendido incluido; el botón del modal refresca modal y tabla', async () => {
    const fxA = copia(), fxB = copia();
    fxA.rubros.forEach(r => { r.cantidad_ejecutada = 999; });
    fxB.rubros.forEach(r => { r.cantidad_ejecutada = 999; });
    const cA = crearContexto({ codigo: [CODIGO + BLOQUEAR], globals: { sb: crearSb(fxA), currentPerfil: { rol: 'admin' } } });
    const res = {};
    for(const r of RUBROS) res[r.id] = await cA.recalcularRubro(r.id);
    assert(res[R1].total === 53.3 && res[R1].estado === 'trabajando', 'suma redondeada a 4 decimales, igualdad exacta: ' + JSON.stringify(res[R1]));
    // Lo escrito en rubros.cantidad_ejecutada tampoco lleva residuo flotante (53.300000000000004)
    const escrito = fxA.rubros.find(r => r.id === R1).cantidad_ejecutada;
    assert(escrito === 53.3 && String(escrito) === '53.3', 'escrito sin residuo: ' + String(escrito));
    assert(res[R2].total === 0 && res[R2].estado === 'planificado', 'sin filas → 0 y planificado: ' + JSON.stringify(res[R2]));
    assert(res[R4].total === 10 && res[R4].estado === 'suspendido', 'suspendido se respeta: ' + JSON.stringify(res[R4]));
    assert(res[R5].total === 12 && res[R5].estado === 'terminado', 'supera el contrato → terminado: ' + JSON.stringify(res[R5]));
    assert(fxA.rubros.every(r => r.cantidad_ejecutada === res[r.id].total && r.estado === res[r.id].estado), 'rubros actualizados en la BD');
    const cB = crearContexto({ codigo: [CODIGO + BLOQUEAR], globals: { sb: crearSb(fxB), currentPerfil: { rol: 'admin' }, currentProyecto: P, event: { target: { closest: () => null } }, cargarRubros: () => {} } });
    await cB.recalcularRubros();
    assert(JSON.stringify(fxA.rubros) === JSON.stringify(fxB.rubros), 'recalcularRubros deja los rubros igual que recalcularRubro uno a uno');
    assert(cB._toasts.some(t => t.msg.includes('5 rubros recalculados')), JSON.stringify(cB._toasts));
    // Error de consulta: recalcularRubro lanza; recalcularRubros avisa cuántos quedaron listos
    const cE = crearContexto({ codigo: [CODIGO + BLOQUEAR], globals: { sb: sbConFallos(copia(), (tabla, b) => tabla === 'rubros' && b._update), currentPerfil: { rol: 'admin' }, currentProyecto: P, event: { target: { closest: () => null } }, cargarRubros: () => {}, console: { log(){}, warn(){}, error(){} } } });
    let err = null; try{ await cE.recalcularRubro(R1); }catch(e){ err = e; }
    assert(err && /permission denied/.test(err.message), 'lanza el error de la consulta');
    await cE.recalcularRubros();
    assert(cE._toasts.some(t => t.tipo === 'error' && t.msg.includes('0 de 5')), JSON.stringify(cE._toasts));
    // Botón del modal (jsdom): recalcula, reabre el modal con el dato fresco y recarga la tabla
    const fx = copia(); fx.rubros.find(r => r.id === R1).cantidad_ejecutada = 0.7;
    const w = ventana({ sb: crearSb(fx) });
    await w.abrirTrazabilidadRubro(R1);
    assert(w.document.getElementById('trazRubroBody').innerHTML.includes('Recalcular este rubro'));
    w.event = { target: { closest: () => null } };
    await w.recalcularRubroDesdeTrazabilidad(R1);
    const html = w.document.getElementById('trazRubroBody').innerHTML;
    assert(fx.rubros.find(r => r.id === R1).cantidad_ejecutada === 53.3 && html.includes('✓ coincide') && !html.includes('Recalcular este rubro') && w.recargas === 1, 'tras recalcular: ' + texto(html).slice(0, 160));
    // Residente: el botón no hace nada aunque se invoque
    const fx2 = copia(); fx2.rubros.find(r => r.id === R1).cantidad_ejecutada = 0.7;
    const w2 = ventana({ sb: crearSb(fx2), rol: 'residente' });
    w2.event = { target: { closest: () => null } };
    await w2.recalcularRubroDesdeTrazabilidad(R1);
    assert(fx2.rubros.find(r => r.id === R1).cantidad_ejecutada === 0.7, 'residente no recalcula');
  });

  resumen();
})();
