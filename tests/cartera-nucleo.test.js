// Núcleo de indicadores de cartera (cartera-nucleo.js): avance principal (valor ganado) y ejecutado
// por cantidades, plan a una fecha, SPI, atraso a la fecha y atraso proyectado, plazo contractual
// vencido, «datos por completar» (también el monto vigente frente al contractual más las órdenes de
// cambio), garantías y semáforo (solo proyectos en ejecución; sin cronograma nunca verde). Carga el módulo REAL con require y prueba cada función con datos
// sintéticos (ningún dato de producción).
//
//   node cartera-nucleo.test.js
'use strict';
const path = require('path');
const { RAIZ, prueba, resumen, assert } = require('./lib/arnes');
const N = require(path.join(RAIZ, 'cartera-nucleo.js'));
const { NUCLEO_CARTERA, nucleoHoyEcuador, nucleoMsDeFecha, nucleoSumarDias, nucleoDiasEntre, nucleoLineaBaseActiva, nucleoFilasCronograma,
  nucleoFraccionPlan, nucleoAvanceRubro, nucleoEvmProyecto, nucleoDatosPorCompletar, nucleoGarantias, nucleoSpiTruncado, nucleoSemaforo } = N;

const cerca = (a, b, eps = 1e-9) => typeof a === 'number' && Math.abs(a - b) <= eps;
function igual(real, esperado, que){
  assert(real === esperado, `${que}: se esperaba ${JSON.stringify(esperado)} y salió ${JSON.stringify(real)}`);
}
function casi(real, esperado, que){
  assert(cerca(real, esperado), `${que}: se esperaba ≈${esperado} y salió ${real}`);
}

// La función debe lanzar un Error (y, si se da, su mensaje debe cumplir el patrón).
function lanza(fn, que, patron){
  let error = null;
  try{ fn(); }catch(e){ error = e; }
  assert(error instanceof Error, `${que}: debía lanzar y no lanzó`);
  if(patron) assert(patron.test(error.message), `${que}: mensaje inesperado «${error.message}»`);
}

// Rubro y fila de cronograma sintéticos. Los estados de rubro son los de la base
// (CHECK rubros_estado_check): planificado, trabajando, terminado, suspendido.
const rubro = (id, monto, prod, estado = 'trabajando') => ({ id, proyecto_id: 'zzz-p', monto_contrato: monto, total_produccion: prod, estado });
const fila = (rubroId, ini, fin, lb = 'zzz-lb') => ({ proyecto_id: 'zzz-p', rubro_id: rubroId, fecha_inicio: ini, fecha_fin: fin, linea_base_id: lb });
// EVM «a mano» para probar el semáforo sin pasar por el cálculo
const evmDe = (extra = {}) => ({ spi: 1, spiValido: true, atrasoFechaDias: 0, atrasoDias: 0, atrasoProyectadoDias: 0, evPct: 50, planFinalPct: 100, rubros: 1,
  cronogramaVencido: false, obraProgramadaTerminada: false, sinCronograma: false, sinLineaBase: false, ...extra });
