// Validación mínima de cada entrega: `node --check` sobre el script principal de
// index.html y los .js del repo, y balance de <div> en index.html.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { RAIZ, RUTA_INDEX, leer, scriptPrincipal } = require('./lib/arnes');

const tmp = path.join(__dirname, '.tmp');
fs.mkdirSync(tmp, { recursive: true });
let fallos = 0;

function check(nombre, codigo){
  const ruta = path.join(tmp, nombre.replace(/[\\/]/g, '_') + '.check.js');
  fs.writeFileSync(ruta, codigo);
  try{ execFileSync(process.execPath, ['--check', ruta], { stdio: 'pipe' }); console.log('  ✓ sintaxis ' + nombre); }
  catch(e){ fallos++; console.log('  ✗ sintaxis ' + nombre + '\n' + String(e.stderr || e.message)); }
}

const html = leer(RUTA_INDEX);
check('index.html (script principal)', scriptPrincipal(html));
for(const f of ['constantes.js', 'expediente.js', 'service-worker.js', 'js/recorridos360.js']){
  const ruta = path.join(RAIZ, f);
  if(fs.existsSync(ruta)) check(f, leer(ruta));
}

// Balance de <div>: master arrastra un </div> de más desde antes (2146 abren,
// 2147 cierran en el commit be73e96), así que lo que se exige es que la
// diferencia no cambie respecto a la versión committeada (git HEAD).
const balance = h => (h.match(/<div[\s>]/g) || []).length - (h.match(/<\/div>/g) || []).length;
let base = null;
try{ base = balance(execFileSync('git', ['show', 'HEAD:index.html'], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 1 << 26 })); }catch{ /* sin git: se compara con 0 */ }
const actual = balance(html);
if(base === null ? actual === 0 : actual === base) console.log(`  ✓ balance de <div> en index.html sin cambios (aperturas − cierres = ${actual})`);
else { fallos++; console.log(`  ✗ balance de <div> en index.html cambió: era ${base ?? 0}, ahora ${actual}`); }

const crlf = (html.match(/\r\n/g) || []).length, lf = (html.match(/\n/g) || []).length;
if(crlf === lf) console.log('  ✓ index.html conserva CRLF en todas las líneas');
else { fallos++; console.log(`  ✗ index.html mezcla finales de línea: ${lf - crlf} líneas sin CR`); }

if(fallos) process.exitCode = 1;
