// ============================================================================
// Núcleo de indicadores de cartera: avance, plan a una fecha, SPI, atraso
// y semáforo. FUENTE ÚNICA de estas reglas: funciones puras (sin DOM,
// sin red, sin estado). Las usan el Panel Cartera y la exportación diaria del
// estado de proyectos; cualquier cambio de fórmula o de umbral se hace SOLO aquí.
//
// Carga: en el navegador con <script> (las funciones quedan globales); en Node
// con require (module.exports); en Deno, que no tiene `module`, con un import
// del archivo solo por su efecto: el módulo se asigna también a globalThis
// (globalThis.nucleoEvmProyecto, globalThis.NUCLEO_CARTERA, …). No hay
// exportación ESM.
//
// Reglas (decididas el 20 y el 21-nov-2026):
//   · Cronograma: solo las filas de la línea base ACTIVA DEL PROPIO proyecto,
//     una por rubro. Sin línea base activa se usan todas las filas del proyecto
//     (una por rubro) y se avisa con sinLineaBase = true. Si un proyecto tiene
//     más de una línea base marcada activa, vale la de mayor número.
//   · Avance del rubro: producción / monto con tope 100 %, y 100 % si su estado
//     es «terminado».
//   · AVANCE PRINCIPAL = valor ganado: Σ peso × avance del rubro sobre TODOS los
//     rubros; peso = monto del rubro / monto vigente. El SPI usa ese mismo valor
//     ganado restringido a los rubros con cronograma (evPct): si todos los rubros
//     están en el cronograma, los dos números son el mismo.
//   · Ejecutado por cantidades = Σ producción / Σ monto de TODOS los rubros, sin
//     tope. Se informa aparte. Si difiere del avance principal en más de 10
//     puntos, el proyecto queda marcado «datos por completar»; también un
//     proyecto finalizado sin producción registrada o sin rubros, y uno sin
//     estado.
//   · SPI = valor ganado en cronograma / plan a la fecha (BCWP / BCWS).
//   · ATRASO A LA FECHA (cronograma ganado): se busca el ÚLTIMO día en que el
//     plan no superaba el valor ganado que hoy se tiene; el atraso son los días
//     de ese día a hoy (un tramo plano del plan, como una pausa programada, no
//     cuenta como atraso). Nunca supera los días transcurridos desde el inicio:
//     el primer inicio programado o, si es posterior, la fecha de inicio del
//     proyecto. Es el que usa el semáforo.
//   · ATRASO PROYECTADO: cuánto se pasaría del último fin programado si la obra
//     sigue al ritmo actual = duración del cronograma × (1/SPI − 1), y nunca
//     menos que los días que ya lleva pasada del fin. Es una proyección y no
//     entra al semáforo. No es estimable (null) sin cronograma, con el plan
//     todavía insignificante o con SPI menor que 0,10.
//   · SEMÁFORO: solo para proyectos en estado «ejecucion». Planificación,
//     pausado, finalizado, cancelado y sin estado no llevan color (color = null).
//     Rojo si SPI < 0,85, el cronograma está vencido sin haber terminado lo
//     programado, hay una garantía vencida o el atraso a la fecha pasa de 30
//     días; amarillo si SPI < 0,95, hay una garantía por vencer o hay más de 5
//     pendientes; verde en lo demás. El SPI no cuenta mientras el plan a la
//     fecha no llegue a 0,5 % del proyecto (arranque de obra).
//     El semáforo solo admite garantías contadas con el aviso oficial de 5 días.
//   · Un hito (inicio = fin) cuenta como programado desde su propio día. Una
//     fila con el fin anterior al inicio se toma con las fechas intercambiadas.
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
  DIFERENCIA_AVANCE_PUNTOS: 10,
  OBRA_TERMINADA_PCT: 99.95,
  SPI_MINIMO_PROYECCION: 0.10,
  ESTADO_CON_SEMAFORO: 'ejecucion',
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
//   fechaInicioProyecto: AAAA-MM-DD opcional (proyectos.fecha_inicio); acota el atraso a la fecha
function nucleoEvmProyecto({ rubros, cronograma, lineaBaseActivaId, hoy, fechaInicioProyecto } = {}){
  hoy = nucleoDiaDe(hoy);
  const inicioProyecto = fechaInicioProyecto === null || fechaInicioProyecto === undefined || fechaInicioProyecto === '' ? null : nucleoDiaDe(fechaInicioProyecto);
  const porId = new Map();
  let vigente = 0, ejecutado = 0;
  // Orden fijo (por id): la suma en coma flotante no depende del orden de llegada.
  const porIdTxt = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  (rubros || []).slice().sort((a, b) => porIdTxt(a.id, b.id)).forEach(r => {
    vigente += Number(r.monto_contrato) || 0;
    ejecutado += Number(r.total_produccion) || 0;
    porId.set(r.id, r);
  });
  const pesoDe = r => vigente > 0 ? (Number(r.monto_contrato) || 0) / vigente * 100 : 0;
  // Valor ganado sobre TODOS los rubros: el avance principal
  let ganadoTotal = 0;
  porId.forEach(r => { ganadoTotal += pesoDe(r) * nucleoAvanceRubro(r) / 100; });

  let filasInvertidas = 0;
  const filas = nucleoFilasCronograma(cronograma, lineaBaseActivaId || null).filter(c => porId.has(c.rubro_id))
    .sort((a, b) => porIdTxt(a.rubro_id, b.rubro_id))
    .map(c => {
      let ini = nucleoDiaDe(c.fecha_inicio), fin = nucleoDiaDe(c.fecha_fin);
      if(fin < ini){ const x = ini; ini = fin; fin = x; filasInvertidas++; }   // fechas invertidas: se intercambian y se avisa
      return { ini, fin, peso: pesoDe(porId.get(c.rubro_id)), rubro: porId.get(c.rubro_id) };
    });
  const planA = fecha => filas.reduce((s, x) => s + x.peso * nucleoFraccionPlan(x.ini, x.fin, fecha), 0);
  let bcwp = 0, planFinal = 0, primerInicio = null, ultimoFin = null;
  filas.forEach(x => {
    bcwp += x.peso * nucleoAvanceRubro(x.rubro) / 100;
    planFinal += x.peso;
    if(!primerInicio || x.ini < primerInicio) primerInicio = x.ini;
    if(!ultimoFin || x.fin > ultimoFin) ultimoFin = x.fin;
  });
  const sinCronograma = filas.length === 0;
  const bcws = planA(hoy);
  const spi = bcws > 0 ? bcwp / bcws : null;
  // El SPI entra a los atrasos y al semáforo solo con un plan significativo a la fecha.
  const spiValido = spi !== null && bcws > NUCLEO_CARTERA.PLAN_MINIMO_PCT;
  const cronogramaVencido = ultimoFin !== null && planFinal > 0 && hoy > ultimoFin;
  // Lo programado está terminado si el valor ganado en cronograma alcanza todo su peso.
  const obraProgramadaTerminada = planFinal > 0 && bcwp >= planFinal * NUCLEO_CARTERA.OBRA_TERMINADA_PCT / 100;

  // Atraso a la fecha (cronograma ganado): ÚLTIMO día en que el plan no superaba el valor ganado
  // de hoy; el atraso son los días de ese día a hoy. Nunca supera los días desde el inicio.
  let atrasoFechaDias = null, fechaGanada = null;
  if(spiValido && primerInicio){
    atrasoFechaDias = 0;
    if(!obraProgramadaTerminada && bcwp < bcws - 1e-9){
      let a = 0, b = nucleoDiasEntre(primerInicio, hoy < ultimoFin ? hoy : ultimoFin);   // días desde el primer inicio
      while(a < b){                                  // el plan no decrece: búsqueda binaria por día
        const m = (a + b + 1) >> 1;
        if(planA(nucleoSumarDias(primerInicio, m)) <= bcwp + 1e-9) a = m; else b = m - 1;
      }
      fechaGanada = nucleoSumarDias(primerInicio, a);
      const desde = inicioProyecto && inicioProyecto > primerInicio ? inicioProyecto : primerInicio;
      const tope = Math.max(0, nucleoDiasEntre(desde, hoy));
      atrasoFechaDias = Math.min(tope, Math.max(0, nucleoDiasEntre(fechaGanada, hoy)));
    }
  }
  // Atraso proyectado al final: duración × (1/SPI − 1), y nunca menos que lo ya pasado del fin.
  let atrasoProyectadoDias = null;
  if(spiValido && primerInicio){
    if(spi >= 1 || obraProgramadaTerminada) atrasoProyectadoDias = 0;
    else if(spi >= NUCLEO_CARTERA.SPI_MINIMO_PROYECCION){
      const proyeccion = Math.round(nucleoDiasEntre(primerInicio, ultimoFin) * (1 / spi - 1));
      atrasoProyectadoDias = Math.max(0, proyeccion, cronogramaVencido ? nucleoDiasEntre(ultimoFin, hoy) : 0);
    }
  }
  const realPct = vigente > 0 ? ejecutado / vigente * 100 : 0;
  return {
    vigente, ejecutado,
    avancePct: ganadoTotal,          // PRINCIPAL: valor ganado de todos los rubros
    realPct,                         // ejecutado por cantidades (Σ producción / Σ monto), sin tope
    diferenciaAvancePuntos: Math.abs(ganadoTotal - realPct),
    planPct: bcws, evPct: bcwp,      // plan a la fecha y valor ganado, ambos de los rubros con cronograma
    planFinalPct: planFinal,
    spi, spiValido,
    atrasoFechaDias, atrasoProyectadoDias, fechaGanada,
    atrasoDias: atrasoFechaDias || 0,   // el atraso que usa el semáforo
    rubros: porId.size,
    rubrosConCronograma: filas.length,
    rubrosSinCronograma: porId.size - filas.length,
    filasCronogramaInvertidas: filasInvertidas,
    sinCronograma,
    sinLineaBase: !lineaBaseActivaId,
    primerInicio, ultimoFin, cronogramaVencido, obraProgramadaTerminada
  };
}

