// ============================================================================
// Exportación diaria del estado de proyectos: módulo PURO (sin red ni disco).
//
//   construirEstado(datos, opciones)  →  objeto del GDO-estado-proyectos.json (formato 1)
//   estadoAMarkdown(estado)           →  texto del GDO-estado-proyectos.md
//   estadoDelResumen(estado)          →  'ok' | 'parcial' | 'null'
//   limpiarTexto(texto)               →  el texto sin correos ni uuid
//
// «datos» es el objeto que devuelve exportacion/consulta.sql (una clave por tabla).
// Avance, SPI, atraso, línea base activa, garantías vencidas / por vencer y semáforo
// salen SIEMPRE de ../cartera-nucleo.js: aquí no se repite ninguna de esas fórmulas.
//
// Reglas propias de la exportación (fase 0, con las decisiones del 21-nov-2026):
//   · Proyectos incluidos (D9): los no liquidados que tienen código. Los de estado
//     «finalizado» o «cancelado» solo si tienen algo pendiente: planilla en revisión
//     o aprobada sin pagar, garantía vigente, acta o liquidación pendiente,
//     observación abierta o en proceso, u orden de cambio solicitada. Los pausados
//     van siempre. La cabecera cuenta los excluidos por motivo.
//   · Acta o liquidación pendiente (D6): cuenta SOLO desde que existe el acta
//     provisional. Con provisional y sin definitiva falta la definitiva; con
//     definitiva y sin liquidación falta la liquidación. Un proyecto finalizado o
//     cancelado SIN acta provisional no tiene «acta pendiente»: entra solo por otro
//     pendiente y no genera fila de acta.
//   · «Esperan decisión»: planillas enviadas o en revisión, órdenes de cambio
//     solicitadas, garantías vencidas o que vencen en 15 días o menos (D7),
//     observaciones abiertas o en proceso con MÁS de 15 días (D5) y actas o
//     liquidación pendientes (D6). Las planillas aprobadas sin pagar NO van aquí:
//     quedan en el bloque de planillas del proyecto.
//     Orden por urgencia: primero las garantías (la más vencida primero, luego la
//     que vence antes), después lo que espera (más días primero) y al final lo que
//     no tiene fecha. Cada fila dice qué cuentan sus días con «sentido»:
//     'vencida_hace', 'faltan' o 'esperando'.
//   · El aviso de 15 días de «Esperan decisión» NO es el del semáforo: el semáforo
//     usa el suyo (5 días) dentro del núcleo.
//   · Identidad: el código y el nombre del proyecto se leen fuera de cualquier
//     try; un proyecto nunca sale anónimo. Cada entrada de bloques_fallidos lleva
//     el código y el índice del proyecto en la lista «proyectos».
//   · Cada bloque de cada proyecto y cada parte del resumen se calcula en su propio
//     try/catch: si falla queda en null y se anota en bloques_fallidos. Nunca se
//     omite nada en silencio.
//   · Resumen por gestora, emisor y tipo: cuenta SOLO los proyectos incluidos.
//     Una empresa que no esté en el catálogo se agrupa como «(empresa no
//     encontrada)».
//   · La salida no lleva identificadores internos ni correos: no se exporta
//     ninguna columna de ese tipo y, además, todo texto libre (descripciones,
//     títulos, nombres) pasa por limpiarTexto, que sustituye correos y uuid por
//     «(dato omitido)». Los teléfonos escritos dentro de un texto libre NO se
//     detectan.
// ============================================================================
'use strict';
const N = require('../cartera-nucleo.js');

const FORMATO = 1;
const OBSERVACION_ANTIGUA_DIAS = 15;   // D5: más de 15 días
const GARANTIA_DECISION_DIAS = 15;     // D7: 15 días o menos (solo «Esperan decisión»)
const PROXIMOS_DIAS = 14;
const OBSERVACIONES_LISTADAS = 3;
const ORDEN_COLOR = { rojo: 0, amarillo: 1, verde: 2 };
const PARTES_RESUMEN = ['por_gestora', 'por_emisor', 'por_tipo', 'semaforo', 'esperan_decision'];
const OMITIDO = '(dato omitido)';
const EMPRESA_NO_ENCONTRADA = '(empresa no encontrada)';

const TIPOS_GARANTIA = { buen_uso_anticipo: 'Buen uso del anticipo', fiel_cumplimiento: 'Fiel cumplimiento',
  buena_calidad_materiales: 'Buena calidad de materiales', todo_riesgo: 'Todo riesgo', otra: 'Otra' };
const TIPOS_PROYECTO = { fiscalizacion: 'fiscalización', gerencia: 'gerencia de proyecto', disenos: 'diseños',
  construccion: 'construcción', pilotes: 'pilotes', muros_pantalla: 'muros pantalla', puentes: 'puentes' };
const ESTADOS_PROYECTO = { planificacion: 'en planificación', ejecucion: 'en ejecución', pausado: 'pausado',
  finalizado: 'finalizado', cancelado: 'cancelado' };
const ESTADOS_CIERRE = { recepcion_provisional: 'recepción provisional', recepcion_definitiva: 'recepción definitiva', liquidado: 'liquidado' };
const ESTADOS_PLANILLA = { borrador: 'borrador', enviada: 'enviada', en_revision: 'en revisión', aprobada: 'aprobada',
  pagada: 'pagada', rechazada: 'rechazada' };
const MODULOS = { general: 'general', contratos: 'contratos', libro_obra: 'libro de obra', rubros: 'rubros',
  fiscalizacion: 'observaciones', curva_s: 'curva S', sin_modulo: 'sin módulo' };
const CLASES_DECISION = { planilla_en_revision: 'Planilla en revisión', orden_cambio_solicitada: 'Orden de cambio solicitada',
  garantia_por_vencer: 'Garantía por vencer', garantia_vencida: 'Garantía vencida', observacion_antigua: 'Observación sin resolver',
  acta_definitiva_pendiente: 'Acta definitiva pendiente', liquidacion_pendiente: 'Liquidación pendiente' };
