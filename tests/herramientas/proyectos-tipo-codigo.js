#!/usr/bin/env node
// Multiempresa: tipo, código y emisor de los proyectos EXISTENTES por el método de
// «CSV revisado + script que genera el UPDATE» (el mismo de los códigos de rubro).
// Nunca toca producción: lee un dump y escribe archivos.
//
//   1) Propuesta (CSV para revisar en Excel; UTF-8 con BOM, separador ';'):
//        node proyectos-tipo-codigo.js proponer <dump.sql|.sql.gz> <propuesta.csv> [--sigla HDV] [--ejecuta "<regex>"]
//      --sigla    sigla de la gestora para el código propuesto (por defecto HDV).
//      --ejecuta  expresión regular (sin distinguir mayúsculas) sobre el CONTRATISTA: los proyectos
//                 que coinciden son obra propia de la gestora (tipo construccion/pilotes/puentes/
//                 muros_pantalla según el nombre) y se dejan SIN código propuesto para asignarlo
//                 cuando se defina su gestora definitiva. El resto se propone como fiscalizacion.
//   2) UPDATE desde el CSV revisado:
//        node proyectos-tipo-codigo.js sql <revisado.csv> <salida.sql>
//      Columnas que se leen: id, tipo, codigo, emisor_sigla. Las demás son de contexto.
//      Vacío = no tocar esa columna. emisor_sigla es la sigla de una fila de public.empresas.
//      Se detiene, listando las filas, si hay tipo desconocido, código mal formado o repetido,
//      sigla mal formada o id repetido.
//
// El CSV lleva nombres reales de proyectos: se guarda en el repo privado
// (HidivoGdP-backups/docs/multiempresa/), nunca en este.
'use strict';
const fs = require('fs');
const zlib = require('zlib');

const TIPOS = { fiscalizacion: 'FIS', gerencia: 'GER', disenos: 'DIS', construccion: 'CON', pilotes: 'PIL', muros_pantalla: 'MUR', puentes: 'PUE' };
const RE_CODIGO = /^[A-Z0-9]{2,5}-[A-Z]{3}-[0-9]{4}-[0-9]{3}$/;
const RE_SIGLA = /^[A-Z0-9]{2,5}$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNAS = ['id', 'nombre', 'contratante', 'contratista', 'estado', 'fecha_inicio', 'tipo', 'codigo', 'emisor_sigla', 'nota'];

// ── Dump de pg_dump (COPY ... FROM stdin): \N es NULL; \t, \n, \r y \\ escapados ──
function leerProyectosDeDump(texto){
  const lineas = texto.split('\n');
  const i = lineas.findIndex(l => l.startsWith('COPY public.proyectos ('));
  if(i < 0) throw new Error('El dump no trae la tabla public.proyectos');
  const cols = /\(([^)]*)\)/.exec(lineas[i])[1].split(',').map(s => s.trim());
  const filas = [];
  for(let k = i + 1; k < lineas.length && lineas[k] !== '\\.'; k++){
    const v = lineas[k].split('\t').map(x => x === '\\N' ? null
      : x.replace(/\\([tnr\\])/g, (_, c) => ({ t: '\t', n: '\n', r: '\r', '\\': '\\' }[c])));
    filas.push(Object.fromEntries(cols.map((c, j) => [c, v[j]])));
  }
  return filas;
}

const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Tipo propuesto. `ejecuta`: la gestora es quien ejecuta la obra (el contratista coincide con --ejecuta).
function proponerTipo(p, ejecuta){
  const n = sinTildes(p.nombre);
  if(ejecuta){
    if(/muros? pantalla/.test(n)) return 'muros_pantalla';
    if(/pilot/.test(n)) return 'pilotes';
    if(/puente/.test(n)) return 'puentes';
    return 'construccion';
  }
  if(/\bgerencia\b/.test(n)) return 'gerencia';
  if(/^disenos?\b/.test(n) && !/construccion/.test(n)) return 'disenos';
  return 'fiscalizacion';
}

