// Recalculo de rubros al editar o eliminar un registro del Libro de Obra: ejecuta las funciones
// REALES de index.html (guardarEdicionRegistro, confirmarEliminarRegistro, recalcularRubrosAfectados,
// recalcularRubro, refrescarTrazabilidadSiAbierta y abrirTrazabilidadRubro) en jsdom contra un
// fixture sintético construido aquí.
//
//   node libro-recalculo.test.js
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, leer, scriptPrincipal, extraerConst, fuenteSiExiste, crearSb, prueba, resumen, assert } = require('./lib/arnes');

const src = scriptPrincipal(leer(path.join(RAIZ, 'index.html')));
const lineaFuncion = nombre => { const m = new RegExp('^function ' + nombre + '\\(.*$', 'm').exec(src); if(!m) throw new Error('No se encontró ' + nombre); return m[0] + '\n'; };
const FUNCIONES = ['numeroRef', 'fmtCantidadRef', 'redondear4Libro', 'compararRegistrosLibro', 'traerPaginado', 'badgeAprobacionLibro', 'badgeOrdenCambioRubro',
  'armarTrazabilidadLibro', 'armarTrazabilidadPlanillas', 'htmlCabeceraTrazabilidad', 'tituloBloqueTrazabilidad', 'avisoAmbar', 'htmlTrazabilidadLibro',
  'htmlTrazabilidadPlanillas', 'htmlTrazabilidadRubro', 'abrirTrazabilidadRubro', 'recalcularRubro', 'recalcularRubrosAfectados', 'refrescarTrazabilidadSiAbierta',
  'esAprobadorLibro', 'restaurarModoCreacionLibro', 'guardarEdicionRegistro', 'confirmarEliminarRegistro'];
// Las `let` del libro (libroRubrosSeleccionados, libroRubrosRef, ...) no se cargan como `let`: un `let` de un eval no
// se ve desde otro eval, así que van como propiedades de window y las funciones las resuelven como globales.
const CODIGO = [leer(path.join(RAIZ, 'constantes.js')), leer(path.join(RAIZ, 'expediente.js')),
  ...['PLANILLAS_EN_TRAMITE', 'TRAZ_TD', 'TRAZ_TH'].map(c => extraerConst(src, c)),
  lineaFuncion('puedeGestionarRubros'), lineaFuncion('cerrarModal'), ...FUNCIONES.map(f => fuenteSiExiste(src, f))].join('\n');

// ── Fixture sintético ───────────────────────────────────────────────────────
// Rubros: R1 contrato 100 (en A y B), R2 contrato 0,3 (solo en C), R3 contrato 50 (solo en A).
// Registros: A (pendiente) R1 10 + R3 4; B R1 20,1; C R2 0,1. Las sumas iniciales coinciden.
const P = 'a1000000-0000-4000-8000-000000000001';
const R1 = 'f1000000-0000-4000-8000-000000000001', R2 = 'f1000000-0000-4000-8000-000000000002', R3 = 'f1000000-0000-4000-8000-000000000003';
const A = '90000000-0000-4000-8000-00000000000a', B = '90000000-0000-4000-8000-00000000000b', C = '90000000-0000-4000-8000-00000000000c';
const reg = (id, fecha, n, estado) => ({ id, proyecto_id: P, fecha, numero_registro: n, created_at: fecha + 'T20:00:00+00:00', estado_aprobacion: estado });
const FIXTURE = {
  proyectos: [{ id: P, nombre: 'Proyecto sintético' }],
  rubros: [
    { id: R1, proyecto_id: P, codigo: '1', descripcion: 'Excavación', unidad: 'm3', cantidad_contrato: 100, cantidad_ejecutada: 30.1, estado: 'trabajando' },
    { id: R2, proyecto_id: P, codigo: '2', descripcion: 'Casi terminado', unidad: 'm', cantidad_contrato: 0.3, cantidad_ejecutada: 0.1, estado: 'trabajando' },
    { id: R3, proyecto_id: P, codigo: '3', descripcion: 'Solo en A', unidad: 'kg', cantidad_contrato: 50, cantidad_ejecutada: 4, estado: 'trabajando' },
  ],
  libro_obra: [reg(A, '2026-07-10', 1, 'pendiente'), reg(B, '2026-07-11', 2, 'aprobado'), reg(C, '2026-07-12', 3, 'aprobado')],
  libro_obra_rubros: [
    { id: 'l1', registro_id: A, rubro_id: R1, cantidad_dia: 10 }, { id: 'l2', registro_id: A, rubro_id: R3, cantidad_dia: 4 },
    { id: 'l3', registro_id: B, rubro_id: R1, cantidad_dia: 20.1 },
    { id: 'l4', registro_id: C, rubro_id: R2, cantidad_dia: 0.1 },
  ],
  libro_obra_fotos: [], planillas_pago: [], planilla_rubros: [],
};
const copia = () => JSON.parse(JSON.stringify(FIXTURE));
const rubro = (fx, id) => fx.rubros.find(r => r.id === id);
const texto = html => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

