// Reportes Globales: ejecuta la función REAL cargarReportesGlobales de index.html (con su barra de
// filtros) en jsdom. Cubre el fallo del 20-nov-2026: la barra de filtros usaba una variable local de
// otra función y la pantalla se quedaba en «Cargando reportes…». También la lectura paginada del libro
// de obra, las observaciones y las solicitudes (tope de 1.000 filas de PostgREST) y el aviso de error
// cuando una lectura falla.
//
//   node reportes-globales.test.js
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, leer, scriptPrincipal, extraerFuncion, extraerConst, crearSb, prueba, resumen, assert } = require('./lib/arnes');

const src = scriptPrincipal();
const CODIGO = [
  leer(path.join(RAIZ, 'constantes.js')), leer(path.join(RAIZ, 'expediente.js')),
  ...['reportesFiltroContratante', 'reportesFiltroDesde', 'reportesFiltroHasta', 'filtrosCartera', 'filtrosReportes'].map(c => extraerConst(src, c)),
  ...['cargarReportesGlobales', 'traerPaginado', 'renderFiltrosReportes', 'multiempresaActiva', 'filtrarPorEmpresaTipo', 'opcionesEmpresaTipo', 'barraFiltroEmpresaTipo'].map(f => extraerFuncion(src, f)),
  'window._filtrosReportes = filtrosReportes; window._fijarContratante = v => { reportesFiltroContratante = v; }; window._fijarFechas = (d, h) => { reportesFiltroDesde = d; reportesFiltroHasta = h; };'
].join('\n');

const EMPRESAS = [
  { id: 'e-a', nombre: 'Alfa', sigla: 'ALF', es_gestora: true, activa: true },
  { id: 'e-b', nombre: 'Beta', sigla: 'BET', es_gestora: true, activa: true }
];
const FIXTURE = () => ({
  proyectos: [
    { id: 'p1', nombre: 'Proyecto Uno', contratante: 'C1', empresa_id: 'e-a', tipo: 'fiscalizacion' },
    { id: 'p2', nombre: 'Proyecto Dos', contratante: 'C2', empresa_id: 'e-b', tipo: 'pilotes' }
  ],
  libro_obra: [
    { id: 'l1', proyecto_id: 'p1', fecha: '2026-10-01', numero_registro: 1, personal_total: 5 },
    { id: 'l2', proyecto_id: 'p2', fecha: '2026-10-02', numero_registro: 1, personal_total: 7 }
  ],
  observaciones: [{ id: 'o1', proyecto_id: 'p1', estado: 'abierta', created_at: '2026-10-01T10:00:00Z' }],
  solicitudes: [{ id: 's1', proyecto_id: 'p2', estado: 'pendiente', created_at: '2026-10-02T10:00:00Z' }]
});