// Filas de la propuesta. Código: SIGLA-TIP-AAAA-NNN, correlativo por año de inicio (o de alta si no
// hay fecha de inicio), en orden de fecha. Los proyectos que ejecuta la gestora quedan sin código.
function proponer(proyectos, { sigla = 'HDV', reEjecuta = null } = {}){
  const fecha = p => (p.fecha_inicio || p.created_at || '').slice(0, 10);
  const orden = [...proyectos].sort((a, b) => fecha(a).localeCompare(fecha(b)) || String(a.nombre).localeCompare(String(b.nombre)));
  const contador = {};
  return orden.map(p => {
    const ejecuta = !!(reEjecuta && p.contratista && reEjecuta.test(p.contratista));
    const tipo = proponerTipo(p, ejecuta);
    const anio = fecha(p).slice(0, 4);
    let codigo = '', nota = '';
    if(ejecuta) nota = 'Obra propia: sin código hasta definir su gestora; revisar tipo y emisor';
    else if(!/^\d{4}$/.test(anio)) nota = 'Sin fecha: asignar el código a mano';
    else {
      contador[anio] = (contador[anio] || 0) + 1;
      codigo = `${sigla}-${TIPOS[tipo]}-${anio}-${String(contador[anio]).padStart(3, '0')}`;
      if(!p.fecha_inicio) nota = 'Año tomado de la fecha de alta (sin fecha de inicio)';
    }
    return { id: p.id, nombre: p.nombre || '', contratante: p.contratante || '', contratista: p.contratista || '',
      estado: p.estado || '', fecha_inicio: p.fecha_inicio || '', tipo, codigo, emisor_sigla: '', nota };
  });
}

