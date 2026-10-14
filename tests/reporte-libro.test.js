// No regresión del reporte del libro de obra: ejecuta la función REAL
// generarReportePDF de index.html en jsdom (con el HTML real de #modalReporte y
// #modalVistaReporte) contra un fixture, y compara byte a byte el HTML que deja
// en #reporteContenido con el snapshot. La Curva S queda simulada (indicadores
// fijos e imagen fija) para que entren la tabla de ensayos y la proyección.
//
//   node reporte-libro.test.js            compara
//   node reporte-libro.test.js --grabar   (re)escribe los snapshots
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, leer, scriptPrincipal, extraerFuncion, fuenteSiExiste, crearSb, cargarFixture, prueba, resumen, assert } = require('./lib/arnes');

const GRABAR = process.argv.includes('--grabar');
const DIR_SNAP = path.join(__dirname, 'snapshots');
const html = leer(path.join(RAIZ, 'index.html'));
const src = scriptPrincipal(html);
const corte = (desde, hasta) => { const i = html.indexOf(desde), j = html.indexOf(hasta, i); assert(i > 0 && j > i, 'bloque ' + desde); return html.slice(i, j); };
const MODALES = corte('<div class="modal-overlay" id="modalReporte">', '<div class="modal-overlay" id="modalResumenIA"') + corte('<div class="modal-overlay" id="modalVistaReporte"', '<div class="modal-overlay" id="modalCronograma"');
// Funciones del script principal (las que el refactor mueva a expediente.js se cargan desde allí).
const FUNCIONES = ['generarReportePDF', 'traerPaginado', 'obtenerMontoContratoProyecto', 'puedeResumenIA', 'cerrarModal', 'formatoKSinSigno', 'climaIcon', 'escAttr'];
const CODIGO = [leer(path.join(RAIZ, 'constantes.js')), leer(path.join(RAIZ, 'expediente.js')), FUNCIONES.map(f => fuenteSiExiste(src, f)).join('\n')].join('\n');
const FIJA = new Date('2026-10-14T15:00:00Z').getTime();

function crearPagina(fixture){
  const dom = new JSDOM(`<!doctype html><html><body><div id="toast"></div>${MODALES}</body></html>`, { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  class FechaFija extends w.Date { constructor(...a){ super(...(a.length ? a : [FIJA])); } static now(){ return FIJA; } }
  w.Date = FechaFija;
  w.toasts = []; w.toast = (msg, tipo) => w.toasts.push({ msg, tipo });
  w.sb = crearSb(fixture);
  w.currentProyecto = fixture.proyectos[0].id;
  w.currentPerfil = { rol: 'admin', nombre: 'Prueba', apellido: 'Admin' };
  w.proyectos = fixture.proyectos;
  // Curva S simulada: datos cargados "a mano", sin canvas
  w.cronogramaData = []; w.curvaSModo = 'semanas'; w._lbActiva = null;
  w.cargarCurvaS = async () => {};
  w.calcularIndicadoresPuro = () => ({ avanceRealTotal: 42.5, SPI: 0.95, totalProduccion: 54000, atrasados: 1, proyeccion: null });
  w.generarImagenGraficoCurvaS = async () => 'data:image/png;base64,iVBORw0KGgo=';
  w.prepararResumenInforme = async () => null;
  w.eval(CODIGO);
  return w;
}

function comparar(nombreSnap, contenido){
  const ruta = path.join(DIR_SNAP, nombreSnap);
  if(GRABAR || !fs.existsSync(ruta)){
    fs.writeFileSync(ruta, contenido);
    console.log('    (snapshot ' + (GRABAR ? 'grabado' : 'creado') + ': ' + nombreSnap + ', ' + contenido.length + ' caracteres)');
    return;
  }
  const esperado = leer(ruta);
  if(esperado !== contenido){
    const i = [...esperado].findIndex((c, k) => c !== contenido[k]);
    fs.writeFileSync(ruta + '.actual', contenido);
    throw new Error(`difiere del snapshot ${nombreSnap} en la posición ${i}: esperado «${esperado.slice(i, i + 60)}» vs actual «${contenido.slice(i, i + 60)}»`);
  }
}

async function correr(etiqueta, fixture, { tipo = 'gerente', fotos = true, rubros = true, curvaS = true } = {}){
  await prueba(`${etiqueta}: generarReportePDF (${tipo}${fotos ? ', fotos' : ''}${rubros ? ', rubros' : ''}${curvaS ? ', curva S y ensayos' : ''})`, async () => {
    const w = crearPagina(fixture);
    const d = w.document;
    // Todo el año: entran todos los registros y los ensayos del fixture
    d.getElementById('reporteFechaInicio').value = '2026-01-01';
    d.getElementById('reporteFechaFin').value = '2026-12-31';
    d.getElementById('reporteTipo').value = tipo;
    ['rptActividades', 'rptEquipos', 'rptMateriales', 'rptNovedades', 'rptCuadroRubros', 'rptFiscalizacion', 'rptPlanillas'].forEach(id => { d.getElementById(id).checked = true; });
    d.getElementById('rptRubros').checked = rubros;
    d.getElementById('rptFotos').checked = fotos;
    d.getElementById('rptCurvaS').checked = curvaS;
    d.getElementById('rptResumenIA').checked = false;
    d.getElementById('rptNovedadesPeriodo').value = 'Novedades de prueba del período.';
    d.getElementById('rptActividadesSiguiente').value = '';
    await w.generarReportePDF();
    const contenido = d.getElementById('reporteContenido').innerHTML;
    assert(contenido.includes('Registros del Período') && contenido.includes('Registro N°'), 'reporte generado');
    assert(!/\bundefined\b|\bNaN\b/.test(contenido), 'sin undefined ni NaN');
    if(curvaS) assert(contenido.includes('Control de Calidad') === fixture.ensayos.length > 0, 'tabla de ensayos según el fixture');
    comparar(`reporte-libro-${tipo}${fotos ? '' : '-sinfotos'}.${etiqueta}.html`, contenido);
  });
}

(async () => {
  console.log('reporte-libro.test.js' + (GRABAR ? ' (grabando snapshots)' : ''));
  const sint = cargarFixture('sintetico.json');
  await correr('sintetico', sint);
  await correr('sintetico', sint, { tipo: 'cliente', fotos: false, rubros: false, curvaS: false });
  const real = cargarFixture('parqueadero.real.json');
  if(real) await correr('parqueadero.real', real);
  else console.log('  (sin fixture real: se omite parqueadero.real.json)');
  resumen();
})();
