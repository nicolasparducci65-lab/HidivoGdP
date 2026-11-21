#!/usr/bin/env node
// Multiempresa: tipo, código y emisor de los proyectos EXISTENTES por el método de
// «CSV revisado + script que genera el UPDATE» (el mismo de los códigos de rubro).
// Nunca toca producción: lee un dump o una exportación y escribe archivos.
//
//   1) Propuesta (CSV para revisar en Excel; UTF-8 con BOM, separador ';'):
//        node proyectos-tipo-codigo.js proponer <dump.sql|.sql.gz|export.json> <propuesta.csv> [opciones]
//      La entrada puede ser un dump de pg_dump o un JSON con un arreglo de proyectos
//      ({id, nombre, contratante, contratista, estado, fecha_inicio, creado|created_at, fecha_firma}).
//      --sigla HDV          sigla de la empresa GESTORA (por defecto HDV).
//      --ejecuta "<regex>"  sobre el CONTRATISTA (sin distinguir mayúsculas): los proyectos que
//                           coinciden son obra que ejecuta esa empresa (tipo construccion / pilotes /
//                           puentes / muros_pantalla según el nombre). El resto, fiscalizacion.
//      --emisor CIP         sigla del EMISOR documental que se propone para los que coinciden con
//                           --ejecuta (marcado REVISAR). Sin esta opción quedan con la gestora.
//      --excluir "<regex>"  sobre el NOMBRE: proyectos de prueba; se dejan sin código para que no
//                           consuman un número de la secuencia real.
//      Reglas de la propuesta:
//        · Prefijo del código = sigla del emisor; si el emisor es la gestora, la de la gestora.
//        · Año = el de la firma del contrato; si no hay fecha de firma, el de inicio; si tampoco,
//          el de alta en la plataforma. Los respaldos quedan marcados en la columna «revisar».
//        · Correlativo por prefijo y año, en orden de esa fecha.
//        · emisor_desde (solo si el emisor no es la gestora) = fecha de inicio del contrato.
//   2) UPDATE desde el CSV revisado:
//        node proyectos-tipo-codigo.js sql <revisado.csv> <salida.sql>
//      Columnas que se leen: id, tipo, codigo, emisor (o emisor_sigla) y emisor_desde. Las demás
//      son de contexto. Vacío = no tocar esa columna. emisor es la sigla de una fila de
//      public.empresas; si coincide con la gestora del proyecto se guarda como «emite la gestora».
//      emisor_desde (AAAA-MM-DD): fecha de corte del emisor anterior; los documentos con fecha
//      anterior a ella conservan el emisor de antes. Vacío = la fecha en que se aplique el UPDATE.
//      Se detiene, listando las filas, si hay tipo desconocido, código mal formado o repetido,
//      sigla o fecha mal formadas, o id repetido.
//
// El CSV lleva nombres reales de proyectos: se guarda en el repo privado
// (HidivoGdP-backups/docs/multiempresa/), nunca en este.
'use strict';
const fs = require('fs');
const zlib = require('zlib');

