// Modal, lista y flujo de generación del expediente: ejecuta las funciones
// REALES de index.html dentro de un documento jsdom con el HTML del modal y un
// bloque de Cierre, contra el cliente simulado. Fase 2: conteos rápidos,
// subopciones, umbrales, panel de tomos y registro con `tomos`.
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, leer, scriptPrincipal, extraerFuncion, crearSb, cargarFixture, prueba, resumen, assert } = require('./lib/arnes');

const html = leer(path.join(RAIZ, 'index.html'));
const src = scriptPrincipal(html);
const ini = html.indexOf('<div class="modal-overlay" id="modalExpediente">');
const fin = html.indexOf('<div class="modal-overlay" id="modalOC">');
assert(ini > 0 && fin > ini, 'modalExpediente debe estar antes de modalOC');
const MODAL_HTML = html.slice(ini, fin);
const FUNCIONES = ['permisoExpediente', 'puedeGenerarExpediente', 'puedeVerExpedientes', 'esDispositivoMovil', 'bloqueExpedienteHTML', 'cargarExpedientesGenerados', 'renderExpedientesLista',
  'reutilizarSeleccionExpediente', 'umbralesExpediente', 'abrirModalExpediente', 'recontarExpediente', 'renderModalExpediente', 'aplicarPresetExpediente', 'expedienteCambioManual',
  'leerSeleccionExpediente', 'actualizarEstimacionExpediente', 'obtenerLogoDataUri', 'generarExpediente', 'renderPanelTomosExpediente', 'abrirTomoExpediente', 'prepararCronogramaExpediente', 'cerrarModal', 'hoyEcuador'];
// Una sola evaluación: las const de constantes.js solo son visibles dentro del mismo eval.
const CODIGO = [leer(path.join(RAIZ, 'constantes.js')), leer(path.join(RAIZ, 'expediente.js')), FUNCIONES.map(f => extraerFuncion(src, f)).join('\n')].join('\n');

