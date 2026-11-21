// Migración 20261121_exportaciones_estado.sql ejecutada de verdad en un Postgres
// embebido (pglite): tabla, RLS, permisos, registro de corridas, vigilante y tarea
// de pg_cron (con un doble mínimo del esquema cron). Datos sintéticos; nunca toca
// producción ni la red.
//
//   node exportaciones-estado-migracion.test.js
//
// Requiere @electric-sql/pglite, que no es dependencia del arnés (pesa ~10 MB):
//   cd tests && npm install --no-save @electric-sql/pglite
// Si no está instalado, la prueba FALLA (código 1) con ese mensaje: una omisión
// silenciosa dejaría «npm test» en verde sin haber probado la migración. Para
// omitirla a sabiendas: variable OMITIR_PGLITE=1 (la salida lo dice).
'use strict';
const path = require('path');
const { RAIZ, leer, prueba, resumen, assert } = require('./lib/arnes');

let PGlite;
try{ ({ PGlite } = require('@electric-sql/pglite')); }
catch{
  const COMO = 'cd tests && npm install --no-save @electric-sql/pglite';
  if(process.env.OMITIR_PGLITE === '1'){
    console.log('  – OMITIDA a propósito (OMITIR_PGLITE=1): la migración 20261121 NO se ha probado. Falta @electric-sql/pglite (' + COMO + ')');
    process.exit(0);
  }
  console.error('  ✗ exportaciones-estado-migracion: falta @electric-sql/pglite y la migración no se puede probar.\n' +
    '      Instálalo con:  ' + COMO + '\n' +
    '      o, para omitir esta prueba a sabiendas, define la variable OMITIR_PGLITE=1.');
  process.exit(1);
}

const MIGRACION = leer(path.join(RAIZ, 'supabase', 'migrations', '20261121_exportaciones_estado.sql'));
const ADMIN_1 = '00000000-0000-4000-8000-0000000000a1';
const ADMIN_2 = '00000000-0000-4000-8000-0000000000a2';
const USUARIO = '00000000-0000-4000-8000-0000000000b1';

// Lo mínimo de Supabase que la migración da por hecho: roles, auth.uid(), perfiles,
// notificaciones (columnas del esquema real), sst_es_admin_global() y los privilegios
// por defecto (Supabase concede todo a anon/authenticated/service_role al crear objetos).
const BASE = `
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
  create table public.perfiles (id uuid primary key, nombre text, rol text);
  create table public.notificaciones (
    id uuid default gen_random_uuid() not null primary key, perfil_id uuid references public.perfiles(id) on delete cascade,
    tipo text, titulo text not null, mensaje text, leida boolean default false, url_destino text,
    created_at timestamptz default now());
  create function public.sst_es_admin_global() returns boolean language sql stable security definer as $$
    select exists (select 1 from perfiles p where p.id = auth.uid() and p.rol = 'admin'); $$;
  insert into public.perfiles (id, nombre, rol) values
    ('${ADMIN_1}', 'ZZZ Admin Uno', 'admin'), ('${ADMIN_2}', 'ZZZ Admin Dos', 'admin'), ('${USUARIO}', 'ZZZ Usuario', 'usuario');
  -- Doble de pg_cron: misma firma que cron.schedule(nombre, horario, comando) y cron.unschedule(nombre)
  create schema cron;
  create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true);
  create function cron.schedule(p_nombre text, p_horario text, p_comando text) returns bigint language plpgsql as $$
    declare v bigint; begin
      insert into cron.job (jobname, schedule, command) values (p_nombre, p_horario, p_comando) returning jobid into v; return v;
    end $$;
  create function cron.unschedule(p_nombre text) returns boolean language plpgsql as $$
    begin delete from cron.job where jobname = p_nombre; if not found then raise exception 'could not find valid entry for job'; end if; return true; end $$;
`;

