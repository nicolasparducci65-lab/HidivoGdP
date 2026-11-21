// Panel Cartera: ejecuta la función REAL cargarCartera de index.html en jsdom, con cartera-nucleo.js
// cargado como en la app, sobre una cartera SINTÉTICA (cuatro proyectos en ejecución y uno por cada
// uno de los otros estados: planificación, pausado, finalizado y cancelado), y comprueba que lo
// pintado (semáforo solo en ejecución, avance por valor ganado de todos los rubros / plan, SPI de los
// rubros con cronograma, atraso a la fecha solo en los proyectos con semáforo y acotado por la fecha de
// inicio del proyecto, plazo contractual vencido con proyectos.fecha_fin_planificada, amarillo en
// ejecución sin cronograma, marca de «datos por completar») es exactamente lo que da el núcleo llamado
// directamente con los mismos datos. También comprueba que las lecturas van paginadas (tope de
// filas de PostgREST), que un error de lectura se muestra en vez de pintar indicadores y, leyendo
// el fuente, que cargarCartera ya no trae fórmulas propias.
//
//   node cartera-panel.test.js
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, leer, scriptPrincipal, extraerFuncion, extraerConst, crearSb, prueba, resumen, assert } = require('./lib/arnes');
const { NUCLEO_CARTERA, nucleoEvmProyecto, nucleoGarantias, nucleoSemaforo, nucleoDatosPorCompletar, nucleoLineaBaseActiva, nucleoSpiTruncado } = require(path.join(RAIZ, 'cartera-nucleo.js'));

const html = leer(path.join(RAIZ, 'index.html'));
const src = scriptPrincipal(html);
const CODIGO = [
  leer(path.join(RAIZ, 'constantes.js')), leer(path.join(RAIZ, 'expediente.js')), leer(path.join(RAIZ, 'cartera-nucleo.js')),
  extraerConst(src, 'filtrosCartera'),
  src.match(/^function estadoLabel\(e\)\{.*$/m)[0],          // función de una sola línea: los nombres de los estados
  'let currentUser = { id: "zzz-u1" }; let currentPerfil = { rol: "admin" };',
  ...['cargarCartera', 'traerPaginado', 'proyectosVisiblesCartera', 'renderTarjetaResumenCartera', 'hoyEcuador', 'filtrarPorEmpresaTipo', 'opcionesEmpresaTipo',
    'barraFiltroEmpresaTipo', 'multiempresaActiva', 'colorEmpresa', 'distintivoEmpresa', 'codigoTipoTexto'].map(f => extraerFuncion(src, f))
].join('\n');

// «Ahora» fijo: 21-nov-2026 10:00 en Ecuador.
const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);
const HOY = '2026-11-21';

// Cartera sintética (prefijo ZZZ). Cada proyecto tiene su línea base activa. Los estados de rubro
// son los de la base (CHECK rubros_estado_check): planificado, trabajando, terminado, suspendido.
const FIXTURE = () => ({
  proyectos: [
    // fecha_inicio (proyectos.fecha_inicio): la del rojo es ANTERIOR a su primer inicio programado (1-nov) y no
    // cambia nada; el amarillo no la tiene (null); los demás ni traen el campo.
    // fecha_fin_planificada (fin del plazo contractual): la del rojo es FUTURA (31-mar-2027) y no pinta; el amarillo
    // la tiene en null; el pausado la tiene VENCIDA (31-oct) y, al no llevar semáforo, tampoco pinta; los demás ni traen el campo.
    { id: 'zzz-pr', nombre: 'ZZZ Rojo por SPI', contratante: 'ZZZ Cliente', estado: 'ejecucion', estado_cierre: 'en_ejecucion', fecha_inicio: '2026-10-15', fecha_fin_planificada: '2027-03-31' },
    { id: 'zzz-pa', nombre: 'ZZZ Amarillo por garantia', contratante: 'ZZZ Cliente', estado: 'ejecucion', estado_cierre: 'en_ejecucion', fecha_inicio: null, fecha_fin_planificada: null },
    { id: 'zzz-pv', nombre: 'ZZZ Verde', contratante: 'ZZZ Cliente', estado: 'ejecucion', estado_cierre: 'recepcion_provisional' },
    { id: 'zzz-po', nombre: 'ZZZ Filas ajenas', contratante: 'ZZZ Cliente', estado: 'ejecucion', estado_cierre: null },
    // Uno por cada estado que NO lleva semáforo
    { id: 'zzz-pp', nombre: 'ZZZ En planificacion', contratante: 'ZZZ Cliente', estado: 'planificacion', estado_cierre: null },
    { id: 'zzz-pz', nombre: 'ZZZ Pausado', contratante: 'ZZZ Cliente', estado: 'pausado', estado_cierre: 'en_ejecucion', fecha_inicio: '2026-07-01', fecha_fin_planificada: '2026-10-31' },
    { id: 'zzz-pf', nombre: 'ZZZ Finalizado', contratante: 'ZZZ Cliente', estado: 'finalizado', estado_cierre: 'recepcion_definitiva' },
    { id: 'zzz-pc', nombre: 'ZZZ Cancelado', contratante: 'ZZZ Cliente', estado: 'cancelado', estado_cierre: null },
    { id: 'zzz-pl', nombre: 'ZZZ Liquidado', contratante: 'ZZZ Cliente', estado: 'finalizado', estado_cierre: 'liquidado' }
  ],

  lineas_base: [
    { id: 'zzz-lb-r', proyecto_id: 'zzz-pr', numero: 1, activa: true },
    { id: 'zzz-lb-a', proyecto_id: 'zzz-pa', numero: 1, activa: true },
    { id: 'zzz-lb-v0', proyecto_id: 'zzz-pv', numero: 1, activa: false },
    { id: 'zzz-lb-v', proyecto_id: 'zzz-pv', numero: 2, activa: true },
    { id: 'zzz-lb-o', proyecto_id: 'zzz-po', numero: 1, activa: true },
    { id: 'zzz-lb-p', proyecto_id: 'zzz-pp', numero: 1, activa: true },
    { id: 'zzz-lb-z', proyecto_id: 'zzz-pz', numero: 1, activa: true }
  ],
  rubros: [
    // Rojo: en la actividad programada va a la mitad de lo debido (SPI 0,50); el segundo rubro no tiene
    // cronograma: cuenta en el avance principal (12,5 + 5,0 = 17,5 %) sin tocar el SPI (valor ganado en cronograma 12,5 %).
    { id: 'zzz-rr1', proyecto_id: 'zzz-pr', monto_contrato: 1000, total_produccion: 250, estado: 'trabajando' },
    // suspendido: no está terminado, así que cuenta por su producción (10 %), no como 100 % ni como 0
    { id: 'zzz-rr2', proyecto_id: 'zzz-pr', monto_contrato: 1000, total_produccion: 100, estado: 'suspendido' },
    // Amarillo: adelantado (SPI 1,20); lo pone amarillo la garantía que vence en 3 días
    { id: 'zzz-ra1', proyecto_id: 'zzz-pa', monto_contrato: 1000, total_produccion: 600, estado: 'trabajando' },
    // Verde: rubro terminado (cuenta 100 % aunque la producción sea 90 %) y otro al día
    { id: 'zzz-rv1', proyecto_id: 'zzz-pv', monto_contrato: 500, total_produccion: 450, estado: 'terminado' },
    { id: 'zzz-rv2', proyecto_id: 'zzz-pv', monto_contrato: 500, total_produccion: 500, estado: 'trabajando' },
    // Filas ajenas: va casi al día en su línea base (SPI 0,96: un día de atraso a la fecha)
    { id: 'zzz-ro1', proyecto_id: 'zzz-po', monto_contrato: 1000, total_produccion: 480, estado: 'trabajando' },
    { id: 'zzz-ro2', proyecto_id: 'zzz-po', monto_contrato: 1000, total_produccion: 0, estado: 'planificado' },
    { id: 'zzz-rl1', proyecto_id: 'zzz-pl', monto_contrato: 100, total_produccion: 100, estado: 'terminado' },
    // Planificación: nada ejecutado y el cronograma empieza en 2027
    { id: 'zzz-rp1', proyecto_id: 'zzz-pp', monto_contrato: 1000, total_produccion: 0, estado: 'planificado' },
    // Pausado: 20 % hecho con el cronograma vencido el 1-oct (SPI 0,20) y el plazo contractual vencido el 31-oct: en ejecución sería rojo
    { id: 'zzz-rz1', proyecto_id: 'zzz-pz', monto_contrato: 1000, total_produccion: 200, estado: 'suspendido' },
    // Finalizado: rubro marcado terminado sin producción registrada → «datos por completar»
    { id: 'zzz-rf1', proyecto_id: 'zzz-pf', monto_contrato: 1000, total_produccion: 0, estado: 'terminado' },
    // Cancelado: 20 % hecho, sin cronograma
    { id: 'zzz-rc1', proyecto_id: 'zzz-pc', monto_contrato: 500, total_produccion: 100, estado: 'suspendido' }
  ],
  cronograma_rubros: [
    // 1-nov a 11-dic (40 días); hoy es el día 20 → 50 %
    { id: 'zzz-c1', proyecto_id: 'zzz-pr', rubro_id: 'zzz-rr1', fecha_inicio: '2026-11-01', fecha_fin: '2026-12-11', linea_base_id: 'zzz-lb-r' },
    // 11-nov a 1-dic (20 días); hoy es el día 10 → 50 %
    { id: 'zzz-c2', proyecto_id: 'zzz-pa', rubro_id: 'zzz-ra1', fecha_inicio: '2026-11-11', fecha_fin: '2026-12-01', linea_base_id: 'zzz-lb-a' },
    // Verde: todo vencido en la línea base activa; la línea base anterior (inactiva) decía otra cosa
    { id: 'zzz-c3', proyecto_id: 'zzz-pv', rubro_id: 'zzz-rv1', fecha_inicio: '2026-08-01', fecha_fin: '2026-09-01', linea_base_id: 'zzz-lb-v' },
    { id: 'zzz-c4', proyecto_id: 'zzz-pv', rubro_id: 'zzz-rv2', fecha_inicio: '2026-09-01', fecha_fin: '2026-10-01', linea_base_id: 'zzz-lb-v' },
    { id: 'zzz-c5', proyecto_id: 'zzz-pv', rubro_id: 'zzz-rv2', fecha_inicio: '2027-01-01', fecha_fin: '2027-02-01', linea_base_id: 'zzz-lb-v0' },
    // Filas ajenas: una fila propia (50 % a hoy) y una fila del MISMO proyecto colgada de la línea base
    // activa de OTRO proyecto (zzz-lb-r), ya vencida. Con la regla vieja contaba y hundía el SPI.
    { id: 'zzz-c6', proyecto_id: 'zzz-po', rubro_id: 'zzz-ro1', fecha_inicio: '2026-11-11', fecha_fin: '2026-12-01', linea_base_id: 'zzz-lb-o' },
    { id: 'zzz-c7', proyecto_id: 'zzz-po', rubro_id: 'zzz-ro2', fecha_inicio: '2026-09-01', fecha_fin: '2026-10-01', linea_base_id: 'zzz-lb-r' },
    { id: 'zzz-cp', proyecto_id: 'zzz-pp', rubro_id: 'zzz-rp1', fecha_inicio: '2027-02-01', fecha_fin: '2027-06-01', linea_base_id: 'zzz-lb-p' },
    // 1-ago a 1-oct (61 días): el último día en que el plan no superaba el 20 % es el día 12 (13-ago) → 100 días de
    // atraso a la fecha según el núcleo; al estar pausado (sin semáforo) el panel NO lo pinta
    { id: 'zzz-cy', proyecto_id: 'zzz-pz', rubro_id: 'zzz-rz1', fecha_inicio: '2026-08-01', fecha_fin: '2026-10-01', linea_base_id: 'zzz-lb-z' }
  ],
  garantias: [
    { id: 'zzz-g1', proyecto_id: 'zzz-pa', vigencia_hasta: '2026-11-24', estado: 'vigente' },
    { id: 'zzz-g2', proyecto_id: 'zzz-pa', vigencia_hasta: null, estado: 'vigente' },          // «por definir»: no cuenta
    { id: 'zzz-g3', proyecto_id: 'zzz-pa', vigencia_hasta: '2026-01-01', estado: 'devuelta' }, // no vigente: no cuenta
    { id: 'zzz-g4', proyecto_id: 'zzz-pv', vigencia_hasta: '2026-11-27', estado: 'vigente' },  // vence en 6 días: no cuenta
    { id: 'zzz-g5', proyecto_id: 'zzz-pz', vigencia_hasta: '2026-10-15', estado: 'vigente' },  // VENCIDA, en un proyecto pausado: va como pendiente
    { id: 'zzz-g6', proyecto_id: 'zzz-pf', vigencia_hasta: '2026-11-01', estado: 'vigente' },  // VENCIDA, en un finalizado: va como pendiente
    { id: 'zzz-g7', proyecto_id: 'zzz-pf', vigencia_hasta: '2026-11-23', estado: 'vigente' }   // por vencer, en un finalizado
  ],
  // Verde con exactamente 5 pendientes (2 de libro + 2 observaciones + 1 solicitud): sigue verde
  libro_obra: [
    { id: 'zzz-l1', proyecto_id: 'zzz-pv', estado_aprobacion: 'pendiente' },
    { id: 'zzz-l2', proyecto_id: 'zzz-pv', estado_aprobacion: 'pendiente' },
    { id: 'zzz-l3', proyecto_id: 'zzz-pv', estado_aprobacion: 'aprobado' }
  ],
  observaciones: [
    { id: 'zzz-o1', proyecto_id: 'zzz-pv', estado: 'abierta' },
    { id: 'zzz-o2', proyecto_id: 'zzz-pv', estado: 'abierta' },
    { id: 'zzz-o3', proyecto_id: 'zzz-pv', estado: 'cerrada' },
    { id: 'zzz-o4', proyecto_id: 'zzz-pz', estado: 'abierta' },
    // Cancelado con 7 observaciones abiertas: en ejecución sería amarillo por pendientes
    ...[5, 6, 7, 8, 9, 10, 11].map(n => ({ id: 'zzz-oc' + String(n).padStart(2, '0'), proyecto_id: 'zzz-pc', estado: 'abierta' }))
  ],
  solicitudes: [
    { id: 'zzz-s1', proyecto_id: 'zzz-pv', estado: 'en_revision' },
    { id: 'zzz-s2', proyecto_id: 'zzz-pv', estado: 'aprobada' },
    { id: 'zzz-s4', proyecto_id: 'zzz-pp', estado: 'pendiente' }
  ],
  planillas_pago: [], contrato_anticipo: [], notificaciones: []
});