// Avisos de «datos por completar» de un proyecto (textos; lista vacía si no hay ninguno):
// el valor ganado y el ejecutado por cantidades difieren en más de DIFERENCIA_AVANCE_PUNTOS,
// el proyecto está finalizado sin producción registrada (o sin rubros), no tiene estado, o su
// cronograma trae filas con las fechas invertidas.
function nucleoDatosPorCompletar({ evm, estado } = {}){
  const N = NUCLEO_CARTERA, e = evm || {}, avisos = [];
  const pct = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
  if(!estado) avisos.push('proyecto sin estado registrado');
  if(e.filasCronogramaInvertidas > 0) avisos.push(`${e.filasCronogramaInvertidas} fila${e.filasCronogramaInvertidas > 1 ? 's' : ''} de cronograma con la fecha de fin anterior a la de inicio`);
  if((e.diferenciaAvancePuntos || 0) > N.DIFERENCIA_AVANCE_PUNTOS){
    avisos.push(`el valor ganado (${pct(e.avancePct)} %) y el ejecutado por cantidades (${pct(e.realPct)} %) difieren en más de ${N.DIFERENCIA_AVANCE_PUNTOS} puntos`);
  }
  if(estado === 'finalizado'){
    if(!e.rubros) avisos.push('proyecto finalizado sin rubros');
    else if(!((e.ejecutado || 0) > 0)) avisos.push('proyecto finalizado sin producción registrada');
  }
  return avisos;
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
//   estado: proyectos.estado. Hay que pasarlo siempre (undefined LANZA: es un olvido del que
//     llama). Solo «ejecucion» lleva color: en los demás estados, y con estado null o vacío,
//     devuelve { color: null, motivos: [] }.
//   evm: resultado de nucleoEvmProyecto
//   garantias: resultado de nucleoGarantias con el aviso oficial (GARANTIA_AVISO_DIAS). Si se
//     contaron con otro aviso (p. ej. los 15 días de «Esperan decisión») LANZA: ese conteo
//     pondría amarillos de más. Sin garantías (null o undefined) se toma como ninguna.
//   pendientes: libro por aprobar + observaciones abiertas + solicitudes pendientes o en revisión
function nucleoSemaforo({ estado, evm, garantias, pendientes } = {}){
  const N = NUCLEO_CARTERA, e = evm || {}, pend = pendientes || 0;
  if(estado === undefined) throw new Error('El semáforo necesita el estado del proyecto');
  const g = garantias || { vencidas: 0, porVencer: 0, diasAviso: N.GARANTIA_AVISO_DIAS };
  if(g.diasAviso !== N.GARANTIA_AVISO_DIAS){
    throw new Error(`El semáforo solo admite garantías contadas con el aviso de ${N.GARANTIA_AVISO_DIAS} días (llegó diasAviso = ${String(g.diasAviso)})`);
  }
  if(estado !== N.ESTADO_CON_SEMAFORO) return { color: null, motivos: [] };
  const spiT = nucleoSpiTruncado(e.spi);
  const spiTxt = spiT === null ? '' : spiT.toFixed(2).replace('.', ',');
  const pct = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
  const rojo = [], amarillo = [];
  if(e.spiValido && e.spi < N.SPI_ROJO) rojo.push(`SPI ${spiTxt}`);
  if(e.cronogramaVencido && !e.obraProgramadaTerminada) rojo.push(`cronograma vencido el ${e.ultimoFin} con ${pct(e.planFinalPct > 0 ? (e.evPct || 0) / e.planFinalPct * 100 : 0)} % de lo programado`);
  if(g.vencidas > 0) rojo.push(`${g.vencidas} garantía${g.vencidas > 1 ? 's' : ''} vencida${g.vencidas > 1 ? 's' : ''}`);
  if(e.atrasoFechaDias > N.ATRASO_ROJO_DIAS) rojo.push(`atraso a la fecha de ${e.atrasoFechaDias} días`);
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
  nucleoFilasCronograma, nucleoFraccionPlan, nucleoAvanceRubro, nucleoEvmProyecto, nucleoDatosPorCompletar, nucleoGarantias, nucleoSpiTruncado, nucleoSemaforo };
// Deno (y cualquier entorno sin `module`): las piezas quedan en globalThis.
if(typeof globalThis !== 'undefined') Object.assign(globalThis, NUCLEO_CARTERA_API);
if(typeof module !== 'undefined' && module.exports) module.exports = NUCLEO_CARTERA_API;
