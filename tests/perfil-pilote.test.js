// Perfil estratigráfico + perfil del pilote (perfil-pilote.js) en el PDF del
// formato FR-001-PIL-V2: ejecuta el módulo real y exportarPdfFormato de
// index.html contra el fixture formato-pil-v2.json (plantilla real, respuestas
// sintéticas) y comprueba el SVG con jsdom.
//
//   node perfil-pilote.test.js
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, scriptPrincipal, extraerFuncion, crearContexto, cargarFixture, prueba, resumen, assert } = require('./lib/arnes');

const fx = cargarFixture('formato-pil-v2.json');
const src = scriptPrincipal();
const ctx = crearContexto({
  codigo: [{ ruta: path.join(RAIZ, 'perfil-pilote.js'), nombre: 'perfil-pilote.js' }, extraerFuncion(src, 'exportarPdfFormato')],
  globals: { currentProyecto: 'p1', proyectos: [{ id: 'p1', nombre: 'Proyecto de prueba' }], LOGO_URL: 'vendor/logo-hidivo.png', _residenteLlenadoNombre: 'Residente' }
});

const campoSuelo = campos => campos.find(c => c.etiqueta === 'Perfil del Suelo');
function dibujar(campos, valores){
  const c = campoSuelo(campos);
  const r = ctx.generarDibujoPerfilPilote(c, valores[c.id], campos, valores);
  const dom = r ? new JSDOM('<body>' + r.html + '</body>') : null;
  return { r, doc: dom && dom.window.document, html: r ? r.html : '' };
}
const num = v => parseFloat(v);
const $ = (doc, sel) => doc.querySelector(sel);
const $$ = (doc, sel) => [...doc.querySelectorAll(sel)];
const texto = (doc, sel) => $$(doc, sel).map(e => e.textContent.replace(/\s+/g, ' ').trim());
const celdas = doc => $$(doc, '.pp-tabla td').map(e => e.textContent.replace(/\s+/g, ' ').trim());
const valorDe = (doc, concepto) => { const tds = celdas(doc); const i = tds.findIndex(t => t.startsWith(concepto)); assert(i >= 0, 'no está la fila ' + concepto); return tds[i + 1]; };

