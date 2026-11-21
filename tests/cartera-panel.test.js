// Panel Cartera: ejecuta la función REAL cargarCartera de index.html en jsdom, con cartera-nucleo.js
// cargado como en la app, sobre una cartera SINTÉTICA de cuatro proyectos, y comprueba que lo
// pintado (semáforo, % real / plan, SPI, atraso) es exactamente lo que da el núcleo llamado
// directamente con los mismos datos. También comprueba que las lecturas van paginadas (tope de
// filas de PostgREST), que un error de lectura se muestra en vez de pintar indicadores y, leyendo
// el fuente, que cargarCartera ya no trae fórmulas propias.
//
//   node cartera-panel.test.js
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, leer, scriptPrincipal, extraerFuncion, extraerConst, crearSb, prueba, resumen, assert } = require('./lib/arnes');
const { NUCLEO_CARTERA, nucleoEvmProyecto, nucleoGarantias, nucleoSemaforo, nucleoLineaBaseActiva, nucleoSpiTruncado } = require(path.join(RAIZ, 'cartera-nucleo.js'));

const html = leer(path.join(RAIZ, 'index.html'));
const src = scriptPrincipal(html);
const CODIGO = [
  leer(path.join(RAIZ, 'constantes.js')), leer(path.join(RAIZ, 'expediente.js')), leer(path.join(RAIZ, 'cartera-nucleo.js')),
  extraerConst(src, 'filtrosCartera'),
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
    { id: 'zzz-pr', nombre: 'ZZZ Rojo por SPI', contratante: 'ZZZ Cliente', estado_cierre: 'en_ejecucion' },
    { id: 'zzz-pa', nombre: 'ZZZ Amarillo por garantia', contratante: 'ZZZ Cliente', estado_cierre: 'en_ejecucion' },
    { id: 'zzz-pv', nombre: 'ZZZ Verde', contratante: 'ZZZ Cliente', estado_cierre: 'recepcion_provisional' },
    { id: 'zzz-po', nombre: 'ZZZ Filas ajenas', contratante: 'ZZZ Cliente', estado_cierre: null },
    { id: 'zzz-pl', nombre: 'ZZZ Liquidado', contratante: 'ZZZ Cliente', estado_cierre: 'liquidado' }
  ],
  lineas_base: [
    { id: 'zzz-lb-r', proyecto_id: 'zzz-pr', numero: 1, activa: true },
    { id: 'zzz-lb-a', proyecto_id: 'zzz-pa', numero: 1, activa: true },
    { id: 'zzz-lb-v0', proyecto_id: 'zzz-pv', numero: 1, activa: false },
    { id: 'zzz-lb-v', proyecto_id: 'zzz-pv', numero: 2, activa: true },
    { id: 'zzz-lb-o', proyecto_id: 'zzz-po', numero: 1, activa: true }
  ],
  rubros: [
    // Rojo: en la actividad programada va a la mitad de lo debido (SPI 0,50); el segundo rubro no tiene
    // cronograma y sube el avance real sin tocar el SPI (con la fórmula vieja el SPI daría 0,70).
    { id: 'zzz-rr1', proyecto_id: 'zzz-pr', monto_contrato: 1000, total_produccion: 250, estado: 'trabajando' },
    // suspendido: no está terminado, así que cuenta por su producción (10 %), no como 100 % ni como 0
    { id: 'zzz-rr2', proyecto_id: 'zzz-pr', monto_contrato: 1000, total_produccion: 100, estado: 'suspendido' },
    // Amarillo: adelantado (SPI 1,20); lo pone amarillo la garantía que vence en 3 días
    { id: 'zzz-ra1', proyecto_id: 'zzz-pa', monto_contrato: 1000, total_produccion: 600, estado: 'trabajando' },
    // Verde: rubro terminado (cuenta 100 % aunque la producción sea 90 %) y otro al día
    { id: 'zzz-rv1', proyecto_id: 'zzz-pv', monto_contrato: 500, total_produccion: 450, estado: 'terminado' },
    { id: 'zzz-rv2', proyecto_id: 'zzz-pv', monto_contrato: 500, total_produccion: 500, estado: 'trabajando' },
    // Filas ajenas: va al día en su línea base (SPI 0,96)
    { id: 'zzz-ro1', proyecto_id: 'zzz-po', monto_contrato: 1000, total_produccion: 480, estado: 'trabajando' },
    { id: 'zzz-ro2', proyecto_id: 'zzz-po', monto_contrato: 1000, total_produccion: 0, estado: 'planificado' },
    { id: 'zzz-rl1', proyecto_id: 'zzz-pl', monto_contrato: 100, total_produccion: 100, estado: 'terminado' }
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
    { id: 'zzz-c7', proyecto_id: 'zzz-po', rubro_id: 'zzz-ro2', fecha_inicio: '2026-09-01', fecha_fin: '2026-10-01', linea_base_id: 'zzz-lb-r' }
  ],
  garantias: [
    { id: 'zzz-g1', proyecto_id: 'zzz-pa', vigencia_hasta: '2026-11-24', estado: 'vigente' },
    { id: 'zzz-g2', proyecto_id: 'zzz-pa', vigencia_hasta: null, estado: 'vigente' },          // «por definir»: no cuenta
    { id: 'zzz-g3', proyecto_id: 'zzz-pa', vigencia_hasta: '2026-01-01', estado: 'devuelta' }, // no vigente: no cuenta
    { id: 'zzz-g4', proyecto_id: 'zzz-pv', vigencia_hasta: '2026-11-27', estado: 'vigente' }   // vence en 6 días: no cuenta
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
    { id: 'zzz-o3', proyecto_id: 'zzz-pv', estado: 'cerrada' }
  ],
  solicitudes: [
    { id: 'zzz-s1', proyecto_id: 'zzz-pv', estado: 'en_revision' },
    { id: 'zzz-s2', proyecto_id: 'zzz-pv', estado: 'aprobada' }
  ],
  planillas_pago: [], contrato_anticipo: [], notificaciones: []
});

