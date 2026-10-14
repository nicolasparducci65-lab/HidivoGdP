// Modal, lista y flujo de generación del expediente: ejecuta las funciones
// REALES de index.html dentro de un documento jsdom con el HTML del modal y un
// bloque de Cierre, contra el cliente simulado.
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
  'reutilizarSeleccionExpediente', 'abrirModalExpediente', 'renderModalExpediente', 'aplicarPresetExpediente', 'expedienteCambioManual',
  'leerSeleccionExpediente', 'actualizarEstimacionExpediente', 'obtenerLogoDataUri', 'generarExpediente', 'cerrarModal', 'hoyEcuador'];
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
  w.eval(extra ? CODIGO + String.fromCharCode(10) + extra : CODIGO);
  w._blobs = blobs; w._ventanas = ventanas;
  return w;
}
const tick = () => new Promise(r => setTimeout(r, 0));
// El Blob de jsdom no tiene .text(): se lee con FileReader.
const leerBlob = (w, blob) => new Promise((res, rej) => { const r = new w.FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(blob); });
const esperar = async (fn, n = 50) => { for(let i = 0; i < n; i++){ if(fn()) return true; await tick(); } return fn(); };

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

  await prueba('lista: versión, fecha de Ecuador, usuario, preset, secciones, estado y reutilizar', async () => {
    const fx = clonar(base);
    fx.expedientes_generados = [
      { id: 'x1', proyecto_id: fx.proyectos[0].id, version: 1, generado_por: 'b0000000-0000-4000-8000-000000000002', generado_en: '2026-10-14T15:05:00Z', preset: 'completo', secciones: ['portada', 'indice', 'contrato'], filtros: { incluirOCsNoAprobadas: true, detallePlanillas: true }, estado: 'listo', subtitulo: 'Dossier' },
      { id: 'x2', proyecto_id: fx.proyectos[0].id, version: 2, generado_por: 'b0000000-0000-4000-8000-000000000001', generado_en: '2026-10-14T16:00:00Z', preset: null, secciones: ['portada', 'indice'], filtros: {}, estado: 'error', error_detalle: 'falló' }
    ];
    const w = crearPagina(fx);
    w.document.getElementById('cardCierre').innerHTML = w.bloqueExpedienteHTML();
    await w.cargarExpedientesGenerados();
    const filas = [...w.document.querySelectorAll('#expedientesLista tbody tr')];
    assert(filas.length === 2 && filas[0].textContent.includes('v2'), 'orden descendente por versión');
    assert(filas[1].textContent.includes('14/10/2026, 10:05') && filas[1].textContent.includes('Prueba Fiscalizador') && filas[1].textContent.includes('Completo (interno)') && filas[1].textContent.includes('Listo'), 'fila v1: ' + filas[1].textContent);
    assert(filas[0].textContent.includes('Personalizado') && filas[0].textContent.includes('Prueba Admin') && filas[0].querySelector('span[title="falló"]'), 'fila v2 con error y detalle');
    assert(filas[0].querySelector('button') && filas[0].querySelector('button').textContent.includes('Reutilizar'), 'botón reutilizar');
    w.reutilizarSeleccionExpediente('x1');
    await esperar(() => w._expedienteDatos);
    assert(w.document.getElementById('modalExpediente').classList.contains('show'), 'abre el modal');
    const sel = w.leerSeleccionExpediente();
    assert(sel.preset === 'completo' && sel.subtitulo === 'Dossier' && sel.secciones.join() === 'portada,indice,contrato' && sel.filtros.incluirOCsNoAprobadas === true, 'selección reutilizada: ' + JSON.stringify(sel));
  });

  await prueba('modal: preset completo por defecto, secciones futuras deshabilitadas, conteos y estimación', async () => {
    const w = crearPagina(clonar(base));
    w.document.getElementById('cardCierre').innerHTML = w.bloqueExpedienteHTML();
    await w.cargarExpedientesGenerados();
    await w.abrirModalExpediente();
    const d = w.document;
    assert(d.querySelector('input[name="expPreset"][value="completo"]').checked, 'preset completo marcado');
    assert(d.getElementById('chk-exp-portada').disabled && d.getElementById('chk-exp-portada').checked, 'portada fija');
    assert(d.getElementById('chk-exp-libro_obra').disabled && d.getElementById('chk-exp-chat').disabled, 'fases 2 y 3 deshabilitadas');
    assert((d.body.textContent.match(/próximamente/g) || []).length === 10, '10 secciones próximamente');
    assert(d.getElementById('cnt-exp-presupuesto').textContent === '(11)' && d.getElementById('cnt-exp-ordenes_cambio').textContent === '(2)' && d.getElementById('cnt-exp-actas').textContent === '(2 de 2)', 'conteos');
    assert(d.getElementById('expedienteEstimacion').textContent === '8 secciones · ≈ 17 páginas (estimación)', 'estimación: ' + d.getElementById('expedienteEstimacion').textContent);
    assert(d.body.textContent.includes('Portada e índice se incluyen siempre') && !d.body.textContent.includes('marca de agua'), 'proyecto liquidado: sin aviso de parcial');
    // preset contratante: sin chat y sin OCs no aprobadas
    w.aplicarPresetExpediente('contratante');
    let sel = w.leerSeleccionExpediente();
    assert(sel.preset === 'contratante' && !sel.secciones.includes('chat') && sel.filtros.incluirOCsNoAprobadas === false && sel.filtros.detallePlanillas === true, 'preset contratante');
    assert(d.getElementById('cnt-exp-ordenes_cambio').textContent === '(1 aprobadas)' && d.getElementById('expedienteEstimacion').textContent.includes('≈ 15 páginas'), 'estimación con filtro');
    // ajuste manual: desmarca el preset
    d.getElementById('chk-exp-planillas').checked = false; w.expedienteCambioManual();
    sel = w.leerSeleccionExpediente();
    assert(sel.preset === null && !sel.secciones.includes('planillas') && !d.querySelector('input[name="expPreset"]:checked'), 'personalizado');
    assert(d.getElementById('expedienteEstimacion').textContent.includes('7 secciones · ≈ 10 páginas'), 'estimación sin planillas: ' + d.getElementById('expedienteEstimacion').textContent);
    d.getElementById('expSubtitulo').value = 'Cierre'; w.expedienteCambioManual(true);
    assert(w.leerSeleccionExpediente().subtitulo === 'Cierre', 'subtítulo');
  });

  await prueba('generar: inserta con origen navegador y estado listo, genera con la versión de la base y abre la vista previa', async () => {
    const fx = clonar(base); fx.expedientes_generados = [];
    const w = crearPagina(fx);
    w.document.getElementById('cardCierre').innerHTML = w.bloqueExpedienteHTML();
    await w.cargarExpedientesGenerados();
    await w.abrirModalExpediente();
    w.document.getElementById('expSubtitulo').value = 'Project close-out dossier';
    await w.generarExpediente();
    const fila = fx.expedientes_generados[0];
    assert(fila && fila.origen === 'navegador' && fila.estado === 'listo' && fila.generado_por === w.currentUser.id && fila.preset === 'completo', 'fila insertada: ' + JSON.stringify(fila));
    assert(Array.isArray(fila.secciones) && fila.secciones.includes('liquidacion') && fila.filtros.incluirOCsNoAprobadas === true && fila.estado_proyecto === 'liquidado' && fila.paginas_estimadas === 17 && fila.subtitulo === 'Project close-out dossier', 'campos de la fila');
    assert(w._ventanas.length === 1 && w._ventanas[0].url.startsWith('blob:'), 'pestaña con el Blob');
    const html = await leerBlob(w, w._blobs[0]);
    assert(html.includes('<title>Expediente_Puente-peatonal-Las-Palmas_v1_') && html.includes('Expediente v1 · generado el') && html.includes('por Prueba Admin (admin)'), 'documento con la versión de la base');
    assert(html.includes('data:image/png;base64,'), 'logo incrustado desde vendor/');
    assert(w._logoDataUri && w._logoDataUri.startsWith('data:image/png;base64,'), 'logo cacheado');
    assert(!w.document.getElementById('modalExpediente').classList.contains('show'), 'cierra el modal');
    assert(w.toasts.some(t => t.msg === 'Expediente v1 generado ✓'), 'toast');
    await esperar(() => w.document.querySelector('#expedientesLista tbody tr'));
    assert(w.document.querySelector('#expedientesLista tbody tr').textContent.includes('v1'), 'la lista se refresca');
    // segunda generación: la base asigna v2 y el modal precarga la última selección
    await w.abrirModalExpediente();
    assert(w.leerSeleccionExpediente().subtitulo === 'Project close-out dossier', 'precarga del último expediente');
    await w.generarExpediente();
    assert(fx.expedientes_generados.length === 2 && (await leerBlob(w, w._blobs[1])).includes('Expediente v2 ·'), 'v2');
  });

  await prueba('generar: pestaña bloqueada muestra enlace; fallo tras insertar deja la fila en error', async () => {
    const fx = clonar(base); fx.expedientes_generados = [];
    const w = crearPagina(fx);
    w.document.getElementById('cardCierre').innerHTML = w.bloqueExpedienteHTML();
    await w.cargarExpedientesGenerados();
    await w.abrirModalExpediente();
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
