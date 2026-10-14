// Pruebas del expediente de obra: expedienteCargarDatos contra el cliente simulado,
// expedienteGenerarHTML (función pura) sobre el fixture sintético y, si existe,
// sobre el real de Parqueadero; estimación y nombre de archivo.
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, crearSb, crearContexto, cargarFixture, prueba, resumen, assert } = require('./lib/arnes');

const codigo = [
  { ruta: path.join(RAIZ, 'constantes.js'), nombre: 'constantes.js' },
  { ruta: path.join(RAIZ, 'expediente.js'), nombre: 'expediente.js' }
];
const META = { version: 3, generadoEn: '2026-10-14T15:05:00Z', generadoPor: 'Prueba Fiscalizador', rol: 'fiscalizador', hoy: '2026-10-14', logoDataUri: 'data:image/png;base64,iVBORw0KGgo=' };
const SEL_COMPLETO = {
  preset: 'completo',
  secciones: ['portada', 'indice', 'contrato', 'presupuesto', 'ordenes_cambio', 'cronograma', 'libro_obra', 'planillas', 'actas', 'liquidacion'],
  filtros: { incluirOCsNoAprobadas: true, detallePlanillas: true },
  subtitulo: 'Project close-out dossier'
};
const FASE1 = ['portada', 'indice', 'contrato', 'presupuesto', 'ordenes_cambio', 'planillas', 'actas', 'liquidacion'];
const clonar = o => JSON.parse(JSON.stringify(o));
const ctx = () => crearContexto({ codigo });
async function cargar(fixture, sel = SEL_COMPLETO){
  const c = ctx();
  const datos = await c.expedienteCargarDatos(fixture.proyectos[0].id, sel, crearSb(fixture));
  return { c, datos };
}
function sinBasura(html){
  const m = html.match(/\b(undefined|NaN|null)\b/);
  assert(!m, 'el HTML contiene «' + (m && m[0]) + '» cerca de: ' + (m ? html.slice(Math.max(0, m.index - 80), m.index + 40) : ''));
}
const tieneSec = (html, clave) => html.includes(`id="sec-${clave}"`);