// ── CSV (';', comillas dobles, BOM, CRLF) ──
const celdaCsv = v => /[";\r\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
function aCsv(filas){
  return '﻿' + [COLUMNAS.join(';'), ...filas.map(f => COLUMNAS.map(c => celdaCsv(f[c] ?? '')).join(';'))].join('\r\n') + '\r\n';
}
function leerCsv(texto){
  const t = texto.replace(/^﻿/, '');
  const filas = []; let fila = [], celda = '', comillas = false;
  for(let i = 0; i < t.length; i++){
    const ch = t[i];
    if(comillas){
      if(ch === '"'){ if(t[i + 1] === '"'){ celda += '"'; i++; } else comillas = false; }
      else celda += ch;
    } else if(ch === '"') comillas = true;
    else if(ch === ';'){ fila.push(celda); celda = ''; }
    else if(ch === '\n' || ch === '\r'){
      if(ch === '\r' && t[i + 1] === '\n') i++;
      fila.push(celda); celda = '';
      if(fila.some(x => x !== '')) filas.push(fila);
      fila = [];
    } else celda += ch;
  }
  fila.push(celda); if(fila.some(x => x !== '')) filas.push(fila);
  if(!filas.length) return [];
  const cab = filas[0].map(s => s.trim().toLowerCase());
  return filas.slice(1).map(f => Object.fromEntries(cab.map((c, j) => [c, (f[j] ?? '').trim()])));
}

// ── UPDATE desde el CSV revisado ──
function validar(filas){
  const errores = [], ids = new Set(), codigos = new Map();
  filas.forEach((f, i) => {
    const n = `fila ${i + 2}`;
    if(!RE_UUID.test(f.id || '')) errores.push(`${n}: id inválido «${f.id || ''}»`);
    else if(ids.has(f.id.toLowerCase())) errores.push(`${n}: id repetido ${f.id}`);
    else ids.add(f.id.toLowerCase());
    if(f.tipo && !TIPOS[f.tipo]) errores.push(`${n}: tipo desconocido «${f.tipo}» (válidos: ${Object.keys(TIPOS).join(', ')})`);
    if(f.codigo){
      if(!RE_CODIGO.test(f.codigo)) errores.push(`${n}: código mal formado «${f.codigo}» (SIGLA-TIP-AAAA-NNN)`);
      else if(codigos.has(f.codigo)) errores.push(`${n}: código ${f.codigo} repetido (también en la fila ${codigos.get(f.codigo)})`);
      else codigos.set(f.codigo, i + 2);
    }
    if(f.emisor_sigla && !RE_SIGLA.test(f.emisor_sigla)) errores.push(`${n}: sigla de emisor mal formada «${f.emisor_sigla}»`);
  });
  return errores;
}

const lit = s => "'" + String(s).replace(/'/g, "''") + "'";

function generarSql(filas){
  const errores = validar(filas);
  if(errores.length) throw new Error('CSV con errores:\n  ' + errores.join('\n  '));
  const cambios = filas.filter(f => f.tipo || f.codigo || f.emisor_sigla);
  const siglas = [...new Set(cambios.map(f => f.emisor_sigla).filter(Boolean))].sort();
  const updates = cambios.map(f => {
    const sets = [];
    if(f.tipo) sets.push(`tipo = ${lit(f.tipo)}`);
    if(f.codigo) sets.push(`codigo = ${lit(f.codigo)}`);
    if(f.emisor_sigla) sets.push(`emisor_empresa_id = (select id from public.empresas where sigla = ${lit(f.emisor_sigla)})`);
    return `update public.proyectos set ${sets.join(', ')} where id = ${lit(f.id.toLowerCase())};`;
  });
  const idsSql = cambios.map(f => lit(f.id.toLowerCase())).join(', ') || "''";
  return `-- Multiempresa: tipo, código y emisor de proyectos existentes.
-- Generado por tests/herramientas/proyectos-tipo-codigo.js desde el CSV revisado. NO editar a mano.
-- Aplicar en el SQL Editor DESPUÉS de las migraciones multiempresa 1 y 2. ${cambios.length} proyecto(s).
-- Si un proyecto ya tiene código y documentos emitidos, el SQL Editor (sin JWT) está exento del
-- bloqueo: este script puede corregirlo. Cambiar el emisor anota el anterior en el historial.

begin;

do $$
declare falta text; n integer;
begin
  select string_agg(s, ', ') into falta
    from unnest(array[${siglas.map(lit).join(', ')}]::text[]) s
   where not exists (select 1 from public.empresas e where e.sigla = s);
  if falta is not null then raise exception 'No existen las empresas con sigla: %', falta; end if;
  select count(*) into n from public.proyectos where id::text in (${idsSql});
  if n <> ${cambios.length} then raise exception 'El CSV trae ${cambios.length} proyectos y la base tiene % de ellos: CSV desactualizado', n; end if;
end $$;

${updates.join('\n')}

commit;

-- ── Verificación (solo lectura) ──
--   select e.sigla as gestora, p.tipo, count(*) as proyectos, count(p.codigo) as con_codigo, count(p.emisor_empresa_id) as con_emisor from public.proyectos p join public.empresas e on e.id = p.empresa_id group by 1, 2 order by 1, 2;
--   select nombre from public.proyectos where tipo is null order by 1;   -- proyectos creados después del dump: completarlos en la app

-- ── Reversión (deja tipo, código y emisor vacíos en los proyectos de este script) ──
-- begin;
--   update public.proyectos set tipo = null, codigo = null, emisor_empresa_id = null where id::text in (${idsSql});
-- commit;
`;
}

function leerTexto(ruta){
  const buf = fs.readFileSync(ruta);
  return (/\.gz$/i.test(ruta) ? zlib.gunzipSync(buf) : buf).toString('utf8');
}

function main(argv){
  const [modo, entrada, salida, ...resto] = argv;
  const opcion = n => { const i = resto.indexOf(n); return i >= 0 ? resto[i + 1] : undefined; };
  if(modo === 'proponer' && entrada && salida){
    const ejecuta = opcion('--ejecuta');
    const filas = proponer(leerProyectosDeDump(leerTexto(entrada)), { sigla: opcion('--sigla') || 'HDV', reEjecuta: ejecuta ? new RegExp(ejecuta, 'i') : null });
    fs.writeFileSync(salida, aCsv(filas));
    const porTipo = {}; filas.forEach(f => { porTipo[f.tipo] = (porTipo[f.tipo] || 0) + 1; });
    console.log(`${filas.length} proyectos → ${salida}`);
    console.log('Por tipo propuesto:', porTipo, '· sin código:', filas.filter(f => !f.codigo).length);
    return;
  }
  if(modo === 'sql' && entrada && salida){
    const filas = leerCsv(leerTexto(entrada));
    fs.writeFileSync(salida, generarSql(filas));
    console.log(`${filas.filter(f => f.tipo || f.codigo || f.emisor_sigla).length} UPDATE → ${salida}`);
    return;
  }
  console.error('Uso:\n  node proyectos-tipo-codigo.js proponer <dump.sql|.sql.gz> <propuesta.csv> [--sigla HDV] [--ejecuta "<regex>"]\n  node proyectos-tipo-codigo.js sql <revisado.csv> <salida.sql>');
  process.exit(2);
}

if(require.main === module){
  try{ main(process.argv.slice(2)); }
  catch(e){ console.error(e.message); process.exit(1); }
}

module.exports = { TIPOS, leerProyectosDeDump, proponerTipo, proponer, aCsv, leerCsv, validar, generarSql };
