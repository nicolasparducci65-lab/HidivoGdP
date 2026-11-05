// Regla única de códigos de rubro en el frontend: ejecuta las funciones REALES de index.html
// (validarCodigoRubro, normalizarCodigoRubro, codigoItemOC, asignarCodigosItemsOC,
// validarCodigosItemsOC, planAprobacionOC, mensajeErrorRubro, filaExcelDelError, codigoDeError23505,
// guardarRubro en jsdom) contra fixtures sintéticos.
//
//   node oc-codigos.test.js
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, leer, scriptPrincipal, fuenteSiExiste, crearSb, crearContexto, prueba, resumen, assert } = require('./lib/arnes');

const src = scriptPrincipal(leer(path.join(RAIZ, 'index.html')));
const lineaFuncion = nombre => { const m = new RegExp('^function ' + nombre + '\\(.*$', 'm').exec(src); if(!m) throw new Error('No se encontró ' + nombre); return m[0] + '\n'; };
const FUNCIONES = ['validarCodigoRubro', 'asignarCodigosItemsOC', 'validarCodigosItemsOC', 'codigoRubroExiste', 'codigoDeError23505', 'mensajeErrorRubro', 'filaExcelDelError', 'planAprobacionOC', 'guardarRubro'];
const CODIGO = [leer(path.join(RAIZ, 'constantes.js')), leer(path.join(RAIZ, 'expediente.js')),
  lineaFuncion('normalizarCodigoRubro'), lineaFuncion('codigoItemOC'), ...FUNCIONES.map(f => fuenteSiExiste(src, f))].join('\n');
const P = 'a1000000-0000-4000-8000-000000000001';
const RUBROS = [
  { id: 'r1', proyecto_id: P, codigo: '1', descripcion: 'Uno', orden: 1, cantidad_contrato: 10, precio_unitario: 2 },
  { id: 'r2', proyecto_id: P, codigo: 'OC-03-01', descripcion: 'Ya nació de una OC', orden: 2, cantidad_contrato: 5, precio_unitario: 1 },
  { id: 'r3', proyecto_id: P, codigo: 'RN 9', descripcion: 'Con espacio', orden: 3, cantidad_contrato: 5, precio_unitario: 1 },
];
const e23505 = codigo => ({ code: '23505', message: 'duplicate key value violates unique constraint "rubros_proyecto_codigo_uniq"', details: `Key (proyecto_id, codigo)=(${P}, ${codigo}) already exists.` });