function crearPagina(fixture, { rol = 'admin', ancho = 1366, extra = '' } = {}){
  const dom = new JSDOM(`<!doctype html><html><body><div id="toast"></div><div id="cardCierre"></div>${MODAL_HTML}</body></html>`,
    { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w, 'innerWidth', { value: ancho, configurable: true });
  w.matchMedia = () => ({ matches: false });
  const blobs = [];
  w.URL.createObjectURL = blob => { blobs.push(blob); return 'blob:prueba/' + blobs.length; };
  const ventanas = [];
  w.open = url => { const v = { url, document: { title: '' } }; ventanas.push(v); return w._bloquearPopups ? null : v; };
  w.fetch = async () => ({ ok: true, blob: async () => new w.Blob([Uint8Array.from([137, 80, 78, 71])], { type: 'image/png' }) });
  w.toasts = [];
  w.toast = (msg, tipo) => w.toasts.push({ msg, tipo });
  w.sb = crearSb(fixture, { alInsertar: (tabla, fila) => { if(tabla === 'expedientes_generados'){ fila.version = fixture.expedientes_generados.length; fila.generado_en = '2026-10-14T15:05:00Z'; } } });
  w.currentProyecto = fixture.proyectos[0].id;
  w.currentUser = { id: 'b0000000-0000-4000-8000-000000000001' };
  w.currentPerfil = { id: 'b0000000-0000-4000-8000-000000000001', nombre: 'Prueba', apellido: 'Admin', rol };
  w.proyectos = fixture.proyectos;
  // Curva S simulada: el cargador real necesita la pantalla; aquí basta con que no reviente
  w.cronogramaData = []; w.curvaSModo = 'semanas'; w.cargarCurvaS = async () => {}; w.calcularIndicadoresPuro = () => null; w.generarImagenGraficoCurvaS = async () => null;
  w.eval(extra ? CODIGO + String.fromCharCode(10) + extra : CODIGO);
  w._blobs = blobs; w._ventanas = ventanas;
  return w;
}
const tick = ms => new Promise(r => setTimeout(r, ms));
const esperar = async (fn, n = 150) => { for(let i = 0; i < n; i++){ if(fn()) return true; await tick(10); } return fn(); };
// El Blob de jsdom no tiene .text(): se lee con FileReader.
const leerBlob = (w, blob) => new Promise((res, rej) => { const r = new w.FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(blob); });
const textoEst = w => w.document.getElementById('expedienteEstimacion').textContent;
const lineaEst = (w, sel) => { const e = w.expedienteEstimarResumen(w._expedienteConteos, sel, w.umbralesExpediente()); return `${e.secciones.length} secciones · ${e.fotos} fotos · ≈ ${e.paginas} páginas · ${e.tomos.length} tomo(s)`; };

(async () => {
  console.log('modal-expediente.test.js');
  const base = cargarFixture('sintetico.json');
  const clonar = o => JSON.parse(JSON.stringify(o));

  await prueba('gate: solo admin (lee la fila expediente de PERMISOS); «ver» daría la lista sin botón', () => {
    for(const [rol, ok] of [['admin', true], ['fiscalizador', false], ['residente', false], ['visualizador', false], ['cliente', false], ['tecnico_sst', false], ['bodeguero', false], [null, false]]){
      const w = crearPagina(clonar(base), { rol });
      assert(w.puedeGenerarExpediente() === ok && w.puedeVerExpedientes() === ok, 'rol ' + rol);
      assert((w.bloqueExpedienteHTML() !== '') === ok, 'bloque para ' + rol);
    }
    const w = crearPagina(clonar(base), { rol: 'admin', extra: "PERMISOS.secciones.find(s => s.id === 'expediente').roles.admin = null;" });
    assert(w.puedeGenerarExpediente() === false && w.bloqueExpedienteHTML() === '', 'la celda de PERMISOS manda');
    const v = crearPagina(clonar(base), { rol: 'fiscalizador', extra: "PERMISOS.secciones.find(s => s.id === 'expediente').roles.fiscalizador = 'ver';" });
    assert(!v.puedeGenerarExpediente() && v.puedeVerExpedientes(), 'ver: sin generar');
    const bloque = v.bloqueExpedienteHTML();
    assert(bloque.includes('id="expedientesLista"') && !bloque.includes('btnGenerarExpediente'), 'ver: lista sin botón');
  });

  await prueba('en móvil el botón queda deshabilitado con su texto y la lista se ve', async () => {
    const w = crearPagina(clonar(base), { ancho: 390 });
    assert(w.esDispositivoMovil(), 'pantalla angosta');
    w.document.getElementById('cardCierre').innerHTML = w.bloqueExpedienteHTML();
    const btn = w.document.getElementById('btnGenerarExpediente');
    assert(btn.disabled && btn.textContent === 'El expediente se genera desde computador', 'botón móvil');
    await w.cargarExpedientesGenerados();
    assert(w.document.getElementById('expedientesLista').textContent.includes('Aún no se ha generado'), 'lista visible');
    await w.abrirModalExpediente();
    assert(!w.document.getElementById('modalExpediente').classList.contains('show'), 'no abre el modal en móvil');
    assert(w.toasts.some(t => t.msg === 'El expediente se genera desde computador'), 'aviso');
  });

  await prueba('lista: versión, fecha de Ecuador, usuario, preset, secciones, tomos, estado y reutilizar (con plan de tomos)', async () => {
    const fx = clonar(base);
    const plan = [['contrato', 'presupuesto'], ['libro_obra:2026-02']];
    fx.expedientes_generados = [
      { id: 'x1', proyecto_id: fx.proyectos[0].id, version: 1, generado_por: 'b0000000-0000-4000-8000-000000000002', generado_en: '2026-10-14T15:05:00Z', preset: 'completo', secciones: ['portada', 'indice', 'contrato'], filtros: { incluirOCsNoAprobadas: true, detallePlanillas: true, tomos: plan, calidadFotos: 'alta' }, estado: 'listo', subtitulo: 'Dossier', tomos: 2 },
      { id: 'x2', proyecto_id: fx.proyectos[0].id, version: 2, generado_por: 'b0000000-0000-4000-8000-000000000001', generado_en: '2026-10-14T16:00:00Z', preset: null, secciones: ['portada', 'indice'], filtros: {}, estado: 'error', error_detalle: 'falló', tomos: 1 }
    ];
    const w = crearPagina(fx);
    w.document.getElementById('cardCierre').innerHTML = w.bloqueExpedienteHTML();
    await w.cargarExpedientesGenerados();
    const filas = [...w.document.querySelectorAll('#expedientesLista tbody tr')];
    assert(filas.length === 2 && filas[0].textContent.includes('v2'), 'orden descendente por versión');
    assert(filas[1].textContent.includes('14/10/2026, 10:05') && filas[1].textContent.includes('Prueba Fiscalizador') && filas[1].textContent.includes('Completo (interno)') && filas[1].textContent.includes('Listo'), 'fila v1: ' + filas[1].textContent);
    assert(filas[1].children[5].textContent === '2' && filas[0].children[5].textContent === '1', 'columna de tomos');
    assert(filas[0].textContent.includes('Personalizado') && filas[0].textContent.includes('Prueba Admin') && filas[0].querySelector('span[title="falló"]'), 'fila v2 con error y detalle');
    w.reutilizarSeleccionExpediente('x1');
    await esperar(() => w._expedienteConteos);
    assert(w.document.getElementById('modalExpediente').classList.contains('show'), 'abre el modal');
    const sel = w.leerSeleccionExpediente();
    assert(sel.preset === 'completo' && sel.subtitulo === 'Dossier' && sel.secciones.join() === 'portada,indice,contrato' && sel.filtros.incluirOCsNoAprobadas === true && sel.filtros.calidadFotos === 'alta', 'selección reutilizada: ' + JSON.stringify(sel));
    assert(JSON.stringify(sel.filtros.tomos) === JSON.stringify(plan), 'el plan de tomos guardado se conserva en la selección');
  });

  await prueba('modal: preset completo por defecto, fase 3 deshabilitada, conteos rápidos, estimación con fotos y tomos, subopciones', async () => {
    const w = crearPagina(clonar(base));
    w.document.getElementById('cardCierre').innerHTML = w.bloqueExpedienteHTML();
    await w.cargarExpedientesGenerados();
    await w.abrirModalExpediente();
    const d = w.document;
    assert(d.querySelector('input[name="expPreset"][value="completo"]').checked, 'preset completo marcado');
    assert(d.getElementById('chk-exp-portada').disabled && d.getElementById('chk-exp-portada').checked, 'portada fija');
    assert(!d.getElementById('chk-exp-libro_obra').disabled && d.getElementById('chk-exp-libro_obra').checked && d.getElementById('chk-exp-chat').disabled, 'fase 2 activa; fase 3 deshabilitada');
    assert((d.body.textContent.match(/próximamente/g) || []).length === 3, '3 secciones próximamente (fase 3)');
    await esperar(() => w._expedienteConteos);
    assert(d.getElementById('cnt-exp-presupuesto').textContent === '(11)' && d.getElementById('cnt-exp-ordenes_cambio').textContent === '(2)' && d.getElementById('cnt-exp-actas').textContent === '(2 de 2)', 'conteos fase 1');
    assert(d.getElementById('cnt-exp-libro_obra').textContent === '(3 registros, 4 fotos, 2 meses)' && d.getElementById('cnt-exp-observaciones').textContent === '(2, 3 fotos)' && d.getElementById('cnt-exp-ensayos').textContent === '(3)', 'conteos fase 2: ' + d.getElementById('cnt-exp-libro_obra').textContent);
    let sel = w.leerSeleccionExpediente();
    assert(textoEst(w).includes(lineaEst(w, sel)) && textoEst(w).includes('Procesará 8 imágenes de origen'), 'estimación: ' + textoEst(w));
    assert(sel.filtros.observaciones === 'todas' && sel.filtros.calidadFotos === 'estandar' && sel.filtros.libroDesde === null, 'filtros por defecto');
    assert(w.sb.llamadas.every(l => !(l.tabla === 'libro_obra_fotos' && l.select === '*')), 'al abrir no se cargan las fotos completas');
    // preset contratante: sin chat y sin OCs no aprobadas; vuelve a contar
    w.aplicarPresetExpediente('contratante');
    sel = w.leerSeleccionExpediente();
    assert(sel.preset === 'contratante' && !sel.secciones.includes('chat') && sel.secciones.includes('sst') && sel.secciones.includes('subcontratistas') && sel.filtros.incluirOCsNoAprobadas === false, 'preset contratante incluye SST y subcontratistas, excluye chat');
    await esperar(() => d.getElementById('cnt-exp-ordenes_cambio').textContent === '(1 aprobadas)');
    assert(textoEst(w).includes(lineaEst(w, sel)), 'estimación recalculada tras recontar: ' + textoEst(w));
    // subopciones
    d.getElementById('expLibroDesde').value = '2026-03-01'; d.getElementById('expObs').value = 'resueltas'; d.getElementById('expCalidad').value = 'alta';
    w.expedienteCambioManual();
    sel = w.leerSeleccionExpediente();
    assert(sel.preset === null && sel.filtros.libroDesde === '2026-03-01' && sel.filtros.observaciones === 'resueltas' && sel.filtros.calidadFotos === 'alta', 'subopciones leídas');
    await esperar(() => d.getElementById('cnt-exp-libro_obra').textContent === '(1 registros, 1 fotos, 1 meses)');
    assert(d.getElementById('cnt-exp-observaciones').textContent === '(1, 2 fotos)', 'conteos con filtros: ' + d.getElementById('cnt-exp-observaciones').textContent);
    d.getElementById('expSubtitulo').value = 'Cierre'; w.expedienteCambioManual(true);
    assert(w.leerSeleccionExpediente().subtitulo === 'Cierre', 'subtítulo');
    // umbrales personalizados desde la consola
    w._expedienteUmbrales = { maxFotos: 1 };
    w.actualizarEstimacionExpediente();
    assert(textoEst(w).includes('umbrales 1 fotos / 150 páginas (override)') && textoEst(w).includes('tomo(s)') && !textoEst(w).includes('· 1 tomo(s)'), 'override de umbrales: ' + textoEst(w));
  });

  await prueba('generar (un tomo): inserta con tomos=1 y plan en filtros, genera con la versión de la base y abre la vista previa', async () => {
    const fx = clonar(base); fx.expedientes_generados = [];
    const w = crearPagina(fx);
    w.document.getElementById('cardCierre').innerHTML = w.bloqueExpedienteHTML();
    await w.cargarExpedientesGenerados();
    await w.abrirModalExpediente();
    await esperar(() => w._expedienteConteos);
    w.document.getElementById('expSubtitulo').value = 'Project close-out dossier';
    const progreso = [];
    const avisoEl = w.document.getElementById('expedienteAviso');
    const obs = new w.MutationObserver(() => progreso.push(avisoEl.textContent));
    obs.observe(avisoEl, { childList: true, characterData: true, subtree: true });
    await w.generarExpediente();
    obs.disconnect();
    const fila = fx.expedientes_generados[0];
    assert(fila && fila.origen === 'navegador' && fila.estado === 'listo' && fila.generado_por === w.currentUser.id && fila.preset === 'completo', 'fila insertada: ' + JSON.stringify(fila));
    const est = w.expedienteEstimarResumen(w._expedienteConteos, w.leerSeleccionExpediente(), w.umbralesExpediente());
    assert(fila.tomos === 1 && Array.isArray(fila.filtros.tomos) && fila.filtros.tomos.length === 1 && fila.paginas_estimadas === est.paginas && fila.subtitulo === 'Project close-out dossier' && fila.estado_proyecto === 'liquidado', 'campos de la fila: ' + JSON.stringify({ tomos: fila.tomos, plan: fila.filtros.tomos, paginas: fila.paginas_estimadas, est: est.paginas }));
    assert(progreso.some(t => t.startsWith('Cargando')), 'progreso visible durante la carga: ' + progreso.join(' | '));
    assert(w._ventanas.length === 1 && w._ventanas[0].url.startsWith('blob:'), 'pestaña con el Blob');
    const html = await leerBlob(w, w._blobs[0]);
    assert(html.includes('<title>Expediente_Puente-peatonal-Las-Palmas_v1_') && html.includes('Expediente v1 · generado el') && html.includes('por Prueba Admin (admin)') && html.includes('id="sec-libro_obra"') && html.includes('Foto 1/2 ·'), 'documento completo con la versión de la base');
    assert(html.includes('data:image/png;base64,'), 'logo incrustado desde vendor/');
    assert(!w.document.getElementById('modalExpediente').classList.contains('show'), 'cierra el modal');
    assert(w.toasts.some(t => t.msg === 'Expediente v1 generado ✓'), 'toast');
    await esperar(() => w.document.querySelector('#expedientesLista tbody tr'));
    assert(w.document.querySelector('#expedientesLista tbody tr').textContent.includes('v1'), 'la lista se refresca');
    await w.abrirModalExpediente();
    assert(w.leerSeleccionExpediente().subtitulo === 'Project close-out dossier' && Array.isArray(w.leerSeleccionExpediente().filtros.tomos), 'precarga del último expediente con su plan');
    await esperar(() => w._expedienteConteos);
    await w.generarExpediente();
    assert(fx.expedientes_generados.length === 2 && (await leerBlob(w, w._blobs[1])).includes('Expediente v2 ·'), 'v2');
  });

  await prueba('generar en tomos: umbral bajo → panel con un botón por tomo, cada tomo en su pestaña, fila con tomos=N y plan', async () => {
    const fx = clonar(base); fx.expedientes_generados = [];
    const w = crearPagina(fx);
    w._expedienteUmbrales = { maxFotos: 2 };
    w.document.getElementById('cardCierre').innerHTML = w.bloqueExpedienteHTML();
    await w.cargarExpedientesGenerados();
    await w.abrirModalExpediente();
    await esperar(() => w._expedienteConteos);
    await w.generarExpediente();
    const fila = fx.expedientes_generados[0];
    const d = w.document;
    assert(fila.tomos >= 3 && fila.filtros.tomos.length === fila.tomos, 'fila con varios tomos: ' + fila.tomos);
    const botones = [...d.querySelectorAll('#expedienteTomos button')];
    assert(botones.length === fila.tomos && botones[0].textContent.includes('Abrir tomo 1 de ' + fila.tomos) && d.getElementById('modalExpediente').classList.contains('show'), 'panel de tomos y modal abierto');
    assert(w._ventanas.length === 0 && d.getElementById('expedienteAviso').textContent.includes(`en ${fila.tomos} tomos`), 'no abre pestañas solas');
    // jsdom en modo outside-only no ejecuta los onclick inline: se invoca la función del botón.
    assert(botones[1].getAttribute('onclick') === 'abrirTomoExpediente(2)', 'botón enlazado a abrirTomoExpediente');
    w.abrirTomoExpediente(2);
    assert(w._ventanas.length === 1, 'abre el tomo 2 en su pestaña');
    const h2 = await leerBlob(w, w._blobs[0]);
    assert(h2.includes(`Tomo 2 de ${fila.tomos}`) && h2.includes(`<title>Expediente_Puente-peatonal-Las-Palmas_v1_T2de${fila.tomos}_`) && h2.includes('Índice del tomo 2'), 'tomo 2: portada, título e índice propio');
    assert(d.getElementById('expTomoAviso2').textContent === 'abierto ✓', 'aviso del tomo');
    w.abrirTomoExpediente(1);
    const h1 = await leerBlob(w, w._blobs[1]);
    assert(h1.includes('Contenido por tomo') && h1.includes('Ficha del proyecto'), 'tomo 1 con índice general');
    // Pestaña bloqueada: enlace en el panel
    w._bloquearPopups = true; w.abrirTomoExpediente(3);
    assert(d.getElementById('expTomoAviso3').querySelector('a[href^="blob:"]'), 'enlace de respaldo por tomo');
    // Reutilizar: el plan guardado reproduce el mismo corte
    await esperar(() => d.querySelector('#expedientesLista tbody tr'));
    w.reutilizarSeleccionExpediente(fila.id);
    await esperar(() => w._expedienteConteos);
    assert(textoEst(w).includes(`${fila.tomos} tomo(s)`), 'estimación con el plan guardado: ' + textoEst(w));
  });

  await prueba('generar: pestaña bloqueada muestra enlace; fallo tras insertar deja la fila en error', async () => {
    const fx = clonar(base); fx.expedientes_generados = [];
    const w = crearPagina(fx);
    w.document.getElementById('cardCierre').innerHTML = w.bloqueExpedienteHTML();
    await w.cargarExpedientesGenerados();
    await w.abrirModalExpediente();
    await esperar(() => w._expedienteConteos);
    w._bloquearPopups = true;
    await w.generarExpediente();
    const aviso = w.document.getElementById('expedienteAviso');
    assert(aviso.querySelector('a[href^="blob:"]') && aviso.textContent.includes('bloqueó'), 'enlace de respaldo');
    assert(w.document.getElementById('modalExpediente').classList.contains('show'), 'el modal sigue abierto para mostrar el enlace');
    w._bloquearPopups = false;
    w.eval("expedienteGenerarHTML = () => { throw new Error('boom'); }");
    w.console.error = () => {}; // el fallo es el esperado
    await w.generarExpediente();
    const fila = fx.expedientes_generados[1];
    assert(fila.estado === 'error' && fila.error_detalle === 'boom', 'fila en error: ' + JSON.stringify(fila));
    assert(w.toasts.some(t => t.tipo === 'error' && t.msg.includes('boom')), 'toast de error');
    assert(!w.document.getElementById('btnGenerarExpedienteOk').disabled, 'botón rehabilitado');
  });

  await prueba('proyecto no liquidado: el modal avisa de la marca de agua', async () => {
    const fx = clonar(base); fx.proyectos[0].estado_cierre = 'en_ejecucion';
    const w = crearPagina(fx);
    await w.abrirModalExpediente();
    assert(w.document.body.textContent.includes('marca de agua «Expediente parcial»'), 'aviso');
  });

  resumen();
})();
