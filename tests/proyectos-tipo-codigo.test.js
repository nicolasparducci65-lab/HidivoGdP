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
// Exportación en JSON, con fecha de firma: la firma manda sobre el inicio para el año del código.
const EXPORT = JSON.stringify({ rows: [
  { id: ID(1), nombre: 'Remodelación de bodega', contratista: 'Constructora X', fecha_inicio: '2026-03-10', creado: '2026-03-01', fecha_firma: '2025-12-20' },
  { id: ID(2), nombre: 'Hinca de pilotes', contratista: 'EJECUTORA PROPIA S.A.', fecha_inicio: '2026-01-15', creado: '2026-01-02', fecha_firma: null },
  { id: ID(4), nombre: 'Puente sobre el estero', contratista: 'Ejecutora Propia', fecha_inicio: null, creado: '2025-05-20', fecha_firma: '2025-04-02' },
  { id: ID(5), nombre: 'Vía de acceso', contratista: 'Constructora Y', fecha_inicio: '2026-02-01', creado: '2026-01-20', fecha_firma: null },
  { id: ID(6), nombre: 'PRUEBAS internas', contratista: 'Interno', fecha_inicio: null, creado: '2026-07-01', fecha_firma: null },
  { id: ID(7), nombre: 'Muro pantalla del sótano', contratista: 'Ejecutora Propia', fecha_inicio: '2026-05-05', creado: '2026-05-01', fecha_firma: '2026-04-30' }
] });

