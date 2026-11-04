// Códigos de rubro en el importador de Excel: ejecuta la función REAL leerPlantillaRubros de
// index.html (la comparten importarRubrosExcel e importarItemsOCExcel) con libros construidos en
// memoria con xlsx (la misma librería que carga la app desde CDN, misma versión mayor).
//
//   node importador-codigos.test.js
//   HIDIVO_PLANTILLA=ruta/plantilla_rubros_hidivo.xlsx node importador-codigos.test.js
//     (también prueba la plantilla oficial si está en esa ruta o en Downloads/plantilla)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { RAIZ, leer, scriptPrincipal, fuenteSiExiste, crearContexto, prueba, resumen, assert } = require('./lib/arnes');

const src = scriptPrincipal(leer(path.join(RAIZ, 'index.html')));
const CODIGO = fuenteSiExiste(src, 'leerPlantillaRubros');

// Libro xlsx en memoria (Uint8Array, como lo recibe la función). `aoa` son las filas; `celdas` fija
// propiedades de celdas concretas (p. ej. {A5: {z: '0.00'}} para controlar el texto .w que Excel
// mostraría); `origen` coloca la tabla en otra esquina y deja el rango de la hoja (!ref) ahí.
function libro(aoa, { celdas = {}, origen } = {}){
  let ws;
  if(origen){ ws = XLSX.utils.aoa_to_sheet([]); XLSX.utils.sheet_add_aoa(ws, aoa, { origin: origen }); const fin = XLSX.utils.decode_cell(ws['!ref'].split(':')[1]); ws['!ref'] = origen + ':' + XLSX.utils.encode_cell(fin); }
  else ws = XLSX.utils.aoa_to_sheet(aoa);
  for(const [dir, props] of Object.entries(celdas)) Object.assign(ws[dir], props);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Rubros');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}
const CAB = ['N°', 'Código', 'Descripción', 'Unidad', 'Cantidad', 'P.U. ($)'];
const fila = (n, codigo, desc = 'Rubro ' + n) => [n, codigo, desc, 'm3', 10, 2.5];

// Contexto con la función real y la librería; `sinW` quita el texto .w de todas las celdas al leer
// (simula una lectura sin cellText: solo queda el valor crudo).
function contexto({ sinW = false } = {}){
  const X = sinW ? { ...XLSX, read: (d, o) => { const wb = XLSX.read(d, o); for(const ws of Object.values(wb.Sheets)) for(const [k, c] of Object.entries(ws)) if(k[0] !== '!' && c && 'w' in c) delete c.w; return wb; } } : XLSX;
  return crearContexto({ codigo: [CODIGO], globals: { XLSX: X } });
}
const leerCon = (ctx, data) => ctx.leerPlantillaRubros(data);
const codigos = r => (r.filas || []).map(f => f.codigo);

(async () => {
  console.log('importador-codigos.test.js');
  const ctx = contexto();
  const SUCIO = 2.0199999999999996; // =B2+0.01 arrastrado: Excel muestra 2.02 con formato 0.00 o General

  await prueba('1. celda numérica con v=2.0199999999999996 y w="2.02" → código "2.02"', () => {
    const r = leerCon(ctx, libro([CAB, fila(1, SUCIO), fila(2, 2.03)], { celdas: { B2: { z: '0.00' }, B3: { z: '0.00' } } }));
    assert(!r.rechazo && !r.error, JSON.stringify(r));
    assert(codigos(r).join('|') === '2.02|2.03', codigos(r).join('|'));
  });

  await prueba('2. misma celda sin .w → "2.02" por el respaldo String(Number(v.toFixed(6)))', () => {
    const r = leerCon(contexto({ sinW: true }), libro([CAB, fila(1, SUCIO), fila(2, 2.1), fila(3, 7)]));
    assert(codigos(r).join('|') === '2.02|2.1|7', JSON.stringify(r));
  });

  await prueba('3. celdas de texto: "2.10" → "2.10", "01" → "01"; "1.1.1" y "OC-01-03" intactos; espacios normalizados', () => {
    const r = leerCon(ctx, libro([CAB, fila(1, '2.10'), fila(2, '01'), fila(3, '1.1.1'), fila(4, 'OC-01-03'), fila(5, '  A.2   b ')]));
    assert(!r.rechazo, JSON.stringify(r));
    assert(codigos(r).join('|') === '2.10|01|1.1.1|OC-01-03|A.2 b', codigos(r).join('|'));
    // El valor crudo también se conserva en texto sin pasar por Number: "2.10" no se vuelve "2.1"
    assert(leerCon(contexto({ sinW: true }), libro([CAB, fila(1, '2.10')])).filas[0].codigo === '2.10', 'texto sin .w');
  });

  await prueba('4. celda que Excel muestra como 2.0199999999999996 → rechazo con ruido de cálculo que nombra la fila', () => {
    // Formato con 16 decimales: lo que Excel imprime de una celda General con el double sucio
    const r = leerCon(ctx, libro([CAB, fila(1, '1'), fila(2, SUCIO), fila(3, '3')], { celdas: { B3: { z: '0.0000000000000000' } } }));
    assert(r.rechazo && r.rechazo.includes('ruido de cálculo') && r.rechazo.includes('fila 3: 2.0199999999999996') && r.rechazo.includes('no fórmulas'), JSON.stringify(r));
    // Racha de 9999 y de 0000, y 5+ decimales, también como texto
    for(const c of ['2.0199999', '2.1000001', '1.99999', '3.12345']){
      const x = leerCon(ctx, libro([CAB, fila(1, c)]));
      assert(x.rechazo && x.rechazo.includes('ruido'), 'debe rechazar ' + c + ': ' + JSON.stringify(x));
    }
    // Lo que no es ruido pasa: 4 decimales limpios, "1.1.1", "OC-01-03", "2.10"
    for(const c of ['1.2345', '1.1.1', 'OC-01-03', '2.10', '10.0001']){
      const x = leerCon(ctx, libro([CAB, fila(1, c)]));
      assert(!x.rechazo && x.filas[0].codigo === c, 'debe aceptar ' + c + ': ' + JSON.stringify(x));
    }
  });

  await prueba('5. Excel sin columna Código pero con N° → rechazo «no tiene columna "Código"» (ya no se usa N° como respaldo)', () => {
    const r = leerCon(ctx, libro([['N°', 'Descripción', 'Unidad', 'Cantidad', 'P.U. ($)'], [1, 'Rubro 1', 'm3', 10, 2.5], [2, 'Rubro 2', 'm3', 10, 2.5]]));
    assert(r.rechazo && r.rechazo.includes('no tiene columna "Código"') && r.rechazo.includes('N°/Item'), JSON.stringify(r));
    // Variantes del encabezado que sí valen
    for(const h of ['Cód. rubro', 'Código rubro', 'codigo']){
      const x = leerCon(ctx, libro([['N°', h, 'Descripción', 'Unidad', 'Cantidad', 'P.U. ($)'], fila(1, 'A-1')]));
      assert(!x.rechazo && x.filas[0].codigo === 'A-1', 'encabezado ' + h + ': ' + JSON.stringify(x));
    }
  });

  await prueba('6. hoja cuyo rango empieza en C5 → los códigos salen de la columna correcta y la fila del rechazo es la real', () => {
    const data = libro([CAB, fila(1, SUCIO), fila(2, '2.10')], { origen: 'C5', celdas: { D6: { z: '0.00' } } });
    const wb = XLSX.read(data, { type: 'array' }); assert(wb.Sheets.Rubros['!ref'].startsWith('C5'), 'rango ' + wb.Sheets.Rubros['!ref']);
    const r = leerCon(ctx, data);
    assert(!r.rechazo && codigos(r).join('|') === '2.02|2.10', JSON.stringify(r));
    assert(r.filas[0].filaExcel === 6 && r.filas[1].filaExcel === 7, 'filas reales: ' + r.filas.map(f => f.filaExcel));
    const r2 = leerCon(ctx, libro([CAB, fila(1, '1'), fila(2, '')], { origen: 'C5' }));
    assert(r2.rechazo && r2.rechazo.includes('Filas del Excel: 7'), 'sin código en la fila real 7: ' + JSON.stringify(r2));
  });

  await prueba('7. código 0 (número) → "0", no vacío', () => {
    const r = leerCon(ctx, libro([CAB, fila(1, 0), fila(2, '0.1')]));
    assert(!r.rechazo && codigos(r).join('|') === '0|0.1', JSON.stringify(r));
    assert(leerCon(contexto({ sinW: true }), libro([CAB, fila(1, 0)])).filas[0].codigo === '0', 'también sin .w');
  });

  await prueba('8. los rechazos «sin código» y «repetido» siguen igual; cantidad y precio siguen crudos', () => {
    const r = leerCon(ctx, libro([CAB, fila(1, 'A'), fila(2, ''), fila(3, '   ')]));
    assert(r.rechazo && r.rechazo.includes('2 fila(s) sin código') && r.rechazo.includes('Filas del Excel: 3, 4'), JSON.stringify(r));
    const r2 = leerCon(ctx, libro([CAB, fila(1, 'A'), fila(2, 'B'), fila(3, 'A ')]));
    assert(r2.rechazo && r2.rechazo.includes('Código repetido') && r2.rechazo.includes('"A" (filas 2 y 4)'), JSON.stringify(r2));
    const r3 = leerCon(ctx, libro([CAB, [1, 'A', 'Rubro', 'm3', 1234.567, 1500.5]]));
    assert(r3.filas[0].cantidad_contrato === 1234.567 && r3.filas[0].precio_unitario === 1500.5, JSON.stringify(r3.filas[0]));
  });

  // Plantilla oficial (fuera del repo): códigos de ejemplo como texto
  const rutaPlantilla = process.env.HIDIVO_PLANTILLA || path.join(os.homedir(), 'Downloads', 'plantilla', 'plantilla_rubros_hidivo.xlsx');
  if(fs.existsSync(rutaPlantilla)){
    await prueba('plantilla oficial (' + rutaPlantilla + '): tiene columna Código y los ejemplos se leen como texto', () => {
      const r = leerCon(ctx, new Uint8Array(fs.readFileSync(rutaPlantilla)));
      assert(!r.rechazo && !r.error, JSON.stringify(r));
      assert(r.filas.length === 5 && codigos(r).join('|') === 'OB-001|OB-002|OB-003|OB-004|OB-005', codigos(r).join('|'));
      const wb = XLSX.read(fs.readFileSync(rutaPlantilla), { type: 'buffer' }); const ws = wb.Sheets[wb.SheetNames[0]];
      assert(ws.B3 && String(ws.B3.v).toLowerCase() === 'código', 'encabezado Código en B3');
      // Tras el paso 2 la columna Código lleva formato de texto (@) en las filas de datos
      const z = ws.B5 && ws.B5.z, zVacia = ws.B10 && ws.B10.z;
      console.log('      formato de B5: ' + JSON.stringify(z) + ' · B10: ' + JSON.stringify(zVacia));
    });
  } else {
    console.log('  (plantilla oficial no encontrada en ' + rutaPlantilla + ': se omite)');
  }

  resumen();
})();
