// Posición de la lista del Libro de Obra al volver a pintarla: ejecuta las funciones REALES de
// index.html (cargarLibroObra, restaurarPosicionLibro, renderLibroObra, verDetalleLibro,
// aprobarRegistroLibro, observarRegistroLibro, reabrirRegistroLibro, confirmarEliminarRegistro,
// cerrarModal) en jsdom con un Supabase simulado.
//
//   node libro-posicion.test.js        (HIDIVO_INDEX=ruta prueba otra copia de index.html)
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, RUTA_INDEX, leer, scriptPrincipal, extraerFuncion, extraerConst, fuenteSiExiste, crearSb, prueba, resumen, assert } = require('./lib/arnes');

const html = leer(RUTA_INDEX);
const src = scriptPrincipal(html);
const FUNCIONES = ['cargarLibroObra', 'restaurarPosicionLibro', 'renderLibroObra', 'verDetalleLibro', 'htmlDetalleRubroLibro', 'badgeAprobacionLibro',
  'accionesAprobacionLibro', 'esAprobadorLibro', 'cerrarModal', 'aprobarRegistroLibro', 'observarRegistroLibro', 'reabrirRegistroLibro',
  'confirmarEliminarRegistro', 'avisosContratoRegistroLibro', 'referenciasRegistroLibro', 'referenciaRubroLibro', 'pendientesPorRubroLibro', 'numeroRef',
  'fmtCantidadRef', 'escAttr', 'climaIcon', 'redondear4Libro', 'compararRegistrosLibro', 'acumuladosLibroPorRegistro', 'cargarFilasAcumuladosLibro',
  'obtenerAcumuladosLibro', 'traerPaginado'];
// Un `let` de nivel superior evaluado con window.eval no es visible desde otro eval: se lee y se fija
// con accesores definidos en el mismo texto evaluado. _libroRegistroAbierto y _libroCargaEnCurso se
// declaran en la misma línea de index.html.
const CODIGO = [leer(path.join(RAIZ, 'constantes.js')), leer(path.join(RAIZ, 'expediente.js')), extraerConst(src, '_libroAcumulados'), extraerConst(src, '_libroRegistroAbierto'),
  ...FUNCIONES.map(f => fuenteSiExiste(src, f)),
  'window.__registroAbierto = () => _libroRegistroAbierto; window.__marcar = id => { _libroRegistroAbierto = id; }; window.__cargaEnCurso = () => _libroCargaEnCurso;'].join('\n');

// Fixture mínimo: 3 registros del proyecto P (fechas distintas, un rubro) y 1 de otro proyecto P2
const P = 'a1000000-0000-4000-8000-000000000001', P2 = 'a1000000-0000-4000-8000-000000000002', R1 = 'f1000000-0000-4000-8000-000000000001';
const reg = (k, fecha, numero, estado, proyecto = P) => ({ id: '90000000-0000-4000-8000-00000000000' + k, proyecto_id: proyecto, fecha, numero_registro: numero, created_at: fecha + 'T20:00:00+00:00', estado_aprobacion: estado, clima: 'Soleado', personal_total: 3 });
const REGS = [reg('a', '2026-07-10', 1, 'aprobado'), reg('b', '2026-07-11', 2, 'pendiente'), reg('c', '2026-07-12', 3, 'pendiente')];
const REG_P2 = reg('d', '2026-07-13', 1, 'pendiente', P2);
const FIXTURE = () => ({
  proyectos: [{ id: P, nombre: 'Proyecto sintético' }, { id: P2, nombre: 'Otro proyecto' }],
  libro_obra: JSON.parse(JSON.stringify([...REGS, REG_P2])),
  libro_obra_rubros: [{ id: '92-1', registro_id: REGS[0].id, rubro_id: R1, cantidad_dia: 10 }, { id: '92-2', registro_id: REGS[1].id, rubro_id: R1, cantidad_dia: 5 }],
  rubros: [{ id: R1, proyecto_id: P, codigo: '1', descripcion: 'Excavación', unidad: 'm3', cantidad_contrato: 100, cantidad_ejecutada: 15 }],
  libro_obra_fotos: [], libro_obra_aprobaciones: [],
});