// Lo que da el núcleo llamado directamente con los datos del fixture (agrupados aquí, sin pasar por cargarCartera).
// El cronograma de un proyecto son las filas de SUS RUBROS (tengan el proyecto_id que tengan) y su
// línea base activa la elige el núcleo, como hace la exportación diaria.
function esperado(fx, pid){
  const lb = nucleoLineaBaseActiva(fx.lineas_base.filter(l => l.proyecto_id === pid));
  const rubros = fx.rubros.filter(r => r.proyecto_id === pid);
  const idsRubro = new Set(rubros.map(r => r.id));
  const evm = nucleoEvmProyecto({
    rubros,
    cronograma: fx.cronograma_rubros.filter(c => idsRubro.has(c.rubro_id)),
    lineaBaseActivaId: lb ? lb.id : null, hoy: HOY
  });
  const gar = nucleoGarantias(fx.garantias.filter(g => g.proyecto_id === pid), HOY);
  const pendientes = fx.libro_obra.filter(l => l.proyecto_id === pid && l.estado_aprobacion === 'pendiente').length
    + fx.observaciones.filter(o => o.proyecto_id === pid && o.estado === 'abierta').length
    + fx.solicitudes.filter(s => s.proyecto_id === pid && ['pendiente', 'en_revision'].includes(s.estado)).length;
  const sem = nucleoSemaforo({ evm, garantias: gar, pendientes });
  return {
    evm, gar, pendientes, sem,
    emoji: { rojo: '🔴', amarillo: '🟡', verde: '🟢' }[sem.color],
    avance: `${evm.realPct.toFixed(1)}% / ${evm.planPct.toFixed(1)}%`,
    spi: evm.spi === null ? '—' : nucleoSpiTruncado(evm.spi).toFixed(2),
    spiTitulo: evm.sinCronograma ? 'Sin cronograma: no hay SPI'
      : `Valor ganado ${evm.evPct.toFixed(1).replace('.', ',')} % sobre plan ${evm.planPct.toFixed(1).replace('.', ',')} % · solo rubros con cronograma`,
    atraso: evm.atrasoDias > 0 ? `~${evm.atrasoDias}d atraso` : ''
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
// de las tablas cuya lectura devuelve error · opciones.ahora: instante fijo.
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
    filas[pid] = {
      emoji: td[0].textContent.trim(), motivos: td[0].getAttribute('title'),
      nombre: td[1].textContent,
      avance: td[2].querySelector('div').textContent.trim(),
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

  await prueba('la pantalla se pinta con los cuatro proyectos activos (el liquidado va aparte)', async () => {
    const t = await montar();
    assert(!/Calculando indicadores/.test(t.cont.innerHTML), 'no se queda en «Calculando indicadores…»');
    igual(Object.keys(t.filas).sort().join(','), 'zzz-pa,zzz-po,zzz-pr,zzz-pv', 'filas de la tabla');
    assert(/Proyectos liquidados \(1\)/.test(t.cont.textContent), 'el liquidado se lista en su desplegable');
    assert(!t.cont.innerHTML.includes('undefined') && !t.cont.innerHTML.includes('NaN'), 'sin «undefined» ni «NaN» en lo pintado');
    t.cerrar();
  });

  await prueba('cada fila pinta exactamente lo que da cartera-nucleo.js con los mismos datos', async () => {
    const t = await montar();
    for(const pid of ['zzz-pr', 'zzz-pa', 'zzz-pv', 'zzz-po']){
      const e = esperado(t.fx, pid), f = t.filas[pid];
      igual(f.emoji, e.emoji, pid + ': semáforo');
      igual(f.avance, e.avance, pid + ': % real / plan');
      igual(f.spi, e.spi, pid + ': SPI');
      igual(f.atraso, e.atraso, pid + ': atraso');
      igual(f.spiTitulo, e.spiTitulo, pid + ': título de la celda del SPI');
      igual(f.motivos, e.sem.motivos.join(' · ') || 'Sin alertas', pid + ': motivos en el título del semáforo');
    }
    t.cerrar();
  });

  await prueba('rojo por SPI: 🔴, SPI 0.50 sobre los rubros con cronograma (no 0.70), 17.5 % / 25.0 %, ~20 d de atraso', async () => {
    const t = await montar(), f = t.filas['zzz-pr'], e = esperado(t.fx, 'zzz-pr');
    igual(e.sem.color, 'rojo', 'núcleo: color'); igual(e.gar.vencidas, 0, 'núcleo: sin garantías vencidas (el rojo es por SPI)');
    assert(e.evm.atrasoDias <= NUCLEO_CARTERA.ATRASO_ROJO_DIAS, 'núcleo: el atraso no llega a 31 (el rojo es por SPI)');
    igual(f.emoji, '🔴', 'emoji'); igual(f.avance, '17.5% / 25.0%', 'avance'); igual(f.spi, '0.50', 'SPI'); igual(f.atraso, '~20d atraso', 'atraso');
    igual(f.motivos, 'SPI 0,50', 'motivo'); assert(/color:\s*#e2445c/.test(f.spiEstilo), 'SPI en rojo');
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
    igual(f.emoji, '🟢', 'emoji'); igual(f.avance, '95.0% / 100.0%', 'avance'); igual(f.spi, '1.00', 'SPI'); igual(f.atraso, '', 'sin atraso');
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
    igual(f.spi, '0.96', 'SPI (con la fila ajena sería 0.32)'); igual(f.atraso, '', 'sin atraso');
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

  await prueba('proyecto sin cronograma: SPI «—», verde, y el título lo explica', async () => {
    const fx = FIXTURE();
    fx.cronograma_rubros = fx.cronograma_rubros.filter(c => c.proyecto_id !== 'zzz-pr');
    const t = await montar(fx), f = t.filas['zzz-pr'];
    igual(f.spi, '—', 'SPI'); igual(f.emoji, '🟢', 'emoji'); igual(f.avance, '17.5% / 0.0%', 'avance'); igual(f.atraso, '', 'atraso');
    igual(f.motivos, 'sin cronograma: no hay SPI', 'título'); igual(f.spiTitulo, 'Sin cronograma: no hay SPI', 'título de la celda del SPI');
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
    igual(f.emoji, '🟢', 'emoji'); igual(f.spi, '0.00', 'SPI pintado'); assert(/color:\s*#676879/.test(f.spiEstilo), 'SPI en gris, no en rojo');
    igual(f.motivos, 'plan a la fecha todavía menor al 0,5 %', 'título'); igual(f.atraso, '', 'sin atraso');
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

  await prueba('celda del SPI: el title explica el valor ganado («Valor ganado X % sobre plan Y % · solo rubros con cronograma»)', async () => {
    const t = await montar();
    // Rojo: 17,5 % ejecutado contra 25,0 % de plan daría 0,70; el SPI es 0,50 porque el valor ganado es 12,5 %
    igual(t.filas['zzz-pr'].spiTitulo, 'Valor ganado 12,5 % sobre plan 25,0 % · solo rubros con cronograma', 'rojo');
    igual(t.filas['zzz-pa'].spiTitulo, 'Valor ganado 60,0 % sobre plan 50,0 % · solo rubros con cronograma', 'amarillo');
    igual(t.filas['zzz-pv'].spiTitulo, 'Valor ganado 100,0 % sobre plan 100,0 % · solo rubros con cronograma', 'verde (rubro terminado = 100 %)');
    igual(t.filas['zzz-po'].spiTitulo, 'Valor ganado 24,0 % sobre plan 25,0 % · solo rubros con cronograma', 'filas ajenas');
    // El cociente de lo que dice el title es el SPI pintado
    for(const pid of Object.keys(t.filas)){
      const m = /^Valor ganado ([\d,]+) % sobre plan ([\d,]+) %/.exec(t.filas[pid].spiTitulo);
      const cociente = Number(m[1].replace(',', '.')) / Number(m[2].replace(',', '.'));
      assert(Math.abs(cociente - Number(t.filas[pid].spi)) < 0.011, pid + ': ' + t.filas[pid].spiTitulo + ' no da SPI ' + t.filas[pid].spi);
    }
    t.cerrar();
  });

  await prueba('rubro suspendido (estado real no terminado): cuenta por su producción y el panel coincide con el núcleo', async () => {
    const fx = FIXTURE();
    // El rubro suspendido pasa a tener cronograma ya vencido: entra al SPI con su 10 %, no con 100 % ni con 0
    fx.cronograma_rubros.push({ id: 'zzz-c8', proyecto_id: 'zzz-pr', rubro_id: 'zzz-rr2', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-21', linea_base_id: 'zzz-lb-r' });
    const t = await montar(fx), f = t.filas['zzz-pr'], e = esperado(fx, 'zzz-pr');
    igual(f.avance, '17.5% / 75.0%', 'avance'); igual(f.spiTitulo, 'Valor ganado 17,5 % sobre plan 75,0 % · solo rubros con cronograma', 'valor ganado: 12,5 + 5,0');
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
        igual(f.avance, '17.5% / 12.5%', caso + ': plan de la LB-2'); igual(f.spi, '1.00', caso + ': SPI de la LB-2 (con la LB-1 sería 0.50)');
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
      igual(f.emoji, '🔴', que + ': semáforo'); igual(f.atraso, '~20d atraso', que + ': atraso');
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

  await prueba('cronograma vencido: el atraso pintado no crece con los meses', async () => {
    const fx = FIXTURE();
    // Verde pasa a 90 % de lo programado: SPI 0,90 con cronograma del 1-ago al 1-oct (61 días) → ~7 d
    fx.rubros.find(r => r.id === 'zzz-rv2').total_produccion = 400;
    const t = await montar(fx), f = t.filas['zzz-pv'], e = esperado(fx, 'zzz-pv');
    igual(e.evm.cronogramaVencido, true, 'núcleo: cronograma vencido');
    igual(f.spi, '0.90', 'SPI'); igual(f.atraso, '~7d atraso', 'atraso (contando hasta hoy serían ~12 d)'); igual(f.atraso, e.atraso, 'coincide con el núcleo');
    // Un año después, lo mismo
    const t2 = await montar(fx, { ahora: Date.UTC(2027, 10, 21, 15, 0, 0) });
    igual(t2.filas['zzz-pv'].spi, '0.90', 'un año después: SPI'); igual(t2.filas['zzz-pv'].atraso, '~7d atraso', 'un año después: mismo atraso');
    t.cerrar(); t2.cerrar();
  });

  // ── Tope de filas de PostgREST ────────────────────────────────────────────
  // Proyecto grande: 1.500 rubros de 100 (los ids ordenan ANTES que los del resto de la cartera) y, para
  // sus 100 primeros rubros, 11 filas de cronograma por rubro (10 de líneas base viejas + la activa,
  // que es la última en leerse): un solo lote de 100 rubros trae 1.100 filas.
  const FIXTURE_GRANDE = () => {
    const fx = FIXTURE();
    fx.proyectos.push({ id: 'zzz-pg', nombre: 'ZZZ Grande', contratante: 'ZZZ Cliente', estado_cierre: 'en_ejecucion' });
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

  await prueba('tope de 1.000 filas de PostgREST superado (1.508 rubros, un lote de cronograma de 1.100): se lee todo y coincide con el núcleo', async () => {
    const fx = FIXTURE_GRANDE();
    igual(fx.rubros.length, 1508, 'rubros del fixture'); igual(fx.cronograma_rubros.length, 2507, 'filas de cronograma del fixture');
    // El cliente simulado corta de verdad: una lectura sin paginar se queda en 1.000 y no ve los rubros del resto
    const cortada = (await crearSb(fx, { maxFilas: 1000 }).from('rubros').select('id,proyecto_id').in('proyecto_id', fx.proyectos.map(p => p.id)).order('id')).data;
    igual(cortada.length, 1000, 'lectura sin paginar: 1.000 filas'); assert(cortada.every(r => r.proyecto_id === 'zzz-pg'), 'lectura sin paginar: solo rubros del proyecto grande');
    const t = await montar(fx, { maxFilas: 1000 });
    assert(!t.cont.querySelector('#carteraError'), 'sin error');
    igual(Object.keys(t.filas).sort().join(','), 'zzz-pa,zzz-pg,zzz-po,zzz-pr,zzz-pv', 'filas de la tabla');
    for(const pid of ['zzz-pg', 'zzz-pr', 'zzz-pa', 'zzz-pv', 'zzz-po']){
      const e = esperado(fx, pid), f = t.filas[pid];
      igual(f.emoji, e.emoji, pid + ': semáforo'); igual(f.avance, e.avance, pid + ': % real / plan'); igual(f.spi, e.spi, pid + ': SPI');
      igual(f.atraso, e.atraso, pid + ': atraso'); igual(f.spiTitulo, e.spiTitulo, pid + ': valor ganado');
    }
    // Proyecto grande: 150.000 de monto; 66,7 % ejecutado (con solo 1.000 rubros serían 100.000 y 50,0 %)
    const g = t.filas['zzz-pg'];
    igual(g.vigente, '$150.0K', 'monto vigente completo'); igual(g.avance, '66.7% / 100.0%', 'avance con los 1.500 rubros'); igual(g.spi, '0.66', 'SPI con los 1.500 rubros (0,6667 truncado)');
    igual(g.spiTitulo, 'Valor ganado 66,7 % sobre plan 100,0 % · solo rubros con cronograma', 'los 1.500 rubros tienen su fila de la línea base activa');
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
      assert(!/[🔴🟡🟢]/u.test(t.cont.textContent), tabla + ': sin semáforos');
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

  await prueba('leyenda de «SALUD DE LA CARTERA»: sale de NUCLEO_CARTERA e incluye el rojo por atraso', async () => {
    const t = await montar();
    const tarjeta = [...t.cont.querySelectorAll('.card')].find(c => /SALUD DE LA CARTERA/.test(c.textContent));
    const leyenda = tarjeta.lastElementChild.textContent;
    igual(leyenda, `Rojo: SPI < ${NUCLEO_CARTERA.SPI_ROJO.toFixed(2)}, garantía vencida o atraso > ${NUCLEO_CARTERA.ATRASO_ROJO_DIAS} días`, 'leyenda');
    igual(leyenda, 'Rojo: SPI < 0.85, garantía vencida o atraso > 30 días', 'leyenda con los umbrales vigentes');
    t.cerrar();
  });

  await prueba('resumen y orden: 🔴1 🟡1 🟢2, y la tabla va de rojo a verde', async () => {
    const t = await montar();
    assert(t.cont.textContent.includes('🔴1 🟡1 🟢2'), 'tarjeta «Salud de la cartera»');
    igual(t.orden[0], 'zzz-pr', 'primero el rojo'); igual(t.orden[1], 'zzz-pa', 'luego el amarillo');
    igual(t.orden.slice(2).sort().join(','), 'zzz-po,zzz-pv', 'al final los verdes');
    const colores = t.orden.map(pid => esperado(t.fx, pid).sem.color);
    igual(colores.join(','), 'rojo,amarillo,verde,verde', 'orden según el núcleo');
    t.cerrar();
  });

  await prueba('«hoy» es la fecha de Ecuador: a las 00:30 UTC del 22 todavía se calcula con el 21', async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="carteraContent"></div></body></html>', { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only' });
    const w = dom.window;
    w.Date.now = () => Date.UTC(2026, 10, 22, 0, 30, 0);
    w.sb = crearSb(FIXTURE()); w.console = console; w.eval(CODIGO);
    await w.cargarCartera();
    const tr = w.document.querySelector('tr[onclick^="irANotificacion(\'zzz-pr\'"]');
    assert(tr.textContent.includes('17.5% / 25.0%') && tr.textContent.includes('~20d atraso'), 'mismo plan y atraso que el 21 en Ecuador: ' + tr.textContent.replace(/\s+/g, ' ').slice(0, 120));
    w.close();
  });

  // ── Lectura del fuente ────────────────────────────────────────────────────
  const cuerpo = extraerFuncion(src, 'cargarCartera');
  // Sin comentarios de línea, para no tropezar con texto explicativo
  const codigoCartera = cuerpo.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

  await prueba('fuente: cargarCartera delega en el núcleo (EVM, garantías y semáforo)', () => {
    for(const f of ['nucleoEvmProyecto(', 'nucleoGarantias(', 'nucleoSemaforo(']) assert(codigoCartera.includes(f), 'llama a ' + f + ')');
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
    assert(!/86400000/.test(codigoCartera), 'sin aritmética de días');
    // («atraso>0» sí aparece: solo decide si se muestra el texto del atraso)
    assert(!/atraso\s*>\s*[1-9]/.test(codigoCartera)&& !/pendientes\s*>\s*\d/.test(codigoCartera), 'sin los cortes de atraso (30) ni de pendientes (5)');
    assert(!/hoyEcuador\(\s*5\s*\)/.test(codigoCartera) && !/vigencia_hasta\s*[<>]/.test(codigoCartera), 'sin la ventana de 5 días ni comparaciones de vigencia de garantías');
    assert(!/setLBs/.test(codigoCartera), 'sin el filtro viejo por líneas base activas de toda la cartera');
    assert(!/ejecutado\s*\/\s*d\.vigente/.test(codigoCartera), 'sin el avance real calculado a mano');
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
