// Actas con texto persistente: sanitizador (fixture malicioso) y flujo de la
// ventana de impresión (guardar, reabrir con el texto guardado, restablecer),
// con las funciones REALES de index.html en jsdom.
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, leer, scriptPrincipal, extraerFuncion, crearSb, crearContexto, cargarFixture, prueba, resumen, assert } = require('./lib/arnes');

const src = scriptPrincipal();
const FUNCIONES = ['imprimirActa', 'abrirVentanaDocCierre', 'inyectarBarraActa', 'guardarActaDesdeVentana', 'restablecerPlantillaActa', 'cargarCierreProyecto'];
const CODIGO = [leer(path.join(RAIZ, 'constantes.js')), leer(path.join(RAIZ, 'expediente.js')), FUNCIONES.map(f => extraerFuncion(src, f)).join('\n')].join('\n');

// Fixture malicioso: todo lo que el sanitizador debe quitar, mezclado con marcado legítimo.
const MALICIOSO = [
  '<p style="font-size:13px">En <b>Río Verde</b>, a los 15 de julio de 2026.</p>',
  '<script>alert(1)</script>',
  '<SCRIPT src="https://x/evil.js"></SCRIPT>',
  '<iframe src="https://x/"></iframe>',
  '<object data="x.swf"><param name="a" value="b"></object>',
  '<embed src="x.swf">',
  '<style>body{display:none}</style>',
  '<link rel="stylesheet" href="https://x/a.css"><meta http-equiv="refresh" content="0;url=https://x/"><base href="https://x/">',
  '<img src="x" onerror="alert(1)">',
  '<div onclick=\'alert(1)\' data-on="ok">texto</div>',
  '<svg onload=alert(1)><circle r="1"/></svg>',
  '<a href="javascript:alert(1)">enlace</a>',
  '<a href=" JaVaScRiPt:alert(1)">enlace2</a>',
  '<a href="j&#97;vascript:alert(1)">enlace3</a>',
  '<form action="javascript:alert(1)"><button formaction="javascript:alert(2)">x</button></form>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">d</a>',
  '<div style="width:expression(alert(1))">e</div>',
  '<div style="background:url(javascript:alert(1))">f</div>',
  '<p><b>Asistentes:</b><br>Ing. Prueba — Fiscalización</p>',
  '<div class="firmas"><div class="fb"><div class="lf"></div><div style="font-size:12px;font-weight:700">Fiscalización</div></div></div>',
  '<a href="https://hidivo.test/acta.pdf" target="_blank">acta firmada</a> <img src="https://hidivo.test/logo.png" alt="logo">'
].join('\n');