// Generador pseudoaleatorio de semilla fija (mulberry32): las pruebas de propiedades son repetibles
function azar(semilla){
  let a = semilla >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Semáforo de un proyecto EN EJECUCIÓN (el único estado que lleva color)
const semEjec = datos => nucleoSemaforo({ estado: 'ejecucion', ...datos });
const SIN_COLOR = ['planificacion', 'pausado', 'finalizado', 'cancelado'];
// Conteo de garantías «a mano», con el aviso oficial (el único que admite el semáforo)
const G = (vencidas, porVencer) => ({ vencidas, porVencer, diasAviso: NUCLEO_CARTERA.GARANTIA_AVISO_DIAS });
const SIN_GAR = G(0, 0);

(async () => {
  console.log('cartera-nucleo.test.js');

  // ── Constantes y exportación ──────────────────────────────────────────────
  await prueba('constantes: umbrales decididos, zona de Ecuador y objeto congelado', () => {
    igual(NUCLEO_CARTERA.SPI_ROJO, 0.85, 'SPI_ROJO');
    igual(NUCLEO_CARTERA.SPI_AMARILLO, 0.95, 'SPI_AMARILLO');
    igual(NUCLEO_CARTERA.ATRASO_ROJO_DIAS, 30, 'ATRASO_ROJO_DIAS');
    igual(NUCLEO_CARTERA.PENDIENTES_AMARILLO, 5, 'PENDIENTES_AMARILLO');
    igual(NUCLEO_CARTERA.GARANTIA_AVISO_DIAS, 5, 'GARANTIA_AVISO_DIAS');
    igual(NUCLEO_CARTERA.PLAN_MINIMO_PCT, 0.5, 'PLAN_MINIMO_PCT');
    igual(NUCLEO_CARTERA.DIFERENCIA_AVANCE_PUNTOS, 10, 'DIFERENCIA_AVANCE_PUNTOS');
    igual(NUCLEO_CARTERA.OBRA_TERMINADA_PCT, 99.95, 'OBRA_TERMINADA_PCT');
    igual(NUCLEO_CARTERA.SPI_MINIMO_PROYECCION, 0.10, 'SPI_MINIMO_PROYECCION');
    igual(NUCLEO_CARTERA.TOLERANCIA_MONTO, 1, 'TOLERANCIA_MONTO');
    igual(NUCLEO_CARTERA.ESTADO_CON_SEMAFORO, 'ejecucion', 'ESTADO_CON_SEMAFORO');
    igual(NUCLEO_CARTERA.ZONA, 'America/Guayaquil', 'ZONA');
    assert(Object.isFrozen(NUCLEO_CARTERA), 'NUCLEO_CARTERA está congelado');
  });

  await prueba('el módulo exporta las catorce piezas y solo esas', () => {
    const esperadas = ['NUCLEO_CARTERA', 'nucleoAvanceRubro', 'nucleoDatosPorCompletar', 'nucleoDiasEntre', 'nucleoEvmProyecto', 'nucleoFilasCronograma', 'nucleoFraccionPlan',
      'nucleoGarantias', 'nucleoHoyEcuador', 'nucleoLineaBaseActiva', 'nucleoMsDeFecha', 'nucleoSemaforo', 'nucleoSpiTruncado', 'nucleoSumarDias'];
    igual(Object.keys(N).sort().join(','), esperadas.join(','), 'exportaciones');
  });

  await prueba('sin «module» (Deno, import por su efecto) las mismas piezas quedan en globalThis', () => {
    const fuente = require('fs').readFileSync(path.join(RAIZ, 'cartera-nucleo.js'), 'utf8');
    const nombres = Object.keys(N);
    // require ya las dejó en globalThis: se comprueba, se borran y se vuelve a cargar SIN module
    for(const n of nombres) assert(globalThis[n] === N[n], 'tras require, globalThis.' + n + ' es la misma pieza');
    for(const n of nombres) delete globalThis[n];
    new Function(fuente)();          // dentro de una función no existe `module`: como un módulo de Deno
    for(const n of nombres) igual(typeof globalThis[n], typeof N[n], 'globalThis.' + n);
    igual(globalThis.NUCLEO_CARTERA.SPI_ROJO, NUCLEO_CARTERA.SPI_ROJO, 'constantes en globalThis');
    igual(globalThis.nucleoLineaBaseActiva([{ id: 'zzz-a', numero: 1, activa: true }]).id, 'zzz-a', 'la pieza de globalThis funciona');
    assert(/globalThis/.test(fuente.split('\n').filter(l => l.startsWith('//')).slice(0, 20).join('\n')), 'la cabecera dice que se asigna a globalThis');
    for(const n of nombres) globalThis[n] = N[n];
  });

  // ── Fechas ────────────────────────────────────────────────────────────────
  await prueba('nucleoHoyEcuador: cerca de la medianoche UTC sigue siendo el día anterior en Ecuador', () => {
    igual(nucleoHoyEcuador(0, '2026-11-21T00:30:00Z'), '2026-11-20', '00:30 UTC del 21 = 19:30 del 20 en Ecuador');
    igual(nucleoHoyEcuador(0, '2026-11-20T23:59:59Z'), '2026-11-20', '23:59 UTC del 20');
    igual(nucleoHoyEcuador(0, '2026-11-21T04:59:59Z'), '2026-11-20', 'un segundo antes de la medianoche de Ecuador');
    igual(nucleoHoyEcuador(0, '2026-11-21T05:00:00Z'), '2026-11-21', 'medianoche de Ecuador (05:00 UTC)');
    igual(nucleoHoyEcuador(0, '2027-01-01T03:00:00Z'), '2026-12-31', 'cambio de año: en Ecuador todavía es 31 de diciembre');
  });

  await prueba('nucleoHoyEcuador: desplazamiento en días, instante como Date o número, y sin instante', () => {
    igual(nucleoHoyEcuador(1, '2026-11-21T00:30:00Z'), '2026-11-21', '+1 día');
    igual(nucleoHoyEcuador(-1, '2026-11-21T00:30:00Z'), '2026-11-19', '−1 día');
    igual(nucleoHoyEcuador(5, '2026-11-28T12:00:00Z'), '2026-12-03', '+5 días cruza el mes');
    igual(nucleoHoyEcuador(undefined, new Date('2026-11-21T00:30:00Z')), '2026-11-20', 'instante como Date');
    igual(nucleoHoyEcuador(0, Date.UTC(2026, 10, 21, 0, 30)), '2026-11-20', 'instante en milisegundos');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(nucleoHoyEcuador()), 'sin argumentos devuelve AAAA-MM-DD');
    igual(nucleoHoyEcuador(), nucleoHoyEcuador(0, Date.now()), 'sin instante usa el reloj');
  });

  await prueba('nucleoMsDeFecha, nucleoSumarDias y nucleoDiasEntre: días civiles, sin zona', () => {
    igual(nucleoMsDeFecha('2026-01-01'), Date.UTC(2026, 0, 1), 'ms de una fecha');
    igual(nucleoMsDeFecha('2026-01-01T23:59:00-05:00'), Date.UTC(2026, 0, 1), 'solo cuentan los 10 primeros caracteres');
    igual(nucleoSumarDias('2026-11-21', 5), '2026-11-26', '+5');
    igual(nucleoSumarDias('2026-11-28', 5), '2026-12-03', 'cruza el mes');
    igual(nucleoSumarDias('2026-12-31', 1), '2027-01-01', 'cruza el año');
    igual(nucleoSumarDias('2028-02-28', 1), '2028-02-29', 'año bisiesto');
    igual(nucleoSumarDias('2026-03-01', -1), '2026-02-28', 'días negativos');
    igual(nucleoSumarDias('2026-11-21', 0), '2026-11-21', '+0');
    igual(nucleoDiasEntre('2026-01-01', '2026-01-31'), 30, 'hacia adelante');
    igual(nucleoDiasEntre('2026-01-31', '2026-01-01'), -30, 'hacia atrás es negativo');
    igual(nucleoDiasEntre('2026-05-05', '2026-05-05'), 0, 'mismo día');
    igual(nucleoDiasEntre('2026-01-01', '2027-01-01'), 365, 'un año');
  });

  await prueba('fechas: lo que no es un texto AAAA-MM-DD con fecha existente LANZA (no hay verde por error)', () => {
    igual(nucleoMsDeFecha('2028-02-29'), Date.UTC(2028, 1, 29), '29 de febrero de año bisiesto');
    igual(nucleoMsDeFecha('2026-11-21T10:00'), Date.UTC(2026, 10, 21), 'con hora: los 10 primeros caracteres');
    const malas = { 'undefined': undefined, 'null': null, 'texto vacío': '', 'Date': new Date('2026-11-21T00:00:00Z'), 'número (ms)': Date.UTC(2026, 10, 21),
      'dd/mm/aaaa': '21/11/2026', 'aaaa/mm/dd': '2026/11/21', '30 de febrero': '2026-02-30', '29-feb de año no bisiesto': '2026-02-29',
      'mes 13': '2026-13-01', 'día 00': '2026-11-00', 'sin ceros': '2026-1-5', 'con espacio delante': ' 2026-11-21', 'un objeto': { fecha: '2026-11-21' } };
    for(const [que, v] of Object.entries(malas)){
      lanza(() => nucleoMsDeFecha(v), 'nucleoMsDeFecha: ' + que, /^Fecha (no válida|inexistente)/);
      lanza(() => nucleoSumarDias(v, 1), 'nucleoSumarDias: ' + que);
      lanza(() => nucleoDiasEntre(v, '2026-01-01'), 'nucleoDiasEntre (desde): ' + que);
      lanza(() => nucleoDiasEntre('2026-01-01', v), 'nucleoDiasEntre (hasta): ' + que);
      lanza(() => nucleoFraccionPlan('2026-01-01', '2026-01-11', v), 'nucleoFraccionPlan (hoy): ' + que);
      lanza(() => nucleoFraccionPlan(v, '2026-01-11', '2026-01-05'), 'nucleoFraccionPlan (inicio): ' + que);
    }
  });

  await prueba('EVM y garantías exigen «hoy» válido, también con la cartera vacía', () => {
    const datos = { rubros: [rubro('r1', 1000, 500)], cronograma: [fila('r1', '2026-01-01', '2026-01-11')], lineaBaseActivaId: 'zzz-lb' };
    for(const [que, hoy] of Object.entries({ 'sin hoy': undefined, 'null': null, 'Date': new Date(), 'dd/mm/aaaa': '21/11/2026', '30-feb': '2026-02-30', 'vacío': '' })){
      lanza(() => nucleoEvmProyecto({ ...datos, hoy }), 'EVM con datos, hoy ' + que, /^Fecha/);
      lanza(() => nucleoEvmProyecto({ rubros: [], cronograma: [], lineaBaseActivaId: null, hoy }), 'EVM sin datos, hoy ' + que, /^Fecha/);
      lanza(() => nucleoGarantias([{ estado: 'vigente', vigencia_hasta: '2026-11-20' }], hoy), 'garantías con datos, hoy ' + que, /^Fecha/);
      lanza(() => nucleoGarantias([], hoy), 'garantías sin datos, hoy ' + que, /^Fecha/);
    }
    lanza(() => nucleoEvmProyecto({}), 'EVM con objeto vacío');
    lanza(() => nucleoEvmProyecto(), 'EVM sin argumentos');
    lanza(() => nucleoGarantias(), 'garantías sin argumentos');
    // «hoy» con hora vale, y cuenta solo el día
    igual(nucleoEvmProyecto({ ...datos, hoy: '2026-01-06T23:59:59-05:00' }).planPct, nucleoEvmProyecto({ ...datos, hoy: '2026-01-06' }).planPct, 'hoy con hora');
  });

  await prueba('EVM y garantías: una fecha de fila mal formada LANZA en vez de dar un proyecto verde sin SPI', () => {
    const con = (ini, fin) => () => nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 0)], cronograma: [fila('r1', ini, fin)], lineaBaseActivaId: 'zzz-lb', hoy: '2026-06-01' });
    lanza(con(new Date('2026-01-01T00:00:00Z'), '2026-01-11'), 'inicio como Date (driver de Postgres)', /^Fecha no válida/);
    lanza(con('2026-01-01', new Date('2026-01-11T00:00:00Z')), 'fin como Date', /^Fecha no válida/);
    lanza(con('01/01/2026', '2026-01-11'), 'inicio dd/mm/aaaa', /^Fecha no válida/);
    lanza(con('2026-01-01', '2026-02-30'), 'fin inexistente', /^Fecha inexistente/);
    // La fila mala de un rubro AJENO o de otra línea base no se evalúa: no cuenta para el proyecto
    igual(nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 0)], cronograma: [fila('zzz-ajeno', 'mala', 'peor')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-06-01' }).sinCronograma, true, 'fila de rubro ajeno');
    // Fechas con hora (timestamp como texto): valen y se guardan como día
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 500)], cronograma: [fila('r1', '2026-01-01T00:00:00+00:00', '2026-01-11T00:00:00+00:00')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-06' });
    casi(e.planPct, 50, 'plan con fechas con hora'); igual(e.primerInicio, '2026-01-01', 'primerInicio como día'); igual(e.ultimoFin, '2026-01-11', 'ultimoFin como día');
    const g = v => () => nucleoGarantias([{ estado: 'vigente', vigencia_hasta: v }], '2026-11-21');
    lanza(g(new Date('2026-11-20T00:00:00Z')), 'vigencia como Date', /^Fecha no válida/);
    lanza(g('20/11/2026'), 'vigencia dd/mm/aaaa', /^Fecha no válida/);
    lanza(g('2026-02-30'), 'vigencia inexistente', /^Fecha inexistente/);
    // La de una garantía que no está vigente no se mira
    igual(nucleoGarantias([{ estado: 'devuelta', vigencia_hasta: 'mala' }], '2026-11-21').vencidas, 0, 'garantía no vigente con fecha mala');
  });

  // ── Línea base activa ─────────────────────────────────────────────────────
  await prueba('nucleoLineaBaseActiva: la activa; con dos activas, la de mayor número en cualquier orden; sin activa, null', () => {
    const lb = (id, numero, activa) => ({ id, proyecto_id: 'zzz-p', numero, activa });
    igual(nucleoLineaBaseActiva(null), null, 'null'); igual(nucleoLineaBaseActiva(undefined), null, 'undefined'); igual(nucleoLineaBaseActiva([]), null, 'lista vacía');
    igual(nucleoLineaBaseActiva([lb('zzz-1', 1, false), lb('zzz-2', 2, false)]), null, 'ninguna activa');
    igual(nucleoLineaBaseActiva([lb('zzz-1', 1, false), lb('zzz-2', 2, true), lb('zzz-3', 3, false)]).id, 'zzz-2', 'la única activa, aunque haya una posterior inactiva');
    igual(nucleoLineaBaseActiva([lb('zzz-1', 1, true), lb('zzz-2', 2, true)]).id, 'zzz-2', 'dos activas, leídas 1 y 2');
    igual(nucleoLineaBaseActiva([lb('zzz-2', 2, true), lb('zzz-1', 1, true)]).id, 'zzz-2', 'dos activas, leídas 2 y 1');
    igual(nucleoLineaBaseActiva([lb('zzz-2', 2, true), lb('zzz-10', 10, true), lb('zzz-9', 9, true)]).id, 'zzz-10', 'el número se compara como número (10 > 9)');
    igual(nucleoLineaBaseActiva([lb('zzz-2', '2', true), lb('zzz-10', '10', true)]).id, 'zzz-10', 'número que llega como texto');
    // Solo activa === true cuenta: ni 'true', ni 1, ni null
    igual(nucleoLineaBaseActiva([lb('zzz-1', 1, 'true'), lb('zzz-2', 2, 1), lb('zzz-3', 3, null), null]), null, 'activa que no es el booleano true');
    const filas = [lb('zzz-1', 1, true)];
    assert(nucleoLineaBaseActiva(filas) === filas[0], 'devuelve la fila, no una copia');
  });

  // ── Filas de cronograma que cuentan ───────────────────────────────────────
  await prueba('nucleoFilasCronograma: sin filas, y filas incompletas descartadas', () => {
    igual(nucleoFilasCronograma(null, null).length, 0, 'null');
    igual(nucleoFilasCronograma(undefined, 'zzz-lb').length, 0, 'undefined');
    const r = nucleoFilasCronograma([
      null,
      { rubro_id: null, fecha_inicio: '2026-01-01', fecha_fin: '2026-01-10', linea_base_id: 'zzz-lb' },
      { rubro_id: 'r1', fecha_inicio: null, fecha_fin: '2026-01-10', linea_base_id: 'zzz-lb' },
      { rubro_id: 'r2', fecha_inicio: '2026-01-01', fecha_fin: null, linea_base_id: 'zzz-lb' },
      fila('r3', '2026-01-01', '2026-01-10')
    ], 'zzz-lb');
    igual(r.length, 1, 'solo la fila completa');
    igual(r[0].rubro_id, 'r3', 'la fila que queda');
  });

  await prueba('nucleoFilasCronograma: con línea base activa solo cuentan SUS filas (ni las de otra ni las que no tienen)', () => {
    const filas = [
      fila('r1', '2026-01-01', '2026-01-10', 'zzz-lb-propia'),
      fila('r1', '2026-03-01', '2026-03-10', 'zzz-lb-otra'),
      fila('r2', '2026-02-01', '2026-02-10', 'zzz-lb-otra'),
      fila('r3', '2026-02-01', '2026-02-10', null)
    ];
    const r = nucleoFilasCronograma(filas, 'zzz-lb-propia');
    igual(r.length, 1, 'una sola fila');
    igual(r[0].fecha_inicio, '2026-01-01', 'la de la línea base propia, aunque la de la otra se leyó después');
    igual(nucleoFilasCronograma(filas, 'zzz-lb-inexistente').length, 0, 'línea base activa sin filas: ninguna');
  });

  await prueba('nucleoFilasCronograma: sin línea base activa cuentan todas, una por rubro (gana la última leída)', () => {
    const filas = [
      fila('r1', '2026-01-01', '2026-01-10', 'zzz-lb-1'),
      fila('r2', '2026-02-01', '2026-02-10', null),
      fila('r1', '2026-03-01', '2026-03-10', 'zzz-lb-2')
    ];
    for(const sinLb of [null, undefined, '']){
      const r = nucleoFilasCronograma(filas, sinLb);
      igual(r.length, 2, 'una fila por rubro');
      igual(r.find(c => c.rubro_id === 'r1').fecha_inicio, '2026-03-01', 'del rubro repetido gana la última');
    }
  });

  await prueba('nucleoFilasCronograma: varias filas del mismo rubro en la misma línea base cuentan una vez', () => {
    const r = nucleoFilasCronograma([fila('r1', '2026-01-01', '2026-01-10'), fila('r1', '2026-01-05', '2026-01-20'), fila('r1', '2026-02-01', '2026-02-02')], 'zzz-lb');
    igual(r.length, 1, 'una fila');
    igual(r[0].fecha_fin, '2026-02-02', 'la última leída');
  });

  // ── Fracción programada ───────────────────────────────────────────────────
  await prueba('nucleoFraccionPlan: hoy antes, dentro y después de la actividad', () => {
    igual(nucleoFraccionPlan('2026-01-11', '2026-01-21', '2026-01-01'), 0, 'antes del inicio');
    igual(nucleoFraccionPlan('2026-01-11', '2026-01-21', '2026-01-10'), 0, 'la víspera');
    igual(nucleoFraccionPlan('2026-01-11', '2026-01-21', '2026-01-11'), 0, 'el día de inicio');
    casi(nucleoFraccionPlan('2026-01-11', '2026-01-21', '2026-01-12'), 0.1, 'un día de diez');
    casi(nucleoFraccionPlan('2026-01-11', '2026-01-21', '2026-01-16'), 0.5, 'a la mitad');
    igual(nucleoFraccionPlan('2026-01-11', '2026-01-21', '2026-01-21'), 1, 'el día de fin');
    igual(nucleoFraccionPlan('2026-01-11', '2026-01-21', '2026-06-30'), 1, 'después del fin (tope 1)');
  });

  await prueba('nucleoFraccionPlan: hito (inicio = fin) y fechas invertidas', () => {
    igual(nucleoFraccionPlan('2026-05-05', '2026-05-05', '2026-05-04'), 0, 'hito: la víspera');
    igual(nucleoFraccionPlan('2026-05-05', '2026-05-05', '2026-05-05'), 1, 'hito: su día');
    igual(nucleoFraccionPlan('2026-05-05', '2026-05-05', '2026-05-06'), 1, 'hito: después');
    igual(nucleoFraccionPlan('2026-05-10', '2026-05-05', '2026-05-04'), 0, 'fin anterior al inicio: antes del fin');
    igual(nucleoFraccionPlan('2026-05-10', '2026-05-05', '2026-05-05'), 1, 'fin anterior al inicio: cuenta desde el fin');
  });

  // ── Avance de un rubro ────────────────────────────────────────────────────
  await prueba('nucleoAvanceRubro: producción / monto, tope 100 %, monto 0 y terminado = 100', () => {
    igual(nucleoAvanceRubro(null), 0, 'sin rubro');
    igual(nucleoAvanceRubro(undefined), 0, 'undefined');
    igual(nucleoAvanceRubro(rubro('r', 200, 50)), 25, '50 de 200');
    igual(nucleoAvanceRubro(rubro('r', 200, 200)), 100, 'completo');
    igual(nucleoAvanceRubro(rubro('r', 200, 500)), 100, 'tope 100 %');
    igual(nucleoAvanceRubro(rubro('r', 200, -40)), 0, 'producción negativa no baja de 0');
    igual(nucleoAvanceRubro(rubro('r', 0, 500)), 0, 'monto 0');
    igual(nucleoAvanceRubro(rubro('r', null, null)), 0, 'monto y producción nulos');
    igual(nucleoAvanceRubro(rubro('r', 200, 0, 'terminado')), 100, 'terminado sin producción = 100');
    igual(nucleoAvanceRubro(rubro('r', 0, 0, 'terminado')), 100, 'terminado con monto 0 = 100');
    igual(nucleoAvanceRubro(rubro('r', 200, 50, 'planificado')), 25, 'planificado: producción / monto');
    igual(nucleoAvanceRubro(rubro('r', 200, 50, 'trabajando')), 25, 'trabajando: producción / monto');
    igual(nucleoAvanceRubro(rubro('r', 200, 50, 'suspendido')), 25, 'suspendido: cuenta por producción / monto, no es 100 ni 0');
    igual(nucleoAvanceRubro(rubro('r', 200, 500, 'suspendido')), 100, 'suspendido: también con tope 100 %');
    igual(nucleoAvanceRubro({ id: 'r', monto_contrato: '200', total_produccion: '50' }), 25, 'numeric que llega como texto');
  });

  // ── EVM del proyecto ──────────────────────────────────────────────────────
  await prueba('EVM: proyecto sin rubros (y sin argumentos opcionales) no revienta', () => {
    for(const e of [
      nucleoEvmProyecto({ rubros: [], cronograma: [], lineaBaseActivaId: null, hoy: '2026-11-21' }),
      nucleoEvmProyecto({ rubros: null, cronograma: null, lineaBaseActivaId: undefined, hoy: '2026-11-21' }),
      nucleoEvmProyecto({ hoy: '2026-11-21' })
    ]){
      igual(e.vigente, 0, 'vigente'); igual(e.ejecutado, 0, 'ejecutado'); igual(e.realPct, 0, 'realPct');
      igual(e.planPct, 0, 'planPct'); igual(e.evPct, 0, 'evPct');
      igual(e.avancePct, 0, 'avancePct'); igual(e.diferenciaAvancePuntos, 0, 'diferenciaAvancePuntos');
      igual(e.spi, null, 'spi'); igual(e.spiValido, false, 'spiValido'); igual(e.atrasoDias, 0, 'atrasoDias');
      // Sin cronograma no hay con qué medir ningún atraso: los dos son null (y el alias del semáforo, 0)
      igual(e.atrasoFechaDias, null, 'atrasoFechaDias'); igual(e.atrasoProyectadoDias, null, 'atrasoProyectadoDias'); igual(e.fechaGanada, null, 'fechaGanada');
      igual(e.rubros, 0, 'rubros'); igual(e.planFinalPct, 0, 'planFinalPct'); igual(e.obraProgramadaTerminada, false, 'obraProgramadaTerminada');
      igual(e.rubrosConCronograma, 0, 'rubrosConCronograma'); igual(e.rubrosSinCronograma, 0, 'rubrosSinCronograma'); igual(e.sinCronograma, true, 'sinCronograma');
      igual(e.sinLineaBase, true, 'sinLineaBase'); igual(e.primerInicio, null, 'primerInicio'); igual(e.ultimoFin, null, 'ultimoFin');
      igual(e.cronogramaVencido, false, 'cronogramaVencido');
      igual(e.fechaFinContractual, null, 'fechaFinContractual'); igual(e.plazoContractualVencido, false, 'plazoContractualVencido'); igual(e.avanceCompleto, false, 'avanceCompleto');
    }
  });

  await prueba('EVM: rubro suspendido (estado real no terminado) cuenta por su producción en el avance y en el SPI', () => {
    const base = { cronograma: [fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-01-01', '2026-01-11')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-02-01' };
    const e = nucleoEvmProyecto({ ...base, rubros: [rubro('r1', 500, 200, 'suspendido'), rubro('r2', 500, 0, 'planificado')] });
    casi(e.realPct, 20, 'realPct'); casi(e.planPct, 100, 'planPct: el plan no se detiene por la suspensión'); casi(e.evPct, 20, 'evPct = 50 × 40 %');
    casi(e.spi, 0.2, 'spi');
    // Igual que si estuviera «trabajando»: el estado solo cambia el cálculo cuando es «terminado»
    const t = nucleoEvmProyecto({ ...base, rubros: [rubro('r1', 500, 200, 'trabajando'), rubro('r2', 500, 0, 'trabajando')] });
    casi(t.spi, e.spi, 'mismo SPI que con trabajando'); casi(t.evPct, e.evPct, 'mismo valor ganado');
  });

  await prueba('EVM: rubros sin cronograma → hay avance pero no SPI', () => {
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 600, 150), rubro('r2', 400, 100)], cronograma: [], lineaBaseActivaId: 'zzz-lb', hoy: '2026-11-21' });
    igual(e.vigente, 1000, 'vigente'); igual(e.ejecutado, 250, 'ejecutado'); igual(e.realPct, 25, 'realPct');
    casi(e.avancePct, 25, 'avancePct (valor ganado sobre todos los rubros)'); igual(e.rubrosSinCronograma, 2, 'rubrosSinCronograma');
    igual(e.spi, null, 'spi'); igual(e.sinCronograma, true, 'sinCronograma'); igual(e.sinLineaBase, false, 'tiene línea base, pero vacía');
  });

  await prueba('EVM: monto total 0 → avance 0, pesos 0 y sin SPI (no divide entre cero)', () => {
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 0, 300), rubro('r2', null, 0)], cronograma: [fila('r1', '2026-01-01', '2026-01-11')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-06-01' });
    igual(e.vigente, 0, 'vigente'); igual(e.ejecutado, 300, 'ejecutado'); igual(e.realPct, 0, 'realPct');
    igual(e.planPct, 0, 'planPct'); igual(e.evPct, 0, 'evPct'); igual(e.spi, null, 'spi'); igual(e.spiValido, false, 'spiValido');
    igual(e.atrasoDias, 0, 'atraso'); igual(e.rubrosConCronograma, 1, 'la fila existe'); igual(e.sinCronograma, true, 'pero un cronograma que no pesa nada (monto 0) no es cronograma útil');
    igual(N.nucleoSemaforo({ estado: 'ejecucion', evm: e }).color, 'amarillo', 'en ejecución con un cronograma sin peso tampoco hay verde');
  });

  await prueba('EVM: caso base — pesos por monto, plan a la fecha, SPI y los dos atrasos', () => {
    // r1 pesa 60 %, va del 1 al 11 de enero; r2 pesa 40 %, del 11 al 21. Hoy 6-ene: r1 a la mitad.
    const e = nucleoEvmProyecto({
      rubros: [rubro('r1', 600, 150), rubro('r2', 400, 0)],
      cronograma: [fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-01-11', '2026-01-21')],
      lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-06'
    });
    igual(e.vigente, 1000, 'vigente'); igual(e.ejecutado, 150, 'ejecutado');
    casi(e.realPct, 15, 'realPct'); casi(e.planPct, 30, 'planPct = 60 × 0,5'); casi(e.evPct, 15, 'evPct = 60 × 25 %');
    casi(e.spi, 0.5, 'spi'); igual(e.spiValido, true, 'spiValido');
    // Atraso a la fecha: el plan sube 6 puntos por día; el último día en que no superaba el 15 % ganado es el día 2
    // (12 %; el día 3 ya iba en 18 %) → 3-ene
    igual(e.fechaGanada, '2026-01-03', 'fechaGanada'); igual(e.atrasoFechaDias, 3, 'atraso a la fecha: del 3 al 6 de enero');
    igual(e.atrasoDias, e.atrasoFechaDias, 'atrasoDias es el atraso a la fecha');
    igual(e.atrasoProyectadoDias, 20, 'atraso proyectado = 20 días de cronograma × (1/0,5 − 1)');
    casi(e.avancePct, 15, 'avance principal = valor ganado'); igual(e.diferenciaAvancePuntos, 0, 'sin diferencia con el ejecutado'); igual(e.rubrosSinCronograma, 0, 'rubrosSinCronograma');
    igual(e.rubrosConCronograma, 2, 'rubrosConCronograma'); igual(e.sinCronograma, false, 'sinCronograma'); igual(e.sinLineaBase, false, 'sinLineaBase');
    igual(e.primerInicio, '2026-01-01', 'primerInicio'); igual(e.ultimoFin, '2026-01-21', 'ultimoFin');
    igual(e.rubros, 2, 'rubros'); casi(e.planFinalPct, 100, 'planFinalPct: todo el proyecto está programado');
    igual(e.obraProgramadaTerminada, false, 'obraProgramadaTerminada'); igual(e.cronogramaVencido, false, 'cronogramaVencido');
  });

  await prueba('EVM: el avance principal y el ejecutado por cantidades suman TODOS los rubros; el SPI, solo los que tienen cronograma', () => {
    const e = nucleoEvmProyecto({
      rubros: [rubro('r1', 600, 150), rubro('r2', 400, 0), rubro('r3', 1000, 1000)],   // r3 completo, sin cronograma
      cronograma: [fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-01-11', '2026-01-21')],
      lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-06'
    });
    igual(e.vigente, 2000, 'vigente'); casi(e.realPct, 57.5, 'realPct incluye r3');
    casi(e.planPct, 15, 'planPct (los pesos son sobre el monto vigente total)'); casi(e.evPct, 7.5, 'evPct no incluye r3');
    casi(e.spi, 0.5, 'spi no cambia por un rubro sin cronograma'); igual(e.rubrosConCronograma, 2, 'rubrosConCronograma');
    casi(e.avancePct, 57.5, 'avance principal = valor ganado de todos: 30 × 25 % + 20 × 0 % + 50 × 100 % (incluye r3)'); igual(e.rubrosSinCronograma, 1, 'rubrosSinCronograma');
    igual(e.rubros, 3, 'rubros'); casi(e.planFinalPct, 50, 'planFinalPct: solo la mitad del monto está programada');
    casi(e.diferenciaAvancePuntos, 0, 'sin diferencia con el ejecutado: ningún rubro terminado ni pasado de monto');
  });

  await prueba('EVM: rubro terminado cuenta 100 % en el SPI aunque su producción no llegue', () => {
    const base = { cronograma: [fila('r1', '2026-01-01', '2026-01-11')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-02-01' };
    const sinTerminar = nucleoEvmProyecto({ ...base, rubros: [rubro('r1', 1000, 400)] });
    const terminado = nucleoEvmProyecto({ ...base, rubros: [rubro('r1', 1000, 400, 'terminado')] });
    casi(sinTerminar.spi, 0.4, 'sin terminar'); casi(terminado.spi, 1, 'terminado');
    casi(terminado.evPct, 100, 'evPct'); casi(terminado.realPct, 40, 'el avance real sigue siendo producción / monto');
    igual(terminado.atrasoDias, 0, 'sin atraso');
  });

  await prueba('EVM: tope 100 % por rubro en el SPI; el avance real del proyecto no tiene tope', () => {
    const e = nucleoEvmProyecto({
      rubros: [rubro('r1', 500, 900), rubro('r2', 500, 0)],
      cronograma: [fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-01-01', '2026-01-11')],
      lineaBaseActivaId: 'zzz-lb', hoy: '2026-02-01'
    });
    casi(e.evPct, 50, 'r1 aporta su peso, no 180 %'); casi(e.planPct, 100, 'planPct'); casi(e.spi, 0.5, 'spi');
    casi(e.realPct, 90, 'realPct = 900 / 1000');
    const pasado = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 1500)], cronograma: [], lineaBaseActivaId: null, hoy: '2026-02-01' });
    casi(pasado.realPct, 150, 'producción mayor que el monto: el avance real pasa de 100');
  });

  await prueba('EVM: hoy antes de que empiece el cronograma → plan 0 y sin SPI', () => {
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 200)], cronograma: [fila('r1', '2026-03-01', '2026-03-31')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-02-15' });
    igual(e.planPct, 0, 'planPct'); casi(e.evPct, 20, 'evPct'); igual(e.spi, null, 'spi'); igual(e.spiValido, false, 'spiValido');
    igual(e.atrasoDias, 0, 'atraso'); igual(e.sinCronograma, false, 'tiene cronograma');
    igual(semEjec({ evm: e, garantias: SIN_GAR, pendientes: 0 }).color, 'verde', 'verde');
  });

  await prueba('EVM: hoy después del fin → plan 100 %', () => {
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 1000)], cronograma: [fila('r1', '2026-03-01', '2026-03-31')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-12-31' });
    casi(e.planPct, 100, 'planPct'); casi(e.spi, 1, 'spi'); igual(e.atrasoDias, 0, 'atraso');
  });

  await prueba('EVM: adelantado (SPI > 1) no tiene atraso', () => {
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 800)], cronograma: [fila('r1', '2026-01-01', '2026-01-11')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-06' });
    casi(e.spi, 1.6, 'spi'); igual(e.atrasoDias, 0, 'atraso');
    igual(semEjec({ evm: e, garantias: SIN_GAR, pendientes: 0 }).color, 'verde', 'verde');
  });

  await prueba('EVM: hito (inicio = fin) cuenta entero desde su día', () => {
    const base = { rubros: [rubro('r1', 1000, 0), rubro('r2', 1000, 0)], cronograma: [fila('r1', '2026-05-05', '2026-05-05')], lineaBaseActivaId: 'zzz-lb' };
    igual(nucleoEvmProyecto({ ...base, hoy: '2026-05-04' }).planPct, 0, 'la víspera');
    casi(nucleoEvmProyecto({ ...base, hoy: '2026-05-05' }).planPct, 50, 'su día');
    casi(nucleoEvmProyecto({ ...base, hoy: '2026-05-06' }).planPct, 50, 'después');
  });

  await prueba('EVM: con línea base activa propia se ignoran las filas de OTRA línea base', () => {
    const rubros = [rubro('r1', 500, 250), rubro('r2', 500, 0)];
    const cronograma = [
      fila('r1', '2026-01-01', '2026-01-11', 'zzz-lb-propia'),
      fila('r2', '2025-01-01', '2025-01-11', 'zzz-lb-ajena'),      // vencida hace un año: hundiría el SPI
      fila('r1', '2025-01-01', '2025-01-02', 'zzz-lb-ajena')
    ];
    const e = nucleoEvmProyecto({ rubros, cronograma, lineaBaseActivaId: 'zzz-lb-propia', hoy: '2026-01-06' });
    igual(e.rubrosConCronograma, 1, 'solo la fila propia'); casi(e.planPct, 25, 'planPct'); casi(e.evPct, 25, 'evPct'); casi(e.spi, 1, 'spi');
    igual(e.primerInicio, '2026-01-01', 'primerInicio no mira la otra línea base'); igual(e.sinLineaBase, false, 'sinLineaBase');
    // La misma cartera leída con la otra línea base como activa da otro resultado: el filtro es el que decide
    const otra = nucleoEvmProyecto({ rubros, cronograma, lineaBaseActivaId: 'zzz-lb-ajena', hoy: '2026-01-06' });
    igual(otra.rubrosConCronograma, 2, 'las dos filas de la otra'); casi(otra.planPct, 100, 'planPct de la otra'); casi(otra.spi, 0.25, 'spi de la otra');
  });

  await prueba('EVM: línea base activa sin ninguna fila → sin cronograma (pero sinLineaBase = false)', () => {
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 500, 250)], cronograma: [fila('r1', '2026-01-01', '2026-01-11', 'zzz-lb-vieja')], lineaBaseActivaId: 'zzz-lb-nueva', hoy: '2026-01-06' });
    igual(e.sinCronograma, true, 'sinCronograma'); igual(e.sinLineaBase, false, 'sinLineaBase'); igual(e.spi, null, 'spi'); igual(e.planPct, 0, 'planPct');
  });

  await prueba('EVM: sin línea base activa se usan todas las filas del proyecto y se avisa', () => {
    const e = nucleoEvmProyecto({
      rubros: [rubro('r1', 500, 250), rubro('r2', 500, 0)],
      cronograma: [fila('r1', '2026-01-01', '2026-01-11', 'zzz-lb-1'), fila('r2', '2026-01-01', '2026-01-11', null)],
      lineaBaseActivaId: null, hoy: '2026-01-06'
    });
    igual(e.sinLineaBase, true, 'sinLineaBase'); igual(e.sinCronograma, false, 'sinCronograma'); igual(e.rubrosConCronograma, 2, 'las dos filas');
    casi(e.planPct, 50, 'planPct'); casi(e.evPct, 25, 'evPct'); casi(e.spi, 0.5, 'spi');
  });

  await prueba('EVM: varias filas del mismo rubro no duplican su peso', () => {
    const rubros = [rubro('r1', 1000, 500)];
    const una = nucleoEvmProyecto({ rubros, cronograma: [fila('r1', '2026-01-01', '2026-01-11')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-06' });
    const tres = nucleoEvmProyecto({ rubros, cronograma: [fila('r1', '2025-06-01', '2025-06-02'), fila('r1', '2025-07-01', '2025-07-02'), fila('r1', '2026-01-01', '2026-01-11')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-06' });
    igual(tres.rubrosConCronograma, 1, 'un rubro'); casi(tres.planPct, una.planPct, 'mismo plan que con una fila'); casi(tres.planPct, 50, 'planPct');
    casi(tres.evPct, 50, 'evPct sin duplicar'); casi(tres.spi, 1, 'spi'); igual(tres.primerInicio, '2026-01-01', 'primerInicio de la fila que cuenta');
  });

  await prueba('EVM: filas de cronograma de rubros que no son del proyecto se ignoran', () => {
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 500)], cronograma: [fila('r1', '2026-01-01', '2026-01-11'), fila('zzz-ajeno', '2025-01-01', '2025-01-02')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-06' });
    igual(e.rubrosConCronograma, 1, 'solo el rubro propio'); casi(e.spi, 1, 'spi'); igual(e.primerInicio, '2026-01-01', 'primerInicio');
  });

  await prueba('EVM: plan a la fecha menor que 0,5 % → hay SPI pero no es válido, no hay atraso ni decide el color', () => {
    // r1 pesa 0,4 % y ya debía estar hecho; no se ha ejecutado nada: SPI 0
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 4, 0), rubro('r2', 996, 0)], cronograma: [fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-06-01', '2026-12-01')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-03-01' });
    casi(e.planPct, 0.4, 'planPct'); igual(e.spi, 0, 'spi'); igual(e.spiValido, false, 'spiValido'); igual(e.atrasoDias, 0, 'atraso');
    const s = semEjec({ evm: e, garantias: SIN_GAR, pendientes: 0 });
    igual(s.color, 'verde', 'color'); igual(s.motivos.join('|'), 'plan a la fecha todavía menor al 0,5 %', 'motivo');
  });

  await prueba('EVM: el plan mínimo es estricto — con 0,5 % exacto el SPI aún no vale; con más, sí', () => {
    const cron = [fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-06-01', '2026-12-01')];
    const justo = nucleoEvmProyecto({ rubros: [rubro('r1', 1, 0), rubro('r2', 199, 0)], cronograma: cron, lineaBaseActivaId: 'zzz-lb', hoy: '2026-03-01' });
    igual(justo.planPct, 0.5, 'planPct exacto'); igual(justo.spiValido, false, 'con 0,5 % exacto no es válido');
    const pasa = nucleoEvmProyecto({ rubros: [rubro('r1', 6, 0), rubro('r2', 994, 0)], cronograma: cron, lineaBaseActivaId: 'zzz-lb', hoy: '2026-03-01' });
    casi(pasa.planPct, 0.6, 'planPct'); igual(pasa.spiValido, true, 'con 0,6 % ya es válido');
    igual(semEjec({ evm: pasa, garantias: SIN_GAR, pendientes: 0 }).color, 'rojo', 'y entonces el SPI 0 pinta rojo');
  });

  await prueba('EVM: SPI 0 con plan significativo → rojo, sin división entre cero en el atraso', () => {
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 0)], cronograma: [fila('r1', '2026-01-01', '2026-01-11')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-06' });
    igual(e.spi, 0, 'spi'); igual(e.spiValido, true, 'spiValido');
    igual(e.atrasoFechaDias, 5, 'atraso a la fecha: los 5 días transcurridos desde el inicio'); assert(Number.isFinite(e.atrasoFechaDias), 'atraso finito');
    igual(e.atrasoProyectadoDias, null, 'atraso proyectado: no estimable con SPI 0');
    const s = semEjec({ evm: e, garantias: SIN_GAR, pendientes: 0 });
    igual(s.color, 'rojo', 'color'); igual(s.motivos[0], 'SPI 0,00', 'motivo');
  });

  await prueba('EVM + semáforo: umbrales exactos 0,85 (amarillo, no rojo) y 0,95 (verde, no amarillo)', () => {
    const con = prod => nucleoEvmProyecto({ rubros: [rubro('r1', 100, prod)], cronograma: [fila('r1', '2026-01-01', '2026-01-02')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-02' });
    const color = prod => semEjec({ evm: con(prod), garantias: SIN_GAR, pendientes: 0 }).color;
    igual(con(85).spi, 0.85, 'spi exacto 0,85'); igual(con(95).spi, 0.95, 'spi exacto 0,95');
    igual(color(84), 'rojo', '0,84'); igual(color(85), 'amarillo', '0,85 exacto'); igual(color(94), 'amarillo', '0,94');
    igual(color(95), 'verde', '0,95 exacto'); igual(color(100), 'verde', '1,00');
  });

  // ── Avance principal (valor ganado) y ejecutado por cantidades ────────────
  await prueba('avance principal = valor ganado de TODOS los rubros; evPct (el numerador del SPI), solo de los que tienen cronograma', () => {
    // r1 (50 %) terminado con 80 % de producción; r2 (30 %) al 50 %; r3 (20 %) completo pero SIN cronograma
    const e = nucleoEvmProyecto({
      rubros: [rubro('r1', 500, 400, 'terminado'), rubro('r2', 300, 150), rubro('r3', 200, 200)],
      cronograma: [fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-01-01', '2026-01-11')],
      lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-11'
    });
    casi(e.evPct, 65, 'valor ganado en cronograma = 50 × 100 % + 30 × 50 %'); casi(e.avancePct, 85, 'avance principal = 65 + 20 × 100 % del rubro sin cronograma');
    casi(e.planPct, 80, 'plan'); casi(e.planFinalPct, 80, 'peso con cronograma'); casi(e.spi, 65 / 80, 'SPI = valor ganado en cronograma / plan (no el avance principal / plan)');
    casi(e.realPct, 75, 'ejecutado por cantidades = 750 / 1000 (se informa aparte)');
    casi(e.diferenciaAvancePuntos, 10, 'diferencia = |85 − 75|');
    igual(e.sinCronograma, false, 'sinCronograma'); igual(e.rubrosSinCronograma, 1, 'un rubro sin cronograma'); igual(e.rubros, 3, 'rubros');
    // Con todos los rubros en el cronograma los dos números son el mismo
    const todos = nucleoEvmProyecto({
      rubros: [rubro('r1', 500, 400, 'terminado'), rubro('r2', 300, 150), rubro('r3', 200, 200)],
      cronograma: [fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-01-01', '2026-01-11'), fila('r3', '2026-01-01', '2026-01-11')],
      lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-11'
    });
    casi(todos.avancePct, 85, 'todos con cronograma: avance'); igual(todos.avancePct, todos.evPct, 'todos con cronograma: avancePct ES evPct');
  });

  await prueba('avance principal SIN cronograma = valor ganado sobre todos los rubros (terminado = 100 %, tope 100 % por rubro)', () => {
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 600, 150), rubro('r2', 400, 100, 'terminado')], cronograma: [], lineaBaseActivaId: null, hoy: '2026-11-21' });
    igual(e.sinCronograma, true, 'sinCronograma');
    casi(e.avancePct, 55, 'avance = 60 × 25 % + 40 × 100 %'); casi(e.realPct, 25, 'ejecutado por cantidades = 250 / 1000');
    casi(e.diferenciaAvancePuntos, 30, 'diferencia'); igual(e.evPct, 0, 'evPct (el del SPI) sigue en 0: no hay cronograma'); igual(e.spi, null, 'sin SPI');
    // Tope por rubro: producción mayor que el monto no pasa de 100 en el avance principal
    const pasado = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 1500)], cronograma: [], lineaBaseActivaId: null, hoy: '2026-11-21' });
    casi(pasado.avancePct, 100, 'avance principal con tope'); casi(pasado.realPct, 150, 'ejecutado por cantidades sin tope'); casi(pasado.diferenciaAvancePuntos, 50, 'diferencia');
    // Línea base activa sin filas: también es «sin cronograma»
    const lbVacia = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 300)], cronograma: [fila('r1', '2026-01-01', '2026-02-01', 'zzz-lb-vieja')], lineaBaseActivaId: 'zzz-lb-nueva', hoy: '2026-11-21' });
    casi(lbVacia.avancePct, 30, 'línea base activa vacía: avance sobre todos los rubros');
  });

  await prueba('diferencia con el ejecutado por cantidades: valor absoluto, en los dos sentidos', () => {
    const base = { cronograma: [fila('r1', '2026-01-01', '2026-01-11')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-11' };
    // Valor ganado por encima: rubro terminado con poca producción
    const arriba = nucleoEvmProyecto({ ...base, rubros: [rubro('r1', 1000, 600, 'terminado')] });
    casi(arriba.avancePct, 100, 'avance'); casi(arriba.realPct, 60, 'ejecutado'); casi(arriba.diferenciaAvancePuntos, 40, 'diferencia +40');
    // Valor ganado por debajo: producción mayor que el monto (el avance del rubro tiene tope 100 %; el ejecutado, no)
    const abajo = nucleoEvmProyecto({ ...base, rubros: [rubro('r1', 500, 100), rubro('r2', 500, 900)] });
    casi(abajo.avancePct, 60, 'avance = 50 × 20 % + 50 × 100 %'); casi(abajo.realPct, 100, 'ejecutado = 1000 / 1000'); casi(abajo.diferenciaAvancePuntos, 40, 'diferencia −40, en valor absoluto');
    // Un rubro sin cronograma ya no abre diferencia: cuenta en los dos avances
    const sinCron = nucleoEvmProyecto({ ...base, rubros: [rubro('r1', 500, 100), rubro('r2', 500, 500)] });
    casi(sinCron.avancePct, 60, 'rubro sin cronograma: avance'); casi(sinCron.realPct, 60, 'rubro sin cronograma: ejecutado'); casi(sinCron.diferenciaAvancePuntos, 0, 'rubro sin cronograma: sin diferencia');
    // Sin diferencia cuando todo tiene cronograma y nada está «terminado» ni pasado de monto
    const igualados = nucleoEvmProyecto({ ...base, rubros: [rubro('r1', 1000, 370)] });
    casi(igualados.diferenciaAvancePuntos, 0, 'sin diferencia');
  });

  await prueba('nucleoDatosPorCompletar: umbral exacto — 10 puntos no avisa; más de 10, sí', () => {
    const con = prod => nucleoEvmProyecto({ rubros: [rubro('r1', 1000, prod, 'terminado')], cronograma: [fila('r1', '2026-01-01', '2026-01-11')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-02-01' });
    igual(con(900).diferenciaAvancePuntos, 10, 'diferencia exacta de 10 puntos (100 − 90)');
    igual(nucleoDatosPorCompletar({ evm: con(900), estado: 'ejecucion' }).length, 0, '10 puntos exactos: sin aviso');
    igual(nucleoDatosPorCompletar({ evm: con(950), estado: 'ejecucion' }).length, 0, '5 puntos: sin aviso');
    const avisos = nucleoDatosPorCompletar({ evm: con(899), estado: 'ejecucion' });
    igual(avisos.length, 1, '10,1 puntos: un aviso');
    igual(avisos[0], 'el valor ganado (100,0 %) y el ejecutado por cantidades (89,9 %) difieren en más de 10 puntos', 'texto del aviso');
    // Con el EVM «a mano», justo en el umbral y un pelo por encima
    igual(nucleoDatosPorCompletar({ evm: { avancePct: 50, realPct: 40, diferenciaAvancePuntos: NUCLEO_CARTERA.DIFERENCIA_AVANCE_PUNTOS, ejecutado: 1 }, estado: 'ejecucion' }).length, 0, 'umbral exacto a mano');
    igual(nucleoDatosPorCompletar({ evm: { avancePct: 50, realPct: 39.99, diferenciaAvancePuntos: 10.01, ejecutado: 1 }, estado: 'ejecucion' }).length, 1, '10,01 a mano');
    // El aviso de diferencia no depende del estado
    for(const estado of ['ejecucion', ...SIN_COLOR]) assert(nucleoDatosPorCompletar({ evm: con(500), estado }).some(a => /difieren en más de 10 puntos/.test(a)), 'diferencia de 50 puntos en ' + estado);
  });

  await prueba('nucleoDatosPorCompletar: proyecto finalizado sin producción registrada', () => {
    const sinProd = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 0)], cronograma: [], lineaBaseActivaId: null, hoy: '2026-11-21' });
    igual(nucleoDatosPorCompletar({ evm: sinProd, estado: 'finalizado' }).join('|'), 'proyecto finalizado sin producción registrada', 'finalizado sin producción');
    for(const estado of ['ejecucion', 'planificacion', 'pausado', 'cancelado']) igual(nucleoDatosPorCompletar({ evm: sinProd, estado }).length, 0, estado + ' sin producción: sin aviso');
    const conProd = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 1)], cronograma: [], lineaBaseActivaId: null, hoy: '2026-11-21' });
    igual(nucleoDatosPorCompletar({ evm: conProd, estado: 'finalizado' }).length, 0, 'finalizado con algo de producción: sin aviso');
    igual(nucleoDatosPorCompletar({ evm: nucleoEvmProyecto({ hoy: '2026-11-21' }), estado: 'finalizado' }).join('|'), 'proyecto finalizado sin rubros', 'finalizado sin rubros: avisa con su propio texto');
    // Finalizado con los rubros marcados «terminado» y sin producción: los dos avisos, primero la diferencia
    const marcados = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 0, 'terminado')], cronograma: [], lineaBaseActivaId: null, hoy: '2026-11-21' });
    igual(nucleoDatosPorCompletar({ evm: marcados, estado: 'finalizado' }).join('|'),
      'el valor ganado (100,0 %) y el ejecutado por cantidades (0,0 %) difieren en más de 10 puntos|proyecto finalizado sin producción registrada', 'los dos avisos');
    // Sin argumentos o sin EVM no revienta: falta el estado, y eso es justo lo que avisa
    igual(nucleoDatosPorCompletar().join('|'), 'proyecto sin estado registrado', 'sin argumentos'); igual(nucleoDatosPorCompletar({}).join('|'), 'proyecto sin estado registrado', 'objeto vacío');
    igual(nucleoDatosPorCompletar({ estado: 'ejecucion' }).length, 0, 'en ejecución sin EVM: sin avisos');
    igual(nucleoDatosPorCompletar({ estado: 'finalizado' }).join('|'), 'proyecto finalizado sin rubros', 'finalizado sin EVM: no consta ningún rubro');
  });

  await prueba('nucleoDatosPorCompletar: proyecto finalizado SIN RUBROS (aviso propio, distinto del de sin producción)', () => {
    const vacio = nucleoEvmProyecto({ rubros: [], cronograma: [], lineaBaseActivaId: null, hoy: '2026-11-21' });
    igual(vacio.rubros, 0, 'EVM: 0 rubros');
    igual(nucleoDatosPorCompletar({ evm: vacio, estado: 'finalizado' }).join('|'), 'proyecto finalizado sin rubros', 'finalizado sin rubros');
    // Solo en finalizado: un proyecto en planificación sin rubros es normal
    for(const estado of ['ejecucion', 'planificacion', 'pausado', 'cancelado']) igual(nucleoDatosPorCompletar({ evm: vacio, estado }).length, 0, estado + ' sin rubros: sin aviso');
    // Con rubros pero sin producción es el otro aviso, no los dos
    const conRubro = nucleoEvmProyecto({ rubros: [rubro('r1', 0, 0)], cronograma: [], lineaBaseActivaId: null, hoy: '2026-11-21' });
    igual(conRubro.rubros, 1, 'EVM: 1 rubro (de monto 0)');
    igual(nucleoDatosPorCompletar({ evm: conRubro, estado: 'finalizado' }).join('|'), 'proyecto finalizado sin producción registrada', 'finalizado con un rubro vacío');
  });

  await prueba('nucleoDatosPorCompletar: proyecto sin estado (null, undefined o vacío) → «proyecto sin estado registrado», primero', () => {
    const bien = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 500)], cronograma: [], lineaBaseActivaId: null, hoy: '2026-11-21' });
    for(const [que, estado] of [['null', null], ['undefined', undefined], ['texto vacío', '']]){
      igual(nucleoDatosPorCompletar({ evm: bien, estado }).join('|'), 'proyecto sin estado registrado', 'estado ' + que);
    }
    for(const estado of ['ejecucion', ...SIN_COLOR]) assert(!nucleoDatosPorCompletar({ evm: bien, estado }).includes('proyecto sin estado registrado'), estado + ': tiene estado, no avisa');
    // Se suma a los demás avisos, y va primero
    const marcados = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 0, 'terminado')], cronograma: [], lineaBaseActivaId: null, hoy: '2026-11-21' });
    igual(nucleoDatosPorCompletar({ evm: marcados, estado: null }).join('|'),
      'proyecto sin estado registrado|el valor ganado (100,0 %) y el ejecutado por cantidades (0,0 %) difieren en más de 10 puntos', 'sin estado + diferencia');
    // Sin estado no es «finalizado»: no arrastra los avisos de finalizado
    igual(nucleoDatosPorCompletar({ evm: nucleoEvmProyecto({ hoy: '2026-11-21' }), estado: null }).join('|'), 'proyecto sin estado registrado', 'sin estado y sin rubros');
  });

  // ── Monto vigente frente al contractual más las órdenes de cambio ─────────
  const AVISO_MONTO = (vigente, esperado, dif) => `el monto vigente ($ ${vigente}) no cuadra con el contractual más las órdenes de cambio aprobadas ($ ${esperado}): diferencia de $ ${dif}`;
  // Monto vigente 1.000 (600 + 400), avance 25 % en los dos avances: sin ningún otro aviso
  const evmMil = () => nucleoEvmProyecto({ rubros: [rubro('r1', 600, 150), rubro('r2', 400, 100)], cronograma: [], lineaBaseActivaId: null, hoy: '2026-11-21' });
  const montos = (montoContractual, montoOrdenesCambio, estado = 'ejecucion', evm = evmMil()) => nucleoDatosPorCompletar({ evm, estado, montoContractual, montoOrdenesCambio });

  await prueba('nucleoDatosPorCompletar con montos: cuadra (tolerancia de 1,00 exacta, por arriba y por abajo)', () => {
    igual(evmMil().vigente, 1000, 'monto vigente = Σ rubros'); igual(NUCLEO_CARTERA.TOLERANCIA_MONTO, 1, 'tolerancia de 1,00');
    igual(montos(1000, 0).length, 0, 'contractual = vigente, sin órdenes de cambio');
    igual(montos(1000).length, 0, 'sin pasar las órdenes de cambio (cuentan 0)'); igual(montos(1000, null).length, 0, 'órdenes de cambio null (cuentan 0)');
    igual(montos(900, 100).length, 0, 'contractual 900 + órdenes de cambio 100');
    igual(montos(1150, -150).length, 0, 'órdenes de cambio que restan (suma negativa)');
    igual(montos('1000.00', '0.00').length, 0, 'numeric que llega como texto');
    igual(montos(250.25, 749.75).length, 0, 'con céntimos');
    // Tolerancia: una diferencia de 1,00 exacto NO avisa (en los dos sentidos); 1,01 sí
    igual(montos(999, 0).length, 0, 'vigente 1,00 por encima: cuadra'); igual(montos(1001, 0).length, 0, 'vigente 1,00 por debajo: cuadra');
    igual(montos(999.5, 0).length, 0, '0,50 por encima'); igual(montos(1000.5, 0).length, 0, '0,50 por debajo');
    igual(montos(900, 99).length, 0, '1,00 exacto repartido entre contractual y órdenes de cambio');
    igual(montos(998.99, 0).join('|'), AVISO_MONTO('1.000,00', '998,99', '1,01'), '1,01 por encima: avisa');
    igual(montos(1001.01, 0).join('|'), AVISO_MONTO('1.000,00', '1.001,01', '-1,01'), '1,01 por debajo: avisa');
    igual(montos(998, 0).length, 1, '2,00 por encima'); igual(montos(1002, 0).length, 1, '2,00 por debajo');
  });

  await prueba('nucleoDatosPorCompletar con montos: no cuadra por exceso y por defecto, con los tres importes en el aviso', () => {
    // Por exceso: los rubros suman más que el contrato y sus órdenes de cambio aprobadas
    igual(montos(800, 150).join('|'), AVISO_MONTO('1.000,00', '950,00', '50,00'), 'exceso de 50,00 (800 + 150 = 950)');
    igual(montos(800).join('|'), AVISO_MONTO('1.000,00', '800,00', '200,00'), 'exceso de 200,00 sin órdenes de cambio');
    // Por defecto: los rubros suman menos (diferencia negativa)
    igual(montos(1200, 50.5).join('|'), AVISO_MONTO('1.000,00', '1.250,50', '-250,50'), 'defecto de 250,50 (1.200 + 50,50 = 1.250,50)');
    igual(montos(1000, 300).join('|'), AVISO_MONTO('1.000,00', '1.300,00', '-300,00'), 'defecto: órdenes de cambio aprobadas que no están en los rubros');
    igual(montos(1000, -300).join('|'), AVISO_MONTO('1.000,00', '700,00', '300,00'), 'exceso: orden de cambio que resta y no se descontó de los rubros');
    // Importes grandes: separador de miles y coma decimal
    const grande = nucleoEvmProyecto({ rubros: [rubro('r1', 1234567.89, 0)], cronograma: [], lineaBaseActivaId: null, hoy: '2026-11-21' });
    igual(montos(1000000, 0, 'ejecucion', grande).join('|'), AVISO_MONTO('1.234.567,89', '1.000.000,00', '234.567,89'), 'miles con punto y decimales con coma');
    // No depende del estado del proyecto
    for(const estado of ['ejecucion', ...SIN_COLOR]) assert(montos(800, 150, estado).includes(AVISO_MONTO('1.000,00', '950,00', '50,00')), estado + ': avisa igual');
    // Se suma a los demás avisos, en su sitio: después de la diferencia de avances y antes de los de finalizado
    const marcados = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 0, 'terminado')], cronograma: [], lineaBaseActivaId: null, hoy: '2026-11-21' });
    igual(montos(500, 0, 'finalizado', marcados).join('|'),
      'el valor ganado (100,0 %) y el ejecutado por cantidades (0,0 %) difieren en más de 10 puntos|' + AVISO_MONTO('1.000,00', '500,00', '500,00') + '|proyecto finalizado sin producción registrada', 'con los avisos de avance y de finalizado');
    igual(montos(500, 0, null, marcados)[0], 'proyecto sin estado registrado', 'sin estado: ese aviso sigue primero');
    // El aviso de montos no cambia el semáforo: es solo un dato por completar
    igual(semEjec({ evm: { ...evmMil(), sinCronograma: false }, garantias: SIN_GAR, pendientes: 0 }).color, 'verde', 'el semáforo no mira los montos');
  });

  await prueba('nucleoDatosPorCompletar con montos: sin monto contractual no avisa; proyecto sin rubros no avisa', () => {
    // Sin monto contractual registrado (null, undefined o sin pasar) no hay con qué comparar, haya o no órdenes de cambio
    igual(montos(null, 0).length, 0, 'contractual null'); igual(montos(undefined, 0).length, 0, 'contractual undefined');
    igual(montos(null, 5000).length, 0, 'contractual null con órdenes de cambio'); igual(montos(undefined, 5000).length, 0, 'contractual undefined con órdenes de cambio');
    igual(nucleoDatosPorCompletar({ evm: evmMil(), estado: 'ejecucion' }).length, 0, 'sin pasar ningún monto (como hace el Panel Cartera)');
    igual(nucleoDatosPorCompletar({ evm: evmMil(), estado: 'ejecucion', montoOrdenesCambio: 5000 }).length, 0, 'solo órdenes de cambio, sin contractual');
    igual(montos('ZZZ no es un número', 0).length, 0, 'contractual que no es un número: no se compara');
    // Proyecto sin rubros: el monto vigente es 0 porque aún no se cargó el presupuesto, no porque no cuadre
    const vacio = nucleoEvmProyecto({ rubros: [], cronograma: [], lineaBaseActivaId: null, hoy: '2026-11-21' });
    igual(vacio.rubros, 0, 'EVM: 0 rubros'); igual(vacio.vigente, 0, 'EVM: vigente 0');
    for(const estado of ['ejecucion', 'planificacion', 'pausado', 'cancelado']) igual(montos(5000, 250, estado, vacio).length, 0, estado + ' sin rubros: sin aviso de montos');
    igual(montos(5000, 250, 'finalizado', vacio).join('|'), 'proyecto finalizado sin rubros', 'finalizado sin rubros: solo su aviso propio');
    igual(nucleoDatosPorCompletar({ estado: 'ejecucion', montoContractual: 5000, montoOrdenesCambio: 250 }).length, 0, 'sin EVM: sin aviso');
    // Contraprueba: con un solo rubro ya se compara
    const uno = nucleoEvmProyecto({ rubros: [rubro('r1', 100, 0)], cronograma: [], lineaBaseActivaId: null, hoy: '2026-11-21' });
    igual(montos(5000, 250, 'ejecucion', uno).join('|'), AVISO_MONTO('100,00', '5.250,00', '-5.150,00'), 'con un rubro: avisa');
    // Un rubro de monto 0 es un rubro: se compara (vigente 0 frente a 5.250)
    const rubroCero = nucleoEvmProyecto({ rubros: [rubro('r1', 0, 0)], cronograma: [], lineaBaseActivaId: null, hoy: '2026-11-21' });
    igual(montos(5000, 250, 'ejecucion', rubroCero).join('|'), AVISO_MONTO('0,00', '5.250,00', '-5.250,00'), 'rubro de monto 0: avisa');
  });

  // ── Atraso a la fecha (cronograma ganado) ─────────────────────────────────
  // Actividad única de 100 días (1-ene a 11-abr-2026) que vale todo el proyecto: el plan sube 1 punto por día.
  const lineal = (prod, hoy, estado = 'trabajando') => nucleoEvmProyecto({ rubros: [rubro('r1', 1000, prod, estado)], cronograma: [fila('r1', '2026-01-01', '2026-04-11')], lineaBaseActivaId: 'zzz-lb', hoy });

  await prueba('atraso a la fecha, caso lineal a mano: del ÚLTIMO día en que el plan no superaba el valor ganado de hoy', () => {
    igual(nucleoDiasEntre('2026-01-01', '2026-04-11'), 100, 'el cronograma dura 100 días');
    // Día 60 (2-mar) con 45 % ganado: el plan preveía 45 % el día 45 (15-feb) → 15 días
    const e = lineal(450, '2026-03-02');
    casi(e.planPct, 60, 'plan'); casi(e.evPct, 45, 'valor ganado'); casi(e.spi, 0.75, 'SPI');
    igual(e.fechaGanada, '2026-02-15', 'fechaGanada'); igual(e.atrasoFechaDias, 15, 'atraso a la fecha'); igual(e.atrasoDias, 15, 'atrasoDias (alias)');
    // Entre dos días se toma el último en que el plan todavía no lo superaba: 45,5 % → día 45 (el 46 ya iba en 46 %) → 15 días
    const f = lineal(455, '2026-03-02');
    igual(f.fechaGanada, '2026-02-15', 'fechaGanada con 45,5 %'); igual(f.atrasoFechaDias, 15, 'atraso con 45,5 %');
    // …y un pelo por debajo de 45 % ya es el día 44 → 16 días
    const g = lineal(449, '2026-03-02');
    igual(g.fechaGanada, '2026-02-14', 'fechaGanada con 44,9 %'); igual(g.atrasoFechaDias, 16, 'atraso con 44,9 %');
    // Cualquier valor por debajo del plan de hoy es al menos un día: 59,9 % el día 60 → día 59
    igual(lineal(599, '2026-03-02').atrasoFechaDias, 1, '59,9 % el día 60');
    // Un punto por debajo del plan = un día
    igual(lineal(590, '2026-03-02').atrasoFechaDias, 1, '59 % el día 60');
    // Cada día sin producir es un día más de atraso
    igual(lineal(450, '2026-03-03').atrasoFechaDias, 16, 'al día siguiente, 16');
    igual(lineal(450, '2026-03-12').atrasoFechaDias, 25, 'diez días después, 25');
  });

  await prueba('atraso a la fecha: 0 si va al día o adelantado; null (no medible) antes de empezar y sin cronograma', () => {
    for(const [que, e] of [['al día (60 % el día 60)', lineal(600, '2026-03-02')], ['adelantado (80 % el día 60)', lineal(800, '2026-03-02')],
      ['completo antes de tiempo', lineal(1000, '2026-03-02')], ['terminado', lineal(0, '2026-03-02', 'terminado')]]){
      igual(e.atrasoFechaDias, 0, que + ': atraso a la fecha'); igual(e.fechaGanada, null, que + ': sin fecha ganada'); igual(e.atrasoProyectadoDias, 0, que + ': atraso proyectado');
      igual(e.atrasoDias, 0, que + ': atrasoDias');
    }
    // Sin plan a la fecha (o sin cronograma) no hay con qué medir: null en los dos atrasos, y 0 en el que usa el semáforo
    const sinCron = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 0)], cronograma: [], lineaBaseActivaId: 'zzz-lb', hoy: '2030-01-01' });
    for(const [que, e] of [['antes del inicio', lineal(0, '2025-12-15')], ['el día del inicio', lineal(0, '2026-01-01')], ['sin cronograma', sinCron]]){
      igual(e.atrasoFechaDias, null, que + ': atraso a la fecha'); igual(e.fechaGanada, null, que + ': sin fecha ganada'); igual(e.atrasoProyectadoDias, null, que + ': atraso proyectado');
      igual(e.atrasoDias, 0, que + ': atrasoDias = atrasoFechaDias || 0'); igual(e.spiValido, false, que + ': SPI no válido');
    }
  });

  await prueba('atraso a la fecha: NUNCA supera los días transcurridos desde el primer inicio (valor ganado 0, y vencido hace meses)', () => {
    // Sin nada ejecutado el atraso es exactamente lo transcurrido desde el inicio: ni un día más
    for(const hoy of ['2026-01-02', '2026-01-11', '2026-03-02', '2026-04-11', '2026-04-12', '2026-07-20', '2026-11-21', '2027-11-21']){
      const e = lineal(0, hoy), transcurridos = nucleoDiasEntre('2026-01-01', hoy);
      igual(e.fechaGanada, '2026-01-01', hoy + ': con valor ganado 0 la fecha ganada es el primer inicio');
      igual(e.atrasoFechaDias, transcurridos, hoy + ': atraso = días transcurridos (' + transcurridos + ')');
    }
    // Una obra que empezó en septiembre no puede llevar 319 días de atraso en noviembre
    const sept = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 0)], cronograma: [fila('r1', '2026-09-07', '2026-10-07')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-11-21' });
    igual(sept.cronogramaVencido, true, 'cronograma de 30 días vencido'); igual(sept.atrasoFechaDias, 75, 'atraso = 75 días desde el 7-sep, no más');
    // Cronograma vencido hace meses con la obra a medias: sigue acotado, y es hoy − fecha ganada
    const vencido = lineal(400, '2026-11-21');
    igual(vencido.cronogramaVencido, true, 'vencido'); igual(vencido.fechaGanada, '2026-02-10', 'el 40 % se preveía el día 40');
    igual(vencido.atrasoFechaDias, nucleoDiasEntre('2026-02-10', '2026-11-21'), 'atraso = de la fecha ganada a hoy'); igual(vencido.atrasoFechaDias, 284, 'son 284 días');
    assert(vencido.atrasoFechaDias <= nucleoDiasEntre('2026-01-01', '2026-11-21'), 'no supera los 324 transcurridos');
    // Barrido: muchas combinaciones de producción y fecha, con rubros escalonados y uno que empieza tarde
    const cron = [fila('r1', '2026-02-01', '2026-03-01'), fila('r2', '2026-02-15', '2026-06-15'), fila('r3', '2026-09-01', '2026-09-01')];
    let casos = 0, medibles = 0;
    for(let i = 0; i <= 40; i++){
      const hoy = nucleoSumarDias('2026-01-20', i * 13);
      for(const [p1, p2, p3] of [[0, 0, 0], [10, 0, 0], [300, 5, 0], [500, 200, 0], [500, 299, 0], [500, 300, 199], [0, 300, 200]]){
        const e = nucleoEvmProyecto({ rubros: [rubro('r1', 500, p1), rubro('r2', 300, p2), rubro('r3', 200, p3)], cronograma: cron, lineaBaseActivaId: 'zzz-lb', hoy });
        const tope = Math.max(0, nucleoDiasEntre('2026-02-01', hoy));
        // null solo cuando el plan a la fecha aún no llega al mínimo (antes de empezar); si no, un entero acotado
        if(!e.spiValido){ igual(e.atrasoFechaDias, null, `hoy ${hoy}, producción ${p1}/${p2}/${p3}: sin SPI válido el atraso es null`); assert(e.planPct <= NUCLEO_CARTERA.PLAN_MINIMO_PCT, `hoy ${hoy}: plan ${e.planPct} sin SPI válido`); }
        else assert(Number.isInteger(e.atrasoFechaDias) && e.atrasoFechaDias >= 0 && e.atrasoFechaDias <= tope, `hoy ${hoy}, producción ${p1}/${p2}/${p3}: atraso ${e.atrasoFechaDias} fuera de 0..${tope}`);
        if(e.fechaGanada !== null) assert(e.fechaGanada >= '2026-02-01' && e.fechaGanada <= hoy, `hoy ${hoy}: fecha ganada ${e.fechaGanada} fuera del intervalo`);
        igual(e.atrasoDias, e.atrasoFechaDias || 0, 'atrasoDias = atrasoFechaDias || 0');
        casos++; if(e.spiValido) medibles++;
      }
    }
    igual(casos, 287, 'combinaciones probadas'); assert(medibles >= 270, 'casi todas con atraso medible (' + medibles + ')');
  });

  await prueba('atraso a la fecha con varios rubros escalonados: el día exacto', () => {
    // r1 pesa 50 % (1 a 11-ene), r2 30 % (6 a 26-ene), r3 20 % (21 a 31-ene). Plan por día desde el 1-ene:
    //   día 9: 51 · día 10: 57,5 · día 11: 59 · día 12: 60,5 · … · día 22 (23-ene): 79,5
    const con = (p2, hoy = '2026-01-23') => nucleoEvmProyecto({
      rubros: [rubro('r1', 500, 500), rubro('r2', 300, p2), rubro('r3', 200, 0)],
      cronograma: [fila('r3', '2026-01-21', '2026-01-31'), fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-01-06', '2026-01-26')],
      lineaBaseActivaId: 'zzz-lb', hoy
    });
    const e = con(60);                       // valor ganado 50 + 6 = 56
    igual(e.primerInicio, '2026-01-01', 'primerInicio'); igual(e.ultimoFin, '2026-01-31', 'ultimoFin');
    casi(e.planPct, 79.5, 'plan del 23-ene = 50 + 25,5 + 4'); casi(e.evPct, 56, 'valor ganado');
    igual(e.fechaGanada, '2026-01-10', 'el último día en que el plan no superaba 56 es el día 9 (51; el día 10 ya iba en 57,5)'); igual(e.atrasoFechaDias, 13, 'del 10 al 23 de enero');
    igual(con(75).fechaGanada, '2026-01-11', 'con 57,5 exactos ya es el día 10'); igual(con(75).atrasoFechaDias, 12, '57,5: 12 días');
    igual(con(76).fechaGanada, '2026-01-11', 'con 57,6 sigue siendo el día 10 (el 11 iba en 59)'); igual(con(76).atrasoFechaDias, 12, '57,6: 12 días');
    igual(con(104).fechaGanada, '2026-01-12', 'con 60,4, el día 11 (59; el 12 iba en 60,5)'); igual(con(104).atrasoFechaDias, 11, '60,4: 11 días');
    igual(con(105).fechaGanada, '2026-01-13', 'con 60,5 exactos, el día 12'); igual(con(105).atrasoFechaDias, 10, '60,5: 10 días');
    // El plan a hoy (79,5) exige r2 al 85 % y r3 al 20 %: con r2 completo (80) va adelantado
    igual(con(300).atrasoFechaDias, 0, 'adelantado: 0');
    // Un mes después de vencer, con el mismo 56 %: la fecha ganada no se mueve, el atraso sí
    const tarde = con(60, '2026-03-02');
    igual(tarde.cronogramaVencido, true, 'vencido'); igual(tarde.fechaGanada, '2026-01-10', 'misma fecha ganada'); igual(tarde.atrasoFechaDias, 51, 'del 10-ene al 2-mar');
  });

  await prueba('atraso a la fecha con MESETA en el plan (pausa programada de meses): se cuenta desde el fin de la pausa, sin el hueco', () => {
    // Fase 1 (50 %): 1 a 11-ene. Pausa programada. Fase 2 (50 %): 1 a 11-jul. Entre el 11-ene y el 1-jul el plan está plano en 50 %.
    const con = (p1, p2, hoy) => nucleoEvmProyecto({ rubros: [rubro('r1', 500, p1), rubro('r2', 500, p2)],
      cronograma: [fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-07-01', '2026-07-11')], lineaBaseActivaId: 'zzz-lb', hoy });
    // Durante la pausa, con la fase 1 hecha: al día (valor ganado 50 = plan 50)
    const enPausa = con(500, 0, '2026-04-01');
    casi(enPausa.planPct, 50, 'en la pausa: plan'); casi(enPausa.spi, 1, 'en la pausa: SPI 1'); igual(enPausa.atrasoFechaDias, 0, 'en la pausa: sin atraso');
    // El día en que se reanuda (1-jul) el plan sigue en 50: tampoco hay atraso
    igual(con(500, 0, '2026-07-01').atrasoFechaDias, 0, 'el día de la reanudación: sin atraso');
    // 6-jul (día 5 de la fase 2, plan 75 %) sin haber reanudado: 5 días de atraso, NO los 176 que van desde el 11-ene
    const e = con(500, 0, '2026-07-06');
    casi(e.planPct, 75, 'plan del 6-jul'); casi(e.evPct, 50, 'valor ganado: solo la fase 1');
    igual(e.fechaGanada, '2026-07-01', 'fecha ganada: el último día de la meseta, no el primero (11-ene)');
    igual(e.atrasoFechaDias, 5, 'atraso: del 1 al 6 de julio'); igual(nucleoDiasEntre('2026-01-11', '2026-07-06'), 176, 'con el hueco serían 176');
    igual(semEjec({ evm: e, garantias: SIN_GAR, pendientes: 0 }).motivos.join('|'), 'SPI 0,66', 'rojo por SPI, no por un atraso de meses');
    // Con algo de la fase 2 hecho (10 % → valor ganado 55 = plan del día 1 de la fase 2) → 2-jul → 4 días
    const algo = con(500, 50, '2026-07-06');
    igual(algo.fechaGanada, '2026-07-02', 'con 55 %: fecha ganada'); igual(algo.atrasoFechaDias, 4, 'con 55 %: 4 días');
    // Ya vencido (11-ago) sin reanudar: 41 días desde el 1-jul
    igual(con(500, 0, '2026-08-11').atrasoFechaDias, 41, 'un mes después del fin: del 1-jul al 11-ago');
    // Si la fase 1 quedó sin terminar (90 % → valor ganado 45), el atraso SÍ viene de antes de la pausa:
    // ese trabajo debía estar hecho el 10-ene (día 9, plan 45 %)
    const fase1 = con(450, 0, '2026-04-01');
    igual(fase1.fechaGanada, '2026-01-10', 'fase 1 al 90 %: fecha ganada'); igual(fase1.atrasoFechaDias, 81, 'fase 1 al 90 %: del 10-ene al 1-abr');
    // Meseta al inicio del proyecto: un hito de peso mínimo y meses después la obra
    const hito = (p2, hoy) => nucleoEvmProyecto({ rubros: [rubro('r1', 10, 10), rubro('r2', 990, p2)],
      cronograma: [fila('r1', '2026-01-01', '2026-01-01'), fila('r2', '2026-06-01', '2026-06-11')], lineaBaseActivaId: 'zzz-lb', hoy });
    const h = hito(0, '2026-06-06');
    casi(h.planPct, 50.5, 'hito + media obra: plan'); igual(h.fechaGanada, '2026-06-01', 'hito: fecha ganada al final de la meseta'); igual(h.atrasoFechaDias, 5, 'hito: 5 días, no 156');
  });

  await prueba('atraso a la fecha: tope por fechaInicioProyecto posterior al primer inicio programado (y fecha de inicio futura → 0)', () => {
    const con = (prod, hoy, fechaInicioProyecto) => nucleoEvmProyecto({ rubros: [rubro('r1', 1000, prod)], cronograma: [fila('r1', '2026-01-01', '2026-04-11')], lineaBaseActivaId: 'zzz-lb', hoy, fechaInicioProyecto });
    // Sin nada hecho el día 60 (2-mar): 60 días desde el primer inicio programado
    igual(con(0, '2026-03-02').atrasoFechaDias, 60, 'sin fecha de inicio: 60');
    for(const [que, v] of [['null', null], ['undefined', undefined], ['texto vacío', '']]) igual(con(0, '2026-03-02', v).atrasoFechaDias, 60, 'fecha de inicio ' + que + ': 60');
    // El proyecto empezó de verdad el 20-feb: no puede llevar más de 10 días de atraso
    const e = con(0, '2026-03-02', '2026-02-20');
    igual(e.atrasoFechaDias, 10, 'inicio el 20-feb: tope de 10 días'); igual(e.atrasoDias, 10, 'atrasoDias'); igual(e.fechaGanada, '2026-01-01', 'la fecha ganada no cambia');
    igual(e.primerInicio, '2026-01-01', 'primerInicio sigue siendo el del cronograma'); casi(e.spi, 0, 'el SPI no cambia');
    igual(con(0, '2026-03-02', '2026-02-20T08:00:00-05:00').atrasoFechaDias, 10, 'fecha de inicio con hora: cuenta el día');
    igual(con(0, '2026-03-02', '2026-03-01').atrasoFechaDias, 1, 'inicio ayer: 1'); igual(con(0, '2026-03-02', '2026-03-02').atrasoFechaDias, 0, 'inicio hoy: 0');
    // Fecha de inicio anterior (o igual) al primer inicio programado: manda el cronograma
    igual(con(0, '2026-03-02', '2025-06-01').atrasoFechaDias, 60, 'inicio anterior al cronograma: 60');
    igual(con(0, '2026-03-02', '2026-01-01').atrasoFechaDias, 60, 'inicio el mismo día: 60');
    // Fecha de inicio FUTURA: 0 (no negativo ni null), aunque el SPI siga contando
    const futuro = con(0, '2026-03-02', '2026-12-01');
    igual(futuro.atrasoFechaDias, 0, 'inicio futuro: 0'); igual(futuro.atrasoDias, 0, 'inicio futuro: atrasoDias 0'); igual(futuro.spiValido, true, 'inicio futuro: el SPI sigue siendo válido');
    // El tope solo recorta: si el atraso real es menor, se queda el real (45 % el día 60 → 15 días; tope 29)
    igual(con(450, '2026-03-02', '2026-02-01').atrasoFechaDias, 15, 'tope de 29 días que no llega a actuar');
    igual(con(450, '2026-03-02', '2026-02-25').atrasoFechaDias, 5, 'tope de 5 días que sí actúa');
    // Adelantado: 0 con cualquier fecha de inicio
    igual(con(800, '2026-03-02', '2026-02-20').atrasoFechaDias, 0, 'adelantado');
    // El atraso proyectado no depende de la fecha de inicio
    igual(con(450, '2026-03-02', '2026-02-25').atrasoProyectadoDias, con(450, '2026-03-02').atrasoProyectadoDias, 'proyectado igual');
    // Una fecha de inicio mal formada LANZA, como cualquier otra fecha
    lanza(() => con(0, '2026-03-02', '20/02/2026'), 'fecha de inicio dd/mm/aaaa', /^Fecha no válida/);
    lanza(() => con(0, '2026-03-02', '2026-02-30'), 'fecha de inicio inexistente', /^Fecha inexistente/);
    lanza(() => con(0, '2026-03-02', new Date('2026-02-20T00:00:00Z')), 'fecha de inicio como Date', /^Fecha no válida/);
  });

  await prueba('EVM: fila con el fin ANTERIOR al inicio → se toma con las fechas intercambiadas', () => {
    const rubros = [rubro('r1', 600, 150), rubro('r2', 400, 0)];
    const derecho = nucleoEvmProyecto({ rubros, cronograma: [fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-01-11', '2026-01-21')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-06' });
    const invertido = nucleoEvmProyecto({ rubros, cronograma: [fila('r1', '2026-01-11', '2026-01-01'), fila('r2', '2026-01-21', '2026-01-11')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-06' });
    casi(invertido.planPct, 30, 'plan a la fecha: 60 × 0,5 (y no 0 ni 60)'); casi(invertido.spi, 0.5, 'SPI');
    igual(invertido.primerInicio, '2026-01-01', 'primerInicio: la menor de las dos fechas'); igual(invertido.ultimoFin, '2026-01-21', 'ultimoFin: la mayor');
    igual(invertido.atrasoFechaDias, 3, 'atraso a la fecha'); igual(invertido.atrasoProyectadoDias, 20, 'atraso proyectado (duración 20 días, no negativa)');
    assert(invertido.filasCronogramaInvertidas > 0, 'las filas invertidas se cuentan'); igual(derecho.filasCronogramaInvertidas, 0, 'y la que está en orden no');
    igual(JSON.stringify({ ...invertido, filasCronogramaInvertidas: 0 }), JSON.stringify(derecho), 'el resto del resultado es el mismo que con las fechas en su orden');
    assert(N.nucleoDatosPorCompletar({ evm: invertido, estado: 'ejecucion' }).some(t => /fecha de fin anterior a la de inicio/.test(t)), 'y sale como dato por completar');
    // Una sola fila invertida, ya vencida: vencido desde la fecha mayor
    const una = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 500)], cronograma: [fila('r1', '2026-03-31', '2026-03-01')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-04-10' });
    igual(una.ultimoFin, '2026-03-31', 'una fila: ultimoFin'); igual(una.cronogramaVencido, true, 'una fila: vencido'); casi(una.planPct, 100, 'una fila: plan 100');
    igual(una.fechaGanada, '2026-03-16', 'una fila: el 50 % se preveía el día 15'); igual(una.atrasoFechaDias, 25, 'una fila: del 16-mar al 10-abr');
    // Fechas invertidas con hora
    igual(nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 500)], cronograma: [fila('r1', '2026-03-31T00:00:00+00:00', '2026-03-01T00:00:00+00:00')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-04-10' }).primerInicio, '2026-03-01', 'con hora');
  });

  // ── Atraso proyectado ─────────────────────────────────────────────────────
  await prueba('atraso proyectado = duración del cronograma × (1/SPI − 1); null si no es estimable; 0 si SPI ≥ 1', () => {
    igual(lineal(400, '2026-02-20').atrasoProyectadoDias, 25, 'día 50 con 40 %: SPI 0,80 → 100 × 0,25');
    igual(lineal(250, '2026-02-20').atrasoProyectadoDias, 100, 'SPI 0,50 → 100 × 1');
    igual(lineal(450, '2026-03-02').atrasoProyectadoDias, 33, 'SPI 0,75 → 33,3 redondeado');
    igual(lineal(0, '2026-02-20').atrasoProyectadoDias, null, 'SPI 0: no es estimable');
    igual(lineal(0, '2026-02-20').atrasoFechaDias, 50, '…pero el atraso a la fecha sí: 50 días');
    igual(lineal(500, '2026-02-20').atrasoProyectadoDias, 0, 'SPI 1 exacto'); igual(lineal(700, '2026-02-20').atrasoProyectadoDias, 0, 'SPI 1,4');
    // La duración es del primer inicio al último fin de las filas que cuentan
    const dos = nucleoEvmProyecto({ rubros: [rubro('r1', 500, 100), rubro('r2', 500, 0)], cronograma: [fila('r2', '2026-02-01', '2026-02-21'), fila('r1', '2026-01-01', '2026-01-21')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-11' });
    casi(dos.spi, 0.4, 'spi'); igual(dos.atrasoProyectadoDias, 77, '51 días × (1/0,4 − 1) = 76,5 → 77');
    // Recién vencido (un día): manda la proyección (11), que es mayor que lo ya pasado del fin (1)
    igual(lineal(900, '2026-04-12').atrasoProyectadoDias, 11, 'SPI 0,90 → 11,1');
  });

  await prueba('atraso proyectado: null con SPI menor que 0,10 y con plan insignificante (no estimable)', () => {
    // Día 60 (plan 60 %) con 3 % ganado: SPI 0,05. La fórmula daría 1.900 días: no se estima
    const e = lineal(30, '2026-03-02');
    casi(e.spi, 0.05, 'SPI 0,05'); igual(e.spiValido, true, 'el SPI es válido (y pinta rojo)'); igual(e.atrasoProyectadoDias, null, 'proyectado: no estimable');
    igual(e.atrasoFechaDias, 57, '…pero el atraso a la fecha sí: el 3 % se preveía el día 3 → 57 días');
    igual(semEjec({ evm: e, garantias: SIN_GAR, pendientes: 0 }).motivos.join('|'), 'SPI 0,05|atraso a la fecha de 57 días', 'el semáforo no depende del proyectado');
    // A los dos lados del mínimo (día 50, plan 50 %): 0,09 no se estima; 0,11 sí
    const bajo = lineal(45, '2026-02-20'), sobre = lineal(55, '2026-02-20');
    casi(bajo.spi, 0.09, 'SPI 0,09'); igual(bajo.atrasoProyectadoDias, null, 'SPI 0,09: null');
    casi(sobre.spi, 0.11, 'SPI 0,11'); igual(sobre.atrasoProyectadoDias, 809, 'SPI 0,11: 100 × (1/0,11 − 1) = 809,1');
    assert(bajo.spi < NUCLEO_CARTERA.SPI_MINIMO_PROYECCION && sobre.spi >= NUCLEO_CARTERA.SPI_MINIMO_PROYECCION, 'a cada lado de SPI_MINIMO_PROYECCION');
    igual(lineal(0, '2026-02-20').atrasoProyectadoDias, null, 'SPI 0: null');
    // SPI muy bajo con el cronograma vencido: sigue sin estimarse (no se cambia por los días pasados del fin)
    const vencido = lineal(30, '2026-06-01');
    igual(vencido.cronogramaVencido, true, 'vencido'); casi(vencido.spi, 0.03, 'SPI 0,03'); igual(vencido.atrasoProyectadoDias, null, 'vencido con SPI 0,03: null');
    // Plan a la fecha insignificante (0,4 %): el SPI no es válido y no hay ninguno de los dos atrasos
    const arranque = nucleoEvmProyecto({ rubros: [rubro('r1', 4, 0), rubro('r2', 996, 0)], cronograma: [fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-06-01', '2026-12-01')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-03-01' });
    casi(arranque.planPct, 0.4, 'arranque: plan 0,4 %'); igual(arranque.spi, 0, 'arranque: hay SPI (0)'); igual(arranque.spiValido, false, 'arranque: no válido');
    igual(arranque.atrasoProyectadoDias, null, 'arranque: proyectado null'); igual(arranque.atrasoFechaDias, null, 'arranque: atraso a la fecha null'); igual(arranque.atrasoDias, 0, 'arranque: atrasoDias 0');
    // Con el plan insignificante pero la obra adelantada tampoco se afirma un 0
    const adelantado = nucleoEvmProyecto({ rubros: [rubro('r1', 4, 4), rubro('r2', 996, 100)], cronograma: [fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-06-01', '2026-12-01')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-03-01' });
    igual(adelantado.spiValido, false, 'adelantado en el arranque: SPI no válido'); igual(adelantado.atrasoProyectadoDias, null, 'adelantado en el arranque: null');
    // Sin cronograma
    igual(nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 10)], cronograma: [], lineaBaseActivaId: 'zzz-lb', hoy: '2026-03-01' }).atrasoProyectadoDias, null, 'sin cronograma: null');
  });

  await prueba('atraso proyectado con el cronograma VENCIDO: nunca menos que los días que ya lleva pasada del fin', () => {
    // 100 días (1-ene a 11-abr), obra al 90 %: la fórmula da 11 días
    igual(lineal(900, '2026-04-11').atrasoProyectadoDias, 11, 'el día del fin: 11 (aún no está vencido)');
    igual(lineal(900, '2026-04-12').atrasoProyectadoDias, 11, '1 día pasado: sigue mandando la proyección');
    igual(lineal(900, '2026-04-22').atrasoProyectadoDias, 11, '11 días pasados: empate');
    igual(lineal(900, '2026-04-23').atrasoProyectadoDias, 12, '12 días pasados: ya manda lo pasado del fin');
    igual(lineal(900, '2027-04-12').atrasoProyectadoDias, 366, 'un año y un día después: 366, no 11');
    // Con SPI 0,50 la proyección (100) manda hasta que lo pasado la supera
    igual(lineal(500, '2026-04-21').atrasoProyectadoDias, 100, 'SPI 0,50, 10 días pasados: 100');
    igual(lineal(500, '2026-12-31').atrasoProyectadoDias, 264, 'SPI 0,50, 264 días pasados: 264');
    // Vencido pero con lo programado terminado: 0
    igual(lineal(1000, '2027-04-12').atrasoProyectadoDias, 0, 'terminada por producción: 0');
    igual(lineal(100, '2027-04-12', 'terminado').atrasoProyectadoDias, 0, 'rubro terminado: 0');
    // En todo el recorrido: no vencido = la fórmula; vencido = al menos lo pasado del fin
    for(let d = 100; d <= 600; d += 7){
      const hoy = nucleoSumarDias('2026-01-01', d), e = lineal(700, hoy), pasados = nucleoDiasEntre('2026-04-11', hoy);
      igual(e.atrasoProyectadoDias, Math.max(43, pasados), hoy + ': max(100 × (1/0,7 − 1) = 42,9 → 43, ' + pasados + ' días pasados)');
    }
  });

  await prueba('EVM: el atraso cuenta desde el primer inicio programado, y es 0 si hoy es ese día', () => {
    const rubros = [rubro('r1', 500, 100), rubro('r2', 500, 0)];
    const cronograma = [fila('r2', '2026-02-01', '2026-02-21'), fila('r1', '2026-01-01', '2026-01-21')];
    const e = nucleoEvmProyecto({ rubros, cronograma, lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-11' });
    igual(e.primerInicio, '2026-01-01', 'primerInicio'); igual(e.ultimoFin, '2026-02-21', 'ultimoFin');
    casi(e.planPct, 25, 'planPct'); casi(e.evPct, 10, 'evPct'); casi(e.spi, 0.4, 'spi');
    igual(e.fechaGanada, '2026-01-05', 'el plan (2,5 puntos por día) llegaba a 10 % el día 4'); igual(e.atrasoFechaDias, 6, 'del 5 al 11 de enero');
    const primerDia = nucleoEvmProyecto({ rubros, cronograma, lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-01' });
    igual(primerDia.atrasoFechaDias, null, 'el día del primer inicio: aún no hay plan, no se mide'); igual(primerDia.atrasoDias, 0, '…y para el semáforo es 0'); igual(primerDia.spi, null, 'sin SPI todavía');
  });

  await prueba('EVM + semáforo: cronograma vencido — el atraso a la fecha sigue corriendo y la proyección no baja de lo ya pasado; rojo mientras la obra no termine', () => {
    // 270 días de cronograma (1-ene a 28-sep), obra detenida al 90 %: el plan preveía 90 % el día 243 (1-sep)
    const con = (hoy, prod = 90, estado = 'trabajando') => nucleoEvmProyecto({ rubros: [rubro('r1', 100, prod, estado)], cronograma: [fila('r1', '2026-01-01', '2026-09-28')], lineaBaseActivaId: 'zzz-lb', hoy });
    const elDia = con('2026-09-28');
    igual(elDia.cronogramaVencido, false, 'el día del último fin todavía no está vencido'); igual(elDia.fechaGanada, '2026-09-01', 'fecha ganada');
    igual(elDia.atrasoFechaDias, 27, 'atraso a la fecha el día del fin'); igual(elDia.atrasoProyectadoDias, 30, 'proyectado: 270 × (1/0,9 − 1)');
    const sDia = semEjec({ evm: elDia, garantias: SIN_GAR, pendientes: 0 });
    igual(sDia.color, 'amarillo', 'el día del fin: amarillo por SPI'); igual(sDia.motivos.join('|'), 'SPI 0,90', 'motivos el día del fin');
    for(const [que, hoy, atraso, proyectado] of [['al día siguiente', '2026-09-29', 28, 30], ['3 días después', '2026-10-01', 30, 30], ['4 días después', '2026-10-02', 31, 30],
      ['31 días después', '2026-10-29', 58, 31], ['un año después', '2027-09-28', 392, 365]]){
      const e = con(hoy);
      igual(e.cronogramaVencido, true, que + ': cronograma vencido'); casi(e.spi, 0.9, que + ': SPI');
      igual(e.atrasoFechaDias, atraso, que + ': atraso a la fecha'); igual(e.atrasoProyectadoDias, proyectado, que + ': proyección = max(30, días pasados del fin)');
      igual(e.obraProgramadaTerminada, false, que + ': lo programado no está terminado');
      assert(e.atrasoFechaDias <= nucleoDiasEntre('2026-01-01', hoy), que + ': no supera lo transcurrido');
      const s = semEjec({ evm: e, garantias: SIN_GAR, pendientes: 0 });
      igual(s.color, 'rojo', que + ': rojo');
      igual(s.motivos.join('|'), 'cronograma vencido el 2026-09-28 con 90,0 % de lo programado' + (atraso > 30 ? `|atraso a la fecha de ${atraso} días` : '') + '|SPI 0,90', que + ': motivos');
    }
    // Obra terminada con el cronograma vencido: ni vencido ni atraso
    for(const [que, e] of [['producción completa', con('2027-09-28', 100)], ['rubro terminado', con('2027-09-28', 40, 'terminado')]]){
      igual(e.cronogramaVencido, true, que + ': el cronograma sí venció'); igual(e.atrasoFechaDias, 0, que + ': sin atraso');
      igual(e.obraProgramadaTerminada, true, que + ': lo programado está terminado'); igual(e.atrasoProyectadoDias, 0, que + ': sin atraso proyectado');
      const s = semEjec({ evm: e, garantias: SIN_GAR, pendientes: 0 });
      igual(s.color, 'verde', que + ': verde'); igual(s.motivos.length, 0, que + ': sin motivos');
    }
    // El último fin es el de la fila que cuenta (línea base activa), no el de otra línea base
    const otraLb = nucleoEvmProyecto({ rubros: [rubro('r1', 100, 90), rubro('r2', 0, 0)],
      cronograma: [fila('r1', '2026-01-01', '2026-09-28'), fila('r2', '2030-01-01', '2030-01-01', 'zzz-lb-otra')], lineaBaseActivaId: 'zzz-lb', hoy: '2027-09-28' });
    igual(otraLb.ultimoFin, '2026-09-28', 'ultimoFin de la línea base activa'); igual(otraLb.cronogramaVencido, true, 'vencido');
    // Sin cronograma no hay nada que venza
    igual(nucleoEvmProyecto({ rubros: [rubro('r1', 100, 90)], cronograma: [], lineaBaseActivaId: 'zzz-lb', hoy: '2030-01-01' }).cronogramaVencido, false, 'sin cronograma');
  });

  await prueba('EVM + semáforo: atraso a la fecha de 30 días no es rojo; de 31, sí', () => {
    // Actividad de 1.000 días (el plan sube 0,1 puntos por día); hoy es el día 700: plan 70 %
    const fin = nucleoSumarDias('2026-01-01', 1000), hoy = nucleoSumarDias('2026-01-01', 700);
    const con = prod => nucleoEvmProyecto({ rubros: [rubro('r1', 1000, prod)], cronograma: [fila('r1', '2026-01-01', fin)], lineaBaseActivaId: 'zzz-lb', hoy });
    const a30 = con(670), a31 = con(669);
    igual(a30.cronogramaVencido, false, 'el cronograma no ha vencido');
    igual(a30.atrasoFechaDias, 30, '67,0 % → se preveía el día 670 → 30'); igual(a31.atrasoFechaDias, 31, '66,9 % → el día 669 → 31');
    assert(a30.spi >= NUCLEO_CARTERA.SPI_AMARILLO && a31.spi >= NUCLEO_CARTERA.SPI_AMARILLO, 'el SPI de los dos está en verde (' + a31.spi + ')');
    const s30 = semEjec({ evm: a30, garantias: SIN_GAR, pendientes: 0 });
    igual(s30.color, 'verde', '30 días: verde'); igual(s30.motivos.length, 0, '30 días: sin motivos');
    const s31 = semEjec({ evm: a31, garantias: SIN_GAR, pendientes: 0 });
    igual(s31.color, 'rojo', '31 días: rojo'); igual(s31.motivos.join('|'), 'atraso a la fecha de 31 días', 'motivo con 31');
    // Con SPI amarillo: a 30 días manda el SPI; a 31, el atraso va primero
    const hoy500 = nucleoSumarDias('2026-01-01', 500);
    const con500 = prod => nucleoEvmProyecto({ rubros: [rubro('r1', 1000, prod)], cronograma: [fila('r1', '2026-01-01', fin)], lineaBaseActivaId: 'zzz-lb', hoy: hoy500 });
    igual(semEjec({ evm: con500(470), garantias: SIN_GAR, pendientes: 0 }).motivos.join('|'), 'SPI 0,94', 'SPI 0,94 con 30 días: amarillo');
    const s = semEjec({ evm: con500(469), garantias: SIN_GAR, pendientes: 0 });
    igual(s.color, 'rojo', 'SPI 0,93 con 31 días'); igual(s.motivos.join('|'), 'atraso a la fecha de 31 días|SPI 0,93', 'motivos: primero el que decide');
    // El semáforo mira el atraso a la fecha, no el proyectado
    const soloProyectado = semEjec({ evm: evmDe({ spi: 0.97, atrasoFechaDias: 3, atrasoProyectadoDias: 400 }), garantias: SIN_GAR, pendientes: 0 });
    igual(soloProyectado.color, 'verde', 'un atraso proyectado de 400 días no pinta');
  });

  // ── Garantías ─────────────────────────────────────────────────────────────
  const HOY = '2026-11-21';
  const gar = (hasta, estado = 'vigente') => ({ proyecto_id: 'zzz-p', vigencia_hasta: hasta, estado });

  await prueba('garantías: sin fecha no cuenta; vencida ayer; vence hoy; vence en 5 y en 6 días', () => {
    const cuenta = lista => { const g = nucleoGarantias(lista, HOY); return g.vencidas + '/' + g.porVencer; };
    igual(cuenta([gar(null)]), '0/0', 'sin fecha de vigencia');
    igual(cuenta([gar('')]), '0/0', 'fecha vacía');
    igual(cuenta([gar('2026-11-20')]), '1/0', 'vencida ayer');
    igual(cuenta([gar('2025-01-01')]), '1/0', 'vencida hace mucho');
    igual(cuenta([gar('2026-11-21')]), '0/1', 'vence hoy: por vencer, no vencida');
    igual(cuenta([gar('2026-11-22')]), '0/1', 'vence mañana');
    igual(cuenta([gar('2026-11-26')]), '0/1', 'vence en 5 días');
    igual(cuenta([gar('2026-11-27')]), '0/0', 'vence en 6 días');
    igual(cuenta([gar('2027-11-21')]), '0/0', 'vence en un año');
  });

  await prueba('garantías: solo las de estado vigente; lista vacía, nula o con huecos; fecha con hora', () => {
    const g = nucleoGarantias([gar('2026-11-20', 'devuelta'), gar('2026-11-22', 'ejecutada'), { proyecto_id: 'zzz-p', vigencia_hasta: '2026-11-20' }, null, gar('2026-11-20'), gar('2026-11-23'), gar('2026-11-24'), gar(null)], HOY);
    igual(g.vencidas, 1, 'vencidas'); igual(g.porVencer, 2, 'porVencer');
    igual(JSON.stringify(nucleoGarantias(null, HOY)), '{"vencidas":0,"porVencer":0,"diasAviso":5}', 'lista nula');
    igual(JSON.stringify(nucleoGarantias([], HOY)), '{"vencidas":0,"porVencer":0,"diasAviso":5}', 'lista vacía');
    igual(nucleoGarantias([gar('2026-11-21T23:59:59+00:00')], HOY).porVencer, 1, 'fecha con hora: cuenta el día');
    igual(nucleoGarantias([gar('2026-11-20T23:59:59+00:00')], HOY).vencidas, 1, 'fecha con hora, ayer');
  });

  await prueba('garantías: días de aviso a pedido (15 para «Esperan decisión», 0 = solo hoy)', () => {
    igual(nucleoGarantias([gar('2026-12-06')], HOY, 15).porVencer, 1, 'vence en 15 días con aviso de 15');
    igual(nucleoGarantias([gar('2026-12-07')], HOY, 15).porVencer, 0, 'vence en 16 días con aviso de 15');
    igual(nucleoGarantias([gar('2026-12-06')], HOY).porVencer, 0, 'con el aviso por defecto (5) no entra');
    igual(nucleoGarantias([gar('2026-11-21')], HOY, 0).porVencer, 1, 'aviso 0: la que vence hoy');
    igual(nucleoGarantias([gar('2026-11-22')], HOY, 0).porVencer, 0, 'aviso 0: la de mañana no');
    igual(nucleoGarantias([gar('2026-11-20')], HOY, 15).vencidas, 1, 'las vencidas no dependen del aviso');
  });

  await prueba('garantías: el resultado dice con qué aviso se contó; null y undefined son el oficial (5), no 0', () => {
    igual(nucleoGarantias([], HOY).diasAviso, 5, 'sin tercer argumento');
    igual(nucleoGarantias([], HOY, undefined).diasAviso, 5, 'undefined');
    igual(nucleoGarantias([], HOY, null).diasAviso, 5, 'null');
    igual(nucleoGarantias([], HOY, 15).diasAviso, 15, '15');
    igual(nucleoGarantias([], HOY, 0).diasAviso, 0, '0 es un aviso válido (solo hoy)');
    // Con null la que vence en 3 días SÍ entra (con la regla vieja, null era 0 días y no entraba)
    igual(nucleoGarantias([gar('2026-11-24')], HOY, null).porVencer, 1, 'null: vence en 3 días');
    igual(nucleoGarantias([gar('2026-11-27')], HOY, null).porVencer, 0, 'null: vence en 6 días');
    for(const [que, v] of Object.entries({ 'texto': '15', 'NaN': NaN, 'negativo': -1, 'decimal': 2.5, 'objeto': {} })) lanza(() => nucleoGarantias([], HOY, v), 'aviso ' + que, /aviso/);
  });

  await prueba('semáforo: rechaza garantías contadas con otro aviso (15 días de «Esperan decisión») o sin aviso declarado', () => {
    const lista = [gar('2026-12-01')];                     // vence en 10 días
    const de15 = nucleoGarantias(lista, HOY, 15), de5 = nucleoGarantias(lista, HOY);
    igual(de15.porVencer, 1, 'con 15 días entra'); igual(de5.porVencer, 0, 'con 5 no');
    lanza(() => semEjec({ evm: evmDe(), garantias: de15, pendientes: 0 }), 'conteo de 15 días', /aviso de 5 días.*diasAviso = 15/);
    lanza(() => semEjec({ evm: evmDe(), garantias: nucleoGarantias([], HOY, 15), pendientes: 0 }), 'conteo de 15 días sin ninguna garantía', /aviso de 5 días/);
    lanza(() => semEjec({ evm: evmDe(), garantias: nucleoGarantias(lista, HOY, 0), pendientes: 0 }), 'conteo de 0 días', /diasAviso = 0/);
    lanza(() => semEjec({ evm: evmDe(), garantias: { vencidas: 0, porVencer: 1 }, pendientes: 0 }), 'conteo a mano sin diasAviso', /diasAviso = undefined/);
    // Con el oficial (por defecto, null o 5 explícito) pasa, y el proyecto queda verde: no hay amarillo de más
    for(const g of [de5, nucleoGarantias(lista, HOY, null), nucleoGarantias(lista, HOY, 5)]){
      const s = semEjec({ evm: evmDe(), garantias: g, pendientes: 0 });
      igual(s.color, 'verde', 'con el aviso oficial'); igual(s.motivos.length, 0, 'sin motivos');
    }
    // El texto del motivo sale del aviso del conteo, que es el de la constante
    const s = semEjec({ evm: evmDe(), garantias: nucleoGarantias([gar('2026-11-24')], HOY), pendientes: 0 });
    igual(s.motivos.join('|'), `1 garantía por vencer en ${NUCLEO_CARTERA.GARANTIA_AVISO_DIAS} días o menos`, 'texto del motivo');
  });

  await prueba('nucleoSpiTruncado: trunca a dos decimales sin errores de coma flotante', () => {
    igual(nucleoSpiTruncado(null), null, 'null'); igual(nucleoSpiTruncado(undefined), null, 'undefined'); igual(nucleoSpiTruncado(NaN), null, 'NaN');
    const casos = [[0, 0], [0.004, 0], [0.5, 0.5], [0.8499, 0.84], [0.849999999999, 0.84], [0.85, 0.85], [0.8501, 0.85], [0.859, 0.85],
      [0.9499, 0.94], [0.95, 0.95], [0.999, 0.99], [1, 1], [1.2, 1.2], [1.999, 1.99],
      // valores cuyo ×100 no es exacto en binario (0,57 × 100 = 56,99999…): no deben bajar una centésima
      [0.57, 0.57], [0.29, 0.29], [0.58, 0.58], [1.15, 1.15], [0.07, 0.07], [8.2, 8.2]];
    for(const [spi, esp] of casos) igual(nucleoSpiTruncado(spi), esp, 'truncado de ' + spi);
    // Nunca queda por encima del valor, ni a una centésima o más por debajo
    for(let i = 0; i <= 2000; i++){ const v = i / 1000 + 0.0004, t = nucleoSpiTruncado(v); assert(t <= v && v - t < 0.01, 'truncado de ' + v + ' = ' + t); }
  });

  await prueba('semáforo: el SPI del motivo se TRUNCA (0,8499 → «SPI 0,84»; 0,9499 → «SPI 0,94») y no contradice el umbral', () => {
    const motivo = spi => { const s = semEjec({ evm: evmDe({ spi }), garantias: SIN_GAR, pendientes: 0 }); return s.color + ':' + s.motivos.join('|'); };
    igual(motivo(0.8499), 'rojo:SPI 0,84', '0,8499 (redondeado diría 0,85, que es amarillo)');
    igual(motivo(0.849999999), 'rojo:SPI 0,84', '0,849999999');
    igual(motivo(0.85), 'amarillo:SPI 0,85', '0,85 exacto');
    igual(motivo(0.9499), 'amarillo:SPI 0,94', '0,9499 (redondeado diría 0,95, que es verde)');
    igual(motivo(0.899), 'amarillo:SPI 0,89', '0,899');
    igual(motivo(0.57), 'rojo:SPI 0,57', '0,57 no baja a 0,56');
    igual(motivo(0.005), 'rojo:SPI 0,00', '0,005');
    // En todo el intervalo, el número escrito cae del mismo lado del umbral que el color
    for(let i = 0; i < 950; i++){
      const spi = i / 1000 + 0.0003, s = semEjec({ evm: evmDe({ spi }), garantias: SIN_GAR, pendientes: 0 });
      const escrito = Number(/^SPI (\d+,\d{2})$/.exec(s.motivos[0])[1].replace(',', '.'));
      assert(s.color === 'rojo' ? escrito < NUCLEO_CARTERA.SPI_ROJO : escrito >= NUCLEO_CARTERA.SPI_ROJO && escrito < NUCLEO_CARTERA.SPI_AMARILLO, `SPI ${spi}: ${s.color} con «${s.motivos[0]}»`);
    }
  });

  // ── Semáforo ──────────────────────────────────────────────────────────────
  await prueba('semáforo: hay que PASAR el estado (undefined lanza: es un olvido del que llama)', () => {
    const datos = { evm: evmDe(), garantias: SIN_GAR, pendientes: 0 };
    lanza(() => nucleoSemaforo(datos), 'sin estado', /estado del proyecto/);
    lanza(() => nucleoSemaforo({}), 'objeto vacío', /estado del proyecto/);
    lanza(() => nucleoSemaforo(), 'sin argumentos', /estado del proyecto/);
    lanza(() => nucleoSemaforo({ ...datos, estado: undefined }), 'estado undefined explícito', /estado del proyecto/);
    // Lo que no es exactamente «ejecucion» no lleva color, pero tampoco lanza
    for(const [que, estado] of Object.entries({ 'número': 1, 'true': true, 'objeto': { estado: 'ejecucion' } })){
      igual(JSON.stringify(nucleoSemaforo({ ...datos, estado })), '{"color":null,"motivos":[]}', 'estado ' + que + ': sin color');
    }
    // Con el estado basta: lo demás tiene valores por defecto
    const s = nucleoSemaforo({ estado: 'ejecucion' });
    igual(s.color, 'verde', 'solo con el estado'); igual(s.motivos.length, 0, 'sin motivos');
    igual(nucleoSemaforo({ estado: 'ejecucion', evm: evmDe(), garantias: null, pendientes: null }).color, 'verde', 'garantías y pendientes nulos');
  });

  await prueba('semáforo: estado null o vacío (proyecto sin estado registrado) → sin color, y el aviso va en «datos por completar»', () => {
    const malo = evmDe({ spi: 0.1, atrasoFechaDias: 200, atrasoDias: 200, cronogramaVencido: true, ultimoFin: '2026-01-11', evPct: 5 });
    igual(nucleoSemaforo({ estado: 'ejecucion', evm: malo, garantias: G(3, 2), pendientes: 40 }).color, 'rojo', 'en ejecución esos datos son rojo');
    for(const [que, estado] of [['null', null], ['texto vacío', '']]){
      const s = nucleoSemaforo({ estado, evm: malo, garantias: G(3, 2), pendientes: 40 });
      igual(JSON.stringify(s), '{"color":null,"motivos":[]}', 'estado ' + que + ': sin color ni motivos, aunque los datos sean de rojo');
      igual(nucleoSemaforo({ estado, evm: evmDe(), garantias: SIN_GAR, pendientes: 0 }).color, null, 'estado ' + que + ': tampoco verde');
      igual(nucleoSemaforo({ estado }).color, null, 'estado ' + que + ': solo con el estado');
      igual(nucleoDatosPorCompletar({ evm: malo, estado })[0], 'proyecto sin estado registrado', 'estado ' + que + ': aviso en datos por completar');
    }
    // El aviso de garantías equivocado se rechaza igual: es un error del que llama
    lanza(() => nucleoSemaforo({ estado: null, evm: evmDe(), garantias: { vencidas: 0, porVencer: 0, diasAviso: 15 } }), 'sin estado con conteo de 15 días', /aviso de 5 días/);
  });

  await prueba('semáforo: solo «ejecucion» lleva color — planificación, pausado, finalizado y cancelado salen sin color pase lo que pase', () => {
    const malo = evmDe({ spi: 0.1, atrasoFechaDias: 200, atrasoDias: 200, cronogramaVencido: true, ultimoFin: '2026-01-11', evPct: 5 });
    // En ejecución, esos mismos datos son rojo por los cuatro motivos
    const enEjecucion = nucleoSemaforo({ estado: 'ejecucion', evm: malo, garantias: G(3, 2), pendientes: 40 });
    igual(enEjecucion.color, 'rojo', 'en ejecución: rojo');
    igual(enEjecucion.motivos.slice(0, 4).join('|'), 'SPI 0,10|cronograma vencido el 2026-01-11 con 5,0 % de lo programado|3 garantías vencidas|atraso a la fecha de 200 días', 'en ejecución: los cuatro motivos de rojo');
    for(const estado of SIN_COLOR){
      const s = nucleoSemaforo({ estado, evm: malo, garantias: G(3, 2), pendientes: 40 });
      igual(s.color, null, estado + ': sin color (null), aunque haya garantías vencidas, SPI 0,10 y 200 días de atraso');
      igual(JSON.stringify(s), '{"color":null,"motivos":[]}', estado + ': sin motivos');
      igual(nucleoSemaforo({ estado, evm: evmDe(), garantias: SIN_GAR, pendientes: 0 }).color, null, estado + ': tampoco verde cuando todo va bien');
      igual(nucleoSemaforo({ estado }).color, null, estado + ': solo con el estado');
    }
    // Las garantías vencidas de un proyecto sin color siguen contadas (van como pendiente): el conteo no depende del estado
    igual(nucleoGarantias([{ estado: 'vigente', vigencia_hasta: '2026-01-01' }], '2026-11-21').vencidas, 1, 'la garantía vencida se sigue contando');
    // Cualquier otro texto tampoco lleva color; el único que lo lleva es la constante
    igual(nucleoSemaforo({ estado: 'ZZZ otro', evm: malo, garantias: G(1, 0), pendientes: 9 }).color, null, 'estado desconocido: sin color');
    igual(nucleoSemaforo({ estado: 'Ejecucion', evm: malo }).color, null, 'se compara exacto, sin normalizar mayúsculas');
    igual(nucleoSemaforo({ estado: NUCLEO_CARTERA.ESTADO_CON_SEMAFORO, evm: evmDe() }).color, 'verde', 'el estado de la constante sí');
    // El aviso de garantías equivocado se rechaza también sin color: es un error del que llama
    lanza(() => nucleoSemaforo({ estado: 'pausado', evm: evmDe(), garantias: { vencidas: 0, porVencer: 0, diasAviso: 15 } }), 'pausado con conteo de 15 días', /aviso de 5 días/);
  });

  await prueba('semáforo: rojo por cronograma vencido sin haber terminado lo programado; NO si lo programado está terminado', () => {
    // SPI 0,99 (verde) y 9 días de vencido: lo único que lo pone rojo es el cronograma vencido
    const con = (prod, hoy = '2026-01-20', estado = 'trabajando') => nucleoEvmProyecto({ rubros: [rubro('r1', 1000, prod, estado)], cronograma: [fila('r1', '2026-01-01', '2026-01-11')], lineaBaseActivaId: 'zzz-lb', hoy });
    const e = con(990);
    // El plan sube 10 puntos por día: el último día en que no superaba el 99 % es el día 9 (90 %) → 10-ene → 10 días
    igual(e.cronogramaVencido, true, 'vencido'); casi(e.spi, 0.99, 'SPI 0,99'); igual(e.fechaGanada, '2026-01-10', 'fecha ganada'); igual(e.atrasoFechaDias, 10, 'atraso a la fecha 10 (no llega a 31)');
    igual(e.obraProgramadaTerminada, false, 'lo programado no está terminado');
    const s = semEjec({ evm: e, garantias: SIN_GAR, pendientes: 0 });
    igual(s.color, 'rojo', 'rojo'); igual(s.motivos.join('|'), 'cronograma vencido el 2026-01-11 con 99,0 % de lo programado', 'motivo propio');
    // El día del último fin todavía no está vencido
    igual(semEjec({ evm: con(990, '2026-01-11'), garantias: SIN_GAR, pendientes: 0 }).color, 'verde', 'el día del último fin: verde');
    // Valor ganado 100: por producción completa o por rubro marcado terminado
    for(const [que, evm] of [['producción completa', con(1000)], ['rubro terminado con 40 % de producción', con(400, '2026-01-20', 'terminado')], ['años después, completa', con(1000, '2029-01-20')]]){
      igual(evm.cronogramaVencido, true, que + ': el cronograma venció'); casi(evm.evPct, 100, que + ': valor ganado 100'); igual(evm.obraProgramadaTerminada, true, que + ': lo programado está terminado');
      const v = semEjec({ evm, garantias: SIN_GAR, pendientes: 0 });
      igual(v.color, 'verde', que + ': NO es rojo'); igual(v.motivos.length, 0, que + ': sin motivos');
    }
    // Umbral de «lo programado está terminado» (OBRA_TERMINADA_PCT = 99,95 % del peso con cronograma), calculado por el núcleo
    const fino = prod => nucleoEvmProyecto({ rubros: [rubro('r1', 100000, prod)], cronograma: [fila('r1', '2026-01-01', '2026-01-11')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-20' });
    igual(fino(99960).obraProgramadaTerminada, true, '99,96 %: terminada'); igual(semEjec({ evm: fino(99960), garantias: SIN_GAR, pendientes: 0 }).color, 'verde', '99,96 %: no es rojo');
    igual(fino(99940).obraProgramadaTerminada, false, '99,94 %: sin terminar');
    const s9994 = semEjec({ evm: fino(99940), garantias: SIN_GAR, pendientes: 0 });
    igual(s9994.color, 'rojo', '99,94 %: rojo'); igual(s9994.motivos[0], 'cronograma vencido el 2026-01-11 con 99,9 % de lo programado', '99,94 %: el texto no dice 100');
    // El semáforo se guía por obraProgramadaTerminada (no vuelve a comparar porcentajes) y escribe evPct / planFinalPct
    const vencido = extra => semEjec({ evm: evmDe({ cronogramaVencido: true, ultimoFin: '2026-01-11', ...extra }), garantias: SIN_GAR, pendientes: 0 });
    igual(vencido({ obraProgramadaTerminada: true }).color, 'verde', 'terminada: verde');
    igual(vencido({ evPct: 0 }).color, 'rojo', '0 %'); igual(vencido({ evPct: 0 }).motivos.join('|'), 'cronograma vencido el 2026-01-11 con 0,0 % de lo programado', 'texto con 0 %');
    igual(vencido({ evPct: 30, planFinalPct: 40 }).motivos.join('|'), 'cronograma vencido el 2026-01-11 con 75,0 % de lo programado', 'el porcentaje es sobre lo programado (30 de 40), no sobre el proyecto');
    // Sin vencer, un valor ganado bajo no es este motivo
    igual(semEjec({ evm: evmDe({ cronogramaVencido: false, evPct: 5 }), garantias: SIN_GAR, pendientes: 0 }).color, 'verde', 'no vencido');
    // En los demás estados el cronograma vencido no pinta
    for(const estado of SIN_COLOR) igual(nucleoSemaforo({ estado, evm: e, garantias: SIN_GAR, pendientes: 0 }).color, null, estado + ': cronograma vencido sin color');
  });

  await prueba('cronograma vencido con TODO lo programado terminado y un rubro sin cronograma a medias → NO es rojo por cronograma vencido', () => {
    // r1 (50 %) con cronograma del 1 al 11-ene, terminado; r2 (50 %) sin cronograma, al 20 %. Hoy 1-mar.
    const con = (r1, hoy = '2026-03-01') => nucleoEvmProyecto({ rubros: [r1, rubro('r2', 500, 100)], cronograma: [fila('r1', '2026-01-01', '2026-01-11')], lineaBaseActivaId: 'zzz-lb', hoy });
    for(const [que, r1] of [['rubro marcado terminado', rubro('r1', 500, 300, 'terminado')], ['producción completa', rubro('r1', 500, 500)]]){
      const e = con(r1);
      igual(e.cronogramaVencido, true, que + ': el cronograma venció'); casi(e.evPct, 50, que + ': valor ganado en cronograma 50'); casi(e.planFinalPct, 50, que + ': peso con cronograma 50');
      igual(e.obraProgramadaTerminada, true, que + ': lo programado está terminado'); casi(e.avancePct, 60, que + ': el avance principal es 60 %, no 100');
      igual(e.rubrosSinCronograma, 1, que + ': un rubro sin cronograma'); casi(e.spi, 1, que + ': SPI 1');
      igual(e.atrasoFechaDias, 0, que + ': sin atraso a la fecha'); igual(e.atrasoProyectadoDias, 0, que + ': sin atraso proyectado');
      const s = semEjec({ evm: e, garantias: SIN_GAR, pendientes: 0 });
      igual(s.color, 'verde', que + ': verde'); igual(s.motivos.length, 0, que + ': sin motivos');
    }
    // Contraprueba: con el rubro programado al 90 % sí es rojo, y el texto habla de lo programado (90 %), no del proyecto (45 %)
    const e = con(rubro('r1', 500, 450));
    casi(e.evPct, 45, 'contraprueba: valor ganado en cronograma'); igual(e.obraProgramadaTerminada, false, 'contraprueba: sin terminar');
    igual(e.fechaGanada, '2026-01-10', 'contraprueba: el 45 % se preveía el día 9'); igual(e.atrasoFechaDias, 50, 'contraprueba: del 10-ene al 1-mar');
    const s = semEjec({ evm: e, garantias: SIN_GAR, pendientes: 0 });
    igual(s.color, 'rojo', 'contraprueba: rojo');
    igual(s.motivos.join('|'), 'cronograma vencido el 2026-01-11 con 90,0 % de lo programado|atraso a la fecha de 50 días|SPI 0,90', 'contraprueba: motivos');
  });

  await prueba('propiedades (generador de semilla fija): atraso a la fecha acotado, 0 si el valor ganado alcanza el plan, y nunca crece con más valor ganado', () => {
    const r = azar(20261121);
    const entero = (a, b) => a + Math.floor(r() * (b - a + 1));
    let medibles = 0, conAtraso = 0, enCero = 0, nulos = 0, topados = 0, vencidos = 0, mesetas = 0, hitosAlInicio = 0;
    for(let caso = 0; caso < 600; caso++){
      const n = entero(1, 6), rubros = [], cronograma = [];
      for(let i = 0; i < n; i++){
        const monto = entero(0, 9) === 0 ? 0 : entero(1, 5000);
        const estado = ['planificado', 'trabajando', 'trabajando', 'suspendido', 'terminado'][entero(0, 4)];
        rubros.push(rubro('r' + i, monto, Math.round(monto * r() * 1.2), estado));
        if(entero(0, 4) === 0) continue;                               // uno de cada cinco, sin cronograma
        // Inicios repartidos en año y medio (deja huecos = mesetas), duración 0 (hito) a 150 días, a veces invertida
        const ini = nucleoSumarDias('2026-01-01', entero(0, 540)), fin = nucleoSumarDias(ini, entero(0, 5) === 0 ? 0 : entero(1, 150));
        cronograma.push(entero(0, 7) === 0 ? fila('r' + i, fin, ini) : fila('r' + i, ini, fin));
      }
      const hoy = nucleoSumarDias('2025-11-01', entero(0, 1000));
      const fechaInicioProyecto = entero(0, 2) === 0 ? nucleoSumarDias('2025-10-01', entero(0, 900)) : null;
      const que = `caso ${caso} (hoy ${hoy}, inicio ${fechaInicioProyecto})`;
      const datos = { rubros, cronograma, lineaBaseActivaId: 'zzz-lb', hoy, fechaInicioProyecto };
      const e = nucleoEvmProyecto(datos);
      igual(e.atrasoDias, e.atrasoFechaDias || 0, que + ': atrasoDias = atrasoFechaDias || 0');
      assert(e.avancePct >= e.evPct - 1e-9 && e.avancePct <= 100 + 1e-9, que + ': evPct ≤ avancePct ≤ 100');
      assert(e.planPct <= e.planFinalPct + 1e-9 && e.evPct <= e.planFinalPct + 1e-9, que + ': plan y valor ganado ≤ peso con cronograma');
      if(!e.spiValido){
        nulos++;
        igual(e.atrasoFechaDias, null, que + ': sin SPI válido, atraso a la fecha null'); igual(e.atrasoProyectadoDias, null, que + ': sin SPI válido, proyectado null');
        continue;
      }
      medibles++;
      // 1. Acotado: entero, 0 ≤ atraso ≤ días desde el primer inicio (y desde el inicio del proyecto, si es posterior)
      const desdeInicio = nucleoDiasEntre(e.primerInicio, hoy);
      assert(Number.isInteger(e.atrasoFechaDias) && e.atrasoFechaDias >= 0 && e.atrasoFechaDias <= desdeInicio, `${que}: atraso ${e.atrasoFechaDias} fuera de 0..${desdeInicio}`);
      if(fechaInicioProyecto && fechaInicioProyecto > e.primerInicio){
        const tope = Math.max(0, nucleoDiasEntre(fechaInicioProyecto, hoy));
        assert(e.atrasoFechaDias <= tope, `${que}: atraso ${e.atrasoFechaDias} mayor que el tope del inicio del proyecto (${tope})`);
        if(e.fechaGanada && nucleoDiasEntre(e.fechaGanada, hoy) > tope) topados++;
      }
      // 2. Valor ganado ≥ plan → 0 en los dos atrasos; por debajo del plan, al menos un día (salvo tope)
      if(e.evPct >= e.planPct){ enCero++; igual(e.atrasoFechaDias, 0, que + ': valor ganado ≥ plan → 0'); igual(e.fechaGanada, null, que + ': sin fecha ganada'); igual(e.atrasoProyectadoDias, 0, que + ': proyectado 0'); }
      else if(e.atrasoFechaDias > 0){
        conAtraso++;
        // La fecha ganada es de verdad el ÚLTIMO día en que el plan no superaba el valor ganado
        const planEn = f => nucleoEvmProyecto({ ...datos, hoy: f }).planPct;
        // (salvo que un hito el mismo día del primer inicio ya ponga el plan por encima: ahí la fecha ganada
        // es el primer inicio y el atraso son los días transcurridos desde él, que es el tope)
        if(e.fechaGanada === e.primerInicio && planEn(e.primerInicio) > e.evPct + 1e-9){ hitosAlInicio++; if(!(fechaInicioProyecto && fechaInicioProyecto > e.primerInicio)) igual(e.atrasoFechaDias, desdeInicio, que + ': hito al inicio, el atraso es todo lo transcurrido'); }
        else assert(planEn(e.fechaGanada) <= e.evPct + 1e-9, que + ': el plan de la fecha ganada no supera el valor ganado');
        assert(planEn(nucleoSumarDias(e.fechaGanada, 1)) > e.evPct + 1e-9, que + ': el plan del día siguiente ya lo supera');
        if(planEn(nucleoSumarDias(e.fechaGanada, -20)) > planEn(e.fechaGanada) - 1e-9 && e.fechaGanada > nucleoSumarDias(e.primerInicio, 20)) mesetas++;
      }
      // 3. Proyectado: null o entero ≥ 0; con el cronograma vencido y sin terminar, al menos los días pasados del fin
      assert(e.atrasoProyectadoDias === null || (Number.isInteger(e.atrasoProyectadoDias) && e.atrasoProyectadoDias >= 0), que + ': proyectado null o entero ≥ 0');
      if(e.atrasoProyectadoDias === null) assert(e.spi < NUCLEO_CARTERA.SPI_MINIMO_PROYECCION, que + ': proyectado null solo con SPI bajo');
      if(e.cronogramaVencido && !e.obraProgramadaTerminada && e.atrasoProyectadoDias !== null){
        vencidos++;
        assert(e.atrasoProyectadoDias >= nucleoDiasEntre(e.ultimoFin, hoy), que + ': proyectado menor que los días pasados del fin');
      }
      // 4. Monotonía: con más valor ganado (más producción en un rubro, o un rubro que pasa a terminado) nunca hay MÁS atraso
      let previo = e;
      for(let paso = 0; paso < 4; paso++){
        const i = entero(0, n - 1), mas = rubros.map(x => ({ ...x }));
        if(entero(0, 3) === 0) mas[i].estado = 'terminado'; else mas[i].total_produccion += Math.round(mas[i].monto_contrato * r() * 0.4);
        const sig = nucleoEvmProyecto({ ...datos, rubros: mas });
        assert(sig.evPct >= previo.evPct - 1e-9, que + ': el valor ganado no baja');
        assert(sig.atrasoFechaDias <= previo.atrasoFechaDias, `${que}: con más valor ganado el atraso sube de ${previo.atrasoFechaDias} a ${sig.atrasoFechaDias}`);
        if(sig.atrasoProyectadoDias !== null && previo.atrasoProyectadoDias !== null) assert(sig.atrasoProyectadoDias <= previo.atrasoProyectadoDias, `${que}: con más valor ganado el proyectado sube de ${previo.atrasoProyectadoDias} a ${sig.atrasoProyectadoDias}`);
        rubros.splice(0, n, ...mas); datos.rubros = rubros; previo = sig;
      }
      // …y con el mismo valor ganado, un día después nunca hay MENOS atraso a la fecha
      const manana = nucleoEvmProyecto({ ...datos, hoy: nucleoSumarDias(hoy, 1) });
      if(!(fechaInicioProyecto && fechaInicioProyecto > hoy)) assert(manana.atrasoFechaDias >= previo.atrasoFechaDias, `${que}: al día siguiente el atraso baja de ${previo.atrasoFechaDias} a ${manana.atrasoFechaDias}`);
    }
    // El generador cubre de verdad cada rama (los conteos son fijos: la semilla no cambia)
    assert(medibles >= 300 && conAtraso >= 150 && enCero >= 20 && nulos >= 30 && topados >= 10 && vencidos >= 50 && mesetas >= 10 && hitosAlInicio >= 3,
      `cobertura insuficiente: medibles ${medibles}, con atraso ${conAtraso}, en cero ${enCero}, nulos ${nulos}, topados ${topados}, vencidos ${vencidos}, mesetas ${mesetas}, hitos al inicio ${hitosAlInicio}`);
    if(process.env.ZZZ_COBERTURA) console.log(`      cobertura: medibles ${medibles}, con atraso ${conAtraso}, en cero ${enCero}, nulos ${nulos}, topados ${topados}, vencidos ${vencidos}, mesetas ${mesetas}, hitos al inicio ${hitosAlInicio}`);
  });

  await prueba('semáforo: umbrales del SPI — < 0,85 rojo; 0,85 a < 0,95 amarillo; ≥ 0,95 verde', () => {
    const color = spi => semEjec({ evm: evmDe({ spi }), garantias: SIN_GAR, pendientes: 0 }).color;
    igual(color(0), 'rojo', '0'); igual(color(0.8499), 'rojo', '0,8499'); igual(color(0.85), 'amarillo', '0,85 exacto');
    igual(color(0.9), 'amarillo', '0,90'); igual(color(0.9499), 'amarillo', '0,9499'); igual(color(0.95), 'verde', '0,95 exacto');
    igual(color(1), 'verde', '1'); igual(color(1.4), 'verde', '1,4');
  });

  await prueba('semáforo: un SPI no válido (plan < 0,5 %) o nulo no decide el color', () => {
    const noValido = semEjec({ evm: evmDe({ spi: 0.1, spiValido: false }), garantias: SIN_GAR, pendientes: 0 });
    igual(noValido.color, 'verde', 'SPI 0,10 no válido'); igual(noValido.motivos.join('|'), 'plan a la fecha todavía menor al 0,5 %', 'motivo');
    const nulo = semEjec({ evm: evmDe({ spi: null, spiValido: false }), garantias: SIN_GAR, pendientes: 0 });
    igual(nulo.color, 'verde', 'SPI nulo'); igual(nulo.motivos.length, 0, 'con cronograma que aún no empieza: sin motivo');
    // Sin cronograma el SPI tampoco decide, pero el proyecto en ejecución ya no sale verde: amarillo por no tener cronograma
    const sinCron = semEjec({ evm: evmDe({ spi: null, spiValido: false, sinCronograma: true }), garantias: SIN_GAR, pendientes: 0 });
    igual(sinCron.color, 'amarillo', 'sin cronograma'); igual(sinCron.motivos.join('|'), 'sin cronograma', 'motivo de sin cronograma');
    // El SPI no válido tampoco estorba a las otras causas
    igual(semEjec({ evm: evmDe({ spi: 0.1, spiValido: false }), garantias: G(1, 0), pendientes: 0 }).color, 'rojo', 'garantía vencida con SPI no válido');
  });

  await prueba('semáforo: garantías — vencida = rojo, por vencer = amarillo, con el texto en singular y plural', () => {
    const s1 = semEjec({ evm: evmDe(), garantias: G(1, 0), pendientes: 0 });
    igual(s1.color, 'rojo', 'una vencida'); igual(s1.motivos.join('|'), '1 garantía vencida', 'singular');
    const s2 = semEjec({ evm: evmDe(), garantias: G(2, 0), pendientes: 0 });
    igual(s2.motivos.join('|'), '2 garantías vencidas', 'plural');
    const s3 = semEjec({ evm: evmDe(), garantias: G(0, 1), pendientes: 0 });
    igual(s3.color, 'amarillo', 'una por vencer'); igual(s3.motivos.join('|'), '1 garantía por vencer en 5 días o menos', 'singular');
    const s4 = semEjec({ evm: evmDe(), garantias: G(0, 3), pendientes: 0 });
    igual(s4.motivos.join('|'), '3 garantías por vencer en 5 días o menos', 'plural');
    // Sin cronograma también pinta por garantías: la por vencer se suma al «sin cronograma» y la vencida lo pasa a rojo
    const s5 = semEjec({ evm: evmDe({ spi: null, spiValido: false, sinCronograma: true }), garantias: G(0, 1), pendientes: 0 });
    igual(s5.color, 'amarillo', 'sin cronograma y garantía por vencer'); igual(s5.motivos.join('|'), 'sin cronograma|1 garantía por vencer en 5 días o menos', 'sin cronograma y garantía por vencer: motivos');
    const s6 = semEjec({ evm: evmDe({ spi: null, spiValido: false, sinCronograma: true }), garantias: G(1, 0), pendientes: 0 });
    igual(s6.color, 'rojo', 'sin cronograma y garantía vencida'); igual(s6.motivos.join('|'), '1 garantía vencida|sin cronograma', 'sin cronograma y garantía vencida: motivos');
  });

  // ── Plazo contractual vencido ─────────────────────────────────────────────
  await prueba('semáforo: plazo contractual vencido con avance menor al 100 % → rojo con su motivo; el día del plazo todavía no; sin fecha no hay regla', () => {
    // r1 vale todo el proyecto y lleva 40 %. Cronograma de 300 días desde el 1-nov: a 21-nov el plan es 6,67 % → SPI 6: sin el plazo, verde.
    const con = (fechaFinContractual, prod = 400, estado = 'trabajando') => nucleoEvmProyecto({ rubros: [rubro('r1', 1000, prod, estado)],
      cronograma: [fila('r1', '2026-11-01', '2027-08-28')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-11-21', fechaFinContractual });
    const sem = evm => semEjec({ evm, garantias: SIN_GAR, pendientes: 0 });
    const vencido = con('2026-11-20');
    igual(vencido.plazoContractualVencido, true, 'venció ayer'); igual(vencido.avanceCompleto, false, 'avance 40 %: incompleto'); igual(vencido.cronogramaVencido, false, 'el cronograma no ha vencido');
    casi(vencido.avancePct, 40, 'avance 40 %'); assert(vencido.spi > 1 && vencido.atrasoFechaDias === 0, 'SPI en verde y sin atraso: el único motivo es el plazo');
    const s = sem(vencido);
    igual(s.color, 'rojo', 'vencido ayer con 40 %: rojo'); igual(s.motivos.join('|'), 'plazo contractual vencido el 2026-11-20 con 40,0 % de avance', 'motivo propio, con la fecha y el avance');
    // Vencido hace mucho: mismo motivo, con su fecha
    igual(sem(con('2025-06-30')).motivos.join('|'), 'plazo contractual vencido el 2025-06-30 con 40,0 % de avance', 'vencido hace más de un año');
    // El plazo que vence HOY no está vencido; el de mañana, tampoco
    for(const [que, f] of [['vence hoy', '2026-11-21'], ['vence mañana', '2026-11-22'], ['vence en un año', '2027-11-21']]){
      const e = con(f);
      igual(e.plazoContractualVencido, false, que + ': no vencido'); igual(e.fechaFinContractual, f, que + ': la fecha se conserva');
      igual(sem(e).color, 'verde', que + ': verde'); igual(sem(e).motivos.length, 0, que + ': sin motivos');
    }
    // Sin fecha de fin contractual (undefined, null o texto vacío) no hay regla
    for(const [que, f] of [['undefined', undefined], ['null', null], ['texto vacío', '']]){
      const e = con(f);
      igual(e.fechaFinContractual, null, 'plazo ' + que + ': fechaFinContractual null'); igual(e.plazoContractualVencido, false, 'plazo ' + que + ': no vencido');
      igual(sem(e).color, 'verde', 'plazo ' + que + ': verde'); igual(sem(e).motivos.length, 0, 'plazo ' + que + ': sin motivos');
    }
    // Vencido con el avance COMPLETO no es rojo: por producción completa o por rubro marcado terminado
    for(const [que, e] of [['producción completa', con('2026-11-20', 1000)], ['rubro terminado con 40 % de producción', con('2026-11-20', 400, 'terminado')], ['vencido hace años, completa', con('2020-01-01', 1000)]]){
      igual(e.plazoContractualVencido, true, que + ': el plazo venció'); igual(e.avanceCompleto, true, que + ': avance completo');
      igual(sem(e).color, 'verde', que + ': NO es rojo'); igual(sem(e).motivos.length, 0, que + ': sin motivos');
    }
    // Umbral de «avance completo» (OBRA_TERMINADA_PCT = 99,95 %), y el texto nunca dice 100 con el avance incompleto
    const fino = prod => nucleoEvmProyecto({ rubros: [rubro('r1', 100000, prod)], cronograma: [fila('r1', '2026-11-01', '2027-08-28')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-11-21', fechaFinContractual: '2026-11-20' });
    igual(fino(99960).avanceCompleto, true, '99,96 %: completo'); igual(sem(fino(99960)).color, 'verde', '99,96 %: no es rojo');
    igual(fino(99940).avanceCompleto, false, '99,94 %: incompleto');
    igual(sem(fino(99940)).color, 'rojo', '99,94 %: rojo'); igual(sem(fino(99940)).motivos[0], 'plazo contractual vencido el 2026-11-20 con 99,9 % de avance', '99,94 %: el texto no dice 100');
    // Fuera de ejecución el plazo vencido no pinta
    for(const estado of [...SIN_COLOR, null, '']) igual(JSON.stringify(nucleoSemaforo({ estado, evm: vencido, garantias: SIN_GAR, pendientes: 0 })), '{"color":null,"motivos":[]}', String(estado) + ': plazo vencido sin color');
  });

  await prueba('semáforo: el plazo contractual mira el avance de TODOS los rubros (no solo lo programado) y va segundo entre los motivos de rojo', () => {
    // r1 (50 %) programado del 1 al 11-ene y terminado; r2 (50 %) sin cronograma, al 20 %. Hoy 1-mar; el plazo venció el 15-feb.
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 500, 300, 'terminado'), rubro('r2', 500, 100)], cronograma: [fila('r1', '2026-01-01', '2026-01-11')],
      lineaBaseActivaId: 'zzz-lb', hoy: '2026-03-01', fechaFinContractual: '2026-02-15' });
    igual(e.obraProgramadaTerminada, true, 'lo programado está terminado'); igual(e.cronogramaVencido, true, 'el cronograma venció'); casi(e.avancePct, 60, 'avance de todos los rubros 60 %');
    igual(e.avanceCompleto, false, 'avance incompleto: falta el rubro sin cronograma'); igual(e.plazoContractualVencido, true, 'plazo vencido');
    const s = semEjec({ evm: e, garantias: SIN_GAR, pendientes: 0 });
    igual(s.color, 'rojo', 'rojo por plazo (por cronograma vencido no lo sería)');
    igual(s.motivos.join('|'), 'plazo contractual vencido el 2026-02-15 con 60,0 % de avance', 'un solo motivo, con el avance total (60 %), no el de lo programado (100 %)');
    // Los dos vencimientos a la vez: cada uno con su fecha y su porcentaje
    const dos = nucleoEvmProyecto({ rubros: [rubro('r1', 500, 450), rubro('r2', 500, 100)], cronograma: [fila('r1', '2026-01-01', '2026-01-11')],
      lineaBaseActivaId: 'zzz-lb', hoy: '2026-03-01', fechaFinContractual: '2026-02-15' });
    igual(semEjec({ evm: dos, garantias: SIN_GAR, pendientes: 0 }).motivos.join('|'),
      'plazo contractual vencido el 2026-02-15 con 55,0 % de avance|cronograma vencido el 2026-01-11 con 90,0 % de lo programado|atraso a la fecha de 50 días|SPI 0,90', 'plazo (55 % del total) y cronograma (90 % de lo programado)');
    // Orden completo, con el EVM a mano: SPI, plazo, cronograma, garantía vencida, atraso; después los amarillos
    const todo = semEjec({ evm: evmDe({ spi: 0.5, atrasoFechaDias: 44, cronogramaVencido: true, ultimoFin: '2026-06-30', evPct: 41.26,
      plazoContractualVencido: true, fechaFinContractual: '2026-05-31', avancePct: 37.26, avanceCompleto: false }), garantias: G(1, 2), pendientes: 9 });
    igual(todo.motivos.join('|'), 'SPI 0,50|plazo contractual vencido el 2026-05-31 con 37,3 % de avance|cronograma vencido el 2026-06-30 con 41,3 % de lo programado|1 garantía vencida|atraso a la fecha de 44 días|2 garantías por vencer en 5 días o menos|9 pendientes (libro, observaciones y solicitudes)', 'orden de los motivos');
    // El semáforo se guía por plazoContractualVencido y avanceCompleto (no vuelve a comparar fechas ni porcentajes)
    igual(semEjec({ evm: evmDe({ plazoContractualVencido: true, fechaFinContractual: '2026-05-31', avancePct: 10, avanceCompleto: true }), garantias: SIN_GAR, pendientes: 0 }).color, 'verde', 'avanceCompleto manda');
    igual(semEjec({ evm: evmDe({ plazoContractualVencido: false, fechaFinContractual: '2020-01-01', avancePct: 10, avanceCompleto: false }), garantias: SIN_GAR, pendientes: 0 }).color, 'verde', 'plazoContractualVencido manda');
    // Con el SPI amarillo, el plazo vencido lo pasa a rojo y el SPI queda de motivo secundario
    igual(semEjec({ evm: evmDe({ spi: 0.9, plazoContractualVencido: true, fechaFinContractual: '2026-05-31', avancePct: 80 }), garantias: SIN_GAR, pendientes: 0 }).motivos.join('|'),
      'plazo contractual vencido el 2026-05-31 con 80,0 % de avance|SPI 0,90', 'plazo + SPI amarillo');
  });

  await prueba('EVM: fechaFinContractual — se devuelve como día, no cambia ningún otro indicador y mal formada LANZA', () => {
    const datos = { rubros: [rubro('r1', 600, 150), rubro('r2', 400, 0)], cronograma: [fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-01-11', '2026-01-21')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-06' };
    const sin = nucleoEvmProyecto(datos);
    igual(sin.fechaFinContractual, null, 'sin plazo: null'); igual(sin.plazoContractualVencido, false, 'sin plazo: no vencido'); igual(sin.avanceCompleto, false, 'avance 15 %: incompleto');
    // Con plazo (vencido o no) todo lo demás es idéntico: el plazo solo añade sus dos campos
    for(const f of ['2026-01-05', '2026-01-06', '2026-12-31']){
      const con = nucleoEvmProyecto({ ...datos, fechaFinContractual: f });
      igual(con.fechaFinContractual, f, f + ': fecha'); igual(con.plazoContractualVencido, f < '2026-01-06', f + ': vencido solo si es anterior a hoy');
      igual(JSON.stringify({ ...con, fechaFinContractual: null, plazoContractualVencido: false }), JSON.stringify(sin), f + ': el resto de los indicadores no cambia');
    }
    // Con hora (timestamp como texto): cuenta el día
    const conHora = nucleoEvmProyecto({ ...datos, fechaFinContractual: '2026-01-05T23:59:59-05:00' });
    igual(conHora.fechaFinContractual, '2026-01-05', 'con hora: se guarda el día'); igual(conHora.plazoContractualVencido, true, 'con hora: vencido');
    igual(nucleoEvmProyecto({ ...datos, hoy: '2026-01-05T08:00:00-05:00', fechaFinContractual: '2026-01-05' }).plazoContractualVencido, false, '«hoy» con hora el mismo día del plazo: no vencido');
    // Cambio de año y de mes: se comparan días civiles
    igual(nucleoEvmProyecto({ ...datos, hoy: '2027-01-01', fechaFinContractual: '2026-12-31' }).plazoContractualVencido, true, 'venció el 31-dic, hoy 1-ene');
    igual(nucleoEvmProyecto({ ...datos, hoy: '2026-12-31', fechaFinContractual: '2027-01-01' }).plazoContractualVencido, false, 'vence el 1-ene, hoy 31-dic');
    // avanceCompleto sin rubros o con monto 0: no hay avance que completar
    igual(nucleoEvmProyecto({ hoy: '2026-01-06', fechaFinContractual: '2026-01-01' }).avanceCompleto, false, 'sin rubros: incompleto');
    igual(nucleoEvmProyecto({ rubros: [rubro('r1', 0, 0, 'terminado')], hoy: '2026-01-06' }).avanceCompleto, false, 'monto 0: incompleto');
    // Mal formada o inexistente: lanza (también con la cartera vacía), nunca se ignora
    const malas = { 'Date': new Date('2026-01-05T00:00:00Z'), 'número (ms)': Date.UTC(2026, 0, 5), 'dd/mm/aaaa': '05/01/2026', 'aaaa/mm/dd': '2026/01/05', '30 de febrero': '2026-02-30',
      'mes 13': '2026-13-01', 'sin ceros': '2026-1-5', 'con espacio delante': ' 2026-01-05', 'un objeto': { fecha: '2026-01-05' }, 'false': false, 'cero': 0 };
    for(const [que, v] of Object.entries(malas)){
      lanza(() => nucleoEvmProyecto({ ...datos, fechaFinContractual: v }), 'fin contractual ' + que, /^Fecha (no válida|inexistente)/);
      lanza(() => nucleoEvmProyecto({ hoy: '2026-01-06', fechaFinContractual: v }), 'fin contractual ' + que + ', sin rubros', /^Fecha (no válida|inexistente)/);
    }
  });

  // ── En ejecución y sin cronograma ─────────────────────────────────────────
  await prueba('semáforo: en ejecución SIN cronograma nunca es verde — amarillo «sin cronograma», y rojo si además venció el plazo; fuera de ejecución sigue sin color', () => {
    const HOY_SC = '2026-11-21';
    const sinCron = (extra = {}) => nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 250)], cronograma: [], lineaBaseActivaId: null, hoy: HOY_SC, ...extra });
    const sem = (evm, garantias = SIN_GAR, pendientes = 0) => semEjec({ evm, garantias, pendientes });
    const e = sinCron();
    igual(e.sinCronograma, true, 'sin cronograma'); igual(e.spi, null, 'sin SPI'); igual(e.atrasoFechaDias, null, 'sin atraso medible');
    igual(sem(e).color, 'amarillo', 'amarillo'); igual(sem(e).motivos.join('|'), 'sin cronograma', 'motivo «sin cronograma»');
    // Todas las formas de no tener cronograma
    const formas = {
      'sin rubros': nucleoEvmProyecto({ rubros: [], cronograma: [], lineaBaseActivaId: null, hoy: HOY_SC }),
      'línea base activa sin filas': nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 250)], cronograma: [fila('r1', '2026-01-01', '2026-12-31', 'zzz-lb-vieja')], lineaBaseActivaId: 'zzz-lb-nueva', hoy: HOY_SC }),
      'filas solo de rubros ajenos': nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 250)], cronograma: [fila('zzz-ajeno', '2026-01-01', '2026-12-31')], lineaBaseActivaId: 'zzz-lb', hoy: HOY_SC }),
      'filas sin fechas': nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 250)], cronograma: [fila('r1', null, null)], lineaBaseActivaId: 'zzz-lb', hoy: HOY_SC }),
      'con todo ejecutado': sinCron({ rubros: [rubro('r1', 1000, 1000)] }),
      'con todo terminado': sinCron({ rubros: [rubro('r1', 1000, 0, 'terminado')] })
    };
    for(const [que, evm] of Object.entries(formas)){
      igual(evm.sinCronograma, true, que + ': sinCronograma'); igual(sem(evm).color, 'amarillo', que + ': amarillo, no verde'); igual(sem(evm).motivos.join('|'), 'sin cronograma', que + ': motivo');
    }
    // Basta una fila que cuente para que ya no sea «sin cronograma» (los demás rubros sin programar no lo ponen amarillo)
    const parcial = nucleoEvmProyecto({ rubros: [rubro('r1', 500, 500), rubro('r2', 500, 0)], cronograma: [fila('r1', '2026-11-01', '2026-11-11')], lineaBaseActivaId: 'zzz-lb', hoy: HOY_SC });
    igual(parcial.sinCronograma, false, 'un rubro programado: tiene cronograma'); igual(parcial.rubrosSinCronograma, 1, 'y un rubro sin programar');
    igual(sem(parcial).color, 'verde', 'cronograma parcial y al día: verde'); igual(sem(parcial).motivos.length, 0, 'cronograma parcial: sin motivos');
    // Se suma a los otros amarillos, en su orden (después del SPI, antes de garantías y pendientes)
    igual(sem(e, G(0, 2), 6).motivos.join('|'), 'sin cronograma|2 garantías por vencer en 5 días o menos|6 pendientes (libro, observaciones y solicitudes)', 'con garantías por vencer y pendientes');
    igual(sem(e, SIN_GAR, 5).motivos.join('|'), 'sin cronograma', 'con 5 pendientes: solo «sin cronograma»');
    // Rojo si además venció el plazo contractual (el día del plazo todavía no)
    const vencido = sinCron({ fechaFinContractual: '2026-11-20' });
    igual(sem(vencido).color, 'rojo', 'sin cronograma y plazo vencido: rojo');
    igual(sem(vencido).motivos.join('|'), 'plazo contractual vencido el 2026-11-20 con 25,0 % de avance|sin cronograma', 'motivos: primero el plazo, que es el que decide');
    const venceHoy = sinCron({ fechaFinContractual: HOY_SC });
    igual(sem(venceHoy).color, 'amarillo', 'plazo que vence hoy: sigue amarillo'); igual(sem(venceHoy).motivos.join('|'), 'sin cronograma', 'plazo que vence hoy: solo «sin cronograma»');
    igual(sem(sinCron({ fechaFinContractual: '2027-06-30' })).color, 'amarillo', 'plazo futuro: amarillo');
    // Sin rubros y con el plazo vencido: rojo con 0,0 % de avance
    igual(sem(nucleoEvmProyecto({ hoy: HOY_SC, fechaFinContractual: '2026-11-20' })).motivos.join('|'), 'plazo contractual vencido el 2026-11-20 con 0,0 % de avance|sin cronograma', 'sin rubros, plazo vencido');
    // Plazo vencido con el avance completo: no es rojo, pero tampoco verde (sigue sin cronograma)
    const completo = sinCron({ rubros: [rubro('r1', 1000, 1000)], fechaFinContractual: '2026-11-20' });
    igual(completo.avanceCompleto, true, 'avance completo'); igual(sem(completo).color, 'amarillo', 'plazo vencido con avance completo y sin cronograma: amarillo');
    igual(sem(completo).motivos.join('|'), 'sin cronograma', 'avance completo: solo «sin cronograma»');
    // Los otros rojos también lo pasan a rojo, con «sin cronograma» de motivo secundario
    igual(sem(e, G(1, 0)).motivos.join('|'), '1 garantía vencida|sin cronograma', 'garantía vencida + sin cronograma');
    // Fuera de ejecución sigue sin color: ni amarillo por no tener cronograma ni rojo por el plazo
    for(const estado of [...SIN_COLOR, null, '', 'ZZZ otro']){
      for(const [que, evm] of [['sin cronograma', e], ['sin cronograma y plazo vencido', vencido]]){
        igual(JSON.stringify(nucleoSemaforo({ estado, evm, garantias: G(1, 1), pendientes: 9 })), '{"color":null,"motivos":[]}', `${String(estado)}, ${que}: sin color ni motivos`);
      }
    }
  });

  await prueba('semáforo: pendientes — 5 sigue verde, 6 es amarillo', () => {
    igual(semEjec({ evm: evmDe(), garantias: SIN_GAR, pendientes: 5 }).color, 'verde', '5 pendientes');
    const s = semEjec({ evm: evmDe(), garantias: SIN_GAR, pendientes: 6 });
    igual(s.color, 'amarillo', '6 pendientes'); igual(s.motivos.join('|'), '6 pendientes (libro, observaciones y solicitudes)', 'motivo');
  });

  await prueba('semáforo: atraso a la fecha — 30 días no es rojo, 31 sí (aunque el SPI esté en verde)', () => {
    igual(semEjec({ evm: evmDe({ spi: 0.97, atrasoFechaDias: 30 }), garantias: SIN_GAR, pendientes: 0 }).color, 'verde', '30 días');
    igual(semEjec({ evm: evmDe({ spi: 0.97, atrasoFechaDias: NUCLEO_CARTERA.ATRASO_ROJO_DIAS }), garantias: SIN_GAR, pendientes: 0 }).color, 'verde', 'el umbral exacto');
    const s = semEjec({ evm: evmDe({ spi: 0.97, atrasoFechaDias: 31 }), garantias: SIN_GAR, pendientes: 0 });
    igual(s.color, 'rojo', '31 días'); igual(s.motivos.join('|'), 'atraso a la fecha de 31 días', 'motivo');
    // Lo que cuenta es atrasoFechaDias: ni el alias suelto ni el proyectado
    igual(semEjec({ evm: evmDe({ spi: 0.97, atrasoFechaDias: 0, atrasoDias: 99, atrasoProyectadoDias: 99 }), garantias: SIN_GAR, pendientes: 0 }).color, 'verde', 'atrasoDias y proyectado no deciden');
    for(const estado of SIN_COLOR) igual(nucleoSemaforo({ estado, evm: evmDe({ spi: 0.97, atrasoFechaDias: 31 }) }).color, null, estado + ': 31 días sin color');
  });

  await prueba('semáforo: motivos — en rojo van primero los rojos y luego los amarillos; el SPI con coma decimal', () => {
    const todo = semEjec({ evm: evmDe({ spi: 0.5, atrasoFechaDias: 44, cronogramaVencido: true, ultimoFin: '2026-06-30', evPct: 41.26 }), garantias: G(1, 2), pendientes: 9 });
    igual(todo.color, 'rojo', 'color');
    igual(todo.motivos.join('|'), 'SPI 0,50|cronograma vencido el 2026-06-30 con 41,3 % de lo programado|1 garantía vencida|atraso a la fecha de 44 días|2 garantías por vencer en 5 días o menos|9 pendientes (libro, observaciones y solicitudes)', 'orden de los motivos');
    const amarillo = semEjec({ evm: evmDe({ spi: 0.91 }), garantias: G(0, 1), pendientes: 6 });
    igual(amarillo.color, 'amarillo', 'amarillo');
    igual(amarillo.motivos.join('|'), 'SPI 0,91|1 garantía por vencer en 5 días o menos|6 pendientes (libro, observaciones y solicitudes)', 'motivos del amarillo');
    // Rojo por garantía con SPI amarillo: el SPI se lista después, como motivo secundario, y una sola vez
    const mixto = semEjec({ evm: evmDe({ spi: 0.9 }), garantias: G(1, 0), pendientes: 0 });
    igual(mixto.motivos.join('|'), '1 garantía vencida|SPI 0,90', 'rojo por garantía + SPI amarillo');
    // En verde no se arrastran motivos de alerta
    igual(semEjec({ evm: evmDe({ spi: 0.99 }), garantias: SIN_GAR, pendientes: 5 }).motivos.length, 0, 'verde sin motivos');
  });

  resumen();
})();
