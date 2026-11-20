// Reportes Globales: ejecuta la función REAL cargarReportesGlobales de index.html (con su barra de
// filtros) en jsdom. Cubre el fallo del 20-nov-2026: la barra de filtros usaba una variable local de
// otra función y la pantalla se quedaba en «Cargando reportes…».
//
//   node reportes-globales.test.js
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, leer, scriptPrincipal, extraerFuncion, extraerConst, crearSb, prueba, resumen, assert } = require('./lib/arnes');

const src = scriptPrincipal();
const CODIGO = [
  leer(path.join(RAIZ, 'constantes.js')), leer(path.join(RAIZ, 'expediente.js')),
  ...['reportesFiltroContratante', 'reportesFiltroDesde', 'reportesFiltroHasta', 'filtrosCartera', 'filtrosReportes'].map(c => extraerConst(src, c)),
  ...['cargarReportesGlobales', 'renderFiltrosReportes', 'multiempresaActiva', 'filtrarPorEmpresaTipo', 'opcionesEmpresaTipo', 'barraFiltroEmpresaTipo'].map(f => extraerFuncion(src, f)),
  'window._filtrosReportes = filtrosReportes; window._fijarContratante = v => { reportesFiltroContratante = v; };'
].join('\n');

const EMPRESAS = [
  { id: 'e-a', nombre: 'Alfa', sigla: 'ALF', es_gestora: true, activa: true },
  { id: 'e-b', nombre: 'Beta', sigla: 'BET', es_gestora: true, activa: true }
];
const FIXTURE = () => ({
  proyectos: [
    { id: 'p1', nombre: 'Proyecto Uno', contratante: 'C1', empresa_id: 'e-a', tipo: 'fiscalizacion' },
    { id: 'p2', nombre: 'Proyecto Dos', contratante: 'C2', empresa_id: 'e-b', tipo: 'pilotes' }
  ],
  libro_obra: [
    { id: 'l1', proyecto_id: 'p1', fecha: '2026-10-01', numero_registro: 1, personal_total: 5 },
    { id: 'l2', proyecto_id: 'p2', fecha: '2026-10-02', numero_registro: 1, personal_total: 7 }
  ],
  observaciones: [{ id: 'o1', proyecto_id: 'p1', estado: 'abierta', created_at: '2026-10-01T10:00:00Z' }],
  solicitudes: [{ id: 's1', proyecto_id: 'p2', estado: 'pendiente', created_at: '2026-10-02T10:00:00Z' }]
});

function montar(empresas){
  const dom = new JSDOM('<!doctype html><html><body><div id="reportesGlobalesContent"></div></body></html>', { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only' });
  const w = dom.window;
  w.sb = crearSb(FIXTURE());
  w.console = console;
  w.eval(CODIGO);
  w.fijarEmpresas(empresas);
  return { w, cont: w.document.getElementById('reportesGlobalesContent'), cerrar: () => w.close() };
}

(async () => {
  console.log('reportes-globales.test.js');

  await prueba('con multiempresa: la pantalla se pinta, con los selects de empresa y tipo', async () => {
    const t = montar(EMPRESAS);
    await t.w.cargarReportesGlobales();
    const html = t.cont.innerHTML;
    assert(!/Cargando reportes/.test(html), 'no se queda en «Cargando reportes…»');
    assert(t.cont.querySelector('#reportesContratanteSel'), 'pinta el filtro de contratante');
    assert(html.includes('filtrosReportes.empresa=this.value;cargarReportesGlobales()') && />Alfa</.test(html) && />Beta</.test(html), 'select de empresa con las dos gestoras');
    assert(html.includes('filtrosReportes.tipo=this.value;cargarReportesGlobales()') && />Pilotes</.test(html), 'select de tipo');
    t.cerrar();
  });

  await prueba('filtrar por empresa y por tipo vuelve a pintar sin error y ofrece «Limpiar filtros»', async () => {
    const t = montar(EMPRESAS);
    t.w._filtrosReportes.empresa = 'e-b';
    await t.w.cargarReportesGlobales();
    assert(!/Cargando reportes/.test(t.cont.innerHTML) && /Limpiar filtros/.test(t.cont.innerHTML), 'pinta con el filtro de empresa');
    assert(/<option value="e-b" selected/.test(t.cont.innerHTML), 'el select conserva la empresa elegida');
    t.w._filtrosReportes.tipo = 'fiscalizacion';   // ningún proyecto de Beta es de fiscalización
    await t.w.cargarReportesGlobales();
    assert(!/Cargando reportes/.test(t.cont.innerHTML) && t.cont.querySelector('#reportesContratanteSel'), 'sin proyectos que coincidan también pinta la barra');
    t.cerrar();
  });

  await prueba('base sin migrar (empresas sin sigla): pinta igual que antes, sin selects de empresa ni tipo', async () => {
    const t = montar([{ id: 'e-v', nombre: 'Vieja' }]);
    await t.w.cargarReportesGlobales();
    const html = t.cont.innerHTML;
    assert(!/Cargando reportes/.test(html) && t.cont.querySelector('#reportesContratanteSel'), 'pinta la pantalla');
    assert(!html.includes('filtrosReportes.empresa') && !html.includes('undefined'), 'sin barra de empresa/tipo y sin «undefined»');
    t.w._fijarContratante('C1');
    await t.w.cargarReportesGlobales();
    assert(/Limpiar filtros/.test(t.cont.innerHTML), 'el filtro de contratante sigue funcionando');
    t.cerrar();
  });

  await prueba('renderFiltrosReportes no depende de variables de otra función', () => {
    const cuerpo = extraerFuncion(src, 'renderFiltrosReportes');
    assert(!/barraEmpresaTipoRep/.test(cuerpo), 'usa su parámetro, no la constante local de cargarReportesGlobales');
  });

  resumen();
})();
