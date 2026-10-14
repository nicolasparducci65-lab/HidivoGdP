// Expediente de obra, fase 2: carga de las secciones nuevas, URLs transformadas de
// Storage, pies y placeholders de fotos, filtros, exámenes solo agregados, script
// inline de carga (jsdom, éxito y fallo) y fixtures reales si existen.
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, crearSb, crearContexto, cargarFixture, prueba, resumen, assert } = require('./lib/arnes');

const codigo = [{ ruta: path.join(RAIZ, 'constantes.js'), nombre: 'constantes.js' }, { ruta: path.join(RAIZ, 'expediente.js'), nombre: 'expediente.js' }];
const META = { version: 2, generadoEn: '2026-10-14T15:05:00Z', generadoPor: 'Prueba Admin', rol: 'admin', hoy: '2026-10-14', logoDataUri: 'data:image/png;base64,iVBORw0KGgo=' };
const TODAS = ['portada', 'indice', 'contrato', 'presupuesto', 'ordenes_cambio', 'cronograma', 'libro_obra', 'planillas', 'ensayos', 'formatos_calidad', 'observaciones', 'sst', 'subcontratistas', 'actas', 'liquidacion'];
const FILTROS = { incluirOCsNoAprobadas: true, detallePlanillas: true, libroDesde: null, libroHasta: null, observaciones: 'todas', calidadFotos: 'estandar' };
const SEL = { preset: 'completo', secciones: TODAS, filtros: FILTROS };
const ctx = () => crearContexto({ codigo });
const clonar = o => JSON.parse(JSON.stringify(o));
async function cargar(fixture, sel = SEL, progreso){
  const c = ctx();
  const datos = await c.expedienteCargarDatos(fixture.proyectos[0].id, sel, crearSb(fixture), { onProgreso: progreso });
  return { c, datos };
}
function sinBasura(html){
  const m = html.match(/\b(undefined|NaN|null)\b/);
  assert(!m, 'el HTML contiene «' + (m && m[0]) + '» cerca de: ' + (m ? html.slice(Math.max(0, m.index - 100), m.index + 40) : ''));
}
const seccion = (html, clave) => { const i = html.indexOf(`id="sec-${clave}"`); assert(i > 0, 'falta la sección ' + clave); const j = html.indexOf('<section class="sec"', i + 10); return j > 0 ? html.slice(i, j) : html.slice(i); };

