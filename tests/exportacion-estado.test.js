// Exportación diaria del estado de proyectos: construirEstado(), estadoAMarkdown() y la
// línea de comandos exportar.js, con el código REAL de exportacion/ y de cartera-nucleo.js
// sobre un fixture SINTÉTICO (fixtures/exportacion-estado.json, todo con prefijo ZZZ; se
// regenera con herramientas/gen-fixture-exportacion.js, que explica cada proyecto).
//
// El fixture trae 32 proyectos, en orden revuelto: 26 que deben salir (13 en ejecución, que
// son los únicos con semáforo, 12 de los demás estados y uno sin estado) y 6 que no (dos liquidados, uno sin
// código y tres finalizados o cancelados sin pendientes). La planilla del proyecto de pilotes
// tiene una fecha corrupta a propósito, y hay un correo y un uuid metidos en textos libres.
//
// Formato 3 (decisiones del 21-nov-2026, tarde): plazo contractual vencido como motivo de rojo y
// «sin cronograma» nunca verde (reglas del núcleo), «próximos 14 días» solo en ejecución, solo
// rubros sin terminar que empiezan o terminan en la ventana y con tope de 10, cada planilla una
// sola vez, lo de los usuarios de prueba fuera de todo, monto que no cuadra en «datos por
// completar» y un .md sin atraso proyectado, sin caracteres fuera del plano básico y con línea
// final. El fixture tiene la forma de la consulta NUEVA; formaAnterior() deriva la de la función
// que sigue aplicada en producción (migración 20261121), con la que el generador debe valer igual.
//
// Formato 2 (decisiones del 21-nov-2026): semáforo solo en ejecución, avance principal = valor
// ganado de TODOS los rubros (el de los rubros con cronograma, que es el del SPI, va aparte), el
// ejecutado por cantidades aparte, SPI con su texto truncado, dos atrasos (a la fecha y
// proyectado) solo en los proyectos con semáforo, «datos por completar» (que cuentan como
// pendiente de un finalizado) y sin coordenadas. Las cifras esperadas están calculadas a mano
// con las reglas de la cabecera de cartera-nucleo.js; el comentario de cada caso dice cómo.
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
// Orden de salida: en ejecución (rojo, amarillo, verde; dentro por código), después pausado,
// planificación, finalizado y cancelado (dentro por código) y al final el que no tiene estado.
const EN_EJECUCION = ['ZZZ-CON-2026-018', 'ZZZ-CON-2026-027', 'ZZZ-MUR-2026-023', 'ZZZ-PIL-2026-002', 'ZZZ-PUE-2026-029',   // rojos
  'ZZZ-CON-2026-022', 'ZZZ-FIS-2026-001', 'ZZZ-MUR-2026-016', 'ZZZ-PIL-2026-030',                                 // amarillos
  'ZZZ-CON-2026-019', 'ZZZ-CON-2026-028', 'ZZZ-PUE-2026-015', 'ZZZ-PUE-2026-031'];                                // verdes
const COLORES = Array(5).fill('rojo').concat(Array(4).fill('amarillo'), Array(4).fill('verde'));
const SIN_SEMAFORO = ['ZZZ-CON-2026-003', 'ZZZ-CON-2026-025',                                                      // pausados
  'ZZZ-GER-2026-017',                                                                                           // planificación
  'ZZZ-FIS-2024-008', 'ZZZ-FIS-2024-009', 'ZZZ-FIS-2024-010', 'ZZZ-FIS-2024-020', 'ZZZ-FIS-2024-021', 'ZZZ-FIS-2024-024', 'ZZZ-FIS-2025-004', 'ZZZ-FIS-2025-005',   // finalizados
  'ZZZ-DIS-2026-013',                                                                                           // cancelado
  'ZZZ-GER-2026-026'];                                                                                          // sin estado (al final)
const INCLUIDOS = EN_EJECUCION.concat(SIN_SEMAFORO);
const SEMAFORO = { rojo: 5, amarillo: 4, verde: 4, sin_semaforo: { planificacion: 1, pausado: 2, finalizado: 8, cancelado: 1, sin_estado: 1 }, sin_datos: 0 };
const CLAVES_AVANCE = ['avance_pct', 'valor_ganado_cronograma_pct', 'ejecutado_cantidades_pct', 'programado_pct', 'spi', 'spi_texto', 'atraso_fecha_dias', 'atraso_proyectado_dias',
  'cronograma_vencido', 'fin_programado', 'plazo_contractual', 'linea_base', 'rubros_sin_cronograma', 'semaforo', 'motivos', 'datos_por_completar'];
// Plazo contractual del bloque de avance: fecha de fin del contrato y si ya pasó.
const plazo = (fecha, vencido = false) => ({ fecha, vencido });
const SIN_PLAZO = plazo(null);
// Avance de un proyecto sin cronograma: sin SPI ni atrasos.
const sinCronograma = (avance, cantidades, x) => ({ avance_pct: avance, valor_ganado_cronograma_pct: null, ejecutado_cantidades_pct: cantidades, programado_pct: null, spi: null, spi_texto: null, atraso_fecha_dias: null,
  atraso_proyectado_dias: null, cronograma_vencido: false, fin_programado: null, plazo_contractual: SIN_PLAZO, linea_base: null, rubros_sin_cronograma: 0, semaforo: null, motivos: [], datos_por_completar: [], ...x });