(async () => {
  const proyectos = H.leerProyectosDeDump(DUMP);
  const filas = H.proponer(proyectos, { sigla: 'HDV', reEjecuta: /ejecutora propia/i });
  const por = id => filas.find(f => f.id === ID(id));

  await prueba('lee los proyectos del dump (NULL y columnas por nombre) y de una exportación JSON', () => {
    assert(proyectos.length === 5, 'esperaba 5 proyectos');
    assert(proyectos[2].contratista === null && proyectos[2].fecha_inicio === null, '\\N debe ser null');
    assert(H.leerProyectosDeJson(EXPORT).length === 6 && H.leerProyectosDeJson('[{"id":"x"}]').length === 1, 'JSON con rows o arreglo directo');
  });

  await prueba('tipo propuesto: fiscalización por defecto, obra propia según el nombre, diseños', () => {
    assert(por(1).tipo === 'fiscalizacion' && por(5).tipo === 'fiscalizacion', 'terceros → fiscalizacion');
    assert(por(2).tipo === 'pilotes', 'obra propia con «pilotes» → pilotes: ' + por(2).tipo);
    assert(por(4).tipo === 'puentes', 'obra propia con «puente» → puentes');
    assert(por(3).tipo === 'disenos', '«Diseños …» → disenos: ' + por(3).tipo);
  });

  await prueba('sin --emisor: todo con la sigla de la gestora, correlativo por año', () => {
    assert(filas.every(f => f.emisor === 'HDV' && f.emisor_desde === ''), 'emisor = la gestora, sin emisor_desde');
    assert(por(5).codigo === 'HDV-FIS-2026-002' && por(1).codigo === 'HDV-FIS-2026-003' && por(2).codigo === 'HDV-PIL-2026-001', 'correlativo 2026 por fecha: ' + [por(2).codigo, por(5).codigo, por(1).codigo]);
    assert(por(3).codigo === 'HDV-DIS-2025-002' && /alta en la plataforma/.test(por(3).nota) && /REVISAR: año/.test(por(3).revisar), 'sin firma ni inicio usa el alta y lo marca');
    assert(/REVISAR: año/.test(por(1).revisar) && /fecha de inicio/.test(por(1).nota), 'sin firma usa el inicio y lo marca');
  });

  await prueba('con --emisor: prefijo del emisor, secuencia propia, emisor_desde = inicio y marca REVISAR', () => {
    const f2 = H.proponer(H.leerProyectosDeJson(EXPORT), { sigla: 'HDV', siglaEmisor: 'CIP', reEjecuta: /ejecutora propia/i, reExcluir: /^pruebas/i });
    const p = id => f2.find(f => f.id === ID(id));
    assert(p(2).emisor === 'CIP' && p(2).codigo === 'CIP-PIL-2026-001' && p(2).emisor_desde === '2026-01-15', JSON.stringify(p(2)));
    assert(p(7).codigo === 'CIP-MUR-2026-002' && p(7).tipo === 'muros_pantalla', 'segundo de CIP en 2026: ' + p(7).codigo);
    assert(p(4).codigo === 'CIP-PUE-2025-001' && p(4).emisor_desde === '' && /Sin fecha de inicio/.test(p(4).nota), 'año de la firma; sin inicio no hay emisor_desde: ' + JSON.stringify(p(4)));
    assert(/^REVISAR: emisor, emisor_desde/.test(p(2).revisar) && /confirmar si el contrato lo firmó CIP/.test(p(2).nota), 'marca REVISAR con la pregunta');
    assert(p(1).emisor === 'HDV' && p(1).codigo === 'HDV-FIS-2025-001' && p(1).revisar === '', 'la firma (dic-2025) manda sobre el inicio (mar-2026): ' + p(1).codigo);
    assert(p(5).codigo === 'HDV-FIS-2026-001', 'la secuencia de HDV no cuenta los de CIP: ' + p(5).codigo);
    assert(p(6).codigo === '' && /Proyecto de pruebas/.test(p(6).nota), 'el proyecto de pruebas no consume número');
  });

  await prueba('CSV: ida y vuelta con BOM, punto y coma y comillas; acepta la columna antigua emisor_sigla', () => {
    const csv = H.aCsv(filas);
    assert(csv.charCodeAt(0) === 0xFEFF && csv.includes('\r\n'), 'BOM y CRLF');
    const vuelta = H.leerCsv(csv);
    assert(vuelta.length === 5, 'esperaba 5 filas');
    assert(vuelta.find(f => f.id === ID(2)).nombre === 'Hinca de pilotes; muelle "norte"', 'nombre con ; y comillas');
    const viejo = H.leerCsv('id;tipo;codigo;emisor_sigla\r\n' + ID(1) + ';pilotes;;ZZE\r\n');
    assert(viejo[0].emisor === 'ZZE' && viejo[0].emisor_desde === '', 'emisor_sigla se lee como emisor');
  });

  await prueba('SQL: UPDATE por proyecto; emisor igual a la gestora queda NULL; emisor_desde fija el corte', () => {
    const revisado = [
      { id: ID(1), tipo: 'fiscalizacion', codigo: 'HDV-FIS-2026-002', emisor: 'HDV', emisor_desde: '' },
      { id: ID(2), tipo: 'pilotes', codigo: 'CIP-PIL-2026-001', emisor: 'CIP', emisor_desde: '2026-01-15' },
      { id: ID(3), tipo: 'puentes', codigo: '', emisor: 'CIP', emisor_desde: '' },
      { id: ID(4), tipo: '', codigo: '', emisor: '', emisor_desde: '' }
    ];
    const sql = H.generarSql(revisado);
    assert((sql.match(/^update public\.proyectos/gm) || []).length === 3, 'el proyecto sin datos no genera UPDATE');
    assert(sql.includes(`update public.proyectos set tipo = 'pilotes', codigo = 'CIP-PIL-2026-001', emisor_empresa_id = nullif((select id from public.empresas where sigla = 'CIP'), empresa_id) where id = '${ID(2)}';`), 'UPDATE del proyecto 2');
    assert(sql.includes(`update public.proyecto_emisor_historial set hasta = '2026-01-15' where proyecto_id = '${ID(2)}' and creado_en = now(); get diagnostics n = row_count; if n <> 1 then raise exception`), 'corte del emisor anterior en emisor_desde, comprobando que tocó exactamente una fila');
    assert(/EJECUTAR ENTERO/.test(sql) && sql.includes(`from public.proyecto_emisor_historial where proyecto_id::text in ('${ID(2)}')`), 'avisa de ejecutarlo entero y comprueba que no haya historial previo');
    assert((sql.match(/proyecto_emisor_historial set hasta/g) || []).length === 1, 'sin emisor_desde no se toca la fecha de corte');
    assert(sql.includes("array['CIP', 'HDV']::text[]") && sql.includes('n <> 3'), 'comprobaciones previas: siglas activas y número de proyectos');
    assert(sql.includes("coalesce(nullif(v.emisor, ''), e.sigla, g.sigla)") && sql.includes('left join public.empresas e on e.id = p.emisor_empresa_id') && sql.includes(`('${ID(2)}', 'CIP-PIL-2026-001', 'CIP')`), 'comprueba que el prefijo sea el del emisor o la gestora');
    assert(/^begin;/m.test(sql) && /^commit;/m.test(sql) && sql.includes('Reversión') && sql.includes('delete from public.proyecto_emisor_historial'), 'transacción y reversión');
    assert(!/Remodelación|Cliente Uno/.test(sql), 'el SQL no lleva nombres de proyectos');
  });

  await prueba('validación: tipo, código mal formado o repetido, id repetido, sigla, fecha y prefijo', () => {
    const base = { id: ID(1), tipo: 'fiscalizacion', codigo: 'HDV-FIS-2026-001', emisor: '', emisor_desde: '' };
    const e = H.validar([
      base,
      { ...base, id: ID(2), tipo: 'obra', codigo: '' },
      { ...base, id: ID(3), codigo: 'hdv-fis-26-1' },
      { ...base, id: ID(4) },
      { ...base, id: ID(1), codigo: 'HDV-FIS-2026-009' },
      { ...base, id: ID(5), codigo: '', emisor: 'cip' },
      { ...base, id: 'no-es-uuid', codigo: '' },
      { ...base, id: ID(6), codigo: '', emisor: 'CIP', emisor_desde: '15/01/2026' },
      { ...base, id: ID(7), codigo: '', emisor_desde: '2026-01-15' },
      { ...base, id: ID(8), codigo: 'HDV-PIL-2026-005', emisor: 'CIP' }
    ]);
    const tiene = re => e.some(x => re.test(x));
    assert(e.length === 9, 'esperaba 9 errores: ' + e.join(' | '));
    assert(tiene(/fila 3: tipo desconocido/) && tiene(/fila 4: código mal formado/) && tiene(/fila 5: código HDV-FIS-2026-001 repetido/), 'tipo y código');
    assert(tiene(/fila 6: id repetido/) && tiene(/fila 7: sigla de emisor/) && tiene(/fila 8: id inválido/), 'id y sigla');
    assert(tiene(/fila 9: emisor_desde debe ser AAAA-MM-DD/) && tiene(/fila 10: emisor_desde sin emisor/) && tiene(/fila 11: el código HDV-PIL-2026-005 no empieza por la sigla del emisor CIP/), 'fecha y prefijo');
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
