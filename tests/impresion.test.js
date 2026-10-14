// No regresión de las impresiones existentes: ejecuta las funciones REALES
// imprimirOC, imprimirActa e imprimirLiquidacion de index.html contra un
// fixture, captura el HTML que escriben en la ventana nueva y lo compara byte
// a byte con el snapshot guardado en tests/snapshots/.
//
//   node impresion.test.js            compara con los snapshots
//   node impresion.test.js --grabar   (re)escribe los snapshots
//
// Fixtures: sintetico.json (se commitea) y, si existe, parqueadero.real.json
// (datos reales, ignorado por git; su snapshot también).
//
// Historial de cambios deliberados en los snapshots:
//   · c9aaa73: la URL del logo pasó de cdn.gamma.app a vendor/logo-hidivo.png.
//   · Fase 2, commit 1: acta y liquidación envuelven cuerpo y firmas en
//     <div id="docCierreEditable"> (lo que «Guardar acta» persiste); es la única
//     diferencia con los snapshots anteriores. Las OC no cambian.
'use strict';
const fs = require('fs');
const path = require('path');
const { RAIZ, leer, scriptPrincipal, extraerFuncion, fuenteSiExiste, crearSb, crearContexto, cargarFixture, prueba, resumen, assert } = require('./lib/arnes');

const GRABAR = process.argv.includes('--grabar');
const DIR_SNAP = path.join(__dirname, 'snapshots');
fs.mkdirSync(DIR_SNAP, { recursive: true });

const src = scriptPrincipal();
const FUNCIONES = ['imprimirOC', 'obtenerMontoContratoProyecto', 'imprimirActa', 'imprimirLiquidacion', 'abrirVentanaDocCierre',
  'imprimirActaEPP', 'imprimirRegistroCapacitacion', 'imprimirInformeIncidente', 'imprimirPTE', 'sstGetProyecto'];
