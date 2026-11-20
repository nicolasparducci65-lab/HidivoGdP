// Multiempresa: herramienta «CSV revisado → UPDATE» de tipo, código y emisor de proyectos
// (tests/herramientas/proyectos-tipo-codigo.js). Datos ficticios; no usa dump ni base.
//
//   node proyectos-tipo-codigo.test.js
'use strict';
const { prueba, resumen, assert } = require('./lib/arnes');
const H = require('./herramientas/proyectos-tipo-codigo');

const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DUMP = [
  'COPY public.proyectos (id, nombre, contratante, contratista, estado, fecha_inicio, created_at) FROM stdin;',
  `${ID(1)}\tRemodelación de bodega\tCliente Uno\tConstructora X\tejecucion\t2026-03-10\t2026-03-01 10:00:00+00`,
  `${ID(2)}\tHinca de pilotes; muelle "norte"\tCliente Dos\tEJECUTORA PROPIA S.A.\tejecucion\t2026-01-15\t2026-01-02 10:00:00+00`,
  `${ID(3)}\tDiseños estructurales de galpón\tCliente Uno\t\\N\tplanificacion\t\\N\t2025-11-20 10:00:00+00`,
  `${ID(4)}\tPuente sobre el estero\tCliente Tres\tEjecutora Propia\tfinalizado\t2025-06-01\t2025-05-20 10:00:00+00`,
  `${ID(5)}\tVía de acceso\tCliente Uno\tConstructora Y\tejecucion\t2026-02-01\t2026-01-20 10:00:00+00`,
  '\\.',
  ''
].join('\n');

(async () => {
  const proyectos = H.leerProyectosDeDump(DUMP);
  const filas = H.proponer(proyectos, { sigla: 'HDV', reEjecuta: /ejecutora propia/i });
  const por = id => filas.find(f => f.id === ID(id));

  await prueba('lee los proyectos del dump (NULL y columnas por nombre)', () => {
    assert(proyectos.length === 5, 'esperaba 5 proyectos');
    assert(proyectos[2].contratista === null && proyectos[2].fecha_inicio === null, '\\N debe ser null');
  });

  await prueba('tipo propuesto: fiscalización por defecto, obra propia según el nombre, diseños', () => {
    assert(por(1).tipo === 'fiscalizacion' && por(5).tipo === 'fiscalizacion', 'terceros → fiscalizacion');
    assert(por(2).tipo === 'pilotes', 'obra propia con «pilotes» → pilotes: ' + por(2).tipo);
    assert(por(4).tipo === 'puentes', 'obra propia con «puente» → puentes');
    assert(por(3).tipo === 'disenos', '«Diseños …» → disenos: ' + por(3).tipo);
  });

  await prueba('código: correlativo por año en orden de fecha; obra propia sin código', () => {
    assert(por(5).codigo === 'HDV-FIS-2026-001', '2026 primero el de febrero: ' + por(5).codigo);
    assert(por(1).codigo === 'HDV-FIS-2026-002', 'luego el de marzo: ' + por(1).codigo);
    assert(por(3).codigo === 'HDV-DIS-2025-001' && /fecha de alta/.test(por(3).nota), 'sin fecha de inicio usa el año de alta');
    assert(por(2).codigo === '' && por(4).codigo === '' && /Obra propia/.test(por(2).nota), 'obra propia queda sin código');
    assert(filas.every(f => f.emisor_sigla === ''), 'el emisor no se propone: lo decide quien revisa');
  });

  await prueba('CSV: ida y vuelta con BOM, punto y coma y comillas', () => {
    const csv = H.aCsv(filas);
    assert(csv.charCodeAt(0) === 0xFEFF && csv.includes('\r\n'), 'BOM y CRLF');
    const vuelta = H.leerCsv(csv);
    assert(vuelta.length === 5, 'esperaba 5 filas');
    const v2 = vuelta.find(f => f.id === ID(2));
    assert(v2.nombre === 'Hinca de pilotes; muelle "norte"', 'nombre con ; y comillas: ' + v2.nombre);
  });

  await prueba('SQL: un UPDATE por proyecto con cambios; emisor por sigla; vacío = no tocar', () => {
    const revisado = H.leerCsv(H.aCsv(filas)).map(f => f.id === ID(2) ? { ...f, emisor_sigla: 'ZZE' } : f.id === ID(4) ? { ...f, tipo: '', codigo: '' } : f);
    const sql = H.generarSql(revisado);
    assert((sql.match(/^update public\.proyectos/gm) || []).length === 4, 'el proyecto sin datos no genera UPDATE');
    assert(sql.includes(`update public.proyectos set tipo = 'pilotes', emisor_empresa_id = (select id from public.empresas where sigla = 'ZZE') where id = '${ID(2)}';`), 'UPDATE del proyecto 2');
    assert(sql.includes(`set tipo = 'fiscalizacion', codigo = 'HDV-FIS-2026-002' where id = '${ID(1)}'`), 'UPDATE del proyecto 1');
    assert(sql.includes("array['ZZE']::text[]") && sql.includes('n <> 4'), 'comprobaciones previas: siglas y número de proyectos');
    assert(/^begin;/m.test(sql) && /^commit;/m.test(sql) && sql.includes('Reversión'), 'transacción y reversión');
    assert(!/Remodelación|Cliente Uno/.test(sql), 'el SQL no lleva nombres de proyectos');
  });

  await prueba('validación: tipo desconocido, código mal formado o repetido, id repetido, sigla', () => {
    const base = { id: ID(1), tipo: 'fiscalizacion', codigo: 'HDV-FIS-2026-001', emisor_sigla: '' };
    const e = H.validar([
      base,
      { ...base, id: ID(2), tipo: 'obra', codigo: '' },
      { ...base, id: ID(3), codigo: 'hdv-fis-26-1' },
      { ...base, id: ID(4) },
      { ...base, id: ID(1), codigo: 'HDV-FIS-2026-009' },
      { ...base, id: ID(5), codigo: '', emisor_sigla: 'cip' },
      { ...base, id: 'no-es-uuid', codigo: '' }
    ]);
    const tiene = re => e.some(x => re.test(x));
    assert(e.length === 6, 'esperaba 6 errores: ' + e.join(' | '));
    assert(tiene(/fila 3: tipo desconocido/) && tiene(/fila 4: código mal formado/) && tiene(/fila 5: código HDV-FIS-2026-001 repetido/), 'tipo y código');
    assert(tiene(/fila 6: id repetido/) && tiene(/fila 7: sigla de emisor/) && tiene(/fila 8: id inválido/), 'id y sigla');
    let lanzo = false; try{ H.generarSql([{ ...base, tipo: 'obra' }]); }catch(_){ lanzo = true; }
    assert(lanzo, 'generarSql se detiene con errores');
  });

  await prueba('las abreviaturas de tipo coinciden con la migración (proyecto_tipo_abrev)', () => {
    const fs = require('fs'), path = require('path');
    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261120_multiempresa_2_codigo_emisor.sql'), 'utf8');
    for(const [tipo, abrev] of Object.entries(H.TIPOS))
      assert(new RegExp(`when '${tipo}'\\s+then '${abrev}'`).test(sql), `falta ${tipo} → ${abrev} en la migración`);
    const m1 = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261120_multiempresa_1_empresas.sql'), 'utf8');
    for(const tipo of Object.keys(H.TIPOS)) assert(m1.includes(`'${tipo}'`), `falta ${tipo} en proyectos_tipo_chk`);
  });

  resumen();
})();