// Bloques de los que sale «Esperan decisión»: si alguno falla, la tabla queda incompleta.
const BLOQUES_DE_DECISION = ['planillas', 'ordenes_cambio', 'garantias', 'observaciones', 'cierre', 'esperan_decision'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const RE_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Un correo y, por prudencia, cualquier palabra que lleve «@».
// Solo lo que tiene forma de correo (usuario@dominio.tld): una arroba de obra («Ø12@20cm», «3 @») se respeta.
const RE_CORREO = /[^\s«»"'()<>\[\]{},;:|@]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// ── Utilidades ──────────────────────────────────────────────────────────────
function redondear(v, decimales){ const f = Math.pow(10, decimales); return Math.round(v * f) / f; }
const comparar = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Limpiador de textos libres: sustituye uuid y correos por «(dato omitido)».
function limpiarTexto(v){
  return String(v === null || v === undefined ? '' : v).replace(RE_UUID, OMITIDO).replace(RE_CORREO, OMITIDO);
}
// Texto de una columna: null si viene vacío; si no, limpio de correos y uuid.
function textoLimpio(v){
  if(v === null || v === undefined) return null;
  const s = limpiarTexto(v).trim();
  return s === '' ? null : s;
}
// Número de un campo: null si viene vacío; error si no es un número.
function numero(v, campo){
  if(v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if(!Number.isFinite(n)) throw new Error(`número inválido en ${campo}`);
  return n;
}
// Fecha AAAA-MM-DD de Ecuador a partir de una fecha (date) o de un instante (timestamptz).
function fechaEcuador(v, campo){
  if(v === null || v === undefined || v === '') return null;
  if(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)){
    try{ N.nucleoMsDeFecha(v); }catch(e){ throw new Error(`fecha inválida en ${campo}`); }
    return v;
  }
  const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v) ? new Date(v) : null;
  if(!d || isNaN(d.getTime())) throw new Error(`fecha inválida en ${campo}`);
  return N.nucleoHoyEcuador(0, d.toISOString());
}
// Instante local de Ecuador con su desplazamiento. Ecuador continental no tiene
// horario de verano: siempre UTC−05:00.
function instanteEcuador(fecha){
  return new Date(fecha.getTime() - 5 * 3600000).toISOString().slice(0, 19) + '-05:00';
}
// El motivo de un fallo no debe arrastrar identificadores ni correos a la salida.
function motivoSeguro(e){
  return limpiarTexto((e && e.message) || e).slice(0, 200);
}

// ── Construcción del estado ─────────────────────────────────────────────────
function construirEstado(datos, opciones){
  const op = opciones || {};
  if(!datos || typeof datos !== 'object' || !Array.isArray(datos.proyectos)) throw new Error('Los datos no traen la lista de proyectos');
  const ahora = op.ahora ? new Date(op.ahora) : new Date();
  if(isNaN(ahora.getTime())) throw new Error('Instante «ahora» inválido');
  const hoy = N.nucleoHoyEcuador(0, ahora.toISOString());

  // Fallos anotados. «reg» es el registro del proyecto (null si el fallo es del resumen):
  // el código y el índice se escriben al final, cuando la lista ya está ordenada.
  const fallidos = [];
  function anotar(bloque, reg, e){ fallidos.push({ bloque, reg: reg || null, motivo: motivoSeguro(e) }); }
  function intentar(bloque, reg, fn){
    try{ return fn(); }
    catch(e){ anotar(bloque, reg, e); return null; }
  }
  // Filas de una tabla; error claro si la consulta no la trajo.
  function tabla(nombre){
    if(!Array.isArray(datos[nombre])) throw new Error(`falta la tabla «${nombre}» en los datos`);
    return datos[nombre];
  }
  const indices = new Map();
  function grupo(nombre, clave){
    const k = nombre + '|' + (clave || 'proyecto_id');
    if(!indices.has(k)){
      const m = new Map();
      tabla(nombre).forEach(f => {
        if(!f) return;
        const id = f[clave || 'proyecto_id'];
        if(!m.has(id)) m.set(id, []);
        m.get(id).push(f);
      });
      indices.set(k, m);
    }
    return indices.get(k);
  }
  const de = (nombre, id, clave) => grupo(nombre, clave).get(id) || [];
  const diasDesde = fecha => (fecha ? N.nucleoDiasEntre(fecha, hoy) : null);

  // Empresa del catálogo. Sin id → null. Si el id no está en el catálogo NO lanza: devuelve
  // «(empresa no encontrada)» con falta = true. Solo lanza si falta la tabla entera.
  function empresa(id){
    if(!id) return null;
    const e = de('empresas', id, 'id')[0];
    if(!e) return { sigla: null, nombre: EMPRESA_NO_ENCONTRADA, falta: true };
    return { sigla: textoLimpio(e.sigla) || textoLimpio(e.nombre), nombre: textoLimpio(e.nombre) || textoLimpio(e.sigla), falta: false };
  }
  // Gestora y emisor documental vigente (si el proyecto no tiene emisor propio, emite la gestora).
  function empresasDe(p){
    const gestora = empresa(p.empresa_id);
    return { gestora, emisor: p.emisor_empresa_id ? empresa(p.emisor_empresa_id) : gestora };
  }
  function nombrePerfil(id){
    const p = id ? de('perfiles', id, 'id')[0] : null;
    if(!p) return null;
    return [p.nombre, p.apellido].map(x => textoLimpio(x) || '').filter(Boolean).join(' ') || null;
  }

  // Cronograma del proyecto: las filas de SUS rubros (el núcleo además descarta los rubros
  // ajenos), de la más antigua a la más reciente. El núcleo se queda con la última fila de
  // cada rubro: con este orden es siempre la más reciente, llegue como llegue la consulta.
  function cronogramaDe(rubros){
    const propios = new Set(rubros.map(r => r.id));
    return tabla('cronograma_rubros').filter(c => c && propios.has(c.rubro_id))
      .map((c, i) => ({ c, i }))
      .sort((a, b) => ((a.c.created_at ? 0 : 1) - (b.c.created_at ? 0 : 1)) || comparar(String(a.c.created_at || ''), String(b.c.created_at || '')) || comparar(String(a.c.id || ''), String(b.c.id || '')) || a.i - b.i)
      .map(x => x.c);
  }
  function evmDe(p){
    const rubros = de('rubros', p.id);
    rubros.forEach(r => { numero(r.monto_contrato, 'rubros.monto_contrato'); numero(r.total_produccion, 'rubros.total_produccion'); });
    const cronograma = cronogramaDe(rubros);
    cronograma.forEach(c => { fechaEcuador(c.fecha_inicio, 'cronograma_rubros.fecha_inicio'); fechaEcuador(c.fecha_fin, 'cronograma_rubros.fecha_fin'); });
    const lb = N.nucleoLineaBaseActiva(de('lineas_base', p.id));
    return { rubros, cronograma, lb, evm: N.nucleoEvmProyecto({ rubros, cronograma, lineaBaseActivaId: lb ? lb.id : null, hoy }) };
  }

  // D6: qué acta o liquidación está pendiente (null si ninguna). Solo cuenta desde que existe
  // el acta provisional (la fila del acta o el estado de cierre del proyecto).
  function cierrePendiente(p){
    const actas = de('actas_recepcion', p.id);
    const provisional = actas.find(a => a.tipo === 'provisional') || null;
    const definitiva = actas.find(a => a.tipo === 'definitiva') || null;
    const tieneDefinitiva = !!definitiva || p.estado_cierre === 'recepcion_definitiva';
    const tieneProvisional = !!provisional || p.estado_cierre === 'recepcion_provisional';
    if(tieneDefinitiva){
      return de('liquidaciones', p.id).length ? null
        : { clase: 'liquidacion_pendiente', detalle: 'Con acta definitiva y sin liquidación', desde: definitiva ? definitiva.fecha : null };
    }
    if(tieneProvisional) return { clase: 'acta_definitiva_pendiente', detalle: 'Con acta provisional y sin acta definitiva', desde: provisional ? provisional.fecha : null };
    return null;
  }
  const obsSinResolver = o => o.estado === 'abierta' || o.estado === 'en_proceso';
  const planillaEnRevision = pl => pl.estado === 'enviada' || pl.estado === 'en_revision';
  const cerrado = p => p.estado === 'finalizado' || p.estado === 'cancelado';
  // D9: ¿un proyecto finalizado o cancelado tiene algo pendiente?
  function tienePendientes(p){
    return de('planillas_pago', p.id).some(pl => planillaEnRevision(pl) || pl.estado === 'aprobada')
      || de('garantias', p.id).some(g => g.estado === 'vigente')
      || cierrePendiente(p) !== null
      || de('observaciones', p.id).some(obsSinResolver)
      || de('ordenes_cambio', p.id).some(o => o.estado === 'solicitada');
  }

  // ── Bloques de un proyecto ────────────────────────────────────────────────
  // Cada función recibe el registro del proyecto: { p, codigo, nombre, interno }.
  // «interno» guarda lo que «Esperan decisión» necesita y no se exporta.

  // La identidad NUNCA es null: código y nombre ya están leídos; el resto se calcula en
  // tres partes, cada una con su try (identidad, identidad.empresa, identidad.monto_vigente).
  function bloqueIdentidad(reg){
    const p = reg.p;
    const id = {
      codigo: reg.codigo, nombre: reg.nombre, descripcion: null,
      ubicacion: null, latitud: null, longitud: null,
      gestora: null, emisor: null, tipo: null,
      contratante: null, contratista: null, estado: null, estado_cierre: null,
      fecha_firma: null,   // D4: la base no guarda la fecha de firma
      fecha_inicio: null, fecha_fin_contractual: null, fecha_fin_real: null,
      monto_contractual: null, monto_vigente: null, monto_ordenes_cambio: null
    };
    const resto = intentar('identidad', reg, () => ({
      descripcion: textoLimpio(p.descripcion),
      ubicacion: textoLimpio(p.ubicacion), latitud: numero(p.latitud, 'proyectos.latitud'), longitud: numero(p.longitud, 'proyectos.longitud'),
      tipo: textoLimpio(p.tipo),
      contratante: textoLimpio(p.contratante), contratista: textoLimpio(p.contratista),
      estado: textoLimpio(p.estado), estado_cierre: textoLimpio(p.estado_cierre),
      fecha_inicio: fechaEcuador(p.fecha_inicio, 'proyectos.fecha_inicio'),
      fecha_fin_contractual: fechaEcuador(p.fecha_fin_planificada, 'proyectos.fecha_fin_planificada'),
      fecha_fin_real: fechaEcuador(p.fecha_fin_real, 'proyectos.fecha_fin_real'),
      monto_contractual: numero(p.monto_contrato, 'proyectos.monto_contrato'),
      monto_ordenes_cambio: redondear(de('ordenes_cambio', p.id).filter(o => o.estado === 'aprobada')
        .reduce((s, o) => s + (numero(o.monto_total, 'ordenes_cambio.monto_total') || 0), 0), 2)
    }));
    if(resto) Object.assign(id, resto);
    const emp = intentar('identidad.empresa', reg, () => {
      const { gestora, emisor } = empresasDe(p);
      if((gestora && gestora.falta) || (emisor && emisor.falta)) anotar('identidad.empresa', reg, 'empresa no encontrada en el catálogo');
      const sigla = e => (e ? (e.falta ? EMPRESA_NO_ENCONTRADA : e.sigla) : null);
      return { gestora: sigla(gestora), emisor: sigla(emisor) };
    });
    if(emp) Object.assign(id, emp);
    id.monto_vigente = intentar('identidad.monto_vigente', reg, () => redondear(evmDe(p).evm.vigente, 2));
    return id;
  }

  function bloqueAvance(reg){
    const p = reg.p;
    const { lb, evm } = evmDe(p);
    const garantias = de('garantias', p.id);
    garantias.forEach(g => fechaEcuador(g.vigencia_hasta, 'garantias.vigencia_hasta'));
    const libro = de('libro_obra', p.id)[0];
    // Pendientes del semáforo, como en el Panel Cartera: libro por aprobar +
    // observaciones abiertas + solicitudes pendientes o en revisión.
    const pendientes = (libro ? numero(libro.pendientes_aprobacion, 'libro_obra.pendientes_aprobacion') || 0 : 0)
      + de('observaciones', p.id).filter(o => o.estado === 'abierta').length
      + de('solicitudes', p.id).filter(s => s.estado === 'pendiente' || s.estado === 'en_revision').length;
    // El semáforo recibe las garantías contadas con el aviso oficial del núcleo (5 días).
    const semaforo = N.nucleoSemaforo({ evm, garantias: N.nucleoGarantias(garantias, hoy), pendientes });
    return {
      ejecutado_pct: redondear(evm.realPct, 2),
      programado_pct: evm.sinCronograma ? null : redondear(evm.planPct, 2),
      valor_ganado_pct: evm.sinCronograma ? null : redondear(evm.evPct, 2),
      spi: evm.spiValido ? redondear(evm.spi, 4) : null,
      // null = no se puede estimar (sin SPI válido, o SPI 0: nada hecho de lo programado).
      dias_atraso: evm.spiValido && evm.spi > 0 ? evm.atrasoDias : null,
      cronograma_vencido: evm.cronogramaVencido,
      linea_base: lb ? `LB-${lb.numero}` : null,
      semaforo: semaforo.color, motivos: semaforo.motivos
    };
  }

  function bloqueProximos(reg){
    const { rubros, cronograma, lb } = evmDe(reg.p);
    const porId = new Map(rubros.map(r => [r.id, r]));
    const limite = N.nucleoSumarDias(hoy, PROXIMOS_DIAS);
    return N.nucleoFilasCronograma(cronograma, lb ? lb.id : null)
      .map(c => {
        const a = fechaEcuador(c.fecha_inicio, 'cronograma_rubros.fecha_inicio'), b = fechaEcuador(c.fecha_fin, 'cronograma_rubros.fecha_fin');
        return { rubro: porId.get(c.rubro_id), inicio: a <= b ? a : b, fin: a <= b ? b : a };
      })
      .filter(x => x.rubro && x.rubro.estado !== 'terminado' && x.inicio <= limite && x.fin >= hoy)
      .sort((x, y) => comparar(x.inicio, y.inicio) || String(x.rubro.codigo || '').localeCompare(String(y.rubro.codigo || ''), 'es', { numeric: true }))
      .map(x => ({ rubro_codigo: textoLimpio(x.rubro.codigo), rubro: textoLimpio(x.rubro.descripcion), inicio: x.inicio, fin: x.fin }));
  }

  function bloquePlanillas(reg){
    const lista = de('planillas_pago', reg.p.id);
    // La fecha de envío y la de aprobación solo quedan en el historial (texto libre).
    const fechaAccion = (pl, re) => {
      const fechas = de('planilla_historial', pl.id, 'planilla_id').filter(h => re.test(String(h.accion || '')))
        .map(h => fechaEcuador(h.created_at, 'planilla_historial.created_at')).filter(Boolean).sort();
      return fechas.length ? fechas[fechas.length - 1] : null;
    };
    const filas = lista.map(pl => {
      const creada = fechaEcuador(pl.created_at, 'planillas_pago.created_at');
      const enviada = fechaAccion(pl, /enviada/i) || creada;
      const aprobada = fechaAccion(pl, /aprobada/i) || fechaEcuador(pl.fecha_aprobacion, 'planillas_pago.fecha_aprobacion')
        || fechaEcuador(pl.updated_at, 'planillas_pago.updated_at');
      const liquido = numero(pl.total_liquido, 'planillas_pago.total_liquido');
      let fecha = creada;
      if(planillaEnRevision(pl)) fecha = enviada;
      else if(pl.estado === 'aprobada') fecha = aprobada;
      else if(pl.estado === 'pagada') fecha = fechaEcuador(pl.fecha_pago, 'planillas_pago.fecha_pago') || aprobada;
      else if(pl.estado === 'rechazada') fecha = fechaAccion(pl, /rechazada/i) || fechaEcuador(pl.updated_at, 'planillas_pago.updated_at');
      return {
        numero: numero(pl.numero, 'planillas_pago.numero'), estado: textoLimpio(pl.estado),
        periodo_desde: fechaEcuador(pl.fecha_inicio, 'planillas_pago.fecha_inicio'), periodo_hasta: fechaEcuador(pl.fecha_fin, 'planillas_pago.fecha_fin'),
        // Como la app: el líquido a pagar y, si no está calculado, el bruto.
        monto: liquido !== null ? liquido : (numero(pl.total_monto, 'planillas_pago.total_monto') || 0),
        fecha, enviada, aprobada
      };
    });
    const orden = (a, b) => comparar(String(a.periodo_hasta || ''), String(b.periodo_hasta || '')) || (a.numero || 0) - (b.numero || 0);
    const emitidas = filas.filter(f => f.estado !== 'borrador').sort(orden);
    const u = emitidas.length ? emitidas[emitidas.length - 1] : null;
    return {
      ultima: u ? { numero: u.numero, periodo_desde: u.periodo_desde, periodo_hasta: u.periodo_hasta, monto: u.monto, estado: u.estado, fecha: u.fecha } : null,
      en_revision: filas.filter(planillaEnRevision).sort(orden).map(f => ({ numero: f.numero, monto: f.monto, desde: f.enviada, dias: diasDesde(f.enviada) })),
      aprobadas_sin_pagar: filas.filter(f => f.estado === 'aprobada').sort(orden).map(f => ({ numero: f.numero, monto: f.monto, aprobada: f.aprobada, dias: diasDesde(f.aprobada) }))
    };
  }

  function bloqueGarantias(reg){
    const filas = de('garantias', reg.p.id).map(g => {
      const hasta = fechaEcuador(g.vigencia_hasta, 'garantias.vigencia_hasta');
      const unica = [{ estado: g.estado, vigencia_hasta: hasta }];
      // Vencida: la regla del núcleo. Para «Esperan decisión», el mismo conteo del núcleo con
      // el aviso de 15 días; ese resultado NO se le pasa al semáforo.
      const vencida = N.nucleoGarantias(unica, hoy).vencidas > 0;
      const porVencer = !vencida && N.nucleoGarantias(unica, hoy, GARANTIA_DECISION_DIAS).porVencer > 0;
      return {
        publica: { tipo: textoLimpio(g.tipo), vigencia_hasta: hasta, dias_para_vencer: hasta ? N.nucleoDiasEntre(hoy, hasta) : null, estado: textoLimpio(g.estado), vencida },
        decision: vencida ? 'garantia_vencida' : porVencer ? 'garantia_por_vencer' : null
      };
    }).sort((a, b) => comparar(String(a.publica.vigencia_hasta || '9999'), String(b.publica.vigencia_hasta || '9999')) || comparar(String(a.publica.tipo), String(b.publica.tipo)));
    reg.interno.garantias = filas;
    return filas.map(f => f.publica);
  }

  function bloqueOrdenes(reg){
    const lista = de('ordenes_cambio', reg.p.id);
    const porEstado = { borrador: 0, solicitada: 0, aprobada: 0, rechazada: 0 };
    lista.forEach(o => { const e = textoLimpio(o.estado) || 'sin_estado'; porEstado[e] = (porEstado[e] || 0) + 1; });
    return {
      por_estado: porEstado,
      // No existe fecha de solicitud: los días se cuentan desde que se creó la orden.
      solicitadas: lista.filter(o => o.estado === 'solicitada').map(o => {
        const desde = fechaEcuador(o.created_at, 'ordenes_cambio.created_at');
        return { numero: numero(o.numero, 'ordenes_cambio.numero'), titulo: textoLimpio(o.titulo), monto: numero(o.monto_total, 'ordenes_cambio.monto_total') || 0, desde, dias: diasDesde(desde) };
      }).sort((a, b) => (a.numero || 0) - (b.numero || 0))
    };
  }

  function bloqueLibro(reg){
    const f = de('libro_obra', reg.p.id)[0];
    if(!f) return { ultimo_registro: null, dias_sin_registro: null, pendientes_aprobacion: 0 };
    const ultimo = fechaEcuador(f.ultimo_registro, 'libro_obra.fecha');
    return { ultimo_registro: ultimo, dias_sin_registro: diasDesde(ultimo), pendientes_aprobacion: numero(f.pendientes_aprobacion, 'libro_obra.pendientes_aprobacion') || 0 };
  }

  function bloqueObservaciones(reg){
    const lista = de('observaciones', reg.p.id);
    const vivas = lista.filter(obsSinResolver).map(o => {
      const creada = fechaEcuador(o.created_at, 'observaciones.created_at');
      return { numero: numero(o.numero, 'observaciones.numero'), titulo: textoLimpio(o.titulo), creada, dias: diasDesde(creada), creada_por: nombrePerfil(o.creado_por), antecedente: o.con_antecedente === true };
    }).sort((a, b) => (b.dias === null ? -1 : b.dias) - (a.dias === null ? -1 : a.dias) || (a.numero || 0) - (b.numero || 0));
    reg.interno.observaciones = vivas;
    return {
      abiertas: lista.filter(o => o.estado === 'abierta').length,
      en_proceso: lista.filter(o => o.estado === 'en_proceso').length,
      mas_antiguas: vivas.slice(0, OBSERVACIONES_LISTADAS).map(o => ({ numero: o.numero, titulo: o.titulo, dias: o.dias, creada_por: o.creada_por })),
      con_antecedente: vivas.filter(o => o.antecedente).length
    };
  }

  function bloqueCalidad(reg){
    const p = reg.p;
    const ensayos = de('ensayos', p.id);
    const conReensayo = new Set(ensayos.map(e => e.reensayo_de).filter(Boolean));
    // «Fallido abierto» es el criterio de la app: no cumple y no está resuelto.
    const fallidosAbiertos = ensayos.filter(e => e.cumple === false && e.resuelto !== true);
    return {
      ensayos_fallidos_abiertos: fallidosAbiertos.length,
      ensayos_fallidos_sin_reensayo: fallidosAbiertos.filter(e => !conReensayo.has(e.id)).length,
      incidentes_sst_abiertos: de('sst_incidentes', p.id).filter(i => i.estado !== 'cerrado').length,
      solicitudes_pendientes: de('solicitudes', p.id).filter(s => s.estado === 'pendiente' || s.estado === 'en_revision').length
    };
  }

  function bloqueDocumentos(reg){
    const porModulo = {};
    de('archivos', reg.p.id).forEach(a => {
      let m = textoLimpio(a.modulo) || 'sin_modulo';
      if(m === 'curvaS') m = 'curva_s';   // el mismo módulo con dos grafías
      porModulo[m] = (porModulo[m] || 0) + (numero(a.cantidad, 'archivos.cantidad') || 0);
    });
    return { por_modulo: porModulo, contrato_cargado: (porModulo.contratos || 0) > 0 };
  }

  function bloqueEquipo(reg){
    const vistos = new Set(), equipo = [];
    de('proyecto_miembros', reg.p.id).forEach(m => {
      // La app escribe usuario_id; perfil_id queda de las altas antiguas.
      const quien = m.usuario_id || m.perfil_id;
      const clave = quien + '|' + m.rol;
      if(vistos.has(clave)) return;
      vistos.add(clave);
      equipo.push({ nombre: nombrePerfil(quien) || '(perfil no encontrado)', rol: textoLimpio(m.rol) });
    });
    return equipo.sort((a, b) => comparar(String(a.rol), String(b.rol)) || a.nombre.localeCompare(b.nombre, 'es'));
  }

  // La identidad va aparte (nunca es null); estos diez van cada uno en su try.
  const BLOQUES = [
    ['avance', bloqueAvance], ['proximos_14_dias', bloqueProximos], ['planillas', bloquePlanillas],
    ['garantias', bloqueGarantias], ['ordenes_cambio', bloqueOrdenes], ['libro', bloqueLibro], ['observaciones', bloqueObservaciones],
    ['calidad_seguridad', bloqueCalidad], ['documentos', bloqueDocumentos], ['equipo', bloqueEquipo]
  ];

  // Lo que espera decisión en un proyecto, a partir de sus bloques ya calculados.
  //   sentido 'esperando'    → dias = días que lleva esperando (null si no hay fecha)
  //   sentido 'faltan'       → dias = días que faltan para que venza
  //   sentido 'vencida_hace' → dias = días que lleva vencida
  function decisionesDe(reg){
    const b = reg.b, cod = reg.codigo, lista = [];
    const item = (clase, detalle, desde, dias, sentido, monto) => lista.push({ clase, proyecto: cod, detalle: limpiarTexto(detalle), desde: desde || null,
      dias: dias === undefined ? null : dias, sentido, monto: monto === undefined ? null : monto });
    if(b.planillas) b.planillas.en_revision.forEach(pl => item('planilla_en_revision', `Planilla ${pl.numero}`, pl.desde, pl.dias, 'esperando', pl.monto));
    if(b.ordenes_cambio) b.ordenes_cambio.solicitadas.forEach(o => item('orden_cambio_solicitada', `OC-${String(o.numero).padStart(2, '0')} «${o.titulo || 'sin título'}»`, o.desde, o.dias, 'esperando', o.monto));
    if(b.garantias) reg.interno.garantias.forEach(({ publica: g, decision }) => {
      const tipo = TIPOS_GARANTIA[g.tipo] || g.tipo || 'Garantía';
      if(decision === 'garantia_vencida') item(decision, `${tipo}, venció el ${g.vigencia_hasta}`, g.vigencia_hasta, -g.dias_para_vencer, 'vencida_hace');
      else if(decision === 'garantia_por_vencer') item(decision, `${tipo}, vence el ${g.vigencia_hasta}`, null, g.dias_para_vencer, 'faltan');
    });
    if(b.observaciones) reg.interno.observaciones.forEach(o => {
      if(o.dias === null || o.dias <= OBSERVACION_ANTIGUA_DIAS) return;
      item('observacion_antigua', `Observación n.º ${o.numero === null ? '—' : o.numero} «${o.titulo || 'sin título'}», creada por ${o.creada_por || 'autor no registrado'}`, o.creada, o.dias, 'esperando');
    });
    const cierre = intentar('cierre', reg, () => {
      const c = cierrePendiente(reg.p);
      if(!c) return null;
      const desde = fechaEcuador(c.desde, 'actas_recepcion.fecha');
      return { clase: c.clase, detalle: c.detalle, desde, dias: diasDesde(desde) };
    });
    if(cierre) item(cierre.clase, cierre.detalle, cierre.desde, cierre.dias, 'esperando');
    return lista;
  }
  // Orden por urgencia: 0 garantías (la más vencida primero, luego la que vence antes),
  // 1 lo que espera (más días primero), 2 lo que no tiene fecha.
  function urgencia(d){
    if(d.sentido === 'vencida_hace') return [0, -d.dias];
    if(d.sentido === 'faltan') return [0, d.dias];
    return d.dias === null ? [2, 0] : [1, -d.dias];
  }

  // ── Recorrido de la cartera ───────────────────────────────────────────────
  const filas = datos.proyectos.filter(p => p && typeof p === 'object');
  const excluidos = { sin_codigo: 0, liquidados: 0, cerrados_sin_pendientes: 0 };
  let regs = [];
  const decisiones = [];
  filas.forEach(p => {
    if(p.estado_cierre === 'liquidado'){ excluidos.liquidados++; return; }
    // Identidad mínima, fuera de cualquier try: con esto el proyecto nunca queda anónimo.
    const codigo = textoLimpio(p.codigo);
    if(!codigo){ excluidos.sin_codigo++; return; }
    const reg = { p, codigo, nombre: textoLimpio(p.nombre), interno: {}, b: null };
    if(cerrado(p)){
      // Si no se puede saber si tiene pendientes, el proyecto entra (y queda anotado).
      let pendiente = true;
      try{ pendiente = tienePendientes(p); }
      catch(e){ anotar('inclusion', reg, e); }
      if(!pendiente){ excluidos.cerrados_sin_pendientes++; return; }
    }
    const b = { identidad: bloqueIdentidad(reg) };
    BLOQUES.forEach(([nombre, fn]) => { b[nombre] = intentar(nombre, reg, () => fn(reg)); });
    reg.b = b;
    (intentar('esperan_decision', reg, () => decisionesDe(reg)) || []).forEach(d => decisiones.push(d));
    regs.push(reg);
  });

  const colorDe = reg => (reg.b.avance ? ORDEN_COLOR[reg.b.avance.semaforo] : 3);
  regs = regs.map((reg, i) => ({ reg, i }))
    .sort((x, y) => colorDe(x.reg) - colorDe(y.reg) || comparar(x.reg.codigo, y.reg.codigo) || comparar(String(x.reg.nombre || ''), String(y.reg.nombre || '')) || x.i - y.i)
    .map(x => x.reg);
  const indiceDe = new Map(regs.map((reg, i) => [reg, i]));

  // ── Resumen: cinco partes independientes, cada una con su try ─────────────
  // Los totales por gestora, emisor y tipo cuentan SOLO los proyectos incluidos.
  function agrupar(claveDe, ordenDe){
    const mapa = new Map();
    regs.forEach(reg => {
      const { clave, base } = claveDe(reg);
      if(!mapa.has(clave)) mapa.set(clave, { ...base, proyectos: 0, monto_vigente: 0, proyectos_sin_monto: 0 });
      const x = mapa.get(clave), monto = reg.b.identidad.monto_vigente;
      x.proyectos++;
      if(monto === null) x.proyectos_sin_monto++; else x.monto_vigente += monto;
    });
    return [...mapa.values()].map(x => ({ ...x, monto_vigente: redondear(x.monto_vigente, 2) }))
      .sort((a, b) => b.proyectos - a.proyectos || comparar(ordenDe(a), ordenDe(b)));
  }
  const grupoEmpresa = e => ({ clave: e.sigla + '|' + e.nombre, base: { sigla: e.sigla, nombre: e.nombre } });
  const ordenEmpresa = x => String(x.sigla || '~' + x.nombre);
  const resumen = {
    por_gestora: intentar('resumen.por_gestora', null, () => agrupar(reg => grupoEmpresa(empresasDe(reg.p).gestora || { sigla: null, nombre: 'sin gestora' }), ordenEmpresa)),
    por_emisor: intentar('resumen.por_emisor', null, () => agrupar(reg => grupoEmpresa(empresasDe(reg.p).emisor || { sigla: null, nombre: 'sin emisor' }), ordenEmpresa)),
    por_tipo: intentar('resumen.por_tipo', null, () => agrupar(reg => { const tipo = textoLimpio(reg.p.tipo); return { clave: tipo || '', base: { tipo } }; }, x => String(x.tipo || '~'))),
    semaforo: intentar('resumen.semaforo', null, () => {
      const s = { rojo: 0, amarillo: 0, verde: 0, sin_datos: 0 };
      regs.forEach(reg => {
        const av = reg.b.avance;
        if(!av) s.sin_datos++;
        else if(Object.prototype.hasOwnProperty.call(ORDEN_COLOR, av.semaforo)) s[av.semaforo]++;
        else throw new Error('color de semáforo desconocido');
      });
      return s;
    }),
    esperan_decision: intentar('resumen.esperan_decision', null, () => decisiones.map(d => ({ d, u: urgencia(d) }))
      .sort((a, b) => a.u[0] - b.u[0] || a.u[1] - b.u[1] || comparar(a.d.proyecto, b.d.proyecto) || comparar(a.d.clase, b.d.clase) || comparar(a.d.detalle, b.d.detalle))
      .map(x => x.d))
  };

  return {
    formato: FORMATO,
    generado: instanteEcuador(ahora),
    valido_para: hoy,
    zona: N.NUCLEO_CARTERA.ZONA,
    version_app: op.versionApp || null,
    proyectos_total: filas.length,
    proyectos_incluidos: regs.length,
    proyectos_excluidos: excluidos,
    // «indice» es la posición del proyecto en la lista «proyectos» (null si el fallo es del resumen).
    bloques_fallidos: fallidos.map(f => ({ bloque: f.bloque, proyecto: f.reg ? f.reg.codigo : null, indice: f.reg ? indiceDe.get(f.reg) : null, motivo: f.motivo })),
    resumen,
    proyectos: regs.map(reg => reg.b)
  };
}

// 'ok' si las cinco partes del resumen están calculadas, 'null' si no hay ninguna, 'parcial' en lo demás.
function estadoDelResumen(estado){
  const r = estado && estado.resumen;
  const hechas = r ? PARTES_RESUMEN.filter(k => r[k] !== null && r[k] !== undefined).length : 0;
  return hechas === PARTES_RESUMEN.length ? 'ok' : hechas === 0 ? 'null' : 'parcial';
}

// ── Markdown ────────────────────────────────────────────────────────────────
// Números en formato es-EC (punto de miles, coma decimal), escritos a mano para
// no depender de los datos de idioma del Node que ejecute la exportación.
function numeroEc(n, decimales){
  if(n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const [ent, dec] = Math.abs(Number(n)).toFixed(decimales).split('.');
  return (Number(n) < 0 ? '-' : '') + ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + dec : '');
}
const dinero = n => (n === null || n === undefined ? 'no registrado' : '$ ' + numeroEc(n, 2));
const plural = (n, uno, varios) => `${numeroEc(n, 0)} ${n === 1 ? uno : varios}`;
const dias = n => plural(n, 'día', 'días');
const diaMes = iso => `${iso.slice(8, 10)}-${MESES[+iso.slice(5, 7) - 1]}`;
function periodo(desde, hasta){
  if(!desde || !hasta) return desde || hasta || 'sin periodo';
  return desde.slice(0, 7) === hasta.slice(0, 7) ? `${desde.slice(8, 10)} a ${diaMes(hasta)}` : `${diaMes(desde)} a ${diaMes(hasta)}`;
}
const enLinea = t => String(t === null || t === undefined ? '' : t).replace(/\s+/g, ' ').trim();
const celda = t => enLinea(t).replace(/\|/g, '\\|');
const ICONOS = { rojo: '🔴', amarillo: '🟡', verde: '🟢' };
// Celda «Días» de «Esperan decisión»: dice qué cuentan los días.
function plazo(d){
  if(d.dias === null || d.dias === undefined) return '—';
  if(d.sentido === 'faltan') return d.dias === 0 ? 'vence hoy' : `vence en ${numeroEc(d.dias, 0)}`;
  if(d.sentido === 'vencida_hace') return `vencida hace ${numeroEc(d.dias, 0)}`;
  return dias(d.dias);
}

function estadoAMarkdown(estado){
  const L = [];
  const fallidos = estado.bloques_fallidos || [];
  const res = estado.resumen || {};
  const fallo = (bloque, indice) => fallidos.find(x => x.bloque === bloque && x.indice === indice) || null;
  const noCalculado = (bloque, indice) => { const f = fallo(bloque, indice); return 'no se pudo calcular: ' + (f ? f.motivo : 'motivo no registrado'); };
  const nombreEmpresa = (lista, sigla) => { if(!sigla) return 'no registrada'; const e = (lista || []).find(x => x.sigla === sigla); return (e && e.nombre) || sigla; };

  L.push(`# Estado de proyectos GdO — válido para el ${estado.valido_para}`, '');
  const ex = estado.proyectos_excluidos || {};
  const motivos = [
    ex.sin_codigo ? `${numeroEc(ex.sin_codigo, 0)} sin código` : '',
    ex.liquidados ? plural(ex.liquidados, 'liquidado', 'liquidados') : '',
    ex.cerrados_sin_pendientes ? plural(ex.cerrados_sin_pendientes, 'finalizado o cancelado sin pendientes', 'finalizados o cancelados sin pendientes') : ''
  ].filter(Boolean);
  L.push(`Generado: ${estado.generado.slice(0, 10)} ${estado.generado.slice(11, 16)} (${estado.zona}) · formato ${estado.formato} · app ${estado.version_app || 'sin versión'} · ${plural(estado.proyectos_incluidos, 'proyecto', 'proyectos')} de ${numeroEc(estado.proyectos_total, 0)}${motivos.length ? ' · excluidos: ' + motivos.join(', ') : ''}`);
  L.push('Bloques sin calcular: ' + (fallidos.length ? `${fallidos.length} (${fallidos.map(f => f.bloque + (f.proyecto ? ' de ' + f.proyecto : '')).join('; ')})` : 'ninguno'));
  L.push('', '## Resumen', '');
  L.push(`Los totales por gestora, emisor y tipo cuentan solo ${estado.proyectos_incluidos === 1 ? 'el proyecto incluido' : `los ${numeroEc(estado.proyectos_incluidos, 0)} proyectos incluidos`} en este archivo, no toda la cartera.`, '');
  const empresas = (lista, conPalabra) => lista.map(x => `${x.nombre || x.sigla} ${conPalabra ? plural(x.proyectos, 'proyecto', 'proyectos') : numeroEc(x.proyectos, 0)}`).join(' · ') || 'sin proyectos';
  L.push(`- Por gestora: ${res.por_gestora ? empresas(res.por_gestora, true) : noCalculado('resumen.por_gestora', null)}`);
  L.push(`- Por emisor: ${res.por_emisor ? empresas(res.por_emisor, false) : noCalculado('resumen.por_emisor', null)}`);
  L.push(`- Por tipo: ${res.por_tipo ? res.por_tipo.map(x => `${TIPOS_PROYECTO[x.tipo] || x.tipo || 'sin tipo'} ${numeroEc(x.proyectos, 0)}`).join(' · ') || 'sin proyectos' : noCalculado('resumen.por_tipo', null)}`);
  const s = res.semaforo;
  L.push(`- Semáforo: ${s ? `${plural(s.rojo, 'rojo', 'rojos')} · ${plural(s.amarillo, 'amarillo', 'amarillos')} · ${plural(s.verde, 'verde', 'verdes')}${s.sin_datos ? ' · ' + numeroEc(s.sin_datos, 0) + ' sin datos' : ''}` : noCalculado('resumen.semaforo', null)}`);
  L.push('', '### Esperan decisión de Nicolás', '');
  if(!res.esperan_decision) L.push(noCalculado('resumen.esperan_decision', null));
  else if(!res.esperan_decision.length) L.push('Nada espera decisión.');
  else {
    L.push('| Qué | Proyecto | Detalle | Desde | Días |', '|---|---|---|---|---|');
    res.esperan_decision.forEach(d => L.push(`| ${CLASES_DECISION[d.clase] || d.clase} | ${celda(d.proyecto)} | ${celda(d.detalle + (d.monto !== null && d.monto !== undefined ? ', ' + dinero(d.monto) : ''))} | ${d.desde || '—'} | ${plazo(d)} |`));
  }
  const huecos = fallidos.filter(f => f.indice !== null && f.indice !== undefined && BLOQUES_DE_DECISION.includes(f.bloque));
  if(huecos.length) L.push('', `Tabla incompleta, no se pudo calcular: ${huecos.map(f => `${f.bloque} de ${f.proyecto}`).join('; ')}.`);
  L.push('');

  estado.proyectos.forEach((p, i) => {
    const id = p.identidad, av = p.avance;
    L.push(`## ${av ? ICONOS[av.semaforo] || '⚪' : '⚪'} ${id.codigo} — ${enLinea(id.nombre) || 'sin nombre'}`, '');

    if(fallo('identidad', i)) L.push(`**Identidad.** ${noCalculado('identidad', i)}`);
    else {
      const cierre = ESTADOS_CIERRE[id.estado_cierre] ? ` · ${ESTADOS_CIERRE[id.estado_cierre]}` : '';
      const sinEmpresas = fallo('identidad.empresa', i) && id.gestora === null && id.emisor === null;
      L.push(`**Identidad.** ${sinEmpresas ? 'Gestora y emisor: ' + noCalculado('identidad.empresa', i) : `Gestora ${nombreEmpresa(res.por_gestora, id.gestora)} · emisor ${nombreEmpresa(res.por_emisor, id.emisor)}`} · ${TIPOS_PROYECTO[id.tipo] || id.tipo || 'sin tipo'} · ${ESTADOS_PROYECTO[id.estado] || id.estado || 'sin estado'}${cierre}`);
      L.push(`Contratante: ${enLinea(id.contratante) || 'no registrado'} · Contratista: ${enLinea(id.contratista) || 'no registrado'}`);
      L.push(`Ubicación: ${enLinea(id.ubicacion) || 'no registrada'} (${id.latitud !== null && id.longitud !== null ? `${numeroEc(id.latitud, 6)}; ${numeroEc(id.longitud, 6)}` : 'sin coordenadas'})`);
      L.push(`Firma: ${id.fecha_firma || 'no registrada'} · Inicio: ${id.fecha_inicio || 'no registrado'} · Fin contractual: ${id.fecha_fin_contractual || 'no registrado'}${id.fecha_fin_real ? ' · Fin real: ' + id.fecha_fin_real : ''}`);
      L.push(`Monto contractual ${dinero(id.monto_contractual)} · vigente ${fallo('identidad.monto_vigente', i) ? 'no disponible' : dinero(id.monto_vigente)} (órdenes de cambio ${dinero(id.monto_ordenes_cambio)})`);
      L.push(`Descripción: ${enLinea(id.descripcion) || 'sin descripción'}`);
    }
    L.push('');

    if(!av) L.push(`**Avance.** ${noCalculado('avance', i)}`);
    else {
      const partes = [`Ejecutado ${numeroEc(av.ejecutado_pct, 1)} %`,
        av.programado_pct === null ? 'sin cronograma' : `programado ${numeroEc(av.programado_pct, 1)} %${av.linea_base ? ` (${av.linea_base})` : ' (sin línea base activa)'}`];
      if(av.valor_ganado_pct !== null && av.valor_ganado_pct !== undefined) partes.push(`valor ganado ${numeroEc(av.valor_ganado_pct, 1)} %`);
      // El SPI se escribe truncado, igual que en los motivos del semáforo.
      partes.push(av.spi === null ? 'SPI no disponible' : `SPI ${numeroEc(N.nucleoSpiTruncado(av.spi), 2)}`);
      if(av.spi !== null){
        if(av.dias_atraso === null) partes.push('atraso no estimable (nada ejecutado de lo programado)');
        else partes.push(av.dias_atraso > 0 ? `atraso estimado ${dias(av.dias_atraso)}` : 'sin atraso estimado');
      }
      if(av.cronograma_vencido) partes.push('cronograma vencido');
      L.push(`**Avance.** ${partes.join(' · ')}`);
      L.push(`Semáforo ${av.semaforo}${av.motivos.length ? ': ' + av.motivos.join('; ') : ''}`);
    }
    L.push('');

    const px = p.proximos_14_dias;
    L.push(`**Próximos 14 días.** ${!px ? noCalculado('proximos_14_dias', i) : px.length ? px.map(x => `${[x.rubro_codigo, enLinea(x.rubro)].filter(Boolean).join(' ')} (${diaMes(x.inicio)} a ${diaMes(x.fin)})`).join(' · ') : 'sin actividades programadas'}`, '');

    const pl = p.planillas;
    if(!pl) L.push(`**Planillas.** ${noCalculado('planillas', i)}`);
    else if(!pl.ultima && !pl.en_revision.length && !pl.aprobadas_sin_pagar.length) L.push('**Planillas.** ninguna emitida');
    else {
      const u = pl.ultima;
      const enRev = u && (u.estado === 'enviada' || u.estado === 'en_revision');
      if(u){
        const fila = enRev ? pl.en_revision.find(x => x.numero === u.numero && x.desde === u.fecha) : null;
        const cuando = enRev ? `en revisión desde el ${u.fecha || 'fecha no registrada'}${fila && fila.dias !== null ? ` (${dias(fila.dias)})` : ''}`
          : `${ESTADOS_PLANILLA[u.estado] || u.estado}${u.fecha ? ' el ' + u.fecha : ''}`;
        L.push(`**Planillas.** Última: n.º ${u.numero}, ${periodo(u.periodo_desde, u.periodo_hasta)}, ${dinero(u.monto)}, ${cuando}`);
      } else L.push('**Planillas.** Última: ninguna');
      if(pl.en_revision.length > (enRev ? 1 : 0)) L.push(`En revisión: ${pl.en_revision.map(x => `n.º ${x.numero}, ${dinero(x.monto)}, desde el ${x.desde || 'fecha no registrada'}${x.dias === null ? '' : ` (${dias(x.dias)})`}`).join(' · ')}`);
      if(pl.aprobadas_sin_pagar.length) L.push(`Aprobadas sin pagar: ${pl.aprobadas_sin_pagar.map(x => `n.º ${x.numero}, ${dinero(x.monto)}, aprobada el ${x.aprobada || 'fecha no registrada'}${x.dias === null ? '' : ` (${dias(x.dias)})`}`).join(' · ')}`);
    }
    L.push('');

    const ga = p.garantias;
    L.push(`**Garantías.** ${!ga ? noCalculado('garantias', i) : ga.length ? ga.map(g => {
      const tipo = TIPOS_GARANTIA[g.tipo] || g.tipo || 'Garantía';
      if(!g.vigencia_hasta) return `${tipo}, vigencia por definir${g.estado !== 'vigente' ? ` (${g.estado})` : ''}`;
      let nota = '';
      if(g.estado !== 'vigente') nota = ` (${g.estado})`;
      else if(g.vencida) nota = ` (vencida hace ${dias(-g.dias_para_vencer)})`;
      else if(g.dias_para_vencer <= GARANTIA_DECISION_DIAS) nota = g.dias_para_vencer === 0 ? ' (vence hoy)' : ` (${dias(g.dias_para_vencer)})`;
      return `${tipo} hasta ${g.vigencia_hasta}${nota}`;
    }).join(' · ') : 'ninguna registrada'}`, '');

    const oc = p.ordenes_cambio;
    if(!oc) L.push(`**Órdenes de cambio.** ${noCalculado('ordenes_cambio', i)}`);
    else {
      const NOMBRES = { aprobada: ['aprobada', 'aprobadas'], solicitada: ['solicitada', 'solicitadas'], borrador: ['en borrador', 'en borrador'], rechazada: ['rechazada', 'rechazadas'] };
      const partes = Object.keys(oc.por_estado).filter(e => oc.por_estado[e] > 0 && e !== 'solicitada').sort((a, b) => (a === 'aprobada' ? -1 : b === 'aprobada' ? 1 : comparar(a, b)))
        .map(e => plural(oc.por_estado[e], (NOMBRES[e] || [e])[0], (NOMBRES[e] || [e, e])[1]));
      if(oc.por_estado.solicitada > 0) partes.push(`${plural(oc.por_estado.solicitada, 'solicitada', 'solicitadas')}: ${oc.solicitadas.map(o => `OC-${String(o.numero).padStart(2, '0')} «${enLinea(o.titulo) || 'sin título'}», ${o.dias === null ? 'fecha no registrada' : dias(o.dias)}`).join('; ')}`);
      L.push(`**Órdenes de cambio.** ${partes.join(' · ') || 'ninguna'}`);
    }
    L.push('');

    const li = p.libro;
    L.push(`**Libro de obra.** ${!li ? noCalculado('libro', i) : li.ultimo_registro ? `Último registro ${li.ultimo_registro} (${li.dias_sin_registro === 0 ? 'hoy' : li.dias_sin_registro > 0 ? 'hace ' + dias(li.dias_sin_registro) : 'con fecha futura'}) · ${numeroEc(li.pendientes_aprobacion, 0)} por aprobar` : 'sin registros'}`, '');

    const ob = p.observaciones;
    if(!ob) L.push(`**Observaciones.** ${noCalculado('observaciones', i)}`);
    else {
      L.push(`**Observaciones.** ${plural(ob.abiertas, 'abierta', 'abiertas')} · ${numeroEc(ob.en_proceso, 0)} en proceso · ${numeroEc(ob.con_antecedente, 0)} con antecedente`);
      if(ob.mas_antiguas.length) L.push(`Más antiguas: ${ob.mas_antiguas.map(o => `n.º ${o.numero === null ? '—' : o.numero} «${enLinea(o.titulo) || 'sin título'}» (${o.dias === null ? 'fecha no registrada' : dias(o.dias)}, creada por ${o.creada_por || 'autor no registrado'})`).join(' · ')}`);
    }
    L.push('');

    const ca = p.calidad_seguridad;
    L.push(`**Calidad y seguridad.** ${!ca ? noCalculado('calidad_seguridad', i) : `${plural(ca.ensayos_fallidos_sin_reensayo, 'ensayo fallido sin re-ensayo', 'ensayos fallidos sin re-ensayo')} (${plural(ca.ensayos_fallidos_abiertos, 'fallido abierto', 'fallidos abiertos')}) · ${plural(ca.incidentes_sst_abiertos, 'incidente abierto', 'incidentes abiertos')} · ${plural(ca.solicitudes_pendientes, 'solicitud pendiente', 'solicitudes pendientes')}`}`, '');

    const doc = p.documentos;
    L.push(`**Documentos.** ${!doc ? noCalculado('documentos', i) : [doc.contrato_cargado ? 'Contrato cargado' : 'Contrato no cargado'].concat(Object.keys(doc.por_modulo).map(m => `${MODULOS[m] || m} ${numeroEc(doc.por_modulo[m], 0)}`)).join(' · ')}`, '');

    const eq = p.equipo;
    L.push(`**Equipo.** ${!eq ? noCalculado('equipo', i) : eq.length ? eq.map(m => `${enLinea(m.nombre)} (${m.rol || 'sin rol'})`).join(' · ') : 'sin miembros'}`, '');
  });
  return L.join('\n').replace(/\n+$/, '') + '\n';
}

module.exports = { construirEstado, estadoAMarkdown, estadoDelResumen, limpiarTexto };