const DIF_022 = 'el valor ganado (100,0 %) y el ejecutado por cantidades (40,0 %) difieren en más de 10 puntos';
const SIN_PRODUCCION = 'proyecto finalizado sin producción registrada';
const SIN_ESTADO = 'proyecto sin estado registrado';
const PLANILLA_REPETIDA = 'planilla n.º 2 registrada 2 veces';
const MONTO_031 = 'el monto vigente ($ 56.000,00) no cuadra con el contractual más las órdenes de cambio aprobadas ($ 52.000,00): diferencia de $ 4.000,00';
const SIN_PROXIMOS = { lista: [], total: 0, mas: 0 };
const NOTA_FUNCION_ANTERIOR = 'usuarios de prueba: no se pudieron identificar (función de datos anterior)';
// Cualquier carácter fuera del plano básico de Unicode (código > U+FFFF) o sustituto suelto.
const RE_FUERA_BMP = /[\uD800-\uDFFF]/;
const proyectoDe = (f, codigo) => f.proyectos.find(p => p.codigo === codigo);
const codigos = e => e.proyectos.map(p => p.identidad.codigo);
// Un proyecto de un estado construido aparte, y su posición en la lista.
const PD = (e, codigo) => e.proyectos.find(p => p.identidad.codigo === codigo);
const indice = (e, codigo) => codigos(e).indexOf(codigo);
// Sección de un proyecto en el .md (desde su título hasta el siguiente).
const seccionDe = (md, codigo) => { const t = md.split(/^(?=## )/m).filter(x => x.startsWith('## ') && x.split('\n')[0].includes(' ' + codigo + ' — ')); assert(t.length === 1, `se esperaba una sección de ${codigo} y hay ${t.length}`); return t[0]; };
// Construye el estado tras modificar una copia del fixture.
const con = cambio => { const f = fixture(); cambio(f); return construirEstado(f, OPCIONES); };
// Los mismos datos con la forma que devuelve la función ANTERIOR (migración 20261121, la que sigue
// aplicada en producción): perfiles sin es_prueba, sin las columnas de autor nuevas y con los
// agregados del libro y de los archivos contando TAMBIÉN lo de los usuarios de prueba.
const formaAnterior = f => {
  f.perfiles.forEach(p => { delete p.es_prueba; });
  ['planillas_pago', 'ordenes_cambio', 'ensayos', 'solicitudes'].forEach(tabla => f[tabla].forEach(x => { delete x.creado_por; }));
  f.sst_incidentes.forEach(x => { delete x.created_by; });
  const id30 = proyectoDe(f, 'ZZZ-PIL-2026-030').id;
  f.libro_obra.forEach(x => { if(x.proyecto_id === id30 && x.excluidos_prueba > 0){ x.ultimo_registro = '2026-11-20'; x.pendientes_aprobacion = 1; } delete x.excluidos_prueba; });
  f.archivos.forEach(x => { x.cantidad += x.excluidos_prueba; delete x.excluidos_prueba; });
  return f;
};
// Lectura de una consulta de la exportación: sin comentarios, el trozo de una clave y sus columnas
// (lo que va entre el segundo «select» y su «from»; de una expresión cuenta su alias).
const sinComentarios = sql => sql.split(/\r?\n/).filter(x => !x.trim().startsWith('--')).join('\n');
const bloqueSql = (codigoSql, nombre) => { const i = codigoSql.indexOf(`'${nombre}', (`); assert(i >= 0, 'la consulta no trae la clave ' + nombre); return codigoSql.slice(i, codigoSql.indexOf(') t)', i)); };
const columnasDe = (codigoSql, nombre) => bloqueSql(codigoSql, nombre).split('select')[2].split(/\bfrom\b/)[0].split(',').map(x => x.trim()).filter(Boolean)
  .map(x => (/\bas ([a-z_]+)$/.exec(x) || [null, x])[1]).sort();
// Tablas que la consulta devuelve fila a fila y sin expresiones con comas (sus columnas se pueden leer del texto).
const TABLAS_FILA_A_FILA = ['proyectos', 'empresas', 'rubros', 'cronograma_rubros', 'lineas_base', 'planillas_pago', 'planilla_historial', 'garantias', 'ordenes_cambio', 'ensayos', 'sst_incidentes', 'solicitudes', 'proyecto_miembros', 'perfiles', 'actas_recepcion', 'liquidaciones'];
// La consulta ANTERIOR: el cuerpo de exportacion_estado_datos() en la migración 20261121 (la aplicada en producción).
const consultaAnterior = () => {
  const m = /as \$datos\$\r?\n([\s\S]*?)\r?\n\$datos\$;/.exec(fs.readFileSync(path.join(RAIZ, 'supabase', 'migrations', '20261121_exportaciones_estado.sql'), 'utf8'));
  assert(m, 'no se encontró el cuerpo de exportacion_estado_datos() en la migración 20261121');
  return sinComentarios(m[1]);
};
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
    igual(Object.keys(estado), ['formato', 'generado', 'valido_para', 'zona', 'version_app', 'proyectos_total', 'proyectos_incluidos', 'proyectos_excluidos', 'usuarios_de_prueba', 'excluidos_de_prueba', 'bloques_fallidos', 'resumen', 'proyectos'], 'claves de primer nivel');
    igual([estado.formato, estado.generado, estado.valido_para, estado.zona, estado.version_app], [3, '2026-11-21T03:14:07-05:00', '2026-11-21', 'America/Guayaquil', 'hidivo-vZZ'], 'cabecera (formato 3)');
    igual([estado.proyectos_total, estado.proyectos_incluidos], [32, 26], 'conteos');
    igual(estado.proyectos_excluidos, { sin_codigo: 1, liquidados: 2, cerrados_sin_pendientes: 3 }, 'excluidos por motivo');
    const ex = estado.proyectos_excluidos;
    igual(estado.proyectos_incluidos + ex.sin_codigo + ex.liquidados + ex.cerrados_sin_pendientes, estado.proyectos_total, 'incluidos + excluidos = total');
  });

  await prueba('«hoy» es la fecha de Ecuador, no la de UTC', () => {
    const e = construirEstado(fixture(), { ahora: '2026-11-22T03:30:00Z' });   // 22:30 del 21 en Ecuador
    igual([e.valido_para, e.generado, e.version_app], ['2026-11-21', '2026-11-21T22:30:00-05:00', null], 'fecha válida');
  });

  await prueba('D9: quedan fuera los liquidados (también el que sigue «en ejecución»), el que no tiene código y los finalizados o cancelados sin pendientes', () => {
    igual(codigos(estado), INCLUIDOS, 'proyectos y orden (en ejecución por color y código; después por estado y código; con la entrada revuelta)');
    ['ZZZ-FIS-2024-006', 'ZZZ-FIS-2024-007', 'ZZZ-GER-2026-011', 'ZZZ-FIS-2025-012', 'ZZZ-FIS-2023-014', 'ZZZ Sin codigo', 'ZZZ Liquidado', 'ZZZ Finalizado sin pendientes',
      'ZZZ En ejecucion pero liquidado', 'ZZZ Cancelado sin pendientes', 'ZZZ Cerrado sin acta ni pendientes'].forEach(t => assert(!texto.includes(t) && !md.includes(t), 'no debe aparecer ' + t));
    igual(P('ZZZ-CON-2026-003').identidad.estado, 'pausado', 'el pausado va siempre');
    igual(estado.proyectos.map(p => p.avance.semaforo), COLORES.concat(Array(13).fill(null)), 'colores: solo los 13 en ejecución');
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
      igual([e.proyectos_incluidos, e.proyectos_excluidos.cerrados_sin_pendientes], [25, 4], `conteos sin ${codigo}`);
      assert(!estado.resumen.esperan_decision.some(d => d.proyecto === codigo), `${codigo} no tiene nada en «Esperan decisión»`);
    });
    // Una planilla solo enviada también es un pendiente.
    assert(codigos(con(f => { f.planillas_pago.find(pl => pl.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2024-009').id).estado = 'enviada'; })).includes('ZZZ-FIS-2024-009'), 'planilla enviada');
    // Una observación abierta, igual que una en proceso.
    assert(codigos(con(f => { f.observaciones.find(o => o.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2024-010').id).estado = 'abierta'; })).includes('ZZZ-FIS-2024-010'), 'observación abierta');
    // Un finalizado sin pendientes entra en cuanto tiene una orden de cambio solicitada.
    const e = con(f => { f.ordenes_cambio.find(o => o.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2024-007').id).estado = 'solicitada'; });
    assert(codigos(e).includes('ZZZ-FIS-2024-007'), 'orden de cambio solicitada');
    igual([e.proyectos_incluidos, e.proyectos_excluidos.cerrados_sin_pendientes], [27, 2], 'conteos con el 007');
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
    igual(estado.bloques_fallidos, [{ bloque: 'planillas', proyecto: 'ZZZ-PIL-2026-002', indice: 3, motivo: 'fecha inválida en planillas_pago.created_at' }], 'bloques fallidos');
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
    igual(calidad.length, 26, 'un fallo de calidad por proyecto');
    igual(calidad.map(x => x.indice).sort((a, b) => a - b), INCLUIDOS.map((_, i) => i), 'cada fallo con el índice de su proyecto');
    calidad.forEach(x => igual(x.proyecto, INCLUIDOS[x.indice], 'código e índice coinciden'));
    igual(calidad[0].motivo, 'falta la tabla «ensayos» en los datos', 'motivo');
    assert(e.proyectos.every(p => p.calidad_seguridad === null && p.avance !== null), 'calidad null, avance calculado');
    assert(estadoAMarkdown(e).includes('**Calidad y seguridad.** no se pudo calcular: falta la tabla «ensayos» en los datos'), '.md');
    igual(estadoDelResumen(e), 'ok', 'el resumen no depende de esa tabla');
  });

  await prueba('identidad: código, nombre y estado salen SIEMPRE; con dos identidades fallidas a la vez cada sección conserva su proyecto', () => {
    const e = con(f => { proyectoDe(f, 'ZZZ-FIS-2026-001').fecha_inicio = 'abc'; proyectoDe(f, 'ZZZ-PIL-2026-002').fecha_inicio = 'abc'; });
    igual(codigos(e), INCLUIDOS, 'los códigos y el orden no cambian');
    igual(e.bloques_fallidos.filter(x => x.bloque === 'identidad'), [
      { bloque: 'identidad', proyecto: 'ZZZ-FIS-2026-001', indice: 6, motivo: 'fecha inválida en proyectos.fecha_inicio' },
      { bloque: 'identidad', proyecto: 'ZZZ-PIL-2026-002', indice: 3, motivo: 'fecha inválida en proyectos.fecha_inicio' }], 'cada fallo dice de qué proyecto es');
    const id1 = e.proyectos[6].identidad, id2 = e.proyectos[3].identidad;
    igual([id1.codigo, id1.nombre, id1.estado, id1.descripcion, id1.tipo, id1.monto_contractual], ['ZZZ-FIS-2026-001', 'ZZZ Edificio de ejemplo', 'ejecucion', null, null, null], 'identidad del 001: código, nombre y estado; lo demás null');
    igual([id2.codigo, id2.nombre, id2.estado, id2.gestora, id2.emisor, id2.monto_vigente], ['ZZZ-PIL-2026-002', 'ZZZ Pilotes de ejemplo', 'ejecucion', 'ZZG', 'ZZE', 50000], 'identidad del 002: las empresas y el monto vigente se calculan aparte');
    igual(Object.keys(id1), Object.keys(P('ZZZ-FIS-2026-001').identidad), 'la identidad conserva todas sus claves');
    // El semáforo no depende del resto de la identidad: los dos conservan su color y su lugar.
    igual([e.proyectos[3].avance.semaforo, e.proyectos[6].avance.semaforo], ['rojo', 'amarillo'], 'colores');
    // La fecha de inicio mal formada tampoco tumba el avance: se calcula sin esa cota del atraso (el fallo ya está anotado en la identidad).
    igual([e.proyectos[3].avance, e.proyectos[6].avance], [P('ZZZ-PIL-2026-002').avance, P('ZZZ-FIS-2026-001').avance], 'avance completo con la fecha de inicio mal formada');
    igual(e.bloques_fallidos.filter(x => x.bloque === 'avance'), [], 'el avance no queda como bloque fallido');
    const m = estadoAMarkdown(e);
    const titulos = m.split('\n').filter(x => x.startsWith('## ') && x !== '## Resumen');
    igual([titulos[3], titulos[6]], ['## [ROJO] ZZZ-PIL-2026-002 — ZZZ Pilotes de ejemplo', '## [AMARILLO] ZZZ-FIS-2026-001 — ZZZ Edificio de ejemplo'], 'títulos');
    const s2 = seccionDe(m, 'ZZZ-PIL-2026-002'), s1 = seccionDe(m, 'ZZZ-FIS-2026-001');
    [s1, s2].forEach(s => assert(s.includes('**Identidad.** no se pudo calcular: fecha inválida en proyectos.fecha_inicio'), 'la sección dice el motivo'));
    assert(s2.includes('Semáforo rojo: SPI 0,22') && s2.includes('ZZZ Pilotes hincados') && !s2.includes('ZZZ Mampostería'), 'la sección del 002 trae los datos del 002');
    assert(s1.includes('Semáforo amarillo: SPI 0,92') && s1.includes('ZZZ Mampostería') && !s1.includes('ZZZ Pilotes hincados'), 'la sección del 001 trae los datos del 001');
    assert(!m.includes('identidad no disponible') && !m.split('\n').some(x => x.startsWith('## ') && !x.includes('ZZZ-GER-2026-026') && /sin código|sin nombre|sin estado/.test(x)), 'ningún proyecto queda anónimo ni pierde su estado (el 026 no lo tiene en el fixture)');
    igual(e.resumen.esperan_decision, estado.resumen.esperan_decision, '«Esperan decisión» no se altera');
    igual(e.resumen.semaforo, SEMAFORO, 'ni el recuento del semáforo');
  });

  await prueba('identidad: dos proyectos con el MISMO código se distinguen por el índice', () => {
    const e = con(f => { const a = proyectoDe(f, 'ZZZ-FIS-2024-008'), b = proyectoDe(f, 'ZZZ-FIS-2024-009'); b.codigo = a.codigo; a.monto_contrato = 'x'; b.monto_contrato = 'x'; });
    const fallos = e.bloques_fallidos.filter(x => x.bloque === 'identidad');
    igual(fallos.map(x => [x.proyecto, e.proyectos[x.indice].identidad.nombre, x.motivo]).sort(), [['ZZZ-FIS-2024-008', 'ZZZ Solo garantia vigente', 'número inválido en proyectos.monto_contrato'],
      ['ZZZ-FIS-2024-008', 'ZZZ Solo planilla aprobada', 'número inválido en proyectos.monto_contrato']], 'un índice distinto para cada uno');
    const titulos = estadoAMarkdown(e).split('\n').filter(x => x.includes('— ZZZ Solo '));
    igual(titulos, ['## [SIN SEMÁFORO] ZZZ-FIS-2024-008 — ZZZ Solo garantia vigente (finalizado)', '## [SIN SEMÁFORO] ZZZ-FIS-2024-008 — ZZZ Solo planilla aprobada (finalizado)', '## [SIN SEMÁFORO] ZZZ-FIS-2024-010 — ZZZ Solo observacion en proceso (finalizado)'], 'cada sección con su nombre y su estado');
  });

  await prueba('identidad: un rubro corrupto deja sin monto vigente (anotado) pero con código, nombre y el resto; en ejecución y sin avance va tras los verdes', () => {
    const e = con(f => { f.rubros.find(r => r.codigo === 'P-01').monto_contrato = 'xx'; });
    const id = PD(e, 'ZZZ-PIL-2026-002').identidad;
    igual([id.nombre, id.tipo, id.estado, id.monto_contractual, id.monto_vigente], ['ZZZ Pilotes de ejemplo', 'pilotes', 'ejecucion', 50000, null], 'identidad');
    const i = indice(e, 'ZZZ-PIL-2026-002');
    igual(e.bloques_fallidos.filter(x => x.indice === i).map(x => x.bloque).sort(), ['avance', 'identidad.monto_vigente', 'planillas', 'proximos_14_dias'], 'bloques anotados');
    igual(e.resumen.semaforo, { ...SEMAFORO, rojo: 4, sin_datos: 1 }, 'en ejecución y sin avance cuenta como «sin datos», no como sin semáforo');
    igual(i, 12, 'el que está en ejecución y quedó sin color va al final de los de ejecución, antes de los demás estados');
    igual(codigos(e).slice(13), SIN_SEMAFORO, 'los que no están en ejecución no se mueven');
    // Pilotes: el 002 (sin monto) y el 030 (sin rubros: monto vigente 0).
    igual(e.resumen.por_tipo.find(x => x.tipo === 'pilotes'), { tipo: 'pilotes', proyectos: 2, monto_vigente: 0, proyectos_sin_monto: 1 }, 'el resumen dice que falta un monto');
    igual(e.resumen.por_gestora[0], { sigla: 'ZZG', nombre: 'ZZZ GESTORA', proyectos: 25, monto_vigente: 1244600, proyectos_sin_monto: 1 }, 'por gestora');
    const m = estadoAMarkdown(e), s = seccionDe(m, 'ZZZ-PIL-2026-002');
    assert(s.startsWith('## [SIN SEMÁFORO] ZZZ-PIL-2026-002 — ZZZ Pilotes de ejemplo\n') && s.includes('vigente no disponible') && s.includes('**Avance.** no se pudo calcular: número inválido en rubros.monto_contrato'), '.md: ' + s.slice(0, 600));
    assert(m.includes('- Semáforo (solo proyectos en ejecución): 4 rojos · 4 amarillos · 4 verdes · 1 sin datos'), '.md, resumen con «sin datos»');
  });

  await prueba('identidad y montos (D8: descripción completa y ubicación, sin coordenadas)', () => {
    const id = P('ZZZ-FIS-2026-001').identidad;
    igual(Object.keys(id), ['codigo', 'nombre', 'descripcion', 'ubicacion', 'gestora', 'emisor', 'tipo', 'contratante', 'contratista', 'estado', 'estado_cierre',
      'fecha_firma', 'fecha_inicio', 'fecha_fin_contractual', 'fecha_fin_real', 'monto_contractual', 'monto_vigente', 'monto_ordenes_cambio'], 'claves');
    igual([id.gestora, id.emisor, id.tipo, id.estado, id.estado_cierre], ['ZZG', 'ZZG', 'fiscalizacion', 'ejecucion', 'en_ejecucion'], 'identidad');
    igual([id.fecha_firma, id.fecha_inicio, id.fecha_fin_contractual, id.fecha_fin_real], [null, '2026-08-03', '2026-12-15', null], 'fechas (D4: firma null)');
    igual([id.monto_contractual, id.monto_vigente, id.monto_ordenes_cambio], [410000, 428600, 18600], 'montos');
    igual(id.descripcion, 'Construcción de un edificio de dos plantas.\nIncluye obras exteriores | y cerramiento.', 'la descripción va completa, sin recortar');
    igual(id.ubicacion, 'ZZZ Ciudad de Ejemplo', 'ubicación');
    const id2 = P('ZZZ-PIL-2026-002').identidad;
    igual([id2.gestora, id2.emisor, id2.ubicacion], ['ZZG', 'ZZE', 'ZZZ Muelle de Ejemplo'], 'emisor documental distinto de la gestora');
    const id3 = P('ZZZ-CON-2026-003').identidad;
    igual([id3.gestora, id3.monto_contractual, id3.monto_vigente, id3.ubicacion], ['ZZH', null, 0, null], 'proyecto sin rubros ni monto');
    // D8: ni la salida ni la entrada llevan coordenadas.
    assert(!/latitud|longitud|coordenadas/i.test(texto) && !/latitud|longitud|coordenadas/i.test(md), 'la salida no habla de coordenadas');
    assert(!/latitud|longitud/i.test(fs.readFileSync(RUTA_FIXTURE, 'utf8')), 'el fixture tampoco las trae');
    // Unas coordenadas que llegaran por otro camino (una consulta antigua) se ignoran, válidas o no.
    const e = con(f => { const p = proyectoDe(f, 'ZZZ-PIL-2026-002'); p.latitud = 'abc'; p.longitud = -79.88; });
    igual([e.proyectos, e.bloques_fallidos], [estado.proyectos, estado.bloques_fallidos], 'latitud y longitud de más no cambian nada');
  });

  await prueba('formato 3: el bloque de avance trae sus dieciséis claves (con plazo_contractual) y ya no existen ejecutado_pct, valor_ganado_pct ni dias_atraso', () => {
    estado.proyectos.forEach(p => igual(Object.keys(p.avance), CLAVES_AVANCE, 'claves del avance de ' + p.identidad.codigo));
    assert(!/"(ejecutado_pct|valor_ganado_pct|dias_atraso)"/.test(texto), 'claves del formato 1 en el .json');
    estado.proyectos.forEach(p => {
      const a = p.avance, c = p.identidad.codigo;
      assert(Array.isArray(a.motivos) && Array.isArray(a.datos_por_completar), 'listas de ' + c);
      igual([Object.keys(a.plazo_contractual), typeof a.plazo_contractual.vencido, a.plazo_contractual.fecha], [['fecha', 'vencido'], 'boolean', p.identidad.fecha_fin_contractual], 'plazo contractual de ' + c);
      igual(a.plazo_contractual.vencido, a.plazo_contractual.fecha !== null && a.plazo_contractual.fecha < '2026-11-21', 'vencido si la fecha ya pasó: ' + c);
      assert(a.semaforo === null || ['rojo', 'amarillo', 'verde'].includes(a.semaforo), 'color de ' + c);
      igual(a.semaforo !== null, p.identidad.estado === 'ejecucion', 'color si y solo si está en ejecución: ' + c);
      // Atrasos: solo con semáforo y con SPI; ahí el atraso a la fecha es un número.
      if(a.semaforo === null || a.spi === null) igual([a.atraso_fecha_dias, a.atraso_proyectado_dias], [null, null], 'sin semáforo o sin SPI no hay atrasos en ' + c);
      else assert(Number.isInteger(a.atraso_fecha_dias) && a.atraso_fecha_dias >= 0, 'atraso a la fecha de ' + c);
      igual(a.programado_pct === null, a.fin_programado === null, 'programado y fin programado van juntos en ' + c);
      igual(a.programado_pct === null, a.valor_ganado_cronograma_pct === null, 'programado y valor ganado en cronograma van juntos en ' + c);
      // El SPI que se lee: null si no hay SPI; si lo hay, dos decimales con coma y nunca por encima del número.
      igual(a.spi === null, a.spi_texto === null, 'spi y spi_texto van juntos en ' + c);
      if(a.spi !== null) assert(/^\d+,\d\d$/.test(a.spi_texto) && Number(a.spi_texto.replace(',', '.')) <= a.spi + 0.00005 && a.spi - Number(a.spi_texto.replace(',', '.')) < 0.0101, `spi_texto de ${c}: ${a.spi_texto} para ${a.spi}`);
      assert(Number.isInteger(a.rubros_sin_cronograma) && a.rubros_sin_cronograma >= 0, 'rubros sin cronograma de ' + c);
      // Con todos los rubros en el cronograma, el avance principal y el valor ganado en cronograma son el mismo número.
      if(a.programado_pct !== null && a.rubros_sin_cronograma === 0) igual(a.valor_ganado_cronograma_pct, a.avance_pct, 'todos los rubros en cronograma: un solo valor ganado en ' + c);
    });
  });

  await prueba('avance principal = valor ganado de TODOS los rubros; el SPI usa el de los rubros con cronograma; el ejecutado por cantidades va aparte', () => {
    // 001: monto vigente 428.600. Ganado: 100.000 (terminado) + 150.000 + 0, con cronograma (250.000 = 58,33 %),
    // más 14.300 del rubro OC-01, que no tiene cronograma: 264.300 = 61,67 %. Plan a hoy 270.000 = 63,00 %.
    // Rubros fuera del cronograma vigente: dos (OC-01 y el 4.06, que solo está en la línea base antigua).
    const a = P('ZZZ-FIS-2026-001').avance;
    igual([a.avance_pct, a.valor_ganado_cronograma_pct, a.ejecutado_cantidades_pct, a.programado_pct, a.rubros_sin_cronograma, a.cronograma_vencido, a.fin_programado, a.linea_base, a.semaforo],
      [61.67, 58.33, 61.67, 63, 2, false, '2026-12-20', 'LB-2', 'amarillo'], 'avance (el principal cuenta todos los rubros; el del cronograma, solo los programados)');
    igual([a.spi, a.spi_texto], [0.9259, '0,92'], 'SPI 250/270: el número a 4 decimales y el texto truncado a 2');
    assert(Math.abs(a.valor_ganado_cronograma_pct / a.programado_pct - a.spi) < 0.0005, 'el SPI es el valor ganado en cronograma entre lo programado');
    assert(Math.abs(a.avance_pct / a.programado_pct - a.spi) > 0.05, 'y NO el avance principal entre lo programado (hay un rubro sin cronograma)');
    igual(a.motivos, ['SPI 0,92', '1 garantía por vencer en 5 días o menos', '7 pendientes (libro, observaciones y solicitudes)'], 'motivos (SPI truncado; garantías con el aviso de 5 días del núcleo)');
    igual(a.datos_por_completar, [], 'avance principal y cantidades coinciden: sin «datos por completar»');
    const r = P('ZZZ-PIL-2026-002').avance;
    igual([r.semaforo, r.avance_pct, r.valor_ganado_cronograma_pct, r.ejecutado_cantidades_pct, r.programado_pct, r.rubros_sin_cronograma, r.cronograma_vencido, r.fin_programado], ['rojo', 20, 20, 20, 90, 0, false, '2026-11-30'], 'rojo');
    igual([r.spi, r.spi_texto], [Math.round((0.2 / 0.9) * 1e4) / 1e4, '0,22'], 'SPI del rojo');
    igual(r.motivos, ['SPI 0,22', '1 garantía vencida', 'atraso a la fecha de 63 días'], 'motivos del rojo (el atraso del semáforo es el atraso a la fecha)');
    // SPI 0,84996 (38.248,2 de 45.000 programados): redondeado a 4 decimales es 0,85, pero está en
    // rojo (< 0,85). El texto va truncado, como el motivo: nunca se lee «0,85» en un rojo.
    const e85 = con(f => { f.rubros.find(x => x.codigo === 'P-01').total_produccion = 38248.2; });
    const a85 = PD(e85, 'ZZZ-PIL-2026-002').avance;
    igual([a85.spi, a85.spi_texto, a85.semaforo, a85.motivos], [0.85, '0,84', 'rojo', ['SPI 0,84', '1 garantía vencida']], 'SPI justo bajo el umbral');
    const s85 = seccionDe(estadoAMarkdown(e85), 'ZZZ-PIL-2026-002');
    assert(s85.includes(' · SPI 0,84 · ') && s85.includes('Semáforo rojo: SPI 0,84; 1 garantía vencida') && !s85.includes('0,85'), '.md con el SPI truncado: ' + s85.split('\n').filter(x => /SPI/.test(x)).join(' / '));
    // La garantía que vence en 15 días espera decisión, pero NO pone amarillo el semáforo (aviso de 5 días).
    const e = con(f => { proyectoDe(f, 'ZZZ-FIS-2025-004').estado = 'ejecucion'; });
    igual([PD(e, 'ZZZ-FIS-2025-004').avance.semaforo, PD(e, 'ZZZ-FIS-2025-004').avance.motivos], ['amarillo', ['sin cronograma']], 'en ejecución: los 15 días de «Esperan decisión» no llegan al semáforo (el amarillo es solo por no tener cronograma)');
    igual(decision('garantia_por_vencer', 'ZZZ-FIS-2025-004').length, 1, 'y sí espera decisión');
  });

  await prueba('rubro sin cronograma con lo programado terminado: avance principal mayor que el del cronograma, SPI 1,00 y verde aunque el cronograma esté vencido', () => {
    // 028: rubro A (60.000, terminado) con cronograma vencido el 31-oct; rubro B (40.000, 10.000 producidos) sin cronograma.
    // Avance principal (60.000 + 10.000) / 100.000 = 70 %. En cronograma: 60 % ganado de 60 % programado.
    igual(P('ZZZ-CON-2026-028').avance, { avance_pct: 70, valor_ganado_cronograma_pct: 60, ejecutado_cantidades_pct: 70, programado_pct: 60, spi: 1, spi_texto: '1,00', atraso_fecha_dias: 0, atraso_proyectado_dias: 0,
      cronograma_vencido: true, fin_programado: '2026-10-31', plazo_contractual: plazo('2026-12-31'), linea_base: 'LB-1', rubros_sin_cronograma: 1, semaforo: 'verde', motivos: [], datos_por_completar: [] }, 'lo programado está terminado: el vencimiento no da rojo');
    assert(seccionDe(md, 'ZZZ-CON-2026-028').includes('**Avance.** Avance (valor ganado) 70,0 % · programado 60,0 % (LB-1) · valor ganado en cronograma 60,0 % (1 rubro sin cronograma) · SPI 1,00 · sin atraso · cronograma vencido el 2026-10-31\nEjecutado por cantidades: 70,0 %\nSemáforo verde\n'), '.md del 028: ' + seccionDe(md, 'ZZZ-CON-2026-028').split('\n').filter(x => /Avance|Semáforo/.test(x)).join(' / '));
    // Si el rubro programado queda a la mitad (30.000 de 60.000), el vencimiento sí es rojo: 50 % de lo
    // programado. Avance principal (30.000 + 10.000) / 100.000 = 40 %. El plan (91 días) preveía ese 30 % el
    // día 45 (15-sep): 67 días de atraso. Proyectado: 91 × (1/0,5 − 1) = 91.
    const e = con(f => { const r = f.rubros.find(x => x.proyecto_id === proyectoDe(f, 'ZZZ-CON-2026-028').id && x.codigo === '1'); r.estado = 'trabajando'; r.total_produccion = 30000; });
    const a = PD(e, 'ZZZ-CON-2026-028').avance;
    igual([a.avance_pct, a.valor_ganado_cronograma_pct, a.programado_pct, a.spi, a.spi_texto, a.atraso_fecha_dias, a.atraso_proyectado_dias, a.semaforo], [40, 30, 60, 0.5, '0,50', 67, 91, 'rojo'], 'programado a medias');
    igual(a.motivos, ['SPI 0,50', 'cronograma vencido el 2026-10-31 con 50,0 % de lo programado', 'atraso a la fecha de 67 días'], 'motivos: el porcentaje es de lo programado, no del proyecto');
  });

  await prueba('dos atrasos: «a la fecha» cuenta desde el ÚLTIMO día en que el plan no superaba lo ganado y nunca supera los días desde el inicio; «proyectado» es la proyección al final', () => {
    // 002: cronograma del 1-sep al 30-nov (90 días); hoy es el día 81 y hay 20 % ganado. El plan
    // preveía ese 20 % el día 18 (19-sep): 63 días de atraso a la fecha. Proyectado: 90 × (1/0,2222 − 1) = 315.
    const r = P('ZZZ-PIL-2026-002').avance;
    igual([r.atraso_fecha_dias, r.atraso_proyectado_dias], [63, 315], 'atrasos del 002');
    assert(r.atraso_fecha_dias <= 81 && r.atraso_proyectado_dias > 81, 'a la fecha no supera los 81 días transcurridos; el proyectado sí puede');
    // 001: el plan preveía el valor ganado en cronograma de hoy el 15-nov (6 días); proyectado 139 × (1/0,9259 − 1) = 11.
    igual([P('ZZZ-FIS-2026-001').avance.atraso_fecha_dias, P('ZZZ-FIS-2026-001').avance.atraso_proyectado_dias], [6, 11], 'atrasos del 001');
    // En todos los proyectos con atraso: atraso a la fecha ≤ días desde el primer inicio programado.
    const f = fixture();
    estado.proyectos.forEach(p => {
      if(p.avance.atraso_fecha_dias === null) return;
      const propios = new Set(f.rubros.filter(x => x.proyecto_id === proyectoDe(f, p.identidad.codigo).id).map(x => x.id));
      const inicios = f.cronograma_rubros.filter(c => propios.has(c.rubro_id)).map(c => c.fecha_inicio).sort();
      const transcurridos = Math.round((Date.parse('2026-11-21') - Date.parse(inicios[0])) / 86400000);
      assert(p.avance.atraso_fecha_dias <= transcurridos, `${p.identidad.codigo}: atraso a la fecha ${p.avance.atraso_fecha_dias} > ${transcurridos} días transcurridos`);
    });
    // La fecha de inicio del proyecto (proyectos.fecha_inicio) acota el atraso si es posterior al primer
    // inicio programado: el 002 arrancado el 1-nov no puede llevar más de 20 días de atraso (y con 20 ya
    // no pasa de los 30 del rojo). Una fecha anterior al cronograma no cambia nada.
    const tarde = PD(con(f2 => { proyectoDe(f2, 'ZZZ-PIL-2026-002').fecha_inicio = '2026-11-01'; }), 'ZZZ-PIL-2026-002').avance;
    igual([tarde.atraso_fecha_dias, tarde.atraso_proyectado_dias, tarde.semaforo, tarde.motivos], [20, 315, 'rojo', ['SPI 0,22', '1 garantía vencida']], 'acotado por la fecha de inicio del proyecto');
    igual(PD(con(f2 => { proyectoDe(f2, 'ZZZ-PIL-2026-002').fecha_inicio = '2026-01-15'; }), 'ZZZ-PIL-2026-002').avance, r, 'inicio del proyecto anterior al cronograma: igual');
    igual(PD(con(f2 => { proyectoDe(f2, 'ZZZ-PIL-2026-002').fecha_inicio = null; }), 'ZZZ-PIL-2026-002').avance, r, 'sin fecha de inicio: igual');
    // SPI 0 (023: nada ejecutado, plan al 56 %): el atraso a la fecha son los 51 días que lleva el
    // cronograma (su tope) y el proyectado NO es estimable: null, nunca 0.
    const z = P('ZZZ-MUR-2026-023').avance;
    igual([z.spi, z.spi_texto, z.avance_pct, z.programado_pct, z.atraso_fecha_dias, z.atraso_proyectado_dias, z.semaforo], [0, '0,00', 0, 56.04, 51, null, 'rojo'], 'SPI 0');
    igual(z.motivos, ['SPI 0,00', 'atraso a la fecha de 51 días'], 'motivos con SPI 0');
    const s = seccionDe(md, 'ZZZ-MUR-2026-023');
    assert(s.includes('**Avance.** Avance (valor ganado) 0,0 % · programado 56,0 % (LB-1) · SPI 0,00 · atraso a la fecha 51 días\n'), '.md con SPI 0: ' + s.split('\n').find(x => x.startsWith('**Avance')));
    // Decisión 8: el atraso proyectado ya no se escribe en el .md (ni «no estimable»); sigue en el .json.
    assert(!/atraso proyectado|no estimable|proyectad[oa]s? \d/.test(md), 'el .md no habla del atraso proyectado');
    assert(estado.proyectos.some(p => p.avance.atraso_proyectado_dias > 0) && /"atraso_proyectado_dias":315/.test(texto), 'el .json sí lo conserva');
    // Lo mismo al dejar el 002 sin producción: a la fecha, los 81 días transcurridos; proyectado, null.
    const e = con(f2 => { f2.rubros.find(x => x.codigo === 'P-01').total_produccion = 0; });
    const av = PD(e, 'ZZZ-PIL-2026-002').avance;
    igual([av.spi, av.avance_pct, av.atraso_fecha_dias, av.atraso_proyectado_dias, av.semaforo], [0, 0, 81, null, 'rojo'], '002 con SPI 0');
    // Con un SPI menor que 0,10 (4.000 de 45.000 programados = 0,0889) tampoco hay proyección. El plan
    // preveía ese 8 % el día 7 (8-sep): 74 días de atraso a la fecha.
    const e10 = con(f2 => { f2.rubros.find(x => x.codigo === 'P-01').total_produccion = 4000; });
    const a10 = PD(e10, 'ZZZ-PIL-2026-002').avance;
    igual([a10.spi, a10.spi_texto, a10.atraso_fecha_dias, a10.atraso_proyectado_dias, a10.semaforo], [0.0889, '0,08', 74, null, 'rojo'], 'SPI menor que 0,10: proyectado no estimable');
    assert(seccionDe(estadoAMarkdown(e10), 'ZZZ-PIL-2026-002').includes(' · SPI 0,08 · atraso a la fecha 74 días\n'), '.md con SPI 0,08');
    assert(![md, estadoAMarkdown(e), estadoAMarkdown(e10)].some(m => /atraso (a la fecha|proyectado) 0 d[ií]as/.test(m)), 'nunca «atraso 0 días»');
    // Con el plan a la fecha todavía mínimo no hay SPI y no se habla de atraso.
    const e2 = con(f2 => { const id = proyectoDe(f2, 'ZZZ-MUR-2026-023').id; f2.cronograma_rubros.filter(c => c.proyecto_id === id).forEach(c => { c.fecha_inicio = '2026-11-21'; }); });
    const a2 = PD(e2, 'ZZZ-MUR-2026-023').avance;
    igual([a2.spi, a2.spi_texto, a2.programado_pct, a2.atraso_fecha_dias, a2.atraso_proyectado_dias, a2.semaforo, a2.motivos], [null, null, 0, null, null, 'verde', []], 'arranque de obra: sin SPI ni atrasos');
    assert(seccionDe(estadoAMarkdown(e2), 'ZZZ-MUR-2026-023').includes('**Avance.** Avance (valor ganado) 0,0 % · programado 0,0 % (LB-1) · SPI no disponible\n'), '.md del arranque');
  });

  await prueba('meseta en el plan: el tramo plano no cuenta como atraso (se cuenta desde el último día en que el plan no superaba lo ganado)', () => {
    // 027: rubro A (50 %) del 1 al 31-ago, terminado; rubro B (50 %) del 1-nov al 1-dic (30 días), sin empezar.
    // El plan vale 50 % desde el 31-ago hasta el 1-nov. Hoy (día 20 de B): 50 + 50 × 20/30 = 83,33 %. SPI 50/83,33 = 0,60.
    // Atraso a la fecha: del 1-nov (último día con el plan en 50 %) a hoy = 20 días; no los 82 desde el 31-ago.
    // Proyectado: 122 días de cronograma × (1/0,6 − 1) = 81.
    igual(P('ZZZ-CON-2026-027').avance, { avance_pct: 50, valor_ganado_cronograma_pct: 50, ejecutado_cantidades_pct: 50, programado_pct: 83.33, spi: 0.6, spi_texto: '0,60', atraso_fecha_dias: 20, atraso_proyectado_dias: 81,
      cronograma_vencido: false, fin_programado: '2026-12-01', plazo_contractual: plazo('2026-12-01'), linea_base: 'LB-1', rubros_sin_cronograma: 0, semaforo: 'rojo', motivos: ['SPI 0,60'], datos_por_completar: [] }, 'meseta: 20 días, y el atraso no es motivo de rojo');
    assert(seccionDe(md, 'ZZZ-CON-2026-027').includes('**Avance.** Avance (valor ganado) 50,0 % · programado 83,3 % (LB-1) · SPI 0,60 · atraso a la fecha 20 días\nEjecutado por cantidades: 50,0 %\nSemáforo rojo: SPI 0,60\n'), '.md del 027');
    // Durante la meseta (rubro B del 1 al 31-dic: el plan a hoy sigue en 50 %) no hay atraso: SPI 1,00 y verde.
    const e = con(f => { const id = proyectoDe(f, 'ZZZ-CON-2026-027').id; const b = f.rubros.find(x => x.proyecto_id === id && x.codigo === '2'); const c = f.cronograma_rubros.find(x => x.rubro_id === b.id); c.fecha_inicio = '2026-12-01'; c.fecha_fin = '2026-12-31'; });
    const a = PD(e, 'ZZZ-CON-2026-027').avance;
    igual([a.programado_pct, a.spi, a.atraso_fecha_dias, a.atraso_proyectado_dias, a.semaforo, a.motivos], [50, 1, 0, 0, 'verde', []], 'en plena meseta: sin atraso');
    assert(seccionDe(estadoAMarkdown(e), 'ZZZ-CON-2026-027').includes(' · SPI 1,00 · sin atraso\n'), '.md en plena meseta');
  });

  await prueba('semáforo SOLO en ejecución: un proyecto de cada estado; los demás salen sin color, con su estado y sus pendientes, y sin atrasos', () => {
    const porEstado = {};
    estado.proyectos.forEach(p => { const k = p.identidad.estado === null ? '(sin estado)' : p.identidad.estado; (porEstado[k] = porEstado[k] || []).push(p.identidad.codigo); });
    igual(Object.keys(porEstado), ['ejecucion', 'pausado', 'planificacion', 'finalizado', 'cancelado', '(sin estado)'], 'los cinco estados y el que no tiene, en el orden de salida');
    igual(porEstado.ejecucion, EN_EJECUCION, 'en ejecución');
    estado.proyectos.forEach(p => {
      const a = p.avance, c = p.identidad.codigo;
      if(p.identidad.estado === 'ejecucion') assert(['rojo', 'amarillo', 'verde'].includes(a.semaforo), c + ' en ejecución debe llevar color');
      else igual([a.semaforo, a.motivos, a.atraso_fecha_dias, a.atraso_proyectado_dias], [null, [], null, null], c + ' no está en ejecución: sin color, sin motivos y sin atrasos');
    });
    igual(P('ZZZ-CON-2026-003').avance, sinCronograma(0, 0), 'pausado');
    igual(P('ZZZ-GER-2026-017').avance, sinCronograma(0, 0), 'en planificación');
    igual(P('ZZZ-DIS-2026-013').avance, sinCronograma(0, 0), 'cancelado');
    igual(P('ZZZ-FIS-2024-008').avance, sinCronograma(100, 100, { rubros_sin_cronograma: 1 }), 'finalizado');
    // Sin color, pero con sus pendientes: el pausado conserva su garantía y su observación; el cancelado, sus decisiones.
    igual([P('ZZZ-CON-2026-003').garantias.length, P('ZZZ-CON-2026-003').observaciones.abiertas, P('ZZZ-CON-2026-003').observaciones.en_proceso], [1, 1, 1], 'pendientes del pausado');
    igual(estado.resumen.esperan_decision.filter(d => d.proyecto === 'ZZZ-DIS-2026-013').length, 2, 'decisiones del cancelado');
    // Ningún proyecto sin semáforo habla de atraso ni de cronograma vencido en el .md.
    SIN_SEMAFORO.forEach(c => assert(!/atraso|cronograma vencido/.test(seccionDe(md, c)), 'el .md de ' + c + ' no habla de atraso ni de cronograma vencido'));

    // 025: pausado con el cronograma atrasado y vencido (1-ago a 30-oct, 30 % ganado, SPI 0,30). Conserva
    // sus cifras de avance, el SPI y el dato «cronograma_vencido», pero no lleva atrasos.
    igual(P('ZZZ-CON-2026-025').avance, { avance_pct: 30, valor_ganado_cronograma_pct: 30, ejecutado_cantidades_pct: 30, programado_pct: 100, spi: 0.3, spi_texto: '0,30', atraso_fecha_dias: null, atraso_proyectado_dias: null,
      cronograma_vencido: true, fin_programado: '2026-10-30', plazo_contractual: plazo('2026-10-30', true), linea_base: 'LB-1', rubros_sin_cronograma: 0, semaforo: null, motivos: [], datos_por_completar: [] }, 'pausado con cronograma atrasado (el plazo vencido es un dato: fuera de ejecución no da color)');
    const s25 = seccionDe(md, 'ZZZ-CON-2026-025');
    assert(s25.startsWith('## [SIN SEMÁFORO] ZZZ-CON-2026-025 — ZZZ Pausado con cronograma atrasado (pausado)\n') && s25.includes('**Avance.** Avance (valor ganado) 30,0 % · programado 100,0 % (LB-1) · SPI 0,30\nEjecutado por cantidades: 30,0 %\nSin semáforo: proyecto pausado\n'), '.md del 025: ' + s25.split('\n').filter(x => /Avance|emáforo/.test(x)).join(' / '));
    // El mismo proyecto, en ejecución, sí los lleva: el plan (90 días) preveía el 30 % el día 27 (28-ago), 85 días
    // de atraso; proyectado 90 × (1/0,3 − 1) = 210.
    const e25 = con(f => { proyectoDe(f, 'ZZZ-CON-2026-025').estado = 'ejecucion'; });
    const a25 = PD(e25, 'ZZZ-CON-2026-025').avance;
    igual([a25.atraso_fecha_dias, a25.atraso_proyectado_dias, a25.semaforo, a25.motivos], [85, 210, 'rojo', ['SPI 0,30', 'plazo contractual vencido el 2026-10-30 con 30,0 % de avance', 'cronograma vencido el 2026-10-30 con 30,0 % de lo programado', 'atraso a la fecha de 85 días']], 'el 025 en ejecución');
    assert(seccionDe(estadoAMarkdown(e25), 'ZZZ-CON-2026-025').includes(' · SPI 0,30 · atraso a la fecha 85 días · cronograma vencido el 2026-10-30\n'), '.md del 025 en ejecución');

    // El mismo proyecto cambia de grupo con su estado: el rojo 002, pausado, pierde el color y los atrasos y pasa al grupo de pausados.
    const e = con(f => { proyectoDe(f, 'ZZZ-PIL-2026-002').estado = 'pausado'; });
    const a = PD(e, 'ZZZ-PIL-2026-002').avance;
    igual([a.semaforo, a.motivos, a.spi, a.spi_texto, a.atraso_fecha_dias, a.atraso_proyectado_dias, a.avance_pct, a.cronograma_vencido], [null, [], 0.2222, '0,22', null, null, 20, false], 'pausado: sin color ni atrasos, con sus cifras');
    igual(codigos(e).slice(12, 16), ['ZZZ-CON-2026-003', 'ZZZ-CON-2026-025', 'ZZZ-PIL-2026-002', 'ZZZ-GER-2026-017'], 'pausados por código, antes del de planificación');
    igual(e.resumen.semaforo, { ...SEMAFORO, rojo: 4, sin_semaforo: { ...SEMAFORO.sin_semaforo, pausado: 3 } }, 'recuento');
    assert(e.resumen.esperan_decision.some(d => d.proyecto === 'ZZZ-PIL-2026-002' && d.clase === 'garantia_vencida'), 'su garantía vencida sigue esperando decisión');
    const s = seccionDe(estadoAMarkdown(e), 'ZZZ-PIL-2026-002');
    assert(s.startsWith('## [SIN SEMÁFORO] ZZZ-PIL-2026-002 — ZZZ Pilotes de ejemplo (pausado)\n') && s.includes('\nSin semáforo: proyecto pausado\n') && !s.includes('Semáforo rojo'), '.md del pausado');
    assert(s.includes('**Avance.** Avance (valor ganado) 20,0 % · programado 90,0 % (LB-1) · SPI 0,22\n') && !/atraso|cronograma vencido/.test(s), '.md del pausado: sin atrasos');
  });

  await prueba('proyecto sin estado: sin color, al final, con su bloque de avance y el aviso del núcleo en «datos por completar»', () => {
    // 026: estado null. Cronograma del 1-oct al 31-dic (91 días): plan a hoy 51/91 = 56,04 %; 25 % ganado; SPI 0,4461.
    const p = P('ZZZ-GER-2026-026');
    igual([indice(estado, 'ZZZ-GER-2026-026'), estado.proyectos.length - 1, p.identidad.estado], [25, 25, null], 'sale el último y con estado null');
    igual(p.avance, { avance_pct: 25, valor_ganado_cronograma_pct: 25, ejecutado_cantidades_pct: 25, programado_pct: 56.04, spi: 0.4461, spi_texto: '0,44', atraso_fecha_dias: null, atraso_proyectado_dias: null,
      cronograma_vencido: false, fin_programado: '2026-12-31', plazo_contractual: plazo('2026-12-31'), linea_base: 'LB-1', rubros_sin_cronograma: 0, semaforo: null, motivos: [], datos_por_completar: [SIN_ESTADO] }, 'conserva su bloque de avance, sin color ni atrasos');
    assert(!estado.bloques_fallidos.some(x => x.proyecto === 'ZZZ-GER-2026-026'), 'no queda ningún bloque fallido por no tener estado');
    BLOQUES.forEach(b => assert(p[b] !== null, 'el bloque ' + b + ' del proyecto sin estado se calcula'));
    igual(estado.resumen.semaforo.sin_semaforo.sin_estado, 1, 'el resumen lo cuenta aparte');
    assert(estado.resumen.datos_por_completar.some(x => x.proyecto === 'ZZZ-GER-2026-026' && x.avisos.includes(SIN_ESTADO)), 'y está en resumen.datos_por_completar');
    const s = seccionDe(md, 'ZZZ-GER-2026-026');
    assert(s.startsWith('## [SIN SEMÁFORO] ZZZ-GER-2026-026 — ZZZ Proyecto sin estado (sin estado)\n') && s.includes(' · gerencia de proyecto · sin estado\n'), '.md: título e identidad');
    assert(s.includes('**Avance.** Avance (valor ganado) 25,0 % · programado 56,0 % (LB-1) · SPI 0,44\nEjecutado por cantidades: 25,0 %\n⚠ Datos por completar: ' + SIN_ESTADO + '\nSin semáforo: proyecto sin estado\n'), '.md: avance: ' + s.split('\n').filter(x => /Avance|emáforo|Datos/.test(x)).join(' / '));
    // Un proyecto en ejecución que pierde el estado (null o texto vacío): pierde el color y los atrasos y va al final.
    [null, '', '  '].forEach(valor => {
      const e = con(f => { proyectoDe(f, 'ZZZ-FIS-2026-001').estado = valor; });
      const a = PD(e, 'ZZZ-FIS-2026-001').avance;
      igual(codigos(e).slice(-2), ['ZZZ-FIS-2026-001', 'ZZZ-GER-2026-026'], 'sin estado: los dos al final, por código');
      igual([PD(e, 'ZZZ-FIS-2026-001').identidad.estado, a.semaforo, a.motivos, a.avance_pct, a.spi, a.atraso_fecha_dias, a.atraso_proyectado_dias, a.datos_por_completar], [null, null, [], 61.67, 0.9259, null, null, [SIN_ESTADO]], 'sin estado: sin color, con avance y con el aviso');
      igual(e.bloques_fallidos.filter(x => x.bloque === 'avance'), [], 'no es un bloque fallido');
      igual(e.resumen.semaforo, { ...SEMAFORO, amarillo: 3, sin_semaforo: { ...SEMAFORO.sin_semaforo, sin_estado: 2 } }, 'recuento con dos sin estado');
      const m = estadoAMarkdown(e);
      assert(m.includes('## [SIN SEMÁFORO] ZZZ-FIS-2026-001 — ZZZ Edificio de ejemplo (sin estado)') && m.includes('· 1 cancelado · 2 sin estado'), '.md sin estado');
    });
    // Si los datos no traen siquiera la columna «estado», el núcleo se niega a dar semáforo: el avance
    // queda en null y anotado (nunca un «sin color» por un olvido de la consulta).
    const e3 = con(f => { delete proyectoDe(f, 'ZZZ-FIS-2026-001').estado; });
    igual([indice(e3, 'ZZZ-FIS-2026-001'), PD(e3, 'ZZZ-FIS-2026-001').avance], [24, null], 'sin la columna: avance null');
    igual(e3.bloques_fallidos.filter(x => x.bloque === 'avance'), [{ bloque: 'avance', proyecto: 'ZZZ-FIS-2026-001', indice: 24, motivo: 'El semáforo necesita el estado del proyecto' }], 'anotado');
  });

  await prueba('en ejecución, «cronograma vencido» sin haber terminado lo programado es un motivo PROPIO de rojo; con 100 % de valor ganado no', () => {
    // 018: 97 % ganado de un cronograma de 91 días (1-ago a 31-oct). El plan no superaba el 97 % hasta el
    // día 88 (28-oct): 24 días de atraso a la fecha (no pasa de 30). SPI 0,97 (no llega al amarillo).
    // Proyectado: 91 × (1/0,97 − 1) = 3, pero ya lleva 21 días pasado del fin: 21.
    igual(P('ZZZ-CON-2026-018').avance, { avance_pct: 97, valor_ganado_cronograma_pct: 97, ejecutado_cantidades_pct: 97, programado_pct: 100, spi: 0.97, spi_texto: '0,97', atraso_fecha_dias: 24, atraso_proyectado_dias: 21, cronograma_vencido: true,
      fin_programado: '2026-10-31', plazo_contractual: plazo('2026-12-15'), linea_base: 'LB-1', rubros_sin_cronograma: 0, semaforo: 'rojo', motivos: ['cronograma vencido el 2026-10-31 con 97,0 % de lo programado'], datos_por_completar: [] }, 'vencido y sin terminar: rojo por ese único motivo (su plazo contractual no ha vencido)');
    const s18 = seccionDe(md, 'ZZZ-CON-2026-018');
    assert(s18.startsWith('## [ROJO] ZZZ-CON-2026-018 — ZZZ Cronograma vencido sin terminar\n'), 'título');
    assert(s18.includes('**Avance.** Avance (valor ganado) 97,0 % · programado 100,0 % (LB-1) · SPI 0,97 · atraso a la fecha 24 días · cronograma vencido el 2026-10-31\nEjecutado por cantidades: 97,0 %\nSemáforo rojo: cronograma vencido el 2026-10-31 con 97,0 % de lo programado\n'), '.md del 018: ' + s18.split('\n').filter(x => /Avance|Semáforo/.test(x)).join(' / '));
    // 019: vencido, pero con el 100 % de valor ganado: verde.
    igual(P('ZZZ-CON-2026-019').avance, { avance_pct: 100, valor_ganado_cronograma_pct: 100, ejecutado_cantidades_pct: 100, programado_pct: 100, spi: 1, spi_texto: '1,00', atraso_fecha_dias: 0, atraso_proyectado_dias: 0, cronograma_vencido: true,
      fin_programado: '2026-10-31', plazo_contractual: plazo('2026-10-31', true), linea_base: 'LB-1', rubros_sin_cronograma: 0, semaforo: 'verde', motivos: [], datos_por_completar: [] }, 'vencido (cronograma y plazo contractual) y terminado al 100 %: verde');
    assert(seccionDe(md, 'ZZZ-CON-2026-019').includes('**Avance.** Avance (valor ganado) 100,0 % · programado 100,0 % (LB-1) · SPI 1,00 · sin atraso · cronograma vencido el 2026-10-31\nEjecutado por cantidades: 100,0 %\nSemáforo verde\n'), '.md del 019');
    // Fuera de ejecución el cronograma vencido no da color ni se escribe: el 009 (finalizado) y el 018 si se pausa.
    // El dato «cronograma_vencido» sigue en el .json; los atrasos van a null.
    igual(P('ZZZ-FIS-2024-009').avance, { avance_pct: 100, valor_ganado_cronograma_pct: 100, ejecutado_cantidades_pct: 100, programado_pct: 100, spi: 1, spi_texto: '1,00', atraso_fecha_dias: null, atraso_proyectado_dias: null, cronograma_vencido: true,
      fin_programado: '2024-06-30', plazo_contractual: SIN_PLAZO, linea_base: 'LB-1', rubros_sin_cronograma: 0, semaforo: null, motivos: [], datos_por_completar: [] }, 'finalizado con cronograma vencido');
    assert(seccionDe(md, 'ZZZ-FIS-2024-009').includes('**Avance.** Avance (valor ganado) 100,0 % · programado 100,0 % (LB-1) · SPI 1,00\nEjecutado por cantidades: 100,0 %\nSin semáforo: proyecto finalizado\n'), '.md del 009');
    const e = con(f => { proyectoDe(f, 'ZZZ-CON-2026-018').estado = 'pausado'; });
    const a18 = PD(e, 'ZZZ-CON-2026-018').avance;
    igual([a18.semaforo, a18.motivos, a18.cronograma_vencido, a18.atraso_fecha_dias, a18.atraso_proyectado_dias], [null, [], true, null, null], 'pausado con cronograma vencido: sin color ni atrasos');
    assert(seccionDe(estadoAMarkdown(e), 'ZZZ-CON-2026-018').includes('**Avance.** Avance (valor ganado) 97,0 % · programado 100,0 % (LB-1) · SPI 0,97\nEjecutado por cantidades: 97,0 %\nSin semáforo: proyecto pausado\n'), '.md del 018 pausado: sin atrasos ni «cronograma vencido»');
    igual(md.split('\n').filter(x => x.includes('cronograma vencido el ') && x.startsWith('**Avance.**')).length, 3, '«cronograma vencido» en la línea de avance: solo en los tres en ejecución que lo tienen (018, 019 y 028)');
    assert(md.includes('**Avance.** Avance (valor ganado) 20,0 % · programado 90,0 % (LB-1) · SPI 0,22 · atraso a la fecha 63 días\n'), '.md con el atraso a la fecha');
    assert(md.includes('**Avance.** Avance (valor ganado) 0,0 % · sin cronograma\n'), '.md sin cronograma: no se habla de SPI ni de atraso');
  });

  await prueba('garantía vencida: en ejecución cuenta para el rojo; en un finalizado no da color y va como pendiente', () => {
    const p = P('ZZZ-FIS-2024-020');
    igual([p.identidad.estado, p.avance.semaforo, p.avance.motivos], ['finalizado', null, []], 'finalizado con garantía vencida: sin color');
    igual(p.garantias, [{ tipo: 'buena_calidad_materiales', vigencia_hasta: '2026-10-01', dias_para_vencer: -51, estado: 'vigente', vencida: true }], 'sigue en su bloque de garantías');
    igual(decision('garantia_vencida', 'ZZZ-FIS-2024-020'), [{ clase: 'garantia_vencida', proyecto: 'ZZZ-FIS-2024-020', detalle: 'Buena calidad de materiales, venció el 2026-10-01', desde: '2026-10-01', dias: 51, sentido: 'vencida_hace', monto: null }], 'y en «Esperan decisión»');
    const s = seccionDe(md, 'ZZZ-FIS-2024-020');
    assert(s.startsWith('## [SIN SEMÁFORO] ZZZ-FIS-2024-020 — ZZZ Finalizado con garantia vencida (finalizado)\n') && s.includes('\nSin semáforo: proyecto finalizado\n') && s.includes('**Garantías.** Buena calidad de materiales hasta 2026-10-01 (vencida hace 51 días)'), '.md del 020');
    assert(md.includes('| Garantía vencida | ZZZ-FIS-2024-020 | Buena calidad de materiales, venció el 2026-10-01 | 2026-10-01 | vencida hace 51 |'), 'fila de la tabla');
    // Es su único pendiente: al devolverla, el proyecto deja de salir.
    assert(!codigos(con(f => { f.garantias.find(g => g.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2024-020').id).estado = 'devuelta'; })).includes('ZZZ-FIS-2024-020'), 'sin la garantía queda fuera');
    // El mismo proyecto, en ejecución: la garantía vencida lo pone en rojo.
    const e = con(f => { proyectoDe(f, 'ZZZ-FIS-2024-020').estado = 'ejecucion'; });
    igual([PD(e, 'ZZZ-FIS-2024-020').avance.semaforo, PD(e, 'ZZZ-FIS-2024-020').avance.motivos], ['rojo', ['1 garantía vencida', 'sin cronograma']], 'en ejecución: rojo');
    igual(e.resumen.esperan_decision, estado.resumen.esperan_decision, '«Esperan decisión» es la misma en los dos casos');
    // Y el rojo 002 (en ejecución) la lleva entre sus motivos.
    assert(P('ZZZ-PIL-2026-002').avance.motivos.includes('1 garantía vencida'), 'motivo del 002');
  });

  await prueba('«datos por completar»: más de 10 puntos entre el valor ganado y las cantidades, finalizado sin producción y proyecto sin estado (textos del núcleo)', () => {
    // 022: rubro marcado «terminado» (100 % de valor ganado) con el 40 % de producción.
    igual(P('ZZZ-CON-2026-022').avance, sinCronograma(100, 40, { rubros_sin_cronograma: 1, semaforo: 'amarillo', motivos: ['sin cronograma'], datos_por_completar: [DIF_022] }), 'diferencia de 60 puntos (en ejecución y sin cronograma: amarillo, nunca verde)');
    // 021 y 024: finalizados sin producción registrada.
    igual(P('ZZZ-FIS-2024-021').avance, sinCronograma(0, 0, { rubros_sin_cronograma: 1, datos_por_completar: [SIN_PRODUCCION] }), 'finalizado sin producción');
    igual(P('ZZZ-FIS-2024-024').avance, sinCronograma(0, 0, { rubros_sin_cronograma: 1, datos_por_completar: [SIN_PRODUCCION] }), 'finalizado sin producción y sin otros pendientes');
    const ESPERADO = [{ proyecto: 'ZZZ-PUE-2026-029', avisos: [PLANILLA_REPETIDA] }, { proyecto: 'ZZZ-CON-2026-022', avisos: [DIF_022] }, { proyecto: 'ZZZ-PUE-2026-031', avisos: [MONTO_031] },
      { proyecto: 'ZZZ-FIS-2024-021', avisos: [SIN_PRODUCCION] }, { proyecto: 'ZZZ-FIS-2024-024', avisos: [SIN_PRODUCCION] }, { proyecto: 'ZZZ-GER-2026-026', avisos: [SIN_ESTADO] }];
    igual(estado.resumen.datos_por_completar, ESPERADO, 'resumen, en el orden de salida');
    igual(estado.proyectos.filter(p => p.avance.datos_por_completar.length).map(p => p.identidad.codigo), ESPERADO.map(x => x.proyecto), 'solo esos seis');
    const s22 = seccionDe(md, 'ZZZ-CON-2026-022'), s21 = seccionDe(md, 'ZZZ-FIS-2024-021');
    assert(s22.includes('**Avance.** Avance (valor ganado) 100,0 % · sin cronograma\nEjecutado por cantidades: 40,0 %\n⚠ Datos por completar: ' + DIF_022 + '\nSemáforo amarillo: sin cronograma\n'), '.md del 022: ' + s22.split('\n').slice(8, 14).join(' / '));
    assert(s21.includes('Ejecutado por cantidades: 0,0 %\n⚠ Datos por completar: ' + SIN_PRODUCCION + '\nSin semáforo: proyecto finalizado\n'), '.md del 021');
    igual(md.split('\n').filter(x => x.startsWith('⚠ Datos por completar: ')).length, 6, 'la línea de aviso solo en esos seis');
    ['- Datos por completar: 6 proyectos', '  - ZZZ-PUE-2026-029: ' + PLANILLA_REPETIDA, '  - ZZZ-PUE-2026-031: ' + MONTO_031, '  - ZZZ-CON-2026-022: ' + DIF_022, '  - ZZZ-FIS-2024-021: ' + SIN_PRODUCCION, '  - ZZZ-FIS-2024-024: ' + SIN_PRODUCCION, '  - ZZZ-GER-2026-026: ' + SIN_ESTADO].forEach(x => assert(md.split('\n').includes(x), 'falta en el resumen del .md: ' + x));
    // Justo 10 puntos no avisa; algo más, sí. (Rubro terminado de 50.000: 45.000 = 90 %; 44.900 = 89,8 %.)
    const con22 = prod => PD(con(f => { f.rubros.find(r => r.proyecto_id === proyectoDe(f, 'ZZZ-CON-2026-022').id).total_produccion = prod; }), 'ZZZ-CON-2026-022').avance;
    igual([con22(45000).datos_por_completar, con22(44900).datos_por_completar.length], [[], 1], 'umbral de 10 puntos');
    // Un finalizado sin producción y con el rubro «terminado» lleva los dos avisos.
    const e = con(f => { f.rubros.find(r => r.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2024-021').id).estado = 'terminado'; });
    igual(PD(e, 'ZZZ-FIS-2024-021').avance.datos_por_completar, ['el valor ganado (100,0 %) y el ejecutado por cantidades (0,0 %) difieren en más de 10 puntos', SIN_PRODUCCION], 'los dos avisos');
    // Sin avisos, el resumen lo dice. (Al 024, con su producción registrada, no le queda nada pendiente: sale de la exportación.)
    const limpio = con(f => { const rubroDe = c => f.rubros.find(r => r.proyecto_id === proyectoDe(f, c).id);
      rubroDe('ZZZ-CON-2026-022').total_produccion = 50000; rubroDe('ZZZ-FIS-2024-021').total_produccion = 10000; rubroDe('ZZZ-FIS-2024-024').total_produccion = 10000;
      proyectoDe(f, 'ZZZ-GER-2026-026').estado = 'pausado';
      proyectoDe(f, 'ZZZ-PUE-2026-031').monto_contrato = 54000;                                       // 54.000 + 2.000 de la orden de cambio = 56.000
      const id29 = proyectoDe(f, 'ZZZ-PUE-2026-029').id;                                              // se borra el registro repetido de la planilla 2
      f.planillas_pago = f.planillas_pago.filter(pl => !(pl.proyecto_id === id29 && pl.numero === 2 && pl.estado === 'en_revision')); });
    igual(limpio.resumen.datos_por_completar, [], 'sin avisos');
    assert(estadoAMarkdown(limpio).includes('- Datos por completar: ninguno\n') && !estadoAMarkdown(limpio).includes('⚠'), '.md sin avisos');
  });

  await prueba('D9 + datos por completar: un finalizado o cancelado cuyo ÚNICO pendiente es un aviso de «datos por completar» SÍ entra', () => {
    // 024: finalizado, con las dos actas y la liquidación, sin garantías, planillas, observaciones ni órdenes
    // de cambio. Lo único que tiene por resolver es que no registra producción.
    const f0 = fixture(), id24 = proyectoDe(f0, 'ZZZ-FIS-2024-024').id;
    igual([proyectoDe(f0, 'ZZZ-FIS-2024-024').estado, proyectoDe(f0, 'ZZZ-FIS-2024-024').estado_cierre, f0.liquidaciones.filter(x => x.proyecto_id === id24).length,
      ['garantias', 'planillas_pago', 'observaciones', 'ordenes_cambio'].map(t => f0[t].filter(x => x.proyecto_id === id24).length)], ['finalizado', 'recepcion_definitiva', 1, [0, 0, 0, 0]], 'el 024 del fixture no tiene ningún otro pendiente');
    assert(codigos(estado).includes('ZZZ-FIS-2024-024'), 'entra por su aviso');
    const p = P('ZZZ-FIS-2024-024');
    igual([p.avance.datos_por_completar, p.garantias, p.planillas, p.observaciones.abiertas + p.observaciones.en_proceso, p.ordenes_cambio.solicitadas], [[SIN_PRODUCCION], [], { ultima: null, en_revision: [], aprobadas_sin_pagar: [] }, 0, []], 'sus bloques');
    assert(!estado.resumen.esperan_decision.some(d => d.proyecto === 'ZZZ-FIS-2024-024'), 'no tiene nada en «Esperan decisión»');
    assert(estado.resumen.datos_por_completar.some(x => x.proyecto === 'ZZZ-FIS-2024-024'), 'y aparece en resumen.datos_por_completar');
    const s = seccionDe(md, 'ZZZ-FIS-2024-024');
    assert(s.startsWith('## [SIN SEMÁFORO] ZZZ-FIS-2024-024 — ZZZ Finalizado sin produccion ni pendientes (finalizado)\n') && s.includes('**Avance.** Avance (valor ganado) 0,0 % · sin cronograma\nEjecutado por cantidades: 0,0 %\n⚠ Datos por completar: ' + SIN_PRODUCCION + '\nSin semáforo: proyecto finalizado\n'), '.md del 024');
    // Al registrar la producción ya no le queda nada: sale.
    const e = con(f => { f.rubros.find(r => r.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2024-024').id).total_produccion = 10000; });
    assert(!codigos(e).includes('ZZZ-FIS-2024-024'), 'con producción registrada queda fuera');
    igual([e.proyectos_incluidos, e.proyectos_excluidos.cerrados_sin_pendientes], [25, 4], 'conteos sin el 024');
    // Los demás avisos del núcleo también cuentan. Un finalizado sin pendientes al que se le quitan los rubros:
    const e2 = con(f => { const id = proyectoDe(f, 'ZZZ-FIS-2024-007').id; f.rubros = f.rubros.filter(r => r.proyecto_id !== id); });
    igual([codigos(e2).includes('ZZZ-FIS-2024-007'), PD(e2, 'ZZZ-FIS-2024-007').avance.datos_por_completar], [true, ['proyecto finalizado sin rubros']], 'finalizado sin rubros: entra');
    // Un cancelado sin pendientes con un rubro «terminado» sin producción (100 % ganado, 0 % por cantidades):
    const e3 = con(f => { f.rubros.push({ id: 'aaaaaaaa-0000-4000-8000-999999999999', proyecto_id: proyectoDe(f, 'ZZZ-FIS-2025-012').id, codigo: '1', descripcion: 'ZZZ Obra civil', monto_contrato: 5000, total_produccion: 0, estado: 'terminado' }); });
    igual([codigos(e3).includes('ZZZ-FIS-2025-012'), PD(e3, 'ZZZ-FIS-2025-012').avance.datos_por_completar], [true, ['el valor ganado (100,0 %) y el ejecutado por cantidades (0,0 %) difieren en más de 10 puntos']], 'cancelado con diferencia grande: entra');
    // Un cancelado sin producción NO lleva aviso (la regla es de los finalizados): sigue fuera.
    assert(!codigos(estado).includes('ZZZ-FIS-2025-012'), 'cancelado sin rubros ni pendientes: fuera');
    // Si no se puede saber (rubro corrupto en un finalizado sin pendientes), el proyecto entra y queda anotado.
    const e4 = con(f => { f.rubros.find(r => r.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2024-007').id).monto_contrato = 'xx'; });
    assert(codigos(e4).includes('ZZZ-FIS-2024-007') && e4.bloques_fallidos.some(x => x.bloque === 'inclusion' && x.proyecto === 'ZZZ-FIS-2024-007' && x.motivo === 'número inválido en rubros.monto_contrato'), 'duda en la inclusión: entra y se anota');
  });

  await prueba('sin línea base activa y con dos líneas base: cuenta la fila más reciente de cada rubro, llegue en el orden que llegue', () => {
    const quince = f => proyectoDe(f, 'ZZZ-PUE-2026-015').id;
    const f0 = fixture();
    igual(f0.lineas_base.filter(l => l.proyecto_id === quince(f0)).map(l => l.activa), [false, false], 'el 015 tiene dos líneas base y ninguna activa');
    const esperado = { avance_pct: 50, valor_ganado_cronograma_pct: 50, ejecutado_cantidades_pct: 50, programado_pct: 50, spi: 1, spi_texto: '1,00', atraso_fecha_dias: 0, atraso_proyectado_dias: 0, cronograma_vencido: false, fin_programado: '2026-12-11',
      plazo_contractual: SIN_PLAZO, linea_base: null, rubros_sin_cronograma: 0, semaforo: 'verde', motivos: [], datos_por_completar: [] };
    igual(P('ZZZ-PUE-2026-015').avance, esperado, 'con la fila antigua al final de la entrada');
    // Próximos: con la fila reciente (01-nov a 11-dic) la actividad está en curso y ni empieza ni termina en la
    // ventana: no sale. Si termina dentro de ella (4-dic), sale con las fechas de la fila reciente, no las de la antigua.
    igual(P('ZZZ-PUE-2026-015').proximos_14_dias, SIN_PROXIMOS, 'próximos: en curso, ni empieza ni termina en la ventana');
    const termina = con(f => { f.cronograma_rubros.find(c => c.proyecto_id === quince(f) && c.fecha_fin === '2026-12-11').fecha_fin = '2026-12-04'; });
    igual(PD(termina, 'ZZZ-PUE-2026-015').proximos_14_dias, { lista: [{ rubro_codigo: '1', rubro: 'ZZZ Tablero', inicio: '2026-11-01', fin: '2026-12-04' }], total: 1, mas: 0 }, 'próximos: las fechas de la fila reciente');
    const alReves = con(f => { f.cronograma_rubros.reverse(); });
    igual(alReves.proyectos.find(p => p.identidad.codigo === 'ZZZ-PUE-2026-015').avance, esperado, 'con la fila antigua al principio');
    assert(seccionDe(md, 'ZZZ-PUE-2026-015').includes('programado 50,0 % (sin línea base activa)'), 'el .md lo avisa');
    // Con dos líneas base ACTIVAS vale la de número mayor (regla del núcleo), en cualquier orden.
    const dosActivas = con(f => { f.lineas_base.filter(l => l.proyecto_id === quince(f)).forEach(l => { l.activa = true; }); });
    igual([dosActivas.proyectos.find(p => p.identidad.codigo === 'ZZZ-PUE-2026-015').avance.linea_base, dosActivas.proyectos.find(p => p.identidad.codigo === 'ZZZ-PUE-2026-015').avance.spi], ['LB-2', 1], 'dos activas: LB-2');
    // Si la activa es la LB-1, se usa su fila aunque sea la más antigua.
    const unoActiva = con(f => { f.lineas_base.find(l => l.proyecto_id === quince(f) && l.numero === 1).activa = true; });
    const av = unoActiva.proyectos.find(p => p.identidad.codigo === 'ZZZ-PUE-2026-015').avance;
    igual([av.linea_base, av.programado_pct, av.spi, av.semaforo, av.cronograma_vencido, av.fin_programado, av.atraso_fecha_dias, av.atraso_proyectado_dias], ['LB-1', 100, 0.5, 'rojo', true, '2026-10-31', 51, 60], 'LB-1 activa');
    igual(av.motivos, ['SPI 0,50', 'cronograma vencido el 2026-10-31 con 50,0 % de lo programado', 'atraso a la fecha de 51 días'], 'motivos con la LB-1 activa');
  });

  await prueba('próximos 14 días (decisión 6): solo en ejecución y solo rubros SIN terminar que EMPIEZAN o TERMINAN entre hoy y hoy+14, por la fecha de ese hecho', () => {
    // 001. Hoy = 21-nov: la ventana va del 21-nov al 5-dic, los dos incluidos. Solo la línea base activa (LB-2).
    igual(P('ZZZ-FIS-2026-001').proximos_14_dias, { lista: [
      { rubro_codigo: '4.04', rubro: 'ZZZ Desencofrado', inicio: '2026-11-10', fin: '2026-11-21' },                 // termina hoy: entra
      { rubro_codigo: '3.01', rubro: 'ZZZ Instalaciones eléctricas', inicio: '2026-11-24', fin: '2026-12-15' },     // empieza dentro de la ventana
      { rubro_codigo: '1.02', rubro: 'ZZZ Mampostería', inicio: '2026-10-01', fin: '2026-11-30' },                  // empezó antes y termina dentro
      { rubro_codigo: '4.03', rubro: 'ZZZ Pintura exterior', inicio: '2026-12-05', fin: '2026-12-18' }],            // empieza a hoy+14: entra
    total: 4, mas: 0 }, 'próximos del 001, por la fecha del hecho que cae en la ventana (21-nov, 24-nov, 30-nov, 5-dic)');
    const f = fixture();
    const filaDe = codigo => { const r = f.rubros.find(x => x.codigo === codigo && x.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2026-001').id); return [r.estado].concat(f.cronograma_rubros.filter(c => c.rubro_id === r.id).map(c => c.fecha_inicio + '/' + c.fecha_fin)); };
    igual(filaDe('4.01'), ['terminado', '2026-11-15/2026-11-28'], 'el fixture trae un rubro terminado que termina dentro de la ventana (no sale)');
    igual(filaDe('4.02'), ['planificado', '2026-12-06/2026-12-20'], 'una actividad que empieza a hoy+15 (no sale)');
    igual(filaDe('4.05'), ['trabajando', '2026-11-01/2026-11-20'], 'una que terminó ayer (no sale)');
    igual(filaDe('4.06'), ['trabajando', '2026-11-20/2026-11-30'], 'una que solo está en la línea base antigua (no sale)');
    igual(filaDe('4.07'), ['trabajando', '2026-11-01/2026-12-19'], 'y una EN CURSO que ni empieza ni termina en la ventana (no sale)');
    // La actividad en curso entra en cuanto su fin cae en la ventana (5-dic = hoy+14), y no un día después.
    const fin407 = fin => PD(con(f2 => { const r = f2.rubros.find(x => x.codigo === '4.07'); f2.cronograma_rubros.find(c => c.rubro_id === r.id).fecha_fin = fin; }), 'ZZZ-FIS-2026-001').proximos_14_dias;
    igual([fin407('2026-12-05').lista.map(x => x.rubro_codigo), fin407('2026-12-05').total, fin407('2026-12-06').total], [['4.04', '3.01', '1.02', '4.03', '4.07'], 5, 4], 'borde del fin: hoy+14 entra, hoy+15 no');
    // Un rubro con el 100 % de avance no sale aunque su estado no sea «terminado» (1.02 con toda su producción).
    const completo = PD(con(f2 => { f2.rubros.find(x => x.codigo === '1.02').total_produccion = 200000; }), 'ZZZ-FIS-2026-001').proximos_14_dias;
    igual([completo.lista.map(x => x.rubro_codigo), completo.total], [['4.04', '3.01', '4.03'], 3], 'rubro al 100 %: fuera');
    // Y uno «terminado» tampoco, empiece o termine cuando sea.
    const terminado = PD(con(f2 => { f2.rubros.find(x => x.codigo === '3.01').estado = 'terminado'; }), 'ZZZ-FIS-2026-001').proximos_14_dias;
    igual(terminado.lista.map(x => x.rubro_codigo), ['4.04', '1.02', '4.03'], 'rubro terminado: fuera');

    // SOLO en ejecución: en los demás estados el bloque va vacío, tengan o no cronograma, y el .md dice que no aplica.
    estado.proyectos.forEach(p => { if(p.identidad.estado !== 'ejecucion') igual(p.proximos_14_dias, SIN_PROXIMOS, 'sin lista fuera de ejecución: ' + p.identidad.codigo); });
    const pausado = con(f2 => { proyectoDe(f2, 'ZZZ-FIS-2026-001').estado = 'pausado'; });
    igual(PD(pausado, 'ZZZ-FIS-2026-001').proximos_14_dias, SIN_PROXIMOS, 'el mismo 001, pausado: sin lista');
    assert(seccionDe(estadoAMarkdown(pausado), 'ZZZ-FIS-2026-001').includes('\n**Próximos 14 días.** no aplica (proyecto pausado)\n'), '.md del 001 pausado');
    const finalizado = con(f2 => { const p = proyectoDe(f2, 'ZZZ-FIS-2026-001'); p.estado = 'finalizado'; });
    igual(PD(finalizado, 'ZZZ-FIS-2026-001').proximos_14_dias, SIN_PROXIMOS, 'el mismo 001, finalizado: sin lista');
    igual(md.split('\n').filter(x => x.startsWith('**Próximos 14 días.** no aplica (proyecto ')).map(x => /\(proyecto (.+)\)$/.exec(x)[1]),
      ['pausado', 'pausado', 'en planificación'].concat(Array(8).fill('finalizado'), ['cancelado', 'sin estado']), 'el .md lo dice en los trece que no están en ejecución');
    // En ejecución y sin nada en la ventana: lista vacía, con su texto.
    igual([P('ZZZ-PIL-2026-030').proximos_14_dias, P('ZZZ-CON-2026-018').proximos_14_dias], [SIN_PROXIMOS, SIN_PROXIMOS], 'en ejecución sin actividades en la ventana');
    assert(seccionDe(md, 'ZZZ-CON-2026-018').includes('\n**Próximos 14 días.** ningún rubro sin terminar empieza ni termina en estos días\n'), '.md sin actividades');
    assert(!md.includes('sin actividades programadas'), 'el texto antiguo ya no se usa');
  });

  await prueba('próximos 14 días (decisión 6): como mucho 10 en la lista y «y N más»', () => {
    // 029: doce rubros sin terminar empiezan en la ventana (uno por día, del 22-nov al 3-dic). Su rubro 1
    // (1-sep a 31-dic) está en curso y ni empieza ni termina en ella.
    const px = P('ZZZ-PUE-2026-029').proximos_14_dias;
    igual([px.lista.length, px.total, px.mas], [10, 12, 2], 'doce candidatos: diez en la lista y dos más');
    igual(px.lista.map(x => x.rubro_codigo), ['2.01', '2.02', '2.03', '2.04', '2.05', '2.06', '2.07', '2.08', '2.09', '2.10'], 'los diez primeros, por fecha');
    igual([px.lista[0], px.lista[9]], [{ rubro_codigo: '2.01', rubro: 'ZZZ Acabado 1', inicio: '2026-11-22', fin: '2026-12-11' }, { rubro_codigo: '2.10', rubro: 'ZZZ Acabado 10', inicio: '2026-12-01', fin: '2026-12-20' }], 'primera y última de la lista');
    const s = seccionDe(md, 'ZZZ-PUE-2026-029');
    assert(s.includes('\n**Próximos 14 días.** 2.01 ZZZ Acabado 1 (22-nov a 11-dic) · ') && s.includes(' · 2.10 ZZZ Acabado 10 (01-dic a 20-dic) · y 2 más\n'), '.md: diez y «y 2 más»');
    assert(!s.includes('ZZZ Acabado 11') && !s.includes('ZZZ Acabado 12') && !s.includes('ZZZ Tablero y estribos'), '.md: ni los que no caben ni el rubro en curso');
    // Con diez justos no hay «más»; con once, «y 1 más».
    const quitar = codigosFuera => con(f => { f.rubros = f.rubros.filter(r => !codigosFuera.includes(r.codigo)); });
    const diez = quitar(['2.11', '2.12']), once = quitar(['2.12']);
    igual([PD(diez, 'ZZZ-PUE-2026-029').proximos_14_dias.total, PD(diez, 'ZZZ-PUE-2026-029').proximos_14_dias.mas, PD(once, 'ZZZ-PUE-2026-029').proximos_14_dias.mas], [10, 0, 1], 'diez y once candidatos');
    assert(!seccionDe(estadoAMarkdown(diez), 'ZZZ-PUE-2026-029').includes(' más\n') && seccionDe(estadoAMarkdown(once), 'ZZZ-PUE-2026-029').includes(' · y 1 más\n'), '.md con diez y con once');
    // En todos los proyectos: tres claves, nunca más de diez y total = lista + más.
    estado.proyectos.forEach(p => {
      const x = p.proximos_14_dias;
      igual(Object.keys(x), ['lista', 'total', 'mas'], 'claves de próximos en ' + p.identidad.codigo);
      assert(x.lista.length <= 10 && x.total === x.lista.length + x.mas && x.mas >= 0, 'cuentas de próximos en ' + p.identidad.codigo);
    });
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

  await prueba('resumen por gestora, emisor, tipo y semáforo: totales de los proyectos INCLUIDOS; el semáforo cuenta aparte los que no llevan color', () => {
    const r = estado.resumen;
    igual(Object.keys(r), ['por_gestora', 'por_emisor', 'por_tipo', 'semaforo', 'datos_por_completar', 'esperan_decision'], 'partes del resumen');
    // Monto vigente: los 1.178.600 de los 23 proyectos anteriores + 60.000 del 029 + 56.000 del 031 (el 030 no tiene rubros).
    igual(r.por_gestora, [{ sigla: 'ZZG', nombre: 'ZZZ GESTORA', proyectos: 25, monto_vigente: 1294600, proyectos_sin_monto: 0 }, { sigla: 'ZZH', nombre: 'ZZZ SEGUNDA', proyectos: 1, monto_vigente: 0, proyectos_sin_monto: 0 }], 'por gestora');
    igual(r.por_emisor.map(x => [x.sigla, x.proyectos, x.monto_vigente]), [['ZZG', 23, 1144600], ['ZZE', 2, 150000], ['ZZH', 1, 0]], 'por emisor');
    igual(r.por_tipo.map(x => [x.tipo, x.proyectos]), [['fiscalizacion', 9], ['construccion', 7], ['puentes', 3], ['gerencia', 2], ['muros_pantalla', 2], ['pilotes', 2], ['disenos', 1]], 'por tipo');
    igual(r.semaforo, SEMAFORO, 'semáforo');
    igual(Object.keys(r.semaforo), ['rojo', 'amarillo', 'verde', 'sin_semaforo', 'sin_datos'], 'claves del semáforo');
    igual(Object.keys(r.semaforo.sin_semaforo), ['planificacion', 'pausado', 'finalizado', 'cancelado', 'sin_estado'], 'claves de sin_semaforo');
    const s = r.semaforo;
    igual([s.rojo + s.amarillo + s.verde + s.sin_datos, Object.values(s.sin_semaforo).reduce((a, b) => a + b, 0)], [EN_EJECUCION.length, SIN_SEMAFORO.length], 'colores = en ejecución; sin semáforo = los demás');
    [r.por_gestora, r.por_emisor, r.por_tipo].forEach(lista => igual(lista.reduce((t, x) => t + x.proyectos, 0), estado.proyectos_incluidos, 'la suma es la de los incluidos, no la de la cartera'));
    igual(estadoDelResumen(estado), 'ok', 'resumen completo');
    assert(md.includes('Los totales por gestora, emisor y tipo cuentan solo los 26 proyectos incluidos en este archivo, no toda la cartera.'), 'el .md lo dice');
    // Sin ningún proyecto fuera de ejecución, el .md lo dice.
    const soloEjecucion = con(f => { f.proyectos = f.proyectos.filter(p => p.estado === 'ejecucion'); });
    igual(soloEjecucion.resumen.semaforo, { ...SEMAFORO, sin_semaforo: { planificacion: 0, pausado: 0, finalizado: 0, cancelado: 0, sin_estado: 0 } }, 'todos en ejecución');
    assert(estadoAMarkdown(soloEjecucion).includes('- Sin semáforo (no están en ejecución): ninguno\n'), '.md sin proyectos fuera de ejecución');
  });

  await prueba('resumen: una empresa que falta en el catálogo se agrupa como «(empresa no encontrada)» y no tumba nada', () => {
    const e = con(f => { f.empresas = f.empresas.filter(x => x.sigla !== 'ZZE'); });
    igual(estadoDelResumen(e), 'ok', 'las seis partes se calculan');
    igual(e.resumen.por_emisor.map(x => [x.sigla, x.nombre, x.proyectos, x.monto_vigente]), [['ZZG', 'ZZZ GESTORA', 23, 1144600], [null, '(empresa no encontrada)', 2, 150000], ['ZZH', 'ZZZ SEGUNDA', 1, 0]], 'por emisor');
    igual(e.resumen.por_gestora, estado.resumen.por_gestora, 'por gestora no cambia');
    igual([e.resumen.por_tipo, e.resumen.semaforo, e.resumen.datos_por_completar, e.resumen.esperan_decision], [estado.resumen.por_tipo, estado.resumen.semaforo, estado.resumen.datos_por_completar, estado.resumen.esperan_decision], 'el resto del resumen no cambia');
    igual(e.bloques_fallidos.filter(x => x.bloque === 'identidad.empresa').map(x => [x.proyecto, x.indice, x.motivo]), [['ZZZ-PUE-2026-015', 11, 'empresa no encontrada en el catálogo'], ['ZZZ-PIL-2026-002', 3, 'empresa no encontrada en el catálogo']], 'queda anotado en los dos proyectos');
    const id = e.proyectos[3].identidad;
    igual([id.codigo, id.gestora, id.emisor, id.tipo], ['ZZZ-PIL-2026-002', 'ZZG', '(empresa no encontrada)', 'pilotes'], 'identidad del proyecto afectado');
    const m = estadoAMarkdown(e);
    assert(m.includes('- Por emisor: ZZZ GESTORA 23 · (empresa no encontrada) 2 · ZZZ SEGUNDA 1'), '.md, resumen');
    assert(m.includes('**Identidad.** Gestora ZZZ GESTORA · emisor (empresa no encontrada) · pilotes · en ejecución'), '.md, identidad');
    assert(m.includes('| Garantía vencida | ZZZ-PIL-2026-002 |'), 'la tabla de decisiones sigue completa');
  });

  await prueba('resumen: cada parte se calcula por separado; si una falla, queda en null con su entrada y las demás siguen', () => {
    const f = fixture(); delete f.empresas;
    const e = construirEstado(f, OPCIONES);
    igual([e.resumen.por_gestora, e.resumen.por_emisor], [null, null], 'sin la tabla de empresas no hay agrupación por empresa');
    igual([e.resumen.por_tipo, e.resumen.semaforo, e.resumen.datos_por_completar, e.resumen.esperan_decision], [estado.resumen.por_tipo, estado.resumen.semaforo, estado.resumen.datos_por_completar, estado.resumen.esperan_decision], 'tipo, semáforo, datos por completar y decisiones se calculan igual');
    igual(e.bloques_fallidos.filter(x => x.bloque.startsWith('resumen.')), [
      { bloque: 'resumen.por_gestora', proyecto: null, indice: null, motivo: 'falta la tabla «empresas» en los datos' },
      { bloque: 'resumen.por_emisor', proyecto: null, indice: null, motivo: 'falta la tabla «empresas» en los datos' }], 'una entrada por parte fallida');
    igual(estadoDelResumen(e), 'parcial', 'resumen parcial');
    igual(codigos(e), INCLUIDOS, 'los proyectos salen todos, con su código');
    assert(e.proyectos.every(p => p.identidad.gestora === null && p.identidad.nombre && p.identidad.tipo !== undefined), 'identidad sin empresas pero con lo demás');
    const m = estadoAMarkdown(e);
    assert(m.includes('- Por gestora: no se pudo calcular: falta la tabla «empresas» en los datos') && m.includes('- Por emisor: no se pudo calcular: falta la tabla «empresas» en los datos'), '.md, partes fallidas');
    assert(m.includes('- Por tipo: fiscalización 9 ·') && m.includes('- Semáforo (solo proyectos en ejecución): 5 rojos · 4 amarillos · 4 verdes') && m.includes('| Garantía vencida | ZZZ-PIL-2026-002 |'), '.md, partes calculadas');
    assert(m.includes('**Identidad.** Gestora y emisor: no se pudo calcular: falta la tabla «empresas» en los datos · pilotes · en ejecución'), '.md, identidad');
    igual([estadoDelResumen({ resumen: null }), estadoDelResumen({ resumen: { por_gestora: null, por_emisor: null, por_tipo: null, semaforo: null, datos_por_completar: null, esperan_decision: null } }), estadoDelResumen({ resumen: { ...estado.resumen, semaforo: null } }),
      estadoDelResumen({ resumen: { ...estado.resumen, datos_por_completar: null } })], ['null', 'null', 'parcial', 'parcial'], 'estadoDelResumen (seis partes)');
    const mNulo = estadoAMarkdown({ ...estado, resumen: { ...estado.resumen, esperan_decision: null, semaforo: null, datos_por_completar: null } });
    assert(mNulo.includes('- Semáforo (solo proyectos en ejecución): no se pudo calcular: motivo no registrado') && mNulo.includes('- Datos por completar: no se pudo calcular: motivo no registrado') && !mNulo.includes('- Sin semáforo'), 'el .md no se rompe con partes en null');
  });

  await prueba('«Esperan decisión»: D5 (más de 15 días), D7 (15 días o menos) y orden por urgencia con «dias» y «sentido»', () => {
    const d = estado.resumen.esperan_decision;
    igual(d.map(x => [x.clase, x.proyecto, x.dias, x.sentido]), [
      ['garantia_vencida', 'ZZZ-FIS-2024-020', 51, 'vencida_hace'],     // de un finalizado: sin color, pero espera decisión
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
    igual(decision('garantia_vencida', 'ZZZ-PIL-2026-002')[0], { clase: 'garantia_vencida', proyecto: 'ZZZ-PIL-2026-002', detalle: 'Fiel cumplimiento, venció el 2026-11-10', desde: '2026-11-10', dias: 11, sentido: 'vencida_hace', monto: null }, 'garantía vencida');
    igual(decision('observacion_antigua', 'ZZZ-FIS-2026-001')[0], { clase: 'observacion_antigua', proyecto: 'ZZZ-FIS-2026-001', detalle: 'Observación n.º 12 «ZZZ Curado deficiente», creada por Ana Zzzperez', desde: '2026-10-18', dias: 34, sentido: 'esperando', monto: null }, 'D5: se muestra «creada por»');
    assert(!d.some(x => /Señalética|Acero expuesto|Andamio|Sello de junta|registro de cantidades/.test(x.detalle)), 'las observaciones de 15 días o menos no entran');
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
    igual(e.resumen.esperan_decision.slice(0, 7).map(x => [x.clase, x.proyecto, x.dias, x.sentido]), [
      ['garantia_vencida', 'ZZZ-FIS-2024-008', 112, 'vencida_hace'],
      ['garantia_vencida', 'ZZZ-FIS-2024-020', 51, 'vencida_hace'],
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
    const e = con(f => { const p = proyectoDe(f, 'ZZZ-FIS-2026-001'); p.nombre = 'ZZZ Obra de n@zzz.test'; p.contratista = 'ZZZ c@zzz.test'; p.ubicacion = 'ZZZ u@zzz.test'; p.fecha_inicio = 'f@zzz.test';
      f.rubros.find(r => r.codigo === '1.02').descripcion = 'ZZZ r@zzz.test'; f.perfiles[0].apellido = 'p@zzz.test'; f.empresas[0].nombre = 'ZZZ e@zzz.test'; });
    const t = JSON.stringify(e) + estadoAMarkdown(e);
    assert(!t.includes('@') && !t.includes('zzz.test'), 'ningún correo en la salida');
    igual(PD(e, 'ZZZ-FIS-2026-001').identidad.nombre, 'ZZZ Obra de (dato omitido)', 'nombre del proyecto limpio');
    igual(e.bloques_fallidos.filter(x => x.bloque === 'identidad').map(x => x.motivo), ['fecha inválida en proyectos.fecha_inicio'], 'el motivo del fallo no arrastra el valor');
  });

  await prueba('la salida no lleva identificadores internos ni correos', () => {
    assert(!RE_UUID.test(texto), 'uuid en el .json: ' + (texto.match(RE_UUID) || [])[0]);
    assert(!RE_UUID.test(md), 'uuid en el .md');
    assert(!texto.includes('@') && !md.includes('@'), 'no debe haber «@»');
    assert(!/"(id|proyecto_id|empresa_id|emisor_empresa_id|rubro_id|linea_base_id|creado_por|created_by|subido_por|usuario_id|perfil_id|es_prueba)"/.test(texto), 'no debe haber claves de identificador ni la marca de prueba');
  });

  await prueba('.md: primera línea, cabecera, resumen y tabla de decisiones rotulada', () => {
    const l = md.split('\n');
    igual(l[0], '# Estado de proyectos GdO — válido para el 2026-11-21', 'primera línea');
    igual(l[2], 'Generado: 2026-11-21 03:14 (America/Guayaquil) · formato 3 · app hidivo-vZZ · 26 proyectos de 32 · excluidos: 1 sin código, 2 liquidados, 3 finalizados o cancelados sin pendientes', 'cabecera');
    igual(l[3], 'Elementos de prueba — usuarios de prueba: 3; se dejó fuera lo suyo: ZZZ-FIS-2026-001 (1 miembro del equipo, 1 observación, 1 archivo); ZZZ-PIL-2026-030 (3 miembros del equipo, 1 observación, 2 registros del libro, 1 solicitud, 1 orden de cambio, 1 planilla, 1 ensayo, 1 incidente SST, 4 archivos)', 'cabecera: lo que se dejó fuera por ser de prueba');
    igual(l[4], 'Bloques sin calcular: 1 (planillas de ZZZ-PIL-2026-002)', 'cabecera: bloques sin calcular');
    ['- Por gestora: ZZZ GESTORA 25 proyectos · ZZZ SEGUNDA 1 proyecto', '- Por emisor: ZZZ GESTORA 23 · ZZZ EMISOR 2 · ZZZ SEGUNDA 1',
      '- Por tipo: fiscalización 9 · construcción 7 · puentes 3 · gerencia de proyecto 2 · muros pantalla 2 · pilotes 2 · diseños 1',
      '- Semáforo (solo proyectos en ejecución): 5 rojos · 4 amarillos · 4 verdes',
      '- Sin semáforo (no están en ejecución): 2 pausados · 1 en planificación · 8 finalizados · 1 cancelado · 1 sin estado',
      '- Datos por completar: 6 proyectos', '### Esperan decisión de Nicolás',
      '| Qué | Proyecto | Detalle | Desde | Días |',
      '| Planilla en revisión | ZZZ-FIS-2026-001 | Planilla 4, $ 48.250,00 | 2026-11-12 | 9 días |',
      '| Orden de cambio solicitada | ZZZ-FIS-2026-001 | OC-03 «ZZZ Refuerzo de losa», $ 12.000,00 | 2026-11-15 | 6 días |',
      '| Garantía por vencer | ZZZ-FIS-2026-001 | Fiel cumplimiento, vence el 2026-11-25 | — | vence en 4 |',
      '| Garantía vencida | ZZZ-PIL-2026-002 | Fiel cumplimiento, venció el 2026-11-10 | 2026-11-10 | vencida hace 11 |',
      '| Liquidación pendiente | ZZZ-FIS-2025-005 | Con acta definitiva y sin liquidación | 2026-11-01 | 20 días |',
      '| Acta definitiva pendiente | ZZZ-MUR-2026-016 | Con acta provisional y sin acta definitiva | — | — |'
    ].forEach(x => assert(l.includes(x), 'falta la línea: ' + x));
    const dias = l.filter(x => /^\| (?!Qué|---)/.test(x)).map(x => x.split(' | ').pop().replace(' |', ''));
    igual(dias, ['vencida hace 51', 'vencida hace 11', 'vence en 4', 'vence en 15', '40 días', '34 días', '20 días', '20 días', '20 días', '16 días', '9 días', '6 días', '—'], 'columna Días, por urgencia');
    // Un solo excluido de cada clase, y ninguno.
    const uno = { ...estado, proyectos_excluidos: { sin_codigo: 0, liquidados: 1, cerrados_sin_pendientes: 1 } };
    assert(estadoAMarkdown(uno).split('\n')[2].endsWith('· 26 proyectos de 32 · excluidos: 1 liquidado, 1 finalizado o cancelado sin pendientes'), 'singular');
    assert(estadoAMarkdown({ ...estado, proyectos_excluidos: { sin_codigo: 0, liquidados: 0, cerrados_sin_pendientes: 0 } }).split('\n')[2].endsWith('· 26 proyectos de 32'), 'sin excluidos');
    // Sin nada que decidir y sin bloques fallidos.
    const limpio = con(sanear);
    igual(limpio.bloques_fallidos, [], 'sin la fecha corrupta no falla nada');
    const mLimpio = estadoAMarkdown(limpio);
    assert(mLimpio.includes('Bloques sin calcular: ninguno') && !mLimpio.includes('Tabla incompleta'), '.md sin fallos');
    assert(mLimpio.includes('| Planilla en revisión | ZZZ-PIL-2026-002 | Planilla 1, $ 9.000,00 | 2026-11-20 | 1 día |'), 'un día, en singular');
  });

  await prueba('.md: una sección por proyecto con sus 11 bloques y números es-EC', () => {
    igual(md.split('\n').filter(x => x.startsWith('## ') && x !== '## Resumen'), [
      // En ejecución: la etiqueta de su color (texto: los círculos de color le llegan dañados al lector).
      '## [ROJO] ZZZ-CON-2026-018 — ZZZ Cronograma vencido sin terminar', '## [ROJO] ZZZ-CON-2026-027 — ZZZ Plan con meseta', '## [ROJO] ZZZ-MUR-2026-023 — ZZZ Muro sin nada ejecutado', '## [ROJO] ZZZ-PIL-2026-002 — ZZZ Pilotes de ejemplo',
      '## [ROJO] ZZZ-PUE-2026-029 — ZZZ Plazo contractual vencido',
      '## [AMARILLO] ZZZ-CON-2026-022 — ZZZ Avance y cantidades distintos', '## [AMARILLO] ZZZ-FIS-2026-001 — ZZZ Edificio de ejemplo', '## [AMARILLO] ZZZ-MUR-2026-016 — ZZZ Muro con recepcion provisional',
      '## [AMARILLO] ZZZ-PIL-2026-030 — ZZZ Proyecto solo de pruebas',
      '## [VERDE] ZZZ-CON-2026-019 — ZZZ Cronograma vencido y obra terminada', '## [VERDE] ZZZ-CON-2026-028 — ZZZ Programado terminado y rubro sin cronograma', '## [VERDE] ZZZ-PUE-2026-015 — ZZZ Puente sin linea base activa',
      '## [VERDE] ZZZ-PUE-2026-031 — ZZZ Monto que no cuadra',
      // Los demás: «[SIN SEMÁFORO]» y el estado.
      '## [SIN SEMÁFORO] ZZZ-CON-2026-003 — ZZZ Obra pausada (pausado)', '## [SIN SEMÁFORO] ZZZ-CON-2026-025 — ZZZ Pausado con cronograma atrasado (pausado)', '## [SIN SEMÁFORO] ZZZ-GER-2026-017 — ZZZ Proyecto en planificacion (en planificación)',
      '## [SIN SEMÁFORO] ZZZ-FIS-2024-008 — ZZZ Solo garantia vigente (finalizado)', '## [SIN SEMÁFORO] ZZZ-FIS-2024-009 — ZZZ Solo planilla aprobada (finalizado)', '## [SIN SEMÁFORO] ZZZ-FIS-2024-010 — ZZZ Solo observacion en proceso (finalizado)',
      '## [SIN SEMÁFORO] ZZZ-FIS-2024-020 — ZZZ Finalizado con garantia vencida (finalizado)', '## [SIN SEMÁFORO] ZZZ-FIS-2024-021 — ZZZ Finalizado sin produccion (finalizado)', '## [SIN SEMÁFORO] ZZZ-FIS-2024-024 — ZZZ Finalizado sin produccion ni pendientes (finalizado)',
      '## [SIN SEMÁFORO] ZZZ-FIS-2025-004 — ZZZ Finalizado sin acta (finalizado)', '## [SIN SEMÁFORO] ZZZ-FIS-2025-005 — ZZZ Finalizado sin liquidar (finalizado)',
      '## [SIN SEMÁFORO] ZZZ-DIS-2026-013 — ZZZ Cancelado con pendientes (cancelado)', '## [SIN SEMÁFORO] ZZZ-GER-2026-026 — ZZZ Proyecto sin estado (sin estado)'], 'secciones');
    // La línea del color: «Semáforo …» en ejecución, «Sin semáforo: proyecto <estado>» en los demás.
    igual(md.split('\n').filter(x => /^Semáforo (rojo|amarillo|verde)/.test(x)).length, 13, 'trece líneas de color');
    igual(md.split('\n').filter(x => x.startsWith('Sin semáforo: proyecto ')), ['Sin semáforo: proyecto pausado', 'Sin semáforo: proyecto pausado', 'Sin semáforo: proyecto en planificación'].concat(Array(8).fill('Sin semáforo: proyecto finalizado'), ['Sin semáforo: proyecto cancelado', 'Sin semáforo: proyecto sin estado']), 'trece sin semáforo');
    igual(md.split('\n').filter(x => x.startsWith('Ejecutado por cantidades: ')).length, 26, 'la segunda línea del avance en todos');
    const seccion = seccionDe(md, 'ZZZ-FIS-2026-001');
    ['**Identidad.** Gestora ZZZ GESTORA · emisor ZZZ GESTORA · fiscalización · en ejecución',
      'Contratante: ZZZ Cliente de Ejemplo S.A. · Contratista: ZZZ Constructora de Ejemplo',
      'Ubicación: ZZZ Ciudad de Ejemplo',
      'Firma: no registrada · Inicio: 2026-08-03 · Fin contractual: 2026-12-15',
      'Monto contractual $ 410.000,00 · vigente $ 428.600,00 (órdenes de cambio $ 18.600,00)',
      'Descripción: Construcción de un edificio de dos plantas. Incluye obras exteriores | y cerramiento.',
      '**Avance.** Avance (valor ganado) 61,7 % · programado 63,0 % (LB-2) · valor ganado en cronograma 58,3 % (2 rubros sin cronograma) · SPI 0,92 · atraso a la fecha 6 días',
      'Ejecutado por cantidades: 61,7 %',
      'Semáforo amarillo: SPI 0,92; 1 garantía por vencer en 5 días o menos; 7 pendientes (libro, observaciones y solicitudes)',
      '**Próximos 14 días.** 4.04 ZZZ Desencofrado (10-nov a 21-nov) · 3.01 ZZZ Instalaciones eléctricas (24-nov a 15-dic) · 1.02 ZZZ Mampostería (01-oct a 30-nov) · 4.03 ZZZ Pintura exterior (05-dic a 18-dic)',
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
    assert(md.includes('\nUbicación: ZZZ Muelle de Ejemplo\n') && md.includes('\nUbicación: no registrada\n'), 'ubicación sin coordenadas (D8)');
    assert(md.includes('**Garantías.** Fiel cumplimiento hasta 2026-11-10 (vencida hace 11 días)'), 'garantía vencida');
    assert(md.includes('· finalizado · recepción definitiva') && md.includes('· diseños · cancelado') && md.includes('· en ejecución · recepción provisional'), 'estado y estado de cierre');
    estado.proyectos.forEach((p, i) => {
      const trozo = md.split(/^## (?!Resumen)/m)[i + 1];
      ['Identidad', 'Avance', 'Próximos 14 días', 'Planillas', 'Garantías', 'Órdenes de cambio', 'Libro de obra', 'Observaciones', 'Calidad y seguridad', 'Documentos', 'Equipo']
        .forEach(b => assert(trozo.includes(`**${b}.**`), `falta el bloque ${b} en la sección ${i + 1}`));
    });
  });

  await prueba('planillas (decisión 7): un número registrado dos veces sale UNA vez, con el estado más avanzado, y avisa en «datos por completar»', () => {
    // 029: la planilla 2 está dos veces en la base (mismo periodo, mismo monto, creadas a la vez): una «en revisión» y otra «aprobada».
    const f0 = fixture(), de29 = f => f.planillas_pago.filter(pl => pl.proyecto_id === proyectoDe(f, 'ZZZ-PUE-2026-029').id);
    igual(de29(f0).map(pl => pl.numero + ':' + pl.estado).sort(), ['1:pagada', '2:aprobada', '2:en_revision'], 'planillas del 029 en el fixture');
    const [a0, b0] = de29(f0).filter(pl => pl.numero === 2);
    igual([a0.fecha_inicio, a0.fecha_fin, a0.total_monto, a0.total_liquido, a0.created_at], [b0.fecha_inicio, b0.fecha_fin, b0.total_monto, b0.total_liquido, b0.created_at], 'los dos registros son el mismo envío');
    const p = P('ZZZ-PUE-2026-029');
    igual(p.planillas, { ultima: { numero: 2, periodo_desde: '2026-10-01', periodo_hasta: '2026-10-31', monto: 20000, estado: 'aprobada', fecha: '2026-11-12' },
      en_revision: [], aprobadas_sin_pagar: [{ numero: 2, monto: 20000, aprobada: '2026-11-12', dias: 9 }] }, 'una sola vez, como aprobada');
    igual(decision('planilla_en_revision', 'ZZZ-PUE-2026-029'), [], 'y no espera decisión como «en revisión»');
    igual(p.avance.datos_por_completar, [PLANILLA_REPETIDA], 'el aviso en «datos por completar»');
    const s = seccionDe(md, 'ZZZ-PUE-2026-029');
    assert(s.includes('**Planillas.** Última: n.º 2, 01 a 31-oct, $ 20.000,00, aprobada el 2026-11-12\nAprobadas sin pagar: n.º 2, $ 20.000,00, aprobada el 2026-11-12 (9 días)\n') && !s.includes('En revisión') && !s.includes('en revisión'), '.md del 029: ' + s.split('\n').filter(x => /lanilla|revisi|probada/.test(x)).join(' / '));
    assert(s.includes('\n⚠ Datos por completar: ' + PLANILLA_REPETIDA + '\n'), '.md: el aviso');
    // En toda la exportación, ningún número sale dos veces ni a la vez «en revisión» y «aprobada sin pagar».
    estado.proyectos.forEach(x => {
      if(!x.planillas) return;
      const rev = x.planillas.en_revision.map(y => y.numero), apr = x.planillas.aprobadas_sin_pagar.map(y => y.numero);
      assert(new Set(rev.concat(apr)).size === rev.length + apr.length, 'planilla repetida en ' + x.identidad.codigo);
    });
    igual(estado.proyectos.filter(x => x.avance.datos_por_completar.some(y => /^planilla n\.º/.test(y))).map(x => x.identidad.codigo), ['ZZZ-PUE-2026-029'], 'el mismo número en proyectos distintos (hay varias «n.º 1») no es una repetición');
    // No depende del orden de llegada.
    igual(PD(con(f => { f.planillas_pago.reverse(); }), 'ZZZ-PUE-2026-029').planillas, p.planillas, 'con las filas al revés');
    // Estado más avanzado: pagada > aprobada > en revisión > enviada > rechazada > borrador, lleguen en el orden que lleguen.
    const ORDEN = ['borrador', 'rechazada', 'enviada', 'en_revision', 'aprobada', 'pagada'];
    ORDEN.forEach((menor, i) => ORDEN.slice(i + 1).forEach(mayor => [[menor, mayor], [mayor, menor]].forEach(([uno, otro]) => {
      const e = con(f => { const [a, b] = de29(f).filter(pl => pl.numero === 2); a.estado = uno; b.estado = otro; });
      const pl = PD(e, 'ZZZ-PUE-2026-029').planillas;
      igual([pl.ultima.numero, pl.ultima.estado], [2, mayor], `entre «${uno}» y «${otro}» vale «${mayor}»`);
      igual(pl.en_revision.length + pl.aprobadas_sin_pagar.length, mayor === 'enviada' || mayor === 'en_revision' || mayor === 'aprobada' ? 1 : 0, `una sola fila pendiente con «${uno}» y «${otro}»`);
      igual(PD(e, 'ZZZ-PUE-2026-029').avance.datos_por_completar, [PLANILLA_REPETIDA], 'el aviso no depende de los estados');
    })));
    // A igual estado vale el registro modificado más tarde.
    const iguales = con(f => { const [a, b] = de29(f).filter(pl => pl.numero === 2); a.estado = b.estado = 'aprobada'; a.updated_at = '2026-11-15T15:00:00+00:00'; a.total_liquido = 111; });
    igual(PD(iguales, 'ZZZ-PUE-2026-029').planillas.aprobadas_sin_pagar.map(x => x.monto), [111], 'mismo estado: el más reciente');
    // Tres registros del mismo número.
    const tres = con(f => { f.planillas_pago.push({ ...de29(f).find(pl => pl.numero === 2), id: 'aaaaaaaa-0000-4000-8000-99999999aaa1', estado: 'enviada' }); });
    igual([PD(tres, 'ZZZ-PUE-2026-029').avance.datos_por_completar, PD(tres, 'ZZZ-PUE-2026-029').planillas], [['planilla n.º 2 registrada 3 veces'], p.planillas], 'tres veces: el mismo bloque y el aviso con la cuenta');
    // D9: una planilla repetida NO hace entrar a un finalizado sin pendientes (el aviso se muestra solo en los proyectos que ya entran).
    const e7 = con(f => { const pl = f.planillas_pago.find(x => x.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2024-007').id); f.planillas_pago.push({ ...pl, id: 'aaaaaaaa-0000-4000-8000-99999999aaa2' }); });
    igual(codigos(e7).includes('ZZZ-FIS-2024-007'), false, 'finalizado sin pendientes con una planilla pagada repetida: sigue fuera');
    // Una planilla pagada con un duplicado que se quedó «en revisión» no espera decisión ni está sin pagar: vale la pagada.
    const e9 = con(f => { const pl = f.planillas_pago.find(x => x.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2024-009').id); f.planillas_pago.push({ ...pl, id: 'aaaaaaaa-0000-4000-8000-99999999aaa3', estado: 'en_revision' }); pl.estado = 'pagada'; pl.fecha_pago = '2026-10-01'; });
    // Vale la pagada: el gemelo «en revisión» no cuenta como pendiente, así que el finalizado sigue fuera y no hay decisión que esperar.
    igual([codigos(e9).includes('ZZZ-FIS-2024-009'), e9.resumen.esperan_decision.filter(d => d.proyecto === 'ZZZ-FIS-2024-009')], [false, []], 'pagada con un duplicado en revisión');
  });

  await prueba('usuarios de prueba (decisión 10): fuera del equipo, de los recuentos, de los pendientes y de «Esperan decisión»; la cabecera dice qué se dejó fuera', () => {
    const f0 = fixture();
    igual(f0.perfiles.filter(x => x.es_prueba).map(x => x.nombre + ' ' + x.apellido), ['Prueba Uno Zzzresidente', 'PRUEBA Dos Zzzfiscal', 'Zoe Zzzcorreo'], 'usuarios de prueba del fixture (la tercera lo es por su correo, que no sale de la base)');
    assert(!/@|email/.test(JSON.stringify(f0.perfiles)), 'los perfiles llegan sin correo: solo el booleano');
    igual([estado.usuarios_de_prueba, estado.excluidos_de_prueba], [3, [
      { proyecto: 'ZZZ-FIS-2026-001', elementos: { miembros_equipo: 1, observaciones: 1, archivos: 1 } },
      { proyecto: 'ZZZ-PIL-2026-030', elementos: { miembros_equipo: 3, observaciones: 1, registros_libro: 2, solicitudes: 1, ordenes_cambio: 1, planillas: 1, ensayos: 1, incidentes_sst: 1, archivos: 4 } }]], 'cabecera del .json: qué se dejó fuera, por proyecto');
    // 030: su equipo es todo de prueba y todo lo que tiene lo creó un usuario de prueba. El proyecto sale, vacío.
    const p = P('ZZZ-PIL-2026-030');
    igual(p.equipo, [], 'equipo vacío');
    igual(p.observaciones, { abiertas: 0, en_proceso: 0, mas_antiguas: [], con_antecedente: 0 }, 'observaciones');
    igual(p.planillas, { ultima: null, en_revision: [], aprobadas_sin_pagar: [] }, 'planillas');
    igual(p.ordenes_cambio, { por_estado: { borrador: 0, solicitada: 0, aprobada: 0, rechazada: 0 }, solicitadas: [] }, 'órdenes de cambio');
    igual(p.libro, { ultimo_registro: null, dias_sin_registro: null, pendientes_aprobacion: 0 }, 'libro');
    igual(p.calidad_seguridad, { ensayos_fallidos_abiertos: 0, ensayos_fallidos_sin_reensayo: 0, incidentes_sst_abiertos: 0, solicitudes_pendientes: 0 }, 'calidad y seguridad');
    igual(p.documentos, { por_modulo: {}, contrato_cargado: false }, 'documentos (los módulos con cantidad 0 no se listan)');
    igual([p.avance.semaforo, p.avance.motivos], ['amarillo', ['sin cronograma']], 'semáforo: ningún pendiente de prueba cuenta');
    igual(estado.resumen.esperan_decision.filter(d => d.proyecto === 'ZZZ-PIL-2026-030'), [], 'nada suyo en «Esperan decisión» (la observación de prueba tiene 40 días; la orden de cambio, 30; la planilla, 20)');
    const s = seccionDe(md, 'ZZZ-PIL-2026-030');
    ['**Planillas.** ninguna emitida', '**Órdenes de cambio.** ninguna', '**Libro de obra.** sin registros', '**Observaciones.** 0 abiertas · 0 en proceso · 0 con antecedente',
      '**Calidad y seguridad.** 0 ensayos fallidos sin re-ensayo (0 fallidos abiertos) · 0 incidentes abiertos · 0 solicitudes pendientes', '**Documentos.** Contrato no cargado', '**Equipo.** sin miembros']
      .forEach(x => assert(s.split('\n').includes(x), 'falta en el .md del 030: ' + x));
    // 001: una usuaria de prueba entre sus miembros, una observación suya de 50 días y un archivo suyo: sus cifras no cambian.
    const uno = P('ZZZ-FIS-2026-001');
    igual([uno.equipo.map(x => x.nombre), uno.observaciones.abiertas, uno.observaciones.con_antecedente, uno.documentos.por_modulo.general], [['Ana Zzzperez', 'Luis Zzzmora'], 3, 1, 4], '001 sin lo de prueba');
    assert(!uno.avance.motivos.some(x => /8 pendientes/.test(x)) && uno.avance.motivos.includes('7 pendientes (libro, observaciones y solicitudes)'), 'los pendientes del semáforo tampoco la cuentan');
    // Ni los nombres ni los títulos de prueba llegan a la salida.
    assert(!/Prueba Uno|PRUEBA Dos|Zzzcorreo|Zzzresidente|Zzzfiscal|Observación de prueba|Orden de cambio de prueba/.test(texto + md), 'nombres o títulos de prueba en la salida');

    // Contraprueba: los mismos datos, si esos perfiles NO fueran de prueba, sí cuentan.
    const e = con(f => { f.perfiles.forEach(x => { x.es_prueba = false; }); });
    const q = PD(e, 'ZZZ-PIL-2026-030');
    igual([e.usuarios_de_prueba, q.equipo.map(x => x.nombre), q.observaciones.abiertas, q.calidad_seguridad], [0, ['PRUEBA Dos Zzzfiscal', 'Zoe Zzzcorreo', 'Prueba Uno Zzzresidente'], 1,
      { ensayos_fallidos_abiertos: 1, ensayos_fallidos_sin_reensayo: 1, incidentes_sst_abiertos: 1, solicitudes_pendientes: 1 }], 'sin la marca, todo cuenta');
    igual(e.resumen.esperan_decision.filter(d => d.proyecto === 'ZZZ-PIL-2026-030').map(d => [d.clase, d.dias]), [['observacion_antigua', 40], ['orden_cambio_solicitada', 30], ['planilla_en_revision', 20]], 'y espera decisión');
    igual([PD(e, 'ZZZ-FIS-2026-001').observaciones.abiertas, PD(e, 'ZZZ-FIS-2026-001').equipo.length], [4, 3], 'también en el 001');

    // D9: un finalizado cuyo ÚNICO pendiente lo creó un usuario de prueba no tiene pendientes: queda fuera (y no se lista).
    const idPrueba = f0.perfiles.find(x => x.nombre === 'Prueba Uno').id;
    const e10 = con(f => { f.observaciones.find(o => o.proyecto_id === proyectoDe(f, 'ZZZ-FIS-2024-010').id).creado_por = idPrueba; });
    igual([codigos(e10).includes('ZZZ-FIS-2024-010'), e10.proyectos_excluidos.cerrados_sin_pendientes, e10.excluidos_de_prueba.map(x => x.proyecto)], [false, 4, ['ZZZ-FIS-2026-001', 'ZZZ-PIL-2026-030']], 'finalizado con una observación de prueba');
    // Un autor nulo o un perfil que no existe no es de prueba.
    assert(P('ZZZ-FIS-2026-001').observaciones.abiertas === 3 && f0.observaciones.some(o => o.creado_por === null && o.estado === 'abierta'), 'la observación sin autor sigue contando');

    // Sin ningún usuario de prueba la cabecera lo dice.
    const limpio = con(f => { f.perfiles = f.perfiles.filter(x => !x.es_prueba); f.libro_obra.concat(f.archivos).forEach(x => { x.excluidos_prueba = 0; }); });
    igual([limpio.usuarios_de_prueba, limpio.excluidos_de_prueba], [0, []], 'sin usuarios de prueba');
    igual(estadoAMarkdown(limpio).split('\n')[3], 'Elementos de prueba — usuarios de prueba: 0; nada suyo que dejar fuera', '.md sin usuarios de prueba');
  });

  await prueba('compatibilidad con la función de datos ANTERIOR (migración 20261121, la aplicada): el generador vale igual, no excluye nada y lo dice en la cabecera', () => {
    const viejo = formaAnterior(fixture());
    // La forma derivada es la de la consulta anterior: las mismas claves y, tabla a tabla, las mismas columnas.
    const anterior = consultaAnterior();
    igual(Object.keys(viejo), TABLAS, 'claves de la forma anterior');
    TABLAS_FILA_A_FILA.forEach(tabla => igual(Object.keys(viejo[tabla][0]).sort(), columnasDe(anterior, tabla), 'columnas de ' + tabla + ' en la forma anterior'));
    igual([Object.keys(viejo.libro_obra[0]).sort(), Object.keys(viejo.archivos[0]).sort()], [['pendientes_aprobacion', 'proyecto_id', 'ultimo_registro'], ['cantidad', 'modulo', 'proyecto_id']], 'agregados de la forma anterior');
    assert(!/es_prueba|excluidos_prueba|created_by/.test(JSON.stringify(viejo)), 'la forma anterior no trae nada de la nueva');
    assert(desenvolver(viejo) === viejo, 'exportar.js la acepta tal cual');

    const e = construirEstado(viejo, OPCIONES), m = estadoAMarkdown(e);
    igual([e.formato, e.usuarios_de_prueba, e.excluidos_de_prueba], [3, null, []], 'formato 3, sin usuarios de prueba identificados y sin nada excluido');
    igual(e.bloques_fallidos, estado.bloques_fallidos, 'no falla ningún bloque de más');
    igual(m.split('\n')[3], 'Elementos de prueba — ' + NOTA_FUNCION_ANTERIOR + '; no se dejó nada fuera', 'la cabecera del .md lo dice');
    assert(m.toLowerCase().includes(NOTA_FUNCION_ANTERIOR), 'con el texto acordado');
    igual(codigos(e), INCLUIDOS, 'los mismos proyectos, en el mismo orden');
    igual(e.resumen.semaforo, SEMAFORO, 'y los mismos colores');
    // Como no se puede saber quién es de prueba, lo suyo SÍ sale.
    const q = PD(e, 'ZZZ-PIL-2026-030');
    igual(q.equipo, [{ nombre: 'PRUEBA Dos Zzzfiscal', rol: 'fiscalizador' }, { nombre: 'Zoe Zzzcorreo', rol: 'fiscalizador' }, { nombre: 'Prueba Uno Zzzresidente', rol: 'residente' }], 'equipo del 030 con la función anterior');
    igual([q.observaciones.abiertas, q.libro, q.documentos], [1, { ultimo_registro: '2026-11-20', dias_sin_registro: 1, pendientes_aprobacion: 1 }, { por_modulo: { contratos: 1, general: 3 }, contrato_cargado: true }], 'recuentos del 030 con la función anterior');
    igual(e.resumen.esperan_decision.filter(d => d.proyecto === 'ZZZ-PIL-2026-030').map(d => d.clase), ['observacion_antigua', 'orden_cambio_solicitada', 'planilla_en_revision'], 'y espera decisión');
    igual(PD(e, 'ZZZ-FIS-2026-001').avance.motivos, ['SPI 0,92', '1 garantía por vencer en 5 días o menos', '8 pendientes (libro, observaciones y solicitudes)'], 'el 001 cuenta también la observación de prueba');
    // Todo lo demás del formato 3 no depende de la función: plazo contractual, monto, planillas sin repetir, próximos y el .md.
    ['ZZZ-CON-2026-018', 'ZZZ-PUE-2026-029', 'ZZZ-PUE-2026-031', 'ZZZ-CON-2026-022', 'ZZZ-FIS-2024-009', 'ZZZ-GER-2026-026'].forEach(c => igual(PD(e, c), P(c), 'el mismo proyecto con las dos funciones: ' + c));
    assert(!RE_FUERA_BMP.test(m) && m.endsWith('\n— fin del archivo (26 proyectos) —\n') && !m.includes('atraso proyectado'), 'el .md con la función anterior');
    // Mezcla improbable (perfiles con la marca, tablas sin las columnas de autor): excluye lo que puede, sin fallar.
    const mezcla = fixture(); ['planillas_pago', 'ordenes_cambio', 'ensayos', 'solicitudes'].forEach(tabla => mezcla[tabla].forEach(x => { delete x.creado_por; }));
    const eM = construirEstado(mezcla, OPCIONES);
    igual([eM.bloques_fallidos, eM.usuarios_de_prueba, PD(eM, 'ZZZ-PIL-2026-030').equipo, PD(eM, 'ZZZ-PIL-2026-030').observaciones.abiertas, PD(eM, 'ZZZ-PIL-2026-030').planillas.en_revision.length], [estado.bloques_fallidos, 3, [], 0, 1], 'mezcla de formas');
  });

  await prueba('monto que no cuadra (decisión 11): vigente distinto del contractual más las órdenes de cambio aprobadas → «datos por completar»', () => {
    // 031: rubros por 56.000; contrato de 50.000 y una orden de cambio aprobada de 2.000: faltan 4.000 por explicar.
    const p = P('ZZZ-PUE-2026-031');
    igual([p.identidad.monto_contractual, p.identidad.monto_ordenes_cambio, p.identidad.monto_vigente], [50000, 2000, 56000], 'montos del 031');
    igual([p.avance.semaforo, p.avance.motivos, p.avance.datos_por_completar], ['verde', [], [MONTO_031]], 'aviso del núcleo (no cambia el color)');
    assert(seccionDe(md, 'ZZZ-PUE-2026-031').includes('\n⚠ Datos por completar: ' + MONTO_031 + '\nSemáforo verde\n'), '.md del 031');
    // El 001 cuadra (410.000 + 18.600 de dos órdenes aprobadas = 428.600): sin aviso. La solicitada y la rechazada no suman.
    igual([P('ZZZ-FIS-2026-001').identidad.monto_vigente, P('ZZZ-FIS-2026-001').avance.datos_por_completar], [428600, []], 'el 001 cuadra');
    // Tolerancia del núcleo: hasta 1,00 de diferencia no avisa.
    const con31 = monto => PD(con(f => { proyectoDe(f, 'ZZZ-PUE-2026-031').monto_contrato = monto; }), 'ZZZ-PUE-2026-031').avance.datos_por_completar;
    igual([con31(54000), con31(53999), con31(54001), con31(53998.99).length, con31(54001.01).length], [[], [], [], 1, 1], 'tolerancia de 1,00');
    // Solo cuentan las órdenes de cambio APROBADAS.
    const sinAprobar = con(f => { f.ordenes_cambio.find(o => o.proyecto_id === proyectoDe(f, 'ZZZ-PUE-2026-031').id).estado = 'solicitada'; });
    igual(PD(sinAprobar, 'ZZZ-PUE-2026-031').avance.datos_por_completar, ['el monto vigente ($ 56.000,00) no cuadra con el contractual más las órdenes de cambio aprobadas ($ 50.000,00): diferencia de $ 6.000,00'], 'la orden solicitada no suma');
    // Sin monto de contrato registrado, o sin rubros, no hay con qué comparar: sin aviso.
    igual([con31(null), P('ZZZ-PIL-2026-030').avance.datos_por_completar, P('ZZZ-MUR-2026-016').avance.datos_por_completar], [[], [], []], 'sin monto contractual o sin rubros');
    // Un monto mal formado lo anota la identidad; el avance se calcula sin esa comprobación.
    const malo = con(f => { proyectoDe(f, 'ZZZ-PUE-2026-031').monto_contrato = 'xx'; });
    igual([PD(malo, 'ZZZ-PUE-2026-031').avance.datos_por_completar, malo.bloques_fallidos.filter(x => x.proyecto === 'ZZZ-PUE-2026-031').map(x => x.bloque + ': ' + x.motivo)], [[], ['identidad: número inválido en proyectos.monto_contrato']], 'monto mal formado');
    // D9: un monto que no cuadra NO hace entrar a un finalizado sin pendientes.
    const e7 = con(f => { proyectoDe(f, 'ZZZ-FIS-2024-007').monto_contrato = 25000; });
    igual(codigos(e7).includes('ZZZ-FIS-2024-007'), false, 'finalizado sin pendientes cuyo monto no cuadra: sigue fuera');
    assert(!codigos(estado).includes('ZZZ-FIS-2024-007'), 'y con su monto cuadrado también');
  });

  await prueba('plazo contractual vencido (decisión 5): en ejecución y con avance menor al 100 % es motivo PROPIO de rojo; sin cronograma nunca sale verde', () => {
    // 029: contrato hasta el 10-nov. Cronograma del 1-sep al 31-dic (121 días): plan a hoy 81/121 = 66,94 %;
    // ganado 41.000 de 60.000 = 68,33 %; SPI 1,0208, sin atraso. El ÚNICO motivo de rojo es el plazo contractual.
    igual(P('ZZZ-PUE-2026-029').avance, { avance_pct: 68.33, valor_ganado_cronograma_pct: 68.33, ejecutado_cantidades_pct: 68.33, programado_pct: 66.94, spi: 1.0208, spi_texto: '1,02', atraso_fecha_dias: 0, atraso_proyectado_dias: 0,
      cronograma_vencido: false, fin_programado: '2026-12-31', plazo_contractual: plazo('2026-11-10', true), linea_base: 'LB-1', rubros_sin_cronograma: 0, semaforo: 'rojo',
      motivos: ['plazo contractual vencido el 2026-11-10 con 68,3 % de avance'], datos_por_completar: [PLANILLA_REPETIDA] }, 'rojo solo por el plazo contractual');
    const s = seccionDe(md, 'ZZZ-PUE-2026-029');
    assert(s.startsWith('## [ROJO] ZZZ-PUE-2026-029 — ZZZ Plazo contractual vencido\n') && s.includes('Fin contractual: 2026-11-10\n'), '.md: título e identidad');
    assert(s.includes('**Avance.** Avance (valor ganado) 68,3 % · programado 66,9 % (LB-1) · SPI 1,02 · sin atraso\nEjecutado por cantidades: 68,3 %\n⚠ Datos por completar: ' + PLANILLA_REPETIDA + '\nSemáforo rojo: plazo contractual vencido el 2026-11-10 con 68,3 % de avance\n'), '.md del 029: ' + s.split('\n').filter(x => /Avance|Semáforo/.test(x)).join(' / '));
    // El día del plazo todavía no está vencido; al día siguiente, sí. Sin fecha de fin no hay regla.
    const con29 = fecha => PD(con(f => { proyectoDe(f, 'ZZZ-PUE-2026-029').fecha_fin_planificada = fecha; }), 'ZZZ-PUE-2026-029').avance;
    igual([con29('2026-11-21').semaforo, con29('2026-11-21').plazo_contractual, con29('2026-11-20').semaforo, con29('2026-11-20').plazo_contractual, con29(null).semaforo, con29(null).plazo_contractual],
      ['verde', plazo('2026-11-21'), 'rojo', plazo('2026-11-20', true), 'verde', SIN_PLAZO], 'bordes del plazo');
    // Con el 100 % de avance el plazo vencido no es motivo (como el 019, verde con el plazo vencido el 31-oct).
    const alCien = PD(con(f => { f.rubros.find(r => r.proyecto_id === proyectoDe(f, 'ZZZ-PUE-2026-029').id && r.codigo === '1').estado = 'terminado'; }), 'ZZZ-PUE-2026-029').avance;
    igual([alCien.avance_pct, alCien.plazo_contractual, alCien.semaforo, alCien.motivos], [100, plazo('2026-11-10', true), 'verde', []], 'al 100 %: verde');
    igual([P('ZZZ-CON-2026-019').avance.plazo_contractual, P('ZZZ-CON-2026-019').avance.semaforo], [plazo('2026-10-31', true), 'verde'], 'el 019');
    // Fuera de ejecución el plazo vencido es solo un dato (025, pausado; 004, finalizado).
    igual([P('ZZZ-CON-2026-025').avance.plazo_contractual, P('ZZZ-CON-2026-025').avance.semaforo, P('ZZZ-FIS-2025-004').avance.plazo_contractual, P('ZZZ-FIS-2025-004').avance.semaforo], [plazo('2026-10-30', true), null, plazo('2025-12-20', true), null], 'fuera de ejecución');
    // En ejecución y SIN cronograma: nunca verde. Amarillo con el motivo «sin cronograma»…
    const sinCron = estado.proyectos.filter(x => x.identidad.estado === 'ejecucion' && x.avance.programado_pct === null);
    igual(sinCron.map(x => [x.identidad.codigo, x.avance.semaforo, x.avance.motivos]), [['ZZZ-CON-2026-022', 'amarillo', ['sin cronograma']], ['ZZZ-MUR-2026-016', 'amarillo', ['sin cronograma']], ['ZZZ-PIL-2026-030', 'amarillo', ['sin cronograma']]], 'los tres sin cronograma');
    assert(seccionDe(md, 'ZZZ-MUR-2026-016').includes('**Avance.** Avance (valor ganado) 0,0 % · sin cronograma\nEjecutado por cantidades: 0,0 %\nSemáforo amarillo: sin cronograma\n'), '.md del 016');
    // …o rojo si además venció el plazo con el avance por debajo del 100 % (022 con su rubro al 40 % y el plazo el 1-nov).
    const vencido22 = PD(con(f => { const p22 = proyectoDe(f, 'ZZZ-CON-2026-022'); p22.fecha_fin_planificada = '2026-11-01'; f.rubros.find(r => r.proyecto_id === p22.id).estado = 'trabajando'; }), 'ZZZ-CON-2026-022').avance;
    igual([vencido22.semaforo, vencido22.motivos], ['rojo', ['plazo contractual vencido el 2026-11-01 con 40,0 % de avance', 'sin cronograma']], 'sin cronograma y con el plazo vencido: rojo');
    estado.proyectos.forEach(x => assert(!(x.avance.semaforo === 'verde' && x.avance.programado_pct === null), 'verde sin cronograma: ' + x.identidad.codigo));
    // Una fecha de fin mal formada la anota la identidad; el avance se calcula sin esa regla.
    const mala = con(f => { proyectoDe(f, 'ZZZ-PUE-2026-029').fecha_fin_planificada = '10/11/2026'; });
    igual([PD(mala, 'ZZZ-PUE-2026-029').avance.semaforo, PD(mala, 'ZZZ-PUE-2026-029').avance.plazo_contractual, mala.bloques_fallidos.filter(x => x.proyecto === 'ZZZ-PUE-2026-029').map(x => x.bloque + ': ' + x.motivo)],
      ['verde', SIN_PLAZO, ['identidad: fecha inválida en proyectos.fecha_fin_planificada']], 'fecha de fin mal formada');
  });

  await prueba('.md (decisiones 8 y 9): etiquetas de texto en vez de círculos, ningún carácter fuera del plano básico de Unicode y línea final', () => {
    // Ni un solo carácter con código mayor que U+FFFF (ni sustitutos sueltos) en TODO el .md del fixture.
    assert(!RE_FUERA_BMP.test(md), 'el .md lleva algún carácter fuera del plano básico');
    for(const ch of md) assert(ch.codePointAt(0) <= 0xFFFF, 'carácter fuera del plano básico: U+' + ch.codePointAt(0).toString(16));
    assert(!Buffer.from(md, 'utf8').some(b => b >= 0xF0) && Buffer.from(md, 'utf8').toString('utf8') === md, 'en UTF-8 ningún carácter ocupa cuatro bytes y el texto es válido');
    // Los símbolos del plano básico sí se usan: acentos, ⚠, raya, comillas angulares, punto medio.
    ['⚠', '—', '«', '»', '·', 'á', 'é', 'í', 'ó', 'ú', 'ñ', 'º'].forEach(c => assert(md.includes(c), 'falta el símbolo ' + c));
    assert(!md.includes('⚪'), 'tampoco queda el círculo blanco');
    const titulos = md.split('\n').filter(x => x.startsWith('## ') && x !== '## Resumen');
    titulos.forEach(x => assert(/^## \[(ROJO|AMARILLO|VERDE|SIN SEMÁFORO)\] ZZZ-[A-Z]{3}-\d{4}-\d{3} — /.test(x), 'título sin etiqueta: ' + x));
    const cuenta = etiqueta => titulos.filter(x => x.startsWith('## [' + etiqueta + '] ')).length;
    igual([cuenta('ROJO'), cuenta('AMARILLO'), cuenta('VERDE'), cuenta('SIN SEMÁFORO')], [5, 4, 4, 13], 'etiquetas de los títulos, como el resumen');
    igual(estado.proyectos.map(x => x.avance.semaforo), titulos.map(x => ({ ROJO: 'rojo', AMARILLO: 'amarillo', VERDE: 'verde' })[/^## \[([^\]]+)\]/.exec(x)[1]] || null), 'cada título lleva el color de su proyecto');
    // Línea final fija, para que el lector compruebe que el archivo no le llegó cortado.
    igual(md.split('\n').slice(-3), ['', '— fin del archivo (26 proyectos) —', ''], 'últimas líneas');
    const soloUno = estadoAMarkdown(con(f => { f.proyectos = f.proyectos.filter(x => x.codigo === 'ZZZ-FIS-2026-001'); }));
    assert(soloUno.endsWith('\n\n— fin del archivo (1 proyecto) —\n'), 'en singular');
    // Sin atraso proyectado en ninguna línea (decisión 8).
    assert(!md.includes('proyectado'), 'el .md no habla de atraso proyectado');
    // Un emoji, otro carácter de fuera del plano básico o un sustituto suelto en un texto de la base no llegan al .md
    // (el .json conserva el texto tal cual, menos el sustituto suelto, que JSON escapa).
    const e = con(f => { const p = proyectoDe(f, 'ZZZ-FIS-2026-001'); p.nombre = 'ZZZ Edificio \u{1F3D7} de ejemplo \u{1F534}'; p.descripcion = 'ZZZ texto con \u{1D4B3} y un sustituto suelto \uD83D aquí.';
      f.observaciones.find(o => o.numero === 12).titulo = 'ZZZ Curado \u{1F7E1} deficiente'; });
    const m = estadoAMarkdown(e);
    assert(!RE_FUERA_BMP.test(m), 'un texto con emoji dejó caracteres fuera del plano básico en el .md');
    assert(m.includes('## [AMARILLO] ZZZ-FIS-2026-001 — ZZZ Edificio de ejemplo\n') && m.includes('Descripción: ZZZ texto con y un sustituto suelto aquí.\n'), 'título y descripción sin el emoji y sin huecos dobles');
    assert(m.includes('| Observación sin resolver | ZZZ-FIS-2026-001 | Observación n.º 12 «ZZZ Curado deficiente», creada por Ana Zzzperez |') && m.includes('n.º 12 «ZZZ Curado deficiente» (34 días'), 'también en la tabla y en las listas');
    igual(PD(e, 'ZZZ-FIS-2026-001').identidad.nombre, 'ZZZ Edificio \u{1F3D7} de ejemplo \u{1F534}', 'el .json no se toca');
  });

  await prueba('consulta.sql: una clave por tabla exigida, columnas de autor, marca de usuarios de prueba sin sacar el correo, y nada de lo anterior quitado', () => {
    const sql = fs.readFileSync(path.join(RAIZ, 'exportacion', 'consulta.sql'), 'utf8');
    const codigoSql = sinComentarios(sql);
    const claves = [...codigoSql.matchAll(/^  '([a-z_0-9]+)', \(/gm)].map(m => m[1]);
    igual(claves, TABLAS, 'las claves de la consulta son las tablas que exige exportar.js, en el mismo orden');
    igual(Object.keys(fixture()), TABLAS, 'y las del fixture');
    assert(!/proyecto_emisor_historial/.test(sql) && !TABLAS.includes('proyecto_emisor_historial'), 'proyecto_emisor_historial ya no se consulta ni se exige');
    assert(!/\bes_gestora\b|\bgravedad\b|\bregistros\b|\bmonto,|\bcorreo\b|\btelefono\b|\bcedula\b/.test(codigoSql), 'sin columnas que el generador no usa ni datos personales');
    const bloque = nombre => bloqueSql(codigoSql, nombre);
    assert(/json_agg\(t order by t\.proyecto_id, t\.rubro_id, t\.created_at, t\.id\)/.test(bloque('cronograma_rubros')), 'cronograma_rubros: por proyecto, rubro, fecha de creación e id');
    ['id', 'proyecto_id', 'rubro_id', 'linea_base_id', 'fecha_inicio', 'fecha_fin', 'created_at'].forEach(c => assert(new RegExp('\\b' + c + '\\b').test(bloque('cronograma_rubros').split('select')[2]), 'cronograma_rubros trae ' + c));
    assert(/json_agg\(t order by t\.proyecto_id, t\.numero/.test(bloque('lineas_base')), 'lineas_base: por proyecto y número');
    assert(!/\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i.test(codigoSql), 'solo lectura');
    // Se incrusta tal cual como cuerpo de public.exportacion_estado_datos(): una sola sentencia
    // SELECT con la columna «datos», un único punto y coma (el final), sin comandos de psql, sin
    // signo de dólar ni comentarios de bloque, y con todas las tablas calificadas con public.
    igual((sql.match(/;/g) || []).length, 1, 'un único punto y coma en todo el archivo (comentarios incluidos)');
    assert(/^select json_build_object\(/.test(codigoSql.trim()) && /\) prueba;$/.test(codigoSql.trim()), 'empieza por select y termina en la subconsulta «prueba»');
    assert(!/^\s*\\/m.test(sql) && !sql.includes('$') && !sql.includes('/*') && !sql.includes('*/'), 'sin comandos de psql, dólares ni comentarios de bloque');
    const sinFinal = codigoSql.trim().replace(/;$/, '');
    igual([(sinFinal.match(/\(/g) || []).length - (sinFinal.match(/\)/g) || []).length, (sinFinal.match(/'/g) || []).length % 2], [0, 0], 'paréntesis y comillas equilibrados: vale dentro de «select ( … )»');
    // Cada tabla se lee una vez; perfiles, una segunda al pie: la subconsulta «prueba», donde está escrita la regla.
    const tablasLeidas = [...codigoSql.matchAll(/\bfrom\s+([a-z_.]+)/g)].map(m => m[1]).filter(x => x !== '(');
    igual(tablasLeidas, TABLAS.map(x => 'public.' + x).concat(['public.perfiles']), 'cada tabla se lee una vez y calificada con public. (más la lectura de perfiles de la regla de prueba)');
    assert(!/\b(latitud|longitud)\b/.test(sql), 'D8: sin coordenadas');
    assert(/\bdescripcion\b/.test(bloque('proyectos')) && /\bubicacion\b/.test(bloque('proyectos')) && /\bestado\b/.test(bloque('proyectos')), 'proyectos trae descripción, ubicación y estado');

    // Decisión 10. La regla de «usuario de prueba» está escrita UNA vez, al pie: nombre que empieza por «Prueba» (sin
    // distinguir mayúsculas) o correo con «+» antes de la arroba. Devuelve una fila con el arreglo de sus id.
    const pie = codigoSql.slice(codigoSql.lastIndexOf(') as datos'));
    assert(/^\) as datos\s+from \(\s+select coalesce\(array_agg\(id\), '\{\}'::uuid\[\]\) as ids\s+from public\.perfiles\s+where btrim\(nombre\) ilike 'prueba%'\s+or position\('\+' in split_part\(coalesce\(email, ''\), '@', 1\)\) > 0\s+\) prueba;\s*$/.test(pie), 'pie de la consulta: ' + pie);
    // El correo solo se LEE ahí: no está en ninguna lista de columnas ni sale de la base.
    igual([(codigoSql.match(/\bemail\b/g) || []).length, codigoSql.indexOf('email') > codigoSql.lastIndexOf(') as datos')], [1, true], 'el correo aparece una sola vez, en la regla del pie');
    igual(columnasDe(codigoSql, 'perfiles'), ['apellido', 'es_prueba', 'id', 'nombre'], 'de cada perfil sale el booleano es_prueba, no el correo');
    assert(/\(id = any\(prueba\.ids\)\) as es_prueba/.test(bloque('perfiles')), 'es_prueba sale de la regla del pie');
    // Columnas de autor de las tablas que el generador filtra.
    [['observaciones', 'creado_por'], ['solicitudes', 'creado_por'], ['ordenes_cambio', 'creado_por'], ['planillas_pago', 'creado_por'], ['ensayos', 'creado_por'], ['sst_incidentes', 'created_by']]
      .forEach(([tabla, columna]) => assert(new RegExp('\\b' + columna + '\\b').test(bloque(tabla).split('select')[2].split(/\bfrom\b/)[0]), tabla + ' no trae ' + columna));
    // Los dos agregados ya descuentan lo de prueba y dicen aparte cuánto dejaron fuera (un autor nulo NO es de prueba).
    const libro = bloque('libro_obra'), arch = bloque('archivos'), REAL = c => 'not coalesce(' + c + ' = any(prueba.ids), false)', PRUEBA = c => 'filter (where coalesce(' + c + ' = any(prueba.ids), false)) as excluidos_prueba';
    assert(libro.includes('max(fecha) filter (where ' + REAL('created_by') + ') as ultimo_registro') && libro.includes("count(*) filter (where estado_aprobacion = 'pendiente' and " + REAL('created_by') + ') as pendientes_aprobacion') && libro.includes('count(*) ' + PRUEBA('created_by')), 'libro_obra: ' + libro);
    assert(arch.includes('count(*) filter (where ' + REAL('subido_por') + ') as cantidad') && arch.includes('count(*) ' + PRUEBA('subido_por')), 'archivos: ' + arch);
    const f = fixture();
    igual([Object.keys(f.libro_obra[0]).sort(), Object.keys(f.archivos[0]).sort()], [['excluidos_prueba', 'pendientes_aprobacion', 'proyecto_id', 'ultimo_registro'], ['cantidad', 'excluidos_prueba', 'modulo', 'proyecto_id']], 'agregados del fixture');
    // Las columnas del fixture son exactamente las de la consulta (para las tablas sin agregados).
    TABLAS_FILA_A_FILA.forEach(tabla => igual(Object.keys(f[tabla][0]).sort(), columnasDe(codigoSql, tabla), 'columnas de ' + tabla));
    igual(Object.keys(f.observaciones[0]).sort(), ['con_antecedente', 'creado_por', 'created_at', 'estado', 'numero', 'proyecto_id', 'titulo'], 'columnas de observaciones (fixture)');

    // COMPATIBILIDAD: frente a la consulta anterior (el cuerpo de la función en la migración 20261121) no se quita
    // ninguna clave ni ninguna columna; solo se añade.
    const anterior = consultaAnterior();
    igual([...anterior.matchAll(/^  '([a-z_0-9]+)', \(/gm)].map(m => m[1]), claves, 'las mismas claves que la consulta anterior');
    const nuevas = {};
    TABLAS_FILA_A_FILA.forEach(tabla => {
      const antes = columnasDe(anterior, tabla), ahora = columnasDe(codigoSql, tabla);
      antes.forEach(c => assert(ahora.includes(c), `la consulta nueva ya no trae ${tabla}.${c}`));
      const mas = ahora.filter(c => !antes.includes(c));
      if(mas.length) nuevas[tabla] = mas;
    });
    igual(nuevas, { planillas_pago: ['creado_por'], ordenes_cambio: ['creado_por'], ensayos: ['creado_por'], sst_incidentes: ['created_by'], solicitudes: ['creado_por'], perfiles: ['es_prueba'] }, 'lo único nuevo en las tablas fila a fila');
    ['ultimo_registro', 'pendientes_aprobacion'].forEach(c => assert(bloqueSql(anterior, 'libro_obra').includes(' as ' + c) && libro.includes(' as ' + c), 'libro_obra conserva ' + c));
    assert(bloqueSql(anterior, 'archivos').includes(' as cantidad') && arch.includes(' as cantidad') && /select proyecto_id, modulo,/.test(arch), 'archivos conserva proyecto, módulo y cantidad');
    assert(bloqueSql(anterior, 'observaciones').split('select')[2] === bloque('observaciones').split('select')[2], 'observaciones no cambia');
  });

  await prueba('exportar.js: acepta las cuatro envolturas del JSON de entrada', () => {
    const f = fixture();
    [f, { datos: f }, [{ datos: f }], { rows: [{ datos: f }] }, [{ datos: JSON.stringify(f) }]].forEach((x, i) => igual(desenvolver(x).proyectos.length, 32, 'envoltura ' + i));
    [{}, [], [{ datos: f }, { datos: f }], { datos: { proyectos: [] } }, 'x', null].forEach((x, i) => {
      let fallo = false; try{ desenvolver(x); }catch(e){ fallo = true; }
      assert(fallo, 'la entrada mala ' + i + ' debe rechazarse');
    });
    // Un JSON de consulta antigua (con la tabla que ya no se pide) sigue valiendo: la clave de más se ignora.
    igual(desenvolver({ ...f, proyecto_emisor_historial: [] }).proyectos.length, 32, 'clave de más');
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
      igual([r.status, lineas(r)], [3, ['Estado válido para 2026-11-21: 26 proyectos de 32, 1 bloques fallidos', 'RESULTADO proyectos=26 fallidos=1 resumen=ok']], 'corrida degradada');
      igual(fs.readdirSync(salida).sort(), ['GDO-estado-proyectos.json', 'GDO-estado-proyectos.md'], 'los dos archivos y ningún provisional');
      const escrito = JSON.parse(fs.readFileSync(path.join(salida, 'GDO-estado-proyectos.json'), 'utf8'));
      const sw = fs.readFileSync(path.join(RAIZ, 'service-worker.js'), 'utf8').split(/\r?\n/)[0];
      assert(/^hidivo-v\d+$/.test(escrito.version_app) && sw.includes(`'${escrito.version_app}'`), 'la versión sale de service-worker.js: ' + escrito.version_app);
      igual({ ...escrito, version_app: 'hidivo-vZZ' }, estado, 'el .json escrito es el estado');
      igual(escrito.formato, 3, 'formato 3 en el archivo');
      const mdEscrito = fs.readFileSync(path.join(salida, 'GDO-estado-proyectos.md'));
      igual(mdEscrito.toString('utf8'), estadoAMarkdown(escrito), 'el .md escrito');
      // El archivo en disco es UTF-8 válido (decodificarlo y volver a codificarlo da los mismos bytes), sin BOM y sin ningún
      // carácter de cuatro bytes (los de fuera del plano básico, como los círculos de color).
      assert(Buffer.from(mdEscrito.toString('utf8'), 'utf8').equals(mdEscrito) && !mdEscrito.toString('utf8').includes('\uFFFD') && mdEscrito[0] !== 0xEF, 'el .md escrito no es UTF-8 limpio');
      assert(!mdEscrito.some(b => b >= 0xF0), 'el .md escrito lleva algún carácter de cuatro bytes (fuera del plano básico)');
      assert(mdEscrito.toString('utf8').endsWith('\n— fin del archivo (26 proyectos) —\n'), 'el .md escrito termina con la línea final');
      igual(correr(envuelto, salida, '--ahora', AHORA, '--version-app', 'hidivo-vXX').status, 3, 'con --version-app');
      igual(JSON.parse(fs.readFileSync(path.join(salida, 'GDO-estado-proyectos.json'), 'utf8')).version_app, 'hidivo-vXX', '--version-app manda');

      // 0: sin el dato corrupto no hay bloques fallidos.
      const limpio = sanear(fixture());
      const rutaLimpia = path.join(tmp, 'limpio.json'); fs.writeFileSync(rutaLimpia, JSON.stringify(limpio));
      const salidaLimpia = path.join(tmp, 'salida-limpia');
      const r0 = correr(rutaLimpia, salidaLimpia, '--ahora', AHORA);
      igual([r0.status, lineas(r0), r0.stderr], [0, ['Estado válido para 2026-11-21: 26 proyectos de 32, 0 bloques fallidos', 'RESULTADO proyectos=26 fallidos=0 resumen=ok'], ''], 'corrida buena');
      igual(fs.readdirSync(salidaLimpia).sort(), ['GDO-estado-proyectos.json', 'GDO-estado-proyectos.md'], 'archivos de la corrida buena');

      // 3 también cuando lo que falta es una empresa del catálogo (el resumen sigue completo).
      const sinEmpresa = fixture(); sinEmpresa.empresas = sinEmpresa.empresas.filter(x => x.sigla !== 'ZZE'); sinEmpresa.planillas_pago = limpio.planillas_pago;
      const rutaSinEmpresa = path.join(tmp, 'sin-empresa.json'); fs.writeFileSync(rutaSinEmpresa, JSON.stringify(sinEmpresa));
      const r3 = correr(rutaSinEmpresa, path.join(tmp, 'salida-sin-empresa'), '--ahora', AHORA);
      igual([r3.status, lineas(r3)[1]], [3, 'RESULTADO proyectos=26 fallidos=2 resumen=ok'], 'empresa ausente: degradada');
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
