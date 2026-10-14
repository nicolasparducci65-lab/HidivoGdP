// Arnés de pruebas de HidivoGdP.
//
// Ejecuta funciones REALES de index.html (extraídas por nombre del script
// principal), constantes.js y expediente.js dentro de un contexto `vm` de Node,
// con un cliente Supabase simulado que responde desde un fixture JSON y una
// ventana de impresión que captura lo que se escribe con document.write.
//
// Variables de entorno:
//   HIDIVO_INDEX   ruta a index.html (por defecto ../index.html)
//   HIDIVO_FECHA   fecha fija ISO para `new Date()` (por defecto 2026-10-14T15:00:00Z)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..', '..');
const RUTA_INDEX = process.env.HIDIVO_INDEX || path.join(RAIZ, 'index.html');
const FECHA_FIJA = process.env.HIDIVO_FECHA || '2026-10-14T15:00:00Z';

function leer(ruta){ return fs.readFileSync(ruta, 'utf8'); }

// Script principal de index.html: el único bloque <script> inline (sin src).
function scriptPrincipal(html = leer(RUTA_INDEX)){
  const m = html.match(/^<script>\r?\n([\s\S]*?)^<\/script>/m);
  if(!m) throw new Error('No se encontró el bloque <script> principal en index.html');
  return m[1];
}

// Fuente de una función de nivel superior: desde `function nombre(` (o `async function`)
// en columna 0 hasta la primera línea que es exactamente `}`.
function extraerFuncion(src, nombre){
  const re = new RegExp('^(?:async )?function ' + nombre + '\\(', 'm');
  const m = re.exec(src);
  if(!m) throw new Error('No se encontró la función ' + nombre);
  const fin = src.indexOf('\n}', m.index);
  if(fin < 0) throw new Error('No se encontró el cierre de ' + nombre);
  let hasta = fin + 2;
  if(src[hasta] === '\r') hasta++;
  return src.slice(m.index, hasta) + '\n';
}

// Fuente de una constante de nivel superior de una sola línea: `const NOMBRE = ...;`
function extraerConst(src, nombre){
  const re = new RegExp('^(?:const|let) ' + nombre + ' = .*$', 'm');
  const m = re.exec(src);
  if(!m) throw new Error('No se encontró la constante ' + nombre);
  return m[0] + '\n';
}

// ── Cliente Supabase simulado ───────────────────────────────────────────────
// Soporta: from(t).select('cols' | '*, alias:tabla(cols)').eq().in().neq().order().limit()
// .range().single().maybeSingle(), y `await` / Promise.all sobre el builder.
// Las filas salen del fixture {tabla: [filas]}. Devuelve {data, error:null}.
const FK_POR_ALIAS = { perfil: 'generado_por', autor: 'autor_id', rubro: 'rubro_id' };

function crearSb(fixture, opciones = {}){
  const llamadas = [];
  function builder(tabla){
    const b = {
      _tabla: tabla, _filtros: [], _orden: [], _rango: null, _single: false, _maybe: false, _select: '*',
      select(cols = '*'){ b._select = cols; return b; },
      eq(c, v){ b._filtros.push(f => f[c] === v); return b; },
      neq(c, v){ b._filtros.push(f => f[c] !== v); return b; },
      in(c, arr){ b._filtros.push(f => (arr||[]).includes(f[c])); return b; },
      is(c, v){ b._filtros.push(f => f[c] === v); return b; },
      order(c, o){ b._orden.push([c, !(o && o.ascending === false)]); return b; },
      limit(n){ b._rango = [0, n-1]; return b; },
      range(a, z){ b._rango = [a, z]; return b; },
      single(){ b._single = true; return b; },
      maybeSingle(){ b._maybe = true; return b; },
      insert(fila){ b._insert = fila; return b; },
      update(fila){ b._update = fila; return b; },
      _ejecutar(){
        llamadas.push({ tabla, select: b._select, filtros: b._filtros.length, rango: b._rango });
        if(b._insert){
          const fila = { id: 'ins-' + (llamadas.length), ...b._insert };
          (fixture[tabla] = fixture[tabla] || []).push(fila);
          if(opciones.alInsertar) opciones.alInsertar(tabla, fila);
          return { data: b._single ? fila : [fila], error: null };
        }
        if(b._update){
          const filas = (fixture[tabla]||[]).filter(f => b._filtros.every(fn => fn(f)));
          filas.forEach(f => Object.assign(f, b._update));
          return { data: filas, error: null };
        }
        let filas = (fixture[tabla] || []).filter(f => b._filtros.every(fn => fn(f)));
        for(const [c, asc] of b._orden.slice().reverse()){
          filas = filas.slice().sort((x, y) => (x[c] > y[c] ? 1 : x[c] < y[c] ? -1 : 0) * (asc ? 1 : -1));
        }
        if(b._rango) filas = filas.slice(b._rango[0], b._rango[1] + 1);
        // Incrustaciones `alias:tabla(cols)`
        const embeds = [...String(b._select).matchAll(/(\w+):(\w+)\(([^)]*)\)/g)];
        if(embeds.length){
          filas = filas.map(f => {
            const copia = { ...f };
            for(const [, alias, tablaE] of embeds){
              const fk = FK_POR_ALIAS[alias] || (alias + '_id');
              copia[alias] = (fixture[tablaE] || []).find(x => x.id === f[fk]) || null;
            }
            return copia;
          });
        }
        if(b._single || b._maybe) return { data: filas[0] || null, error: b._single && !filas[0] ? { message: 'no rows' } : null };
        return { data: filas, error: null };
      },
      then(res, rej){ return Promise.resolve().then(() => b._ejecutar()).then(res, rej); }
    };
    return b;
  }
  return {
    from: builder,
    llamadas,
    auth: { getUser: async () => ({ data: { user: { id: opciones.usuarioId || null } } }) },
    storage: { from(){ return { getPublicUrl: p => ({ data: { publicUrl: 'https://storage.test/' + p } }) }; } }
  };
}