// sb del arnés con dos añadidos: el DELETE de libro_obra arrastra sus filas hijas (CASCADE de la BD),
// y `falla(tabla, builder)` hace que una consulta responda {data:null, error} como supabase-js.
function sbLibro(fixture, falla){
  const sb = crearSb(fixture);
  const from0 = sb.from;
  sb.from = tabla => {
    const b = from0(tabla), ejecutar = b._ejecutar;
    b._ejecutar = () => {
      if(falla && falla(tabla, b)){
        sb.llamadas.push({ tabla, select: b._select, filtros: b._filtros.length, rango: b._rango, error: true });
        return { data: null, error: { message: 'permission denied for table rubros', code: '42501' } };
      }
      if(tabla === 'libro_obra' && b._delete){
        const ids = (fixture.libro_obra || []).filter(f => b._filtros.every(fn => fn(f))).map(f => f.id);
        const r = ejecutar();
        for(const t of ['libro_obra_rubros', 'libro_obra_fotos']) fixture[t] = (fixture[t] || []).filter(f => !ids.includes(f.registro_id));
        return r;
      }
      return ejecutar();
    };
    return b;
  };
  return sb;
}

// jsdom con el formulario de edición del libro, los modales y las globales que usan las dos funciones.
function ventana(sb){
  const campos = ['lFecha', 'lClimaDiurno', 'lClimaNocturno', 'lTempMin', 'lTempMax', 'lPersonal', 'lActividades', 'lNovedades', 'lResoluciones'].map(id => `<input id="${id}" value="">`).join('');
  const dom = new JSDOM(`<!doctype html><html><body><div id="toast"></div>
    <div class="modal-overlay" id="modalLibro"><div class="modal-title"></div>${campos}<div id="libroRubrosLista"></div><button id="btnGuardarLibro">Guardar cambios</button></div>
    <div class="modal-overlay" id="modalDetalleLibro"></div>
    <div class="modal-overlay" id="modalTrazabilidadRubro"><div class="modal-body" id="trazRubroBody"></div></div></body></html>`, { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only' });
  const w = dom.window;
  w.sb = sb; w.currentPerfil = { rol: 'admin' }; w.currentUser = { id: 'u1' }; w.currentProyecto = P;
  w.toasts = []; w.toast = (msg, tipo) => w.toasts.push({ msg, tipo }); w.toastConAdjuntos = (msg) => w.toasts.push({ msg, tipo: 'success' });
  w.invalidarCacheProyectos = () => {}; w.cargarRubrosConReferenciaLibro = () => Promise.resolve(); w.cargarLibroObra = () => { w.recargasLibro = (w.recargasLibro || 0) + 1; };
  w.eliminarObjetosStorage = async () => {}; w.guardarRegistroLibro = () => {}; w.confirm = () => true;
  w.libroFotosSeleccionadas = []; w.libroEquiposSeleccionados = []; w.libroMaterialesSeleccionados = []; w.libroRubrosSeleccionados = [];
  w.libroRubrosGuardados = {}; w.libroRubrosRef = {}; w._libroRegistroAbierto = null;
  w.console = { log: console.log, warn: console.warn, error: () => {} };
  w.eval(CODIGO);
  return w;
}
// Simula el formulario de edición del registro `id`: precargados = filas actuales; `cambios` =
// {rubroId: cantidad|null} marca/desmarca la casilla y fija el input, como hace el usuario.
function prepararEdicion(w, fx, id, cambios){
  w._editandoRegistroId = id;
  w.document.getElementById('lFecha').value = fx.libro_obra.find(r => r.id === id).fecha;
  const actuales = fx.libro_obra_rubros.filter(f => f.registro_id === id).map(f => ({ id: f.rubro_id, cantidad: f.cantidad_dia }));
  w.libroRubrosSeleccionados = actuales;
  const lista = w.document.getElementById('libroRubrosLista');
  lista.innerHTML = '';
  for(const [rubroId, cant] of Object.entries(cambios)){
    const chk = w.document.createElement('input'); chk.type = 'checkbox'; chk.id = 'chk-' + rubroId; chk.checked = cant !== null;
    const qty = w.document.createElement('input'); qty.id = 'qty-' + rubroId; qty.value = cant === null ? '' : String(cant);
    lista.append(chk, qty);
  }
}
const esperar = () => new Promise(r => setTimeout(r, 0));

(async () => {
  console.log('libro-recalculo.test.js');

  await prueba('1. editar un registro quitando R1 y añadiendo R2 → se recalculan R1 y R2, redondeados a 4 decimales, con estado', async () => {
    const fx = copia(); const sb = sbLibro(fx); const w = ventana(sb);
    prepararEdicion(w, fx, A, { [R1]: null, [R2]: 0.2 }); // R3 queda como estaba (precargado, sin casilla tocada)
    await w.guardarEdicionRegistro();
    const filasA = fx.libro_obra_rubros.filter(f => f.registro_id === A).map(f => f.rubro_id + ':' + f.cantidad_dia).sort();
    assert(filasA.join(',') === [R2 + ':0.2', R3 + ':4'].sort().join(','), 'filas de A tras editar: ' + filasA.join(','));
    // R1: solo queda B (20,1) → trabajando. R2: 0,1 (C) + 0,2 (A) = 0,30000000000000004 → 0,3 exacto y terminado (contrato 0,3).
    assert(rubro(fx, R1).cantidad_ejecutada === 20.1 && rubro(fx, R1).estado === 'trabajando', 'R1: ' + JSON.stringify(rubro(fx, R1)));
    assert(rubro(fx, R2).cantidad_ejecutada === 0.3 && String(rubro(fx, R2).cantidad_ejecutada) === '0.3' && rubro(fx, R2).estado === 'terminado', 'R2 redondeado y terminado: ' + JSON.stringify(rubro(fx, R2)));
    // R3 también se recalcula (estaba en el registro antes y después): mismo valor
    assert(rubro(fx, R3).cantidad_ejecutada === 4 && rubro(fx, R3).estado === 'trabajando', 'R3: ' + JSON.stringify(rubro(fx, R3)));
    assert(sb.llamadas.filter(l => l.tabla === 'libro_obra_rubros' && String(l.select).includes('cantidad_dia')).length === 3, 'una suma paginada por rubro afectado (R1, R3, R2)');
    assert(w.toasts.some(t => t.msg === 'Registro actualizado ✓') && !w.toasts.some(t => t.tipo === 'error'), JSON.stringify(w.toasts));
    assert(!w.document.getElementById('modalLibro').classList.contains('show') && w.recargasLibro === 1, 'modal cerrado y lista recargada');
  });

  await prueba('2. eliminar un registro con R1 y R3 → se recalculan los dos; R3 queda en 0 y pasa a planificado', async () => {
    const fx = copia(); const sb = sbLibro(fx); const w = ventana(sb);
    w.document.getElementById('modalDetalleLibro').classList.add('show');
    await w.confirmarEliminarRegistro(A, 1);
    assert(!fx.libro_obra.some(r => r.id === A) && !fx.libro_obra_rubros.some(f => f.registro_id === A), 'registro y filas eliminados');
    assert(rubro(fx, R1).cantidad_ejecutada === 20.1 && rubro(fx, R1).estado === 'trabajando', 'R1: ' + JSON.stringify(rubro(fx, R1)));
    assert(rubro(fx, R3).cantidad_ejecutada === 0 && rubro(fx, R3).estado === 'planificado', 'R3 a cero → planificado: ' + JSON.stringify(rubro(fx, R3)));
    assert(rubro(fx, R2).cantidad_ejecutada === 0.1 && sb.llamadas.filter(l => l.tabla === 'libro_obra_rubros' && String(l.select).includes('cantidad_dia')).length === 2, 'R2 no se toca: dos sumas (R1 y R3)');
    assert(w.toasts.some(t => t.msg === 'Registro eliminado y rubros actualizados') && !w.document.getElementById('modalDetalleLibro').classList.contains('show') && w.recargasLibro === 1, JSON.stringify(w.toasts));
    // Suspendido se respeta también aquí
    const fx2 = copia(); rubro(fx2, R3).estado = 'suspendido';
    const w2 = ventana(sbLibro(fx2));
    await w2.confirmarEliminarRegistro(A, 1);
    assert(rubro(fx2, R3).cantidad_ejecutada === 0 && rubro(fx2, R3).estado === 'suspendido', 'suspendido: ' + JSON.stringify(rubro(fx2, R3)));
    // Un registro aprobado no se elimina ni recalcula nada
    const fx3 = copia(); const sb3 = sbLibro(fx3); const w3 = ventana(sb3);
    await w3.confirmarEliminarRegistro(B, 2);
    assert(fx3.libro_obra.some(r => r.id === B) && rubro(fx3, R1).cantidad_ejecutada === 30.1 && w3.toasts.some(t => t.tipo === 'error'), 'aprobado: no se elimina');
  });

  await prueba('3. error al recalcular R1 → R3 igual se recalcula, toast de error y «1 de 2 rubros recalculados»', async () => {
    const fx = copia();
    const sb = sbLibro(fx, (tabla, b) => tabla === 'rubros' && b._update && b._filtros.every(fn => fn({ id: R1 })));
    const w = ventana(sb);
    await w.confirmarEliminarRegistro(A, 1);
    assert(rubro(fx, R1).cantidad_ejecutada === 30.1, 'R1 no se actualizó (falló): ' + rubro(fx, R1).cantidad_ejecutada);
    assert(rubro(fx, R3).cantidad_ejecutada === 0 && rubro(fx, R3).estado === 'planificado', 'R3 sí: ' + JSON.stringify(rubro(fx, R3)));
    assert(w.toasts.some(t => t.tipo === 'error' && t.msg.includes('permission denied')), 'toast con el error: ' + JSON.stringify(w.toasts));
    assert(w.toasts.some(t => t.msg === '1 de 2 rubros recalculados'), 'resumen: ' + JSON.stringify(w.toasts));
    assert(w.toasts.some(t => t.msg === 'Registro eliminado y rubros actualizados') && w.recargasLibro === 1, 'el flujo sigue hasta el final');
    // Mismo patrón al editar
    const fxE = copia();
    const wE = ventana(sbLibro(fxE, (tabla, b) => tabla === 'rubros' && b._update && b._filtros.every(fn => fn({ id: R1 }))));
    prepararEdicion(wE, fxE, A, { [R1]: null, [R2]: 0.2 });
    await wE.guardarEdicionRegistro();
    assert(rubro(fxE, R1).cantidad_ejecutada === 30.1 && rubro(fxE, R2).cantidad_ejecutada === 0.3 && rubro(fxE, R3).cantidad_ejecutada === 4, 'R2 y R3 recalculados aunque R1 falle');
    assert(wE.toasts.some(t => t.msg === '2 de 3 rubros recalculados') && wE.toasts.some(t => t.msg === 'Registro actualizado ✓'), JSON.stringify(wE.toasts));
  });

  await prueba('4. con la trazabilidad de R1 abierta, editar o eliminar su registro vuelve a cargarla; cerrada, no', async () => {
    const fx = copia(); const sb = sbLibro(fx); const w = ventana(sb);
    await w.abrirTrazabilidadRubro(R1);
    let html = w.document.getElementById('trazRubroBody').innerHTML;
    assert((html.match(/verDetalleLibro\('/g) || []).length === 2 && html.includes('✓ coincide') && texto(html).includes('Σ registros = 30,1 m3'), 'antes: dos registros');
    const aperturas = () => sb.llamadas.filter(l => l.tabla === 'rubros' && String(l.select).includes('orden_cambio_codigo')).length;
    assert(aperturas() === 1);
    prepararEdicion(w, fx, A, { [R1]: null, [R2]: 0.2 });
    await w.guardarEdicionRegistro();
    await esperar();
    html = w.document.getElementById('trazRubroBody').innerHTML;
    assert(aperturas() === 2, 'la trazabilidad se volvió a cargar: ' + aperturas());
    assert((html.match(/verDetalleLibro\('/g) || []).length === 1 && html.includes('✓ coincide') && texto(html).includes('Σ registros = 20,1 m3 · cantidad_ejecutada = 20,1 m3'), 'después: un registro y coincide: ' + texto(html).slice(0, 300));
    // Eliminar B con la trazabilidad abierta: R1 queda sin filas y en 0 → «aún no aparece»
    fx.libro_obra.find(r => r.id === B).estado_aprobacion = 'pendiente';
    await w.confirmarEliminarRegistro(B, 2);
    await esperar();
    html = w.document.getElementById('trazRubroBody').innerHTML;
    assert(aperturas() === 3 && html.includes('Este rubro aún no aparece en el libro de obra') && texto(html).includes('Ejecutado 0 ·'), 'tras eliminar: ' + texto(html).slice(0, 200));
    // Modal cerrado: no se recarga
    w.cerrarModal('modalTrazabilidadRubro');
    const fx2 = copia(); const sb2 = sbLibro(fx2); const w2 = ventana(sb2);
    w2._trazRubroId = R1; // quedó de una apertura anterior, pero el modal está cerrado
    await w2.confirmarEliminarRegistro(A, 1);
    await esperar();
    assert(!sb2.llamadas.some(l => l.tabla === 'rubros' && String(l.select).includes('orden_cambio_codigo')), 'sin modal abierto no se consulta la trazabilidad');
  });

  resumen();
})();