function crearPagina(){
  const dom = new JSDOM(`<!doctype html><html><body><div id="toast"></div>
    <div class="content"><div class="page active" id="page-libro"><div id="libroContent"></div></div></div>
    <div class="modal-overlay" id="modalDetalleLibro"><div class="modal-body" id="detalleLibroBody"></div></div></body></html>`,
    { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.sb = crearSb(FIXTURE());
  w.currentProyecto = P; w.currentUser = { id: 'u1' }; w.currentPerfil = { rol: 'fiscalizador' };
  w.toast = () => {}; w.console = console;
  w.cargarArchivos = () => {}; w.invalidarCacheProyectos = () => {}; w.notificarPorPush = () => {}; w.notificarPorEmail = () => {};
  w.cargarNotificacionesGlobales = () => {}; w.cargarRubrosConReferenciaLibro = () => Promise.resolve(null); w.eliminarObjetosStorage = async () => {};
  w.confirm = () => true; w.prompt = () => null;
  // scrollIntoView no existe en jsdom: se registra cada llamada
  w.scrolls = []; w.Element.prototype.scrollIntoView = function(o){ w.scrolls.push({ el: this, opts: o }); };
  // scrollTop del contenedor: jsdom no hace layout, así que se emula el recorte del navegador (con el
  // loader el contenido es corto y scrollTop se lee 0) y se espía cada asignación con el contenido que
  // había en ese momento (el loader o la tabla). Así una captura hecha DESPUÉS del loader lee 0.
  const cont = w.document.querySelector('.content');
  w.asignaciones = []; let st = 0;
  Object.defineProperty(cont, 'scrollTop', {
    get(){ return w.document.querySelector('#libroContent table') ? st : 0; },
    set(v){ st = v; w.asignaciones.push({ v, conTabla: !!w.document.querySelector('#libroContent table') }); }
  });
  w.eval(CODIGO);
  return w;
}
const esperar = ms => new Promise(r => setTimeout(r, ms));
// Retrasa, en orden de emisión, los listados select('*') de libro_obra (los de cargarLibroObra) los
// milisegundos indicados, para solapar dos recargas con latencias invertidas.
function retardarListados(w, retrasos){
  const from = w.sb.from; let n = 0;
  w.sb.from = tabla => {
    const b = from(tabla);
    if(tabla === 'libro_obra'){
      const then = b.then;
      b.then = (res, rej) => {
        const ms = (b._select === '*' && !b._update && !b._insert && !b._delete) ? (retrasos[n++] || 0) : 0;
        return new Promise(r => setTimeout(r, ms)).then(() => then.call(b, res, rej));
      };
    }
    return b;
  };
}
const idsPintados = w => [...w.document.querySelectorAll('#libroContent tr[data-id]')].map(tr => tr.dataset.id);
const estadoDe = async (w, id) => (await w.sb.from('libro_obra').select('*').eq('id', id).single()).data.estado_aprobacion;

(async () => {
  console.log('libro-posicion.test.js');

  await prueba('las filas llevan data-id con el id del registro', async () => {
    const w = crearPagina();
    await w.cargarLibroObra();
    const filas = idsPintados(w);
    assert(filas.length === 3 && REGS.every(r => filas.includes(r.id)), 'data-id: ' + filas.join(','));
  });

  await prueba('refresco (mantener): el scrollTop de .content se lee antes del loader y se restaura después de pintar la tabla', async () => {
    const w = crearPagina();
    await w.cargarLibroObra();
    const cont = w.document.querySelector('.content');
    cont.scrollTop = 500;
    w.asignaciones.length = 0;
    await w.cargarLibroObra(true);
    const ultima = w.asignaciones[w.asignaciones.length - 1];
    assert(ultima && ultima.v === 500 && ultima.conTabla, 'última asignación: ' + JSON.stringify(ultima));
    assert(cont.scrollTop === 500, 'scrollTop final: ' + cont.scrollTop);
    assert(w.scrolls.length === 0, 'sin registro tocado no se centra ninguna fila');
  });

  await prueba('carga normal (menú, cambio de proyecto): no hereda el scroll de otra sección o proyecto, descarta la marca pendiente y deja la lista arriba', async () => {
    const w = crearPagina();
    await w.cargarLibroObra();
    const cont = w.document.querySelector('.content');
    // Volver por el menú desde otra sección: .content (único contenedor de scroll) trae su desplazamiento
    cont.scrollTop = 500; w.__marcar(REGS[1].id); w.asignaciones.length = 0;
    await w.cargarLibroObra();
    assert(w.asignaciones.every(a => a.v === 0) && cont.scrollTop === 0, 'lista arriba: ' + JSON.stringify(w.asignaciones));
    assert(w.scrolls.length === 0 && w.__registroAbierto() === null, 'ni centra ni conserva la marca');
    // Cambio de proyecto: la lista del nuevo proyecto tampoco hereda la posición del anterior
    cont.scrollTop = 500; w.asignaciones.length = 0; w.currentProyecto = P2;
    await w.cargarLibroObra();
    const filas = idsPintados(w);
    assert(filas.length === 1 && filas[0] === REG_P2.id, 'lista del otro proyecto: ' + filas.join(','));
    assert(w.asignaciones.every(a => a.v === 0) && cont.scrollTop === 0 && w.scrolls.length === 0, 'arriba: ' + JSON.stringify(w.asignaciones));
  });

  await prueba('abrir el detalle y cerrarlo sin cambios no deja marca: eliminar OTRA fila desde la lista solo restaura el scroll', async () => {
    const w = crearPagina();
    await w.cargarLibroObra();
    await w.verDetalleLibro(REGS[1].id);
    assert(w.document.getElementById('modalDetalleLibro').classList.contains('show'), 'detalle abierto');
    assert(w.__registroAbierto() === null, 'mirar un registro no lo marca para centrar');
    w.cerrarModal('modalDetalleLibro');
    w.document.querySelector('.content').scrollTop = 300; w.asignaciones.length = 0;
    await w.confirmarEliminarRegistro(REGS[2].id, 3); // 🗑️ de la fila N° 3 (confirm → true)
    await esperar(50); // eliminar no espera su refresco
    const filas = idsPintados(w);
    assert(filas.length === 2 && !filas.includes(REGS[2].id), 'fila eliminada: ' + filas.join(','));
    const ultima = w.asignaciones[w.asignaciones.length - 1];
    assert(ultima && ultima.v === 300 && ultima.conTabla, 'scroll restaurado: ' + JSON.stringify(ultima));
    assert(w.scrolls.length === 0, 'no se centra la fila que solo se miró: ' + JSON.stringify(w.scrolls.map(s => s.el.dataset.id)));
    assert(w.__registroAbierto() === null && !w.document.getElementById('modalDetalleLibro').classList.contains('show'), 'sin marca, detalle cerrado');
  });

  await prueba('cerrar el detalle sin cambios no recarga la lista', async () => {
    const w = crearPagina();
    await w.cargarLibroObra();
    await w.verDetalleLibro(REGS[2].id);
    const antes = w.sb.llamadas.length, tabla = w.document.querySelector('#libroContent table');
    w.cerrarModal('modalDetalleLibro');
    await esperar(20);
    assert(!w.document.getElementById('modalDetalleLibro').classList.contains('show'), 'modal cerrado');
    assert(w.sb.llamadas.length === antes && w.document.querySelector('#libroContent table') === tabla, 'sin consultas ni re-render');
  });

  await prueba('aprobar desde la lista: la fila aprobada queda centrada y resaltada en sus celdas (no en el tr, que tr:hover td taparía); el estado persiste; la marca se consume; el resaltado se apaga', async () => {
    const w = crearPagina();
    await w.cargarLibroObra();
    w.document.querySelector('.content').scrollTop = 700; w.asignaciones.length = 0;
    await w.aprobarRegistroLibro(REGS[1].id, 2);
    assert(w.scrolls.length === 1 && w.scrolls[0].el.dataset.id === REGS[1].id && w.scrolls[0].opts.block === 'center', 'centrada: ' + JSON.stringify(w.scrolls.map(s => [s.el.dataset.id, s.opts])));
    const fila = w.scrolls[0].el, celdas = [...fila.querySelectorAll('td')];
    assert(fila.style.background === '' && celdas.length === 10 && celdas.every(td => td.style.background === 'rgb(255, 248, 225)'),
      'resaltado en las celdas: tr=' + JSON.stringify(fila.style.background) + ' td=' + JSON.stringify(celdas.map(td => td.style.background)));
    const ultima = w.asignaciones[w.asignaciones.length - 1];
    assert(ultima && ultima.v === 700 && ultima.conTabla, 'el scroll previo se restaura con la tabla pintada: ' + JSON.stringify(ultima));
    // Efecto real, no solo "hubo una consulta a libro_obra": estado persistido y fila repintada sin ✓
    assert(await estadoDe(w, REGS[1].id) === 'aprobado', 'estado persistido: ' + await estadoDe(w, REGS[1].id));
    assert(fila === w.document.querySelector(`#libroContent tr[data-id="${REGS[1].id}"]`) && !fila.querySelector('button[title="Aprobar"]') && /Aprobado/.test(fila.textContent), 'fila repintada como aprobada');
    assert(w.__registroAbierto() === null && w.__cargaEnCurso() === null, 'marca consumida y captura liberada');
    await w.cargarLibroObra(true);
    assert(w.scrolls.length === 1, 'un refresco posterior no vuelve a centrar');
    await esperar(1900);
    assert(celdas.every(td => td.style.background === ''), 'el resaltado se apaga');
  });

  await prueba('observar desde la lista (prompt): la fila observada queda centrada; cancelar el prompt no mueve nada', async () => {
    const w = crearPagina();
    await w.cargarLibroObra();
    w.prompt = () => 'Falta la firma del residente';
    await w.observarRegistroLibro(REGS[2].id, 3);
    await esperar(50); // observar no espera su refresco
    assert(w.scrolls.length === 1 && w.scrolls[0].el.dataset.id === REGS[2].id && w.scrolls[0].opts.block === 'center', 'centrada: ' + JSON.stringify(w.scrolls.map(s => s.el.dataset.id)));
    assert(await estadoDe(w, REGS[2].id) === 'observado', 'estado persistido');
    assert(w.__registroAbierto() === null, 'marca consumida');
    w.prompt = () => null; const antes = w.sb.llamadas.length;
    await w.observarRegistroLibro(REGS[1].id, 2); await esperar(30);
    assert(w.scrolls.length === 1 && w.sb.llamadas.length === antes && w.__registroAbierto() === null && await estadoDe(w, REGS[1].id) === 'pendiente', 'cancelar no hace nada');
  });

  await prueba('reabrir (admin, confirm): la fila reabierta queda centrada; sin rol admin no hace nada', async () => {
    const w = crearPagina();
    w.currentPerfil = { rol: 'admin' };
    await w.cargarLibroObra();
    await w.reabrirRegistroLibro(REGS[0].id, 1);
    await esperar(50); // reabrir no espera su refresco
    assert(w.scrolls.length === 1 && w.scrolls[0].el.dataset.id === REGS[0].id && w.scrolls[0].opts.block === 'center', 'centrada: ' + JSON.stringify(w.scrolls.map(s => s.el.dataset.id)));
    assert(await estadoDe(w, REGS[0].id) === 'pendiente', 'estado persistido');
    assert(w.__registroAbierto() === null, 'marca consumida');
    const w2 = crearPagina(); // fiscalizador
    await w2.cargarLibroObra();
    const antes = w2.sb.llamadas.length;
    await w2.reabrirRegistroLibro(REGS[0].id, 1); await esperar(30);
    assert(w2.scrolls.length === 0 && w2.sb.llamadas.length === antes && await estadoDe(w2, REGS[0].id) === 'aprobado', 'sin admin no reabre ni centra');
  });

  await prueba('dos refrescos solapados (sincronizar durante una aprobación): ambos restauran la posición leída antes del primer loader, llegue el que llegue último', async () => {
    for(const retrasos of [[60, 10], [10, 60]]){
      const w = crearPagina();
      await w.cargarLibroObra();
      const cont = w.document.querySelector('.content');
      cont.scrollTop = 700; w.__marcar(REGS[1].id); w.asignaciones.length = 0;
      retardarListados(w, retrasos);
      const p1 = w.cargarLibroObra(true); // aprobar: con marca
      assert(w.document.querySelector('#libroContent .page-loader') && cont.scrollTop === 0, 'loader de la primera carga pintado (scroll recortado)');
      const p2 = w.cargarLibroObra(true); // sincronización: con el loader ya puesto
      await Promise.all([p1, p2]);
      assert(w.asignaciones.length === 2 && w.asignaciones.every(a => a.v === 700 && a.conTabla) && cont.scrollTop === 700, retrasos + ': asignaciones ' + JSON.stringify(w.asignaciones));
      assert(w.scrolls.length === 2 && w.scrolls.every(s => s.el.dataset.id === REGS[1].id), retrasos + ': centrada en ambas: ' + JSON.stringify(w.scrolls.map(s => s.el.dataset.id)));
      const fila = w.document.querySelector(`#libroContent tr[data-id="${REGS[1].id}"]`);
      assert(fila.querySelector('td').style.background === 'rgb(255, 248, 225)', retrasos + ': la fila final queda resaltada');
      assert(w.__cargaEnCurso() === null && w.__registroAbierto() === null, retrasos + ': captura liberada');
    }
  });

  await prueba('código: llamadores (2 cargas normales, 7 refrescos), quién fija y quién vacía la marca, popstate intacto', () => {
    const fn = n => extraerFuncion(src, n);
    assert(/cargarLibroObra\(\);/.test(fn('navTo')) && /cargarLibroObra\(\);/.test(fn('cambiarProyecto')), 'navTo y cambiarProyecto: carga normal');
    const normales = (src.match(/cargarLibroObra\(\)/g) || []).length, refrescos = (src.match(/cargarLibroObra\(true\)/g) || []).length;
    assert(normales === 2 && refrescos === 7, `llamadas: ${normales} normales, ${refrescos} con true`);
    for(const n of ['sincronizarRegistrosOffline', 'aprobarRegistroLibro', 'observarRegistroLibro', 'reabrirRegistroLibro', 'guardarRegistroLibro', 'guardarEdicionRegistro', 'confirmarEliminarRegistro'])
      assert(/cargarLibroObra\(true\)/.test(fn(n)), n + ' refresca con true');
    // La marca la fijan solo las acciones, justo antes de su refresco; mirar, crear y eliminar no la tocan
    const fija = /_libroRegistroAbierto = id;[^\n]*\n\s*(?:\/\/[^\n]*\n\s*)?(?:await )?cargarLibroObra\(true\)/;
    for(const n of ['aprobarRegistroLibro', 'observarRegistroLibro', 'reabrirRegistroLibro', 'guardarEdicionRegistro']) assert(fija.test(fn(n)), n + ' fija la marca justo antes de recargar');
    for(const n of ['verDetalleLibro', 'guardarRegistroLibro', 'confirmarEliminarRegistro']) assert(!/_libroRegistroAbierto\s*=/.test(fn(n)), n + ' no toca la marca');
    assert(/_libroRegistroAbierto = null/.test(fn('abrirModalLibro')), 'abrirModalLibro vacía la marca');
    assert(/_libroRegistroAbierto = null/.test(fn('limpiarEstadoProyecto')) && /_libroCargaEnCurso = null/.test(fn('limpiarEstadoProyecto')), 'limpiarEstadoProyecto vacía marca y captura en curso');
    const popstate = src.slice(src.indexOf("window.addEventListener('popstate'"), src.indexOf('function accionPrincipal('));
    assert(!/_libroRegistroAbierto|scrollTop|scrollIntoView/.test(popstate), 'popstate intacto');
  });

  resumen();
})();
