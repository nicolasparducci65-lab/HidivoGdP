// Tomos: unidades de empaquetado, algoritmo (todo cabe, unidad enorme sola,
// varios tomos, determinista, tolerancia), plan guardado, conteos rápidos,
// documento por tomo (portadas, índice general, encabezado, nombre de archivo).
'use strict';
const path = require('path');
const { RAIZ, crearSb, crearContexto, cargarFixture, prueba, resumen, assert } = require('./lib/arnes');

const codigo = [{ ruta: path.join(RAIZ, 'constantes.js'), nombre: 'constantes.js' }, { ruta: path.join(RAIZ, 'expediente.js'), nombre: 'expediente.js' }];
const META = { version: 4, generadoEn: '2026-10-14T15:05:00Z', generadoPor: 'Prueba Admin', rol: 'admin', hoy: '2026-10-14', logoDataUri: 'data:image/png;base64,iVBORw0KGgo=' };
const TODAS = ['portada', 'indice', 'contrato', 'presupuesto', 'ordenes_cambio', 'cronograma', 'libro_obra', 'planillas', 'ensayos', 'formatos_calidad', 'observaciones', 'sst', 'subcontratistas', 'actas', 'liquidacion'];
const FILTROS = { incluirOCsNoAprobadas: true, detallePlanillas: true, libroDesde: null, libroHasta: null, observaciones: 'todas', calidadFotos: 'estandar' };
const SEL = { preset: 'completo', secciones: TODAS, filtros: FILTROS };
const ctx = () => crearContexto({ codigo });
const clonar = o => JSON.parse(JSON.stringify(o));
const u = (clave, fotos, paginas, extra = {}) => ({ clave, seccion: clave.split(':')[0], etiqueta: clave, fotos, paginas, ...extra });