const EN_EJECUCION = ['zzz-pr', 'zzz-pa', 'zzz-pv', 'zzz-po'];
const SIN_SEMAFORO = { 'zzz-pp': 'Planificación', 'zzz-pz': 'Pausado', 'zzz-pf': 'Finalizado', 'zzz-pc': 'Cancelado' };
const TODOS = [...EN_EJECUCION, ...Object.keys(SIN_SEMAFORO)];
const pctEs = v => v.toFixed(1).replace('.', ',');
const enDias = n => `${n} día${n === 1 ? '' : 's'}`;

// Lo que da el núcleo llamado directamente con los datos del fixture (agrupados aquí, sin pasar por cargarCartera).
// El cronograma de un proyecto son las filas de SUS RUBROS (tengan el proyecto_id que tengan) y su
// línea base activa la elige el núcleo, como hace la exportación diaria.
function esperado(fx, pid, opciones = {}){
  const proyecto = fx.proyectos.find(p => p.id === pid);
  const lb = nucleoLineaBaseActiva(fx.lineas_base.filter(l => l.proyecto_id === pid));
  const rubros = fx.rubros.filter(r => r.proyecto_id === pid);
  const idsRubro = new Set(rubros.map(r => r.id));
  const evm = nucleoEvmProyecto({
    rubros,
    cronograma: fx.cronograma_rubros.filter(c => idsRubro.has(c.rubro_id)),
    lineaBaseActivaId: lb ? lb.id : null, hoy: opciones.hoy || HOY, fechaInicioProyecto: proyecto.fecha_inicio ?? null,
    fechaFinContractual: proyecto.fecha_fin_planificada ?? null
  });
  const hoy = opciones.hoy || HOY;
  const gar = nucleoGarantias(fx.garantias.filter(g => g.proyecto_id === pid), hoy);
  const pendientes = fx.libro_obra.filter(l => l.proyecto_id === pid && l.estado_aprobacion === 'pendiente').length
    + fx.observaciones.filter(o => o.proyecto_id === pid && o.estado === 'abierta').length
    + fx.solicitudes.filter(s => s.proyecto_id === pid && ['pendiente', 'en_revision'].includes(s.estado)).length;
  const sem = nucleoSemaforo({ estado: proyecto.estado ?? null, evm, garantias: gar, pendientes });
  const porCompletar = nucleoDatosPorCompletar({ evm, estado: proyecto.estado });
  // Solo los proyectos con semáforo pintan atrasos
  const conColor = sem.color !== null;
  const sinCronTxt = !evm.sinCronograma && evm.rubrosSinCronograma > 0 ? `${evm.rubrosSinCronograma} de ${evm.rubros} rubro(s) sin cronograma` : '';
  const inicio = proyecto.fecha_inicio ? proyecto.fecha_inicio.slice(0, 10) : '';
  const atrasoDetalle = inicio && evm.fechaGanada && evm.fechaGanada < inicio
    ? `acotado a los días transcurridos desde el inicio del proyecto, ${inicio}` : `el plan preveía este valor ganado el ${evm.fechaGanada}`;
  return {
    evm, gar, pendientes, sem, porCompletar,
    emoji: sem.color === null ? '⚪' : { rojo: '🔴', amarillo: '🟡', verde: '🟢' }[sem.color],
    // Columna de avance: el principal es el valor ganado de TODOS los rubros (avancePct), frente al plan a hoy
    avance: `${evm.avancePct.toFixed(1)}% / ${evm.planPct.toFixed(1)}%`,
    avanceTitulo: `Avance por valor ganado ${pctEs(evm.avancePct)} % frente a plan a hoy ${pctEs(evm.planPct)} % · ejecutado por cantidades ${pctEs(evm.realPct)} %`
      + (evm.sinCronograma ? ' · sin cronograma: no hay plan ni SPI' : sinCronTxt ? ` · ${sinCronTxt}: cuentan en el avance, no en el plan ni en el SPI (valor ganado en cronograma ${pctEs(evm.evPct)} %)` : ''),
    spi: evm.spi === null ? '—' : nucleoSpiTruncado(evm.spi).toFixed(2),
    // El SPI se explica con evPct / planPct (solo rubros con cronograma)
    spiTitulo: [
      evm.sinCronograma ? 'Sin cronograma: no hay SPI' : `Valor ganado ${pctEs(evm.evPct)} % sobre plan ${pctEs(evm.planPct)} % · solo rubros con cronograma`,
      sinCronTxt ? `${sinCronTxt}: no entran al SPI (el avance total es ${pctEs(evm.avancePct)} %)` : '',
      conColor && evm.atrasoFechaDias > 0 ? `atraso a la fecha: ${enDias(evm.atrasoFechaDias)} (${atrasoDetalle})` : '',
      !conColor ? '' : evm.atrasoProyectadoDias > 0 ? `atraso proyectado al final: ${enDias(evm.atrasoProyectadoDias)}`
        : (evm.atrasoProyectadoDias === null && evm.spiValido) ? 'atraso proyectado al final: no estimable (SPI menor que 0,10)' : ''
    ].filter(Boolean).join(' · '),
    // El atraso que se pinta es el atraso A LA FECHA, y solo en los proyectos con semáforo
    atraso: conColor && evm.atrasoFechaDias > 0 ? `${evm.atrasoFechaDias}d atraso a la fecha` : '',
    marca: porCompletar.length ? '⚠ datos por completar' : '',
    marcaTitulo: porCompletar.length ? 'Datos por completar: ' + porCompletar.join(' · ') : null
  };
}

// Consulta que falla como supabase-js: no lanza, resuelve { data: null, error }. Admite cualquier
// encadenado (.select().eq().in().order().range()).
function consultaQueFalla(mensaje){
  const q = new Proxy({}, { get: (_, k) => k === 'then'
    ? (res, rej) => Promise.resolve({ data: null, error: { message: mensaje } }).then(res, rej)
    : () => q });
  return q;
}