async function nueva(){
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(MIGRACION);
  return db;
}
const uno = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const HOY_EC = `(now() at time zone 'America/Guayaquil')::date`;
// Ejecuta fn con el rol y el usuario indicados, y vuelve siempre al rol dueño.
async function como(db, rol, uid, fn){
  await db.exec(`set role ${rol}; set prueba.uid = '${uid || ''}';`);
  try{ return await fn(); } finally{ await db.exec(`reset role; set prueba.uid = '';`); }
}
async function falla(fn){ try{ await fn(); return null; }catch(e){ return e; } }

(async () => {
  await prueba('la migración se aplica dos veces sin error y deja UNA tarea de cron a las 10:20 UTC', async () => {
    const db = await nueva();
    await db.exec(MIGRACION);
    const jobs = (await db.query(`select jobname, schedule, command, active from cron.job`)).rows;
    assert(jobs.length === 1, 'se esperaba 1 tarea y hay ' + jobs.length);
    assert(jobs[0].jobname === 'exportacion-estado-vigilante' && jobs[0].schedule === '20 10 * * *', JSON.stringify(jobs[0]));
    assert(/select public\.exportacion_estado_vigilar\(\);/.test(jobs[0].command), 'comando inesperado: ' + jobs[0].command);
    await db.exec(jobs[0].command);   // el comando programado se puede ejecutar tal cual
  });

  await prueba('permisos: authenticated solo lee la tabla; las funciones son solo de service_role (y del dueño)', async () => {
    const db = await nueva();
    const t = await uno(db, `select
      has_table_privilege('authenticated', 'public.exportaciones_estado', 'select') as a_sel,
      has_table_privilege('authenticated', 'public.exportaciones_estado', 'insert') as a_ins,
      has_table_privilege('authenticated', 'public.exportaciones_estado', 'delete') as a_del,
      has_table_privilege('anon', 'public.exportaciones_estado', 'select') as n_sel,
      has_table_privilege('service_role', 'public.exportaciones_estado', 'insert') as s_ins,
      has_function_privilege('authenticated', 'public.exportacion_estado_registrar(boolean, text, text)', 'execute') as a_reg,
      has_function_privilege('anon', 'public.exportacion_estado_registrar(boolean, text, text)', 'execute') as n_reg,
      has_function_privilege('service_role', 'public.exportacion_estado_registrar(boolean, text, text)', 'execute') as s_reg,
      has_function_privilege('authenticated', 'public.exportacion_estado_vigilar()', 'execute') as a_vig,
      has_function_privilege('anon', 'public.exportacion_estado_vigilar()', 'execute') as n_vig,
      has_function_privilege('service_role', 'public.exportacion_estado_vigilar()', 'execute') as s_vig,
      (select relrowsecurity from pg_class where oid = 'public.exportaciones_estado'::regclass) as rls`);
    assert(t.a_sel && !t.a_ins && !t.a_del && !t.n_sel && t.s_ins, 'permisos de tabla: ' + JSON.stringify(t));
    assert(!t.a_reg && !t.n_reg && t.s_reg && !t.a_vig && !t.n_vig && t.s_vig, 'permisos de función: ' + JSON.stringify(t));
    assert(t.rls === true, 'la tabla no tiene RLS activada');
    const firmas = (await db.query(`select pg_get_function_identity_arguments(oid) as args from pg_proc where proname = 'exportacion_estado_registrar'`)).rows;
    assert(firmas.length === 1 && firmas[0].args === 'p_ok boolean, p_detalle text, p_aviso text', 'firmas de registrar: ' + JSON.stringify(firmas));
    const e0 = await como(db, 'authenticated', ADMIN_1, () => falla(() => db.query(`select public.exportacion_estado_registrar(true, 'zz', 'zz aviso')`)));
    assert(e0 && e0.code === '42501', 'un usuario de la app pudo llamar a registrar con tres argumentos: ' + (e0 && e0.code));
    const e1 = await como(db, 'authenticated', ADMIN_1, () => falla(() => db.query(`select public.exportacion_estado_registrar(true, 'zz')`)));
    assert(e1 && e1.code === '42501', 'un usuario de la app pudo llamar a registrar: ' + (e1 && e1.code));
    const e2 = await como(db, 'authenticated', ADMIN_1, () => falla(() => db.query(`select public.exportacion_estado_vigilar()`)));
    assert(e2 && e2.code === '42501', 'un usuario de la app pudo llamar al vigilante');
    const e3 = await como(db, 'authenticated', ADMIN_1, () => falla(() => db.query(`insert into public.exportaciones_estado (fecha, ok) values (current_date, true)`)));
    assert(e3 && e3.code === '42501', 'un usuario de la app pudo insertar en la tabla');
  });

  await prueba('RLS: solo el admin global ve las filas', async () => {
    const db = await nueva();
    await db.query(`select public.exportacion_estado_registrar(true, 'ZZZ 3 proyectos de 4; bloques fallidos: 0')`);
    const nAdmin = await como(db, 'authenticated', ADMIN_1, () => uno(db, `select count(*)::int as n from public.exportaciones_estado`));
    const nOtro = await como(db, 'authenticated', USUARIO, () => uno(db, `select count(*)::int as n from public.exportaciones_estado`));
    assert(nAdmin.n === 1, 'el admin global debía ver 1 fila y ve ' + nAdmin.n);
    assert(nOtro.n === 0, 'un usuario normal ve ' + nOtro.n + ' filas');
  });

  await prueba('corrida buena: una fila ok con la fecha de Ecuador y ningún aviso', async () => {
    const db = await nueva();
    await db.query(`select public.exportacion_estado_registrar(true, '  ZZZ 3 proyectos de 4; bloques fallidos: 0  ')`);
    const f = await uno(db, `select ok, detalle, aviso, fecha = ${HOY_EC} as hoy, creado_en is not null as con_hora from public.exportaciones_estado`);
    assert(f.ok === true && f.hoy === true && f.con_hora && f.aviso === null, JSON.stringify(f));
    assert(f.detalle === 'ZZZ 3 proyectos de 4; bloques fallidos: 0', 'detalle sin recortar espacios: «' + f.detalle + '»');
    assert((await uno(db, `select count(*)::int as n from public.notificaciones`)).n === 0, 'una corrida buena no debe avisar');
  });

  await prueba('corrida fallida: un aviso por cada admin global, con título y mensaje, y a nadie más', async () => {
    const db = await nueva();
    await db.query(`select public.exportacion_estado_registrar(false, 'ZZZ Falló el paso «Subir a Drive»')`);
    const f = await uno(db, `select ok, detalle from public.exportaciones_estado`);
    assert(f.ok === false && f.detalle === 'ZZZ Falló el paso «Subir a Drive»', JSON.stringify(f));
    const n = (await db.query(`select perfil_id, tipo, titulo, mensaje, leida from public.notificaciones order by perfil_id`)).rows;
    assert(n.length === 2 && n[0].perfil_id === ADMIN_1 && n[1].perfil_id === ADMIN_2, 'destinatarios: ' + JSON.stringify(n.map(x => x.perfil_id)));
    assert(n.every(x => x.tipo === 'exportacion_estado' && x.leida === false), 'tipo o leída inesperados');
    assert(n[0].titulo === 'La exportación diaria del estado falló', n[0].titulo);
    assert(n[0].mensaje.startsWith('ZZZ Falló el paso «Subir a Drive»') && n[0].mensaje.includes('válido para'), n[0].mensaje);
  });

  await prueba('detalle vacío o larguísimo: no rompe; se guarda null o los primeros 500 caracteres', async () => {
    const db = await nueva();
    await db.query(`select public.exportacion_estado_registrar(false, null)`);
    await db.query(`select public.exportacion_estado_registrar(false, $1)`, ['Z'.repeat(2000)]);
    const filas = (await db.query(`select detalle, length(detalle) as largo from public.exportaciones_estado order by creado_en, detalle nulls first`)).rows;
    assert(filas.some(f => f.detalle === null) && filas.some(f => f.largo === 500), JSON.stringify(filas.map(f => f.largo)));
    assert((await uno(db, `select count(*)::int as n from public.notificaciones where mensaje like 'La corrida no dio detalle.%'`)).n === 2, 'falta el texto por defecto');
    const e = await falla(() => db.query(`select public.exportacion_estado_registrar(null, 'zz')`));
    assert(e && e.code === '22004', 'ok nulo debía rechazarse');
  });

  await prueba('vigilante: sin corrida buena de hoy avisa a cada admin UNA vez; la segunda llamada no duplica', async () => {
    const db = await nueva();
    const v1 = await uno(db, `select public.exportacion_estado_vigilar() as n`);
    const v2 = await uno(db, `select public.exportacion_estado_vigilar() as n`);
    assert(v1.n === 2, 'la primera llamada debía dejar 2 avisos y dejó ' + v1.n);
    assert(v2.n === 0, 'la segunda llamada duplicó: ' + v2.n);
    const n = (await db.query(`select titulo, mensaje from public.notificaciones`)).rows;
    assert(n.length === 2 && n[0].titulo === 'La exportación diaria del estado no se generó', JSON.stringify(n));
    assert(/\(\d{4}-\d{2}-\d{2}\)/.test(n[0].mensaje), 'el mensaje no trae la fecha: ' + n[0].mensaje);
    assert((await uno(db, `select count(*)::int as n from public.exportaciones_estado`)).n === 0, 'el vigilante no debe escribir en el registro');
  });

  await prueba('vigilante: con una corrida buena de hoy no avisa; una corrida buena de AYER no cuenta', async () => {
    const db = await nueva();
    await db.exec(`insert into public.exportaciones_estado (fecha, ok, detalle) values (${HOY_EC} - 1, true, 'ZZZ ayer')`);
    assert((await uno(db, `select public.exportacion_estado_vigilar() as n`)).n === 2, 'la corrida de ayer no debía silenciar al vigilante');
    const db2 = await nueva();
    await db2.query(`select public.exportacion_estado_registrar(true, 'ZZZ hoy')`);
    assert((await uno(db2, `select public.exportacion_estado_vigilar() as n`)).n === 0, 'avisó aunque había corrida buena de hoy');
  });

  await prueba('vigilante: si la corrida fallida ya avisó hoy no repite; un aviso de ayer no lo impide', async () => {
    const db = await nueva();
    await db.query(`select public.exportacion_estado_registrar(false, 'ZZZ fallo de las 03:10')`);
    assert((await uno(db, `select public.exportacion_estado_vigilar() as n`)).n === 0, 'duplicó el aviso de la corrida fallida');
    // A un admin se le envejece el aviso: solo él recibe el de hoy
    await db.query(`update public.notificaciones set created_at = now() - interval '1 day' where perfil_id = $1`, [ADMIN_2]);
    assert((await uno(db, `select public.exportacion_estado_vigilar() as n`)).n === 1, 'debía avisar solo al admin sin aviso de hoy');
  });

  await prueba('primer intento falla y el segundo sale bien: se retiran los avisos de HOY y se conservan los anteriores', async () => {
    const db = await nueva();
    await db.query(`select public.exportacion_estado_registrar(false, 'ZZZ fallo de las 03:10')`);
    await db.exec(`insert into public.notificaciones (perfil_id, tipo, titulo, mensaje, created_at) values
      ('${ADMIN_1}', 'exportacion_estado', 'ZZZ aviso de ayer', 'ZZZ', now() - interval '1 day'),
      ('${ADMIN_1}', 'resumen_cartera', 'ZZZ resumen de hoy', 'ZZZ', now())`);
    await db.query(`select public.exportacion_estado_registrar(true, 'ZZZ 3 proyectos de 4; bloques fallidos: 0')`);
    const quedan = (await db.query(`select titulo from public.notificaciones order by titulo`)).rows.map(r => r.titulo);
    assert(JSON.stringify(quedan) === JSON.stringify(['ZZZ aviso de ayer', 'ZZZ resumen de hoy']), 'quedaron: ' + JSON.stringify(quedan));
    assert((await uno(db, `select public.exportacion_estado_vigilar() as n`)).n === 0, 'el vigilante avisó tras la corrida buena');
    const reg = (await db.query(`select ok from public.exportaciones_estado order by creado_en, ok`)).rows.map(r => r.ok);
    assert(reg.length === 2 && reg.includes(true) && reg.includes(false), 'el registro debía conservar las dos corridas');
  });

  await prueba('el registro condicional del segundo intento (sentencia del workflow) no duplica la fila buena', async () => {
    const db = await nueva();
    const sql = `select public.exportacion_estado_registrar(true, 'ZZZ ya estaba')
                  where not exists (select 1 from public.exportaciones_estado where ok and fecha = ${HOY_EC})`;
    await db.query(sql); await db.query(sql);
    assert((await uno(db, `select count(*)::int as n from public.exportaciones_estado where ok`)).n === 1, 'duplicó el registro');
  });

  await prueba('la firma antigua de dos parámetros se retira: la llamada con dos argumentos no es ambigua', async () => {
    const db = new PGlite();
    await db.exec(BASE);
    // Como si se hubiera aplicado la versión anterior del archivo
    await db.exec(`create function public.exportacion_estado_registrar(p_ok boolean, p_detalle text) returns void language sql as $$ select null::void $$;`);
    await db.exec(MIGRACION);
    await db.query(`select public.exportacion_estado_registrar(true, 'ZZZ dos argumentos')`);
    const n = await uno(db, `select count(*)::int as n from pg_proc where proname = 'exportacion_estado_registrar'`);
    assert(n.n === 1, 'quedaron ' + n.n + ' firmas');
    assert((await uno(db, `select count(*)::int as n from public.exportaciones_estado where ok`)).n === 1, 'la llamada no usó la función nueva');
  });

  await prueba('corrida DEGRADADA (ok con aviso): fila ok con el aviso, una notificación por admin global y el vigilante calla', async () => {
    const db = await nueva();
    await db.query(`select public.exportacion_estado_registrar(true, 'ZZZ 3 proyectos; bloques fallidos: 4', '  ZZZ Corrida degradada: 4 bloques sin calcular  ')`);
    const f = await uno(db, `select ok, detalle, aviso from public.exportaciones_estado`);
    assert(f.ok === true && f.detalle === 'ZZZ 3 proyectos; bloques fallidos: 4' && f.aviso === 'ZZZ Corrida degradada: 4 bloques sin calcular', JSON.stringify(f));
    const n = (await db.query(`select perfil_id, tipo, titulo, mensaje from public.notificaciones order by perfil_id`)).rows;
    assert(n.length === 2 && n[0].perfil_id === ADMIN_1 && n[1].perfil_id === ADMIN_2, 'destinatarios: ' + JSON.stringify(n.map(x => x.perfil_id)));
    assert(n.every(x => x.tipo === 'exportacion_estado' && x.titulo === 'La exportación diaria del estado salió incompleta'), JSON.stringify(n.map(x => x.titulo)));
    assert(n[0].mensaje.startsWith('ZZZ Corrida degradada: 4 bloques sin calcular ') && n[0].mensaje.includes('sí están en Drive'), n[0].mensaje);
    assert((await uno(db, `select public.exportacion_estado_vigilar() as n`)).n === 0, 'el vigilante avisó aunque la corrida degradada cuenta como buena');
    assert((await uno(db, `select count(*)::int as n from public.notificaciones`)).n === 2, 'el vigilante añadió avisos');
  });

  await prueba('corrida degradada: no borra los avisos de hoy; la siguiente corrida buena sin aviso sí los retira todos', async () => {
    const db = await nueva();
    await db.query(`select public.exportacion_estado_registrar(false, 'ZZZ fallo de las 03:10')`);
    await db.query(`select public.exportacion_estado_registrar(true, 'ZZZ degradada', 'ZZZ aviso de bloques')`);
    const t = (await db.query(`select titulo, count(*)::int as n from public.notificaciones group by titulo order by titulo`)).rows;
    assert(t.length === 2 && t.every(x => x.n === 2), 'debían quedar los dos avisos de hoy para cada admin: ' + JSON.stringify(t));
    await db.query(`select public.exportacion_estado_registrar(true, 'ZZZ corrida manual buena')`);
    assert((await uno(db, `select count(*)::int as n from public.notificaciones`)).n === 0, 'la corrida buena no retiró los avisos de hoy');
    const reg = (await db.query(`select ok, aviso is not null as con_aviso from public.exportaciones_estado`)).rows;
    assert(reg.length === 3 && reg.filter(x => x.ok).length === 2 && reg.filter(x => x.con_aviso).length === 1, 'registro: ' + JSON.stringify(reg));
  });

  await prueba('el tercer parámetro vacío o en blanco equivale a nulo; en una corrida fallida no se guarda ni cambia el aviso', async () => {
    const db = await nueva();
    await db.query(`select public.exportacion_estado_registrar(false, 'ZZZ fallo previo')`);
    await db.query(`select public.exportacion_estado_registrar(true, 'ZZZ buena', $1)`, ['   ']);
    assert((await uno(db, `select count(*)::int as n from public.notificaciones`)).n === 0, 'un aviso en blanco debía tratarse como corrida buena (retira los avisos de hoy)');
    await db.query(`select public.exportacion_estado_registrar(false, 'ZZZ fallo previo')`);
    await db.query(`select public.exportacion_estado_registrar(true, 'ZZZ buena', nullif($1, ''))`, ['']);   // la forma en que lo llama el workflow
    assert((await uno(db, `select count(*)::int as n from public.notificaciones`)).n === 0, 'un aviso vacío pasado con nullif debía ser corrida buena');
    await db.query(`select public.exportacion_estado_registrar(false, 'ZZZ fallo', 'ZZZ aviso que no aplica')`);
    const f = await uno(db, `select aviso from public.exportaciones_estado where detalle = 'ZZZ fallo'`);
    assert(f.aviso === null, 'una corrida fallida guardó el aviso: ' + f.aviso);
    const n = (await db.query(`select titulo, mensaje from public.notificaciones`)).rows;
    assert(n.length === 2 && n.every(x => x.titulo === 'La exportación diaria del estado falló' && x.mensaje.startsWith('ZZZ fallo ')), JSON.stringify(n));
    await db.query(`select public.exportacion_estado_registrar(true, 'ZZZ', $1)`, ['Z'.repeat(2000)]);
    assert((await uno(db, `select length(aviso) as l from public.exportaciones_estado where length(aviso) > 100`)).l === 500, 'el aviso no se recortó a 500');
  });

  await prueba('limpieza de 90 días: se borran las filas y los avisos de este tipo con más de 90 días, y nada más (en los tres caminos)', async () => {
    for(const llamada of [`(true, 'ZZZ buena')`, `(false, 'ZZZ fallida')`, `(true, 'ZZZ degradada', 'ZZZ aviso')`]){
      const db = await nueva();
      await db.exec(`
        insert into public.exportaciones_estado (fecha, ok, detalle) values
          (${HOY_EC} - 200, false, 'ZZZ fila 200'), (${HOY_EC} - 91, true, 'ZZZ fila 91'),
          (${HOY_EC} - 90, true, 'ZZZ fila 90'), (${HOY_EC} - 1, false, 'ZZZ fila 1');
        insert into public.notificaciones (perfil_id, tipo, titulo, mensaje, created_at) values
          ('${ADMIN_1}', 'exportacion_estado', 'ZZZ aviso 200', 'ZZZ', now() - interval '200 days'),
          ('${ADMIN_1}', 'exportacion_estado', 'ZZZ aviso 92', 'ZZZ', now() - interval '92 days'),
          ('${ADMIN_1}', 'exportacion_estado', 'ZZZ aviso 89', 'ZZZ', now() - interval '89 days'),
          ('${ADMIN_1}', 'exportacion_estado', 'ZZZ aviso 1', 'ZZZ', now() - interval '1 day'),
          ('${ADMIN_1}', 'resumen_cartera', 'ZZZ resumen 200', 'ZZZ', now() - interval '200 days'),
          ('${USUARIO}', 'otro_tipo', 'ZZZ otro 200', 'ZZZ', now() - interval '200 days');`);
      await db.query(`select public.exportacion_estado_registrar${llamada}`);
      const filas = (await db.query(`select detalle from public.exportaciones_estado where detalle like 'ZZZ fila%' order by fecha`)).rows.map(x => x.detalle);
      assert(JSON.stringify(filas) === JSON.stringify(['ZZZ fila 90', 'ZZZ fila 1']), llamada + ' → filas: ' + JSON.stringify(filas));
      assert((await uno(db, `select count(*)::int as n from public.exportaciones_estado where fecha = ${HOY_EC}`)).n === 1, llamada + ' → falta la fila de hoy');
      const avisos = (await db.query(`select titulo from public.notificaciones where titulo like 'ZZZ %' order by titulo`)).rows.map(x => x.titulo);
      assert(JSON.stringify(avisos) === JSON.stringify(['ZZZ aviso 1', 'ZZZ aviso 89', 'ZZZ otro 200', 'ZZZ resumen 200']), llamada + ' → avisos: ' + JSON.stringify(avisos));
    }
  });

  await prueba('las sentencias de escritura del workflow (begin transaction read write … commit) registran aunque la sesión llegue en solo lectura', async () => {
    const db = await nueva();
    await db.exec(`set default_transaction_read_only = on;`);
    const e = await falla(() => db.query(`select public.exportacion_estado_registrar(true, 'ZZZ sin transacción explícita')`));
    assert(e && e.code === '25006', 'se esperaba 25006 con la sesión en solo lectura: ' + (e && e.code));
    await db.exec(`begin transaction read write; select public.exportacion_estado_registrar(true, 'ZZZ a', nullif('', '')); commit;`);
    await db.exec(`begin transaction read write; select public.exportacion_estado_registrar(true, 'ZZZ b', nullif('ZZZ degradada', '')); commit;`);
    await db.exec(`begin transaction read write; select public.exportacion_estado_registrar(false, 'ZZZ Falló el paso «Subir a Drive» (corrida 123, schedule).'); commit;`);
    await db.exec(`begin transaction read write; set default_transaction_read_only = off; commit;`);
    const reg = (await db.query(`select ok, aviso from public.exportaciones_estado`)).rows;
    assert(reg.length === 3 && reg.filter(x => x.ok).length === 2 && reg.filter(x => x.aviso === 'ZZZ degradada').length === 1, JSON.stringify(reg));
  });

  await prueba('la consulta en «begin transaction read only … rollback» no puede escribir y no deja la sesión en solo lectura', async () => {
    const db = await nueva();
    const e = await falla(() => db.exec(`begin transaction read only; select public.exportacion_estado_registrar(true, 'ZZZ'); rollback;`));
    assert(e && e.code === '25006', 'una transacción de solo lectura pudo escribir: ' + (e && e.code));
    await db.exec(`rollback;`);
    await db.exec(`begin transaction read only; select count(*) from public.exportaciones_estado; rollback;`);
    await db.query(`select public.exportacion_estado_registrar(true, 'ZZZ después de la consulta')`);
    assert((await uno(db, `select count(*)::int as n from public.exportaciones_estado`)).n === 1, 'la sesión quedó en solo lectura');
  });

  resumen();
})();