(async () => {
  console.log('tomos.test.js');
  const fx = cargarFixture('sintetico.json');

  await prueba('empaquetado: todo cabe en un tomo', () => {
    const c = ctx();
    const t = c.expedienteEmpaquetarTomos([u('contrato', 0, 2), u('libro_obra:2026-02', 120, 30), u('libro_obra:2026-03', 100, 25), u('actas', 0, 2)]);
    assert(t.length === 1 && t[0].unidades.length === 4 && t[0].fotos === 220 && t[0].paginas === 59, JSON.stringify(t));
    assert(c.expedienteEmpaquetarTomos([]).length === 1 && c.expedienteEmpaquetarTomos([])[0].unidades.length === 0, 'sin unidades: un tomo vacío');
  });

  await prueba('empaquetado: una unidad que excede el umbral va sola; las demás se reparten en orden', () => {
    const c = ctx();
    const t = c.expedienteEmpaquetarTomos([u('contrato', 0, 2), u('libro_obra:2026-02', 900, 160), u('libro_obra:2026-03', 50, 10), u('planillas', 0, 5)]);
    assert(t.length === 3, 'tres tomos: ' + JSON.stringify(t.map(x => x.unidades)));
    assert(t[0].unidades.join() === 'contrato' && t[1].unidades.join() === 'libro_obra:2026-02' && t[2].unidades.join() === 'libro_obra:2026-03,planillas', 'reparto');
    assert(t[1].fotos === 900 && t[1].paginas === 160, 'el enorme conserva sus cifras');
  });

  await prueba('empaquetado: varios tomos por fotos y por páginas; tolerancia del 10 % evita un tomo por una unidad mínima; determinista', () => {
    const c = ctx();
    const lote = [u('a', 390, 50), u('b', 30, 5), u('c', 300, 40), u('d', 200, 20), u('e', 0, 120), u('f', 0, 40), u('g', 0, 5)];
    const t = c.expedienteEmpaquetarTomos(lote);
    // a+b = 420 fotos ≤ 440 (tolerancia 10 %) → juntos; c+d = 500 > 440 → c solo; d+e = 140 páginas;
    // d+e+f = 180 > 165 → e cierra el tomo; f+g.
    assert(t.map(x => x.unidades.join('+')).join(' | ') === 'a+b | c | d+e | f+g', 'reparto: ' + t.map(x => x.unidades.join('+')).join(' | '));
    assert(JSON.stringify(c.expedienteEmpaquetarTomos(lote)) === JSON.stringify(t), 'determinista');
    const estricto = c.expedienteEmpaquetarTomos(lote, { tolerancia: 0 });
    assert(estricto[0].unidades.join('+') === 'a' && estricto[1].unidades.join('+') === 'b+c', 'sin tolerancia a va sola');
    const bajo = c.expedienteEmpaquetarTomos(lote, { maxFotos: 100 });
    assert(bajo.length === 5 && bajo[0].unidades.join() === 'a', 'umbral bajo (override): ' + bajo.length);
  });

  await prueba('unidades desde los datos: libro por mes, observaciones juntas (o por mes si exceden), fórmula de páginas', async () => {
    const c = ctx();
    const datos = await c.expedienteCargarDatos(fx.proyectos[0].id, SEL, crearSb(fx));
    const r = c.expedienteResumenDeDatos(datos, SEL);
    assert(JSON.stringify(r.libroMeses) === JSON.stringify({ '2026-02': { registros: 2, fotos: 3 }, '2026-03': { registros: 1, fotos: 1 } }), 'meses del libro: ' + JSON.stringify(r.libroMeses));
    assert(r.obsMeses['2026-02'].n === 1 && r.obsMeses['2026-02'].fotos === 2 && r.obsMeses['2026-02'].respuestas === 2 && r.obsMeses['2026-03'].n === 1, 'meses de observaciones (foto + respuesta con foto)');
    const un = c.expedienteUnidades(r, SEL);
    const claves = un.map(x => x.clave);
    assert(claves.join() === 'contrato,presupuesto,ordenes_cambio,cronograma,libro_obra:2026-02,libro_obra:2026-03,planillas,ensayos,formatos_calidad,observaciones,sst,subcontratistas,actas,liquidacion', 'orden del índice: ' + claves.join());
    const por = {}; un.forEach(x => { por[x.clave] = x; });
    assert(por['libro_obra:2026-02'].fotos === 3 && por['libro_obra:2026-02'].paginas === Math.ceil(0.6 * 2 + 3 / 6) && por['libro_obra:2026-02'].etiqueta === 'Libro de obra — Febrero 2026', 'unidad de mes');
    assert(por.observaciones.fotos === 3 && por.ordenes_cambio.paginas === 4 && por.planillas.paginas === 5 && por.presupuesto.paginas === 1 && por.sst.fotos === 1, 'páginas por unidad');
    // Observaciones por mes cuando exceden solas
    const r2 = clonar(r); r2.obsMeses = { '2026-02': { n: 100, fotos: 300, respuestas: 50 }, '2026-03': { n: 80, fotos: 250, respuestas: 10 } };
    const un2 = c.expedienteUnidades(r2, SEL);
    assert(un2.some(x => x.clave === 'observaciones:2026-02') && un2.some(x => x.clave === 'observaciones:2026-03') && !un2.some(x => x.clave === 'observaciones'), 'observaciones partidas por mes');
    const est = c.expedienteEstimar(datos, SEL);
    assert(est.tomos.length === 1 && est.fotos === 8 && est.paginas === un.reduce((s, x) => s + x.paginas, 0) + 2 && est.unidades.length === 14, 'estimación: ' + JSON.stringify({ tomos: est.tomos.length, fotos: est.fotos, paginas: est.paginas }));
    const forzado = c.expedienteEstimar(datos, SEL, { maxFotos: 2 });
    assert(forzado.tomos.length >= 3 && forzado.paginas === est.paginas - 2 + 2 * forzado.tomos.length, 'umbral bajo: más tomos y 2 páginas por tomo');
  });

  await prueba('plan guardado en filtros.tomos se respeta si las unidades coinciden; si no, se reempaqueta', () => {
    const c = ctx();
    const un = [u('contrato', 0, 2), u('libro_obra:2026-02', 10, 3), u('actas', 0, 2)];
    const plan = [['contrato'], ['libro_obra:2026-02', 'actas']];
    const t = c.expedientePlanTomos(un, { filtros: { tomos: plan } });
    assert(t.length === 2 && t[0].unidades.join() === 'contrato' && t[1].fotos === 10 && t[1].paginas === 5, 'plan guardado reproducido');
    const t2 = c.expedientePlanTomos(un, { filtros: { tomos: [['contrato'], ['actas']] } });
    assert(t2.length === 1, 'plan que no coincide: reempaqueta');
  });

  await prueba('conteos rápidos (count head:true y consultas ligeras) dan el mismo resumen que los datos', async () => {
    const c = ctx();
    const sb = crearSb(fx);
    const conteos = await c.expedienteContar(fx.proyectos[0].id, SEL, sb);
    const datos = await c.expedienteCargarDatos(fx.proyectos[0].id, SEL, crearSb(fx));
    const r = c.expedienteResumenDeDatos(datos, SEL);
    for(const k of ['rubros', 'ocs', 'planillas', 'libroMeses', 'obsMeses', 'ensayos', 'formatos', 'subcontratos', 'actas', 'liquidacion', 'cronogramaRubros']){
      assert(JSON.stringify(conteos[k]) === JSON.stringify(r[k]), k + ': conteos ' + JSON.stringify(conteos[k]) + ' vs datos ' + JSON.stringify(r[k]));
    }
    assert(conteos.sst.capacitaciones === r.sst.capacitaciones && conteos.sst.fotos === r.sst.fotos, 'sst');
    assert(conteos.fotosTotales === 8 && conteos.imagenesOrigen === 8, 'fotos totales (4 libro incl. HEIC + 2 obs + 1 respuesta + 1 EPP): ' + conteos.fotosTotales);
    const e1 = c.expedienteEstimarResumen(conteos, SEL), e2 = c.expedienteEstimar(datos, SEL);
    assert(e1.paginas === e2.paginas && e1.tomos.length === e2.tomos.length && e1.fotos === e2.fotos, 'misma estimación por conteos y por datos');
    assert(sb.llamadas.some(l => l.tabla === 'rubros') && !sb.llamadas.some(l => l.tabla === 'libro_obra' && l.select === '*'), 'el libro se cuenta con una consulta ligera, no con select *');
    const parcial = await c.expedienteContar(fx.proyectos[0].id, { secciones: ['contrato'], filtros: FILTROS }, crearSb(fx));
    assert(parcial.rubros === 0 && Object.keys(parcial.libroMeses).length === 0 && parcial.fotosTotales === 0, 'solo cuenta lo seleccionado');
  });

  await prueba('documento por tomo: tomo 1 con ficha e índice general por tomos; tomo k con su contenido, encabezado y nombre', async () => {
    const c = ctx();
    const datos = await c.expedienteCargarDatos(fx.proyectos[0].id, SEL, crearSb(fx));
    const est = c.expedienteEstimar(datos, SEL, { maxFotos: 3, maxPaginas: 12 });
    const plan = est.tomos.map(t => t.unidades);
    assert(plan.length >= 3, 'plan de prueba con varios tomos: ' + plan.length);
    const docs = plan.map((unidades, i) => {
      const meta = { ...META, tomo: { k: i + 1, de: plan.length, unidades, plan } };
      meta.nombreArchivo = c.expedienteNombreArchivo(datos.proyecto, META.version, META.hoy, meta.tomo);
      return { meta, html: c.expedienteGenerarHTML(datos, SEL, meta) };
    });
    const t1 = docs[0].html;
    assert(t1.includes('<div class="portada-tomo">Tomo 1 de ' + plan.length + '</div>') && t1.includes('Ficha del proyecto') && t1.includes('Contenido por tomo') && t1.includes('<b>Tomo 2 de ' + plan.length + '</b>'), 'tomo 1: portada, ficha e índice general');
    assert(docs[0].meta.nombreArchivo === `Expediente_Puente-peatonal-Las-Palmas_v4_T1de${plan.length}_2026-10-14` && t1.includes('<title>' + docs[0].meta.nombreArchivo + '</title>'), 'nombre del tomo 1: ' + docs[0].meta.nombreArchivo);
    assert(t1.includes(`Expediente v4 · Tomo 1/${plan.length}</span>`) && t1.includes(`Expediente v4 · Tomo 1 de ${plan.length} · HidivoGdP`), 'encabezado y pie con el tomo');
    const ultimo = docs[docs.length - 1].html;
    assert(ultimo.includes(`Tomo ${plan.length} de ${plan.length}`) && !ultimo.includes('Ficha del proyecto') && ultimo.includes('índice general de todos los tomos está en el tomo 1') && ultimo.includes(`Índice del tomo ${plan.length}`), 'último tomo: sin ficha, índice propio');
    // Cada sección aparece en exactamente un tomo; libro y observaciones llevan su cabecera
    // (con la nota «En este tomo: …») en cada tomo que contenga alguno de sus meses.
    const todasSecs = TODAS.filter(k => !['portada', 'indice', 'libro_obra', 'observaciones'].includes(k));
    for(const sec of todasSecs){
      const n = docs.filter(d => d.html.includes(`id="sec-${sec}"`)).length;
      assert(n === 1, `la sección ${sec} aparece en ${n} tomos`);
    }
    const conLibro = docs.filter(d => d.html.includes('id="sec-libro_obra"'));
    assert(conLibro.length >= 1 && conLibro.every(d => d.html.includes('En este tomo:')), 'cabecera del libro con la nota del tomo');
    for(const m of ['2026-02', '2026-03']){
      const n = docs.filter(d => d.html.includes(`id="libro-${m}"`)).length;
      assert(n === 1, `el mes ${m} del libro aparece en ${n} tomos`);
    }
    const tomoLibro = docs.find(d => d.html.includes('id="libro-2026-02"'));
    assert(tomoLibro.meta.tomo.unidades.includes('libro_obra:2026-02'), 'el mes va en el tomo de su unidad');
    assert(docs.every(d => !/\b(undefined|NaN|null)\b/.test(d.html)), 'sin basura en ningún tomo');
    // Numeración global: el número de sección coincide con el índice general
    const numActas = TODAS.indexOf('actas') + 1;
    assert(docs.some(d => d.html.includes(`${numActas}. Actas de recepción`)), 'numeración global de secciones');
    // Un solo tomo: sin sufijo ni línea de tomo
    const uno = c.expedienteGenerarHTML(datos, SEL, { ...META, tomo: { k: 1, de: 1, unidades: plan.flat(), plan: [plan.flat()] } });
    assert(!uno.includes('<div class="portada-tomo">') && !uno.includes('Tomo 1/1') && c.expedienteNombreArchivo(datos.proyecto, 4, '2026-10-14', { k: 1, de: 1 }) === 'Expediente_Puente-peatonal-Las-Palmas_v4_2026-10-14', 'un solo tomo = documento normal');
  });

  await prueba('observaciones partidas por mes se reparten entre tomos sin perder ninguna', async () => {
    const c = ctx();
    const f2 = clonar(fx);
    // 30 observaciones en dos meses con muchas fotos ficticias para forzar la partición
    f2.observaciones = []; f2.observacion_fotos = []; f2.observacion_respuestas = [];
    for(let i = 0; i < 30; i++){
      const id = 'ob' + String(i).padStart(34, '0');
      f2.observaciones.push({ id, proyecto_id: f2.proyectos[0].id, plano_id: null, titulo: 'Obs ' + i, descripcion: null, estado: 'abierta', pin_x: null, pin_y: null, pin_pagina: null, creado_por: null, created_at: (i < 15 ? '2026-02-' : '2026-03-') + String(1 + (i % 15)).padStart(2, '0') + 'T10:00:00+00:00', numero: i + 1 });
      for(let j = 0; j < 20; j++) f2.observacion_fotos.push({ id: id + '-' + j, observacion_id: id, url: 'data:image/png;base64,AAAA', created_at: '2026-02-01T00:00:00+00:00' });
    }
    const sel = { secciones: ['observaciones'], filtros: FILTROS };
    const datos = await c.expedienteCargarDatos(f2.proyectos[0].id, sel, crearSb(f2));
    const est = c.expedienteEstimar(datos, sel);
    assert(est.unidades.map(x => x.clave).join() === 'observaciones:2026-02,observaciones:2026-03' && est.tomos.length === 2, 'dos unidades mensuales en dos tomos: ' + JSON.stringify(est.tomos.map(t => t.unidades)));
    const plan = est.tomos.map(t => t.unidades);
    const h1 = c.expedienteGenerarHTML(datos, sel, { ...META, tomo: { k: 1, de: 2, unidades: plan[0], plan } });
    const h2 = c.expedienteGenerarHTML(datos, sel, { ...META, tomo: { k: 2, de: 2, unidades: plan[1], plan } });
    const n1 = (h1.match(/id="obs-ob/g) || []).length, n2 = (h2.match(/id="obs-ob/g) || []).length;
    assert(n1 === 15 && n2 === 15, `15 + 15 observaciones: ${n1} + ${n2}`);
    assert(h2.includes('3.16. Observación N° 16'), 'numeración global de subsecciones en el tomo 2');
  });

  resumen();
})();