// opciones.maxFilas: tope de filas por lectura (max-rows de PostgREST) · opciones.fallan: { tabla: mensaje }
// de las tablas cuya lectura devuelve error · opciones.ahora: instante fijo · opciones.antes: función que
// recibe la ventana ya cargada, antes de llamar a cargarCartera (para espiar las llamadas al núcleo).
async function montar(fx = FIXTURE(), opciones = {}){
  const dom = new JSDOM('<!doctype html><html><body><div id="carteraContent"></div></body></html>', { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only' });
  const w = dom.window;
  w.Date.now = () => opciones.ahora || AHORA;      // nucleoHoyEcuador() usa Date.now()
  const sb = crearSb(fx, opciones.maxFilas ? { maxFilas: opciones.maxFilas } : {});
  if(opciones.fallan){
    const from = sb.from;
    sb.from = tabla => tabla in opciones.fallan ? consultaQueFalla(opciones.fallan[tabla]) : from(tabla);
  }
  w.sb = sb;
  // Con un fallo provocado, cargarCartera escribe el error en la consola: aquí se guarda en vez de mostrarse
  const erroresConsola = [];
  w.console = opciones.fallan ? { ...console, error: (...a) => erroresConsola.push(a) } : console;
  w.eval(CODIGO);
  if(opciones.antes) opciones.antes(w);
  await w.cargarCartera();
  const cont = w.document.getElementById('carteraContent');
  // Filas de la tabla principal: nombre del proyecto → celdas
  const filas = {};
  let orden = [];
  cont.querySelectorAll('tr[onclick^="irANotificacion"]').forEach(tr => {
    const td = tr.querySelectorAll('td');
    const pid = /irANotificacion\('([^']+)'/.exec(tr.getAttribute('onclick'))[1];
    const celdaSpi = td[3].cloneNode(true);
    const divAtraso = celdaSpi.querySelector('div');
    const atraso = divAtraso ? divAtraso.textContent.trim() : '';
    if(divAtraso) divAtraso.remove();
    // Primera celda: el emoji y, en los proyectos sin semáforo, su estado en texto
    const celdaSem = td[0].cloneNode(true);
    const divEstado = celdaSem.querySelector('.cartera-sin-semaforo');
    const estadoTxt = divEstado ? divEstado.textContent.trim() : '';
    if(divEstado) divEstado.remove();
    const marca = td[2].querySelector('.cartera-por-completar');
    filas[pid] = {
      emoji: celdaSem.textContent.trim(), estadoTxt, motivos: td[0].getAttribute('title'),
      nombre: td[1].textContent,
      avance: td[2].querySelector('div').textContent.trim(), avanceTitulo: td[2].getAttribute('title'),
      barra: td[2].querySelectorAll('div')[2].getAttribute('style'),
      marca: marca ? marca.textContent.trim() : '', marcaTitulo: marca ? marca.getAttribute('title') : null,
      atrasoEstilo: divAtraso ? divAtraso.getAttribute('style') : '',
      spi: celdaSpi.textContent.trim(), spiEstilo: td[3].getAttribute('style'), spiTitulo: td[3].getAttribute('title'), atraso,
      vigente: td[4].childNodes[0].textContent.trim(),
      alertas: td[7].textContent.trim()
    };
    orden.push(pid);
  });
  return { w, cont, filas, orden, fx, sb, erroresConsola, cerrar: () => w.close() };
}

function igual(real, esp, que){ assert(real === esp, `${que}: se esperaba ${JSON.stringify(esp)} y salió ${JSON.stringify(real)}`); }

(async () => {
  console.log('cartera-panel.test.js');

  await prueba('la pantalla se pinta con los ocho proyectos activos (el liquidado va aparte)', async () => {
    const t = await montar();
    assert(!/Calculando indicadores/.test(t.cont.innerHTML), 'no se queda en «Calculando indicadores…»');
    igual(Object.keys(t.filas).sort().join(','), TODOS.slice().sort().join(','), 'filas de la tabla');
    assert(/Proyectos liquidados \(1\)/.test(t.cont.textContent), 'el liquidado se lista en su desplegable');
    assert(!t.cont.innerHTML.includes('undefined') && !t.cont.innerHTML.includes('NaN') && !t.cont.innerHTML.includes('null'), 'sin «undefined», «NaN» ni «null» en lo pintado');
    t.cerrar();
  });

  await prueba('cada fila pinta exactamente lo que da cartera-nucleo.js con los mismos datos (los ocho proyectos)', async () => {
    const t = await montar();
    for(const pid of TODOS){
      const e = esperado(t.fx, pid), f = t.filas[pid];
      igual(f.emoji, e.emoji, pid + ': semáforo');
      igual(f.avance, e.avance, pid + ': % de valor ganado / plan');
      igual(f.avanceTitulo, e.avanceTitulo, pid + ': título de la celda de avance (con el ejecutado por cantidades)');
      igual(f.spi, e.spi, pid + ': SPI');
      igual(f.atraso, e.atraso, pid + ': atraso a la fecha');
      igual(f.spiTitulo, e.spiTitulo, pid + ': título de la celda del SPI');
      igual(f.marca, e.marca, pid + ': marca de datos por completar'); igual(f.marcaTitulo, e.marcaTitulo, pid + ': detalle de la marca');
      if(EN_EJECUCION.includes(pid)) igual(f.motivos, e.sem.motivos.join(' · ') || 'Sin alertas', pid + ': motivos en el título del semáforo');
      else igual(e.sem.color, null, pid + ': el núcleo no le da color');
    }
    t.cerrar();
  });

  await prueba('rojo por SPI: 🔴, SPI 0.50; avance principal 17.5 % (valor ganado de todos los rubros) / 25.0 %, 10 d de atraso a la fecha', async () => {
    const t = await montar(), f = t.filas['zzz-pr'], e = esperado(t.fx, 'zzz-pr');
    igual(e.sem.color, 'rojo', 'núcleo: color'); igual(e.gar.vencidas, 0, 'núcleo: sin garantías vencidas (el rojo es por SPI)');
    assert(e.evm.atrasoFechaDias <= NUCLEO_CARTERA.ATRASO_ROJO_DIAS, 'núcleo: el atraso no llega a 31 (el rojo es por SPI)');
    igual(f.emoji, '🔴', 'emoji'); igual(f.estadoTxt, '', 'con semáforo no se escribe el estado bajo el emoji');
    igual(f.avance, '17.5% / 25.0%', 'avance principal = valor ganado de los dos rubros (12,5 del programado + 5,0 del que no tiene cronograma)');
    igual(e.evm.evPct, 12.5, 'núcleo: valor ganado en cronograma 12,5 (el del SPI)'); igual(e.evm.avancePct, 17.5, 'núcleo: avance principal 17,5');
    igual(f.avanceTitulo, 'Avance por valor ganado 17,5 % frente a plan a hoy 25,0 % · ejecutado por cantidades 17,5 % · 1 de 2 rubro(s) sin cronograma: cuentan en el avance, no en el plan ni en el SPI (valor ganado en cronograma 12,5 %)', 'el title de la barra deja claro el rubro sin cronograma');
    assert(/width:\s*17\.5%/.test(f.barra), 'la barra mide el avance principal (17,5 %): ' + f.barra);
    igual(f.spi, '0.50', 'SPI = 12,5 / 25,0 (no 17,5 / 25,0 = 0,70)'); igual(f.atraso, '10d atraso a la fecha', 'atraso a la fecha'); assert(/color:\s*#e2445c/.test(f.atrasoEstilo), 'atraso en rojo');
    igual(f.motivos, 'SPI 0,50', 'motivo'); assert(/color:\s*#e2445c/.test(f.spiEstilo), 'SPI en rojo');
    assert(/En ejecución/.test(f.nombre), 'estado del proyecto bajo el nombre');
    t.cerrar();
  });

  await prueba('amarillo por garantía: 🟡 con SPI 1.20 en verde; cuenta la que vence en 3 días, no la sin fecha ni la devuelta', async () => {
    const t = await montar(), f = t.filas['zzz-pa'], e = esperado(t.fx, 'zzz-pa');
    igual(e.gar.porVencer, 1, 'núcleo: una por vencer'); igual(e.gar.vencidas, 0, 'núcleo: ninguna vencida');
    igual(f.emoji, '🟡', 'emoji'); igual(f.avance, '60.0% / 50.0%', 'avance'); igual(f.spi, '1.20', 'SPI'); igual(f.atraso, '', 'sin atraso');
    igual(f.motivos, '1 garantía por vencer en 5 días o menos', 'motivo'); assert(/color:\s*#00854d/.test(f.spiEstilo), 'SPI en verde');
    assert(f.alertas.includes('🛡️1') && !f.alertas.includes('!'), 'alerta de garantía por vencer, sin vencidas');
    t.cerrar();
  });

  await prueba('verde: 🟢 con rubro terminado = 100 % (SPI 1.00 con 95 % real), 5 pendientes y garantía a 6 días', async () => {
    const t = await montar(), f = t.filas['zzz-pv'], e = esperado(t.fx, 'zzz-pv');
    igual(e.pendientes, 5, 'núcleo: 5 pendientes'); igual(e.gar.porVencer, 0, 'núcleo: la garantía a 6 días no cuenta');
    igual(f.emoji, '🟢', 'emoji'); igual(f.avance, '100.0% / 100.0%', 'avance por valor ganado (el ejecutado por cantidades es 95,0 %)'); igual(f.spi, '1.00', 'SPI'); igual(f.atraso, '', 'sin atraso');
    igual(e.evm.cronogramaVencido, true, 'núcleo: su cronograma ya venció, pero con el valor ganado en 100 no es rojo');
    assert(f.avanceTitulo.includes('ejecutado por cantidades 95,0 %'), 'el ejecutado por cantidades va en el title');
    igual(f.motivos, 'Sin alertas', 'título'); assert(f.alertas.includes('📖2') && f.alertas.includes('📌2') && f.alertas.includes('📨1'), 'alertas: 2 libro, 2 observaciones, 1 solicitud');
    assert(/R\. provisional/.test(f.nombre), 'estado del proyecto');
    t.cerrar();
  });

  await prueba('un pendiente más (6) pone amarillo al proyecto verde', async () => {
    const fx = FIXTURE();
    fx.solicitudes.push({ id: 'zzz-s3', proyecto_id: 'zzz-pv', estado: 'pendiente' });
    const t = await montar(fx), f = t.filas['zzz-pv'];
    igual(esperado(fx, 'zzz-pv').sem.color, 'amarillo', 'núcleo'); igual(f.emoji, '🟡', 'emoji');
    igual(f.motivos, '6 pendientes (libro, observaciones y solicitudes)', 'motivo');
    t.cerrar();
  });

  await prueba('filas colgadas de la línea base de OTRO proyecto no cuentan: 24.0 % / 25.0 %, SPI 0.96, 🟢', async () => {
    const t = await montar(), f = t.filas['zzz-po'], e = esperado(t.fx, 'zzz-po');
    igual(e.evm.rubrosConCronograma, 1, 'núcleo: solo la fila de su línea base');
    igual(f.emoji, '🟢', 'emoji'); igual(f.avance, '24.0% / 25.0%', 'avance (con la fila ajena el plan sería 75.0 %)');
    // 24 % ganado con el plan en 25 %: el último día en que el plan (2,5 puntos por día) no lo superaba fue ayer (22,5 %)
    igual(f.spi, '0.96', 'SPI (con la fila ajena sería 0.32)'); igual(f.atraso, '1d atraso a la fecha', 'un día de atraso a la fecha');
    igual(e.evm.fechaGanada, '2026-11-20', 'núcleo: fecha ganada');
    // Contraprueba: si esa misma fila perteneciera a la línea base propia, sí contaría y el proyecto saldría rojo
    const fx = FIXTURE();
    fx.cronograma_rubros.find(c => c.id === 'zzz-c7').linea_base_id = 'zzz-lb-o';
    const t2 = await montar(fx), f2 = t2.filas['zzz-po'];
    igual(f2.avance, '24.0% / 75.0%', 'contraprueba: avance'); igual(f2.spi, '0.32', 'contraprueba: SPI'); igual(f2.emoji, '🔴', 'contraprueba: emoji');
    igual(f2.emoji, esperado(fx, 'zzz-po').emoji, 'contraprueba: coincide con el núcleo');
    t.cerrar(); t2.cerrar();
  });

  await prueba('proyecto sin línea base activa: usa todas sus filas (regla del núcleo) y coincide con él', async () => {
    const fx = FIXTURE();
    fx.lineas_base.find(l => l.id === 'zzz-lb-o').activa = false;
    const t = await montar(fx), f = t.filas['zzz-po'], e = esperado(fx, 'zzz-po');
    igual(e.evm.sinLineaBase, true, 'núcleo: sin línea base'); igual(e.evm.rubrosConCronograma, 2, 'núcleo: las dos filas');
    igual(f.avance, e.avance, 'avance'); igual(f.spi, e.spi, 'SPI'); igual(f.emoji, e.emoji, 'emoji'); igual(f.atraso, e.atraso, 'atraso');
    igual(f.avance, '24.0% / 75.0%', 'avance esperado');
    t.cerrar();
  });

  await prueba('proyecto en ejecución sin cronograma: SPI «—» y 🟡 «sin cronograma» (nunca verde); 🔴 si además venció el plazo contractual', async () => {
    const fx = FIXTURE();
    fx.cronograma_rubros = fx.cronograma_rubros.filter(c => c.proyecto_id !== 'zzz-pr');
    const t = await montar(fx), f = t.filas['zzz-pr'], e = esperado(fx, 'zzz-pr');
    igual(e.evm.sinCronograma, true, 'núcleo: sin cronograma'); igual(e.sem.color, 'amarillo', 'núcleo: amarillo');
    igual(f.spi, '—', 'SPI'); igual(f.emoji, '🟡', 'emoji: amarillo, no verde'); igual(f.avance, '17.5% / 0.0%', 'avance'); igual(f.atraso, '', 'atraso');
    igual(f.motivos, 'sin cronograma', 'título'); igual(f.spiTitulo, 'Sin cronograma: no hay SPI', 'título de la celda del SPI (sin «no estimable»: no hay SPI válido)');
    igual(f.avanceTitulo, 'Avance por valor ganado 17,5 % frente a plan a hoy 0,0 % · ejecutado por cantidades 17,5 % · sin cronograma: no hay plan ni SPI', 'título de la barra');
    assert(/background:\s*#b8860b/.test(f.barra), 'la barra de avance va en amarillo: ' + f.barra); assert(/color:\s*#676879/.test(f.spiEstilo), 'el «—» del SPI va en gris');
    assert(t.cont.textContent.includes('🔴0 🟡2 🟢2'), 'salud de la cartera: el rojo pasa a amarillo (🔴0 🟡2 🟢2)');
    // Su plazo contractual (31-mar-2027) no ha vencido. Si venció ayer: rojo, con el plazo como primer motivo
    fx.proyectos.find(p => p.id === 'zzz-pr').fecha_fin_planificada = '2026-11-20';
    const t2 = await montar(fx), f2 = t2.filas['zzz-pr'];
    igual(f2.emoji, '🔴', 'sin cronograma y plazo vencido: rojo'); igual(f2.motivos, 'plazo contractual vencido el 2026-11-20 con 17,5 % de avance · sin cronograma', 'motivos: el plazo y «sin cronograma»');
    igual(f2.emoji, esperado(fx, 'zzz-pr').emoji, 'coincide con el núcleo'); igual(f2.spi, '—', 'sigue sin SPI'); igual(f2.atraso, '', 'sin cronograma no hay atraso a la fecha que pintar');
    // El plazo que vence hoy todavía no está vencido: sigue amarillo
    fx.proyectos.find(p => p.id === 'zzz-pr').fecha_fin_planificada = HOY;
    const t3 = await montar(fx);
    igual(t3.filas['zzz-pr'].emoji, '🟡', 'plazo que vence hoy: amarillo'); igual(t3.filas['zzz-pr'].motivos, 'sin cronograma', 'plazo que vence hoy: solo «sin cronograma»');
    // Fuera de ejecución, sin cronograma sigue sin color: el cancelado del fixture no tiene cronograma
    igual(esperado(t.fx, 'zzz-pc').evm.sinCronograma, true, 'núcleo: el cancelado no tiene cronograma'); igual(t.filas['zzz-pc'].emoji, '⚪', 'cancelado sin cronograma: sin color');
    t.cerrar(); t2.cerrar(); t3.cerrar();
  });

  // ── Plazo contractual (proyectos.fecha_fin_planificada) ───────────────────
  await prueba('cargarCartera pasa proyectos.fecha_fin_planificada al núcleo como fechaFinContractual (espía), o null si el proyecto no la tiene', async () => {
    const llamadas = [];
    const t = await montar(FIXTURE(), { antes: w => { const real = w.nucleoEvmProyecto; w.nucleoEvmProyecto = datos => { const e = real(datos); llamadas.push({ datos, evm: e }); return e; }; } });
    igual(llamadas.length, 9, 'una llamada al núcleo por proyecto (los ocho activos y el liquidado)');
    const de = Object.fromEntries(llamadas.map(l => [l.datos.rubros[0].proyecto_id, l]));
    igual(de['zzz-pr'].datos.fechaFinContractual, '2027-03-31', 'pasa proyectos.fecha_fin_planificada como fechaFinContractual');
    igual(de['zzz-pr'].datos.fechaInicioProyecto, '2026-10-15', 'y no la confunde con la fecha de inicio');
    igual(de['zzz-pz'].datos.fechaFinContractual, '2026-10-31', 'también en los proyectos sin semáforo');
    igual(de['zzz-pa'].datos.fechaFinContractual, null, 'fecha_fin_planificada null → null');
    igual(de['zzz-pv'].datos.fechaFinContractual, null, 'proyecto sin el campo → null (no undefined ni texto vacío)');
    assert(llamadas.every(l => 'fechaFinContractual' in l.datos), 'todas las llamadas llevan fechaFinContractual');
    // Lo que el núcleo devuelve con ese dato
    igual(de['zzz-pr'].evm.fechaFinContractual, '2027-03-31', 'núcleo: fecha del rojo'); igual(de['zzz-pr'].evm.plazoContractualVencido, false, 'núcleo: plazo futuro, no vencido');
    igual(de['zzz-pz'].evm.plazoContractualVencido, true, 'núcleo: el plazo del pausado está vencido'); igual(t.filas['zzz-pz'].emoji, '⚪', 'y aun así el pausado va sin color');
    igual(de['zzz-pv'].evm.fechaFinContractual, null, 'núcleo: sin plazo'); igual(de['zzz-pv'].evm.plazoContractualVencido, false, 'núcleo: sin plazo no hay vencimiento');
    t.cerrar();
  });

  await prueba('plazo contractual vencido con avance menor al 100 %: 🔴 con su motivo aunque el SPI esté en verde; el día del plazo todavía no; con avance completo, no', async () => {
    const fx = FIXTURE();
    fx.garantias = [];                                                   // sin la garantía por vencer: el amarillo quedaría verde
    const pa = fx.proyectos.find(p => p.id === 'zzz-pa');
    const base = await montar(fx);
    igual(base.filas['zzz-pa'].emoji, '🟢', 'sin plazo (null): verde'); igual(base.filas['zzz-pa'].motivos, 'Sin alertas', 'sin plazo: sin motivos');
    assert(base.cont.textContent.includes('🔴1 🟡0 🟢3'), 'sin plazo: 🔴1 🟡0 🟢3');
    // Venció ayer con 60 % de avance y SPI 1,20
    pa.fecha_fin_planificada = '2026-11-20';
    const t = await montar(fx), f = t.filas['zzz-pa'], e = esperado(fx, 'zzz-pa');
    igual(e.evm.plazoContractualVencido, true, 'núcleo: plazo vencido'); igual(e.evm.avanceCompleto, false, 'núcleo: avance incompleto'); igual(e.sem.color, 'rojo', 'núcleo: rojo');
    igual(f.emoji, '🔴', 'rojo'); igual(f.motivos, 'plazo contractual vencido el 2026-11-20 con 60,0 % de avance', 'motivo en el title del semáforo');
    igual(f.spi, '1.20', 'el SPI no cambia'); assert(/color:\s*#00854d/.test(f.spiEstilo), 'y sigue pintado en verde: el rojo es por el plazo'); igual(f.atraso, '', 'sin atraso a la fecha');
    igual(f.avance, '60.0% / 50.0%', 'avance'); assert(/background:\s*#e2445c/.test(f.barra), 'la barra de avance va en rojo');
    assert(t.cont.textContent.includes('🔴2 🟡0 🟢2'), 'salud de la cartera: un rojo más (🔴2 🟡0 🟢2)');
    igual(t.orden.slice(0, 2).sort().join(','), 'zzz-pa,zzz-pr', 'sube con los rojos al principio de la tabla');
    // Con hora (timestamp como texto): cuenta el día
    pa.fecha_fin_planificada = '2026-11-20T00:00:00+00:00';
    const tHora = await montar(fx);
    igual(tHora.filas['zzz-pa'].motivos, 'plazo contractual vencido el 2026-11-20 con 60,0 % de avance', 'fecha con hora: el motivo escribe solo el día');
    // El plazo vence HOY: no está vencido
    pa.fecha_fin_planificada = HOY;
    const tHoy = await montar(fx);
    igual(tHoy.filas['zzz-pa'].emoji, '🟢', 'vence hoy: verde'); igual(tHoy.filas['zzz-pa'].motivos, 'Sin alertas', 'vence hoy: sin motivos');
    // «Hoy» es el día de Ecuador: a las 00:30 UTC del 22 todavía es 21 (no vencido); a las 05:00 UTC ya es 22 (vencido)
    const tAntes = await montar(fx, { ahora: Date.UTC(2026, 10, 22, 0, 30, 0) });
    igual(tAntes.filas['zzz-pa'].emoji, '🟢', '00:30 UTC del 22: en Ecuador sigue siendo el día del plazo');
    const tDespues = await montar(fx, { ahora: Date.UTC(2026, 10, 22, 5, 0, 0) });
    igual(tDespues.filas['zzz-pa'].emoji, '🔴', '05:00 UTC del 22: ya venció'); igual(tDespues.filas['zzz-pa'].motivos, 'plazo contractual vencido el 2026-11-21 con 60,0 % de avance', 'motivo con la fecha del plazo');
    // Vencido con el avance completo (el verde: valor ganado 100 %): no es rojo
    const fx2 = FIXTURE();
    fx2.proyectos.find(p => p.id === 'zzz-pv').fecha_fin_planificada = '2026-10-15';
    const t2 = await montar(fx2), e2 = esperado(fx2, 'zzz-pv');
    igual(e2.evm.plazoContractualVencido, true, 'núcleo: el plazo del verde venció'); igual(e2.evm.avanceCompleto, true, 'núcleo: avance completo');
    igual(t2.filas['zzz-pv'].emoji, '🟢', 'plazo vencido con avance completo: verde'); igual(t2.filas['zzz-pv'].motivos, 'Sin alertas', 'sin motivos');
    // …y deja de serlo en cuanto el avance baja del 100 %: un rubro más, sin cronograma y sin producción (avance 66,7 %)
    fx2.rubros.push({ id: 'zzz-rv3', proyecto_id: 'zzz-pv', monto_contrato: 500, total_produccion: 0, estado: 'planificado' });
    const t3 = await montar(fx2), f3 = t3.filas['zzz-pv'];
    igual(f3.emoji, '🔴', 'plazo vencido con 66,7 %: rojo'); igual(f3.motivos, 'plazo contractual vencido el 2026-10-15 con 66,7 % de avance', 'motivo: el avance es el de todos los rubros (lo programado está al 100 %)');
    igual(f3.emoji, esperado(fx2, 'zzz-pv').emoji, 'coincide con el núcleo');
    // Fuera de ejecución el plazo vencido no pinta ni se menciona
    const fx4 = FIXTURE();
    fx4.proyectos.find(p => p.id === 'zzz-pa').estado = 'planificacion'; fx4.proyectos.find(p => p.id === 'zzz-pa').fecha_fin_planificada = '2026-11-20';
    const t4 = await montar(fx4);
    igual(t4.filas['zzz-pa'].emoji, '⚪', 'en planificación con el plazo vencido: sin color'); assert(!/plazo/i.test(t4.filas['zzz-pa'].motivos), 'y su title no habla del plazo: ' + t4.filas['zzz-pa'].motivos);
    for(const x of [base, t, tHora, tHoy, tAntes, tDespues, t2, t3, t4]) x.cerrar();
  });

  await prueba('fecha de fin contractual mal formada: se muestra como error (el núcleo lanza), no se ignora', async () => {
    for(const [que, valor, patron] of [['dd/mm/aaaa', '31/03/2027', /Fecha no válida/], ['fecha inexistente', '2027-02-30', /Fecha inexistente/]]){
      const fx = FIXTURE();
      fx.proyectos.find(p => p.id === 'zzz-pr').fecha_fin_planificada = valor;
      const t = await montar(fx, { fallan: {} });
      const caja = t.cont.querySelector('#carteraError');
      assert(caja && patron.test(caja.textContent), que + ': el error del núcleo llega al panel');
      igual(Object.keys(t.filas).length, 0, que + ': ninguna fila de proyecto'); igual(t.erroresConsola.length, 1, que + ': el error queda en la consola');
      t.cerrar();
    }
    // También en un proyecto que no lleva semáforo (el pausado): la fecha mala no se calla
    const fx = FIXTURE();
    fx.proyectos.find(p => p.id === 'zzz-pz').fecha_fin_planificada = '31/10/2026';
    const t = await montar(fx, { fallan: {} });
    assert(t.cont.querySelector('#carteraError'), 'pausado con la fecha mala: error'); igual(Object.keys(t.filas).length, 0, 'pausado con la fecha mala: ninguna fila');
    t.cerrar();
  });

  await prueba('plan a la fecha menor que 0,5 %: el SPI se muestra en gris y no pinta el semáforo', async () => {
    const fx = FIXTURE();
    // El rubro programado pasa a pesar 0,4 % del proyecto: plan a hoy 0,2 %
    fx.rubros.find(r => r.id === 'zzz-rr1').monto_contrato = 4;
    fx.rubros.find(r => r.id === 'zzz-rr1').total_produccion = 0;
    fx.rubros.find(r => r.id === 'zzz-rr2').monto_contrato = 996;
    const t = await montar(fx), f = t.filas['zzz-pr'], e = esperado(fx, 'zzz-pr');
    igual(e.evm.spiValido, false, 'núcleo: SPI no válido'); igual(e.evm.spi, 0, 'núcleo: SPI 0');
    igual(f.emoji, '🟢', 'emoji'); igual(f.spi, '—', 'con el plan por debajo del mínimo no se pinta un número de SPI'); assert(/color:\s*#676879/.test(f.spiEstilo), 'SPI en gris, no en rojo');
    igual(f.motivos, 'plan a la fecha todavía menor al 0,5 %', 'título'); igual(f.atraso, '', 'sin atraso');
    igual(e.evm.atrasoFechaDias, null, 'núcleo: atraso a la fecha no medible'); igual(e.evm.atrasoProyectadoDias, null, 'núcleo: proyectado null');
    assert(!/atraso/.test(f.spiTitulo), 'con el SPI no válido el title no habla de atrasos (tampoco «no estimable»): ' + f.spiTitulo);
    t.cerrar();
  });

  await prueba('garantía vencida ayer: 🔴 aunque el SPI esté bien, con la alerta en la fila', async () => {
    const fx = FIXTURE();
    fx.garantias.find(g => g.id === 'zzz-g1').vigencia_hasta = '2026-11-20';
    const t = await montar(fx), f = t.filas['zzz-pa'];
    igual(f.emoji, '🔴', 'emoji'); igual(f.motivos, '1 garantía vencida', 'motivo'); assert(f.alertas.includes('🛡️!1'), 'alerta de garantía vencida');
    igual(f.emoji, esperado(fx, 'zzz-pa').emoji, 'coincide con el núcleo');
    t.cerrar();
  });

  await prueba('celda del SPI: el title explica el SPI con el valor ganado EN CRONOGRAMA, avisa de los rubros sin cronograma y lleva los dos atrasos', async () => {
    const t = await montar();
    // Rojo: el avance total es 17,5 %, pero el SPI es 0,50 porque el valor ganado en cronograma es 12,5 %
    igual(t.filas['zzz-pr'].spiTitulo, 'Valor ganado 12,5 % sobre plan 25,0 % · solo rubros con cronograma · 1 de 2 rubro(s) sin cronograma: no entran al SPI (el avance total es 17,5 %) · atraso a la fecha: 10 días (el plan preveía este valor ganado el 2026-11-11) · atraso proyectado al final: 40 días', 'rojo');
    igual(t.filas['zzz-pa'].spiTitulo, 'Valor ganado 60,0 % sobre plan 50,0 % · solo rubros con cronograma', 'amarillo (adelantado: sin atrasos; todos sus rubros tienen cronograma)');
    igual(t.filas['zzz-pv'].spiTitulo, 'Valor ganado 100,0 % sobre plan 100,0 % · solo rubros con cronograma', 'verde (rubro terminado = 100 %)');
    igual(t.filas['zzz-po'].spiTitulo, 'Valor ganado 24,0 % sobre plan 25,0 % · solo rubros con cronograma · 1 de 2 rubro(s) sin cronograma: no entran al SPI (el avance total es 24,0 %) · atraso a la fecha: 1 día (el plan preveía este valor ganado el 2026-11-20) · atraso proyectado al final: 1 día', 'filas ajenas (un día a la fecha y un día proyectado, en singular)');
    // Pausado (sin semáforo): su SPI se explica igual, pero SIN atrasos
    igual(t.filas['zzz-pz'].spiTitulo, 'Valor ganado 20,0 % sobre plan 100,0 % · solo rubros con cronograma', 'pausado: sin atrasos en el title');
    // El cociente de lo que dice el title es el SPI pintado
    for(const pid of Object.keys(t.filas)){
      const m = /^Valor ganado ([\d,]+) % sobre plan ([\d,]+) %/.exec(t.filas[pid].spiTitulo);
      if(!m){ igual(t.filas[pid].spi, '—', pid + ': sin cronograma, sin SPI'); continue; }
      if(t.filas[pid].spi === '—') continue;          // cronograma que aún no empieza
      const cociente = Number(m[1].replace(',', '.')) / Number(m[2].replace(',', '.'));
      assert(Math.abs(cociente - Number(t.filas[pid].spi)) < 0.011, pid + ': ' + t.filas[pid].spiTitulo + ' no da SPI ' + t.filas[pid].spi);
    }
    t.cerrar();
  });

  await prueba('atraso: se pinta el atraso A LA FECHA; con SPI válido menor que 0,10 el proyectado sale como «no estimable»', async () => {
    const fx = FIXTURE();
    fx.rubros.find(r => r.id === 'zzz-rr1').total_produccion = 0;       // nada hecho en la actividad programada
    const t = await montar(fx), f = t.filas['zzz-pr'], e = esperado(fx, 'zzz-pr');
    igual(e.evm.spi, 0, 'núcleo: SPI 0'); igual(e.evm.atrasoProyectadoDias, null, 'núcleo: proyectado no estimable');
    igual(e.evm.atrasoFechaDias, 20, 'núcleo: atraso a la fecha = los 20 días transcurridos desde el 1-nov');
    igual(f.atraso, '20d atraso a la fecha', 'atraso pintado'); igual(f.spi, '0.00', 'SPI'); igual(f.avance, '5.0% / 25.0%', 'el avance principal sigue contando el rubro sin cronograma');
    igual(f.spiTitulo, 'Valor ganado 0,0 % sobre plan 25,0 % · solo rubros con cronograma · 1 de 2 rubro(s) sin cronograma: no entran al SPI (el avance total es 5,0 %) · atraso a la fecha: 20 días (el plan preveía este valor ganado el 2026-11-01) · atraso proyectado al final: no estimable (SPI menor que 0,10)', 'title');
    assert(!t.cont.innerHTML.includes('null'), 'no se pinta «null»');
    // SPI 0,05 (válido y por debajo del mínimo de proyección): también «no estimable»; con 0,20 ya hay número
    fx.rubros.find(r => r.id === 'zzz-rr1').total_produccion = 25;      // valor ganado 1,25 sobre plan 25
    const t2 = await montar(fx), e2 = esperado(fx, 'zzz-pr');
    igual(e2.evm.spi, 0.05, 'núcleo: SPI 0,05'); igual(e2.evm.atrasoProyectadoDias, null, 'núcleo: proyectado null con SPI 0,05');
    assert(t2.filas['zzz-pr'].spiTitulo.endsWith('atraso a la fecha: 19 días (el plan preveía este valor ganado el 2026-11-02) · atraso proyectado al final: no estimable (SPI menor que 0,10)'), 'SPI 0,05: ' + t2.filas['zzz-pr'].spiTitulo);
    fx.rubros.find(r => r.id === 'zzz-rr1').total_produccion = 100;     // valor ganado 5 sobre plan 25: SPI 0,20
    const t3 = await montar(fx);
    assert(t3.filas['zzz-pr'].spiTitulo.endsWith('atraso proyectado al final: 160 días'), 'SPI 0,20: 40 días × (1/0,2 − 1) = 160: ' + t3.filas['zzz-pr'].spiTitulo);
    t.cerrar(); t2.cerrar(); t3.cerrar();
  });

  await prueba('fecha de inicio del proyecto posterior al primer inicio programado: acota el atraso a la fecha (y con inicio futuro no hay atraso)', async () => {
    // Lo que cargarCartera le pasa al núcleo, proyecto por proyecto
    const espiar = registro => w => { const real = w.nucleoEvmProyecto; w.nucleoEvmProyecto = datos => { const e = real(datos); registro.push({ datos, evm: e }); return e; }; };
    const llamadas = [];
    const base = await montar(FIXTURE(), { antes: espiar(llamadas) });
    igual(llamadas.length, 9, 'una llamada al núcleo por proyecto (los ocho activos y el liquidado)');
    const inicioDe = Object.fromEntries(llamadas.map(l => [l.datos.rubros[0].proyecto_id, l.datos.fechaInicioProyecto]));
    igual(inicioDe['zzz-pr'], '2026-10-15', 'pasa proyectos.fecha_inicio como fechaInicioProyecto'); igual(inicioDe['zzz-pz'], '2026-07-01', 'también en los proyectos sin semáforo');
    igual(inicioDe['zzz-pa'], null, 'fecha_inicio null → null'); igual(inicioDe['zzz-pv'], null, 'proyecto sin el campo → null (no undefined ni texto vacío)');
    assert(llamadas.every(l => 'fechaInicioProyecto' in l.datos && l.datos.hoy === HOY), 'todas las llamadas llevan fechaInicioProyecto y el hoy de Ecuador');
    // Con el inicio (15-oct) anterior al cronograma (1-nov) no cambia nada: 10 días
    igual(base.filas['zzz-pr'].atraso, '10d atraso a la fecha', 'inicio anterior al cronograma: 10 días');
    // El proyecto empezó de verdad el 15-nov: como mucho 6 días de atraso (el plan preveía su valor ganado el 11-nov)
    const fx = FIXTURE();
    fx.proyectos.find(p => p.id === 'zzz-pr').fecha_inicio = '2026-11-15';
    const t = await montar(fx), f = t.filas['zzz-pr'], e = esperado(fx, 'zzz-pr');
    igual(e.evm.atrasoFechaDias, 6, 'núcleo: tope de 6 días'); igual(e.evm.fechaGanada, '2026-11-11', 'núcleo: la fecha ganada no cambia');
    igual(f.atraso, '6d atraso a la fecha', 'atraso pintado: 6 días, no 10'); igual(f.spi, '0.50', 'el SPI no cambia'); igual(f.emoji, '🔴', 'sigue rojo por SPI');
    igual(f.spiTitulo, 'Valor ganado 12,5 % sobre plan 25,0 % · solo rubros con cronograma · 1 de 2 rubro(s) sin cronograma: no entran al SPI (el avance total es 17,5 %) · atraso a la fecha: 6 días (acotado a los días transcurridos desde el inicio del proyecto, 2026-11-15) · atraso proyectado al final: 40 días', 'el title dice que el atraso está acotado');
    // Sin nada hecho serían 20 días desde el 1-nov: con el inicio el 15-nov siguen siendo 6
    fx.rubros.find(r => r.id === 'zzz-rr1').total_produccion = 0;
    const t2 = await montar(fx);
    igual(t2.filas['zzz-pr'].atraso, '6d atraso a la fecha', 'sin producción: 6 días, no 20');
    // Fecha de inicio con hora (timestamp como texto): cuenta el día
    fx.proyectos.find(p => p.id === 'zzz-pr').fecha_inicio = '2026-11-15T00:00:00+00:00';
    const t3 = await montar(fx);
    igual(t3.filas['zzz-pr'].atraso, '6d atraso a la fecha', 'fecha de inicio con hora');
    assert(t3.filas['zzz-pr'].spiTitulo.includes('desde el inicio del proyecto, 2026-11-15)'), 'el title escribe solo el día: ' + t3.filas['zzz-pr'].spiTitulo);
    // Fecha de inicio FUTURA: sin atraso a la fecha (0), aunque el SPI siga en rojo
    fx.proyectos.find(p => p.id === 'zzz-pr').fecha_inicio = '2026-12-01';
    const t4 = await montar(fx), f4 = t4.filas['zzz-pr'];
    igual(esperado(fx, 'zzz-pr').evm.atrasoFechaDias, 0, 'núcleo: inicio futuro → 0');
    igual(f4.atraso, '', 'inicio futuro: no se pinta atraso'); igual(f4.emoji, '🔴', 'inicio futuro: rojo por SPI'); igual(f4.motivos, 'SPI 0,00', 'inicio futuro: motivo');
    assert(!/atraso a la fecha/.test(f4.spiTitulo), 'inicio futuro: el title no habla de atraso a la fecha: ' + f4.spiTitulo);
    base.cerrar(); t.cerrar(); t2.cerrar(); t3.cerrar(); t4.cerrar();
  });

  await prueba('fecha de inicio del proyecto mal formada: se muestra como error (el núcleo lanza), no se ignora', async () => {
    const fx = FIXTURE();
    fx.proyectos.find(p => p.id === 'zzz-pr').fecha_inicio = '15/11/2026';
    const t = await montar(fx, { fallan: {} });
    const caja = t.cont.querySelector('#carteraError');
    assert(caja && /Fecha no válida/.test(caja.textContent), 'el error del núcleo llega al panel');
    igual(Object.keys(t.filas).length, 0, 'ninguna fila de proyecto');
    t.cerrar();
  });

  await prueba('cronograma vencido con todo lo programado terminado y un rubro SIN cronograma a medias: 🟢, no rojo por cronograma vencido', async () => {
    const fx = FIXTURE();
    // Al verde (dos rubros de 500 con cronograma vencido el 1-oct, los dos al 100 %) se le suma un rubro de 500 sin cronograma y sin producción
    fx.rubros.push({ id: 'zzz-rv3', proyecto_id: 'zzz-pv', monto_contrato: 500, total_produccion: 0, estado: 'planificado' });
    const t = await montar(fx), f = t.filas['zzz-pv'], e = esperado(fx, 'zzz-pv');
    igual(e.evm.cronogramaVencido, true, 'núcleo: cronograma vencido'); igual(e.evm.obraProgramadaTerminada, true, 'núcleo: lo programado está terminado');
    igual(e.evm.rubrosSinCronograma, 1, 'núcleo: un rubro sin cronograma'); igual(e.sem.color, 'verde', 'núcleo: verde');
    igual(f.emoji, '🟢', 'verde'); igual(f.motivos, 'Sin alertas', 'sin motivos'); igual(f.atraso, '', 'sin atraso');
    igual(f.avance, '66.7% / 66.7%', 'avance principal 66,7 % (no 100): el rubro sin cronograma cuenta'); igual(f.spi, '1.00', 'SPI 1.00');
    igual(f.avanceTitulo, 'Avance por valor ganado 66,7 % frente a plan a hoy 66,7 % · ejecutado por cantidades 63,3 % · 1 de 3 rubro(s) sin cronograma: cuentan en el avance, no en el plan ni en el SPI (valor ganado en cronograma 66,7 %)', 'title de la barra');
    igual(f.spiTitulo, 'Valor ganado 66,7 % sobre plan 66,7 % · solo rubros con cronograma · 1 de 3 rubro(s) sin cronograma: no entran al SPI (el avance total es 66,7 %)', 'title del SPI');
    // Con producción en el rubro sin cronograma sube el avance principal y NO el SPI
    fx.rubros.find(r => r.id === 'zzz-rv3').total_produccion = 250;
    const t2 = await montar(fx), f2 = t2.filas['zzz-pv'];
    igual(f2.avance, '83.3% / 66.7%', 'avance principal con el rubro sin cronograma al 50 %'); igual(f2.spi, '1.00', 'el SPI no se mueve');
    assert(f2.spiTitulo.startsWith('Valor ganado 66,7 % sobre plan 66,7 %') && f2.spiTitulo.includes('(el avance total es 83,3 %)'), 'el title del SPI usa evPct y aclara el avance total: ' + f2.spiTitulo);
    t.cerrar(); t2.cerrar();
  });

  // ── Semáforo solo en ejecución ────────────────────────────────────────────
  await prueba('un proyecto por cada estado: planificación, pausado, finalizado y cancelado van sin color (⚪ y su estado en texto)', async () => {
    const t = await montar();
    for(const [pid, etiqueta] of Object.entries(SIN_SEMAFORO)){
      const f = t.filas[pid], e = esperado(t.fx, pid);
      igual(e.sem.color, null, pid + ': núcleo sin color');
      igual(f.emoji, '⚪', pid + ': ⚪'); igual(f.estadoTxt, etiqueta, pid + ': estado en texto bajo el emoji');
      igual(f.motivos, `Sin semáforo: proyecto en estado «${etiqueta}» (solo llevan color los proyectos en ejecución)`, pid + ': title');
      assert(f.nombre.includes(etiqueta), pid + ': el estado también va bajo el nombre');
      assert(/color:\s*#676879/.test(f.spiEstilo), pid + ': SPI en gris, sin color de alerta');
      assert(/background:\s*#676879/.test(f.barra), pid + ': barra de avance en gris');
    }
    for(const pid of EN_EJECUCION){ assert(/[🔴🟡🟢]/u.test(t.filas[pid].emoji), pid + ': en ejecución lleva color'); igual(t.filas[pid].estadoTxt, '', pid + ': sin texto de estado bajo el emoji'); }
    assert(/R\. definitiva/.test(t.filas['zzz-pf'].nombre), 'finalizado: conserva su estado de cierre');
    t.cerrar();
  });

  await prueba('sin color no significa sin datos: salen su avance, su SPI en gris y sus pendientes; NO se pintan atrasos ni «cronograma vencido»', async () => {
    const t = await montar();
    // Pausado: SPI 0,20, cronograma y plazo contractual vencidos, garantía vencida y una observación; en ejecución sería rojo
    const z = t.filas['zzz-pz'], ez = esperado(t.fx, 'zzz-pz');
    igual(ez.gar.vencidas, 1, 'núcleo: la garantía vencida del pausado se cuenta'); igual(ez.evm.cronogramaVencido, true, 'núcleo: cronograma vencido'); igual(ez.evm.plazoContractualVencido, true, 'núcleo: plazo contractual vencido');
    igual(ez.evm.atrasoFechaDias, 100, 'núcleo: tiene 100 días de atraso a la fecha'); igual(ez.evm.atrasoProyectadoDias, 244, 'núcleo: y 244 proyectados');
    igual(z.emoji, '⚪', 'pausado: sin color'); igual(z.spi, '0.20', 'pausado: SPI'); igual(z.avance, '20.0% / 100.0%', 'pausado: avance');
    assert(/color:\s*#676879/.test(z.spiEstilo), 'pausado: SPI en gris');
    igual(z.atraso, '', 'pausado: el atraso NO se pinta'); igual(z.atrasoEstilo, '', 'pausado: sin la línea del atraso');
    // Ninguna fila sin semáforo habla de atrasos ni de cronograma vencido, ni en el texto ni en los title
    for(const pid of Object.keys(SIN_SEMAFORO)){
      const tr = t.cont.querySelector(`tr[onclick^="irANotificacion('${pid}'"]`);
      assert(!/atraso|vencido/i.test(tr.textContent), pid + ': sin «atraso» ni «vencido» en el texto de la fila: ' + tr.textContent.replace(/\s+/g, ' '));
      for(const td of tr.querySelectorAll('[title]')) assert(!/atraso|cronograma vencido|plazo/i.test(td.getAttribute('title')), pid + ': sin atrasos, cronograma vencido ni plazo en los title: ' + td.getAttribute('title'));
    }
    assert(z.alertas.includes('🛡️!1') && z.alertas.includes('📌1'), 'pausado: garantía vencida y observación como pendientes: ' + z.alertas);
    // Finalizado: una garantía vencida y otra por vencer, como pendientes
    const f = t.filas['zzz-pf'];
    assert(f.alertas.includes('🛡️!1') && f.alertas.includes('🛡️1'), 'finalizado: garantías como pendientes: ' + f.alertas);
    // Cancelado con 7 observaciones (en ejecución sería amarillo) y planificación con una solicitud
    assert(t.filas['zzz-pc'].alertas.includes('📌7'), 'cancelado: sus 7 observaciones'); igual(t.filas['zzz-pc'].emoji, '⚪', 'cancelado: sin color');
    assert(t.filas['zzz-pp'].alertas.includes('📨1'), 'planificación: su solicitud'); igual(t.filas['zzz-pp'].spi, '—', 'planificación: el cronograma aún no empieza');
    // Contraprueba: los mismos datos con el proyecto en ejecución sí pintan
    const fx = FIXTURE();
    fx.proyectos.find(p => p.id === 'zzz-pz').estado = 'ejecucion';
    fx.proyectos.find(p => p.id === 'zzz-pc').estado = 'ejecucion';
    const t2 = await montar(fx);
    igual(t2.filas['zzz-pz'].emoji, '🔴', 'contraprueba: pausado → en ejecución es rojo');
    igual(t2.filas['zzz-pz'].motivos, 'SPI 0,20 · plazo contractual vencido el 2026-10-31 con 20,0 % de avance · cronograma vencido el 2026-10-01 con 20,0 % de lo programado · 1 garantía vencida · atraso a la fecha de 100 días', 'contraprueba: los cinco motivos, con el plazo contractual y el cronograma vencidos como motivos propios');
    igual(t2.filas['zzz-pz'].atraso, '100d atraso a la fecha', 'contraprueba: ahora sí se pinta el atraso'); assert(/color:\s*#e2445c/.test(t2.filas['zzz-pz'].atrasoEstilo), 'contraprueba: atraso en rojo');
    igual(t2.filas['zzz-pz'].spiTitulo, 'Valor ganado 20,0 % sobre plan 100,0 % · solo rubros con cronograma · atraso a la fecha: 100 días (el plan preveía este valor ganado el 2026-08-13) · atraso proyectado al final: 244 días', 'contraprueba: y los dos atrasos en el title');
    igual(t2.filas['zzz-pc'].emoji, '🟡', 'contraprueba: cancelado → en ejecución es amarillo');
    igual(t2.filas['zzz-pc'].motivos, 'sin cronograma · 7 pendientes (libro, observaciones y solicitudes)', 'contraprueba: por no tener cronograma y por sus 7 pendientes');
    t.cerrar(); t2.cerrar();
  });

  await prueba('proyecto sin estado registrado (null o sin el campo): el núcleo recibe null, sale ⚪ «Sin estado» con su aviso en «datos por completar»', async () => {
    for(const [que, quitar] of [['estado null', p => { p.estado = null; }], ['sin el campo estado', p => { delete p.estado; }], ['estado vacío', p => { p.estado = ''; }]]){
      const fx = FIXTURE();
      quitar(fx.proyectos.find(p => p.id === 'zzz-pa'));
      const estados = [];
      const t = await montar(fx, { antes: w => { const real = w.nucleoSemaforo; w.nucleoSemaforo = datos => { estados.push(datos.estado); return real(datos); }; } });
      const f = t.filas['zzz-pa'];
      assert(!t.cont.querySelector('#carteraError'), que + ': sin error');
      igual(estados.length, 8, que + ': el semáforo se pide para los ocho activos');
      assert(!estados.includes('sin_estado') && !estados.includes(undefined), que + ': al núcleo no le llega el valor de reserva «sin_estado» ni undefined: ' + JSON.stringify(estados));
      igual(estados.filter(e => e === null || e === '').length, 1, que + ': le llega null (o el texto vacío tal cual)');
      igual(f.emoji, '⚪', que + ': sin color'); igual(f.estadoTxt, 'Sin estado', que + ': texto bajo el emoji');
      igual(f.motivos, 'Sin semáforo: proyecto en estado «Sin estado» (solo llevan color los proyectos en ejecución)', que + ': title');
      igual(f.marca, '⚠ datos por completar', que + ': marca de datos por completar'); igual(f.marcaTitulo, 'Datos por completar: proyecto sin estado registrado', que + ': detalle de la marca');
      // Como cualquier otro sin semáforo: su avance y su SPI en gris, sin atrasos
      igual(f.avance, '60.0% / 50.0%', que + ': avance'); igual(f.spi, '1.20', que + ': SPI'); assert(/color:\s*#676879/.test(f.spiEstilo), que + ': SPI en gris'); igual(f.atraso, '', que + ': sin atraso');
      assert(f.alertas.includes('🛡️1'), que + ': su garantía por vencer sigue como pendiente');
      igual(Object.keys(t.filas).length, 8, que + ': el resto de la cartera se pinta');
      igual(t.cont.querySelector('#carteraSaludConteo').textContent, '3 proyecto(s) en ejecución · ⚪ 5 sin semáforo', que + ': cuenta entre los sin semáforo');
      t.cerrar();
    }
  });

  await prueba('«datos por completar»: marca visible con el detalle en el title; sin marca cuando los dos avances coinciden', async () => {
    const t = await montar();
    // Finalizado con el rubro marcado terminado y sin producción: los dos avisos del núcleo
    const f = t.filas['zzz-pf'], e = esperado(t.fx, 'zzz-pf');
    igual(e.porCompletar.length, 2, 'núcleo: dos avisos');
    igual(f.marca, '⚠ datos por completar', 'marca visible'); igual(f.avance, '100.0% / 0.0%', 'avance por valor ganado');
    igual(f.marcaTitulo, 'Datos por completar: el valor ganado (100,0 %) y el ejecutado por cantidades (0,0 %) difieren en más de 10 puntos · proyecto finalizado sin producción registrada', 'detalle en el title');
    for(const pid of ['zzz-pr', 'zzz-pa', 'zzz-pv', 'zzz-po', 'zzz-pp', 'zzz-pz', 'zzz-pc']){ igual(t.filas[pid].marca, '', pid + ': sin marca'); igual(esperado(t.fx, pid).porCompletar.length, 0, pid + ': núcleo sin avisos'); }
    igual(t.cont.querySelectorAll('.cartera-por-completar').length, 1, 'una sola marca en la tabla');
    // En ejecución: 10 puntos exactos de diferencia no marcan; un poco más, sí (y no cambia el color)
    const fx = FIXTURE();
    fx.rubros.find(r => r.id === 'zzz-rv1').total_produccion = 400;      // terminado: valor ganado 100; ejecutado 90 → 10 puntos
    const t2 = await montar(fx);
    igual(esperado(fx, 'zzz-pv').evm.diferenciaAvancePuntos, 10, 'núcleo: 10 puntos exactos'); igual(t2.filas['zzz-pv'].marca, '', '10 puntos exactos: sin marca');
    fx.rubros.find(r => r.id === 'zzz-rv1').total_produccion = 390;      // ejecutado 89 → 11 puntos
    const t3 = await montar(fx), v = t3.filas['zzz-pv'];
    igual(v.marca, '⚠ datos por completar', '11 puntos: marca'); igual(v.emoji, '🟢', 'la marca no cambia el semáforo');
    igual(v.marcaTitulo, 'Datos por completar: el valor ganado (100,0 %) y el ejecutado por cantidades (89,0 %) difieren en más de 10 puntos', 'detalle');
    igual(v.avance, '100.0% / 100.0%', 'el avance principal sigue siendo el valor ganado');
    t.cerrar(); t2.cerrar(); t3.cerrar();
  });

  await prueba('rubro suspendido (estado real no terminado): cuenta por su producción y el panel coincide con el núcleo', async () => {
    const fx = FIXTURE();
    // El rubro suspendido pasa a tener cronograma ya vencido: entra al SPI con su 10 %, no con 100 % ni con 0
    fx.cronograma_rubros.push({ id: 'zzz-c8', proyecto_id: 'zzz-pr', rubro_id: 'zzz-rr2', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-21', linea_base_id: 'zzz-lb-r' });
    const t = await montar(fx), f = t.filas['zzz-pr'], e = esperado(fx, 'zzz-pr');
    igual(f.avance, '17.5% / 75.0%', 'avance'); assert(f.spiTitulo.startsWith('Valor ganado 17,5 % sobre plan 75,0 % · solo rubros con cronograma'), 'valor ganado: 12,5 + 5,0');
    igual(f.spi, '0.23', 'SPI'); igual(f.spi, e.spi, 'coincide con el núcleo'); igual(f.emoji, e.emoji, 'semáforo'); igual(f.atraso, e.atraso, 'atraso');
    t.cerrar();
  });

  await prueba('dos líneas base activas en el mismo proyecto: vale la de mayor número, en los dos órdenes de lectura', async () => {
    // LB-1 (zzz-lb-r) da SPI 0,50; la LB-2 programa la misma actividad del 16-nov al 6-dic: plan 12,5 %, SPI 1,00.
    // La lectura va ordenada por id: con un id que ordena después y con uno que ordena antes de zzz-lb-r.
    for(const idLb2 of ['zzz-lb-r2', 'zzz-lb-0r']){
      for(const alPrincipio of [false, true]){
        const fx = FIXTURE();
        const lb2 = { id: idLb2, proyecto_id: 'zzz-pr', numero: 2, activa: true };
        if(alPrincipio) fx.lineas_base.unshift(lb2); else fx.lineas_base.push(lb2);
        const filaLb2 = { id: 'zzz-c9', proyecto_id: 'zzz-pr', rubro_id: 'zzz-rr1', fecha_inicio: '2026-11-16', fecha_fin: '2026-12-06', linea_base_id: idLb2 };
        if(alPrincipio) fx.cronograma_rubros.unshift(filaLb2); else fx.cronograma_rubros.push(filaLb2);
        const caso = `LB-2 con id ${idLb2}${alPrincipio ? ', primera en la tabla' : ', última en la tabla'}`;
        const t = await montar(fx), f = t.filas['zzz-pr'], e = esperado(fx, 'zzz-pr');
        // Orden real de llegada de las dos líneas base del proyecto en la lectura de cargarCartera
        const leidas = (await t.sb.from('lineas_base').select('id').in('proyecto_id', ['zzz-pr']).order('id')).data.map(l => l.id);
        igual(leidas.indexOf(idLb2), idLb2 === 'zzz-lb-0r' ? 0 : 1, caso + ': orden de lectura');
        igual(f.avance, '17.5% / 12.5%', caso + ': plan de la LB-2'); igual(f.spi, '1.00', caso + ': SPI de la LB-2 = 12,5 / 12,5 (con la LB-1 sería 0.50)');
        igual(f.emoji, '🟢', caso + ': semáforo'); igual(f.atraso, '', caso + ': sin atraso');
        igual(f.spi, e.spi, caso + ': coincide con el núcleo'); igual(f.emoji, e.emoji, caso + ': semáforo del núcleo');
        t.cerrar();
      }
    }
    // Contraprueba: si la LB-2 no está activa, vuelve a valer la LB-1
    const fx = FIXTURE();
    fx.lineas_base.push({ id: 'zzz-lb-r2', proyecto_id: 'zzz-pr', numero: 2, activa: false });
    fx.cronograma_rubros.push({ id: 'zzz-c9', proyecto_id: 'zzz-pr', rubro_id: 'zzz-rr1', fecha_inicio: '2026-11-16', fecha_fin: '2026-12-06', linea_base_id: 'zzz-lb-r2' });
    const t = await montar(fx);
    igual(t.filas['zzz-pr'].spi, '0.50', 'contraprueba: LB-2 inactiva'); igual(t.filas['zzz-pr'].emoji, '🔴', 'contraprueba: semáforo');
    t.cerrar();
  });

  await prueba('fila de cronograma con proyecto_id nulo o ajeno cuyo rubro es del proyecto: cuenta para el proyecto DEL RUBRO', async () => {
    const base = await montar();
    for(const [que, pidFila] of [['proyecto_id nulo', null], ['proyecto_id de otro proyecto de la cartera', 'zzz-pa'], ['proyecto_id de un proyecto que no está en la cartera', 'zzz-fuera']]){
      const fx = FIXTURE();
      fx.cronograma_rubros.find(c => c.id === 'zzz-c1').proyecto_id = pidFila;
      const t = await montar(fx);
      // El proyecto del rubro (zzz-pr) la sigue contando: mismo resultado que con la fila bien etiquetada
      const f = t.filas['zzz-pr'], e = esperado(fx, 'zzz-pr');
      igual(e.evm.rubrosConCronograma, 1, que + ': núcleo, la fila cuenta');
      igual(f.avance, '17.5% / 25.0%', que + ': avance'); igual(f.spi, '0.50', que + ': SPI (sin la fila sería «—» y verde)');
      igual(f.emoji, '🔴', que + ': semáforo'); igual(f.atraso, '10d atraso a la fecha', que + ': atraso');
      // Y no se le suma a nadie más: el resto de la cartera queda igual
      for(const pid of ['zzz-pa', 'zzz-pv', 'zzz-po']){
        igual(JSON.stringify(t.filas[pid]), JSON.stringify(base.filas[pid]), que + ': ' + pid + ' no cambia');
        igual(t.filas[pid].spi, esperado(fx, pid).spi, que + ': ' + pid + ' coincide con el núcleo');
      }
      t.cerrar();
    }
    base.cerrar();
  });

  await prueba('SPI justo bajo el umbral: se pinta truncado («0.84» en rojo, no «0.85») y el motivo dice «SPI 0,84»', async () => {
    const fx = FIXTURE();
    fx.rubros.find(r => r.id === 'zzz-ra1').total_produccion = 424.95;      // plan 50 % → SPI 0,8499
    fx.garantias = [];
    const t = await montar(fx), f = t.filas['zzz-pa'], e = esperado(fx, 'zzz-pa');
    assert(Math.abs(e.evm.spi - 0.8499) < 1e-9, 'núcleo: SPI 0,8499 (' + e.evm.spi + ')'); igual(e.sem.color, 'rojo', 'núcleo: rojo');
    igual(f.spi, '0.84', 'SPI pintado'); assert(/color:\s*#e2445c/.test(f.spiEstilo), 'en rojo'); igual(f.emoji, '🔴', 'semáforo'); igual(f.motivos, 'SPI 0,84', 'motivo');
    // Y justo bajo el otro umbral: 0,9499 es amarillo y se lee 0.94
    fx.rubros.find(r => r.id === 'zzz-ra1').total_produccion = 474.95;
    const t2 = await montar(fx), f2 = t2.filas['zzz-pa'];
    igual(f2.spi, '0.94', 'SPI pintado (amarillo)'); assert(/color:\s*#b8860b/.test(f2.spiEstilo), 'en amarillo'); igual(f2.emoji, '🟡', 'semáforo'); igual(f2.motivos, 'SPI 0,94', 'motivo');
    t.cerrar(); t2.cerrar();
  });

  await prueba('cronograma vencido con la obra sin terminar: 🔴 con motivo propio; el atraso a la fecha corre y el proyectado nunca es menor que lo ya pasado del fin', async () => {
    const fx = FIXTURE();
    // Verde pasa a 90 % de valor ganado (SPI 0,90) con el cronograma (1-ago a 1-oct) ya vencido
    fx.rubros.find(r => r.id === 'zzz-rv2').total_produccion = 400;
    const t = await montar(fx), f = t.filas['zzz-pv'], e = esperado(fx, 'zzz-pv');
    igual(e.evm.cronogramaVencido, true, 'núcleo: cronograma vencido'); igual(e.evm.fechaGanada, '2026-09-25', 'núcleo: el 90 % se preveía el 25-sep');
    igual(f.emoji, '🔴', 'rojo (con SPI 0,90 solo, sería amarillo)');
    igual(f.motivos, 'cronograma vencido el 2026-10-01 con 90,0 % de lo programado · atraso a la fecha de 57 días · SPI 0,90', 'motivos: el cronograma vencido es un motivo propio');
    igual(f.spi, '0.90', 'SPI'); igual(f.atraso, '57d atraso a la fecha', 'atraso a la fecha: del 25-sep al 21-nov'); igual(f.atraso, e.atraso, 'coincide con el núcleo');
    // Proyectado: 61 días de cronograma × (1/0,9 − 1) = 7, pero ya lleva 51 días pasada del fin (1-oct a 21-nov)
    igual(e.evm.atrasoProyectadoDias, 51, 'núcleo: proyectado = max(7, 51 días pasados del fin)');
    assert(f.spiTitulo.endsWith('atraso proyectado al final: 51 días'), 'proyectado en el title: ' + f.spiTitulo);
    // Un año después: los dos crecieron 365 días (y el atraso a la fecha sigue por debajo de lo transcurrido)
    const t2 = await montar(fx, { ahora: Date.UTC(2027, 10, 21, 15, 0, 0) }), f2 = t2.filas['zzz-pv'];
    igual(f2.spi, '0.90', 'un año después: SPI'); igual(f2.atraso, '422d atraso a la fecha', 'un año después: atraso a la fecha');
    assert(f2.spiTitulo.endsWith('atraso proyectado al final: 416 días'), 'un año después: 416 días pasados del fin: ' + f2.spiTitulo);
    igual(f2.spiTitulo, esperado(fx, 'zzz-pv', { hoy: '2027-11-21' }).spiTitulo, 'un año después: coincide con el núcleo');
    t.cerrar(); t2.cerrar();
  });

  // ── Tope de filas de PostgREST ────────────────────────────────────────────
  // Proyecto grande: 1.500 rubros de 100 (los ids ordenan ANTES que los del resto de la cartera) y, para
  // sus 100 primeros rubros, 11 filas de cronograma por rubro (10 de líneas base viejas + la activa,
  // que es la última en leerse): un solo lote de 100 rubros trae 1.100 filas.
  const FIXTURE_GRANDE = () => {
    const fx = FIXTURE();
    fx.proyectos.push({ id: 'zzz-pg', nombre: 'ZZZ Grande', contratante: 'ZZZ Cliente', estado: 'ejecucion', estado_cierre: 'en_ejecucion' });
    fx.lineas_base.push({ id: 'zzz-lb-g', proyecto_id: 'zzz-pg', numero: 11, activa: true });
    for(let n = 1; n <= 10; n++) fx.lineas_base.push({ id: 'zzz-lb-g-vieja' + String(n).padStart(2, '0'), proyecto_id: 'zzz-pg', numero: n, activa: false });
    for(let i = 0; i < 1500; i++){
      const id = 'zzz-g' + String(i).padStart(4, '0');
      // Los 1.000 primeros van al 50 %; los 500 últimos (los que un corte en 1.000 dejaría fuera), completos
      fx.rubros.push({ id, proyecto_id: 'zzz-pg', monto_contrato: 100, total_produccion: i < 1000 ? 50 : 100, estado: i % 2 ? 'trabajando' : 'planificado' });
      // Línea base activa: todo vencido (plan 100 %)
      fx.cronograma_rubros.push({ id: 'zzz-cz' + String(i).padStart(4, '0'), proyecto_id: 'zzz-pg', rubro_id: id, fecha_inicio: '2026-06-01', fecha_fin: '2026-09-01', linea_base_id: 'zzz-lb-g', created_at: '2026-05-01T00:00:00+00:00' });
      if(i < 100) for(let n = 1; n <= 10; n++){
        fx.cronograma_rubros.push({ id: 'zzz-ca' + String(n).padStart(2, '0') + String(i).padStart(4, '0'), proyecto_id: 'zzz-pg', rubro_id: id, fecha_inicio: '2027-01-01', fecha_fin: '2027-06-01', linea_base_id: 'zzz-lb-g-vieja' + String(n).padStart(2, '0'), created_at: '2026-01-' + String(n).padStart(2, '0') + 'T00:00:00+00:00' });
      }
    }
    return fx;
  };

  await prueba('tope de 1.000 filas de PostgREST superado (1.512 rubros, un lote de cronograma de 1.100): se lee todo y coincide con el núcleo', async () => {
    const fx = FIXTURE_GRANDE();
    igual(fx.rubros.length, 1512, 'rubros del fixture'); igual(fx.cronograma_rubros.length, 2509, 'filas de cronograma del fixture');
    // El cliente simulado corta de verdad: una lectura sin paginar se queda en 1.000 y no ve los rubros del resto
    const cortada = (await crearSb(fx, { maxFilas: 1000 }).from('rubros').select('id,proyecto_id').in('proyecto_id', fx.proyectos.map(p => p.id)).order('id')).data;
    igual(cortada.length, 1000, 'lectura sin paginar: 1.000 filas'); assert(cortada.every(r => r.proyecto_id === 'zzz-pg'), 'lectura sin paginar: solo rubros del proyecto grande');
    const t = await montar(fx, { maxFilas: 1000 });
    assert(!t.cont.querySelector('#carteraError'), 'sin error');
    igual(Object.keys(t.filas).sort().join(','), [...TODOS, 'zzz-pg'].sort().join(','), 'filas de la tabla');
    for(const pid of ['zzz-pg', ...TODOS]){
      const e = esperado(fx, pid), f = t.filas[pid];
      igual(f.emoji, e.emoji, pid + ': semáforo'); igual(f.avance, e.avance, pid + ': % de valor ganado / plan'); igual(f.spi, e.spi, pid + ': SPI');
      igual(f.atraso, e.atraso, pid + ': atraso'); igual(f.spiTitulo, e.spiTitulo, pid + ': valor ganado');
    }
    // Proyecto grande: 150.000 de monto; 66,7 % ejecutado (con solo 1.000 rubros serían 100.000 y 50,0 %)
    const g = t.filas['zzz-pg'];
    igual(g.vigente, '$150.0K', 'monto vigente completo'); igual(g.avance, '66.7% / 100.0%', 'avance con los 1.500 rubros'); igual(g.spi, '0.66', 'SPI con los 1.500 rubros (0,6667 truncado)');
    assert(g.spiTitulo.startsWith('Valor ganado 66,7 % sobre plan 100,0 % · solo rubros con cronograma'), 'los 1.500 rubros tienen su fila de la línea base activa');
    assert(g.avanceTitulo.includes('ejecutado por cantidades 66,7 %') && !g.avanceTitulo.includes('sin cronograma'), 'ejecutado por cantidades con los 1.500 rubros, todos con cronograma');
    // El resto de la cartera no perdió sus rubros por el corte
    igual(t.filas['zzz-pr'].spi, '0.50', 'el rojo sigue en 0.50'); igual(t.filas['zzz-pa'].spi, '1.20', 'el amarillo sigue en 1.20');
    // Y se ve en las consultas: segunda página de rubros y de cronograma, cada lote con 100 rubros como mucho
    const paginas = tabla => t.sb.llamadas.filter(l => l.tabla === tabla).map(l => l.rango && l.rango[0]);
    assert(paginas('rubros').includes(0) && paginas('rubros').includes(1000), 'rubros: se pidió la página que empieza en 1.000 (' + paginas('rubros') + ')');
    assert(paginas('cronograma_rubros').includes(1000), 'cronograma: se pidió la segunda página del lote de 1.100 filas');
    igual(paginas('cronograma_rubros').filter(d => d === 0).length, 16, 'cronograma: 16 lotes de hasta 100 rubros');
    assert(t.sb.llamadas.filter(l => l.tabla !== 'notificaciones' && l.tabla !== 'proyectos' && l.tabla !== 'empresas').every(l => Array.isArray(l.rango)), 'todas las lecturas de datos de la cartera van con .range()');
    t.cerrar();
  });

  await prueba('tablas de pendientes y de planillas por encima del tope: también se leen enteras', async () => {
    const fx = FIXTURE();
    for(let i = 0; i < 1200; i++){
      fx.observaciones.push({ id: 'zzz-og' + String(i).padStart(4, '0'), proyecto_id: i < 1100 ? 'zzz-pa' : 'zzz-po', estado: 'abierta' });
      fx.libro_obra.push({ id: 'zzz-lg' + String(i).padStart(4, '0'), proyecto_id: 'zzz-pa', estado_aprobacion: 'pendiente' });
      fx.planillas_pago.push({ id: 'zzz-pl' + String(i).padStart(4, '0'), proyecto_id: 'zzz-pa', total_monto: 1, total_liquido: 1, amortizacion_anticipo: 0, estado: 'aprobada' });
    }
    // Una garantía vencida del proyecto rojo, la última de 1.001 garantías vigentes
    for(let i = 0; i < 1000; i++) fx.garantias.push({ id: 'zzz-gg' + String(i).padStart(4, '0'), proyecto_id: 'zzz-po', vigencia_hasta: '2028-01-01', estado: 'vigente' });
    fx.garantias.push({ id: 'zzz-gz', proyecto_id: 'zzz-po', vigencia_hasta: '2026-11-01', estado: 'vigente' });
    const t = await montar(fx, { maxFilas: 1000 });
    const a = t.filas['zzz-pa'], o = t.filas['zzz-po'];
    assert(a.alertas.includes('📖1200') && a.alertas.includes('📌1100'), 'pendientes completos del amarillo: ' + a.alertas);
    assert(o.alertas.includes('📌100') && o.alertas.includes('🛡️!1'), 'observaciones y garantía vencida que estaban después de la fila 1.000: ' + o.alertas);
    igual(o.emoji, '🔴', 'la garantía vencida número 1.001 pinta rojo'); igual(o.emoji, esperado(fx, 'zzz-po').emoji, 'coincide con el núcleo');
    assert(t.cont.textContent.includes('$1.2K'), 'líquido por pagar con las 1.200 planillas');
    t.cerrar();
  });

  // ── Error de lectura ──────────────────────────────────────────────────────
  await prueba('error de lectura en cualquiera de las tablas: mensaje de error en el panel, sin indicadores', async () => {
    for(const tabla of ['rubros', 'cronograma_rubros', 'lineas_base', 'planillas_pago', 'contrato_anticipo', 'garantias', 'libro_obra', 'observaciones', 'solicitudes']){
      const t = await montar(FIXTURE(), { fallan: { [tabla]: 'ZZZ fallo de ' + tabla } });
      const caja = t.cont.querySelector('#carteraError');
      assert(caja, tabla + ': se muestra la caja de error');
      assert(/No se pudo leer la cartera/.test(caja.textContent), tabla + ': título del error');
      assert(caja.textContent.includes('ZZZ fallo de ' + tabla), tabla + ': el mensaje dice qué falló');
      assert(caja.querySelector('button[onclick="cargarCartera()"]'), tabla + ': botón para reintentar');
      igual(Object.keys(t.filas).length, 0, tabla + ': ninguna fila de proyecto');
      assert(!/SALUD DE LA CARTERA|CARTERA CONTRATADA/.test(t.cont.textContent), tabla + ': sin tarjetas de indicadores');
      assert(!/[🔴🟡🟢⚪]/u.test(t.cont.textContent), tabla + ': sin semáforos');
      assert(!/Calculando indicadores/.test(t.cont.textContent), tabla + ': no se queda en «Calculando…»');
      igual(t.erroresConsola.length, 1, tabla + ': el error queda en la consola');
      t.cerrar();
    }
  });

  await prueba('error en la SEGUNDA página de una lectura: tampoco se pintan indicadores con la primera', async () => {
    const fx = FIXTURE();
    for(let i = 0; i < 1200; i++) fx.rubros.push({ id: 'zzz-g' + String(i).padStart(4, '0'), proyecto_id: 'zzz-pr', monto_contrato: 1, total_produccion: 0, estado: 'planificado' });
    const dom = new JSDOM('<!doctype html><html><body><div id="carteraContent"></div></body></html>', { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only' });
    const w = dom.window;
    w.Date.now = () => AHORA;
    const sb = crearSb(fx, { maxFilas: 1000 }), from = sb.from;
    // La primera página de rubros llega bien; la segunda devuelve error
    sb.from = tabla => {
      const q = from(tabla);
      if(tabla !== 'rubros') return q;
      const range = q.range;
      q.range = (a, z) => a >= 1000 ? consultaQueFalla('ZZZ corte de red en la página 2') : range(a, z);
      return q;
    };
    w.sb = sb; w.console = { ...console, error(){} }; w.eval(CODIGO);
    await w.cargarCartera();
    const caja = w.document.querySelector('#carteraError');
    assert(caja && caja.textContent.includes('ZZZ corte de red en la página 2'), 'se muestra el error de la segunda página');
    igual(w.document.querySelectorAll('tr[onclick^="irANotificacion"]').length, 0, 'ninguna fila de proyecto');
    w.close();
  });

  await prueba('una fecha de cronograma mal formada se muestra como error (el núcleo lanza), no como proyecto verde', async () => {
    const fx = FIXTURE();
    fx.cronograma_rubros.find(c => c.id === 'zzz-c1').fecha_fin = '11/12/2026';
    const t = await montar(fx, { fallan: {} });
    const caja = t.cont.querySelector('#carteraError');
    assert(caja && /Fecha no válida/.test(caja.textContent), 'el error del núcleo llega al panel');
    igual(Object.keys(t.filas).length, 0, 'ninguna fila de proyecto');
    t.cerrar();
  });

  await prueba('leyenda de «SALUD DE LA CARTERA»: sale de NUCLEO_CARTERA y menciona el plazo contractual vencido, el cronograma vencido, el atraso a la fecha y que sin cronograma no hay verde', async () => {
    const t = await montar();
    const tarjeta = [...t.cont.querySelectorAll('.card')].find(c => /SALUD DE LA CARTERA/.test(c.textContent));
    const leyenda = tarjeta.lastElementChild.textContent;
    igual(leyenda, `Rojo: SPI < ${NUCLEO_CARTERA.SPI_ROJO.toFixed(2)}, plazo contractual vencido con el avance sin completar, cronograma vencido con la obra sin terminar, garantía vencida o atraso a la fecha > ${NUCLEO_CARTERA.ATRASO_ROJO_DIAS} días · Sin cronograma nunca hay verde: amarillo como mínimo`, 'leyenda');
    igual(leyenda, 'Rojo: SPI < 0.85, plazo contractual vencido con el avance sin completar, cronograma vencido con la obra sin terminar, garantía vencida o atraso a la fecha > 30 días · Sin cronograma nunca hay verde: amarillo como mínimo', 'leyenda con los umbrales vigentes');
    assert(/plazo contractual vencido/.test(leyenda) && /Sin cronograma nunca hay verde/.test(leyenda), 'menciona el plazo contractual vencido y que sin cronograma no hay verde');
    assert(/⚪ sin semáforo: solo llevan color los proyectos en ejecución/.test(t.cont.textContent), 'la leyenda de la tabla explica el ⚪');
    assert(/barra: avance por valor ganado/.test(t.cont.textContent) && /Avance \(valor ganado\) \/ plan/.test(t.cont.textContent), 'la tabla dice que el avance es el valor ganado');
    t.cerrar();
  });

  await prueba('«SALUD DE LA CARTERA» cuenta solo los proyectos en ejecución (🔴1 🟡1 🟢2) y dice cuántos van sin semáforo (4)', async () => {
    const t = await montar();
    const tarjeta = [...t.cont.querySelectorAll('.card')].find(c => /SALUD DE LA CARTERA/.test(c.textContent));
    igual(tarjeta.children[1].textContent, '🔴1 🟡1 🟢2', 'conteo por color: solo en ejecución');
    igual(t.cont.querySelector('#carteraSaludConteo').textContent, '4 proyecto(s) en ejecución · ⚪ 4 sin semáforo', 'cuántos llevan semáforo y cuántos no');
    assert(/8 proyecto\(s\) activo\(s\)/.test(t.cont.textContent), 'la cartera contratada sigue contando los ocho');
    // El pausado, con garantía vencida y SPI 0,20, NO suma a los rojos
    igual(esperado(t.fx, 'zzz-pz').gar.vencidas, 1, 'el pausado tiene una garantía vencida');
    // Si pasa a ejecución, entonces sí: 🔴2 y un proyecto menos sin semáforo
    const fx = FIXTURE();
    fx.proyectos.find(p => p.id === 'zzz-pz').estado = 'ejecucion';
    const t2 = await montar(fx);
    assert(t2.cont.textContent.includes('🔴2 🟡1 🟢2'), 'con el pausado en ejecución: 🔴2');
    igual(t2.cont.querySelector('#carteraSaludConteo').textContent, '5 proyecto(s) en ejecución · ⚪ 3 sin semáforo', 'conteo actualizado');
    // Cartera sin ningún proyecto en ejecución: todo a cero y todos sin semáforo
    const fx3 = FIXTURE();
    fx3.proyectos.forEach(p => { if(p.estado === 'ejecucion') p.estado = 'pausado'; });
    const t3 = await montar(fx3);
    assert(t3.cont.textContent.includes('🔴0 🟡0 🟢0'), 'sin proyectos en ejecución: ceros');
    igual(t3.cont.querySelector('#carteraSaludConteo').textContent, '0 proyecto(s) en ejecución · ⚪ 8 sin semáforo', 'los ocho sin semáforo');
    assert(Object.values(t3.filas).every(f => f.emoji === '⚪'), 'ninguna fila con color');
    t.cerrar(); t2.cerrar(); t3.cerrar();
  });

  await prueba('orden de la tabla: rojo, amarillo, verdes y al final los que no llevan color', async () => {
    const t = await montar();
    igual(t.orden[0], 'zzz-pr', 'primero el rojo'); igual(t.orden[1], 'zzz-pa', 'luego el amarillo');
    igual(t.orden.slice(2, 4).sort().join(','), 'zzz-po,zzz-pv', 'después los verdes');
    igual(t.orden.slice(4).sort().join(','), 'zzz-pc,zzz-pf,zzz-pp,zzz-pz', 'al final los cuatro sin color');
    const colores = t.orden.map(pid => String(esperado(t.fx, pid).sem.color));
    igual(colores.join(','), 'rojo,amarillo,verde,verde,null,null,null,null', 'orden según el núcleo');
    // Con la tabla de proyectos en otro orden (los sin color primero) el resultado es el mismo
    const fx = FIXTURE(); fx.proyectos.reverse();
    const t2 = await montar(fx);
    igual(t2.orden.map(pid => String(esperado(fx, pid).sem.color)).join(','), 'rojo,amarillo,verde,verde,null,null,null,null', 'orden con la entrada revuelta');
    t.cerrar(); t2.cerrar();
  });

  await prueba('totales por empresa (multiempresa): la columna «Salud» cuenta los colores y aparte los sin semáforo', async () => {
    const fx = FIXTURE();
    fx.proyectos.forEach(p => { p.empresa_id = ['zzz-pr', 'zzz-pa', 'zzz-pz'].includes(p.id) ? 'zzz-e1' : 'zzz-e2'; });
    const dom = new JSDOM('<!doctype html><html><body><div id="carteraContent"></div></body></html>', { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only' });
    const w = dom.window;
    w.Date.now = () => AHORA; w.sb = crearSb(fx); w.console = console; w.eval(CODIGO);
    w.fijarEmpresas([{ id: 'zzz-e1', nombre: 'ZZZ Alfa', sigla: 'ZZA', es_gestora: true, activa: true }, { id: 'zzz-e2', nombre: 'ZZZ Beta', sigla: 'ZZB', es_gestora: true, activa: true }]);
    await w.cargarCartera();
    const tarjeta = [...w.document.querySelectorAll('.card')].find(c => /Totales por empresa/.test(c.textContent));
    assert(tarjeta, 'se pinta la tarjeta de totales por empresa');
    const salud = Object.fromEntries([...tarjeta.querySelectorAll('tbody tr')].map(tr => [tr.children[0].textContent.trim(), tr.children[1].textContent.trim() + ' | ' + tr.children[5].textContent.trim()]));
    igual(salud['ZZZ Alfa'], '3 | 🔴1 🟡1 🟢0 ⚪1', 'Alfa: rojo, amarillo y el pausado sin color');
    igual(salud['ZZZ Beta'], '5 | 🔴0 🟡0 🟢2 ⚪3', 'Beta: dos verdes y tres sin color');
    w.close();
  });

  await prueba('«hoy» es la fecha de Ecuador: a las 00:30 UTC del 22 todavía se calcula con el 21', async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="carteraContent"></div></body></html>', { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only' });
    const w = dom.window;
    w.Date.now = () => Date.UTC(2026, 10, 22, 0, 30, 0);
    w.sb = crearSb(FIXTURE()); w.console = console; w.eval(CODIGO);
    await w.cargarCartera();
    const tr = w.document.querySelector('tr[onclick^="irANotificacion(\'zzz-pr\'"]');
    assert(tr.textContent.includes('17.5% / 25.0%') && tr.textContent.includes('10d atraso a la fecha'), 'mismo plan y atraso que el 21 en Ecuador: ' + tr.textContent.replace(/\s+/g, ' ').slice(0, 120));
    w.close();
  });

  // ── Lectura del fuente ────────────────────────────────────────────────────
  const cuerpo = extraerFuncion(src, 'cargarCartera');
  // Sin comentarios de línea, para no tropezar con texto explicativo
  const codigoCartera = cuerpo.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

  await prueba('fuente: cargarCartera delega en el núcleo (EVM, garantías y semáforo)', () => {
    for(const f of ['nucleoEvmProyecto(', 'nucleoGarantias(', 'nucleoSemaforo(', 'nucleoDatosPorCompletar(']) assert(codigoCartera.includes(f), 'llama a ' + f + ')');
    assert(/nucleoSemaforo\(\{\s*estado:\s*p\.estado \?\? null,/.test(codigoCartera), 'pasa el estado del proyecto al semáforo, o null si no tiene (nunca undefined)');
    assert(!/sin_estado/.test(cuerpo), 'sin el valor de reserva «sin_estado»: el núcleo acepta null');
    assert(/fechaInicioProyecto:\s*inicioPorProyecto\[id\]/.test(codigoCartera) && /inicioPorProyecto\[p\.id\] = p\.fecha_inicio \?\? null/.test(codigoCartera), 'pasa proyectos.fecha_inicio al núcleo como fechaInicioProyecto');
    assert(/fechaFinContractual:\s*finContractualPorProyecto\[id\]/.test(codigoCartera) && /finContractualPorProyecto\[p\.id\] = p\.fecha_fin_planificada \?\? null/.test(codigoCartera), 'pasa proyectos.fecha_fin_planificada al núcleo como fechaFinContractual');
    igual((codigoCartera.match(/fecha_fin_planificada/g) || []).length, 1, 'fecha_fin_planificada solo se lee para pasarla al núcleo');
    assert(/conColor && atraso>0/.test(codigoCartera) && !/[^&]\s+atraso>0\s*\?/.test(codigoCartera.replace(/conColor && atraso>0/g, '')), 'el atraso solo se pinta con semáforo (conColor)');
    assert(/evm\.evPct/.test(codigoCartera) && /evm\.planPct/.test(codigoCartera) && /evm\.rubrosSinCronograma/.test(codigoCartera), 'los title usan evPct / planPct y avisan de los rubros sin cronograma');
    assert(/NUCLEO_CARTERA\.SPI_MINIMO_PROYECCION/.test(codigoCartera) && /proyectado===null && evm\.spiValido/.test(codigoCartera), '«no estimable» solo con SPI válido, y el mínimo sale de NUCLEO_CARTERA');
    assert(/nucleoDatosPorCompletar\(\{\s*evm:\s*d\.evm,\s*estado:\s*p\.estado\s*\}\)/.test(codigoCartera), 'y a los avisos de datos por completar');
    assert(/const avance = evm\.avancePct;/.test(codigoCartera) && !/const real = /.test(codigoCartera), 'el avance que se pinta es evm.avancePct (valor ganado), no realPct');
    assert(/const atraso = evm\.atrasoFechaDias;/.test(codigoCartera) && /evm\.atrasoProyectadoDias/.test(codigoCartera), 'el atraso pintado es el atraso a la fecha; el proyectado va al title');
    assert(/sem\.color !== null/.test(codigoCartera) && !/ejecucion/.test(codigoCartera), 'quién lleva color lo decide el núcleo (color null), sin comparar el estado a mano');
    assert(/estadoLabel\(NUCLEO_CARTERA\.ESTADO_CON_SEMAFORO\)/.test(codigoCartera), 'el texto «en ejecución» sale de NUCLEO_CARTERA.ESTADO_CON_SEMAFORO');
    assert(/'lineas_base',\s*'id,proyecto_id,numero,activa'/.test(codigoCartera), 'lee id, proyecto, número y activa de las líneas base');
    assert(/nucleoLineaBaseActiva\(/.test(codigoCartera), 'la línea base activa la elige el núcleo');
    assert(!/\.eq\('activa'/.test(codigoCartera), 'sin filtro propio de «activa» (la regla es del núcleo)');
    assert(/lineaBaseActivaId:\s*lbPorProyecto\[id\]/.test(codigoCartera), 'pasa al núcleo la línea base activa del PROPIO proyecto');
    assert(/'rubros',\s*'id,proyecto_id,monto_contrato,total_produccion,estado'/.test(codigoCartera), 'lee el estado del rubro (terminado = 100 %)');
    assert(/proyectoDeRubro\[c\.rubro_id\]/.test(codigoCartera), 'agrupa el cronograma por el proyecto del rubro');
    assert(!/cronograma_rubros'\)[^;]*\.in\('proyecto_id'/.test(codigoCartera), 'no filtra el cronograma por su propio proyecto_id');
    assert(/nucleoHoyEcuador\(\)/.test(codigoCartera) && !/\bhoyEcuador\(/.test(codigoCartera), '«hoy» sale de nucleoHoyEcuador()');
  });

  await prueba('fuente: todas las lecturas de datos van por traerPaginado en modo estricto y con orden estable', () => {
    // Las únicas llamadas directas a sb.from son la de leerDeCartera, la del cronograma (ambas dentro de
    // traerPaginado) y la de los resúmenes de IA (limit 7, no entra en los indicadores)
    const directas = codigoCartera.match(/sb\.from\(([^)]*)\)/g) || [];
    igual(directas.join(' '), "sb.from(tabla) sb.from('cronograma_rubros') sb.from('notificaciones')", 'llamadas a sb.from');
    igual((codigoCartera.match(/traerPaginado\(/g) || []).length, 2, 'dos usos de traerPaginado (el genérico y el del cronograma)');
    igual((codigoCartera.match(/,\s*1000,\s*true\)/g) || []).length, 2, 'los dos en modo estricto (lanzan ante un error)');
    assert(/\.in\('proyecto_id', ids\)\.order\('id'\)/.test(codigoCartera), 'orden estable por id en las lecturas por proyecto');
    assert(/\.in\('rubro_id', lote\)\.order\('created_at'\)\.order\('id'\)/.test(codigoCartera), 'cronograma por lotes de rubro, ordenado por creación e id');
    for(const tabla of ['rubros', 'lineas_base', 'planillas_pago', 'contrato_anticipo', 'garantias', 'libro_obra', 'observaciones', 'solicitudes']){
      assert(codigoCartera.includes(`leerDeCartera('${tabla}'`), tabla + ' se lee con leerDeCartera');
    }
    assert(!/\.data\b/.test(codigoCartera.replace(/data: resumenesIA/, '')), 'ya no se usan respuestas { data } sin comprobar el error');
    assert(/catch\(e\)/.test(codigoCartera) && /carteraError/.test(codigoCartera), 'un fallo de lectura acaba en el mensaje de error');
  });

  await prueba('fuente: cargarCartera ya no tiene fórmulas propias (umbrales, fracción, atraso, garantías)', () => {
    // Con comentarios incluidos: ni en código, ni en textos, ni en la leyenda
    assert(!/0?[.,](85|95)(?!\d)/.test(cuerpo), 'sin 0.85 / 0.95 en ninguna forma (0.85, .85, 0,85)');
    assert(!/hoyMs/.test(cuerpo), 'sin la variable muerta hoyMs');
    assert(!/SPI\s*(&lt;|<)\s*\d/.test(cuerpo), 'sin umbral del SPI escrito a mano en un texto');
    assert(/NUCLEO_CARTERA\.SPI_ROJO\.toFixed\(2\)/.test(codigoCartera) && /NUCLEO_CARTERA\.ATRASO_ROJO_DIAS/.test(codigoCartera), 'la leyenda se construye con NUCLEO_CARTERA (SPI y atraso)');
    assert(/nucleoSpiTruncado\(spi\)/.test(codigoCartera) && !/spi\.toFixed/.test(codigoCartera), 'el SPI se pinta truncado por el núcleo, no redondeado');
    assert(!/[<>]=?\s*0\.5\b/.test(codigoCartera), 'sin el corte de plan mínimo 0.5 literal');
    assert(!/\bfrac\b/.test(codigoCartera), 'sin el cálculo de frac');
    assert(!/1\s*\/\s*spi/.test(codigoCartera), 'sin la fórmula de atraso (1/spi − 1)');
    assert(!/0?[.,]10?\b(?!\d)/.test(codigoCartera.replace(/toFixed\(1\)|toFixed\(2\)|slice\(0, 10\)/g, '')), 'sin el SPI mínimo de proyección (0,10) escrito a mano');
    assert(!/nucleoDiasEntre|nucleoSumarDias|planFinalPct|obraProgramadaTerminada/.test(codigoCartera), 'sin cuentas propias de días ni de «lo programado terminado»');
    assert(!/86400000/.test(codigoCartera), 'sin aritmética de días');
    // («atraso>0» sí aparece: solo decide si se muestra el texto del atraso)
    assert(!/atraso\s*>\s*[1-9]/.test(codigoCartera)&& !/pendientes\s*>\s*\d/.test(codigoCartera), 'sin los cortes de atraso (30) ni de pendientes (5)');
    assert(!/hoyEcuador\(\s*5\s*\)/.test(codigoCartera) && !/vigencia_hasta\s*[<>]/.test(codigoCartera), 'sin la ventana de 5 días ni comparaciones de vigencia de garantías');
    assert(!/setLBs/.test(codigoCartera), 'sin el filtro viejo por líneas base activas de toda la cartera');
    assert(!/ejecutado\s*\/\s*d\.vigente/.test(codigoCartera), 'sin el avance real calculado a mano');
    assert(!/DIFERENCIA_AVANCE_PUNTOS|OBRA_TERMINADA_PCT/.test(codigoCartera) && !/diferenciaAvancePuntos\s*>/.test(codigoCartera), 'sin decidir a mano «datos por completar» ni «obra terminada»');
    assert(!/cronogramaVencido/.test(codigoCartera), 'sin regla propia de cronograma vencido (es un motivo del núcleo)');
    assert(!/plazoContractualVencido|avanceCompleto|evm\.fechaFinContractual|fecha_fin_planificada\s*[<>]|[<>]=?\s*hoyStr/.test(codigoCartera), 'sin regla propia de plazo contractual vencido (es un motivo del núcleo)');
    // «Sin cronograma no es verde» también es del núcleo: el color sale solo de sem.color, y sinCronograma solo redacta textos
    igual((codigoCartera.match(/d\.clave = /g) || []).length, 1, 'el color se asigna una sola vez'); assert(/d\.clave = d\.sem\.color \|\| 'sin';/.test(codigoCartera), 'y sale de sem.color');
    assert(!/sinCronograma[^\n]*(amarillo|verde|rojo)/.test(codigoCartera), 'sin elegir color a mano por no tener cronograma');
    assert(!/TOLERANCIA_MONTO|montoContractual|monto_contrato\s*[-+<>]/.test(codigoCartera.replace(/'id,proyecto_id,monto_contrato,total_produccion,estado'/, '')), 'sin comparación propia de montos');
    // El color del SPI se decide con las constantes del núcleo
    assert(/NUCLEO_CARTERA\.SPI_ROJO/.test(codigoCartera) && /NUCLEO_CARTERA\.SPI_AMARILLO/.test(codigoCartera), 'el color del SPI usa NUCLEO_CARTERA');
  });

  await prueba('fuente: index.html carga cartera-nucleo.js antes del script principal y el service worker lo guarda', () => {
    const iNucleo = html.indexOf('<script src="cartera-nucleo.js"></script>');
    const iPrincipal = html.search(/^<script>\r?$/m);
    assert(iNucleo > 0, 'index.html incluye cartera-nucleo.js');
    assert(iPrincipal > iNucleo, 'y lo carga antes del script principal');
    assert(leer(path.join(RAIZ, 'service-worker.js')).includes('/HidivoGdP/cartera-nucleo.js'), 'el service worker lo precachea (la app funciona sin señal)');
  });

  resumen();
})();