// ── Contexto vm ─────────────────────────────────────────────────────────────
// Crea un contexto con window === globalThis, Date fijo, window.open capturado,
// toast capturado y setTimeout sin efecto. `codigo` es un arreglo de fuentes a
// ejecutar en orden (constantes.js, expediente.js, funciones extraídas...).
function crearContexto({ codigo = [], globals = {}, fecha = FECHA_FIJA } = {}){
  const FIJA = new Date(fecha).getTime();
  class FechaFija extends Date {
    constructor(...a){ super(...(a.length ? a : [FIJA])); }
    static now(){ return FIJA; }
  }
  const ventanas = [];
  const toasts = [];
  const ctx = {
    console, Intl, Math, JSON, Number, String, Array, Object, Promise, Map, Set, Error, RegExp, parseFloat, parseInt, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, Date: FechaFija,
    setTimeout: () => 0, clearTimeout: () => {},
    toast: (msg, tipo) => toasts.push({ msg, tipo }),
    open: () => {
      const v = { html: '', document: { write(s){ v.html += s; }, close(){} }, print(){ v.impreso = true; }, focus(){} };
      ventanas.push(v); return v;
    },
    location: { href: 'https://hidivo.test/HidivoGdP/' },
    ...globals
  };
  vm.createContext(ctx);
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  for(const src of codigo){
    vm.runInContext(typeof src === 'string' ? src : leer(src.ruta), ctx, { filename: src.nombre || 'inline.js' });
  }
  ctx._ventanas = ventanas; ctx._toasts = toasts;
  // Las `const`/`let` de nivel superior no son propiedades del contexto: se leen con _eval.
  ctx._eval = expr => vm.runInContext(expr, ctx);
  return ctx;
}

function cargarFixture(nombre){
  const ruta = path.isAbsolute(nombre) ? nombre : path.join(__dirname, '..', 'fixtures', nombre);
  if(!fs.existsSync(ruta)) return null;
  return JSON.parse(leer(ruta));
}

// Pequeño runner: `prueba(nombre, fn)` acumula resultados; `resumen()` imprime y fija el código de salida.
const resultados = [];
async function prueba(nombre, fn){
  try{ await fn(); resultados.push([nombre, true]); console.log('  ✓ ' + nombre); }
  catch(e){ resultados.push([nombre, false, e]); console.log('  ✗ ' + nombre + '\n      ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n      ')); }
}
function resumen(){
  const ok = resultados.filter(r => r[1]).length;
  console.log(`\n${ok}/${resultados.length} pruebas correctas`);
  if(ok !== resultados.length) process.exitCode = 1;
}
function assert(cond, msg){ if(!cond) throw new Error(msg || 'aserción fallida'); }

module.exports = { RAIZ, RUTA_INDEX, leer, scriptPrincipal, extraerFuncion, extraerConst, crearSb, crearContexto, cargarFixture, prueba, resumen, assert };
