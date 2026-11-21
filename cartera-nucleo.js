// ============================================================================
// Núcleo de indicadores de cartera: avance, plan a una fecha, SPI, días de
// atraso y semáforo. FUENTE ÚNICA de estas reglas: funciones puras (sin DOM,
// sin red, sin estado). Las usan el Panel Cartera y la exportación diaria del
// estado de proyectos; cualquier cambio de fórmula o de umbral se hace SOLO aquí.
//
// Carga: en el navegador con <script> (las funciones quedan globales); en Node
// con require (module.exports); en Deno, que no tiene `module`, con un import
// del archivo solo por su efecto: el módulo se asigna también a globalThis
// (globalThis.nucleoEvmProyecto, globalThis.NUCLEO_CARTERA, …). No hay
// exportación ESM.
//
// Reglas (decididas el 20-nov-2026):
//   · Avance ejecutado = Σ producción / Σ monto de TODOS los rubros.
//   · Cronograma: solo las filas de la línea base ACTIVA DEL PROPIO proyecto,
//     una por rubro. Sin línea base activa se usan todas las filas del proyecto
//     (una por rubro) y se avisa con sinLineaBase = true. Si un proyecto tiene
//     más de una línea base marcada activa, vale la de mayor número.
//   · SPI = BCWP / BCWS sobre los rubros con cronograma: peso del rubro = su
//     monto / monto vigente; avance del rubro con tope 100 % y 100 % si su
//     estado es «terminado» (la regla de la Curva S y del Dashboard).
//   · Atraso estimado = días transcurridos desde el primer inicio programado
//     hasta hoy o hasta el último fin programado (lo que ocurra antes) ×
//     (1/SPI − 1); solo si SPI < 1. Con el cronograma ya vencido el atraso deja
//     de crecer (cronogramaVencido = true).
//   · Semáforo: rojo si SPI < 0,85, hay una garantía vencida o el atraso pasa de
//     30 días; amarillo si SPI < 0,95, hay una garantía por vencer o hay más de
//     5 pendientes; verde en lo demás. El SPI no cuenta mientras el plan a la
//     fecha no llegue a 0,5 % del proyecto (arranque de obra).
//     El semáforo solo admite garantías contadas con el aviso oficial de 5 días.
//   · En los motivos el SPI se escribe TRUNCADO a dos decimales (0,8499 → 0,84),
//     para que el texto nunca contradiga el umbral que lo puso en ese color.
//   · «Hoy» es siempre la fecha de America/Guayaquil.
//   · Las fechas son textos AAAA-MM-DD (o AAAA-MM-DDThh:mm…, del que cuentan los
//     10 primeros caracteres). Una fecha mal formada o inexistente, o un «hoy»
//     ausente, LANZA un Error: nunca se devuelve un verde por no poder calcular.
// ============================================================================

const NUCLEO_CARTERA = Object.freeze({
  SPI_ROJO: 0.85,
  SPI_AMARILLO: 0.95,
  ATRASO_ROJO_DIAS: 30,
  PENDIENTES_AMARILLO: 5,
  GARANTIA_AVISO_DIAS: 5,
  PLAN_MINIMO_PCT: 0.5,
  ZONA: 'America/Guayaquil'
});

// Fecha (AAAA-MM-DD) en Ecuador. `ahora` permite fijar el instante en las pruebas.
function nucleoHoyEcuador(desplazamientoDias, ahora){
  const base = ahora ? new Date(ahora).getTime() : Date.now();
  const d = new Date(base + (desplazamientoDias || 0) * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: NUCLEO_CARTERA.ZONA }).format(d);
}