(async () => {
  console.log('oc-codigos.test.js');
  const ctx = crearContexto({ codigo: [CODIGO] });

  await prueba('validarCodigoRubro: obligatorio, ≤4 decimales si numérico, sin rachas; los no numéricos pasan', () => {
    assert(ctx.validarCodigoRubro('') && ctx.validarCodigoRubro('   ').includes('obligatorio'), 'vacío');
    for(const c of ['1.12345', '2.0199999999999996', '1.1300000000000001']) assert(ctx.validarCodigoRubro(c) && ctx.validarCodigoRubro(c).includes('ruido'), 'debe rechazar ' + c);
    for(const c of ['1.1234', '7', '2.10', '01', 'OC-01-03', 'CLI-04', 'RN 9', '1.1.1']) assert(ctx.validarCodigoRubro(c) === null, 'debe aceptar ' + c);
    assert(ctx.normalizarCodigoRubro('  RN   9 ') === 'RN 9' && ctx.normalizarCodigoRubro(null) === '', 'normaliza espacios');
  });

  await prueba('codigoItemOC y asignarCodigosItemsOC: OC-NN-SS en orden, saltando los códigos tomados en la OC y en el proyecto', () => {
    assert(ctx.codigoItemOC(3, 1) === 'OC-03-01' && ctx.codigoItemOC(12, 7) === 'OC-12-07');
    const items = [{ tipo: 'nuevo', codigo: '' }, { tipo: 'modificacion', rubro_id: 'r1' }, { tipo: 'nuevo', codigo: '  ' }, { tipo: 'nuevo', codigo: 'OC-03-02' }, { tipo: 'nuevo', codigo: null }];
    const asignados = ctx.asignarCodigosItemsOC(items, 3, RUBROS.map(r => r.codigo));
    // OC-03-01 ya existe en el proyecto y OC-03-02 lo escribió el usuario: los tres vacíos reciben 03, 04 y 05
    assert(asignados.join('|') === 'OC-03-03|OC-03-04|OC-03-05', asignados.join('|'));
    assert(items[0].codigo === 'OC-03-03' && items[2].codigo === 'OC-03-04' && items[4].codigo === 'OC-03-05' && items[3].codigo === 'OC-03-02' && !('codigo' in items[1]), JSON.stringify(items));
    assert(ctx.asignarCodigosItemsOC(items, 3, []).length === 0, 'segunda pasada: nada que asignar');
  });

  await prueba('validarCodigosItemsOC: repetido dentro de la OC, existente en el proyecto, vacío y ruido', () => {
    assert(ctx.validarCodigosItemsOC([{ tipo: 'nuevo', codigo: 'A' }, { tipo: 'nuevo', codigo: 'B' }, { tipo: 'modificacion' }], RUBROS) === null, 'válidos');
    assert(ctx.validarCodigosItemsOC([{ tipo: 'nuevo', codigo: 'A' }, { tipo: 'nuevo', codigo: ' A ' }], RUBROS).includes('repetido dentro de la orden'), 'repetido');
    assert(ctx.validarCodigosItemsOC([{ tipo: 'nuevo', codigo: 'RN 9' }], RUBROS).includes('Ya existe un rubro con el código RN 9'), 'existente');
    assert(ctx.validarCodigosItemsOC([{ tipo: 'nuevo', codigo: '' }], RUBROS).includes('obligatorio'), 'vacío');
    assert(ctx.validarCodigosItemsOC([{ tipo: 'nuevo', codigo: '1.12345' }], RUBROS).includes('ruido'), 'ruido');
  });

  await prueba('planAprobacionOC: dos ítems sin código → OC-05-01 y OC-05-02; existente → error; repetido → error', () => {
    const oc = { id: 'oc5', numero: 5, proyecto_id: P };
    const items = [{ tipo: 'nuevo', codigo: null, descripcion: 'A', cantidad: 1, precio_unitario: 2 }, { tipo: 'nuevo', codigo: '', descripcion: 'B', cantidad: 3, precio_unitario: 4 }, { tipo: 'modificacion', rubro_id: 'r1', cantidad: -2 }];
    const plan = ctx.planAprobacionOC(oc, items, JSON.parse(JSON.stringify(RUBROS)));
    assert(!plan.error && plan.altas.map(a => a.codigo).join('|') === 'OC-05-01|OC-05-02', JSON.stringify(plan));
    assert(plan.altas.every(a => a.es_orden_cambio && a.orden_cambio_codigo === 'OC-05' && a.orden_cambio_id === 'oc5') && plan.cambios[0].despues === 8, 'altas y cambios como antes');
    const p2 = ctx.planAprobacionOC(oc, [{ tipo: 'nuevo', codigo: 'RN 9', descripcion: 'X', cantidad: 1, precio_unitario: 1 }], RUBROS);
    assert(p2.error && p2.error.includes('Ya existe un rubro con el código RN 9'), JSON.stringify(p2));
    const p3 = ctx.planAprobacionOC(oc, [{ tipo: 'nuevo', codigo: 'N-1', descripcion: 'X', cantidad: 1, precio_unitario: 1 }, { tipo: 'nuevo', codigo: 'N-1', descripcion: 'Y', cantidad: 1, precio_unitario: 1 }], RUBROS);
    assert(p3.error && p3.error.includes('repetido dentro de la orden'), JSON.stringify(p3));
    const p4 = ctx.planAprobacionOC(oc, [{ tipo: 'nuevo', codigo: '', descripcion: '', cantidad: 1, precio_unitario: 1 }], RUBROS);
    assert(p4.error && p4.error.includes('sin descripción'), 'sigue exigiendo descripción: ' + JSON.stringify(p4));
  });

  await prueba('mensajeErrorRubro y filaExcelDelError: 23505 simulado → «Ya existe un rubro con el código X en este proyecto» y la fila del Excel', () => {
    assert(ctx.codigoDeError23505(e23505('RN 9')) === 'RN 9');
    assert(ctx.mensajeErrorRubro(e23505('CLI-04')) === 'Ya existe un rubro con el código CLI-04 en este proyecto.');
    assert(ctx.mensajeErrorRubro({ code: '23505', message: 'duplicate key value violates unique constraint "rubros_proyecto_codigo_uniq"' }, ' 7 ') === 'Ya existe un rubro con el código 7 en este proyecto.', 'sin details usa el código intentado');
    assert(ctx.mensajeErrorRubro({ code: '23505', message: 'Código repetido en el proyecto: X. Cambia el código.' }) === 'Código repetido en el proyecto: X. Cambia el código.', 'los 23505 propios de oc_aprobar pasan tal cual');
    assert(ctx.mensajeErrorRubro({ code: '42501', message: 'permission denied' }) === 'permission denied');
    const filas = [{ codigo: 'A', filaExcel: 5 }, { codigo: 'CLI-04', filaExcel: 12 }];
    assert(ctx.filaExcelDelError(filas, e23505('CLI-04')) === ' (fila 12 del Excel)' && ctx.filaExcelDelError(filas, e23505('ZZ')) === '' && ctx.filaExcelDelError(filas, { code: '42501' }) === '');
  });

  await prueba('guardarRubro (real, en jsdom): sin código no guarda; código existente no guarda; único guarda; al editar se excluye a sí mismo', async () => {
    const dom = new JSDOM(`<!doctype html><html><body><div class="modal-overlay show" id="modalNuevoRubro"></div>
      <input id="rubroId" value=""><input id="rubroDescripcion" value="Nuevo"><input id="rubroUnidad" value="m"><input id="rubroCantidad" value="1"><input id="rubroPrecio" value="2">
      <input id="rubroCodigo" value=""><input type="checkbox" id="rubroEsOC"><input id="rubroOCCodigo" value=""><button id="btnGuardarRubro">Guardar</button></body></html>`, { runScripts: 'outside-only' });
    const w = dom.window;
    const fx = { rubros: JSON.parse(JSON.stringify(RUBROS)) };
    w.sb = crearSb(fx); w.currentProyecto = P; w._proyectoCerrado = false; w.bloquearSiCerrado = () => false;
    w.toasts = []; w.toast = (msg, tipo) => w.toasts.push({ msg, tipo }); w.cargarRubros = () => {}; w.cerrarModal = () => {}; w.console = console;
    w.eval(CODIGO);
    const set = (id, v) => { w.document.getElementById(id).value = v; };
    await w.guardarRubro();
    assert(w.toasts.at(-1).msg.includes('obligatorio') && fx.rubros.length === 3, 'sin código: ' + JSON.stringify(w.toasts.at(-1)));
    set('rubroCodigo', ' RN 9 '); await w.guardarRubro();
    assert(w.toasts.at(-1).msg === 'Ya existe un rubro con el código RN 9 en este proyecto.' && fx.rubros.length === 3, 'existente: ' + JSON.stringify(w.toasts.at(-1)));
    set('rubroCodigo', '1.12345'); await w.guardarRubro();
    assert(w.toasts.at(-1).msg.includes('ruido') && fx.rubros.length === 3, 'ruido');
    set('rubroCodigo', ' 4 '); await w.guardarRubro();
    assert(w.toasts.at(-1).msg === 'Rubro creado ✓' && fx.rubros.length === 4 && fx.rubros[3].codigo === '4' && fx.rubros[3].orden === 4, 'creado con código normalizado: ' + JSON.stringify(fx.rubros[3]));
    // Edición: conservar su propio código no colisiona; tomar el de otro sí
    set('rubroId', 'r1'); set('rubroCodigo', '1'); await w.guardarRubro();
    assert(w.toasts.at(-1).msg === 'Rubro actualizado ✓', 'editar manteniendo el código: ' + JSON.stringify(w.toasts.at(-1)));
    set('rubroCodigo', 'RN 9'); await w.guardarRubro();
    assert(w.toasts.at(-1).msg.includes('Ya existe un rubro con el código RN 9') && fx.rubros.find(r => r.id === 'r1').codigo === '1', 'editar al código de otro: no guarda');
    // 23505 de la base (carrera) → mensaje legible
    const sbFalla = crearSb(fx); const from0 = sbFalla.from;
    sbFalla.from = t => { const b = from0(t); if(t === 'rubros'){ const ej = b._ejecutar; b._ejecutar = () => b._insert ? { data: null, error: e23505('9') } : ej(); } return b; };
    w.sb = sbFalla; set('rubroId', ''); set('rubroCodigo', '9'); await w.guardarRubro();
    assert(w.toasts.at(-1).msg === 'Error: Ya existe un rubro con el código 9 en este proyecto.', '23505: ' + JSON.stringify(w.toasts.at(-1)));
  });

  resumen();
})();