// Helpers que el refactor de la fase 2 mueve a expediente.js: se extraen de index.html
// solo mientras sigan allí (fuenteSiExiste devuelve '' si ya no están).
const HELPERS = ['formatFecha', 'escapeHtml', 'sstFilaDato', 'climaIcon', 'escAttr'];
const BLOQUES = [["const PTE_TIPOS = {", '};'], ["const sstEstiloTabla = ", null]];
function bloquesSiExisten(){
  let s = '';
  if(/^const PTE_TIPOS = \{/m.test(src)) s += require('./lib/arnes').extraerBloque(src, 'const PTE_TIPOS = {') + '\n';
  for(const c of ['sstEstiloTabla', 'sstEstiloTh', 'sstEstiloTd']) if(new RegExp('^const ' + c + ' = ', 'm').test(src)) s += require('./lib/arnes').extraerConst(src, c);
  return s;
}
const codigoBase = [
  { ruta: path.join(RAIZ, 'constantes.js'), nombre: 'constantes.js' },
  ...(fs.existsSync(path.join(RAIZ, 'expediente.js')) ? [{ ruta: path.join(RAIZ, 'expediente.js'), nombre: 'expediente.js' }] : []),
  bloquesSiExisten() + HELPERS.map(f => fuenteSiExiste(src, f)).join('\n') + '\n' + FUNCIONES.map(f => extraerFuncion(src, f)).join('\n')
];

function comparar(nombreSnap, html){
  const ruta = path.join(DIR_SNAP, nombreSnap);
  if(GRABAR || !fs.existsSync(ruta)){
    fs.writeFileSync(ruta, html);
    console.log('    (snapshot ' + (GRABAR ? 'grabado' : 'creado') + ': ' + nombreSnap + ', ' + html.length + ' caracteres)');
    return;
  }
  const esperado = leer(ruta);
  if(esperado !== html){
    const i = [...esperado].findIndex((c, k) => c !== html[k]);
    fs.writeFileSync(ruta + '.actual', html);
    throw new Error(`difiere del snapshot ${nombreSnap} en la posición ${i}: esperado «${esperado.slice(i, i+60)}» vs actual «${html.slice(i, i+60)}» (actual guardado en ${nombreSnap}.actual)`);
  }
}

async function correr(etiqueta, fixture){
  const proyectoId = fixture.proyectos[0].id;
  const sstCache = { eppEntregas: fixture.sst_epp_entregas || [], capacitaciones: fixture.sst_capacitaciones || [], incidentes: fixture.sst_incidentes || [], ptes: fixture.sst_pte || [] };
  const ctx = () => crearContexto({ codigo: codigoBase, globals: { sb: crearSb(fixture), currentProyecto: proyectoId, currentPerfil: null, proyectos: fixture.proyectos, sstCache } });

  for(const oc of fixture.ordenes_cambio){
    await prueba(`${etiqueta}: imprimirOC OC-${oc.numero} (${oc.estado})`, async () => {
      const c = ctx();
      await c.imprimirOC(oc.id);
      assert(c._ventanas.length === 1, 'debe abrir exactamente una ventana');
      const html = c._ventanas[0].html;
      assert(html.includes('ORDEN DE CAMBIO OC-' + String(oc.numero).padStart(2, '0')), 'el HTML lleva el título de la OC');
      assert(!/undefined|NaN/.test(html), 'sin undefined ni NaN');
      comparar(`oc-${oc.numero}.${etiqueta}.html`, html);
    });
  }
  for(const a of fixture.actas_recepcion){
    await prueba(`${etiqueta}: imprimirActa ${a.tipo}`, async () => {
      const c = ctx();
      await c.imprimirActa(a.id);
      assert(c._ventanas.length === 1, 'debe abrir exactamente una ventana');
      const html = c._ventanas[0].html;
      assert(html.includes('ACTA DE RECEPCIÓN ' + a.tipo.toUpperCase()), 'título del acta');
      assert(!/undefined|NaN/.test(html), 'sin undefined ni NaN');
      comparar(`acta-${a.tipo}.${etiqueta}.html`, html);
    });
  }
  // Impresiones SST: cuerpos que la fase 2 mueve a expediente.js.
  const sst = [
    ['imprimirActaEPP', 'sst_epp_entregas', 'acta-epp', 'Acta de Entrega-Recepción de EPP'],
    ['imprimirRegistroCapacitacion', 'sst_capacitaciones', 'capacitacion', 'Registro de Asistencia'],
    ['imprimirInformeIncidente', 'sst_incidentes', 'incidente', 'Informe de Investigación'],
    ['imprimirPTE', 'sst_pte', 'pte', 'Permiso de Trabajo Especial']
  ];
  for(const [funcion, tabla, nombre, titulo] of sst){
    for(const fila of (fixture[tabla] || []).slice(0, 2)){
      await prueba(`${etiqueta}: ${funcion} ${fila.numero ?? fila.tema ?? fila.trabajador_nombre ?? fila.id}`, async () => {
        const c = ctx();
        await c[funcion](fila.id);
        assert(c._ventanas.length === 1, 'debe abrir exactamente una ventana');
        const html = c._ventanas[0].html;
        assert(html.includes(titulo), 'título: ' + titulo);
        assert(!/undefined|NaN/.test(html), 'sin undefined ni NaN');
        comparar(`${nombre}-${(fila.numero ?? fila.id).toString().slice(0, 8)}.${etiqueta}.html`, html);
      });
    }
  }
  if(fixture.liquidaciones.length){
    await prueba(`${etiqueta}: imprimirLiquidacion`, async () => {
      const c = ctx();
      await c.imprimirLiquidacion();
      assert(c._ventanas.length === 1, 'debe abrir exactamente una ventana');
      const html = c._ventanas[0].html;
      assert(html.includes('LIQUIDACIÓN FINAL DE OBRA'), 'título de la liquidación');
      assert(!/undefined|NaN/.test(html), 'sin undefined ni NaN');
      comparar(`liquidacion.${etiqueta}.html`, html);
    });
  }
}

(async () => {
  console.log('impresion.test.js' + (GRABAR ? ' (grabando snapshots)' : ''));
  await correr('sintetico', cargarFixture('sintetico.json'));
  const real = cargarFixture('parqueadero.real.json');
  if(real) await correr('parqueadero.real', real);
  else console.log('  (sin fixture real: se omite parqueadero.real.json)');
  resumen();
})();
