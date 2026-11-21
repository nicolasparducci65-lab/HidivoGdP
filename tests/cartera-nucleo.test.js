// Núcleo de indicadores de cartera (cartera-nucleo.js): avance, plan a una fecha, SPI, días de
// atraso, garantías y semáforo. Carga el módulo REAL con require y prueba cada función con datos
// sintéticos (ningún dato de producción).
//
//   node cartera-nucleo.test.js
'use strict';
const path = require('path');
const { RAIZ, prueba, resumen, assert } = require('./lib/arnes');
const N = require(path.join(RAIZ, 'cartera-nucleo.js'));
const { NUCLEO_CARTERA, nucleoHoyEcuador, nucleoMsDeFecha, nucleoSumarDias, nucleoDiasEntre, nucleoLineaBaseActiva, nucleoFilasCronograma,
  nucleoFraccionPlan, nucleoAvanceRubro, nucleoEvmProyecto, nucleoGarantias, nucleoSpiTruncado, nucleoSemaforo } = N;

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
const evmDe = (extra = {}) => ({ spi: 1, spiValido: true, atrasoDias: 0, sinCronograma: false, sinLineaBase: false, ...extra });
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
    igual(NUCLEO_CARTERA.ZONA, 'America/Guayaquil', 'ZONA');
    assert(Object.isFrozen(NUCLEO_CARTERA), 'NUCLEO_CARTERA está congelado');
  });

  await prueba('el módulo exporta las trece piezas y solo esas', () => {
    const esperadas = ['NUCLEO_CARTERA', 'nucleoAvanceRubro', 'nucleoDiasEntre', 'nucleoEvmProyecto', 'nucleoFilasCronograma', 'nucleoFraccionPlan',
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
      igual(e.spi, null, 'spi'); igual(e.spiValido, false, 'spiValido'); igual(e.atrasoDias, 0, 'atrasoDias');
      igual(e.rubrosConCronograma, 0, 'rubrosConCronograma'); igual(e.sinCronograma, true, 'sinCronograma');
      igual(e.sinLineaBase, true, 'sinLineaBase'); igual(e.primerInicio, null, 'primerInicio'); igual(e.ultimoFin, null, 'ultimoFin');
      igual(e.cronogramaVencido, false, 'cronogramaVencido');
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

  await prueba('EVM: rubros sin cronograma → hay avance real pero no SPI', () => {
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 600, 150), rubro('r2', 400, 100)], cronograma: [], lineaBaseActivaId: 'zzz-lb', hoy: '2026-11-21' });
    igual(e.vigente, 1000, 'vigente'); igual(e.ejecutado, 250, 'ejecutado'); igual(e.realPct, 25, 'realPct');
    igual(e.spi, null, 'spi'); igual(e.sinCronograma, true, 'sinCronograma'); igual(e.sinLineaBase, false, 'tiene línea base, pero vacía');
  });

  await prueba('EVM: monto total 0 → avance 0, pesos 0 y sin SPI (no divide entre cero)', () => {
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 0, 300), rubro('r2', null, 0)], cronograma: [fila('r1', '2026-01-01', '2026-01-11')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-06-01' });
    igual(e.vigente, 0, 'vigente'); igual(e.ejecutado, 300, 'ejecutado'); igual(e.realPct, 0, 'realPct');
    igual(e.planPct, 0, 'planPct'); igual(e.evPct, 0, 'evPct'); igual(e.spi, null, 'spi'); igual(e.spiValido, false, 'spiValido');
    igual(e.atrasoDias, 0, 'atraso'); igual(e.rubrosConCronograma, 1, 'la fila sí cuenta como cronograma'); igual(e.sinCronograma, false, 'sinCronograma');
  });

  await prueba('EVM: caso base — pesos por monto, plan a la fecha, SPI y atraso', () => {
    // r1 pesa 60 %, va del 1 al 11 de enero; r2 pesa 40 %, del 11 al 21. Hoy 6-ene: r1 a la mitad.
    const e = nucleoEvmProyecto({
      rubros: [rubro('r1', 600, 150), rubro('r2', 400, 0)],
      cronograma: [fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-01-11', '2026-01-21')],
      lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-06'
    });
    igual(e.vigente, 1000, 'vigente'); igual(e.ejecutado, 150, 'ejecutado');
    casi(e.realPct, 15, 'realPct'); casi(e.planPct, 30, 'planPct = 60 × 0,5'); casi(e.evPct, 15, 'evPct = 60 × 25 %');
    casi(e.spi, 0.5, 'spi'); igual(e.spiValido, true, 'spiValido');
    igual(e.atrasoDias, 5, 'atraso = 5 días transcurridos × (1/0,5 − 1)');
    igual(e.rubrosConCronograma, 2, 'rubrosConCronograma'); igual(e.sinCronograma, false, 'sinCronograma'); igual(e.sinLineaBase, false, 'sinLineaBase');
    igual(e.primerInicio, '2026-01-01', 'primerInicio'); igual(e.ultimoFin, '2026-01-21', 'ultimoFin');
  });

  await prueba('EVM: el avance real suma TODOS los rubros; el SPI solo los que tienen cronograma', () => {
    const e = nucleoEvmProyecto({
      rubros: [rubro('r1', 600, 150), rubro('r2', 400, 0), rubro('r3', 1000, 1000)],   // r3 completo, sin cronograma
      cronograma: [fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-01-11', '2026-01-21')],
      lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-06'
    });
    igual(e.vigente, 2000, 'vigente'); casi(e.realPct, 57.5, 'realPct incluye r3');
    casi(e.planPct, 15, 'planPct (los pesos son sobre el monto vigente total)'); casi(e.evPct, 7.5, 'evPct no incluye r3');
    casi(e.spi, 0.5, 'spi no cambia por un rubro sin cronograma'); igual(e.rubrosConCronograma, 2, 'rubrosConCronograma');
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
    igual(nucleoSemaforo({ evm: e, garantias: SIN_GAR, pendientes: 0 }).color, 'verde', 'verde');
  });

  await prueba('EVM: hoy después del fin → plan 100 %', () => {
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 1000)], cronograma: [fila('r1', '2026-03-01', '2026-03-31')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-12-31' });
    casi(e.planPct, 100, 'planPct'); casi(e.spi, 1, 'spi'); igual(e.atrasoDias, 0, 'atraso');
  });

  await prueba('EVM: adelantado (SPI > 1) no tiene atraso', () => {
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 800)], cronograma: [fila('r1', '2026-01-01', '2026-01-11')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-06' });
    casi(e.spi, 1.6, 'spi'); igual(e.atrasoDias, 0, 'atraso');
    igual(nucleoSemaforo({ evm: e, garantias: SIN_GAR, pendientes: 0 }).color, 'verde', 'verde');
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
    const s = nucleoSemaforo({ evm: e, garantias: SIN_GAR, pendientes: 0 });
    igual(s.color, 'verde', 'color'); igual(s.motivos.join('|'), 'plan a la fecha todavía menor al 0,5 %', 'motivo');
  });

  await prueba('EVM: el plan mínimo es estricto — con 0,5 % exacto el SPI aún no vale; con más, sí', () => {
    const cron = [fila('r1', '2026-01-01', '2026-01-11'), fila('r2', '2026-06-01', '2026-12-01')];
    const justo = nucleoEvmProyecto({ rubros: [rubro('r1', 1, 0), rubro('r2', 199, 0)], cronograma: cron, lineaBaseActivaId: 'zzz-lb', hoy: '2026-03-01' });
    igual(justo.planPct, 0.5, 'planPct exacto'); igual(justo.spiValido, false, 'con 0,5 % exacto no es válido');
    const pasa = nucleoEvmProyecto({ rubros: [rubro('r1', 6, 0), rubro('r2', 994, 0)], cronograma: cron, lineaBaseActivaId: 'zzz-lb', hoy: '2026-03-01' });
    casi(pasa.planPct, 0.6, 'planPct'); igual(pasa.spiValido, true, 'con 0,6 % ya es válido');
    igual(nucleoSemaforo({ evm: pasa, garantias: SIN_GAR, pendientes: 0 }).color, 'rojo', 'y entonces el SPI 0 pinta rojo');
  });

  await prueba('EVM: SPI 0 con plan significativo → rojo, sin división entre cero en el atraso', () => {
    const e = nucleoEvmProyecto({ rubros: [rubro('r1', 1000, 0)], cronograma: [fila('r1', '2026-01-01', '2026-01-11')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-06' });
    igual(e.spi, 0, 'spi'); igual(e.spiValido, true, 'spiValido'); igual(e.atrasoDias, 0, 'atraso (no se estima con SPI 0)');
    assert(Number.isFinite(e.atrasoDias), 'atraso finito');
    const s = nucleoSemaforo({ evm: e, garantias: SIN_GAR, pendientes: 0 });
    igual(s.color, 'rojo', 'color'); igual(s.motivos[0], 'SPI 0,00', 'motivo');
  });

  await prueba('EVM + semáforo: umbrales exactos 0,85 (amarillo, no rojo) y 0,95 (verde, no amarillo)', () => {
    const con = prod => nucleoEvmProyecto({ rubros: [rubro('r1', 100, prod)], cronograma: [fila('r1', '2026-01-01', '2026-01-02')], lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-02' });
    const color = prod => nucleoSemaforo({ evm: con(prod), garantias: SIN_GAR, pendientes: 0 }).color;
    igual(con(85).spi, 0.85, 'spi exacto 0,85'); igual(con(95).spi, 0.95, 'spi exacto 0,95');
    igual(color(84), 'rojo', '0,84'); igual(color(85), 'amarillo', '0,85 exacto'); igual(color(94), 'amarillo', '0,94');
    igual(color(95), 'verde', '0,95 exacto'); igual(color(100), 'verde', '1,00');
  });

  await prueba('EVM + semáforo: atraso de 30 días no es rojo; de 31, sí', () => {
    // Actividad de 270 días, SPI 0,90: atraso = días transcurridos × (1/0,9 − 1). Un hito sin peso
    // a fin de 2027 mantiene el cronograma sin vencer, para que los días sigan corriendo.
    const con = hoy => nucleoEvmProyecto({ rubros: [rubro('r1', 100, 90), rubro('r2', 0, 0)],
      cronograma: [fila('r1', '2026-01-01', '2026-09-28'), fila('r2', '2027-12-31', '2027-12-31')], lineaBaseActivaId: 'zzz-lb', hoy });
    const a270 = con('2026-09-28'), a279 = con('2026-10-07');
    igual(a279.cronogramaVencido, false, 'el cronograma no ha vencido');
    casi(a270.spi, 0.9, 'spi'); igual(a270.atrasoDias, 30, '270 días transcurridos → 30'); igual(a279.atrasoDias, 31, '279 días transcurridos → 31');
    const s30 = nucleoSemaforo({ evm: a270, garantias: SIN_GAR, pendientes: 0 });
    igual(s30.color, 'amarillo', '30 días: manda el SPI 0,90'); igual(s30.motivos.join('|'), 'SPI 0,90', 'motivos con 30');
    const s31 = nucleoSemaforo({ evm: a279, garantias: SIN_GAR, pendientes: 0 });
    igual(s31.color, 'rojo', '31 días'); igual(s31.motivos.join('|'), 'atraso estimado de 31 días|SPI 0,90', 'motivos con 31: primero el que decide');
  });

  await prueba('EVM: el atraso cuenta desde el primer inicio programado, y es 0 si hoy es ese día', () => {
    const rubros = [rubro('r1', 500, 100), rubro('r2', 500, 0)];
    const cronograma = [fila('r2', '2026-02-01', '2026-02-21'), fila('r1', '2026-01-01', '2026-01-21')];
    const e = nucleoEvmProyecto({ rubros, cronograma, lineaBaseActivaId: 'zzz-lb', hoy: '2026-01-11' });
    igual(e.primerInicio, '2026-01-01', 'primerInicio'); igual(e.ultimoFin, '2026-02-21', 'ultimoFin');
    casi(e.planPct, 25, 'planPct'); casi(e.evPct, 10, 'evPct'); casi(e.spi, 0.4, 'spi');
    igual(e.atrasoDias, 15, '10 días × (1/0,4 − 1)');
  });

  await prueba('EVM: con el cronograma vencido el atraso deja de crecer (se cuenta hasta el último fin programado)', () => {
    // 270 días de cronograma (1-ene a 28-sep), obra terminada al 90 % de lo programado: SPI 0,90 → 30 días
    const con = hoy => nucleoEvmProyecto({ rubros: [rubro('r1', 100, 90)], cronograma: [fila('r1', '2026-01-01', '2026-09-28')], lineaBaseActivaId: 'zzz-lb', hoy });
    const elDia = con('2026-09-28'), alDiaSiguiente = con('2026-09-29'), aLos9 = con('2026-10-07'), alAnio = con('2027-09-28'), aLos5Anios = con('2031-09-28');
    igual(elDia.cronogramaVencido, false, 'el día del último fin todavía no está vencido'); igual(elDia.atrasoDias, 30, 'atraso el día del fin');
    for(const [que, e] of [['al día siguiente', alDiaSiguiente], ['9 días después', aLos9], ['un año después', alAnio], ['cinco años después', aLos5Anios]]){
      igual(e.cronogramaVencido, true, que + ': cronograma vencido'); casi(e.spi, 0.9, que + ': SPI');
      igual(e.atrasoDias, 30, que + ': el atraso sigue en 30 (con la regla vieja crecía cada día)');
      const s = nucleoSemaforo({ evm: e, garantias: SIN_GAR, pendientes: 0 });
      igual(s.color, 'amarillo', que + ': amarillo por SPI, no rojo por atraso'); igual(s.motivos.join('|'), 'SPI 0,90', que + ': motivos');
    }
    // Antes del último fin, los días sí corren con hoy
    const mitad = con('2026-05-16');   // día 135 de 270: plan 50 %, SPI 1,8 → sin atraso
    igual(mitad.cronogramaVencido, false, 'a mitad de cronograma'); igual(mitad.atrasoDias, 0, 'adelantado a mitad');
    // Un atraso ya rojo al vencer se queda rojo, pero tampoco crece: SPI 0,5 → 270 días
    const rojo = hoy => nucleoEvmProyecto({ rubros: [rubro('r1', 100, 50)], cronograma: [fila('r1', '2026-01-01', '2026-09-28')], lineaBaseActivaId: 'zzz-lb', hoy });
    igual(rojo('2026-09-28').atrasoDias, 270, 'SPI 0,5 el día del fin'); igual(rojo('2029-01-01').atrasoDias, 270, 'SPI 0,5 años después');
    // El último fin es el de la fila que cuenta (línea base activa), no el de otra línea base
    const otraLb = nucleoEvmProyecto({ rubros: [rubro('r1', 100, 90), rubro('r2', 0, 0)],
      cronograma: [fila('r1', '2026-01-01', '2026-09-28'), fila('r2', '2030-01-01', '2030-01-01', 'zzz-lb-otra')], lineaBaseActivaId: 'zzz-lb', hoy: '2027-09-28' });
    igual(otraLb.ultimoFin, '2026-09-28', 'ultimoFin de la línea base activa'); igual(otraLb.cronogramaVencido, true, 'vencido'); igual(otraLb.atrasoDias, 30, 'atraso 30');
    // Sin cronograma no hay nada que venza
    igual(nucleoEvmProyecto({ rubros: [rubro('r1', 100, 90)], cronograma: [], lineaBaseActivaId: 'zzz-lb', hoy: '2030-01-01' }).cronogramaVencido, false, 'sin cronograma');
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
    lanza(() => nucleoSemaforo({ evm: evmDe(), garantias: de15, pendientes: 0 }), 'conteo de 15 días', /aviso de 5 días.*diasAviso = 15/);
    lanza(() => nucleoSemaforo({ evm: evmDe(), garantias: nucleoGarantias([], HOY, 15), pendientes: 0 }), 'conteo de 15 días sin ninguna garantía', /aviso de 5 días/);
    lanza(() => nucleoSemaforo({ evm: evmDe(), garantias: nucleoGarantias(lista, HOY, 0), pendientes: 0 }), 'conteo de 0 días', /diasAviso = 0/);
    lanza(() => nucleoSemaforo({ evm: evmDe(), garantias: { vencidas: 0, porVencer: 1 }, pendientes: 0 }), 'conteo a mano sin diasAviso', /diasAviso = undefined/);
    // Con el oficial (por defecto, null o 5 explícito) pasa, y el proyecto queda verde: no hay amarillo de más
    for(const g of [de5, nucleoGarantias(lista, HOY, null), nucleoGarantias(lista, HOY, 5)]){
      const s = nucleoSemaforo({ evm: evmDe(), garantias: g, pendientes: 0 });
      igual(s.color, 'verde', 'con el aviso oficial'); igual(s.motivos.length, 0, 'sin motivos');
    }
    // El texto del motivo sale del aviso del conteo, que es el de la constante
    const s = nucleoSemaforo({ evm: evmDe(), garantias: nucleoGarantias([gar('2026-11-24')], HOY), pendientes: 0 });
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
    const motivo = spi => { const s = nucleoSemaforo({ evm: evmDe({ spi }), garantias: SIN_GAR, pendientes: 0 }); return s.color + ':' + s.motivos.join('|'); };
    igual(motivo(0.8499), 'rojo:SPI 0,84', '0,8499 (redondeado diría 0,85, que es amarillo)');
    igual(motivo(0.849999999), 'rojo:SPI 0,84', '0,849999999');
    igual(motivo(0.85), 'amarillo:SPI 0,85', '0,85 exacto');
    igual(motivo(0.9499), 'amarillo:SPI 0,94', '0,9499 (redondeado diría 0,95, que es verde)');
    igual(motivo(0.899), 'amarillo:SPI 0,89', '0,899');
    igual(motivo(0.57), 'rojo:SPI 0,57', '0,57 no baja a 0,56');
    igual(motivo(0.005), 'rojo:SPI 0,00', '0,005');
    // En todo el intervalo, el número escrito cae del mismo lado del umbral que el color
    for(let i = 0; i < 950; i++){
      const spi = i / 1000 + 0.0003, s = nucleoSemaforo({ evm: evmDe({ spi }), garantias: SIN_GAR, pendientes: 0 });
      const escrito = Number(/^SPI (\d+,\d{2})$/.exec(s.motivos[0])[1].replace(',', '.'));
      assert(s.color === 'rojo' ? escrito < NUCLEO_CARTERA.SPI_ROJO : escrito >= NUCLEO_CARTERA.SPI_ROJO && escrito < NUCLEO_CARTERA.SPI_AMARILLO, `SPI ${spi}: ${s.color} con «${s.motivos[0]}»`);
    }
  });

  // ── Semáforo ──────────────────────────────────────────────────────────────
  await prueba('semáforo: verde sin motivos; sin argumentos tampoco revienta', () => {
    const s = nucleoSemaforo({ evm: evmDe(), garantias: SIN_GAR, pendientes: 0 });
    igual(s.color, 'verde', 'color'); igual(s.motivos.length, 0, 'sin motivos');
    igual(nucleoSemaforo({}).color, 'verde', 'objeto vacío'); igual(nucleoSemaforo({}).motivos.length, 0, 'objeto vacío: sin motivos');
    igual(nucleoSemaforo().color, 'verde', 'sin argumentos');
    igual(nucleoSemaforo({ evm: evmDe(), garantias: null, pendientes: null }).color, 'verde', 'garantías y pendientes nulos');
  });

  await prueba('semáforo: umbrales del SPI — < 0,85 rojo; 0,85 a < 0,95 amarillo; ≥ 0,95 verde', () => {
    const color = spi => nucleoSemaforo({ evm: evmDe({ spi }), garantias: SIN_GAR, pendientes: 0 }).color;
    igual(color(0), 'rojo', '0'); igual(color(0.8499), 'rojo', '0,8499'); igual(color(0.85), 'amarillo', '0,85 exacto');
    igual(color(0.9), 'amarillo', '0,90'); igual(color(0.9499), 'amarillo', '0,9499'); igual(color(0.95), 'verde', '0,95 exacto');
    igual(color(1), 'verde', '1'); igual(color(1.4), 'verde', '1,4');
  });

  await prueba('semáforo: un SPI no válido (plan < 0,5 %) o nulo no decide el color', () => {
    const noValido = nucleoSemaforo({ evm: evmDe({ spi: 0.1, spiValido: false }), garantias: SIN_GAR, pendientes: 0 });
    igual(noValido.color, 'verde', 'SPI 0,10 no válido'); igual(noValido.motivos.join('|'), 'plan a la fecha todavía menor al 0,5 %', 'motivo');
    const nulo = nucleoSemaforo({ evm: evmDe({ spi: null, spiValido: false }), garantias: SIN_GAR, pendientes: 0 });
    igual(nulo.color, 'verde', 'SPI nulo'); igual(nulo.motivos.length, 0, 'con cronograma que aún no empieza: sin motivo');
    const sinCron = nucleoSemaforo({ evm: evmDe({ spi: null, spiValido: false, sinCronograma: true }), garantias: SIN_GAR, pendientes: 0 });
    igual(sinCron.color, 'verde', 'sin cronograma'); igual(sinCron.motivos.join('|'), 'sin cronograma: no hay SPI', 'motivo de sin cronograma');
    // El SPI no válido tampoco estorba a las otras causas
    igual(nucleoSemaforo({ evm: evmDe({ spi: 0.1, spiValido: false }), garantias: G(1, 0), pendientes: 0 }).color, 'rojo', 'garantía vencida con SPI no válido');
  });

  await prueba('semáforo: garantías — vencida = rojo, por vencer = amarillo, con el texto en singular y plural', () => {
    const s1 = nucleoSemaforo({ evm: evmDe(), garantias: G(1, 0), pendientes: 0 });
    igual(s1.color, 'rojo', 'una vencida'); igual(s1.motivos.join('|'), '1 garantía vencida', 'singular');
    const s2 = nucleoSemaforo({ evm: evmDe(), garantias: G(2, 0), pendientes: 0 });
    igual(s2.motivos.join('|'), '2 garantías vencidas', 'plural');
    const s3 = nucleoSemaforo({ evm: evmDe(), garantias: G(0, 1), pendientes: 0 });
    igual(s3.color, 'amarillo', 'una por vencer'); igual(s3.motivos.join('|'), '1 garantía por vencer en 5 días o menos', 'singular');
    const s4 = nucleoSemaforo({ evm: evmDe(), garantias: G(0, 3), pendientes: 0 });
    igual(s4.motivos.join('|'), '3 garantías por vencer en 5 días o menos', 'plural');
    // Sin cronograma también pinta por garantías
    igual(nucleoSemaforo({ evm: evmDe({ spi: null, spiValido: false, sinCronograma: true }), garantias: G(0, 1), pendientes: 0 }).color, 'amarillo', 'sin cronograma y garantía por vencer');
  });

  await prueba('semáforo: pendientes — 5 sigue verde, 6 es amarillo', () => {
    igual(nucleoSemaforo({ evm: evmDe(), garantias: SIN_GAR, pendientes: 5 }).color, 'verde', '5 pendientes');
    const s = nucleoSemaforo({ evm: evmDe(), garantias: SIN_GAR, pendientes: 6 });
    igual(s.color, 'amarillo', '6 pendientes'); igual(s.motivos.join('|'), '6 pendientes (libro, observaciones y solicitudes)', 'motivo');
  });

  await prueba('semáforo: atraso — 30 días no es rojo, 31 sí (aunque el SPI esté en verde)', () => {
    igual(nucleoSemaforo({ evm: evmDe({ spi: 0.97, atrasoDias: 30 }), garantias: SIN_GAR, pendientes: 0 }).color, 'verde', '30 días');
    const s = nucleoSemaforo({ evm: evmDe({ spi: 0.97, atrasoDias: 31 }), garantias: SIN_GAR, pendientes: 0 });
    igual(s.color, 'rojo', '31 días'); igual(s.motivos.join('|'), 'atraso estimado de 31 días', 'motivo');
  });

  await prueba('semáforo: motivos — en rojo van primero los rojos y luego los amarillos; el SPI con coma decimal', () => {
    const todo = nucleoSemaforo({ evm: evmDe({ spi: 0.5, atrasoDias: 44 }), garantias: G(1, 2), pendientes: 9 });
    igual(todo.color, 'rojo', 'color');
    igual(todo.motivos.join('|'), 'SPI 0,50|1 garantía vencida|atraso estimado de 44 días|2 garantías por vencer en 5 días o menos|9 pendientes (libro, observaciones y solicitudes)', 'orden de los motivos');
    const amarillo = nucleoSemaforo({ evm: evmDe({ spi: 0.91 }), garantias: G(0, 1), pendientes: 6 });
    igual(amarillo.color, 'amarillo', 'amarillo');
    igual(amarillo.motivos.join('|'), 'SPI 0,91|1 garantía por vencer en 5 días o menos|6 pendientes (libro, observaciones y solicitudes)', 'motivos del amarillo');
    // Rojo por garantía con SPI amarillo: el SPI se lista después, como motivo secundario, y una sola vez
    const mixto = nucleoSemaforo({ evm: evmDe({ spi: 0.9 }), garantias: G(1, 0), pendientes: 0 });
    igual(mixto.motivos.join('|'), '1 garantía vencida|SPI 0,90', 'rojo por garantía + SPI amarillo');
    // En verde no se arrastran motivos de alerta
    igual(nucleoSemaforo({ evm: evmDe({ spi: 0.99 }), garantias: SIN_GAR, pendientes: 5 }).motivos.length, 0, 'verde sin motivos');
  });

  resumen();
})();