(async () => {
  console.log('actas.test.js');

  await prueba('sanitizarHtmlActa quita script, iframe, object, embed, style, on*, javascript: y conserva el marcado legítimo', () => {
    const c = crearContexto({ codigo: [{ ruta: path.join(RAIZ, 'constantes.js') }, { ruta: path.join(RAIZ, 'expediente.js') }] });
    const limpio = c.sanitizarHtmlActa(MALICIOSO);
    const bajo = limpio.toLowerCase();
    ['<script', '</script', '<iframe', '<object', '<embed', '<style', '<link', '<meta', '<base', 'onerror', 'onclick', 'onload', 'javascript:', 'srcdoc', 'data:text/html', 'expression(', 'alert('].forEach(t =>
      assert(!bajo.includes(t), 'queda «' + t + '» en: ' + limpio));
    assert(!/j&#97;vascript/i.test(limpio) || !/href=/.test(limpio.split('enlace3')[0].slice(-60)), 'javascript ofuscado');
    ['<p style="font-size:13px">En <b>Río Verde</b>', 'data-on="ok">texto</div>', '<circle r="1"/>', '>enlace</a>', '<b>Asistentes:</b><br>', 'class="firmas"', 'href="https://hidivo.test/acta.pdf" target="_blank"', 'src="https://hidivo.test/logo.png" alt="logo"', 'font-weight:700">Fiscalización'].forEach(t =>
      assert(limpio.includes(t), 'perdió marcado legítimo «' + t + '» en: ' + limpio));
    assert(c.sanitizarHtmlActa(null) === '' && c.sanitizarHtmlActa('') === '', 'vacíos');
    assert(c.sanitizarHtmlActa(c.sanitizarHtmlActa(MALICIOSO)) === limpio, 'idempotente');
  });

  await prueba('docCierreHTML: cuerpo y firmas dentro de #docCierreEditable; editableHtml los sustituye', () => {
    const c = crearContexto({ codigo: [{ ruta: path.join(RAIZ, 'constantes.js') }, { ruta: path.join(RAIZ, 'expediente.js') }] });
    const proy = { nombre: 'Puente peatonal Las Palmas', contratista: 'C', contratante: 'K' };
    const doc = c.docCierreHTML('ACTA', proy, '<p>cuerpo</p>', c.firmasCierre(proy), '14 de octubre de 2026');
    const i = doc.indexOf('<div id="docCierreEditable">'), j = doc.indexOf('</div>\n    </body>') >= 0 ? doc.indexOf('</div>\n    </body>') : doc.indexOf('</div>\r\n    </body>');
    assert(i > 0 && j > i, 'envoltorio presente y cerrado antes de </body>');
    const dentro = doc.slice(i, j);
    assert(dentro.includes('<p>cuerpo</p>') && dentro.includes('class="firmas"') && dentro.includes('Contratista'), 'cuerpo y firmas dentro del envoltorio');
    assert(doc.includes('contenteditable="true"') && doc.includes('nota-edicion'), 'sigue siendo el borrador editable');
    const guardado = c.docCierreHTML('ACTA', proy, '<p>cuerpo</p>', c.firmasCierre(proy), 'f', '<p>texto guardado</p>');
    assert(guardado.includes('<div id="docCierreEditable"><p>texto guardado</p></div>') && !guardado.includes('<p>cuerpo</p>') && !guardado.includes('class="firmas"'), 'editableHtml sustituye cuerpo y firmas');
  });

  // Flujo en jsdom: la ventana de impresión es un documento jsdom real.
  function crearApp(fixture, rol = 'fiscalizador'){
    const dom = new JSDOM('<!doctype html><html><body><div id="toast"></div><div id="contratoContent"></div></body></html>', { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    const ventanas = [];
    w.open = () => { const v = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://hidivo.test/HidivoGdP/acta', runScripts: 'outside-only' }).window; v.cerrada = false; v.close = () => { v.cerrada = true; }; ventanas.push(v); return v; };
    w.confirm = () => w._confirmar !== false;
    w.toasts = []; w.toast = (msg, tipo) => w.toasts.push({ msg, tipo });
    w.sb = crearSb(fixture);
    w.currentProyecto = fixture.proyectos[0].id;
    w.currentUser = { id: 'b0000000-0000-4000-8000-000000000002' };
    w.currentPerfil = { id: 'b0000000-0000-4000-8000-000000000002', nombre: 'Prueba', apellido: 'Fiscalizador', rol };
    w.proyectos = fixture.proyectos;
    w._proyectoCerrado = false;
    // cargarCierreProyecto (se llama tras guardar/restablecer) usa el bloque del expediente: fuera de alcance aquí
    w.bloqueExpedienteHTML = () => ''; w.cargarExpedientesGenerados = () => {};
    w.eval(CODIGO);
    w._ventanas = ventanas;
    return w;
  }
  const esperar = async (fn, n = 50) => { for(let i = 0; i < n; i++){ if(fn()) return true; await new Promise(r => setTimeout(r, 0)); } return fn(); };
  const base = cargarFixture('sintetico.json');
  const clonar = o => JSON.parse(JSON.stringify(o));

  await prueba('ventana del acta: plantilla, barra con «Guardar acta», sin «Restablecer»; guardar persiste el HTML saneado', async () => {
    const fx = clonar(base);
    const acta = fx.actas_recepcion[0];
    const w = crearApp(fx);
    await w.imprimirActa(acta.id);
    const v = w._ventanas[0];
    const d = v.document;
    assert(d.getElementById('docCierreEditable') && d.body.textContent.includes('Río Verde'), 'plantilla cargada dentro del envoltorio');
    const botones = [...d.querySelectorAll('.acta-barra button')].map(b => b.textContent);
    assert(botones.length === 1 && botones[0].includes('Guardar acta'), 'solo Guardar: ' + botones.join('|'));
    assert(d.querySelector('style').textContent.includes('@media print{.acta-barra{display:none}}'), 'barra oculta al imprimir');
    // El usuario edita el texto (y mete algo peligroso) y guarda
    d.getElementById('docCierreEditable').innerHTML += '<p>Corrección del fiscalizador</p><img src=x onerror="alert(1)"><script>alert(2)</script>';
    d.querySelector('.acta-barra button').click();
    await esperar(() => acta.contenido_html);
    assert(acta.contenido_html.includes('Corrección del fiscalizador') && acta.contenido_html.includes('Río Verde') && acta.contenido_html.includes('class="firmas"'), 'guarda cuerpo y firmas');
    assert(!acta.contenido_html.includes('onerror') && !acta.contenido_html.includes('<script'), 'saneado al guardar');
    assert(acta.contenido_actualizado_en, 'fecha de guardado');
    assert(d.getElementById('actaAviso').textContent.startsWith('Acta guardada ✓'), 'aviso en la ventana');
    assert(w.toasts.some(t => t.tipo === 'success'), 'toast en la app');
  });

  await prueba('reabrir con texto guardado: carga el texto (saneado), no la plantilla, y ofrece «Restablecer plantilla»', async () => {
    const fx = clonar(base);
    const acta = fx.actas_recepcion[1];
    acta.contenido_html = '<p>Texto corregido a mano</p><img src=x onerror="alert(1)"><div class="firmas">F</div>';
    acta.contenido_actualizado_en = '2026-10-14T15:05:00Z';
    const w = crearApp(fx);
    await w.imprimirActa(acta.id);
    const d = w._ventanas[0].document;
    const edit = d.getElementById('docCierreEditable');
    assert(edit.innerHTML.includes('Texto corregido a mano') && !edit.innerHTML.includes('onerror') && !edit.textContent.includes('se reúnen las partes'), 'texto guardado saneado en vez de plantilla');
    const botones = [...d.querySelectorAll('.acta-barra button')].map(b => b.textContent);
    assert(botones.length === 2 && botones[1].includes('Restablecer plantilla'), 'dos botones: ' + botones.join('|'));
    assert(d.getElementById('actaAviso').textContent.includes('Texto guardado el 14/10/2026, 10:05'), 'fecha de guardado visible');
    // Restablecer: confirma, borra, cierra y reabre con la plantilla
    d.querySelectorAll('.acta-barra button')[1].click();
    await esperar(() => w._ventanas.length === 2);
    assert(acta.contenido_html === null && acta.contenido_actualizado_en === null, 'columna borrada');
    assert(w._ventanas[0].cerrada, 'cierra la ventana anterior');
    assert(w._ventanas[1].document.body.textContent.includes('se reúnen las partes'), 'reabre con la plantilla');
    assert([...w._ventanas[1].document.querySelectorAll('.acta-barra button')].length === 1, 'sin Restablecer tras volver a la plantilla');
  });

  await prueba('restablecer cancelado no toca nada; residente no ve la barra; proyecto liquidado tampoco', async () => {
    const fx = clonar(base);
    const acta = fx.actas_recepcion[1];
    acta.contenido_html = '<p>guardado</p>'; acta.contenido_actualizado_en = '2026-10-14T15:05:00Z';
    const w = crearApp(fx); w._confirmar = false;
    await w.imprimirActa(acta.id);
    w._ventanas[0].document.querySelectorAll('.acta-barra button')[1].click();
    await new Promise(r => setTimeout(r, 5));
    assert(acta.contenido_html === '<p>guardado</p>' && w._ventanas.length === 1, 'cancelar no borra ni reabre');
    const r = crearApp(clonar(base), 'residente');
    await r.imprimirActa(base.actas_recepcion[0].id);
    assert(!r._ventanas[0].document.querySelector('.acta-barra'), 'residente: sin barra');
    const l = crearApp(clonar(base)); l._proyectoCerrado = true;
    await l.imprimirActa(base.actas_recepcion[0].id);
    assert(!l._ventanas[0].document.querySelector('.acta-barra'), 'liquidado: sin barra (solo lectura)');
  });

  await prueba('expediente: usa el texto guardado con su fecha; sin texto, plantilla con nota', async () => {
    const c = crearContexto({ codigo: [{ ruta: path.join(RAIZ, 'constantes.js') }, { ruta: path.join(RAIZ, 'expediente.js') }] });
    const fx = clonar(base);
    fx.actas_recepcion[0].contenido_html = '<p>Texto negociado</p><div class="firmas">firmas guardadas</div><script>alert(1)</script>';
    fx.actas_recepcion[0].contenido_actualizado_en = '2026-10-14T15:05:00Z';
    const datos = await c.expedienteCargarDatos(fx.proyectos[0].id, {}, crearSb(fx));
    const html = c.expedienteGenerarHTML(datos, { secciones: ['actas'], filtros: {} }, { version: 1, generadoEn: '2026-10-14T15:05:00Z', hoy: '2026-10-14' });
    const prov = html.slice(html.indexOf('id="acta-provisional"'), html.indexOf('id="acta-definitiva"'));
    // El documento lleva su propio <script> inline (carga de fotos): el saneado se comprueba en la sección del acta.
    assert(prov.includes('Acta según texto guardado el 14/10/2026, 10:05') && prov.includes('Texto negociado') && prov.includes('firmas guardadas') && !prov.includes('<script') && !prov.includes('alert('), 'acta provisional: texto guardado saneado');
    assert(!prov.includes('se reúnen las partes') && (prov.match(/class="firmas"/g) || []).length === 1, 'sin plantilla ni firmas duplicadas');
    const def = html.slice(html.indexOf('id="acta-definitiva"'));
    assert(def.includes('se reúnen las partes') && def.includes('Texto generado a partir de los datos registrados') && def.includes('El acta firmada está adjunta'), 'acta definitiva: plantilla con nota');
    assert(!/\b(undefined|NaN|null)\b/.test(html), 'sin basura');
  });

  resumen();
})();