// Milisegundos de una fecha AAAA-MM-DD tomada como día civil (sin zona). Acepta también
// 'AAAA-MM-DDThh:mm…' (cuentan los 10 primeros caracteres). LANZA si el valor no es un texto
// con esa forma o si la fecha no existe (Date, undefined, 'dd/mm/aaaa', '2026-02-30').
function nucleoMsDeFecha(iso){
  const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if(!m) throw new Error('Fecha no válida (se espera un texto AAAA-MM-DD): ' + (typeof iso === 'string' ? '«' + iso.slice(0, 30) + '»' : 'valor de tipo ' + (iso === null ? 'null' : typeof iso)));
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if(new Date(ms).toISOString().slice(0, 10) !== m[0]) throw new Error('Fecha inexistente: «' + m[0] + '»');
  return ms;
}
// Los 10 primeros caracteres (AAAA-MM-DD) de una fecha válida; lanza si no lo es.
function nucleoDiaDe(iso){
  nucleoMsDeFecha(iso);
  return iso.slice(0, 10);
}
function nucleoSumarDias(iso, dias){
  return new Date(nucleoMsDeFecha(iso) + dias * 86400000).toISOString().slice(0, 10);
}
// Días civiles de `desde` a `hasta` (positivo si `hasta` es posterior).
function nucleoDiasEntre(desde, hasta){
  return Math.round((nucleoMsDeFecha(hasta) - nucleoMsDeFecha(desde)) / 86400000);
}

// Línea base activa de UN proyecto: de sus líneas base [{ id, numero, activa }], la que tiene
// activa === true; si hay más de una (nada en la base lo impide), la de MAYOR numero, sea cual
// sea el orden en que llegaron. Sin ninguna activa, null.
function nucleoLineaBaseActiva(lineasBase){
  let mejor = null;
  (lineasBase || []).forEach(l => {
    if(!l || l.activa !== true) return;
    if(mejor === null || (Number(l.numero) || 0) > (Number(mejor.numero) || 0)) mejor = l;
  });
  return mejor;
}

// Filas de cronograma que cuentan para un proyecto: las de su línea base activa
// (o todas si no tiene), con ambas fechas, una por rubro (gana la última leída).
function nucleoFilasCronograma(filas, lineaBaseActivaId){
  const porRubro = new Map();
  (filas || []).forEach(c => {
    if(!c || !c.rubro_id || !c.fecha_inicio || !c.fecha_fin) return;
    if(lineaBaseActivaId && c.linea_base_id !== lineaBaseActivaId) return;
    porRubro.set(c.rubro_id, c);
  });
  return [...porRubro.values()];
}

// Fracción programada de una actividad a una fecha (0 a 1). Inicio = fin es un hito.
function nucleoFraccionPlan(fechaInicio, fechaFin, hoy){
  const ini = nucleoMsDeFecha(fechaInicio), fin = nucleoMsDeFecha(fechaFin), h = nucleoMsDeFecha(hoy);
  if(fin <= ini) return h >= fin ? 1 : 0;
  return Math.max(0, Math.min(1, (h - ini) / (fin - ini)));
}

// Avance real de un rubro en % (0 a 100): terminado = 100; si no, producción / monto con tope.
function nucleoAvanceRubro(rubro){
  if(!rubro) return 0;
  if(rubro.estado === 'terminado') return 100;
  const monto = Number(rubro.monto_contrato) || 0;
  return monto > 0 ? Math.max(0, Math.min(100, (Number(rubro.total_produccion) || 0) / monto * 100)) : 0;
}