// opciones.fixture: datos · opciones.maxFilas: tope de filas por lectura (max-rows de PostgREST) ·
// opciones.alterarSb(sb): para provocar fallos de lectura (entonces console.error se guarda, no se muestra).
function montar(empresas, opciones = {}){
  const dom = new JSDOM('<!doctype html><html><body><div id="reportesGlobalesContent"></div></body></html>', { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only' });
  const w = dom.window;
  const fx = opciones.fixture || FIXTURE();
  const sb = crearSb(fx, opciones.maxFilas ? { maxFilas: opciones.maxFilas } : {});
  if(opciones.alterarSb) opciones.alterarSb(sb);
  w.sb = sb;
  const erroresConsola = [];
  w.console = opciones.alterarSb ? { ...console, error: (...a) => erroresConsola.push(a) } : console;
  w.eval(CODIGO);
  w.fijarEmpresas(empresas);
  const cont = w.document.getElementById('reportesGlobalesContent');
  // Las cuatro métricas de arriba y los conteos de la tabla «Resumen por proyecto» (por nombre)
  const leerPantalla = () => ({
    metricas: [...cont.querySelectorAll('.metric-card')].map(m => m.querySelector('.metric-value').textContent.trim() + ' ' + m.querySelector('.metric-label').textContent.trim()),
    porProyecto: Object.fromEntries([...cont.querySelectorAll('tbody tr')].map(tr => { const td = [...tr.querySelectorAll('td')].map(c => c.textContent.trim()); return [td[0], td.slice(2).join('/')]; }))
  });
  return { w, cont, sb, fx, leerPantalla, erroresConsola, cerrar: () => w.close() };
}

function igual(real, esp, que){ assert(real === esp, `${que}: se esperaba ${JSON.stringify(esp)} y salió ${JSON.stringify(real)}`); }

// Consulta que falla como supabase-js: no lanza, resuelve { data: null, error }.
function consultaQueFalla(mensaje){
  const q = new Proxy({}, { get: (_, k) => k === 'then'
    ? (res, rej) => Promise.resolve({ data: null, error: { message: mensaje } }).then(res, rej)
    : () => q });
  return q;
}

// Cartera con más filas que el tope: 2.300 registros de libro (1.400 del proyecto uno y 900 del dos,
// intercalados y con muchas fechas repetidas), 1.250 observaciones y 1.100 solicitudes.
function FIXTURE_GRANDE(){
  const fx = FIXTURE();
  const n4 = i => String(i).padStart(4, '0');
  fx.libro_obra = []; fx.observaciones = []; fx.solicitudes = [];
  for(let i = 0; i < 2300; i++){
    const dia = String(1 + (i % 28)).padStart(2, '0'), mes = String(1 + (i % 10)).padStart(2, '0');
    fx.libro_obra.push({ id: 'zzz-l' + n4(i), proyecto_id: i % 23 < 14 ? 'p1' : 'p2', fecha: `2026-${mes}-${dia}`, actividades_ejecutadas: 'ZZZ', clima_diurno: 'sol', clima_nocturno: 'sol' });
  }
  for(let i = 0; i < 1250; i++) fx.observaciones.push({ id: 'zzz-o' + n4(i), proyecto_id: i < 1000 ? 'p1' : 'p2', numero: i, titulo: 'ZZZ', estado: i >= 1000 ? 'abierta' : 'cerrada', created_at: '2026-10-01T10:00:00Z' });
  for(let i = 0; i < 1100; i++) fx.solicitudes.push({ id: 'zzz-s' + n4(i), proyecto_id: i < 1000 ? 'p1' : 'p2', numero: i, titulo: 'ZZZ', tipo: 'rfi', estado: i >= 1000 ? 'pendiente' : 'aprobada', created_at: '2026-10-02T10:00:00Z' });
  return fx;
}

(async () => {
  console.log('reportes-globales.test.js');

  await prueba('con multiempresa: la pantalla se pinta, con los selects de empresa y tipo', async () => {
    const t = montar(EMPRESAS);
    await t.w.cargarReportesGlobales();
    const html = t.cont.innerHTML;
    assert(!/Cargando reportes/.test(html), 'no se queda en «Cargando reportes…»');
    assert(t.cont.querySelector('#reportesContratanteSel'), 'pinta el filtro de contratante');
    assert(html.includes('filtrosReportes.empresa=this.value;cargarReportesGlobales()') && />Alfa</.test(html) && />Beta</.test(html), 'select de empresa con las dos gestoras');
    assert(html.includes('filtrosReportes.tipo=this.value;cargarReportesGlobales()') && />Pilotes</.test(html), 'select de tipo');
    t.cerrar();
  });

  await prueba('filtrar por empresa y por tipo vuelve a pintar sin error y ofrece «Limpiar filtros»', async () => {
    const t = montar(EMPRESAS);
    t.w._filtrosReportes.empresa = 'e-b';
    await t.w.cargarReportesGlobales();
    assert(!/Cargando reportes/.test(t.cont.innerHTML) && /Limpiar filtros/.test(t.cont.innerHTML), 'pinta con el filtro de empresa');
    assert(/<option value="e-b" selected/.test(t.cont.innerHTML), 'el select conserva la empresa elegida');
    t.w._filtrosReportes.tipo = 'fiscalizacion';   // ningún proyecto de Beta es de fiscalización
    await t.w.cargarReportesGlobales();
    assert(!/Cargando reportes/.test(t.cont.innerHTML) && t.cont.querySelector('#reportesContratanteSel'), 'sin proyectos que coincidan también pinta la barra');
    t.cerrar();
  });

  await prueba('base sin migrar (empresas sin sigla): pinta igual que antes, sin selects de empresa ni tipo', async () => {
    const t = montar([{ id: 'e-v', nombre: 'Vieja' }]);
    await t.w.cargarReportesGlobales();
    const html = t.cont.innerHTML;
    assert(!/Cargando reportes/.test(html) && t.cont.querySelector('#reportesContratanteSel'), 'pinta la pantalla');
    assert(!html.includes('filtrosReportes.empresa') && !html.includes('undefined'), 'sin barra de empresa/tipo y sin «undefined»');
    t.w._fijarContratante('C1');
    await t.w.cargarReportesGlobales();
    assert(/Limpiar filtros/.test(t.cont.innerHTML), 'el filtro de contratante sigue funcionando');
    t.cerrar();
  });

  await prueba('renderFiltrosReportes no depende de variables de otra función', () => {
    const cuerpo = extraerFuncion(src, 'renderFiltrosReportes');
    assert(!/barraEmpresaTipoRep/.test(cuerpo), 'usa su parámetro, no la constante local de cargarReportesGlobales');
  });

  // ── Tope de filas de PostgREST ────────────────────────────────────────────
  await prueba('más filas que el tope (2.300 de libro, 1.250 observaciones, 1.100 solicitudes con máximo 1.000 por lectura): no se pierde ninguna', async () => {
    const fx = FIXTURE_GRANDE();
    // El cliente simulado corta de verdad: una lectura sin paginar se queda en 1.000
    igual((await crearSb(fx, { maxFilas: 1000 }).from('libro_obra').select('id').in('proyecto_id', ['p1', 'p2'])).data.length, 1000, 'lectura sin paginar');
    const t = montar(EMPRESAS, { fixture: fx, maxFilas: 1000 });
    await t.w.cargarReportesGlobales();
    assert(!t.cont.querySelector('#reportesError'), 'sin error');
    const r = t.leerPantalla();
    igual(r.metricas[0], '2300 Registros Libro de Obra', 'libro de obra completo (cortado serían 1.000)');
    igual(r.metricas[1], '1250 Observaciones (250 abiertas)', 'observaciones completas: las abiertas estaban todas después de la fila 1.000');
    igual(r.metricas[2], '1100 Solicitudes (100 pendientes)', 'solicitudes completas: las pendientes estaban después de la fila 1.000');
    igual(r.porProyecto['Proyecto Uno'], '1400/1000/1000', 'conteos del proyecto uno (libro/observaciones/solicitudes)');
    igual(r.porProyecto['Proyecto Dos'], '900/250/100', 'conteos del proyecto dos');
    igual(fx.libro_obra.filter(l => l.proyecto_id === 'p1').length, 1400, 'el fixture tiene 1.400 del proyecto uno');
    // Se ve en las consultas: tres páginas de libro, dos de observaciones y dos de solicitudes, todas con .range()
    const paginas = tabla => t.sb.llamadas.filter(l => l.tabla === tabla).map(l => l.rango && l.rango.join('-')).join(' ');
    igual(paginas('libro_obra'), '0-999 1000-1999 2000-2999', 'páginas de libro_obra');
    igual(paginas('observaciones'), '0-999 1000-1999', 'páginas de observaciones');
    igual(paginas('solicitudes'), '0-999 1000-1999', 'páginas de solicitudes');
    t.cerrar();
  });

  await prueba('paginado con los filtros de siempre: fechas, contratante y empresa siguen acotando la lectura', async () => {
    const fx = FIXTURE_GRANDE();
    const dentro = l => l.fecha >= '2026-03-01' && l.fecha <= '2026-08-31';
    const t = montar(EMPRESAS, { fixture: fx, maxFilas: 1000 });
    t.w._fijarFechas('2026-03-01', '2026-08-31');
    await t.w.cargarReportesGlobales();
    let r = t.leerPantalla();
    const esperadas = fx.libro_obra.filter(dentro).length;
    assert(esperadas > 1000 && esperadas < 2300, 'el rango de fechas deja más de 1.000 y menos del total (' + esperadas + ')');
    igual(r.metricas[0], esperadas + ' Registros Libro de Obra', 'libro filtrado por fecha, completo');
    igual(r.porProyecto['Proyecto Uno'].split('/')[0], String(fx.libro_obra.filter(l => dentro(l) && l.proyecto_id === 'p1').length), 'proyecto uno en el rango');
    igual(r.metricas[1], '0 Observaciones (0 abiertas)', 'las observaciones de octubre quedan fuera del rango');
    // Un día concreto: el límite «hasta» incluye todo ese día en las tablas con marca de tiempo
    t.w._fijarFechas('2026-10-01', '2026-10-01');
    await t.w.cargarReportesGlobales();
    r = t.leerPantalla();
    igual(r.metricas[1], '1250 Observaciones (250 abiertas)', 'observaciones del 1-oct (creadas a las 10:00)');
    igual(r.metricas[2], '0 Solicitudes (0 pendientes)', 'las solicitudes son del 2-oct');
    // Contratante C2 = solo el proyecto dos
    t.w._fijarFechas('', ''); t.w._fijarContratante('C2');
    await t.w.cargarReportesGlobales();
    r = t.leerPantalla();
    igual(r.metricas[0], '900 Registros Libro de Obra', 'solo el libro del proyecto dos');
    igual(Object.keys(r.porProyecto).join(','), 'Proyecto Dos', 'solo el proyecto dos en la tabla');
    // Empresa e-a = solo el proyecto uno
    t.w._fijarContratante(''); t.w._filtrosReportes.empresa = 'e-a';
    await t.w.cargarReportesGlobales();
    igual(t.leerPantalla().metricas[0], '1400 Registros Libro de Obra', 'solo el libro del proyecto uno');
    t.cerrar();
  });

  await prueba('el orden entre páginas es estable: ninguna fila repetida ni perdida aunque todas las fechas coincidan', async () => {
    const fx = FIXTURE_GRANDE();
    fx.libro_obra.forEach(l => { l.fecha = '2026-10-01'; });      // el orden por fecha no desempata nada
    const t = montar(EMPRESAS, { fixture: fx, maxFilas: 1000 });
    const leidas = [];
    const from = t.sb.from;
    t.sb.from = tabla => {
      const q = from(tabla);
      if(tabla !== 'libro_obra') return q;
      const ejecutar = q._ejecutar;
      q._ejecutar = () => { const res = ejecutar(); leidas.push(...(res.data || []).map(f => f.id)); return res; };
      return q;
    };
    await t.w.cargarReportesGlobales();
    igual(leidas.length, 2300, 'filas recibidas en total'); igual(new Set(leidas).size, 2300, 'todas distintas');
    const compacto = extraerFuncion(src, 'cargarReportesGlobales').replace(/\s+/g, '');
    assert(compacto.includes(".order('fecha',{ascending:false}).order('id')"), 'libro_obra ordenado por fecha e id');
    igual(compacto.split(".order('created_at',{ascending:false}).order('id')").length - 1, 2, 'observaciones y solicitudes por creación e id');
    t.cerrar();
  });

  await prueba('si una lectura falla se muestra un error (con «Reintentar»), no un reporte incompleto', async () => {
    for(const tabla of ['proyectos', 'libro_obra', 'observaciones', 'solicitudes']){
      const t = montar(EMPRESAS, { fixture: FIXTURE_GRANDE(), maxFilas: 1000, alterarSb: sb => { const from = sb.from; sb.from = x => x === tabla ? consultaQueFalla('ZZZ fallo de ' + tabla) : from(x); } });
      await t.w.cargarReportesGlobales();
      const caja = t.cont.querySelector('#reportesError');
      assert(caja, tabla + ': se muestra la caja de error');
      assert(/No se pudieron leer los reportes/.test(caja.textContent) && caja.textContent.includes('ZZZ fallo de ' + tabla), tabla + ': el mensaje dice qué falló');
      assert(caja.querySelector('button[onclick="cargarReportesGlobales()"]'), tabla + ': botón para reintentar');
      igual(t.cont.querySelectorAll('.metric-card').length, 0, tabla + ': sin métricas');
      assert(!/Resumen por proyecto|Cargando reportes/.test(t.cont.textContent), tabla + ': sin tabla de conteos y sin quedarse en «Cargando…»');
      igual(t.erroresConsola.length, 1, tabla + ': el error queda en la consola');
      t.cerrar();
    }
  });

  await prueba('error en la SEGUNDA página del libro de obra: tampoco se pinta el reporte con las 1.000 primeras', async () => {
    const t = montar(EMPRESAS, { fixture: FIXTURE_GRANDE(), maxFilas: 1000, alterarSb: sb => {
      const from = sb.from;
      sb.from = tabla => {
        const q = from(tabla);
        if(tabla !== 'libro_obra') return q;
        const range = q.range;
        q.range = (a, z) => a >= 1000 ? consultaQueFalla('ZZZ corte de red en la página 2') : range(a, z);
        return q;
      };
    } });
    await t.w.cargarReportesGlobales();
    const caja = t.cont.querySelector('#reportesError');
    assert(caja && caja.textContent.includes('ZZZ corte de red en la página 2'), 'se muestra el error de la segunda página');
    igual(t.cont.querySelectorAll('.metric-card').length, 0, 'sin métricas parciales');
    t.cerrar();
  });

  await prueba('fuente: las tres lecturas van por traerPaginado en modo estricto y ya no hay respuestas { data } sin comprobar', () => {
    const cuerpo = extraerFuncion(src, 'cargarReportesGlobales').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    igual(cuerpo.split('traerPaginado(').length - 1, 3, 'tres usos de traerPaginado');
    igual((cuerpo.match(/,\s*1000,\s*true\)/g) || []).length, 3, 'los tres en modo estricto');
    for(const tabla of ['libro_obra', 'observaciones', 'solicitudes']) assert(cuerpo.includes("traerPaginado(()=> entreFechas(sb.from('" + tabla + "')"), tabla + ' se lee dentro de traerPaginado');
    assert(!/\{data:(libro|obs|sols)\}/.test(cuerpo) && !/qLibro|qObs|qSol/.test(cuerpo), 'sin las consultas directas de antes');
    assert(/reportesError/.test(cuerpo) && /catch\(e\)/.test(cuerpo), 'un fallo acaba en el mensaje de error');
  });

  resumen();
})();
