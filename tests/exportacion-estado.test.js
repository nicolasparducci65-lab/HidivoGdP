// Exportación diaria del estado de proyectos: construirEstado(), estadoAMarkdown() y la
// línea de comandos exportar.js, con el código REAL de exportacion/ y de cartera-nucleo.js
// sobre un fixture SINTÉTICO (fixtures/exportacion-estado.json, todo con prefijo ZZZ; se
// regenera con herramientas/gen-fixture-exportacion.js, que explica cada proyecto).
//
// El fixture trae 17 proyectos, en orden revuelto: 11 que deben salir y 6 que no (dos
// liquidados, uno sin código y tres finalizados o cancelados sin pendientes). La planilla del
// proyecto de pilotes tiene una fecha corrupta a propósito, y hay un correo y un uuid metidos
// en textos libres.
//
//   node exportacion-estado.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { RAIZ, prueba, resumen, assert } = require('./lib/arnes');
const { construirEstado, estadoAMarkdown, estadoDelResumen, limpiarTexto } = require(path.join(RAIZ, 'exportacion', 'estado-proyectos.js'));
const { desenvolver, describirSinDatos, TABLAS } = require(path.join(RAIZ, 'exportacion', 'exportar.js'));

const RUTA_FIXTURE = path.join(__dirname, 'fixtures', 'exportacion-estado.json');
const AHORA = '2026-11-21T08:14:07Z';   // 03:14 del 21-nov en Ecuador
const OPCIONES = { ahora: AHORA, versionApp: 'hidivo-vZZ' };
const fixture = () => JSON.parse(fs.readFileSync(RUTA_FIXTURE, 'utf8'));
const igual = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: se obtuvo ${JSON.stringify(a)}, se esperaba ${JSON.stringify(b)}`);
const RE_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const BLOQUES = ['identidad', 'avance', 'proximos_14_dias', 'planillas', 'garantias', 'ordenes_cambio', 'libro', 'observaciones', 'calidad_seguridad', 'documentos', 'equipo'];
const INCLUIDOS = ['ZZZ-PIL-2026-002', 'ZZZ-FIS-2026-001', 'ZZZ-CON-2026-003', 'ZZZ-DIS-2026-013', 'ZZZ-FIS-2024-008', 'ZZZ-FIS-2024-009',
  'ZZZ-FIS-2024-010', 'ZZZ-FIS-2025-004', 'ZZZ-FIS-2025-005', 'ZZZ-MUR-2026-016', 'ZZZ-PUE-2026-015'];
const proyectoDe = (f, codigo) => f.proyectos.find(p => p.codigo === codigo);
const codigos = e => e.proyectos.map(p => p.identidad.codigo);
// Sección de un proyecto en el .md (desde su título hasta el siguiente).
const seccionDe = (md, codigo) => { const t = md.split(/^(?=## )/m).filter(x => x.startsWith('## ') && x.split('\n')[0].includes(' ' + codigo + ' — ')); assert(t.length === 1, `se esperaba una sección de ${codigo} y hay ${t.length}`); return t[0]; };
// Construye el estado tras modificar una copia del fixture.
const con = cambio => { const f = fixture(); cambio(f); return construirEstado(f, OPCIONES); };
// Corrige la planilla que el fixture trae con la fecha corrupta a propósito.
const sanear = f => { f.planillas_pago.filter(pl => pl.created_at === 'fecha-corrupta').forEach(pl => { pl.created_at = pl.updated_at = '2026-11-20T15:00:00+00:00'; }); return f; };

(async () => {
  console.log('exportacion-estado.test.js');
  const estado = construirEstado(fixture(), OPCIONES);
  const md = estadoAMarkdown(estado);
  const texto = JSON.stringify(estado);
  const P = codigo => estado.proyectos.find(p => p.identidad.codigo === codigo);
  const decision = (clase, codigo) => estado.resumen.esperan_decision.filter(d => d.clase === clase && (!codigo || d.proyecto === codigo));

  await prueba('cabecera: formato, fechas de Ecuador, versión y conteos de incluidos y excluidos por motivo', () => {
    igual(Object.keys(estado), ['formato', 'generado', 'valido_para', 'zona', 'version_app', 'proyectos_total', 'proyectos_incluidos', 'proyectos_excluidos', 'bloques_fallidos', 'resumen', 'proyectos'], 'claves de primer nivel');
    igual([estado.formato, estado.generado, estado.valido_para, estado.zona, estado.version_app], [1, '2026-11-21T03:14:07-05:00', '2026-11-21', 'America/Guayaquil', 'hidivo-vZZ'], 'cabecera');
    igual([estado.proyectos_total, estado.proyectos_incluidos], [17, 11], 'conteos');
    igual(estado.proyectos_excluidos, { sin_codigo: 1, liquidados: 2, cerrados_sin_pendientes: 3 }, 'excluidos por motivo');
    const ex = estado.proyectos_excluidos;
    igual(estado.proyectos_incluidos + ex.sin_codigo + ex.liquidados + ex.cerrados_sin_pendientes, estado.proyectos_total, 'incluidos + excluidos = total');
  });

  await prueba('«hoy» es la fecha de Ecuador, no la de UTC', () => {
    const e = construirEstado(fixture(), { ahora: '2026-11-22T03:30:00Z' });   // 22:30 del 21 en Ecuador
    igual([e.valido_para, e.generado, e.version_app], ['2026-11-21', '2026-11-21T22:30:00-05:00', null], 'fecha válida');
  });

  await prueba('D9: quedan fuera los liquidados (también el que sigue «en ejecución»), el que no tiene código y los finalizados o cancelados sin pendientes', () => {
    igual(codigos(estado), INCLUIDOS, 'proyectos y orden (rojo, amarillo y verdes por código, con la entrada revuelta)');
    ['ZZZ-FIS-2024-006', 'ZZZ-FIS-2024-007', 'ZZZ-GER-2026-011', 'ZZZ-FIS-2025-012', 'ZZZ-FIS-2023-014', 'ZZZ Sin codigo', 'ZZZ Liquidado', 'ZZZ Finalizado sin pendientes',
      'ZZZ En ejecucion pero liquidado', 'ZZZ Cancelado sin pendientes', 'ZZZ Cerrado sin acta ni pendientes'].forEach(t => assert(!texto.includes(t) && !md.includes(t), 'no debe aparecer ' + t));
    igual(P('ZZZ-CON-2026-003').identidad.estado, 'pausado', 'el pausado va siempre');
    igual(estado.proyectos.map(p => p.avance.semaforo), ['rojo', 'amarillo'].concat(Array(9).fill('verde')), 'colores');
    const liquidadoEnEjecucion = proyectoDe(fixture(), 'ZZZ-GER-2026-011');
    igual([liquidadoEnEjecucion.estado, liquidadoEnEjecucion.estado_cierre], ['ejecucion', 'liquidado'], 'el fixture trae un liquidado que sigue en ejecución');
    // El mismo proyecto, sin el estado «liquidado», sí sale: lo que lo excluye es el estado de cierre.
    assert(codigos(con(f => { proyectoDe(f, 'ZZZ-GER-2026-011').estado_cierre = 'en_ejecucion'; })).includes('ZZZ-GER-2026-011'), 'sin «liquidado» debe incluirse');
  });

  await prueba('D9: el orden de salida no depende del orden de llegada', () => {
    const e = con(f => { f.proyectos.reverse(); f.cronograma_rubros.reverse(); f.lineas_base.reverse(); f.garantias.reverse(); f.observaciones.reverse(); });
    igual(e.proyectos, estado.proyectos, 'mismos proyectos, en el mismo orden y con los mismos bloques');
    igual(e.resumen, estado.resumen, 'mismo resumen');
  });

  await prueba('D9: un finalizado entra por UN solo pendiente (garantía vigente, planilla aprobada u observación en proceso) y sale al resolverlo', () => {
    const casos = [
      ['ZZZ-FIS-2024-008', 'garantía vigente', (f, id) => { f.garantias.find(g => g.proyecto_id === id).estado = 'devuelta'; }],
      ['ZZZ-FIS-2024-009', 'planilla aprobada sin pagar', (f, id) => { f.planillas_pago.find(pl => pl.proyecto_id === id).estado = 'pagada'; }],
      ['ZZZ-FIS-2024-010', 'observación en proceso', (f, id) => { f.observaciones.find(o => o.proyecto_id === id).estado = 'resuelta'; }]
    ];
    casos.forEach(([codigo, que, resolver]) => {
      assert(codigos(estado).includes(codigo), `${codigo} debe incluirse por su ${que}`);
      const e = con(f => resolver(f, proyectoDe(f, codigo).id));
      assert(!codigos(e).includes(codigo), `${codigo} debe quedar fuera al resolverse su ${que}`);
      igual([e.proyectos_incluidos, e.proyectos_excluidos.cerrados_sin_pendientes], [10, 4], `conteos sin ${codigo}`);
      assert(!estado.resumen.esperan_decision.some(d => d.proyecto === codigo), `${codigo} no tiene nada en «Esperan decisión»`);
    });
    // Una planilla solo enviada también es un pendiente.
    assert(codigos(con(f => { f.planillas_pago.find(pl => pl.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2024-009').id).estado = 'enviada'; })).includes('ZZZ-FIS-2024-009'), 'planilla enviada');
    // Una observación abierta, igual que una en proceso.
    assert(codigos(con(f => { f.observaciones.find(o => o.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2024-010').id).estado = 'abierta'; })).includes('ZZZ-FIS-2024-010'), 'observación abierta');
    // Un finalizado sin pendientes entra en cuanto tiene una orden de cambio solicitada.
    const e = con(f => { f.ordenes_cambio.find(o => o.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2024-007').id).estado = 'solicitada'; });
    assert(codigos(e).includes('ZZZ-FIS-2024-007'), 'orden de cambio solicitada');
    igual([e.proyectos_incluidos, e.proyectos_excluidos.cerrados_sin_pendientes], [12, 2], 'conteos con el 007');
  });

  await prueba('D6/D9: un finalizado SIN acta provisional entra solo por otro pendiente y no genera fila de acta', () => {
    const cuatro = proyectoDe(fixture(), 'ZZZ-FIS-2025-004');
    igual([cuatro.estado, cuatro.estado_cierre, fixture().actas_recepcion.filter(a => a.proyecto_id === cuatro.id).length], ['finalizado', 'en_ejecucion', 0], 'el 004 es un finalizado sin acta');
    igual(estado.resumen.esperan_decision.filter(d => d.proyecto === 'ZZZ-FIS-2025-004').map(d => d.clase), ['garantia_por_vencer'], 'entra por la garantía y sin fila de acta');
    assert(!estado.resumen.esperan_decision.some(d => /acta_provisional/.test(d.clase)) && !md.includes('Acta provisional pendiente'), 'ya no existe «acta provisional pendiente»');
    const sinGarantia = con(f => { f.garantias.find(g => g.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2025-004').id).estado = 'devuelta'; });
    assert(!codigos(sinGarantia).includes('ZZZ-FIS-2025-004'), 'sin la garantía, el finalizado sin acta queda fuera');
    assert(!codigos(estado).includes('ZZZ-FIS-2023-014'), 'el finalizado sin acta ni pendientes queda fuera');
  });

  await prueba('D9: «cancelado» se trata igual que «finalizado»', () => {
    assert(codigos(estado).includes('ZZZ-DIS-2026-013') && !codigos(estado).includes('ZZZ-FIS-2025-012'), 'cancelado con pendientes dentro, sin pendientes fuera');
    igual(P('ZZZ-DIS-2026-013').identidad.estado, 'cancelado', 'estado');
    igual(estado.resumen.esperan_decision.filter(d => d.proyecto === 'ZZZ-DIS-2026-013').map(d => d.clase), ['observacion_antigua', 'orden_cambio_solicitada'], 'sus decisiones, sin fila de acta');
    const e = con(f => { const id = proyectoDe(f, 'ZZZ-DIS-2026-013').id; f.observaciones = f.observaciones.filter(o => o.proyecto_id !== id); f.ordenes_cambio = f.ordenes_cambio.filter(o => o.proyecto_id !== id); });
    assert(!codigos(e).includes('ZZZ-DIS-2026-013'), 'sin sus pendientes, el cancelado queda fuera');
    // Un «en ejecución» sin nada pendiente va siempre: la regla es solo para finalizados y cancelados.
    assert(codigos(con(f => { proyectoDe(f, 'ZZZ-FIS-2025-012').estado = 'ejecucion'; })).includes('ZZZ-FIS-2025-012'), 'en ejecución va siempre');
  });

  await prueba('D6: el acta o la liquidación pendiente cuenta desde que existe el acta provisional', () => {
    igual(decision('liquidacion_pendiente'), [{ clase: 'liquidacion_pendiente', proyecto: 'ZZZ-FIS-2025-005', detalle: 'Con acta definitiva y sin liquidación', desde: '2026-11-01', dias: 20, sentido: 'esperando', monto: null }], 'con definitiva y sin liquidación, desde el acta definitiva');
    igual(decision('acta_definitiva_pendiente'), [{ clase: 'acta_definitiva_pendiente', proyecto: 'ZZZ-MUR-2026-016', detalle: 'Con acta provisional y sin acta definitiva', desde: null, dias: null, sentido: 'esperando', monto: null }], 'recepción provisional sin la fila del acta: sin fecha');
    // Con acta provisional y sin definitiva (fila del acta presente).
    const e1 = con(f => { const p5 = proyectoDe(f, 'ZZZ-FIS-2025-005'); p5.estado_cierre = 'recepcion_provisional'; f.actas_recepcion = f.actas_recepcion.filter(a => !(a.proyecto_id === p5.id && a.tipo === 'definitiva')); });
    igual(e1.resumen.esperan_decision.filter(x => x.proyecto === 'ZZZ-FIS-2025-005'), [{ clase: 'acta_definitiva_pendiente', proyecto: 'ZZZ-FIS-2025-005', detalle: 'Con acta provisional y sin acta definitiva', desde: '2026-04-01', dias: 234, sentido: 'esperando', monto: null }], 'acta definitiva pendiente');
    // Un finalizado sin nada más entra si ya tiene el acta provisional (aquí, por el estado de cierre).
    const e2 = con(f => { proyectoDe(f, 'ZZZ-FIS-2023-014').estado_cierre = 'recepcion_provisional'; });
    igual(e2.resumen.esperan_decision.filter(x => x.proyecto === 'ZZZ-FIS-2023-014').map(x => x.clase), ['acta_definitiva_pendiente'], 'finalizado con provisional: entra y falta la definitiva');
    // El estado de cierre «recepcion_definitiva» basta aunque falten las filas de las actas (entonces, sin fecha).
    const e4 = con(f => { const id = proyectoDe(f, 'ZZZ-FIS-2025-005').id; f.actas_recepcion = f.actas_recepcion.filter(a => a.proyecto_id !== id); });
    igual(e4.resumen.esperan_decision.filter(x => x.proyecto === 'ZZZ-FIS-2025-005').map(x => [x.clase, x.desde, x.dias]), [['liquidacion_pendiente', null, null]], 'recepción definitiva sin filas de actas');
    // Con las dos actas y la liquidación no queda nada pendiente de cierre.
    assert(!estado.resumen.esperan_decision.some(d => ['ZZZ-FIS-2024-008', 'ZZZ-FIS-2024-009', 'ZZZ-FIS-2024-010'].includes(d.proyecto)), 'cierre completo: sin filas');
    // Si se borra la liquidación de un proyecto con acta definitiva, aparece la fila.
    const e3 = con(f => { const id = proyectoDe(f, 'ZZZ-FIS-2024-008').id; f.liquidaciones = f.liquidaciones.filter(l => l.proyecto_id !== id); });
    igual(e3.resumen.esperan_decision.filter(x => x.proyecto === 'ZZZ-FIS-2024-008').map(x => [x.clase, x.desde]), [['liquidacion_pendiente', '2024-09-01']], 'sin liquidación');
  });

  await prueba('todos los proyectos traen los 11 bloques y solo esos', () => {
    estado.proyectos.forEach(p => igual(Object.keys(p), BLOQUES, 'bloques'));
  });

  await prueba('un bloque con datos corruptos queda en null y anotado (con código e índice), sin tumbar lo demás', () => {
    igual(estado.bloques_fallidos, [{ bloque: 'planillas', proyecto: 'ZZZ-PIL-2026-002', indice: 0, motivo: 'fecha inválida en planillas_pago.created_at' }], 'bloques fallidos');
    const p = P('ZZZ-PIL-2026-002');
    assert(p.planillas === null, 'el bloque fallido es null');
    BLOQUES.filter(b => b !== 'planillas').forEach(b => assert(p[b] !== null, 'el bloque ' + b + ' sí se calcula'));
    assert(md.includes('**Planillas.** no se pudo calcular: fecha inválida en planillas_pago.created_at'), 'el .md dice el motivo');
    assert(md.includes('Bloques sin calcular: 1 (planillas de ZZZ-PIL-2026-002)'), 'la cabecera del .md lo cuenta');
    assert(md.includes('Tabla incompleta, no se pudo calcular: planillas de ZZZ-PIL-2026-002.'), 'la tabla de decisiones avisa de que le falta ese bloque');
  });

  await prueba('si falta una tabla entera, fallan solo los bloques que la usan', () => {
    const f = fixture(); delete f.ensayos;
    const e = construirEstado(f, OPCIONES);
    const calidad = e.bloques_fallidos.filter(x => x.bloque === 'calidad_seguridad');
    igual(calidad.length, 11, 'un fallo de calidad por proyecto');
    igual(calidad.map(x => x.indice).sort((a, b) => a - b), INCLUIDOS.map((_, i) => i), 'cada fallo con el índice de su proyecto');
    calidad.forEach(x => igual(x.proyecto, INCLUIDOS[x.indice], 'código e índice coinciden'));
    igual(calidad[0].motivo, 'falta la tabla «ensayos» en los datos', 'motivo');
    assert(e.proyectos.every(p => p.calidad_seguridad === null && p.avance !== null), 'calidad null, avance calculado');
    assert(estadoAMarkdown(e).includes('**Calidad y seguridad.** no se pudo calcular: falta la tabla «ensayos» en los datos'), '.md');
    igual(estadoDelResumen(e), 'ok', 'el resumen no depende de esa tabla');
  });

  await prueba('identidad: código y nombre salen SIEMPRE; con dos identidades fallidas a la vez cada sección conserva su proyecto', () => {
    const e = con(f => { proyectoDe(f, 'ZZZ-FIS-2026-001').latitud = 'abc'; proyectoDe(f, 'ZZZ-PIL-2026-002').latitud = 'abc'; });
    igual(codigos(e), INCLUIDOS, 'los códigos y el orden no cambian');
    igual(e.bloques_fallidos.filter(x => x.bloque === 'identidad'), [
      { bloque: 'identidad', proyecto: 'ZZZ-FIS-2026-001', indice: 1, motivo: 'número inválido en proyectos.latitud' },
      { bloque: 'identidad', proyecto: 'ZZZ-PIL-2026-002', indice: 0, motivo: 'número inválido en proyectos.latitud' }], 'cada fallo dice de qué proyecto es');
    const id1 = e.proyectos[1].identidad, id2 = e.proyectos[0].identidad;
    igual([id1.codigo, id1.nombre, id1.descripcion, id1.estado, id1.monto_contractual], ['ZZZ-FIS-2026-001', 'ZZZ Edificio de ejemplo', null, null, null], 'identidad del 001: código y nombre, lo demás null');
    igual([id2.codigo, id2.nombre, id2.gestora, id2.emisor, id2.monto_vigente], ['ZZZ-PIL-2026-002', 'ZZZ Pilotes de ejemplo', 'ZZG', 'ZZE', 50000], 'identidad del 002: las empresas y el monto vigente se calculan aparte');
    igual(Object.keys(id1), Object.keys(P('ZZZ-FIS-2026-001').identidad), 'la identidad conserva todas sus claves');
    const m = estadoAMarkdown(e);
    igual(m.split('\n').filter(x => x.startsWith('## ') && x !== '## Resumen').slice(0, 2), ['## 🔴 ZZZ-PIL-2026-002 — ZZZ Pilotes de ejemplo', '## 🟡 ZZZ-FIS-2026-001 — ZZZ Edificio de ejemplo'], 'títulos');
    const s2 = seccionDe(m, 'ZZZ-PIL-2026-002'), s1 = seccionDe(m, 'ZZZ-FIS-2026-001');
    [s1, s2].forEach(s => assert(s.includes('**Identidad.** no se pudo calcular: número inválido en proyectos.latitud'), 'la sección dice el motivo'));
    assert(s2.includes('Semáforo rojo: SPI 0,22') && s2.includes('ZZZ Pilotes hincados') && !s2.includes('ZZZ Mampostería'), 'la sección del 002 trae los datos del 002');
    assert(s1.includes('Semáforo amarillo: SPI 0,92') && s1.includes('ZZZ Mampostería') && !s1.includes('ZZZ Pilotes hincados'), 'la sección del 001 trae los datos del 001');
    assert(!m.includes('identidad no disponible') && !m.split('\n').some(x => x.startsWith('## ') && /sin código|sin nombre/.test(x)), 'ningún proyecto queda anónimo');
    igual(e.resumen.esperan_decision, estado.resumen.esperan_decision, '«Esperan decisión» no se altera');
  });

  await prueba('identidad: dos proyectos con el MISMO código se distinguen por el índice', () => {
    const e = con(f => { const a = proyectoDe(f, 'ZZZ-FIS-2024-008'), b = proyectoDe(f, 'ZZZ-FIS-2024-009'); b.codigo = a.codigo; a.longitud = 'x'; b.longitud = 'x'; });
    const fallos = e.bloques_fallidos.filter(x => x.bloque === 'identidad');
    igual(fallos.map(x => [x.proyecto, e.proyectos[x.indice].identidad.nombre]).sort(), [['ZZZ-FIS-2024-008', 'ZZZ Solo garantia vigente'], ['ZZZ-FIS-2024-008', 'ZZZ Solo planilla aprobada']], 'un índice distinto para cada uno');
    const titulos = estadoAMarkdown(e).split('\n').filter(x => x.includes('— ZZZ Solo '));
    igual(titulos, ['## 🟢 ZZZ-FIS-2024-008 — ZZZ Solo garantia vigente', '## 🟢 ZZZ-FIS-2024-008 — ZZZ Solo planilla aprobada', '## 🟢 ZZZ-FIS-2024-010 — ZZZ Solo observacion en proceso'], 'cada sección con su nombre');
  });

  await prueba('identidad: un rubro corrupto deja sin monto vigente (anotado) pero con código, nombre y el resto', () => {
    const e = con(f => { f.rubros.find(r => r.codigo === 'P-01').monto_contrato = 'xx'; });
    const id = e.proyectos.find(p => p.identidad.codigo === 'ZZZ-PIL-2026-002').identidad;
    igual([id.nombre, id.tipo, id.monto_contractual, id.monto_vigente], ['ZZZ Pilotes de ejemplo', 'pilotes', 50000, null], 'identidad');
    const i = codigos(e).indexOf('ZZZ-PIL-2026-002');
    igual(e.bloques_fallidos.filter(x => x.indice === i).map(x => x.bloque).sort(), ['avance', 'identidad.monto_vigente', 'planillas', 'proximos_14_dias'], 'bloques anotados');
    igual(e.resumen.semaforo, { rojo: 0, amarillo: 1, verde: 9, sin_datos: 1 }, 'sin avance cuenta como «sin datos»');
    igual(i, 10, 'un proyecto sin color va al final');
    igual(e.resumen.por_tipo.find(x => x.tipo === 'pilotes'), { tipo: 'pilotes', proyectos: 1, monto_vigente: 0, proyectos_sin_monto: 1 }, 'el resumen dice que falta un monto');
    igual(e.resumen.por_gestora[0], { sigla: 'ZZG', nombre: 'ZZZ GESTORA', proyectos: 10, monto_vigente: 698600, proyectos_sin_monto: 1 }, 'por gestora');
    const s = seccionDe(estadoAMarkdown(e), 'ZZZ-PIL-2026-002');
    assert(s.startsWith('## ⚪ ZZZ-PIL-2026-002 — ZZZ Pilotes de ejemplo') && s.includes('vigente no disponible') && s.includes('**Avance.** no se pudo calcular: número inválido en rubros.monto_contrato'), '.md: ' + s.slice(0, 600));
  });

  await prueba('identidad y montos', () => {
    const id = P('ZZZ-FIS-2026-001').identidad;
    igual(Object.keys(id), ['codigo', 'nombre', 'descripcion', 'ubicacion', 'latitud', 'longitud', 'gestora', 'emisor', 'tipo', 'contratante', 'contratista', 'estado', 'estado_cierre',
      'fecha_firma', 'fecha_inicio', 'fecha_fin_contractual', 'fecha_fin_real', 'monto_contractual', 'monto_vigente', 'monto_ordenes_cambio'], 'claves');
    igual([id.gestora, id.emisor, id.tipo, id.estado, id.estado_cierre], ['ZZG', 'ZZG', 'fiscalizacion', 'ejecucion', 'en_ejecucion'], 'identidad');
    igual([id.fecha_firma, id.fecha_inicio, id.fecha_fin_contractual, id.fecha_fin_real], [null, '2026-08-03', '2026-12-15', null], 'fechas (D4: firma null)');
    igual([id.monto_contractual, id.monto_vigente, id.monto_ordenes_cambio], [410000, 428600, 18600], 'montos');
    assert(id.descripcion.includes('\n'), 'la descripción va completa, sin recortar');
    const id2 = P('ZZZ-PIL-2026-002').identidad;
    igual([id2.gestora, id2.emisor, id2.latitud, id2.longitud], ['ZZG', 'ZZE', -2.19, -79.88], 'emisor documental distinto de la gestora');
    const id3 = P('ZZZ-CON-2026-003').identidad;
    igual([id3.gestora, id3.monto_contractual, id3.monto_vigente], ['ZZH', null, 0], 'proyecto sin rubros ni monto');
  });

  await prueba('avance, valor ganado, SPI, atraso y semáforo salen del núcleo (línea base activa)', () => {
    const a = P('ZZZ-FIS-2026-001').avance;
    igual(Object.keys(a), ['ejecutado_pct', 'programado_pct', 'valor_ganado_pct', 'spi', 'dias_atraso', 'cronograma_vencido', 'linea_base', 'semaforo', 'motivos'], 'claves');
    igual([a.ejecutado_pct, a.programado_pct, a.valor_ganado_pct, a.dias_atraso, a.cronograma_vencido, a.linea_base, a.semaforo], [61.67, 63, 58.33, 9, false, 'LB-2', 'amarillo'], 'avance (el valor ganado no es el avance ejecutado: solo cuenta los rubros con cronograma)');
    assert(a.spi === 0.9259, 'SPI 250/270 redondeado a 4 decimales, se obtuvo ' + a.spi);
    igual(a.motivos, ['SPI 0,92', '1 garantía por vencer en 5 días o menos', '7 pendientes (libro, observaciones y solicitudes)'], 'motivos (SPI truncado; garantías con el aviso de 5 días del núcleo)');
    const r = P('ZZZ-PIL-2026-002').avance;
    igual([r.semaforo, r.dias_atraso, r.valor_ganado_pct, r.programado_pct, r.cronograma_vencido], ['rojo', 284, 20, 90, false], 'rojo');
    assert(Math.abs(r.spi - 0.2 / 0.9) < 1e-9, 'SPI del rojo: ' + r.spi);
    igual(r.motivos, ['SPI 0,22', '1 garantía vencida', 'atraso estimado de 284 días'], 'motivos del rojo');
    igual(P('ZZZ-CON-2026-003').avance, { ejecutado_pct: 0, programado_pct: null, valor_ganado_pct: null, spi: null, dias_atraso: null, cronograma_vencido: false, linea_base: null, semaforo: 'verde', motivos: ['sin cronograma: no hay SPI'] }, 'sin cronograma: sin SPI y sin atraso estimable');
    // La garantía que vence en 15 días espera decisión, pero NO pone amarillo el semáforo (aviso de 5 días).
    igual([P('ZZZ-FIS-2025-004').avance.semaforo, P('ZZZ-FIS-2025-004').avance.motivos], ['verde', ['sin cronograma: no hay SPI']], 'los 15 días de «Esperan decisión» no llegan al semáforo');
    igual(decision('garantia_por_vencer', 'ZZZ-FIS-2025-004').length, 1, 'y sí espera decisión');
  });

  await prueba('avance: cronograma vencido, SPI 0 y el texto del atraso en el .md', () => {
    igual(P('ZZZ-FIS-2024-009').avance, { ejecutado_pct: 100, programado_pct: 100, valor_ganado_pct: 100, spi: 1, dias_atraso: 0, cronograma_vencido: true, linea_base: 'LB-1', semaforo: 'verde', motivos: [] }, 'cronograma vencido');
    assert(seccionDe(md, 'ZZZ-FIS-2024-009').includes('**Avance.** Ejecutado 100,0 % · programado 100,0 % (LB-1) · valor ganado 100,0 % · SPI 1,00 · sin atraso estimado · cronograma vencido'), '.md del cronograma vencido');
    assert(md.includes('**Avance.** Ejecutado 20,0 % · programado 90,0 % (LB-1) · valor ganado 20,0 % · SPI 0,22 · atraso estimado 284 días'), '.md con atraso');
    assert(md.includes('**Avance.** Ejecutado 0,0 % · sin cronograma · SPI no disponible\n'), '.md sin cronograma: no se habla de atraso');
    // SPI 0: nada ejecutado de lo programado. El atraso no es «0 días»: no se puede estimar.
    const e = con(f => { f.rubros.find(r => r.codigo === 'P-01').total_produccion = 0; });
    const av = e.proyectos.find(p => p.identidad.codigo === 'ZZZ-PIL-2026-002').avance;
    igual([av.spi, av.dias_atraso, av.valor_ganado_pct, av.semaforo], [0, null, 0, 'rojo'], 'SPI 0');
    const s = seccionDe(estadoAMarkdown(e), 'ZZZ-PIL-2026-002');
    assert(s.includes('· SPI 0,00 · atraso no estimable (nada ejecutado de lo programado)'), '.md con SPI 0: ' + s.split('\n').find(x => x.startsWith('**Avance')));
    assert(!/atraso (estimado )?0 d[ií]as/.test(estadoAMarkdown(e)) && !/atraso (estimado )?0 d[ií]as/.test(md), 'nunca «atraso 0 días»');
    assert(!md.includes('atraso no estimable'), 'con SPI mayor que 0 no se dice «no estimable»');
  });

  await prueba('sin línea base activa y con dos líneas base: cuenta la fila más reciente de cada rubro, llegue en el orden que llegue', () => {
    const quince = f => proyectoDe(f, 'ZZZ-PUE-2026-015').id;
    const f0 = fixture();
    igual(f0.lineas_base.filter(l => l.proyecto_id === quince(f0)).map(l => l.activa), [false, false], 'el 015 tiene dos líneas base y ninguna activa');
    const esperado = { ejecutado_pct: 50, programado_pct: 50, valor_ganado_pct: 50, spi: 1, dias_atraso: 0, cronograma_vencido: false, linea_base: null, semaforo: 'verde', motivos: [] };
    igual(P('ZZZ-PUE-2026-015').avance, esperado, 'con la fila antigua al final de la entrada');
    igual(P('ZZZ-PUE-2026-015').proximos_14_dias, [{ rubro_codigo: '1', rubro: 'ZZZ Tablero', inicio: '2026-11-01', fin: '2026-12-11' }], 'próximos: las fechas de la fila reciente');
    const alReves = con(f => { f.cronograma_rubros.reverse(); });
    igual(alReves.proyectos.find(p => p.identidad.codigo === 'ZZZ-PUE-2026-015').avance, esperado, 'con la fila antigua al principio');
    assert(seccionDe(md, 'ZZZ-PUE-2026-015').includes('programado 50,0 % (sin línea base activa)'), 'el .md lo avisa');
    // Con dos líneas base ACTIVAS vale la de número mayor (regla del núcleo), en cualquier orden.
    const dosActivas = con(f => { f.lineas_base.filter(l => l.proyecto_id === quince(f)).forEach(l => { l.activa = true; }); });
    igual([dosActivas.proyectos.find(p => p.identidad.codigo === 'ZZZ-PUE-2026-015').avance.linea_base, dosActivas.proyectos.find(p => p.identidad.codigo === 'ZZZ-PUE-2026-015').avance.spi], ['LB-2', 1], 'dos activas: LB-2');
    // Si la activa es la LB-1, se usa su fila aunque sea la más antigua.
    const unoActiva = con(f => { f.lineas_base.find(l => l.proyecto_id === quince(f) && l.numero === 1).activa = true; });
    const av = unoActiva.proyectos.find(p => p.identidad.codigo === 'ZZZ-PUE-2026-015').avance;
    igual([av.linea_base, av.programado_pct, av.spi, av.semaforo, av.cronograma_vencido], ['LB-1', 100, 0.5, 'rojo', true], 'LB-1 activa');
  });

  await prueba('próximos 14 días: solo la línea base activa, sin rubros terminados y con los bordes de la ventana', () => {
    igual(P('ZZZ-FIS-2026-001').proximos_14_dias, [
      { rubro_codigo: '1.02', rubro: 'ZZZ Mampostería', inicio: '2026-10-01', fin: '2026-11-30' },
      { rubro_codigo: '4.04', rubro: 'ZZZ Desencofrado', inicio: '2026-11-10', fin: '2026-11-21' },                 // termina hoy: entra
      { rubro_codigo: '3.01', rubro: 'ZZZ Instalaciones eléctricas', inicio: '2026-11-24', fin: '2026-12-15' },
      { rubro_codigo: '4.03', rubro: 'ZZZ Pintura exterior', inicio: '2026-12-05', fin: '2026-12-18' }], 'próximos');   // empieza a hoy+14: entra
    const f = fixture();
    const filaDe = codigo => { const r = f.rubros.find(x => x.codigo === codigo && x.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2026-001').id); return [r.estado].concat(f.cronograma_rubros.filter(c => c.rubro_id === r.id).map(c => c.fecha_inicio + '/' + c.fecha_fin)); };
    igual(filaDe('4.01'), ['terminado', '2026-11-15/2026-11-28'], 'el fixture trae un rubro terminado dentro de la ventana (no sale)');
    igual(filaDe('4.02'), ['planificado', '2026-12-06/2026-12-20'], 'y una actividad que empieza a hoy+15 (no sale)');
    igual(filaDe('4.05'), ['trabajando', '2026-11-01/2026-11-20'], 'y una que terminó ayer (no sale)');
    igual(filaDe('4.06'), ['trabajando', '2026-11-20/2026-11-30'], 'y una que solo está en la línea base antigua (no sale)');
    igual(P('ZZZ-CON-2026-003').proximos_14_dias, [], 'sin cronograma');
  });

  await prueba('planillas: última, en revisión y aprobadas sin pagar con fechas del historial', () => {
    igual(P('ZZZ-FIS-2026-001').planillas, {
      ultima: { numero: 4, periodo_desde: '2026-10-01', periodo_hasta: '2026-10-31', monto: 48250, estado: 'en_revision', fecha: '2026-11-12' },
      en_revision: [{ numero: 4, monto: 48250, desde: '2026-11-12', dias: 9 }],
      aprobadas_sin_pagar: [{ numero: 3, monto: 39100, aprobada: '2026-10-31', dias: 21 }]
    }, 'planillas');
    igual(P('ZZZ-CON-2026-003').planillas, { ultima: null, en_revision: [], aprobadas_sin_pagar: [] }, 'sin planillas');
    igual(P('ZZZ-FIS-2024-009').planillas.aprobadas_sin_pagar, [{ numero: 7, monto: 9500, aprobada: '2026-09-15', dias: 67 }], 'aprobada sin pagar del 009');
  });

  await prueba('las planillas aprobadas sin pagar NO van en «Esperan decisión»: quedan en el bloque del proyecto', () => {
    assert(!estado.resumen.esperan_decision.some(d => /aprobada/.test(d.clase) || /Planilla (3|7)\b/.test(d.detalle)), 'ninguna fila de planilla aprobada');
    igual(decision('planilla_en_revision').map(d => [d.proyecto, d.detalle]), [['ZZZ-FIS-2026-001', 'Planilla 4']], 'solo la que está en revisión');
    assert(seccionDe(md, 'ZZZ-FIS-2024-009').includes('Aprobadas sin pagar: n.º 7, $ 9.500,00, aprobada el 2026-09-15 (67 días)'), 'sigue en el bloque del proyecto');
  });

  await prueba('garantías: días para vencer, vencida y «por definir»', () => {
    igual(P('ZZZ-FIS-2026-001').garantias, [
      { tipo: 'fiel_cumplimiento', vigencia_hasta: '2026-11-25', dias_para_vencer: 4, estado: 'vigente', vencida: false },
      { tipo: 'buen_uso_anticipo', vigencia_hasta: '2027-02-01', dias_para_vencer: 72, estado: 'vigente', vencida: false },
      { tipo: 'todo_riesgo', vigencia_hasta: null, dias_para_vencer: null, estado: 'vigente', vencida: false }], 'garantías');
    igual(P('ZZZ-PIL-2026-002').garantias, [{ tipo: 'fiel_cumplimiento', vigencia_hasta: '2026-11-10', dias_para_vencer: -11, estado: 'vigente', vencida: true }], 'vencida');
  });

  await prueba('órdenes de cambio, libro, observaciones, calidad, documentos y equipo', () => {
    const p = P('ZZZ-FIS-2026-001');
    igual(p.ordenes_cambio, { por_estado: { borrador: 0, solicitada: 1, aprobada: 2, rechazada: 1 },
      solicitadas: [{ numero: 3, titulo: 'ZZZ Refuerzo de losa', monto: 12000, desde: '2026-11-15', dias: 6 }] }, 'órdenes de cambio');
    igual(p.libro, { ultimo_registro: '2026-11-19', dias_sin_registro: 2, pendientes_aprobacion: 2 }, 'libro');
    igual(P('ZZZ-CON-2026-003').libro, { ultimo_registro: null, dias_sin_registro: null, pendientes_aprobacion: 0 }, 'libro sin registros');
    igual(p.observaciones, { abiertas: 3, en_proceso: 1, mas_antiguas: [
      { numero: 12, titulo: 'ZZZ Curado deficiente', dias: 34, creada_por: 'Ana Zzzperez' },
      { numero: 14, titulo: 'ZZZ Encofrado desalineado', dias: 20, creada_por: 'Luis Zzzmora' },
      { numero: 15, titulo: 'ZZZ Acero expuesto', dias: 10, creada_por: 'Ana Zzzperez' }], con_antecedente: 1 }, 'observaciones');
    igual(p.calidad_seguridad, { ensayos_fallidos_abiertos: 3, ensayos_fallidos_sin_reensayo: 2, incidentes_sst_abiertos: 0, solicitudes_pendientes: 2 }, 'calidad y seguridad');
    igual(P('ZZZ-PIL-2026-002').calidad_seguridad.incidentes_sst_abiertos, 2, 'incidentes abiertos o en investigación');
    igual(p.documentos, { por_modulo: { general: 4, contratos: 1, libro_obra: 12, curva_s: 3 }, contrato_cargado: true }, 'documentos (curvaS se suma a curva_s)');
    igual(P('ZZZ-PIL-2026-002').documentos, { por_modulo: { general: 3, sin_modulo: 1 }, contrato_cargado: false }, 'sin contrato');
    igual(p.equipo, [{ nombre: 'Ana Zzzperez', rol: 'fiscalizador' }, { nombre: 'Luis Zzzmora', rol: 'residente' }], 'equipo sin duplicados');
    igual(P('ZZZ-PIL-2026-002').equipo, [{ nombre: 'Eva Zzzleon', rol: 'fiscalizador' }, { nombre: '(perfil no encontrado)', rol: 'residente' }], 'equipo por perfil_id y perfil ausente');
  });

  await prueba('resumen por gestora, emisor, tipo y semáforo: totales de los proyectos INCLUIDOS', () => {
    const r = estado.resumen;
    igual(Object.keys(r), ['por_gestora', 'por_emisor', 'por_tipo', 'semaforo', 'esperan_decision'], 'partes del resumen');
    igual(r.por_gestora, [{ sigla: 'ZZG', nombre: 'ZZZ GESTORA', proyectos: 10, monto_vigente: 748600, proyectos_sin_monto: 0 }, { sigla: 'ZZH', nombre: 'ZZZ SEGUNDA', proyectos: 1, monto_vigente: 0, proyectos_sin_monto: 0 }], 'por gestora');
    igual(r.por_emisor.map(x => [x.sigla, x.proyectos, x.monto_vigente]), [['ZZG', 8, 598600], ['ZZE', 2, 150000], ['ZZH', 1, 0]], 'por emisor');
    igual(r.por_tipo.map(x => [x.tipo, x.proyectos]), [['fiscalizacion', 6], ['construccion', 1], ['disenos', 1], ['muros_pantalla', 1], ['pilotes', 1], ['puentes', 1]], 'por tipo');
    igual(r.semaforo, { rojo: 1, amarillo: 1, verde: 9, sin_datos: 0 }, 'semáforo');
    [r.por_gestora, r.por_emisor, r.por_tipo].forEach(lista => igual(lista.reduce((s, x) => s + x.proyectos, 0), estado.proyectos_incluidos, 'la suma es la de los incluidos, no la de la cartera'));
    igual(estadoDelResumen(estado), 'ok', 'resumen completo');
    assert(md.includes('Los totales por gestora, emisor y tipo cuentan solo los 11 proyectos incluidos en este archivo, no toda la cartera.'), 'el .md lo dice');
  });

  await prueba('resumen: una empresa que falta en el catálogo se agrupa como «(empresa no encontrada)» y no tumba nada', () => {
    const e = con(f => { f.empresas = f.empresas.filter(x => x.sigla !== 'ZZE'); });
    igual(estadoDelResumen(e), 'ok', 'las cinco partes se calculan');
    igual(e.resumen.por_emisor.map(x => [x.sigla, x.nombre, x.proyectos, x.monto_vigente]), [['ZZG', 'ZZZ GESTORA', 8, 598600], [null, '(empresa no encontrada)', 2, 150000], ['ZZH', 'ZZZ SEGUNDA', 1, 0]], 'por emisor');
    igual(e.resumen.por_gestora, estado.resumen.por_gestora, 'por gestora no cambia');
    igual([e.resumen.por_tipo, e.resumen.semaforo, e.resumen.esperan_decision], [estado.resumen.por_tipo, estado.resumen.semaforo, estado.resumen.esperan_decision], 'el resto del resumen no cambia');
    igual(e.bloques_fallidos.filter(x => x.bloque === 'identidad.empresa').map(x => [x.proyecto, x.indice, x.motivo]), [['ZZZ-PUE-2026-015', 10, 'empresa no encontrada en el catálogo'], ['ZZZ-PIL-2026-002', 0, 'empresa no encontrada en el catálogo']], 'queda anotado en los dos proyectos');
    const id = e.proyectos[0].identidad;
    igual([id.codigo, id.gestora, id.emisor, id.tipo], ['ZZZ-PIL-2026-002', 'ZZG', '(empresa no encontrada)', 'pilotes'], 'identidad del proyecto afectado');
    const m = estadoAMarkdown(e);
    assert(m.includes('- Por emisor: ZZZ GESTORA 8 · (empresa no encontrada) 2 · ZZZ SEGUNDA 1'), '.md, resumen');
    assert(m.includes('**Identidad.** Gestora ZZZ GESTORA · emisor (empresa no encontrada) · pilotes · en ejecución'), '.md, identidad');
    assert(m.includes('| Garantía vencida | ZZZ-PIL-2026-002 |'), 'la tabla de decisiones sigue completa');
  });

  await prueba('resumen: cada parte se calcula por separado; si una falla, queda en null con su entrada y las demás siguen', () => {
    const f = fixture(); delete f.empresas;
    const e = construirEstado(f, OPCIONES);
    igual([e.resumen.por_gestora, e.resumen.por_emisor], [null, null], 'sin la tabla de empresas no hay agrupación por empresa');
    igual([e.resumen.por_tipo, e.resumen.semaforo, e.resumen.esperan_decision], [estado.resumen.por_tipo, estado.resumen.semaforo, estado.resumen.esperan_decision], 'tipo, semáforo y decisiones se calculan igual');
    igual(e.bloques_fallidos.filter(x => x.bloque.startsWith('resumen.')), [
      { bloque: 'resumen.por_gestora', proyecto: null, indice: null, motivo: 'falta la tabla «empresas» en los datos' },
      { bloque: 'resumen.por_emisor', proyecto: null, indice: null, motivo: 'falta la tabla «empresas» en los datos' }], 'una entrada por parte fallida');
    igual(estadoDelResumen(e), 'parcial', 'resumen parcial');
    igual(codigos(e), INCLUIDOS, 'los proyectos salen todos, con su código');
    assert(e.proyectos.every(p => p.identidad.gestora === null && p.identidad.nombre && p.identidad.tipo !== undefined), 'identidad sin empresas pero con lo demás');
    const m = estadoAMarkdown(e);
    assert(m.includes('- Por gestora: no se pudo calcular: falta la tabla «empresas» en los datos') && m.includes('- Por emisor: no se pudo calcular: falta la tabla «empresas» en los datos'), '.md, partes fallidas');
    assert(m.includes('- Por tipo: fiscalización 6 ·') && m.includes('- Semáforo: 1 rojo · 1 amarillo · 9 verdes') && m.includes('| Garantía vencida | ZZZ-PIL-2026-002 |'), '.md, partes calculadas');
    assert(m.includes('**Identidad.** Gestora y emisor: no se pudo calcular: falta la tabla «empresas» en los datos · pilotes · en ejecución'), '.md, identidad');
    igual([estadoDelResumen({ resumen: null }), estadoDelResumen({ resumen: { por_gestora: null, por_emisor: null, por_tipo: null, semaforo: null, esperan_decision: null } }), estadoDelResumen({ resumen: { ...estado.resumen, semaforo: null } })], ['null', 'null', 'parcial'], 'estadoDelResumen');
    assert(estadoAMarkdown({ ...estado, resumen: { ...estado.resumen, esperan_decision: null, semaforo: null } }).includes('- Semáforo: no se pudo calcular: motivo no registrado'), 'el .md no se rompe con partes en null');
  });

  await prueba('«Esperan decisión»: D5 (más de 15 días), D7 (15 días o menos) y orden por urgencia con «dias» y «sentido»', () => {
    const d = estado.resumen.esperan_decision;
    igual(d.map(x => [x.clase, x.proyecto, x.dias, x.sentido]), [
      ['garantia_vencida', 'ZZZ-PIL-2026-002', 11, 'vencida_hace'],
      ['garantia_por_vencer', 'ZZZ-FIS-2026-001', 4, 'faltan'],
      ['garantia_por_vencer', 'ZZZ-FIS-2025-004', 15, 'faltan'],
      ['observacion_antigua', 'ZZZ-DIS-2026-013', 40, 'esperando'],
      ['observacion_antigua', 'ZZZ-FIS-2026-001', 34, 'esperando'],
      ['orden_cambio_solicitada', 'ZZZ-DIS-2026-013', 20, 'esperando'],
      ['liquidacion_pendiente', 'ZZZ-FIS-2025-005', 20, 'esperando'],
      ['observacion_antigua', 'ZZZ-FIS-2026-001', 20, 'esperando'],
      ['observacion_antigua', 'ZZZ-CON-2026-003', 16, 'esperando'],
      ['planilla_en_revision', 'ZZZ-FIS-2026-001', 9, 'esperando'],
      ['orden_cambio_solicitada', 'ZZZ-FIS-2026-001', 6, 'esperando'],
      ['acta_definitiva_pendiente', 'ZZZ-MUR-2026-016', null, 'esperando']], 'lista y orden');
    d.forEach(x => igual(Object.keys(x), ['clase', 'proyecto', 'detalle', 'desde', 'dias', 'sentido', 'monto'], 'claves de la fila'));
    igual(decision('planilla_en_revision')[0], { clase: 'planilla_en_revision', proyecto: 'ZZZ-FIS-2026-001', detalle: 'Planilla 4', desde: '2026-11-12', dias: 9, sentido: 'esperando', monto: 48250 }, 'planilla');
    igual(decision('garantia_vencida')[0], { clase: 'garantia_vencida', proyecto: 'ZZZ-PIL-2026-002', detalle: 'Fiel cumplimiento, venció el 2026-11-10', desde: '2026-11-10', dias: 11, sentido: 'vencida_hace', monto: null }, 'garantía vencida');
    igual(decision('observacion_antigua', 'ZZZ-FIS-2026-001')[0], { clase: 'observacion_antigua', proyecto: 'ZZZ-FIS-2026-001', detalle: 'Observación n.º 12 «ZZZ Curado deficiente», creada por Ana Zzzperez', desde: '2026-10-18', dias: 34, sentido: 'esperando', monto: null }, 'D5: se muestra «creada por»');
    assert(!d.some(x => /Señalética|Acero expuesto|Andamio|Sello de junta/.test(x.detalle)), 'las observaciones de 15 días o menos no entran');
    assert(!d.some(x => x.proyecto === 'ZZZ-CON-2026-003' && /garantia/.test(x.clase)), 'una garantía que vence en 16 días no entra');
    assert(!d.some(x => x.clase === 'garantia_por_vencer' && x.proyecto === 'ZZZ-PIL-2026-002'), 'una vencida no es «por vencer»');
  });

  await prueba('«Esperan decisión»: la garantía que vence hoy va justo después de las vencidas, y la más vencida primero', () => {
    const e = con(f => {
      f.garantias.find(g => g.proyecto_id === proyectoDe(f, 'ZZZ-CON-2026-003').id).vigencia_hasta = '2026-11-21';    // vence hoy
      f.garantias.find(g => g.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2024-008').id).vigencia_hasta = '2026-08-01';    // vencida hace 112
      f.garantias.push({ proyecto_id: proyectoDe(f, 'ZZZ-FIS-2024-008').id, tipo: 'otra', vigencia_hasta: null, estado: 'vigente' });   // por definir: no cuenta
      f.garantias.push({ proyecto_id: proyectoDe(f, 'ZZZ-FIS-2024-008').id, tipo: 'otra', vigencia_hasta: '2026-11-01', estado: 'devuelta' });   // no vigente: no cuenta
    });
    igual(e.resumen.esperan_decision.slice(0, 6).map(x => [x.clase, x.proyecto, x.dias, x.sentido]), [
      ['garantia_vencida', 'ZZZ-FIS-2024-008', 112, 'vencida_hace'],
      ['garantia_vencida', 'ZZZ-PIL-2026-002', 11, 'vencida_hace'],
      ['garantia_por_vencer', 'ZZZ-CON-2026-003', 0, 'faltan'],
      ['garantia_por_vencer', 'ZZZ-FIS-2026-001', 4, 'faltan'],
      ['garantia_por_vencer', 'ZZZ-FIS-2025-004', 15, 'faltan'],
      ['observacion_antigua', 'ZZZ-DIS-2026-013', 40, 'esperando']], 'orden por urgencia');
    const m = estadoAMarkdown(e);
    assert(m.includes('| Garantía por vencer | ZZZ-CON-2026-003 | Otra, vence el 2026-11-21 | — | vence hoy |'), '.md: vence hoy');
    assert(m.includes('| Garantía vencida | ZZZ-FIS-2024-008 | Fiel cumplimiento, venció el 2026-08-01 | 2026-08-01 | vencida hace 112 |'), '.md: vencida');
    assert(seccionDe(m, 'ZZZ-CON-2026-003').includes('**Garantías.** Otra hasta 2026-11-21 (vence hoy)'), '.md del proyecto');
  });

  await prueba('limpiador: los correos y los uuid de los textos libres se sustituyen por «(dato omitido)»', () => {
    const crudo = fs.readFileSync(RUTA_FIXTURE, 'utf8');
    assert(crudo.includes('zzz.contratista@zzz-ejemplo.test') && crudo.includes('zzz.residente@zzz-ejemplo.test') && crudo.includes('bbbbbbbb-1111-4222-8333-444444444444') && crudo.includes('cccccccc-1111-4222-8333-444444444444'), 'el fixture SÍ trae correos y uuid en textos libres');
    igual(limpiarTexto('ver a@b.com y a "x.y+z@sub.dominio.ec", id 0f8fad5b-d9cb-469f-a165-70867728950e.'), 'ver (dato omitido) y a "(dato omitido)", id (dato omitido).', 'limpiarTexto');
    igual([limpiarTexto('sin nada que quitar | 3 @'), limpiarTexto(null), limpiarTexto('correo:(q@w.io)')], ['sin nada que quitar | 3 @', '', 'correo:((dato omitido))'], 'casos de borde');
    igual(limpiarTexto('ZZZ Acero Ø12@20cm y malla 6mm@15, avisar a obra@zzz.test'), 'ZZZ Acero Ø12@20cm y malla 6mm@15, avisar a (dato omitido)', 'la arroba de obra se respeta');
    igual(P('ZZZ-DIS-2026-013').identidad.descripcion, 'ZZZ Diseños cancelados. Contacto: (dato omitido) (ref. (dato omitido)).', 'descripción del proyecto');
    igual(P('ZZZ-DIS-2026-013').observaciones.mas_antiguas[0].titulo, 'ZZZ Avisar a (dato omitido)', 'título de observación');
    igual(P('ZZZ-DIS-2026-013').ordenes_cambio.solicitadas[0].titulo, 'ZZZ Ajuste ref. (dato omitido)', 'título de orden de cambio');
    igual(estado.resumen.esperan_decision.filter(d => d.proyecto === 'ZZZ-DIS-2026-013').map(d => d.detalle), ['Observación n.º 7 «ZZZ Avisar a (dato omitido)», creada por Luis Zzzmora', 'OC-02 «ZZZ Ajuste ref. (dato omitido)»'], 'detalle de «Esperan decisión»');
    // Un correo en cualquier otro texto libre, y en el motivo de un fallo, tampoco pasa.
    const e = con(f => { const p = proyectoDe(f, 'ZZZ-FIS-2026-001'); p.nombre = 'ZZZ Obra de n@zzz.test'; p.contratista = 'ZZZ c@zzz.test'; p.ubicacion = 'ZZZ u@zzz.test'; p.latitud = 'l@zzz.test';
      f.rubros.find(r => r.codigo === '1.02').descripcion = 'ZZZ r@zzz.test'; f.perfiles[0].apellido = 'p@zzz.test'; f.empresas[0].nombre = 'ZZZ e@zzz.test'; });
    const t = JSON.stringify(e) + estadoAMarkdown(e);
    assert(!t.includes('@') && !t.includes('zzz.test'), 'ningún correo en la salida');
    igual(e.proyectos[1].identidad.nombre, 'ZZZ Obra de (dato omitido)', 'nombre del proyecto limpio');
  });

  await prueba('la salida no lleva identificadores internos ni correos', () => {
    assert(!RE_UUID.test(texto), 'uuid en el .json: ' + (texto.match(RE_UUID) || [])[0]);
    assert(!RE_UUID.test(md), 'uuid en el .md');
    assert(!texto.includes('@') && !md.includes('@'), 'no debe haber «@»');
    assert(!/"(id|proyecto_id|empresa_id|emisor_empresa_id|rubro_id|linea_base_id|creado_por|usuario_id|perfil_id)"/.test(texto), 'no debe haber claves de identificador');
  });

  await prueba('.md: primera línea, cabecera, resumen y tabla de decisiones rotulada', () => {
    const l = md.split('\n');
    igual(l[0], '# Estado de proyectos GdO — válido para el 2026-11-21', 'primera línea');
    igual(l[2], 'Generado: 2026-11-21 03:14 (America/Guayaquil) · formato 1 · app hidivo-vZZ · 11 proyectos de 17 · excluidos: 1 sin código, 2 liquidados, 3 finalizados o cancelados sin pendientes', 'cabecera');
    ['- Por gestora: ZZZ GESTORA 10 proyectos · ZZZ SEGUNDA 1 proyecto', '- Por emisor: ZZZ GESTORA 8 · ZZZ EMISOR 2 · ZZZ SEGUNDA 1',
      '- Por tipo: fiscalización 6 · construcción 1 · diseños 1 · muros pantalla 1 · pilotes 1 · puentes 1', '- Semáforo: 1 rojo · 1 amarillo · 9 verdes', '### Esperan decisión de Nicolás',
      '| Qué | Proyecto | Detalle | Desde | Días |',
      '| Planilla en revisión | ZZZ-FIS-2026-001 | Planilla 4, $ 48.250,00 | 2026-11-12 | 9 días |',
      '| Orden de cambio solicitada | ZZZ-FIS-2026-001 | OC-03 «ZZZ Refuerzo de losa», $ 12.000,00 | 2026-11-15 | 6 días |',
      '| Garantía por vencer | ZZZ-FIS-2026-001 | Fiel cumplimiento, vence el 2026-11-25 | — | vence en 4 |',
      '| Garantía vencida | ZZZ-PIL-2026-002 | Fiel cumplimiento, venció el 2026-11-10 | 2026-11-10 | vencida hace 11 |',
      '| Liquidación pendiente | ZZZ-FIS-2025-005 | Con acta definitiva y sin liquidación | 2026-11-01 | 20 días |',
      '| Acta definitiva pendiente | ZZZ-MUR-2026-016 | Con acta provisional y sin acta definitiva | — | — |'
    ].forEach(x => assert(l.includes(x), 'falta la línea: ' + x));
    const dias = l.filter(x => /^\| (?!Qué|---)/.test(x)).map(x => x.split(' | ').pop().replace(' |', ''));
    igual(dias, ['vencida hace 11', 'vence en 4', 'vence en 15', '40 días', '34 días', '20 días', '20 días', '20 días', '16 días', '9 días', '6 días', '—'], 'columna Días, por urgencia');
    // Un solo excluido de cada clase, y ninguno.
    const uno = { ...estado, proyectos_excluidos: { sin_codigo: 0, liquidados: 1, cerrados_sin_pendientes: 1 } };
    assert(estadoAMarkdown(uno).split('\n')[2].endsWith('· 11 proyectos de 17 · excluidos: 1 liquidado, 1 finalizado o cancelado sin pendientes'), 'singular');
    assert(estadoAMarkdown({ ...estado, proyectos_excluidos: { sin_codigo: 0, liquidados: 0, cerrados_sin_pendientes: 0 } }).split('\n')[2].endsWith('· 11 proyectos de 17'), 'sin excluidos');
    // Sin nada que decidir y sin bloques fallidos.
    const limpio = con(sanear);
    igual(limpio.bloques_fallidos, [], 'sin la fecha corrupta no falla nada');
    const mLimpio = estadoAMarkdown(limpio);
    assert(mLimpio.includes('Bloques sin calcular: ninguno') && !mLimpio.includes('Tabla incompleta'), '.md sin fallos');
    assert(mLimpio.includes('| Planilla en revisión | ZZZ-PIL-2026-002 | Planilla 1, $ 9.000,00 | 2026-11-20 | 1 día |'), 'un día, en singular');
  });

  await prueba('.md: una sección por proyecto con sus 11 bloques y números es-EC', () => {
    igual(md.split('\n').filter(x => x.startsWith('## ') && x !== '## Resumen'), ['## 🔴 ZZZ-PIL-2026-002 — ZZZ Pilotes de ejemplo', '## 🟡 ZZZ-FIS-2026-001 — ZZZ Edificio de ejemplo',
      '## 🟢 ZZZ-CON-2026-003 — ZZZ Obra pausada', '## 🟢 ZZZ-DIS-2026-013 — ZZZ Cancelado con pendientes', '## 🟢 ZZZ-FIS-2024-008 — ZZZ Solo garantia vigente',
      '## 🟢 ZZZ-FIS-2024-009 — ZZZ Solo planilla aprobada', '## 🟢 ZZZ-FIS-2024-010 — ZZZ Solo observacion en proceso', '## 🟢 ZZZ-FIS-2025-004 — ZZZ Finalizado sin acta',
      '## 🟢 ZZZ-FIS-2025-005 — ZZZ Finalizado sin liquidar', '## 🟢 ZZZ-MUR-2026-016 — ZZZ Muro con recepcion provisional', '## 🟢 ZZZ-PUE-2026-015 — ZZZ Puente sin linea base activa'], 'secciones');
    const seccion = seccionDe(md, 'ZZZ-FIS-2026-001');
    ['**Identidad.** Gestora ZZZ GESTORA · emisor ZZZ GESTORA · fiscalización · en ejecución',
      'Contratante: ZZZ Cliente de Ejemplo S.A. · Contratista: ZZZ Constructora de Ejemplo',
      'Ubicación: ZZZ Ciudad de Ejemplo (sin coordenadas)',
      'Firma: no registrada · Inicio: 2026-08-03 · Fin contractual: 2026-12-15',
      'Monto contractual $ 410.000,00 · vigente $ 428.600,00 (órdenes de cambio $ 18.600,00)',
      'Descripción: Construcción de un edificio de dos plantas. Incluye obras exteriores | y cerramiento.',
      '**Avance.** Ejecutado 61,7 % · programado 63,0 % (LB-2) · valor ganado 58,3 % · SPI 0,92 · atraso estimado 9 días',
      'Semáforo amarillo: SPI 0,92; 1 garantía por vencer en 5 días o menos; 7 pendientes (libro, observaciones y solicitudes)',
      '**Próximos 14 días.** 1.02 ZZZ Mampostería (01-oct a 30-nov) · 4.04 ZZZ Desencofrado (10-nov a 21-nov) · 3.01 ZZZ Instalaciones eléctricas (24-nov a 15-dic) · 4.03 ZZZ Pintura exterior (05-dic a 18-dic)',
      '**Planillas.** Última: n.º 4, 01 a 31-oct, $ 48.250,00, en revisión desde el 2026-11-12 (9 días)',
      'Aprobadas sin pagar: n.º 3, $ 39.100,00, aprobada el 2026-10-31 (21 días)',
      '**Garantías.** Fiel cumplimiento hasta 2026-11-25 (4 días) · Buen uso del anticipo hasta 2027-02-01 · Todo riesgo, vigencia por definir',
      '**Órdenes de cambio.** 2 aprobadas · 1 rechazada · 1 solicitada: OC-03 «ZZZ Refuerzo de losa», 6 días',
      '**Libro de obra.** Último registro 2026-11-19 (hace 2 días) · 2 por aprobar',
      '**Observaciones.** 3 abiertas · 1 en proceso · 1 con antecedente',
      'Más antiguas: n.º 12 «ZZZ Curado deficiente» (34 días, creada por Ana Zzzperez) · n.º 14 «ZZZ Encofrado desalineado» (20 días, creada por Luis Zzzmora) · n.º 15 «ZZZ Acero expuesto» (10 días, creada por Ana Zzzperez)',
      '**Calidad y seguridad.** 2 ensayos fallidos sin re-ensayo (3 fallidos abiertos) · 0 incidentes abiertos · 2 solicitudes pendientes',
      '**Documentos.** Contrato cargado · general 4 · contratos 1 · libro de obra 12 · curva S 3',
      '**Equipo.** Ana Zzzperez (fiscalizador) · Luis Zzzmora (residente)'
    ].forEach(x => assert(seccion.split('\n').includes(x), 'falta la línea: ' + x + '\n' + seccion));
    assert(md.includes('**Identidad.** Gestora ZZZ GESTORA · emisor ZZZ EMISOR · pilotes · en ejecución'), 'emisor documental en el .md');
    assert(md.includes('Ubicación: ZZZ Muelle de Ejemplo (-2,190000; -79,880000)'), 'coordenadas');
    assert(md.includes('**Garantías.** Fiel cumplimiento hasta 2026-11-10 (vencida hace 11 días)'), 'garantía vencida');
    assert(md.includes('· finalizado · recepción definitiva') && md.includes('· diseños · cancelado') && md.includes('· en ejecución · recepción provisional'), 'estado y estado de cierre');
    estado.proyectos.forEach((p, i) => {
      const trozo = md.split(/^## (?!Resumen)/m)[i + 1];
      ['Identidad', 'Avance', 'Próximos 14 días', 'Planillas', 'Garantías', 'Órdenes de cambio', 'Libro de obra', 'Observaciones', 'Calidad y seguridad', 'Documentos', 'Equipo']
        .forEach(b => assert(trozo.includes(`**${b}.**`), `falta el bloque ${b} en la sección ${i + 1}`));
    });
  });

  await prueba('consulta.sql: una clave por tabla exigida, sin proyecto_emisor_historial ni columnas sin uso, y con orden estable', () => {
    const sql = fs.readFileSync(path.join(RAIZ, 'exportacion', 'consulta.sql'), 'utf8');
    const codigoSql = sql.split(/\r?\n/).filter(x => !x.trim().startsWith('--')).join('\n');
    const claves = [...codigoSql.matchAll(/^  '([a-z_0-9]+)', \(/gm)].map(m => m[1]);
    igual(claves, TABLAS, 'las claves de la consulta son las tablas que exige exportar.js, en el mismo orden');
    igual(Object.keys(fixture()), TABLAS, 'y las del fixture');
    assert(!/proyecto_emisor_historial/.test(sql) && !TABLAS.includes('proyecto_emisor_historial'), 'proyecto_emisor_historial ya no se consulta ni se exige');
    assert(!/\bes_gestora\b|\bgravedad\b|\bregistros\b|\bmonto,|\bcorreo\b|\bemail\b|\btelefono\b|\bcedula\b/.test(codigoSql), 'sin columnas que el generador no usa ni datos personales');
    const bloque = nombre => { const i = codigoSql.indexOf(`'${nombre}', (`); return codigoSql.slice(i, codigoSql.indexOf(') t)', i)); };
    assert(/json_agg\(t order by t\.proyecto_id, t\.rubro_id, t\.created_at, t\.id\)/.test(bloque('cronograma_rubros')), 'cronograma_rubros: por proyecto, rubro, fecha de creación e id');
    ['id', 'proyecto_id', 'rubro_id', 'linea_base_id', 'fecha_inicio', 'fecha_fin', 'created_at'].forEach(c => assert(new RegExp('\\b' + c + '\\b').test(bloque('cronograma_rubros').split('select')[2]), 'cronograma_rubros trae ' + c));
    assert(/json_agg\(t order by t\.proyecto_id, t\.numero/.test(bloque('lineas_base')), 'lineas_base: por proyecto y número');
    assert(!/\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i.test(codigoSql), 'solo lectura');
    // Las columnas del fixture son exactamente las de la consulta (para las tablas sin agregados).
    const f = fixture();
    ['proyectos', 'empresas', 'rubros', 'cronograma_rubros', 'lineas_base', 'planillas_pago', 'planilla_historial', 'garantias', 'ordenes_cambio', 'ensayos', 'sst_incidentes', 'solicitudes', 'proyecto_miembros', 'perfiles', 'actas_recepcion', 'liquidaciones'].forEach(t => {
      const cols = bloque(t).split('select')[2].split('from')[0].split(',').map(x => x.trim()).filter(Boolean).sort();
      igual(Object.keys(f[t][0]).sort(), cols, 'columnas de ' + t);
    });
  });

  await prueba('exportar.js: acepta las cuatro envolturas del JSON de entrada', () => {
    const f = fixture();
    [f, { datos: f }, [{ datos: f }], { rows: [{ datos: f }] }, [{ datos: JSON.stringify(f) }]].forEach((x, i) => igual(desenvolver(x).proyectos.length, 17, 'envoltura ' + i));
    [{}, [], [{ datos: f }, { datos: f }], { datos: { proyectos: [] } }, 'x', null].forEach((x, i) => {
      let fallo = false; try{ desenvolver(x); }catch(e){ fallo = true; }
      assert(fallo, 'la entrada mala ' + i + ' debe rechazarse');
    });
    // Un JSON de consulta antigua (con la tabla que ya no se pide) sigue valiendo: la clave de más se ignora.
    igual(desenvolver({ ...f, proyecto_emisor_historial: [] }).proyectos.length, 17, 'clave de más');
  });

  await prueba('exportar.js: códigos de salida 0 / 3 / 2 / 1, línea RESULTADO, los dos archivos siempre y ningún dato de la entrada en los errores', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zzz-exportacion-'));
    try{
      const cli = path.join(RAIZ, 'exportacion', 'exportar.js');
      const correr = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
      const lineas = r => r.stdout.trim().split(/\r?\n/);
      const sinDatos = (r, que) => assert(!/ZZZ|zzz\.|Zzz|aaaaaaaa-0000/.test(r.stderr.replace(/zzz-exportacion-/g, '')), `${que}: el error no debe volcar contenido de la entrada: ${r.stderr}`);

      // 3: corrida degradada (el fixture trae una planilla corrupta). Escribe los dos archivos igualmente.
      const envuelto = path.join(tmp, 'rows.json');
      fs.writeFileSync(envuelto, '﻿' + JSON.stringify({ rows: [{ datos: fixture() }] }));
      const salida = path.join(tmp, 'salida');
      const r = correr(envuelto, salida, '--ahora', AHORA);
      igual([r.status, lineas(r)], [3, ['Estado válido para 2026-11-21: 11 proyectos de 17, 1 bloques fallidos', 'RESULTADO proyectos=11 fallidos=1 resumen=ok']], 'corrida degradada');
      igual(fs.readdirSync(salida).sort(), ['GDO-estado-proyectos.json', 'GDO-estado-proyectos.md'], 'los dos archivos y ningún provisional');
      const escrito = JSON.parse(fs.readFileSync(path.join(salida, 'GDO-estado-proyectos.json'), 'utf8'));
      const sw = fs.readFileSync(path.join(RAIZ, 'service-worker.js'), 'utf8').split(/\r?\n/)[0];
      assert(/^hidivo-v\d+$/.test(escrito.version_app) && sw.includes(`'${escrito.version_app}'`), 'la versión sale de service-worker.js: ' + escrito.version_app);
      igual({ ...escrito, version_app: 'hidivo-vZZ' }, estado, 'el .json escrito es el estado');
      igual(fs.readFileSync(path.join(salida, 'GDO-estado-proyectos.md'), 'utf8'), estadoAMarkdown(escrito), 'el .md escrito');
      igual(correr(envuelto, salida, '--ahora', AHORA, '--version-app', 'hidivo-vXX').status, 3, 'con --version-app');
      igual(JSON.parse(fs.readFileSync(path.join(salida, 'GDO-estado-proyectos.json'), 'utf8')).version_app, 'hidivo-vXX', '--version-app manda');

      // 0: sin el dato corrupto no hay bloques fallidos.
      const limpio = sanear(fixture());
      const rutaLimpia = path.join(tmp, 'limpio.json'); fs.writeFileSync(rutaLimpia, JSON.stringify(limpio));
      const salidaLimpia = path.join(tmp, 'salida-limpia');
      const r0 = correr(rutaLimpia, salidaLimpia, '--ahora', AHORA);
      igual([r0.status, lineas(r0), r0.stderr], [0, ['Estado válido para 2026-11-21: 11 proyectos de 17, 0 bloques fallidos', 'RESULTADO proyectos=11 fallidos=0 resumen=ok'], ''], 'corrida buena');
      igual(fs.readdirSync(salidaLimpia).sort(), ['GDO-estado-proyectos.json', 'GDO-estado-proyectos.md'], 'archivos de la corrida buena');

      // 3 también cuando lo que falta es una empresa del catálogo (el resumen sigue completo).
      const sinEmpresa = fixture(); sinEmpresa.empresas = sinEmpresa.empresas.filter(x => x.sigla !== 'ZZE'); sinEmpresa.planillas_pago = limpio.planillas_pago;
      const rutaSinEmpresa = path.join(tmp, 'sin-empresa.json'); fs.writeFileSync(rutaSinEmpresa, JSON.stringify(sinEmpresa));
      const r3 = correr(rutaSinEmpresa, path.join(tmp, 'salida-sin-empresa'), '--ahora', AHORA);
      igual([r3.status, lineas(r3)[1]], [3, 'RESULTADO proyectos=11 fallidos=2 resumen=ok'], 'empresa ausente: degradada');
      assert(fs.readFileSync(path.join(tmp, 'salida-sin-empresa', 'GDO-estado-proyectos.md'), 'utf8').includes('### Esperan decisión de Nicolás\n\n| Qué |'), 'y el .md trae la tabla de decisiones');

      // 1: sin proyectos no se escribe nada.
      const vacio = fixture(); vacio.proyectos = vacio.proyectos.filter(p => !p.codigo || p.estado_cierre === 'liquidado');
      const rutaVacio = path.join(tmp, 'vacio.json'); fs.writeFileSync(rutaVacio, JSON.stringify(vacio));
      const salidaVacia = path.join(tmp, 'salida-vacia');
      const rv = correr(rutaVacio, salidaVacia);
      igual([rv.status, lineas(rv)], [1, ['RESULTADO proyectos=0 fallidos=0 resumen=ok']], 'sin proyectos');
      assert(!fs.existsSync(salidaVacia), 'sin proyectos no se escribe nada');
      sinDatos(rv, 'sin proyectos');

      // 1: error inesperado (la carpeta de salida es un archivo). No queda nada a medias ni se vuelcan datos.
      const estorbo = path.join(tmp, 'estorbo'); fs.writeFileSync(estorbo, 'x');
      const re = correr(envuelto, estorbo, '--ahora', AHORA);
      igual([re.status, re.stdout], [1, ''], 'error inesperado');
      assert(re.stderr.startsWith('Error inesperado (el mensaje no se imprime para no volcar datos): Error'), 'mensaje fijo: ' + re.stderr.slice(0, 120));
      sinDatos(re, 'error inesperado');
      igual(fs.readFileSync(estorbo, 'utf8'), 'x', 'no se tocó nada');
      const conDato = new Error('valor «ZZZ secreto»'); conDato.name = 'TypeError';
      const fuenteCli = fs.readFileSync(cli, 'utf8');
      assert(fuenteCli.includes("+ describirSinDatos(e)); process.exitCode = SALIDA.ERROR;") && !/console\.(error|log)\([^\n]*e\.stack/.test(fuenteCli), 'el error inesperado se imprime solo con describirSinDatos');
      assert(describirSinDatos(conDato).startsWith('TypeError') && !describirSinDatos(conDato).includes('ZZZ secreto'), 'describirSinDatos nunca incluye el mensaje');

      // 2: entrada sin la forma esperada, JSON inválido, archivo inexistente o uso incorrecto.
      const rutaMala = path.join(tmp, 'mala.json'); fs.writeFileSync(rutaMala, JSON.stringify({ rows: [{ otra: 'ZZZ dato' }] }));
      const r2 = correr(rutaMala, salida);
      igual(r2.status, 2, 'forma inesperada'); sinDatos(r2, 'forma inesperada');
      const sinTabla = fixture(); delete sinTabla.garantias;
      fs.writeFileSync(rutaMala, JSON.stringify(sinTabla));
      const rt = correr(rutaMala, salida);
      igual([rt.status, rt.stderr.trim()], [2, 'Entrada no válida: faltan tablas en los datos: garantias'], 'falta una tabla'); sinDatos(rt, 'falta una tabla');
      fs.writeFileSync(rutaMala, '{ "nombre": "ZZZ dato que no debe verse", esto no es json');
      const rj = correr(rutaMala, salida);
      igual([rj.status, rj.stderr.trim()], [2, 'Entrada no válida: el archivo de entrada no es JSON válido'], 'JSON inválido'); sinDatos(rj, 'JSON inválido');
      igual(correr(path.join(tmp, 'no-existe.json'), salida).status, 2, 'archivo inexistente');
      igual(correr(envuelto).status, 2, 'faltan argumentos');
      igual(correr(envuelto, salida, '--ahora', 'ayer').status, 2, '--ahora inválido');
      igual(correr(envuelto, salida, '--otra').status, 2, 'opción desconocida');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  resumen();
})();