// Indicadores de valor ganado de UN proyecto.
//   rubros:      [{ id, monto_contrato, total_produccion, estado }]   (todos los del proyecto)
//   cronograma:  [{ rubro_id, fecha_inicio, fecha_fin, linea_base_id }] (todas las filas del proyecto)
//   lineaBaseActivaId: id de su línea base activa, o null
//   hoy: AAAA-MM-DD (Ecuador); obligatorio y válido (lanza si no)
function nucleoEvmProyecto({ rubros, cronograma, lineaBaseActivaId, hoy } = {}){
  hoy = nucleoDiaDe(hoy);
  const porId = new Map();
  let vigente = 0, ejecutado = 0;
  (rubros || []).forEach(r => {
    vigente += Number(r.monto_contrato) || 0;
    ejecutado += Number(r.total_produccion) || 0;
    porId.set(r.id, r);
  });
  const filas = nucleoFilasCronograma(cronograma, lineaBaseActivaId || null).filter(c => porId.has(c.rubro_id));
  let bcws = 0, bcwp = 0, primerInicio = null, ultimoFin = null;
  filas.forEach(c => {
    const r = porId.get(c.rubro_id);
    const peso = vigente > 0 ? (Number(r.monto_contrato) || 0) / vigente * 100 : 0;
    const ini = nucleoDiaDe(c.fecha_inicio), fin = nucleoDiaDe(c.fecha_fin);
    bcws += peso * nucleoFraccionPlan(ini, fin, hoy);
    bcwp += peso * nucleoAvanceRubro(r) / 100;
    if(!primerInicio || ini < primerInicio) primerInicio = ini;
    if(!ultimoFin || fin > ultimoFin) ultimoFin = fin;
  });
  const spi = bcws > 0 ? bcwp / bcws : null;
  // El SPI entra al atraso y al semáforo solo con un plan significativo a la fecha.
  const spiValido = spi !== null && bcws > NUCLEO_CARTERA.PLAN_MINIMO_PCT;
  // Con el cronograma vencido los días transcurridos se cuentan hasta el último fin programado:
  // el atraso estimado deja de crecer aunque pasen los meses.
  const cronogramaVencido = ultimoFin !== null && hoy > ultimoFin;
  let atrasoDias = 0;
  if(spiValido && spi > 0 && spi < 1 && primerInicio){
    const transcurridos = Math.max(0, nucleoDiasEntre(primerInicio, cronogramaVencido ? ultimoFin : hoy));
    atrasoDias = Math.round(transcurridos * (1 / spi - 1));
  }
  return {
    vigente, ejecutado,
    realPct: vigente > 0 ? ejecutado / vigente * 100 : 0,
    planPct: bcws, evPct: bcwp,
    spi, spiValido, atrasoDias,
    rubrosConCronograma: filas.length,
    sinCronograma: filas.length === 0,
    sinLineaBase: !lineaBaseActivaId,
    primerInicio, ultimoFin, cronogramaVencido
  };
}

// Garantías vigentes: cuántas están vencidas y cuántas vencen en `diasAviso` días o menos.
// Una garantía sin fecha de vigencia no cuenta en ninguna de las dos («por definir»).
// `hoy` es obligatorio y válido (lanza si no). `diasAviso` null o undefined = el aviso oficial
// (GARANTIA_AVISO_DIAS). El resultado dice con qué aviso se contó (diasAviso): el semáforo
// solo acepta el oficial.
function nucleoGarantias(garantias, hoy, diasAviso){
  hoy = nucleoDiaDe(hoy);
  const aviso = diasAviso === undefined || diasAviso === null ? NUCLEO_CARTERA.GARANTIA_AVISO_DIAS : diasAviso;
  if(typeof aviso !== 'number' || !Number.isInteger(aviso) || aviso < 0) throw new Error('Días de aviso de garantías no válidos: ' + String(aviso));
  const limite = nucleoSumarDias(hoy, aviso);
  let vencidas = 0, porVencer = 0;
  (garantias || []).forEach(g => {
    if(!g || g.estado !== 'vigente' || g.vigencia_hasta === null || g.vigencia_hasta === undefined || g.vigencia_hasta === '') return;
    const v = nucleoDiaDe(g.vigencia_hasta);
    if(v < hoy) vencidas++;
    else if(v <= limite) porVencer++;
  });
  return { vencidas, porVencer, diasAviso: aviso };
}