(async () => {
  console.log('expediente.test.js');
  const fx = cargarFixture('sintetico.json');

  await prueba('helpers canónicos viven en expediente.js (montoContratoProyecto, agregarPlanillas, semaforoGarantia)', () => {
    const c = ctx();
    assert(typeof c.montoContratoProyecto === 'function' && typeof c.agregarPlanillas === 'function' && typeof c.semaforoGarantia === 'function', 'faltan helpers');
    assert(c._eval('MONTO_CONTRATO_TOLERANCIA') === 1 && c._eval('PLANILLAS_COMPROMETIDAS').join() === 'aprobada,pagada', 'faltan constantes');
    const venc = c.semaforoGarantia(fx.garantias[1], '2026-10-14');
    assert(venc.label === 'Vencida hace 55 día(s)', 'semáforo a fecha fija: ' + venc.label);
    assert(c.semaforoGarantia(fx.garantias[0], '2026-10-14').label.startsWith('Vigente · '), 'garantía vigente');
    assert(typeof c.semaforoGarantia(fx.garantias[0]).label === 'string', 'sin fecha usa la actual');
  });

  await prueba('expedienteCargarDatos arma el objeto plano con todas las tablas', async () => {
    const { datos } = await cargar(fx);
    assert(datos.proyecto.nombre === 'Puente peatonal Las Palmas', 'proyecto');
    assert(datos.rubros.length === 11 && datos.rubros[0].codigo === '1' && datos.rubros[10].codigo === 'OC-01-01', 'rubros en orden');
    assert(datos.ordenesCambio.length === 2 && datos.ordenesCambio[0].items.length === 3 && datos.ordenesCambio[1].items.length === 1, 'OCs con ítems');
    assert(datos.planillas.length === 2 && datos.planillas[0].rubros.length === 5 && datos.planillas[1].rubros.length === 8, 'planillas con rubros');
    assert(datos.planillas[0].historial.length === 2, 'historial');
    assert(datos.planillas[1].rubros[0].rubro_id === 'f0000000-0000-4000-8000-000000000003', 'rubros de planilla en el orden del presupuesto');
    assert(datos.actas.length === 2 && datos.liquidacion && datos.anticipo && datos.garantias.length === 2 && datos.reajusteTerminos.length === 3, 'resto de tablas');
    assert(datos.perfiles['b0000000-0000-4000-8000-000000000002'] === 'Prueba Fiscalizador', 'perfiles');
    assert(JSON.stringify(datos).length > 1000, 'serializable');
  });

  await prueba('expedienteSelectTodo pagina de 1000 en 1000 y lanza error si una llamada falla', async () => {
    const c = ctx();
    const muchas = { filas: Array.from({ length: 2350 }, (_, i) => ({ id: i })) };
    const sb = crearSb(muchas);
    const todas = await c.expedienteSelectTodo(() => sb.from('filas').select('*'));
    assert(todas.length === 2350, 'junta todas las páginas: ' + todas.length);
    assert(sb.llamadas.filter(l => l.tabla === 'filas').length === 3, 'tres llamadas de 1000');
    let fallo = null;
    try{ await c.expedienteSelectTodo(() => ({ range: async () => ({ data: null, error: { message: 'boom' } }) })); }catch(e){ fallo = e; }
    assert(fallo && /boom/.test(fallo.message), 'propaga el error');
  });

  let htmlCompleto = '';
  await prueba('generación completa: secciones, totales, subtítulo, sin marca de agua, sin basura', async () => {
    const { c, datos } = await cargar(fx);
    const html = c.expedienteGenerarHTML(datos, SEL_COMPLETO, META);
    htmlCompleto = html;
    assert(html.startsWith('<!doctype html>') && html.trim().endsWith('</html>'), 'documento completo');
    FASE1.forEach(k => assert(tieneSec(html, k), 'falta la sección ' + k));
    assert(!html.includes('EXPEDIENTE PARCIAL'), 'proyecto liquidado: sin marca de agua');
    assert(html.includes('Project close-out dossier'), 'subtítulo');
    assert(html.includes('Expediente v3 · generado el 14 de octubre de 2026 por Prueba Fiscalizador (fiscalizador)'), 'línea de versión');
    assert(html.includes(META.logoDataUri), 'logo incrustado');
    assert(!html.includes('cdn.gamma.app') && !html.includes('hidivo.com/vendor'), 'ningún logo remoto');
    sinBasura(html);
    // Totales del presupuesto = Σ fixture
    const suma = fx.rubros.reduce((s, r) => s + r.monto_contrato, 0);
    assert(suma === 128498, 'fixture: suma vigente');
    assert(html.includes(c.fmtUSD(suma)), 'total vigente del presupuesto');
    assert(html.includes('Contractual: ' + c.fmtUSD(124218)), 'total contractual');
    assert(html.includes('⚠ Contrato ' + c.fmtUSD(124218)), 'indicador registro vs vigente');
    assert(!html.includes('difiere del monto contractual registrado más'), 'vigente = contractual + OCs: sin nota');
    // Resumen de planillas = agregarPlanillas
    const agg = c.agregarPlanillas(fx.planillas_pago);
    ['planillado', 'reajustes', 'amortizado', 'retenido', 'multas', 'liquido'].forEach(k => assert(html.includes(c.fmtUSD(agg[k])), 'total de planillas ' + k));
    assert(html.includes('Aprobadas o pagadas (2)'), 'conteo de planillas comprometidas');
    assert(html.includes('OC-02') && html.includes('Cambio de luminarias'), 'OC en borrador incluida por el filtro');
    assert(html.includes('Cant. periodo'), 'detalle por rubro');
    assert(html.includes('Precios unitarios tal como quedaron guardados'), 'nota de precios guardados');
    assert(html.includes('índices: A = 1,02'), 'índices de reajuste usados');
    assert(html.includes('Retraso de 5 días'), 'concepto de multa');
    assert(html.includes('Suma de coeficientes') && !html.includes('debería ser 1,000'), 'coeficientes suman 1');
    assert(!html.includes('contenteditable'), 'nunca contenteditable');
    assert(html.includes('Vencida hace 55 día(s)') && html.includes('Vigente · '), 'semáforo de garantías a la fecha fija');
    // Secciones con datos: no aparecen los textos de vacío
    ['Sin fórmula polinómica registrada', 'No emitida a la fecha de generación', 'Pendiente de liquidación', 'Sin anticipo registrado', 'Sin garantías registradas'].forEach(t => assert(!html.includes(t), 'no debe decir «' + t + '»'));
  });

  await prueba('estructura con jsdom: título, secciones, thead en tablas, documentos incrustados', () => {
    const dom = new JSDOM(htmlCompleto);
    const d = dom.window.document;
    assert(d.title === 'Expediente_Puente-peatonal-Las-Palmas_v3_2026-10-14', 'title = nombre de archivo: ' + d.title);
    assert(d.querySelectorAll('section.sec').length === 10, '10 secciones de primer nivel (8 de fase 1 + cronograma y libro de obra, activos desde la fase 2)');
    assert(d.querySelectorAll('section.oc-doc').length === 2, 'dos OC incrustadas');
    assert(d.querySelectorAll('section.sub[id^="planilla-"]').length === 2, 'dos planillas');
    assert(d.querySelectorAll('section.doc-cierre').length === 3, 'dos actas y la liquidación');
    d.querySelectorAll('table.tabla:not(.kv)').forEach(t => assert(t.querySelector('thead'), 'tabla sin thead'));
    assert(d.querySelector('.ui-barra button'), 'botón imprimir');
    assert(d.querySelector('header.enc-pagina img') && d.querySelector('footer.pie-pagina'), 'encabezado y pie');
    assert(d.querySelector('ol.indice').querySelectorAll(':scope > li').length === 10, 'índice con 10 entradas');
    assert(d.querySelectorAll('ol.indice ol.indice-sub').length === 4, 'subsecciones de OC, libro (meses), planillas y actas');
  });

  await prueba('selección parcial: lo desmarcado no sale y el índice lo declara', async () => {
    const { c, datos } = await cargar(fx);
    const sel = { preset: null, secciones: ['contrato', 'presupuesto'], filtros: { incluirOCsNoAprobadas: false, detallePlanillas: false } };
    const html = c.expedienteGenerarHTML(datos, sel, META);
    ['portada', 'indice', 'contrato', 'presupuesto'].forEach(k => assert(tieneSec(html, k), 'falta ' + k));
    ['ordenes_cambio', 'planillas', 'actas', 'liquidacion'].forEach(k => assert(!tieneSec(html, k), 'sobra ' + k));
    assert(!html.includes('class="sub oc-doc"') && !html.includes('Planilla N°'), 'sin documentos incrustados');
    const noIncluye = (html.match(/Este expediente no incluye:<\/b> ([^<]*)/) || [])[1] || '';
    ['Órdenes de cambio;', 'Planillas de pago;', 'Actas de recepción;', 'Liquidación.', 'Chat del proyecto (anexo, solo canales) (disponible próximamente);'].forEach(t => assert(noIncluye.includes(t), 'no incluidas: falta «' + t + '» en: ' + noIncluye));
    assert(!noIncluye.includes('Contrato') && !noIncluye.includes('Presupuesto'), 'las incluidas no aparecen como excluidas');
    assert(html.includes('solo órdenes de cambio aprobadas; planillas sin detalle por rubro'), 'filtros declarados');
    sinBasura(html);
  });

  await prueba('filtros: OCs no aprobadas y detalle por rubro', async () => {
    const { c, datos } = await cargar(fx);
    const html = c.expedienteGenerarHTML(datos, { secciones: FASE1, filtros: { incluirOCsNoAprobadas: false, detallePlanillas: false } }, META);
    assert(html.includes('OC-01') && !html.includes('OC-02'), 'solo la aprobada');
    assert(!html.includes('Cant. periodo'), 'sin detalle por rubro');
    assert(html.includes('Líquido a pagar'), 'el desglose sigue');
    assert(html.includes('Aprobadas: 1 · monto neto'), 'resumen de OC');
    sinBasura(html);
  });

  await prueba('marca de agua cuando el proyecto no está liquidado', async () => {
    const f2 = clonar(fx); f2.proyectos[0].estado_cierre = 'recepcion_provisional';
    const { c, datos } = await cargar(f2);
    const html = c.expedienteGenerarHTML(datos, SEL_COMPLETO, META);
    assert(html.includes('EXPEDIENTE PARCIAL – PROYECTO EN EJECUCIÓN') && html.includes('<body class="parcial">'), 'marca de agua');
    assert(html.includes('Recepción provisional'), 'estado legible');
    sinBasura(html);
  });

  await prueba('secciones sin datos lo dicen explícitamente (nunca una tabla vacía)', async () => {
    const f2 = clonar(fx);
    f2.reajuste_terminos = []; f2.actas_recepcion = []; f2.liquidaciones = []; f2.contrato_anticipo = []; f2.garantias = [];
    f2.ordenes_cambio = []; f2.orden_cambio_items = []; f2.planillas_pago = []; f2.planilla_rubros = []; f2.planilla_historial = [];
    f2.proyectos[0].contrato_datos = null; f2.proyectos[0].estado_cierre = 'en_ejecucion';
    const { c, datos } = await cargar(f2);
    const html = c.expedienteGenerarHTML(datos, SEL_COMPLETO, META);
    ['Sin fórmula polinómica registrada', 'No emitida a la fecha de generación', 'Pendiente de liquidación', 'Sin anticipo registrado',
     'Sin garantías registradas', 'Sin órdenes de cambio registradas', 'Sin planillas registradas'].forEach(t => assert(html.includes(t), 'falta «' + t + '»'));
    assert((html.match(/No emitida a la fecha de generación/g) || []).length === 2, 'una por acta');
    assert(!html.includes('<tbody></tbody>'), 'sin tablas vacías');
    sinBasura(html);
  });

  await prueba('columnas contractuales solo si vienen en la fila', async () => {
    const f2 = clonar(fx);
    f2.rubros.forEach(r => { delete r.cantidad_contractual; delete r.precio_contractual; });
    const { c, datos } = await cargar(f2);
    const html = c.expedienteGenerarHTML(datos, SEL_COMPLETO, META);
    assert(!html.includes('Cant. contractual') && !html.includes('Contractual: '), 'sin columnas contractuales');
    assert(htmlCompleto.includes('Cant. contractual'), 'con columnas cuando existen');
    sinBasura(html);
  });

  await prueba('nota al pie cuando el vigente no cuadra con contractual + OCs aprobadas', async () => {
    const f2 = clonar(fx); f2.proyectos[0].monto_contrato = 120000;
    const { c, datos } = await cargar(f2);
    const html = c.expedienteGenerarHTML(datos, SEL_COMPLETO, META);
    assert(html.includes('difiere del monto contractual registrado más las órdenes de cambio aprobadas (' + c.fmtUSD(124280) + ')'), 'nota al pie');
  });

  await prueba('contrato_datos con estructura variable se renderiza clave/valor con listas y tablas', async () => {
    const { c, datos } = await cargar(fx);
    const html = c.expedienteGenerarHTML(datos, SEL_COMPLETO, META);
    assert(html.includes('Otros datos extraídos del contrato'), 'bloque genérico');
    assert(html.includes('<th>Fecha suscripcion contrato</th><td>2026-01-15</td>'), 'clave legible');
    assert(html.includes('<ul class="lista"><li>primer punto</li><li>segundo punto</li></ul>'), 'lista');
    assert(html.includes('150 días calendario'), 'plazo en la ficha');
  });

  await prueba('estimación de páginas según la fórmula documentada', async () => {
    const { c, datos } = await cargar(fx);
    // Fase 2 (por unidades): 2 (portada+índice) + contrato 2 + presupuesto ⌈11/45⌉ + OC (1+⌈3/45⌉)+(1+⌈1/45⌉)
    // + cronograma 2+⌈3/45⌉ + libro feb ⌈0,6·2+3/6⌉ + mar ⌈0,6·1+1/6⌉ + planillas 1+(1+1)+(1+1) + actas 2 + liquidación 1 = 23
    const e1 = c.expedienteEstimar(datos, SEL_COMPLETO);
    assert(e1.paginas === 23 && e1.tomos.length === 1, 'completo: ' + e1.paginas);
    assert(e1.filas.presupuesto === 11 && e1.filas.ordenes_cambio === 2 && e1.filas.planillas === 2 && e1.filas.actas === 2 && e1.filas.liquidacion === 1, 'conteos');
    const e2 = c.expedienteEstimar(datos, { secciones: FASE1, filtros: { incluirOCsNoAprobadas: false, detallePlanillas: false } });
    assert(e2.paginas === 13 && e2.filas.ordenes_cambio === 1, 'solo aprobadas y sin detalle: ' + e2.paginas);
    const e3 = c.expedienteEstimar(datos, { secciones: [], filtros: {} });
    assert(e3.paginas === 2 && e3.secciones.join() === 'portada,indice', 'mínimo: portada e índice');
  });

  await prueba('nombre de archivo: slug sin tildes ni símbolos, máximo 40 caracteres', () => {
    const c = ctx();
    const n = c.expedienteNombreArchivo({ nombre: 'VÍA DE ACCESO A LA LOMA (Alternativa Base Granular Estabilizada con Cal)' }, 2, '2026-10-14T15:00:00Z');
    assert(n === 'Expediente_VIA-DE-ACCESO-A-LA-LOMA-Alternativa-Base_v2_2026-10-14', n);
    assert(c.expedienteNombreArchivo({ nombre: 'Construcción de parqueadero adoquinado tipo barza al lado de planta' }, 1, '2026-10-14') === 'Expediente_Construccion-de-parqueadero-adoquinado_v1_2026-10-14', 'corta en palabra entera');
    assert(c.expedienteNombreArchivo({ nombre: 'Abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ' }, 1, '2026-10-14') === 'Expediente_Abcdefghijklmnopqrstuvwxyz0123456789ABCD_v1_2026-10-14', 'sin guiones: corte duro a 40');
    assert(c.expedienteNombreArchivo({ nombre: 'Puente peatonal Las Palmas' }, 3, '2026-10-14') === 'Expediente_Puente-peatonal-Las-Palmas_v3_2026-10-14', 'simple');
    assert(c.expedienteNombreArchivo({ nombre: '¿?' }, 1, '2026-10-14') === 'Expediente_proyecto_v1_2026-10-14', 'sin caracteres válidos');
  });

  await prueba('formateadores: fecha sin huso horario, hora de Ecuador, números', () => {
    const c = ctx();
    assert(c.expFmtFecha('2026-03-05') === '05/03/2026' && c.expFmtFecha(null) === '—', 'fecha');
    assert(c.expFmtFechaHora('2026-10-14T15:05:00Z') === '14/10/2026, 10:05', 'hora de Ecuador: ' + c.expFmtFechaHora('2026-10-14T15:05:00Z'));
    assert(c.expFmtNum(1234.5678, 3) === '1.234,568', 'número: ' + c.expFmtNum(1234.5678, 3));
    assert(c.fmtUSD(-1900) === '−$1.900,00', 'negativo');
    assert(c.expRenderJSON(null) === '—' && c.expRenderJSON(true) === 'Sí', 'json');
  });

  const real = cargarFixture('parqueadero.real.json');
  if(real){
    await prueba('fixture real (Parqueadero): genera sin basura y con todas las secciones', async () => {
      const { c, datos } = await cargar(real);
      const html = c.expedienteGenerarHTML(datos, SEL_COMPLETO, META);
      FASE1.forEach(k => assert(tieneSec(html, k), 'falta ' + k));
      assert(html.includes('EXPEDIENTE PARCIAL'), 'en ejecución: marca de agua');
      assert(html.includes('Sin fórmula polinómica registrada') && html.includes('Pendiente de liquidación'), 'vacíos reales');
      assert((html.match(/Planilla N° 1/g) || []).length >= 2, 'la planilla N°1 duplicada se muestra tal cual');
      sinBasura(html);
    });
  } else console.log('  (sin fixture real: se omite parqueadero.real.json)');

  resumen();
})();
