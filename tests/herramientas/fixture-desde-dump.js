#!/usr/bin/env node
// Extrae de un dump de pg_dump (formato COPY ... FROM stdin) las filas de un
// proyecto y las escribe como fixture JSON para el arnés.
//
//   node fixture-desde-dump.js <dump.sql> <proyecto_id> <salida.json>
//
// El resultado tiene la forma { proyectos:[...], rubros:[...], ... } con las
// filas tal cual están en la base (los NULL quedan como null, los números como
// número y los jsonb parseados). Los datos reales NO se commitean: la salida
// va a tests/fixtures/*.real.json, que está en .gitignore.
'use strict';
const fs = require('fs');

const [,, rutaDump, proyectoId, salida] = process.argv;
if(!rutaDump || !proyectoId || !salida){
  console.error('Uso: node fixture-desde-dump.js <dump.sql> <proyecto_id> <salida.json>');
  process.exit(2);
}

// Tablas por proyecto (columna proyecto_id) y tablas hijas (columna padre → tabla padre).
const POR_PROYECTO = ['proyectos','contrato_anticipo','garantias','reajuste_terminos','rubros',
  'ordenes_cambio','planillas_pago','actas_recepcion','liquidaciones','proyecto_miembros'];
const HIJAS = { orden_cambio_items: ['orden_id','ordenes_cambio'], planilla_rubros: ['planilla_id','planillas_pago'],
  planilla_historial: ['planilla_id','planillas_pago'] };
const COLUMNAS_JSON = new Set(['contrato_datos','datos','reajuste_indices','modulos']);

const texto = fs.readFileSync(rutaDump, 'utf8');
const lineas = texto.split('\n');

function desescapar(v){
  if(v === '\\N') return null;
  return v.replace(/\\(.)/g, (m, c) => ({ n:'\n', t:'\t', r:'\r', '\\':'\\' }[c] ?? c));
}
function convertir(col, v){
  if(v === null) return null;
  if(COLUMNAS_JSON.has(col)){ try{ return JSON.parse(v); }catch{ return v; } }
  if(/^-?\d+(\.\d+)?$/.test(v) && !/^(id|.*_id|numero_?.*|codigo|telefono.*|ruc.*)$/.test(col) && col !== 'orden'){
    return Number(v);
  }
  if(col === 'numero' || col === 'orden') return Number(v);
  if(v === 't') return true;
  if(v === 'f') return false;
  return v;
}

function leerTabla(nombre){
  const ini = lineas.findIndex(l => l.startsWith(`COPY public.${nombre} (`));
  if(ini < 0) return { columnas: [], filas: [] };
  const columnas = lineas[ini].slice(lineas[ini].indexOf('(')+1, lineas[ini].indexOf(')')).split(',').map(s=>s.trim());
  const filas = [];
  for(let i = ini+1; i < lineas.length; i++){
    const l = lineas[i].replace(/\r$/, '');
    if(l === '\\.') break;
    const vals = l.split('\t');
    const fila = {};
    columnas.forEach((c, k) => { fila[c] = convertir(c, desescapar(vals[k] ?? '\\N')); });
    filas.push(fila);
  }
  return { columnas, filas };
}

const out = {};
for(const t of POR_PROYECTO){
  const { filas } = leerTabla(t);
  out[t] = filas.filter(f => (t === 'proyectos' ? f.id : f.proyecto_id) === proyectoId);
}
for(const [t, [colPadre, tablaPadre]] of Object.entries(HIJAS)){
  const idsPadre = new Set((out[tablaPadre]||[]).map(f => f.id));
  out[t] = leerTabla(t).filas.filter(f => idsPadre.has(f[colPadre]));
}
// Perfiles referenciados (autores, aprobadores, miembros): solo id, nombre, apellido.
const ids = new Set();
['creado_por','aprobado_por','revisado_por','autor_id','usuario_id'].forEach(c =>
  Object.values(out).flat().forEach(f => { if(f && f[c]) ids.add(f[c]); }));
out.perfiles = leerTabla('perfiles').filas.filter(p => ids.has(p.id)).map(p => ({ id:p.id, nombre:p.nombre, apellido:p.apellido, rol:p.rol }));

fs.writeFileSync(salida, JSON.stringify(out, null, 1));
console.log(Object.entries(out).map(([t, f]) => `${t}: ${f.length}`).join(' · '));
