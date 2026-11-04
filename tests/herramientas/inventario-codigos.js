#!/usr/bin/env node
// Corre tests/herramientas/inventario-codigos.sql sobre un dump de pg_dump (formato COPY ...
// FROM stdin, .sql o .sql.gz) cargado en Postgres embebido (pglite): nunca toca producción.
// Escribe un CSV por consulta en la carpeta de salida y muestra el resumen por proyecto.
//
//   node inventario-codigos.js <dump.sql|dump.sql.gz> <carpeta-salida>
//
// Requiere @electric-sql/pglite, que no es dependencia del arnés (pesa ~10 MB):
//   cd tests && npm install --no-save @electric-sql/pglite
// Solo carga las columnas que usa el SQL de proyectos, rubros, libro_obra_rubros y
// planilla_rubros. Los CSV llevan datos reales: van al repo privado, nunca a este.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const [,, rutaDump, salida] = process.argv;
if(!rutaDump || !salida){ console.error('Uso: node inventario-codigos.js <dump.sql|.sql.gz> <carpeta-salida>'); process.exit(2); }
let PGlite;
try{ ({ PGlite } = require('@electric-sql/pglite')); }
catch{ console.error('Falta @electric-sql/pglite: cd tests && npm install --no-save @electric-sql/pglite'); process.exit(2); }

// Tablas y columnas que necesita el SQL, con su tipo en Postgres.
const TABLAS = {
  proyectos: { id: 'text', nombre: 'text' },
  rubros: { id: 'text', proyecto_id: 'text', codigo: 'text', descripcion: 'text', cantidad_contrato: 'numeric', cantidad_ejecutada: 'numeric', es_orden_cambio: 'boolean' },
  libro_obra_rubros: { id: 'text', rubro_id: 'text' },
  planilla_rubros: { id: 'text', rubro_id: 'text' },
};

// Lee los bloques COPY de las tablas pedidas. Formato de pg_dump: \N es NULL; \t, \n, \r y \\ escapados.
function leerCopy(texto){
  const datos = {};
  const lineas = texto.split('\n');
  for(let i = 0; i < lineas.length; i++){
    const m = /^COPY public\.(\w+) \(([^)]*)\) FROM stdin;/.exec(lineas[i]);
    if(!m || !TABLAS[m[1]]) continue;
    const tabla = m[1], columnas = m[2].split(',').map(s => s.trim());
    const filas = [];
    for(i++; i < lineas.length && lineas[i] !== '\\.'; i++){
      const campos = lineas[i].replace(/\r$/, '').split('\t').map(c => c === '\\N' ? null : c.replace(/\\(.)/g, (_, ch) => ({ t: '\t', n: '\n', r: '\r', '\\': '\\' })[ch] ?? ch));
      const fila = {}; columnas.forEach((c, k) => { fila[c] = campos[k]; }); filas.push(fila);
    }
    datos[tabla] = filas;
  }
  for(const t of Object.keys(TABLAS)) if(!datos[t]) throw new Error('El dump no trae COPY public.' + t);
  return datos;
}

function csv(filas, columnas){
  const esc = v => v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  return [columnas.join(','), ...filas.map(f => columnas.map(c => esc(f[c])).join(','))].join('\n') + '\n';
}

(async () => {
  const crudo = fs.readFileSync(rutaDump);
  const texto = (rutaDump.endsWith('.gz') ? zlib.gunzipSync(crudo) : crudo).toString('utf8');
  const fechaDump = (/^-- Started on (.+)$/m.exec(texto) || [])[1] || (/^\\restrict|^-- Dumped from database version (.+)$/m.exec(texto) || [])[1] || '';
  const datos = leerCopy(texto);
  const db = new PGlite();
  for(const [tabla, cols] of Object.entries(TABLAS)){
    const nombres = Object.keys(cols);
    await db.exec(`create table ${tabla} (${nombres.map(c => c + ' ' + cols[c]).join(', ')})`);
    const filas = datos[tabla];
    for(let i = 0; i < filas.length; i += 500){
      const lote = filas.slice(i, i + 500), params = [], valores = [];
      lote.forEach((f, k) => { valores.push('(' + nombres.map((c, j) => '$' + (k * nombres.length + j + 1)).join(',') + ')'); nombres.forEach(c => params.push(cols[c] === 'boolean' ? (f[c] == null ? null : f[c] === 't') : f[c])); });
      await db.query(`insert into ${tabla} (${nombres.join(',')}) values ${valores.join(',')}`, params);
    }
    console.log(`${tabla}: ${filas.length} filas`);
  }
  const sql = fs.readFileSync(path.join(__dirname, 'inventario-codigos.sql'), 'utf8');
  const secciones = sql.split(/^-- @@ (\S+)\s*$/m).slice(1); // [nombre, cuerpo, nombre, cuerpo, ...]
  fs.mkdirSync(salida, { recursive: true });
  let resumen = null;
  for(let i = 0; i < secciones.length; i += 2){
    const nombre = secciones[i], cuerpo = secciones[i + 1].trim();
    const r = await db.query(cuerpo);
    if(nombre === 'base') continue;
    const columnas = r.fields.map(f => f.name);
    fs.writeFileSync(path.join(salida, nombre + '.csv'), csv(r.rows, columnas));
    console.log(`${nombre}: ${r.rows.length} filas → ${path.join(salida, nombre + '.csv')}`);
    if(nombre === 'resumen') resumen = r.rows;
  }
  if(fechaDump) fs.writeFileSync(path.join(salida, 'ORIGEN.txt'), `dump: ${path.basename(rutaDump)}\n${fechaDump}\n`);
  console.log('\nResumen por proyecto (dump ' + path.basename(rutaDump) + (fechaDump ? ', ' + fechaDump : '') + '):');
  console.table(resumen.map(r => ({ proyecto: r.proyecto, total: Number(r.total_rubros), A_ruido: Number(r.a_ruido), B_sin_codigo: Number(r.b_sin_codigo), C_repetidos: Number(r.c_repetidos) })));
  await db.close();
})().catch(e => { console.error(e); process.exit(1); });