const TIPOS = { fiscalizacion: 'FIS', gerencia: 'GER', disenos: 'DIS', construccion: 'CON', pilotes: 'PIL', muros_pantalla: 'MUR', puentes: 'PUE' };
const RE_CODIGO = /^[A-Z0-9]{2,5}-[A-Z]{3}-[0-9]{4}-[0-9]{3}$/;
const RE_SIGLA = /^[A-Z0-9]{2,5}$/;
const RE_FECHA = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNAS = ['id', 'nombre', 'contratante', 'contratista', 'estado', 'fecha_firma', 'fecha_inicio', 'tipo', 'emisor', 'emisor_desde', 'codigo', 'revisar', 'nota'];

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
// Exportación en JSON: un arreglo de proyectos, o un objeto con la propiedad rows.
function leerProyectosDeJson(texto){
  const j = JSON.parse(texto.slice(texto.search(/[[{]/)));
  const filas = Array.isArray(j) ? j : j.rows;
  if(!Array.isArray(filas)) throw new Error('El JSON no trae un arreglo de proyectos');
  return filas;
}

const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fecha10 = v => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : ''; };

// Tipo propuesto. `ejecuta`: la empresa del contratista es quien ejecuta la obra (--ejecuta).
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

// Fecha que fija el año del código: firma del contrato; si no, inicio; si no, alta en la plataforma.
function fechaDelCodigo(p){
  const firma = fecha10(p.fecha_firma), inicio = fecha10(p.fecha_inicio), alta = fecha10(p.creado || p.created_at);
  if(firma) return { fecha: firma, origen: 'firma' };
  if(inicio) return { fecha: inicio, origen: 'inicio' };
  return { fecha: alta, origen: alta ? 'alta' : '' };
}

// Filas de la propuesta. Opciones: sigla (gestora), siglaEmisor, reEjecuta, reExcluir.
function proponer(proyectos, { sigla = 'HDV', siglaEmisor = null, reEjecuta = null, reExcluir = null } = {}){
  const base = proyectos.map(p => ({ p, f: fechaDelCodigo(p) }));
  base.sort((a, b) => a.f.fecha.localeCompare(b.f.fecha) || String(a.p.nombre).localeCompare(String(b.p.nombre)));
  const contador = {};
  return base.map(({ p, f }) => {
    const ejecuta = !!(reEjecuta && p.contratista && reEjecuta.test(p.contratista));
    const excluido = !!(reExcluir && reExcluir.test(p.nombre || ''));
    const tipo = proponerTipo(p, ejecuta);
    const emisor = (ejecuta && siglaEmisor) ? siglaEmisor : sigla;
    const esOtroEmisor = emisor !== sigla;
    const anio = f.fecha.slice(0, 4);
    const revisar = [], notas = [];
    let codigo = '';
    if(excluido) notas.push('Proyecto de pruebas: sin código, no consume la secuencia');
    else if(!/^\d{4}$/.test(anio)) { revisar.push('año'); notas.push('Sin ninguna fecha: asignar el código a mano'); }
    else {
      const clave = emisor + '-' + anio;
      contador[clave] = (contador[clave] || 0) + 1;
      codigo = `${emisor}-${TIPOS[tipo]}-${anio}-${String(contador[clave]).padStart(3, '0')}`;
      if(f.origen === 'inicio') { revisar.push('año'); notas.push('Año tomado de la fecha de inicio (sin fecha de firma)'); }
      if(f.origen === 'alta') { revisar.push('año'); notas.push('Año tomado del alta en la plataforma (sin fecha de firma ni de inicio)'); }
    }
    let emisorDesde = '';
    if(esOtroEmisor){
      revisar.unshift('emisor', 'emisor_desde');
      emisorDesde = fecha10(p.fecha_inicio);
      notas.push(`Contratista ${emisor}: confirmar si el contrato lo firmó ${emisor} (emisor ${emisor}) o si la gestora solo fiscaliza (emisor ${sigla})`);
      notas.push(emisorDesde ? 'emisor_desde = inicio del contrato; poner la fecha de hoy si debe regir solo desde ahora' : 'Sin fecha de inicio: poner emisor_desde a mano o dejarlo vacío (rige desde que se aplique)');
    }
    return { id: p.id, nombre: p.nombre || '', contratante: p.contratante || '', contratista: p.contratista || '', estado: p.estado || '',
      fecha_firma: fecha10(p.fecha_firma), fecha_inicio: fecha10(p.fecha_inicio), tipo, emisor, emisor_desde: emisorDesde, codigo,
      revisar: revisar.length ? 'REVISAR: ' + [...new Set(revisar)].join(', ') : '', nota: notas.join('. ') };
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
  return filas.slice(1).map(f => {
    const o = Object.fromEntries(cab.map((c, j) => [c, (f[j] ?? '').trim()]));
    if(o.emisor == null && o.emisor_sigla != null) o.emisor = o.emisor_sigla;   // nombre anterior de la columna
    o.emisor = o.emisor || ''; o.emisor_desde = o.emisor_desde || '';
    return o;
  });
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
    if(f.emisor && !RE_SIGLA.test(f.emisor)) errores.push(`${n}: sigla de emisor mal formada «${f.emisor}»`);
    if(f.emisor_desde){
      if(!RE_FECHA.test(f.emisor_desde) || isNaN(Date.parse(f.emisor_desde))) errores.push(`${n}: emisor_desde debe ser AAAA-MM-DD («${f.emisor_desde}»)`);
      else if(!f.emisor) errores.push(`${n}: emisor_desde sin emisor`);
    }
    if(f.codigo && f.emisor && RE_CODIGO.test(f.codigo) && RE_SIGLA.test(f.emisor) && f.codigo.split('-')[0] !== f.emisor)
      errores.push(`${n}: el código ${f.codigo} no empieza por la sigla del emisor ${f.emisor}`);
  });
  return errores;
}

const lit = s => "'" + String(s).replace(/'/g, "''") + "'";

function generarSql(filas){
  const errores = validar(filas);
  if(errores.length) throw new Error('CSV con errores:\n  ' + errores.join('\n  '));
  const cambios = filas.filter(f => f.tipo || f.codigo || f.emisor);
  const siglas = [...new Set(cambios.map(f => f.emisor).filter(Boolean))].sort();
  const sentencias = [];
  for(const f of cambios){
    const id = lit(f.id.toLowerCase()), sets = [];
    if(f.tipo) sets.push(`tipo = ${lit(f.tipo)}`);
    if(f.codigo) sets.push(`codigo = ${lit(f.codigo)}`);
    // Si el emisor indicado es la propia gestora, queda NULL («emite la gestora»).
    if(f.emisor) sets.push(`emisor_empresa_id = nullif((select id from public.empresas where sigla = ${lit(f.emisor)}), empresa_id)`);
    sentencias.push(`update public.proyectos set ${sets.join(', ')} where id = ${id};`);
    // El trigger anota el emisor anterior con fecha de corte = hoy; emisor_desde la sustituye. La fila
    // recién anotada es la de creado_en = now() (misma transacción). Si no hay exactamente una —el
    // emisor no cambió, o el script no se ejecutó entero— se detiene todo en vez de callar.
    if(f.emisor && f.emisor_desde)
      sentencias.push(`do $$ declare n integer; begin update public.proyecto_emisor_historial set hasta = ${lit(f.emisor_desde)} where proyecto_id = ${id} and creado_en = now(); get diagnostics n = row_count; if n <> 1 then raise exception 'emisor_desde del proyecto %: se esperaba 1 fila de historial recién anotada y hay % (¿el emisor ya era ese, o el script no se ejecutó entero?)', ${id}, n; end if; end $$;`);
  }
  const idsSql = cambios.map(f => lit(f.id.toLowerCase())).join(', ') || "''";
  const idsConCorte = cambios.filter(f => f.emisor && f.emisor_desde).map(f => lit(f.id.toLowerCase())).join(', ');
  const conCodigo = cambios.filter(f => f.codigo);
  const valores = conCodigo.map(f => `(${lit(f.id.toLowerCase())}, ${lit(f.codigo)}, ${lit(f.emisor)})`).join(', ');
  return `-- Multiempresa: tipo, código y emisor de proyectos existentes.
-- Generado por tests/herramientas/proyectos-tipo-codigo.js desde el CSV revisado. NO editar a mano.
-- Aplicar en el SQL Editor DESPUÉS de las migraciones multiempresa 1 y 2. ${cambios.length} proyecto(s).
-- EJECUTAR ENTERO, de una vez (no por partes ni sentencia a sentencia): las fechas de corte del
-- emisor dependen de que todo corra en la misma transacción.
-- Sin JWT (SQL Editor) los bloqueos del código y del emisor no aplican: este script puede corregir.
-- Cambiar el emisor anota el anterior en proyecto_emisor_historial con fecha de corte = hoy;
-- donde el CSV trae emisor_desde, esa fecha sustituye a la de hoy (los documentos con fecha
-- anterior a ella conservan el emisor de antes; los de esa fecha en adelante, el nuevo).

begin;

do $$
declare falta text; n integer;
begin
  select string_agg(s, ', ') into falta
    from unnest(array[${siglas.map(lit).join(', ')}]::text[]) s
   where not exists (select 1 from public.empresas e where e.sigla = s and e.activa);
  if falta is not null then raise exception 'No existen (o no están activas) las empresas con sigla: %', falta; end if;
  select count(*) into n from public.proyectos where id::text in (${idsSql});
  if n <> ${cambios.length} then raise exception 'El CSV trae ${cambios.length} proyectos y la base tiene % de ellos: CSV desactualizado', n; end if;
${conCodigo.length ? `  -- El prefijo del código es la sigla del emisor (el del CSV o, con la celda vacía, el que el
  -- proyecto ya tiene); sin emisor, la de la gestora.
  select string_agg(v.codigo, ', ') into falta
    from (values ${valores}) v(id, codigo, emisor)
    join public.proyectos p on p.id::text = v.id
    join public.empresas g on g.id = p.empresa_id
    left join public.empresas e on e.id = p.emisor_empresa_id
   where split_part(v.codigo, '-', 1) <> coalesce(nullif(v.emisor, ''), e.sigla, g.sigla);
  if falta is not null then raise exception 'Códigos cuyo prefijo no es la sigla del emisor ni de la gestora: %', falta; end if;
` : ''}${idsConCorte ? `  -- Los proyectos con emisor_desde no deben traer historial de emisor previo (el corte se fija sobre la fila nueva).
  select count(*) into n from public.proyecto_emisor_historial where proyecto_id::text in (${idsConCorte});
  if n > 0 then raise exception 'Hay % fila(s) de historial de emisor previas en proyectos con emisor_desde: revisarlas a mano antes de aplicar', n; end if;
` : ''}end $$;

${sentencias.join('\n')}

commit;

-- ── Verificación (solo lectura) ──
--   select g.sigla as gestora, coalesce(e.sigla, g.sigla) as emisor, p.tipo, count(*) as proyectos, count(p.codigo) as con_codigo from public.proyectos p join public.empresas g on g.id = p.empresa_id left join public.empresas e on e.id = p.emisor_empresa_id group by 1, 2, 3 order by 1, 2, 3;
--   select e.sigla as emisor_anterior, h.hasta, count(*) from public.proyecto_emisor_historial h join public.empresas e on e.id = h.empresa_id group by 1, 2 order by 2;
--   select nombre from public.proyectos where tipo is null order by 1;   -- proyectos creados después de la exportación: completarlos en la app

-- ── Reversión (deja tipo, código y emisor vacíos y borra el historial de emisor de estos proyectos) ──
-- begin;
--   update public.proyectos set tipo = null, codigo = null, emisor_empresa_id = null where id::text in (${idsSql});
--   delete from public.proyecto_emisor_historial where proyecto_id::text in (${idsSql});
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
    const texto = leerTexto(entrada);
    const proyectos = /\.json$/i.test(entrada) ? leerProyectosDeJson(texto) : leerProyectosDeDump(texto);
    const ejecuta = opcion('--ejecuta'), excluir = opcion('--excluir');
    const filas = proponer(proyectos, { sigla: opcion('--sigla') || 'HDV', siglaEmisor: opcion('--emisor') || null,
      reEjecuta: ejecuta ? new RegExp(ejecuta, 'i') : null, reExcluir: excluir ? new RegExp(excluir, 'i') : null });
    fs.writeFileSync(salida, aCsv(filas));
    const cuenta = campo => { const o = {}; filas.forEach(f => { o[f[campo]] = (o[f[campo]] || 0) + 1; }); return o; };
    console.log(`${filas.length} proyectos → ${salida}`);
    console.log('Por tipo:', cuenta('tipo'), '· por emisor:', cuenta('emisor'), '· sin código:', filas.filter(f => !f.codigo).length, '· con REVISAR:', filas.filter(f => f.revisar).length);
    return;
  }
  if(modo === 'sql' && entrada && salida){
    const filas = leerCsv(leerTexto(entrada));
    fs.writeFileSync(salida, generarSql(filas));
    console.log(`${filas.filter(f => f.tipo || f.codigo || f.emisor).length} proyecto(s) con cambios → ${salida}`);
    return;
  }
  console.error('Uso:\n  node proyectos-tipo-codigo.js proponer <dump.sql|.sql.gz|export.json> <propuesta.csv> [--sigla HDV] [--ejecuta "<regex>"] [--emisor CIP] [--excluir "<regex>"]\n  node proyectos-tipo-codigo.js sql <revisado.csv> <salida.sql>');
  process.exit(2);
}

if(require.main === module){
  try{ main(process.argv.slice(2)); }
  catch(e){ console.error(e.message); process.exit(1); }
}

module.exports = { TIPOS, COLUMNAS, leerProyectosDeDump, leerProyectosDeJson, proponerTipo, fechaDelCodigo, proponer, aCsv, leerCsv, validar, generarSql };