// SPI truncado (no redondeado) a dos decimales: 0,8499 → 0,84. Es el número que se escribe,
// para que un SPI en rojo (< 0,85) nunca se lea «0,85». null si no hay SPI.
function nucleoSpiTruncado(spi){
  if(spi === null || spi === undefined || !Number.isFinite(spi)) return null;
  let c = Math.round(spi * 100);          // centésima más cercana…
  if(c / 100 > spi) c -= 1;               // …y una menos si quedó por encima del valor
  return c / 100;
}

// Color del semáforo y sus motivos (texto para leer; el primero es el que decide).
//   evm: resultado de nucleoEvmProyecto
//   garantias: resultado de nucleoGarantias con el aviso oficial (GARANTIA_AVISO_DIAS). Si se
//     contaron con otro aviso (p. ej. los 15 días de «Esperan decisión») LANZA: ese conteo
//     pondría amarillos de más. Sin garantías (null o undefined) se toma como ninguna.
//   pendientes: libro por aprobar + observaciones abiertas + solicitudes pendientes o en revisión
function nucleoSemaforo({ evm, garantias, pendientes } = {}){
  const N = NUCLEO_CARTERA, e = evm || {}, pend = pendientes || 0;
  const g = garantias || { vencidas: 0, porVencer: 0, diasAviso: N.GARANTIA_AVISO_DIAS };
  if(g.diasAviso !== N.GARANTIA_AVISO_DIAS){
    throw new Error(`El semáforo solo admite garantías contadas con el aviso de ${N.GARANTIA_AVISO_DIAS} días (llegó diasAviso = ${String(g.diasAviso)})`);
  }
  const spiT = nucleoSpiTruncado(e.spi);
  const spiTxt = spiT === null ? '' : spiT.toFixed(2).replace('.', ',');
  const rojo = [], amarillo = [];
  if(e.spiValido && e.spi < N.SPI_ROJO) rojo.push(`SPI ${spiTxt}`);
  if(g.vencidas > 0) rojo.push(`${g.vencidas} garantía${g.vencidas > 1 ? 's' : ''} vencida${g.vencidas > 1 ? 's' : ''}`);
  if(e.atrasoDias > N.ATRASO_ROJO_DIAS) rojo.push(`atraso estimado de ${e.atrasoDias} días`);
  if(e.spiValido && e.spi >= N.SPI_ROJO && e.spi < N.SPI_AMARILLO) amarillo.push(`SPI ${spiTxt}`);
  if(g.porVencer > 0) amarillo.push(`${g.porVencer} garantía${g.porVencer > 1 ? 's' : ''} por vencer en ${g.diasAviso} días o menos`);
  if(pend > N.PENDIENTES_AMARILLO) amarillo.push(`${pend} pendientes (libro, observaciones y solicitudes)`);
  if(rojo.length) return { color: 'rojo', motivos: rojo.concat(amarillo) };
  if(amarillo.length) return { color: 'amarillo', motivos: amarillo };
  const verde = [];
  if(e.sinCronograma) verde.push('sin cronograma: no hay SPI');
  else if(e.spi !== null && e.spi !== undefined && !e.spiValido) verde.push('plan a la fecha todavía menor al 0,5 %');
  return { color: 'verde', motivos: verde };
}

// Una sola lista de piezas públicas para las tres formas de carga.
const NUCLEO_CARTERA_API = { NUCLEO_CARTERA, nucleoHoyEcuador, nucleoMsDeFecha, nucleoSumarDias, nucleoDiasEntre, nucleoLineaBaseActiva,
  nucleoFilasCronograma, nucleoFraccionPlan, nucleoAvanceRubro, nucleoEvmProyecto, nucleoGarantias, nucleoSpiTruncado, nucleoSemaforo };
// Deno (y cualquier entorno sin `module`): las piezas quedan en globalThis.
if(typeof globalThis !== 'undefined') Object.assign(globalThis, NUCLEO_CARTERA_API);
if(typeof module !== 'undefined' && module.exports) module.exports = NUCLEO_CARTERA_API;