(async () => {
  console.log('perfil-pilote.test.js');
  const M = fx.campos_migrado, A = fx.campos_actual, R = fx.respuestas;

  await prueba('fixture: plantilla migrada con 7, 5 y 8 columnas', () => {
    const n = et => M.find(c => c.etiqueta === et).columnas.length;
    assert(n('Cotas (m, absolutas)') === 7 && n('Información del Pilote') === 5 && n('Armadura de Refuerzo') === 8, 'columnas anexadas');
    assert(A.find(c => c.etiqueta === 'Cotas (m, absolutas)').columnas.length === 6, 'plantilla actual intacta');
  });

  await prueba('completa: SVG con fuste, hormigón, descabezado, armadura, NF, CPF y 7 estratos; sin NaN', () => {
    const { r, doc, html } = dibujar(M, R.completa);
    assert(r && r.soloSuelo === false, 'debe ser dibujo con pilote');
    assert(!/NaN|undefined/.test(html), 'sin NaN ni undefined');
    for(const id of ['pp-fuste', 'pp-hormigon', 'pp-descabezar', 'pp-armadura', 'pp-nf', 'pp-ct', 'pp-cpf', 'pp-sobreexc', 'pp-sobresal', 'pp-chsig', 'pp-cotas', 'pp-suelo'])
      assert($(doc, '#' + id), 'falta #' + id);
    assert(!$(doc, '#pp-hormigon-bajo'), 'no hay hormigón bajo cota de corte');
    assert($$(doc, '.pp-estrato').length === 7, '7 estratos');
    assert($(doc, '.pp-leyenda-suelo') && $(doc, '.pp-leyenda-pilote') && $(doc, '.pp-tabla'), 'leyendas y tabla');
    assert(!$(doc, '.pp-notas'), 'sin notas de inconsistencia');
    const claves = $$(doc, '.pp-cota').map(e => e.getAttribute('data-clave')).sort().join(',');
    assert(claves === 'CC,CFE,CH,CH+1,CIA,CPF,CSA,CT,NF', 'cotas: ' + claves);
    const etq = $(doc, '#pp-armadura-etq').textContent;
    assert(/12 Ø 25 mm · L = 15,75 m/.test(etq) && /espiral Ø 10 @ 15 cm/.test(etq), 'etiqueta de armadura: ' + etq);
  });

  await prueba('completa: CFE alineada con el estrato que atraviesa y NF cruza ambos paneles', () => {
    const { doc } = dibujar(M, R.completa);
    const fuste = $(doc, '#pp-fuste');
    const yCFE = num(fuste.getAttribute('y')) + num(fuste.getAttribute('height'));
    // CFE = 8,80 − 16,73 = −7,93 → dentro de Grava Arcillosa (15–17 m de profundidad: cotas −6,20 a −8,20)
    const grava = $$(doc, '.pp-estrato').find(e => e.getAttribute('data-tipo') === 'Grava Arcillosa');
    const y1 = num(grava.getAttribute('y')), y2 = y1 + num(grava.getAttribute('height'));
    assert(yCFE > y1 && yCFE < y2, `CFE (y=${yCFE}) fuera del estrato (${y1}–${y2})`);
    // Terreno: el fuste arranca donde arranca el primer estrato
    const primero = $$(doc, '.pp-estrato')[0];
    assert(Math.abs(num(fuste.getAttribute('y')) - num(primero.getAttribute('y'))) < 0.11, 'CT alineada con el primer estrato');
    // Proporción: 16,73 m de fuste frente a 17 m de columna, misma escala
    const colAlto = $$(doc, '.pp-estrato').reduce((s, e) => s + num(e.getAttribute('height')), 0);
    assert(Math.abs(num(fuste.getAttribute('height')) / colAlto - 16.73 / 17) < 0.01, 'misma escala vertical');
    const nf = $(doc, '#pp-nf');
    assert(num(nf.getAttribute('x1')) < 60 && num(nf.getAttribute('x2')) >= 660, 'NF cruza ambos paneles');
  });

  await prueba('completa: textos de cotas sin superposición (≥ 12 px), líneas en su posición', () => {
    const { doc } = dibujar(M, R.completa);
    const ys = $$(doc, '.pp-cota').map(e => num(e.getAttribute('y'))).sort((a, b) => a - b);
    for(let i = 1; i < ys.length; i++) assert(ys[i] - ys[i - 1] >= 11.9, `textos a ${(ys[i] - ys[i - 1]).toFixed(1)} px`);
    // CT, CH (8,80) y CH+1 (8,75) caen juntas: el texto se desplaza pero la línea queda en su cota
    const lineas = $$(doc, '#pp-cotas line').map(l => num(l.getAttribute('y1')));
    assert(lineas.length >= 6, 'líneas de referencia');
  });

  await prueba('completa: tabla derivada contra cálculo a mano', () => {
    const { doc } = dibujar(M, R.completa);
    assert(valorDe(doc, 'Longitud excavada') === '16,73 m', 'longitud excavada');
    assert(valorDe(doc, 'Sobreexcavación') === '+0,19 m (sobreexcavación)', 'sobreexcavación: ' + valorDe(doc, 'Sobreexcavación'));
    assert(valorDe(doc, 'Longitud de hormigón') === '16,73 m', 'longitud de hormigón');
    assert(valorDe(doc, 'Hormigón a descabezar') === '0,80 m', 'a descabezar');
    assert(valorDe(doc, 'Longitud de armadura') === '15,75 m', 'longitud de armadura');
    assert(valorDe(doc, 'Sobresaliente') === '1,20 m', 'sobresaliente');
    // D real 1,05 m: π·1,05²/4·16,73 = 14,49 m³; real 14,50 → +0,1 %
    assert(valorDe(doc, 'Volumen teórico').startsWith('14,49 m³'), 'volumen teórico: ' + valorDe(doc, 'Volumen teórico'));
    assert(valorDe(doc, 'Volumen real').startsWith('14,50 m³ · +0,1 %'), 'volumen real: ' + valorDe(doc, 'Volumen real'));
  });

  await prueba('sin volumen real: usa la suma de Concreto Parcial (15,00 m³)', () => {
    const { doc } = dibujar(M, R.sin_volumen_real);
    assert(valorDe(doc, 'Volumen real').startsWith('15,00 m³ · +3,5 %'), 'volumen real: ' + valorDe(doc, 'Volumen real'));
  });

  await prueba('incompleta (solo excavación): fuste y cotas de excavación, sin hormigón ni acero, «—» en la tabla', () => {
    const { r, doc, html } = dibujar(M, R.incompleta);
    assert(r && r.soloSuelo === false, 'dibujo con pilote');
    assert(!/NaN|undefined/.test(html), 'sin NaN');
    assert($(doc, '#pp-fuste') && $(doc, '#pp-cpf') && $(doc, '#pp-sobreexc'), 'excavación dibujada');
    for(const id of ['pp-hormigon', 'pp-descabezar', 'pp-armadura', 'pp-nf', 'pp-sobresal', 'pp-hormigon-bajo']) assert(!$(doc, '#' + id), 'no debe estar #' + id);
    const claves = $$(doc, '.pp-cota').map(e => e.getAttribute('data-clave')).sort().join(',');
    assert(claves === 'CFE,CPF,CT', 'cotas: ' + claves);
    assert(valorDe(doc, 'Longitud excavada') === '16,73 m', 'longitud excavada');
    for(const c of ['Longitud de hormigón', 'Hormigón a descabezar', 'Longitud de armadura', 'Sobresaliente', 'Volumen teórico', 'Volumen real']) assert(valorDe(doc, c) === '—', c + ' debe ser —: ' + valorDe(doc, c));
  });

  await prueba('inconsistente: se dibuja igual, cotas en rojo y notas al pie', () => {
    const { r, doc, html } = dibujar(M, R.inconsistente);
    assert(r && !/NaN/.test(html), 'dibuja sin NaN');
    assert($(doc, '#pp-fuste') && $(doc, '#pp-armadura') && $(doc, '#pp-hormigon'), 'fuste, armadura y hormigón');
    const notas = texto(doc, '.pp-notas div');
    assert(notas.length === 3, 'tres notas: ' + JSON.stringify(notas));
    assert(notas.some(n => /CIA/.test(n)) && notas.some(n => /CSA/.test(n)) && notas.some(n => /CH .*terreno/.test(n)), 'notas de CIA, CSA y CH');
    const rojo = k => $(doc, `.pp-cota[data-clave="${k}"]`).getAttribute('fill') === '#e2445c';
    assert(rojo('CIA') && rojo('CSA') && rojo('CH') && !rojo('CT') && !rojo('CFE'), 'cotas rojas correctas');
  });

  await prueba('hormigón bajo cota de corte: franja roja con etiqueta', () => {
    const { doc, html } = dibujar(M, R.hormigon_bajo);
    assert($(doc, '#pp-hormigon-bajo') && !$(doc, '#pp-descabezar'), 'franja roja en vez de descabezado');
    assert(/hormigón bajo cota de corte/.test(html), 'etiqueta');
    assert(valorDe(doc, 'Hormigón a descabezar') === '−0,20 m', 'descabezado negativo: ' + valorDe(doc, 'Hormigón a descabezar'));
  });

  await prueba('respuesta antigua (plantilla actual, sin cotas): solo el perfil del suelo, marcas en profundidad', () => {
    const { r, doc, html } = dibujar(A, R.antigua_solo_suelo);
    assert(r && r.soloSuelo === true, 'solo suelo');
    assert(!/NaN/.test(html), 'sin NaN');
    assert($$(doc, '.pp-estrato').length === 7 && !$(doc, '#pp-pilote') && !$(doc, '.pp-tabla'), 'sin panel de pilote ni tabla');
    const ticks = $$(doc, 'text').map(e => e.textContent);
    assert(ticks.includes('0m') && ticks.includes('17m') && !ticks.includes('−8'), 'marcas en profundidad: ' + ticks.slice(0, 5));
    assert($(doc, '.pp-leyenda-suelo'), 'leyenda de tipos de suelo');
    const svg = $(doc, 'svg.pp-svg');
    assert(svg.getAttribute('width') === '360', 'ancho compacto');
  });

  await prueba('respuesta antigua sin perfil del suelo: no se dibuja nada', () => {
    const { r } = dibujar(A, R.antigua_sin_suelo);
    assert(r === '', 'vacío');
    // y una tabla repetible cualquiera (no es perfil del suelo) tampoco dibuja
    const otra = A.find(c => c.etiqueta === 'Concreto');
    assert(ctx.generarDibujoPerfilPilote(otra, [['28']], A, R.antigua_sin_suelo) === '', 'otra tabla: vacío');
  });

  await prueba('exportarPdfFormato real: el bloque entra al PDF a todo el ancho; con solo suelo, al lado de la tabla', () => {
    ctx._ventanas.length = 0;
    ctx._plantillaLlenadoActual = { id: fx.plantilla_id, nombre: 'FR-001-PIL-V2', campos: M };
    ctx._valoresLlenado = R.completa;
    ctx._fotosLlenadoExistentes = [];
    ctx.exportarPdfFormato();
    const html = ctx._ventanas[0].html;
    assert(html.includes('<svg class="pp-svg"') && html.includes('flex-basis:100%;break-inside:avoid'), 'SVG con pilote a todo el ancho');
    assert(html.includes('Perfil del Suelo') && html.includes('Grava Arcillosa'), 'la tabla de estratos sigue en el PDF');
    assert(!/NaN/.test(html), 'sin NaN');
    ctx._ventanas.length = 0;
    ctx._plantillaLlenadoActual = { id: fx.plantilla_id, nombre: 'FR-001-PIL-V2', campos: A };
    ctx._valoresLlenado = R.antigua_solo_suelo;
    ctx.exportarPdfFormato();
    const html2 = ctx._ventanas[0].html;
    assert(html2.includes('<svg class="pp-svg"') && !html2.includes('flex-basis:100%'), 'solo suelo al lado de la tabla');
    ctx._ventanas.length = 0;
    ctx._valoresLlenado = R.antigua_sin_suelo;
    ctx.exportarPdfFormato();
    assert(!ctx._ventanas[0].html.includes('pp-svg'), 'sin perfil no hay SVG');
  });

  resumen();
})();