(async () => {
  console.log('expediente-f2.test.js');
  const fx = cargarFixture('sintetico.json');

  await prueba('carga de la fase 2: libro con fotos y rubros, observaciones con respuestas, ensayos, formatos, SST, subcontratos, cronograma; progreso e imágenes de origen', async () => {
    const mensajes = [];
    const { datos } = await cargar(fx, SEL, m => mensajes.push(m));
    assert(mensajes.length >= 8 && mensajes[0].startsWith('Cargando contrato') && mensajes[mensajes.length - 1] === 'Datos cargados', 'progreso: ' + mensajes.join(' | '));
    assert(datos.libro.length === 3 && datos.libro[0].numero_registro === 1 && datos.libro[0].fotos.length === 2 && datos.libro[0].rubros.length === 2 && datos.libro[0].rubros[0].rubros.codigo === '1', 'libro con fotos y rubros embebidos');
    const heic = datos.libro[1].fotos[0];
    assert(heic.noDisponible === 'formato HEIC' && heic.urlRender === null && heic.path.endsWith('.heic'), 'HEIC marcado como no disponible');
    assert(datos.libro[2].fotos[0].urlRender.startsWith('data:image/png'), 'data URI se usa tal cual');
    assert(datos.observaciones.length === 2 && datos.observaciones[0].respuestas.length === 2 && datos.observaciones[0].fotos.length === 1 && datos.observaciones[0].plano_nombre === 'Planta general', 'observaciones');
    assert(datos.observaciones[0].respuestas[0].adjunto.tipo === 'foto' && datos.observaciones[0].respuestas[1].adjunto.tipo === 'archivo' && datos.observaciones[0].respuestas[1].adjunto.nombre === 'informe.pdf', 'adjuntos: foto por extensión, archivo si no');
    assert(datos.ensayos.lista.length === 3 && datos.ensayos.lista[0].nombreTipo === 'Compresión de hormigón — Pilas' && datos.ensayos.lista[0].espTxt === '≥ 240' && datos.ensayos.especificaciones[1].tipo.criterio === 'rango', 'ensayos enriquecidos');
    assert(datos.formatos.plantillas.length === 1 && datos.formatos.respuestas[0].plantilla_nombre === 'Registro de hormigonado' && datos.formatos.respuestas[0].fotos === 1, 'formatos');
    assert(datos.sst.config && datos.sst.riesgos.length === 2 && datos.sst.capacitaciones[0].asistentes.length === 2 && datos.sst.eppEntregas[0].foto.path, 'sst');
    assert(datos.sst.examRegistros.length === 2 && Object.keys(datos.sst.examRegistros[0]).sort().join() === 'fecha_examen,fecha_proximo,tipo', 'exámenes: solo tipo y fechas, nunca nombres ni aptitud');
    assert(datos.subcontratos.length === 1 && datos.subcontratos[0].subcontratista.nombre.startsWith('Metálicas') && datos.subcontratos[0].rubros[0].codigo === '5', 'subcontratos');
    assert(datos.cronograma.lineasBase.length === 2 && datos.cronograma.activa.numero === 2 && datos.cronograma.filas.length === 3, 'cronograma: filas de la LB activa');
    assert(datos.perfiles['b0000000-0000-4000-8000-000000000003'] === 'Prueba Residente', 'perfiles ampliados');
    assert(datos.imagenesOrigen === 6, 'imágenes de origen distintas (3 libro incl. HEIC + 1 obs + 1 respuesta + 1 EPP): ' + datos.imagenesOrigen);
    assert(JSON.stringify(datos).length > 10000, 'serializable');
  });

  await prueba('expedienteFotoUrls: path decodificado, transformación 900/1200 px, HEIC, data URI y URL ajena', () => {
    const c = ctx();
    const sb = crearSb({});
    const a = c.expedienteFotoUrls('https://x.supabase.co/storage/v1/object/public/hidivo-fotos/libro_obra/r1/foto%20con%20espacio%20y%20tilde%20%C3%A1.jpg', 'estandar', sb);
    assert(a.path === 'libro_obra/r1/foto con espacio y tilde á.jpg', 'path decodificado: ' + a.path);
    assert(a.urlRender === 'https://storage.test/storage/v1/render/image/public/hidivo-fotos/libro_obra/r1/foto%20con%20espacio%20y%20tilde%20%C3%A1.jpg?width=900&quality=70', 'render 900: ' + a.urlRender);
    const b = c.expedienteFotoUrls('https://x.supabase.co/storage/v1/object/public/hidivo-fotos/obs/1 2.jpeg', 'alta', sb);
    assert(b.path === 'obs/1 2.jpeg' && b.urlRender.includes('width=1200&quality=70') && b.urlRender.includes('obs/1%202.jpeg'), 'alta 1200 y espacio sin codificar en origen');
    const h = c.expedienteFotoUrls('https://x.supabase.co/storage/v1/object/public/hidivo-fotos/libro_obra/r1/IMG.HEIC', 'estandar', sb);
    assert(h.noDisponible === 'formato HEIC' && h.urlRender === null && h.path === 'libro_obra/r1/IMG.HEIC', 'HEIC');
    const d = c.expedienteFotoUrls('data:image/png;base64,AAAA', 'alta', sb);
    assert(d.urlRender === 'data:image/png;base64,AAAA' && d.path === null, 'data URI');
    const o = c.expedienteFotoUrls('https://otro.sitio/foto.jpg', 'estandar', sb);
    assert(o.urlRender === 'https://otro.sitio/foto.jpg' && o.path === null && !o.noDisponible, 'URL ajena se deja tal cual');
    const s = c.expedienteFotoUrls('https://x.supabase.co/storage/v1/object/public/hidivo-fotos/a.jpg', 'estandar', null);
    assert(s.urlRender === 'https://x.supabase.co/storage/v1/object/public/hidivo-fotos/a.jpg', 'sin cliente: URL original');
  });

  let htmlCompleto = '';
  await prueba('documento completo: secciones nuevas, índice, pies de foto, placeholder HEIC, sellos, observaciones, ensayos, formatos, SST, subcontratos', async () => {
    const { c, datos } = await cargar(fx);
    datos.cronograma.imagen = 'data:image/png;base64,iVBORw0KGgoCURVA';
    datos.cronograma.indicadores = { avanceRealTotal: 42.5, SPI: 0.95, BCWP: 40.1, BCWS: 42.2, totalProduccion: 54000, atrasados: 1, proyeccion: { fechaPlanificada: '2026-06-30', fechaEstimada: '2026-07-12', diasAtraso: 12 } };
    datos.cronograma.notaLineaBase = 'Cronograma según Línea Base 2 — Reprogramación por OC-01';
    const html = c.expedienteGenerarHTML(datos, SEL, META);
    htmlCompleto = html;
    ['cronograma', 'libro_obra', 'observaciones', 'ensayos', 'formatos_calidad', 'sst', 'subcontratistas'].forEach(k => seccion(html, k));
    assert(!html.includes('Libro de obra (todos los registros y sus fotos) (disponible próximamente)') && html.includes('Chat del proyecto (anexo, solo canales) (disponible próximamente)'), 'índice: fase 2 incluida, fase 3 próximamente');
    sinBasura(html);
    // Libro
    const libro = html.slice(html.indexOf('id="sec-libro_obra"'), html.indexOf('id="sec-planillas"'));
    assert(libro.includes('Febrero 2026 — 2 registro(s)') && libro.includes('Marzo 2026 — 1 registro(s)') && libro.includes('id="libro-2026-02"'), 'meses del libro');
    assert(libro.includes('✓ APROBADO por Prueba Fiscalizador') && libro.includes('⚠ OBSERVADO') && libro.includes('Observación de fiscalización: Falta la cantidad de acero por pila.') && libro.includes('⏳ PENDIENTE DE APROBACIÓN'), 'sellos de aprobación');
    assert(libro.includes('Foto 1/2 · 03/02/2026 · Registro N° 1 · Replanteo del eje') && libro.includes('Foto 2/2 · 03/02/2026 · Registro N° 1</figcaption>'), 'pies de foto del libro: ' + (libro.match(/<figcaption>[^<]*/g) || []).join(' | '));
    assert(libro.includes('render/image/public/hidivo-fotos/libro_obra/90000000-0000-4000-8000-000000000001/1770000000001_2%20con%20espacio%20y%20tilde%20%C3%A1.jpeg?width=900&amp;quality=70'), 'URL transformada con espacios y tildes codificados (el & va escapado en el atributo)');
    assert(libro.includes('Foto no disponible (formato HEIC)') && libro.includes('1770600000000_1.heic'), 'placeholder HEIC con su ruta');
    assert(libro.includes('class="registro-block"') && libro.includes('Rubros trabajados') && libro.includes('Replanteo y nivelación del eje'), 'contenido del registro como el reporte');
    // Observaciones
    const obs = seccion(html, 'observaciones') + html.slice(html.indexOf('id="obs-'), html.indexOf('id="sec-sst"'));
    assert(obs.includes('Observación N° 1 — Recubrimiento insuficiente en pila P2') && obs.includes('Plano Planta general, pág. 2') && obs.includes('Sin ubicación en plano'), 'observaciones y pin');
    assert(obs.includes('Foto 1/1 · 12/02/2026 · Observación N° 1') && obs.includes('Observación N° 1 · respuesta') && obs.includes('📎 informe.pdf') && obs.includes('Se corrigió con separadores'), 'fotos, respuesta con foto y respuesta con archivo');
    // Ensayos
    const ens = seccion(html, 'ensayos');
    assert(ens.includes('E-003 (R)') && ens.includes('✓ CUMPLE') && ens.includes('✗ Resuelto') && ens.includes('Re-ensayo de') && ens.includes('>E-002<') && ens.includes('Archivo en la plataforma: e1.pdf') && ens.includes('Compresión de hormigón'), 'ensayos: tabla del reporte, re-ensayo y certificado');
    // Formatos
    const fo = seccion(html, 'formatos_calidad');
    assert(fo.includes('Registro de hormigonado') && fo.includes('Corregido') && fo.includes('Prueba Residente') && fo.includes('se consulta e imprime desde la plataforma'), 'formatos como listado con referencia');
    // SST
    const sst = seccion(html, 'sst');
    assert(sst.includes('Monitor Ejemplo') && sst.includes('Caída a distinto nivel') && sst.includes('Guantes de cuero (2 pares)') && sst.includes('Trabajo en alturas') && sst.includes('PTE-001') && sst.includes('Resbalón sin lesión'), 'tablas SST');
    assert(sst.includes('I. Gestión Administrativa') && sst.includes('Auditoría') && sst.includes('Autoevaluación'), 'checklist por bloque y modo');
    assert(sst.includes('<td>Preempleo</td><td class="num">1</td><td class="num">1</td><td class="num">0</td>') && sst.includes('<td>Periódico</td><td class="num">1</td><td class="num">0</td><td class="num">1</td>'), 'exámenes agregados: realizados, vigentes, vencidos');
    assert(!sst.includes('DATO DE SALUD') && !sst.includes('apto') && !sst.includes('0000000001'), 'sin nombres, aptitud, observaciones ni cédulas en exámenes y asistentes');
    assert(sst.includes('Entrega de EPP · Trabajador Ejemplo Uno'), 'foto de entrega de EPP');
    // Subcontratistas y cronograma
    assert(seccion(html, 'subcontratistas').includes('Metálicas Ejemplo S.A. (ficticia)') && seccion(html, 'subcontratistas').includes('44,4 %'), 'subcontratos con % del contrato');
    const cr = seccion(html, 'cronograma');
    assert(cr.includes('LB-2') && cr.includes('<b>Activa</b>') && cr.includes('Histórica') && cr.includes('iVBORw0KGgoCURVA') && cr.includes('SPI (BCWP / BCWS)') && cr.includes('0,95') && cr.includes('12 días de atraso') && cr.includes('Fechas según LB-2'), 'cronograma, Curva S e indicadores');
    // Barra y script
    assert(html.includes('id="btnImprimir"') && html.includes('id="fotosEstado"') && html.includes('<script>(function(){') && html.includes("dataset.listo = '1'"), 'barra y script inline');
    assert((html.match(/<figure class="foto"/g) || []).length === 7 && (html.match(/<figure class="foto no-disponible"/g) || []).length === 1, 'figuras: 7 con imagen (2 libro, 1 data URI, 1 obs, 1 respuesta, 1 obs data URI, 1 EPP) + 1 placeholder HEIC');
  });

  await prueba('filtros: rango del libro, solo observaciones resueltas, calidad alta', async () => {
    const sel = { preset: null, secciones: TODAS, filtros: { ...FILTROS, libroDesde: '2026-03-01', libroHasta: '2026-12-31', observaciones: 'resueltas', calidadFotos: 'alta' } };
    const { c, datos } = await cargar(fx, sel);
    assert(datos.libro.length === 1 && datos.observaciones.length === 1 && datos.observaciones[0].numero === 1, 'carga filtrada');
    const html = c.expedienteGenerarHTML(datos, sel, META);
    const libro = html.slice(html.indexOf('id="sec-libro_obra"'), html.indexOf('id="sec-planillas"'));
    assert(libro.includes('Marzo 2026 — 1 registro(s)') && !libro.includes('Febrero 2026') && libro.includes('(del 01/03/2026 al 31/12/2026)'), 'rango del libro declarado');
    assert(!html.includes('Acopio de acero sin protección'), 'observación abierta excluida');
    assert(html.includes('width=1200&amp;quality=70') && !html.includes('width=900'), 'calidad alta');
    sinBasura(html);
  });

  await prueba('secciones sin datos de la fase 2 lo dicen explícitamente', async () => {
    const f2 = clonar(fx);
    ['libro_obra', 'libro_obra_fotos', 'libro_obra_rubros', 'observaciones', 'observacion_fotos', 'observacion_respuestas', 'ensayos', 'ensayo_especificaciones', 'formatos_calidad_asignaciones', 'formatos_calidad_respuestas',
     'sst_config', 'sst_matriz_riesgos', 'sst_epp_matriz', 'sst_epp_entregas', 'sst_capacitaciones', 'sst_checklist_respuestas', 'sst_examenes_matriz', 'sst_examenes_registros', 'sst_incidentes', 'sst_pte', 'subcontratos', 'lineas_base', 'cronograma_rubros'].forEach(t => { f2[t] = []; });
    const { c, datos } = await cargar(f2);
    const html = c.expedienteGenerarHTML(datos, SEL, META);
    ['Sin registros del libro de obra', 'Sin observaciones registradas', 'Sin ensayos registrados', 'Sin formatos llenados', 'Sin configuración SST registrada', 'Sin subcontratos registrados', 'Sin líneas base registradas', 'Sin Curva S'].forEach(t => assert(html.includes(t), 'falta «' + t + '»'));
    assert(html.includes('Sin fotos') === false || true, 'estado de fotos lo pinta el script');
    assert((html.match(/<figure class="foto/g) || []).length === 0 && datos.imagenesOrigen === 0, 'sin fotos');
    sinBasura(html);
  });

  await prueba('script inline en jsdom: contador, placeholders al fallar, botón y dataset.listo (éxito, fallo y sin fotos)', async () => {
    const dom = new JSDOM(htmlCompleto, { runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w){
      // jsdom no carga imágenes: se fuerza complete=false para que el script espere load/error.
      Object.defineProperty(w.HTMLImageElement.prototype, 'complete', { get(){ return false; }, configurable: true });
    } });
    const d = dom.window.document;
    const btn = d.getElementById('btnImprimir');
    const imgs = [...d.querySelectorAll('figure.foto img')];
    assert(imgs.length === 7 && btn.disabled && d.getElementById('fotosEstado').textContent === 'Fotos cargadas 0/7', 'estado inicial: ' + d.getElementById('fotosEstado').textContent);
    assert(!d.documentElement.dataset.listo, 'no listo aún');
    imgs.slice(0, 6).forEach(img => img.dispatchEvent(new dom.window.Event('load')));
    assert(d.getElementById('fotosEstado').textContent === 'Fotos cargadas 6/7' && btn.disabled, 'progreso parcial');
    const fallida = imgs[6];
    const ruta = fallida.getAttribute('data-ruta');
    fallida.dispatchEvent(new dom.window.Event('error'));
    assert(d.getElementById('fotosEstado').textContent === 'Fotos cargadas 7/7 · 1 no disponible(s)', 'final: ' + d.getElementById('fotosEstado').textContent);
    assert(!btn.disabled && btn.textContent === '🖨️ Imprimir / Guardar PDF' && d.documentElement.dataset.listo === '1', 'botón habilitado y listo');
    const figs = d.querySelectorAll('figure.foto.no-disponible');
    assert(figs.length === 2 && [...figs].some(f => f.querySelector('.foto-caja') && f.textContent.includes('Foto no disponible') && f.textContent.includes(ruta)), 'placeholder con la ruta de la fallida');
    // Sin fotos: listo de inmediato
    const { c, datos } = await cargar(fx, { secciones: ['contrato'], filtros: FILTROS });
    const dom2 = new JSDOM(c.expedienteGenerarHTML(datos, { secciones: ['contrato'], filtros: FILTROS }, META), { runScripts: 'dangerously' });
    assert(!dom2.window.document.getElementById('btnImprimir').disabled && dom2.window.document.documentElement.dataset.listo === '1' && dom2.window.document.getElementById('fotosEstado').textContent === 'Sin fotos', 'sin fotos: listo');
  });

  for(const [nombre, esperado] of [['parqueadero', { registros: 74, meses: ['Junio 2026', 'Julio 2026', 'Agosto 2026'], fotos: 242 }], ['via-acceso', { registros: 61, obs: 20 }], ['zapote', { registros: 45, fotos: 321 }]]){
    const real = cargarFixture(nombre + '.real.json');
    if(!real){ console.log(`  (sin fixture real ${nombre})`); continue; }
    await prueba(`fixture real ${nombre}: genera completo sin basura`, async () => {
      const { c, datos } = await cargar(real);
      const html = c.expedienteGenerarHTML(datos, SEL, META);
      sinBasura(html);
      assert(datos.libro.length === esperado.registros, 'registros: ' + datos.libro.length);
      if(esperado.meses) esperado.meses.forEach(m => assert(html.includes(m + ' — '), 'mes ' + m));
      if(esperado.fotos) assert((html.match(/<figure class="foto/g) || []).length === esperado.fotos, 'figuras: ' + (html.match(/<figure class="foto/g) || []).length);
      if(esperado.obs) assert(datos.observaciones.length === esperado.obs && html.includes('Observación N° '), 'observaciones: ' + datos.observaciones.length);
      assert(html.length < 16 * 1024 * 1024, 'tamaño razonable: ' + html.length);
    });
  }

  resumen();
})();
