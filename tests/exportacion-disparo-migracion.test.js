// Migración 20261122_exportacion_estado_disparo.sql ejecutada de verdad en un
// Postgres embebido (pglite), encima de la 20261121_exportaciones_estado.sql:
// tabla de disparos, RLS, permisos, disparo del workflow (petición a la API de
// GitHub encolada en pg_net), comprobación de la respuesta, vigilante con el
// aviso de caducidad del token, registro de la corrida (que retira solo los
// avisos de corrida), las cuatro tareas de pg_cron y la reversión.
//
// pglite no trae pg_cron, pg_net ni Vault: se montan DOBLES con la misma forma
//   · cron.job / cron.schedule / cron.unschedule  (el de la prueba de la 20261121)
//   · net.http_post(url, body, params, headers, timeout_milliseconds) → id, que
//     solo guarda la petición en net.http_request_queue (NUNCA sale a la red), y
//     net._http_response con las columnas reales
//   · vault.secrets (en claro) + vista vault.decrypted_secrets + vault.create_secret
// Todos los datos son sintéticos (prefijo ZZZ): ni el token ni el repositorio
// existen. Nunca toca producción ni la red.
//
// El montaje de base (roles, perfiles, notificaciones, tablas que lee la
// exportación) es EL MISMO de exportaciones-estado-migracion.test.js: se toma de
// su texto para no mantener dos copias.
//
//   node exportacion-disparo-migracion.test.js
//
// La prueba cuyo nombre empieza por «DEFECTO DE LA MIGRACIÓN» afirma el
// comportamiento CORRECTO y por eso falla mientras la migración no se corrija.
//
// Requiere @electric-sql/pglite (cd tests && npm install --no-save @electric-sql/pglite).
// Si falta, la prueba FALLA (código 1); para omitirla a sabiendas: OMITIR_PGLITE=1.
'use strict';
const path = require('path');
const { RAIZ, leer, prueba, resumen, assert } = require('./lib/arnes');

let PGlite;
try{ ({ PGlite } = require('@electric-sql/pglite')); }
catch{
  const COMO = 'cd tests && npm install --no-save @electric-sql/pglite';
  if(process.env.OMITIR_PGLITE === '1'){
    console.log('  – OMITIDA a propósito (OMITIR_PGLITE=1): la migración 20261122 NO se ha probado. Falta @electric-sql/pglite (' + COMO + ')');
    process.exit(0);
  }
  console.error('  ✗ exportacion-disparo-migracion: falta @electric-sql/pglite y la migración no se puede probar.\n' +
    '      Instálalo con:  ' + COMO + '\n' +
    '      o, para omitir esta prueba a sabiendas, define la variable OMITIR_PGLITE=1.');
  process.exit(1);
}

const MIG_21 = leer(path.join(RAIZ, 'supabase', 'migrations', '20261121_exportaciones_estado.sql'));
const MIG_22 = leer(path.join(RAIZ, 'supabase', 'migrations', '20261122_exportacion_estado_disparo.sql'));

// ── Montaje compartido con la prueba de la 20261121 (se lee de su fuente) ────
const FUENTE_21 = leer(path.join(__dirname, 'exportaciones-estado-migracion.test.js'));
function constanteDe(nombre){
  const m = new RegExp("^const " + nombre + " = '([0-9a-f-]{36})';", 'm').exec(FUENTE_21);
  if(!m) throw new Error('exportaciones-estado-migracion.test.js ya no define la constante ' + nombre);
  return m[1];
}
const IDS = {};
for(const k of ['EMPRESA', 'PROY_1', 'PROY_2', 'ADMIN_1', 'ADMIN_2', 'USUARIO']) IDS[k] = constanteDe(k);
function plantillaDe(nombre){
  const m = new RegExp('^const ' + nombre + ' = `([\\s\\S]*?)`;\\r?$', 'm').exec(FUENTE_21);
  if(!m) throw new Error('exportaciones-estado-migracion.test.js ya no define la plantilla ' + nombre);
  if(m[1].includes('\\')) throw new Error('la plantilla ' + nombre + ' lleva barras invertidas: no se puede reutilizar como texto');
  return m[1].replace(/\$\{(\w+)\}/g, (_, k) => {
    if(!(k in IDS)) throw new Error('la plantilla ' + nombre + ' usa ${' + k + '}, que esta prueba no conoce');
    return IDS[k];
  });
}
const BASE = plantillaDe('BASE');         // roles, auth.uid(), perfiles (2 admin + 1 usuario), notificaciones, sst_es_admin_global, doble de cron
const ESQUEMA = plantillaDe('ESQUEMA');   // tablas que lee exportacion_estado_datos() (la 20261121 la ejecuta al aplicarse)
const { ADMIN_1, ADMIN_2 } = IDS;
const FISCALIZADOR = '00000000-0000-4000-8000-0000000000b2';

// ── Dobles de pg_net y Vault ────────────────────────────────────────────────
const DOBLES = `
  insert into public.perfiles (id, nombre, apellido, rol, email) values
    ('${FISCALIZADOR}', 'ZZZ Fiscalizador', 'Cuatro', 'fiscalizador', 'zzz.cuatro@example.invalid');

  -- pg_net: misma firma que net.http_post de pg_net 0.20; solo encola.
  create schema net;
  create table net.http_request_queue (id bigserial primary key, method text not null, url text not null,
    headers jsonb not null, body bytea, timeout_milliseconds integer not null);
  create table net._http_response (id bigint, status_code integer, content_type text, headers jsonb, content text,
    timed_out boolean, error_msg text, created timestamptz not null default now());
  create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
      headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer default 5000)
    returns bigint language plpgsql security definer set search_path to 'net' as $$
    declare v_id bigint;
    begin
      if exists (select 1 from jsonb_each_text(coalesce(http_post.headers, '{}'::jsonb)) h
                  where lower(h.key) = 'content-type' and h.value <> 'application/json') then
        raise exception 'Content-type header must be application/json';
      end if;
      insert into net.http_request_queue (method, url, headers, body, timeout_milliseconds)
        values ('POST', http_post.url, http_post.headers, convert_to(http_post.body::text, 'UTF8'), http_post.timeout_milliseconds)
        returning id into v_id;
      return v_id;
    end $$;

  -- Vault: secretos en claro y la vista con las columnas que lee la migración.
  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text not null default '',
    secret text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  create view vault.decrypted_secrets as
    select id, name, description, secret, secret as decrypted_secret, created_at, updated_at from vault.secrets;
  create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
    returns uuid language sql as $$
      insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $$;
`;

const TOKEN = 'ZZZ-TOKEN-SINTETICO-NO-ES-REAL-0123456789';
const REPO = 'zzz-propietario/zzz-repo.privado_1';
const URL_ESPERADA = 'https://api.github.com/repos/' + REPO + '/actions/workflows/estado-diario.yml/dispatches';
const HOY_EC = `(now() at time zone 'America/Guayaquil')::date`;
const T_CREDENCIAL = 'No se pudo lanzar la exportación diaria: falta la credencial';
const T_RECHAZO = 'GitHub no aceptó lanzar la exportación diaria';
const T_SIN_RESPUESTA = 'No se sabe si la exportación diaria se lanzó';
const T_NO_GENERO = 'La exportación diaria del estado no se generó';
const T_FALLO = 'La exportación diaria del estado falló';
const T_INCOMPLETA = 'La exportación diaria del estado salió incompleta';
const T_POR_CADUCAR = 'El token de la exportación diaria está por caducar';
const T_CADUCO = 'El token de la exportación diaria CADUCÓ';
const T_SIN_FECHA = 'El token de la exportación diaria no tiene fecha de caducidad anotada';
const T_VAULT = 'No se pudo comprobar la caducidad del token de la exportación diaria';
// Textos fijos de la migración (se comparan enteros: ninguno lleva datos de Vault)
const M_TOKEN = 'Falta en Vault el token de GitHub (github_estado_diario) o tiene espacios o saltos de línea dentro.';
const M_REPO = 'Falta en Vault el repositorio (github_estado_diario_repo) o no tiene la forma propietario/repositorio.';
const M_VAULT = 'No se pudo leer Vault.';
const M_RESERVA = ' La exportación queda a cargo del horario de reserva de GitHub, que llega con horas de retraso.';
const M_RESERVA_MANO = ' La exportación queda a cargo del horario de reserva de GitHub, que llega con horas de retraso; se puede lanzar a mano desde Actions.';
const M_401 = 'GitHub rechazó el token (401): está caducado, revocado o mal guardado en Vault.';
const M_SIN_RESPUESTA = 'pg_net no guardó respuesta de GitHub.';
const M_TOK = 'El token de GitHub que lanza la exportación diaria ';
const M_RENOVAR = '. Hay que crear uno nuevo y guardarlo en Vault (github_estado_diario).';
const M_SIN_FECHA = M_TOK + 'no tiene anotada en Vault una fecha de caducidad válida (descripción «caduca=AAAA-MM-DD» o «caduca=nunca»): no se podrá avisar antes de que caduque.';
const M_VAULT_CADUCIDAD = 'No se pudo leer en Vault la caducidad del token de GitHub que lanza la exportación diaria.';
// Vault ilegible de dos maneras: la vista no existe, o existe y descifrar falla con un error que lleva el secreto.
const VAULT_SIN_VISTA = `drop view vault.decrypted_secrets;`;
const VAULT_ROTO = `
  create function vault.zzz_rompe(t text) returns text language plpgsql as $$
    begin raise exception 'ZZZERRORVAULT no se pudo descifrar %', t; end $$;
  drop view vault.decrypted_secrets;
  create view vault.decrypted_secrets as
    select id, name, vault.zzz_rompe(description) as description, secret, vault.zzz_rompe(secret) as decrypted_secret, created_at, updated_at from vault.secrets;
`;

// La base montada se guarda una vez y cada prueba parte de una copia: «previa» =
// hasta la 20261121 más los dobles; «lista» = además la 20261122 aplicada DOS veces.
let copiaPrevia = null, copiaLista = null;
async function montar(){
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(ESQUEMA);
  await db.exec(MIG_21);
  await db.exec(DOBLES);
  copiaPrevia = await db.dumpDataDir('none');
  await db.exec(MIG_22);
  await db.exec(MIG_22);
  copiaLista = await db.dumpDataDir('none');
  await db.close();
}
async function previa(){ const db = new PGlite({ loadDataDir: copiaPrevia }); await db.waitReady; return db; }
async function nueva(){ const db = new PGlite({ loadDataDir: copiaLista }); await db.waitReady; return db; }

const uno = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const filas = async (db, sql, params) => (await db.query(sql, params)).rows;
const cuenta = async (db, tabla, donde) => (await uno(db, `select count(*)::int as n from ${tabla}` + (donde ? ' where ' + donde : ''))).n;
async function como(db, rol, uid, fn){
  await db.exec(`set role ${rol}; set prueba.uid = '${uid || ''}';`);
  try{ return await fn(); } finally{ await db.exec(`reset role; set prueba.uid = '';`); }
}
async function falla(fn){ try{ await fn(); return null; }catch(e){ return e; } }

// Secretos sintéticos. dias = días que faltan para la caducidad anotada (null = descripción tal cual).
async function secretos(db, { token = TOKEN, repo = REPO, dias = 200, descripcion } = {}){
  if(token !== null){
    if(descripcion !== undefined) await db.query(`insert into vault.secrets (secret, name, description) values ($1, 'github_estado_diario', $2)`, [token, descripcion]);
    else await db.query(`select vault.create_secret($1, 'github_estado_diario', 'caduca=' || to_char(${HOY_EC} + $2::int, 'YYYY-MM-DD'))`, [token, dias]);
  }
  if(repo !== null) await db.query(`select vault.create_secret($1, 'github_estado_diario_repo', 'repositorio del workflow estado-diario')`, [repo]);
}
const disparar = async (db, forzar) => (await uno(db, `select public.exportacion_estado_disparar(${forzar ? 'true' : ''}) as r`)).r;
const comprobar = async db => (await uno(db, `select public.exportacion_estado_comprobar_disparo() as r`)).r;
const vigilar = async db => (await uno(db, `select public.exportacion_estado_vigilar() as n`)).n;
const cola = db => filas(db, `select id, method, url, headers, convert_from(body, 'UTF8')::jsonb as body, timeout_milliseconds from net.http_request_queue order by id`);
const disparos = db => filas(db, `select id, fecha = ${HOY_EC} as hoy, peticion_id, resultado, detalle from public.exportacion_estado_disparos order by creado_en, peticion_id`);
const avisos = db => filas(db, `select perfil_id, tipo, titulo, mensaje, leida from public.notificaciones order by titulo, perfil_id`);
const corridaBuena = db => db.query(`select public.exportacion_estado_registrar(true, 'ZZZ corrida buena')`);
async function responder(db, peticionId, { status = null, timedOut = false, error = null, cuerpo = null } = {}){
  await db.query(`insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg)
                  values ($1, $2, 'application/json', '{}'::jsonb, $3, $4, $5)`, [peticionId, status, cuerpo, timedOut, error]);
}
// Todo lo que la migración deja escrito donde lo puede leer la app (registro de disparos y campana).
async function textoVisible(db){
  return (await uno(db, `select coalesce((select string_agg(d::text, ' | ') from public.exportacion_estado_disparos d), '')
                           || ' # ' || coalesce((select string_agg(n::text, ' | ') from public.notificaciones n), '') as t`)).t;
}
function soloAdmins(lista, titulo){
  const de = lista.filter(n => n.titulo === titulo);
  assert(de.length === 2 && de[0].perfil_id === ADMIN_1 && de[1].perfil_id === ADMIN_2,
    'se esperaba UN aviso «' + titulo + '» por admin global y hay: ' + JSON.stringify(de.map(n => n.perfil_id)));
  assert(de.every(n => n.tipo === 'exportacion_estado' && n.leida === false), 'tipo o leída inesperados');
  return de;
}
// Títulos de la campana con su número de avisos, ordenados: ['título:n', …]
async function titulos(db){
  return (await filas(db, `select titulo, count(*)::int as n from public.notificaciones group by titulo`)).map(x => x.titulo + ':' + x.n).sort();
}
const defecto = (nombre, fn) => prueba('DEFECTO DE LA MIGRACIÓN — ' + nombre, fn);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fechaMas = async (db, dias) => (await uno(db, `select to_char(${HOY_EC} + $1::int, 'YYYY-MM-DD') as f`, [dias])).f;
// Texto que la migración debe dar para un token al que le faltan «dias» días (null = no avisa).
async function textoCaducidad(db, dias){
  const f = await fechaMas(db, dias);
  if(dias < 0) return { titulo: T_CADUCO, mensaje: M_TOK + 'caducó el ' + f + M_RENOVAR };
  if(dias > 14) return null;
  const cuando = dias === 0 ? 'hoy' : dias === 1 ? 'mañana (falta 1 día)' : 'el ' + f + ' (faltan ' + dias + ' días)';
  return { titulo: T_POR_CADUCAR, mensaje: M_TOK + 'caduca ' + cuando + M_RENOVAR };
}
// Texto del aviso «no se generó»: base + motivo del disparo fallido de hoy + caducidad.
async function textoNoGenero(db, disparo, caducidad){
  return 'No hay ninguna corrida buena registrada para hoy (' + await fechaMas(db, 0)
    + '). Los archivos de Drive son de un día anterior: mira la fecha «válido para» y lanza la corrida a mano.'
    + (disparo ? ' Disparo de hoy: ' + disparo : '') + (caducidad ? ' ' + caducidad : '');
}
// Una petición ya encolada (para disparos que la prueba inserta a mano con su identificador).
const encolar = (db, id) => db.query(`insert into net.http_request_queue (id, method, url, headers, body, timeout_milliseconds)
  values ($1, 'POST', 'https://zzz.invalid/', '{"Authorization": "Bearer ZZZ-EN-COLA"}'::jsonb, null, 1000)`, [id]);

(async () => {
  await montar();

  // ── Aplicación, cron y permisos ───────────────────────────────────────────
  await prueba('la migración se aplica dos veces sin error; una tercera no pierde el registro ni duplica tareas', async () => {
    const db = await nueva();
    await db.exec(`insert into public.exportacion_estado_disparos (fecha, peticion_id, resultado, detalle) values (${HOY_EC}, 7, 'aceptado', 'ZZZ fila previa')`);
    await db.exec(MIG_22);
    assert(await cuenta(db, 'public.exportacion_estado_disparos', `detalle = 'ZZZ fila previa'`) === 1, 'volver a aplicar la migración perdió el registro');
    assert(await cuenta(db, 'cron.job') === 5, 'tareas tras tres aplicaciones: ' + await cuenta(db, 'cron.job'));
    const pol = await filas(db, `select policyname, cmd, roles::text as roles from pg_policies where tablename = 'exportacion_estado_disparos'`);
    assert(pol.length === 1 && pol[0].cmd === 'SELECT' && pol[0].roles === '{authenticated}', 'políticas: ' + JSON.stringify(pol));
    const def = await filas(db, `select proname, prosecdef, proconfig from pg_proc
      where proname in ('exportacion_estado_avisar', 'exportacion_estado_disparar', 'exportacion_estado_comprobar_disparo', 'exportacion_estado_vigilar', 'exportacion_estado_registrar') order by 1`);
    assert(def.length === 5, 'funciones (una firma cada una): ' + JSON.stringify(def.map(d => d.proname)));
    assert(def.every(d => d.prosecdef === true && Array.isArray(d.proconfig) && d.proconfig.some(c => /^search_path=/.test(c))), 'SECURITY DEFINER con search_path fijo: ' + JSON.stringify(def));
  });

  await prueba('aplicada DOS veces deja una sola tarea por nombre (las cuatro nuevas y el vigilante), y el índice y la política una sola vez', async () => {
    const db = await nueva();                                        // «lista» = la 20261122 aplicada dos veces
    const porNombre = (await filas(db, `select jobname, count(*)::int as n from cron.job group by jobname order by jobname`)).map(x => x.jobname + ':' + x.n);
    assert(igual(porNombre, ['exportacion-estado-comprobar-1:1', 'exportacion-estado-comprobar-2:1', 'exportacion-estado-disparo-1:1', 'exportacion-estado-disparo-2:1', 'exportacion-estado-vigilante:1']),
      'tareas por nombre: ' + JSON.stringify(porNombre));
    assert(await cuenta(db, 'pg_indexes', `tablename = 'exportacion_estado_disparos'`) === 2, 'índices de la tabla de disparos (clave + fecha)');
    assert(await cuenta(db, 'pg_policies', `tablename = 'exportacion_estado_disparos'`) === 1, 'políticas de la tabla de disparos');
    // Una sola aplicación deja exactamente lo mismo
    const db1 = await previa();
    await db1.exec(MIG_22);
    const una = (await filas(db1, `select jobname, schedule, command from cron.job order by jobname`));
    const dos = (await filas(db, `select jobname, schedule, command from cron.job order by jobname`));
    assert(igual(una, dos), 'una y dos aplicaciones no dejan las mismas tareas');
  });

  await prueba('tareas de cron: las cuatro nuevas con su horario (UTC) y su comando, más el vigilante; el comando no lleva el token ni el repositorio', async () => {
    const db = await nueva();
    await secretos(db);
    await db.exec(MIG_22);       // con los secretos ya en Vault: tampoco así se cuelan en el comando
    const jobs = await filas(db, `select jobname, schedule, command, active from cron.job order by jobname`);
    const esperado = [
      ['exportacion-estado-comprobar-1', '13 8 * * *', 'select public.exportacion_estado_comprobar_disparo();'],
      ['exportacion-estado-comprobar-2', '23 9 * * *', 'select public.exportacion_estado_comprobar_disparo();'],
      ['exportacion-estado-disparo-1', '10 8 * * *', 'select public.exportacion_estado_disparar();'],
      ['exportacion-estado-disparo-2', '20 9 * * *', 'select public.exportacion_estado_disparar();'],
      ['exportacion-estado-vigilante', '20 10 * * *', 'select public.exportacion_estado_vigilar();']
    ];
    assert(JSON.stringify(jobs.map(j => [j.jobname, j.schedule, j.command])) === JSON.stringify(esperado), 'tareas: ' + JSON.stringify(jobs));
    assert(jobs.every(j => j.active === true), 'alguna tarea quedó inactiva');
    const todo = JSON.stringify(jobs.map(j => [j.jobname, j.schedule, j.command]));
    for(const prohibido of [TOKEN, REPO, 'Bearer', 'api.github.com', 'vault', 'true']){
      assert(!todo.includes(prohibido), 'un comando de cron lleva «' + prohibido + '»');
    }
    assert(!MIG_22.includes(TOKEN) && !/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/.test(MIG_22), 'el archivo de la migración parece llevar un token');
    // Los comandos programados se pueden ejecutar tal cual, en su orden del día
    await db.exec(esperado[2][2]);
    await db.exec(esperado[0][2]);
    assert((await cola(db)).length === 1, 'el comando de disparo no encoló la petición');
  });

  await prueba('PERMISOS REALES: anon, authenticated y service_role reciben «permission denied» en disparar, comprobar y avisar, y no queda rastro', async () => {
    const db = await nueva();
    await secretos(db);          // si alguna llamada pasara, encolaría de verdad
    const llamadas = [
      ['disparar', `select public.exportacion_estado_disparar()`],
      ['disparar(true)', `select public.exportacion_estado_disparar(true)`],
      ['disparar por nombre', `select * from public.exportacion_estado_disparar(p_forzar => true)`],
      ['comprobar', `select public.exportacion_estado_comprobar_disparo()`],
      ['avisar', `select public.exportacion_estado_avisar('ZZZ título', 'ZZZ mensaje')`]
    ];
    for(const rol of ['anon', 'authenticated', 'service_role']){
      for(const [nombre, sql] of llamadas){
        const e = await como(db, rol, rol === 'authenticated' ? ADMIN_1 : '', () => falla(() => db.query(sql)));
        assert(e, rol + ' pudo ejecutar ' + nombre);
        assert(e.code === '42501' && /permission denied for function exportacion_estado_/.test(e.message), rol + ' / ' + nombre + ': ' + e.code + ' ' + e.message);
      }
    }
    assert((await cola(db)).length === 0 && await cuenta(db, 'public.exportacion_estado_disparos') === 0 && await cuenta(db, 'public.notificaciones') === 0,
      'un intento rechazado dejó algo escrito');
    const p = await uno(db, `select
      has_function_privilege('public', 'public.exportacion_estado_disparar(boolean)', 'execute') as p_dis,
      has_function_privilege('public', 'public.exportacion_estado_comprobar_disparo()', 'execute') as p_com,
      has_function_privilege('public', 'public.exportacion_estado_avisar(text, text)', 'execute') as p_avi,
      has_function_privilege('public', 'public.exportacion_estado_vigilar()', 'execute') as p_vig,
      has_function_privilege('public', 'public.exportacion_estado_registrar(boolean, text, text)', 'execute') as p_reg,
      has_function_privilege('anon', 'public.exportacion_estado_vigilar()', 'execute') as n_vig,
      has_function_privilege('authenticated', 'public.exportacion_estado_vigilar()', 'execute') as a_vig,
      has_function_privilege('service_role', 'public.exportacion_estado_vigilar()', 'execute') as s_vig,
      has_function_privilege('anon', 'public.exportacion_estado_registrar(boolean, text, text)', 'execute') as n_reg,
      has_function_privilege('authenticated', 'public.exportacion_estado_registrar(boolean, text, text)', 'execute') as a_reg,
      has_function_privilege('service_role', 'public.exportacion_estado_registrar(boolean, text, text)', 'execute') as s_reg,
      has_function_privilege('service_role', 'public.exportacion_estado_datos()', 'execute') as s_dat`);
    assert(!p.p_dis && !p.p_com && !p.p_avi && !p.p_vig && !p.p_reg, 'PUBLIC conserva EXECUTE: ' + JSON.stringify(p));
    assert(!p.n_vig && !p.a_vig && p.s_vig && !p.n_reg && !p.a_reg && p.s_reg && p.s_dat, 'el vigilante, el registro o las funciones de la 20261121 cambiaron de permisos: ' + JSON.stringify(p));
    // El vigilante y el registro (redefinidos aquí) siguen como estaban: anon y authenticated no; service_role sí
    for(const rol of ['anon', 'authenticated']){
      for(const sql of [`select public.exportacion_estado_vigilar()`, `select public.exportacion_estado_registrar(true, 'ZZZ intruso')`, `select public.exportacion_estado_registrar(false, 'ZZZ intruso', null)`]){
        const e = await como(db, rol, rol === 'authenticated' ? ADMIN_1 : '', () => falla(() => db.query(sql)));
        assert(e && e.code === '42501', rol + ' pudo ejecutar: ' + sql);
      }
    }
    assert(await cuenta(db, 'public.exportaciones_estado') === 0 && await cuenta(db, 'public.notificaciones') === 0, 'un intento rechazado del registro dejó algo escrito');
    const directo = await como(db, 'service_role', '', () => falla(() => db.query(`select decrypted_secret from vault.decrypted_secrets`)));
    assert(directo && directo.code === '42501', 'en este montaje service_role no debía poder leer Vault directamente');
    const e = await como(db, 'service_role', '', () => falla(() => db.query(`select public.exportacion_estado_vigilar()`)));
    assert(e === null, 'service_role no pudo ejecutar el vigilante: ' + (e && (e.code + ' ' + e.message)));
    const e2 = await como(db, 'service_role', '', () => falla(() => db.query(`select public.exportacion_estado_registrar(true, 'ZZZ corrida del workflow')`)));
    assert(e2 === null && await cuenta(db, 'public.exportaciones_estado', 'ok') === 1, 'service_role no pudo registrar la corrida: ' + (e2 && (e2.code + ' ' + e2.message)));
  });

  await prueba('tabla de disparos: authenticated solo lee y solo el admin global ve filas; anon no entra; nadie escribe desde la app', async () => {
    const db = await nueva();
    await db.exec(`insert into public.exportacion_estado_disparos (fecha, peticion_id, resultado) values (${HOY_EC}, 1, 'enviado')`);
    const t = await uno(db, `select
      has_table_privilege('authenticated', 'public.exportacion_estado_disparos', 'select') as a_sel,
      has_table_privilege('authenticated', 'public.exportacion_estado_disparos', 'insert') as a_ins,
      has_table_privilege('authenticated', 'public.exportacion_estado_disparos', 'update') as a_upd,
      has_table_privilege('authenticated', 'public.exportacion_estado_disparos', 'delete') as a_del,
      has_table_privilege('anon', 'public.exportacion_estado_disparos', 'select') as n_sel,
      has_table_privilege('service_role', 'public.exportacion_estado_disparos', 'select') as s_sel,
      (select relrowsecurity from pg_class where oid = 'public.exportacion_estado_disparos'::regclass) as rls`);
    assert(t.a_sel && !t.a_ins && !t.a_upd && !t.a_del && !t.n_sel && t.s_sel && t.rls === true, JSON.stringify(t));
    const nAdmin = await como(db, 'authenticated', ADMIN_1, () => cuenta(db, 'public.exportacion_estado_disparos'));
    const nFisc = await como(db, 'authenticated', FISCALIZADOR, () => cuenta(db, 'public.exportacion_estado_disparos'));
    assert(nAdmin === 1 && nFisc === 0, 'admin ve ' + nAdmin + ' y el fiscalizador ve ' + nFisc);
    const eAnon = await como(db, 'anon', '', () => falla(() => db.query(`select * from public.exportacion_estado_disparos`)));
    assert(eAnon && eAnon.code === '42501', 'anon pudo leer la tabla');
    const eIns = await como(db, 'authenticated', ADMIN_1, () => falla(() => db.query(`insert into public.exportacion_estado_disparos (fecha, resultado) values (current_date, 'aceptado')`)));
    assert(eIns && eIns.code === '42501', 'un admin de la app pudo insertar en el registro');
    for(const sql of [`update public.exportacion_estado_disparos set resultado = 'aceptado'`, `delete from public.exportacion_estado_disparos`]){
      const e = await como(db, 'authenticated', ADMIN_1, () => falla(() => db.query(sql)));
      assert(e && e.code === '42501', 'un admin de la app pudo: ' + sql);
    }
  });

  // Estado que debe quedar cuando la migración aborta: nada de la 20261122.
  async function nadaAplicado(db, caso){
    await db.exec('rollback;');
    const quedo = await uno(db, `select to_regclass('public.exportacion_estado_disparos') is not null as tabla,
      (select count(*)::int from pg_proc where proname in ('exportacion_estado_avisar', 'exportacion_estado_disparar', 'exportacion_estado_comprobar_disparo')) as funciones,
      (select count(*)::int from cron.job) as tareas,
      (select prosrc like '%vault%' from pg_proc where proname = 'exportacion_estado_vigilar') as vigilante_nuevo,
      (select prosrc like '%DE CORRIDA%' from pg_proc where proname = 'exportacion_estado_registrar') as registro_nuevo,
      has_function_privilege('anon', 'public.exportacion_estado_vigilar()', 'execute') or has_function_privilege('authenticated', 'public.exportacion_estado_vigilar()', 'execute')
        or has_function_privilege('anon', 'public.exportacion_estado_registrar(boolean, text, text)', 'execute')
        or has_function_privilege('authenticated', 'public.exportacion_estado_registrar(boolean, text, text)', 'execute') as abierto`);
    assert(!quedo.tabla && quedo.funciones === 0 && quedo.tareas === 1 && quedo.vigilante_nuevo === false && quedo.registro_nuevo === false && quedo.abierto === false,
      'la migración abortada dejó algo aplicado (' + caso + '): ' + JSON.stringify(quedo));
  }

  await prueba('la migración PRUEBA sus permisos al aplicarse: sin un REVOKE (o si deja fuera a un rol) aborta y no aplica nada', async () => {
    const REVOKES = [
      'revoke all on function public.exportacion_estado_avisar(text, text) from public, anon, authenticated, service_role;',
      'revoke all on function public.exportacion_estado_disparar(boolean) from public, anon, authenticated, service_role;',
      'revoke all on function public.exportacion_estado_comprobar_disparo() from public, anon, authenticated, service_role;'
    ];
    for(const linea of REVOKES){
      assert(MIG_22.split(linea).length === 2, 'no se encontró en la migración: ' + linea);
      for(const mala of ['', linea.replace(', anon, authenticated, service_role', ''), linea.replace(', service_role', '')]){
        const db = await previa();
        const e = await falla(() => db.exec(MIG_22.replace(linea, mala)));
        assert(e && e.code === '42501' && /Permisos mal puestos/.test(e.message), 'la migración mal hecha se aplicó (' + (mala || 'sin revoke') + '): ' + (e && e.message));
        await nadaAplicado(db, mala || 'sin ' + linea);
        await db.close();
      }
    }
  });

  await prueba('prueba de permisos AMPLIADA: también aborta si el vigilante o el registro quedan abiertos a anon/authenticated, o la tabla de disparos legible por anon o escribible desde la app', async () => {
    const CASOS = [
      ['vigilante abierto a authenticated', 'grant execute on function public.exportacion_estado_vigilar() to service_role;',
        'grant execute on function public.exportacion_estado_vigilar() to service_role, authenticated;', /el rol authenticated puede ejecutar el vigilante o el registro/],
      ['vigilante abierto a anon', 'grant execute on function public.exportacion_estado_vigilar() to service_role;',
        'grant execute on function public.exportacion_estado_vigilar() to service_role, anon;', /el rol anon puede ejecutar el vigilante o el registro/],
      ['vigilante abierto a PUBLIC', 'grant execute on function public.exportacion_estado_vigilar() to service_role;',
        'grant execute on function public.exportacion_estado_vigilar() to public;', /el rol anon puede ejecutar el vigilante o el registro/],
      ['registro abierto a authenticated', 'grant execute on function public.exportacion_estado_registrar(boolean, text, text) to service_role;',
        'grant execute on function public.exportacion_estado_registrar(boolean, text, text) to service_role, authenticated;', /el rol authenticated puede ejecutar el vigilante o el registro/],
      ['registro abierto a anon', 'grant execute on function public.exportacion_estado_registrar(boolean, text, text) to service_role;',
        'grant execute on function public.exportacion_estado_registrar(boolean, text, text) to service_role, anon;', /el rol anon puede ejecutar el vigilante o el registro/],
      ['tabla legible por anon', 'grant select on public.exportacion_estado_disparos to authenticated;',
        'grant select on public.exportacion_estado_disparos to authenticated, anon;', /en la tabla exportacion_estado_disparos/],
      ['tabla con INSERT para authenticated', 'grant select on public.exportacion_estado_disparos to authenticated;',
        'grant select, insert on public.exportacion_estado_disparos to authenticated;', /en la tabla exportacion_estado_disparos/],
      ['tabla con UPDATE para authenticated', 'grant select on public.exportacion_estado_disparos to authenticated;',
        'grant select, update on public.exportacion_estado_disparos to authenticated;', /en la tabla exportacion_estado_disparos/],
      ['tabla con DELETE para authenticated', 'grant select on public.exportacion_estado_disparos to authenticated;',
        'grant select, delete on public.exportacion_estado_disparos to authenticated;', /en la tabla exportacion_estado_disparos/],
      ['tabla con todo para authenticated', 'grant select on public.exportacion_estado_disparos to authenticated;',
        'grant all on public.exportacion_estado_disparos to authenticated;', /en la tabla exportacion_estado_disparos/]
    ];
    for(const [caso, linea, mala, patron] of CASOS){
      assert(MIG_22.split(linea).length === 2, 'no se encontró en la migración: ' + linea);
      const db = await previa();
      const e = await falla(() => db.exec(MIG_22.replace(linea, mala)));
      assert(e && e.code === '42501' && /Permisos mal puestos/.test(e.message) && patron.test(e.message), caso + ': la migración mal hecha se aplicó o falló por otra cosa: ' + (e && e.message));
      await nadaAplicado(db, caso);
      await db.close();
    }
  });

  await prueba('REVERSIÓN (la que anota la migración): reaplicar entera la 20261121 y luego borrar lo nuevo deja la base como antes de la 20261122', async () => {
    const pie = MIG_22.slice(MIG_22.indexOf('── Reversión'));
    assert(/^-- 1\) Aplicar de nuevo, entero, 20261121_exportaciones_estado\.sql/m.test(pie), 'la reversión ya no empieza por reaplicar la 20261121');
    const m = /^-- begin;\r?\n([\s\S]*?)^-- commit;/m.exec(pie);
    assert(m, 'no se encontró el bloque begin…commit de la reversión');
    const sql = 'begin;\n' + m[1].split(/\r?\n/).map(l => l.replace(/^--/, '')).join('\n') + '\ncommit;';
    const borrarSecretos = /^-- 3\).*?:\s*(delete from vault\.secrets[^;]*;)/m.exec(pie);
    assert(borrarSecretos, 'la reversión ya no dice cómo borrar los secretos');
    const db = await nueva();
    await secretos(db, { dias: -1 });
    await disparar(db);
    await vigilar(db);
    await db.exec(MIG_21);
    await db.exec(sql);
    await db.exec(borrarSecretos[1]);
    const antes = await previa();
    const foto = d => filas(d, `select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosrc, p.prosecdef, p.proconfig::text as cfg,
        has_function_privilege('anon', p.oid, 'execute') as an, has_function_privilege('authenticated', p.oid, 'execute') as au, has_function_privilege('service_role', p.oid, 'execute') as sr
      from pg_proc p where p.proname like 'exportacion_estado_%' order by 1, 2`);
    const [fAntes, fAhora] = [await foto(antes), await foto(db)];
    assert(fAntes.length >= 3 && igual(fAntes, fAhora), 'tras la reversión las funciones no son las de antes: ' + JSON.stringify(fAhora.map(f => f.proname)) + ' frente a ' + JSON.stringify(fAntes.map(f => f.proname)));
    const jobs = d => filas(d, `select jobname, schedule, command, active from cron.job order by jobname`);
    assert(igual(await jobs(antes), await jobs(db)), 'tras la reversión las tareas no son las de antes: ' + JSON.stringify(await jobs(db)));
    const r = await uno(db, `select to_regclass('public.exportacion_estado_disparos') is null as sin_tabla, (select count(*)::int from vault.secrets) as secretos`);
    assert(r.sin_tabla && r.secretos === 0, 'quedó la tabla o los secretos: ' + JSON.stringify(r));
    // Y se puede volver a aplicar la 20261122 encima
    await db.exec(MIG_22);
    assert(await cuenta(db, 'cron.job') === 5 && await disparar(db) === 'sin secreto', 'tras revertir no se pudo volver a aplicar');
  });

  // ── Disparo ───────────────────────────────────────────────────────────────
  await prueba('sin secretos: «sin secreto», fila «sin_secreto» sin petición, UN aviso por admin global (el del token) y nada encolado; al repetir no duplica el aviso', async () => {
    const db = await nueva();
    assert(await disparar(db) === 'sin secreto', 'primera llamada');
    assert(await disparar(db) === 'sin secreto', 'segunda llamada');
    assert(await disparar(db, true) === 'sin secreto', 'forzada');
    assert((await cola(db)).length === 0, 'se encoló una petición sin credencial');
    const d = await disparos(db);
    assert(d.length === 3 && d.every(x => x.resultado === 'sin_secreto' && x.peticion_id === null && x.hoy === true && x.detalle === M_TOKEN), JSON.stringify(d));
    const n = await avisos(db);
    assert(n.length === 2, 'avisos tras tres intentos: ' + n.length);
    const [a] = soloAdmins(n, T_CREDENCIAL);
    assert(a.mensaje === M_TOKEN + M_RESERVA, a.mensaje);
  });

  await prueba('falta UNO de los dos secretos, o está en blanco: «sin secreto», nada encolado y el mensaje dice CUÁL falta (token o repositorio)', async () => {
    const CASOS = [['solo el token', { repo: null }, M_REPO], ['solo el repositorio', { token: null }, M_TOKEN], ['token en blanco', { token: '   ' }, M_TOKEN],
      ['token solo con saltos y tabuladores', { token: ' \t\r\n' }, M_TOKEN], ['repositorio en blanco', { repo: '  ' }, M_REPO], ['repositorio solo con saltos', { repo: '\r\n\t' }, M_REPO],
      ['token vacío', { token: '' }, M_TOKEN], ['repositorio vacío', { repo: '' }, M_REPO], ['los dos en blanco (manda el token)', { token: ' ', repo: ' ' }, M_TOKEN]];
    for(const [caso, cfg, mensaje] of CASOS){
      const db = await nueva();
      await secretos(db, cfg);
      assert(await disparar(db) === 'sin secreto', caso + ': no devolvió «sin secreto»');
      assert((await cola(db)).length === 0, caso + ': encoló una petición');
      const d = await disparos(db);
      assert(d.length === 1 && d[0].resultado === 'sin_secreto' && d[0].peticion_id === null && d[0].detalle === mensaje, caso + ': fila ' + JSON.stringify(d));
      const n = await avisos(db);
      assert(n.length === 2, caso + ': avisos ' + n.length);
      const [a] = soloAdmins(n, T_CREDENCIAL);
      assert(a.mensaje === mensaje + M_RESERVA, caso + ': «' + a.mensaje + '»');
      assert(!(await textoVisible(db)).includes(TOKEN), caso + ': el token quedó a la vista');
      await db.close();
    }
  });

  await prueba('repositorio mal formado: «sin secreto» (mensaje del repositorio), nada encolado y el valor mal puesto no se copia al registro ni a la campana', async () => {
    for(const repo of ['zzz-sin-barra', 'zzz/a/b', 'https://github.com/zzz-propietario/zzz-repo', 'zzz-propietario/zzz repo', 'zzz-propietario/zzz-repo?ZZZINYECTADO=1',
      'zzz-propietario/zzz-repo#ZZZINYECTADO', '/zzz-repo', 'zzz-propietario/', 'zzz-propietario/zzz-repo/', 'zzz-propietario\\zzz-repo', 'zzz-propietario/zzz-repo\nZZZINYECTADO',
      'zzz-propietario/zzz-repo\n/../ZZZINYECTADO', 'zzz-propietario/zzz-repo/actions/ZZZINYECTADO', 'zzz-propietario/zzz-repo%2FZZZINYECTADO', 'zzz-propietario/\tzzz-repo']){
      const db = await nueva();
      await secretos(db, { repo });
      assert(await disparar(db, true) === 'sin secreto', JSON.stringify(repo) + ' no se rechazó');
      assert((await cola(db)).length === 0, JSON.stringify(repo) + ' encoló una petición');
      const d = await disparos(db);
      assert(d.length === 1 && d[0].detalle === M_REPO, JSON.stringify(repo) + ': ' + JSON.stringify(d));
      const visible = await textoVisible(db);
      assert(!visible.includes('ZZZINYECTADO') && !visible.includes('zzz-propietario') && !visible.includes(TOKEN), JSON.stringify(repo) + ': el valor quedó a la vista');
      await db.close();
    }
  });

  await prueba('con secretos: encola UNA petición POST con la URL del repositorio, el cuerpo {ref: main, inputs: {origen: pg_cron}} y las cabeceras (sin User-Agent propio); registra «enviado»', async () => {
    const db = await nueva();
    await secretos(db, { token: '  ' + TOKEN + '  ', repo: ' ' + REPO + ' ' });   // con espacios alrededor: se recortan
    const r = await disparar(db);
    const q = await cola(db);
    assert(q.length === 1, 'peticiones encoladas: ' + q.length);
    const p = q[0];
    assert(r === 'enviado (petición ' + p.id + ')', 'respuesta: ' + r);
    assert(p.method === 'POST' && p.url === URL_ESPERADA, p.method + ' ' + p.url);
    assert(JSON.stringify(p.body) === JSON.stringify({ ref: 'main', inputs: { origen: 'pg_cron' } }), 'cuerpo: ' + JSON.stringify(p.body));
    assert(p.timeout_milliseconds === 15000, 'tiempo de espera: ' + p.timeout_milliseconds);
    const h = p.headers;
    // pg_net pone su propio User-Agent al enviar: la migración no manda otro (GitHub recibiría dos)
    assert(igual(Object.keys(h).sort(), ['Accept', 'Authorization', 'Content-Type', 'X-GitHub-Api-Version']), 'cabeceras: ' + Object.keys(h));
    assert(!Object.keys(h).some(k => k.toLowerCase() === 'user-agent'), 'la migración envía un User-Agent propio');
    assert(h.Authorization === 'Bearer ' + TOKEN, 'Authorization no es «Bearer <token>» exacto');
    assert(h.Accept === 'application/vnd.github+json' && h['X-GitHub-Api-Version'] === '2022-11-28' && h['Content-Type'] === 'application/json', JSON.stringify({ ...h, Authorization: '…' }));
    const d = await disparos(db);
    assert(d.length === 1 && d[0].resultado === 'enviado' && Number(d[0].peticion_id) === Number(p.id) && d[0].hoy === true && d[0].detalle === null, JSON.stringify(d));
    assert(await cuenta(db, 'public.notificaciones') === 0, 'un disparo enviado no debe avisar');
  });

  await prueba('token o repositorio pegados con salto de línea, retorno o tabulador AL FINAL (o al principio): se limpian y la petición sale bien', async () => {
    const BORDES = [['\\n final', '', '\n'], ['\\r\\n final', '', '\r\n'], ['tabulador final', '', '\t'], ['varios al final', '', ' \t\r\n\n '], ['salto al principio', '\n', ''], ['por los dos lados', '\r\n\t ', ' \t\r\n']];
    for(const [caso, antes, despues] of BORDES){
      const db = await nueva();
      await secretos(db, { token: antes + TOKEN + despues, repo: antes + REPO + despues });
      const r = await disparar(db);
      const q = await cola(db);
      assert(q.length === 1 && r === 'enviado (petición ' + q[0].id + ')', caso + ': no se envió (' + r + ')');
      assert(q[0].headers.Authorization === 'Bearer ' + TOKEN, caso + ': Authorization quedó como ' + JSON.stringify(String(q[0].headers.Authorization).replace(TOKEN, '<token>')));
      assert(q[0].url === URL_ESPERADA, caso + ': URL ' + JSON.stringify(q[0].url));
      assert(await cuenta(db, 'public.notificaciones') === 0, caso + ': avisó');
      await db.close();
    }
  });

  await prueba('token con un salto de línea, espacio o tabulador EN MEDIO: se trata como falta de credencial («sin secreto»), no se encola y no queda a la vista', async () => {
    const A = TOKEN.slice(0, 12), B = TOKEN.slice(12);
    for(const [caso, token] of [['\\n en medio', A + '\n' + B], ['\\r\\n en medio', A + '\r\n' + B], ['espacio en medio', A + ' ' + B], ['tabulador en medio', A + '\t' + B],
      ['dos tokens pegados en dos líneas', TOKEN + '\n' + TOKEN], ['salto en medio y al final', A + '\n' + B + '\n'], ['avance de página al final (btrim no lo quita)', TOKEN + '\f']]){
      const db = await nueva();
      await secretos(db, { token });
      assert(await disparar(db) === 'sin secreto', caso + ': no devolvió «sin secreto»');
      assert((await cola(db)).length === 0, caso + ': se encoló una petición con el token partido');
      const d = await disparos(db);
      assert(d.length === 1 && d[0].resultado === 'sin_secreto' && d[0].detalle === M_TOKEN, caso + ': ' + JSON.stringify(d));
      const [a] = soloAdmins(await avisos(db), T_CREDENCIAL);
      assert(a.mensaje === M_TOKEN + M_RESERVA, caso + ': «' + a.mensaje + '»');
      const visible = await textoVisible(db);
      assert(!visible.includes(A) && !visible.includes(B), caso + ': un trozo del token quedó a la vista');
      await db.close();
    }
  });

  await prueba('Vault ilegible al DISPARAR (la vista no existe, o descifrar falla): no revienta; «sin secreto» con el texto fijo «No se pudo leer Vault.», aviso, nada encolado y el error no se copia', async () => {
    for(const [caso, romper] of [['sin vista', VAULT_SIN_VISTA], ['descifrado roto', VAULT_ROTO]]){
      const db = await nueva();
      await secretos(db);
      await db.exec(romper);
      const e = await falla(() => db.query(`select decrypted_secret from vault.decrypted_secrets`));
      assert(e, caso + ': en este montaje la lectura de Vault debía fallar');
      const r = await falla(() => disparar(db));
      assert(r === null, caso + ': disparar reventó: ' + (r && r.message));
      assert(await disparar(db, true) === 'sin secreto', caso + ': no devolvió «sin secreto»');
      assert((await cola(db)).length === 0, caso + ': encoló una petición');
      const d = await disparos(db);
      assert(d.length === 2 && d.every(x => x.resultado === 'sin_secreto' && x.peticion_id === null && x.detalle === M_VAULT), caso + ': ' + JSON.stringify(d));
      const n = await avisos(db);
      assert(n.length === 2, caso + ': avisos ' + n.length);
      const [a] = soloAdmins(n, T_CREDENCIAL);
      assert(a.mensaje === M_VAULT + M_RESERVA, caso + ': «' + a.mensaje + '»');
      const visible = await textoVisible(db);
      assert(!visible.includes('ZZZERRORVAULT') && !visible.includes('decrypted_secrets') && !visible.includes(TOKEN), caso + ': el error de Vault (o el token) quedó a la vista');
      // Con corrida buena de hoy ni siquiera intenta leer Vault
      await corridaBuena(db);
      assert(await disparar(db) === 'ya hay corrida buena de hoy', caso + ': con corrida buena');
      await db.close();
    }
  });

  await prueba('el token no aparece en exportacion_estado_disparos ni en notificaciones en ningún camino (enviado, aceptado, rechazado, sin respuesta, vigilante)', async () => {
    const db = await nueva();
    await secretos(db, { dias: 3 });
    // El cuerpo de la respuesta lleva el token a propósito: no se debe copiar. (El mensaje de error de pg_net sí se copia,
    // recortado a 120 caracteres: es texto de curl —«Timeout was reached»…— y no trae cabeceras.)
    for(const resp of [{ status: 204 }, { status: 401, cuerpo: '{"message":"Bad credentials ' + TOKEN + '"}' }, { timedOut: true, error: 'ZZZ Timeout was reached' }, null]){
      await disparar(db, true);
      const id = (await cola(db)).pop().id;
      if(resp) await responder(db, id, resp);
      else await db.query(`update public.exportacion_estado_disparos set creado_en = now() - interval '5 minutes' where peticion_id = $1`, [id]);
      await comprobar(db);
    }
    assert(await vigilar(db) === 4, 'el vigilante debía dejar caducidad y «no se generó»');
    const d = (await disparos(db)).sort((a, b) => Number(a.peticion_id) - Number(b.peticion_id));
    assert(JSON.stringify(d.map(x => x.resultado)) === JSON.stringify(['aceptado', 'rechazado', 'rechazado', 'sin_respuesta']), JSON.stringify(d.map(x => x.resultado)));
    assert(igual(await titulos(db), [T_RECHAZO + ':2', T_SIN_RESPUESTA + ':2', T_POR_CADUCAR + ':2', T_NO_GENERO + ':2'].sort()), 'avisos: ' + JSON.stringify(await titulos(db)));
    const visible = await textoVisible(db);
    assert(!visible.includes('ZZZ-TOKEN'), 'el token quedó escrito donde la app lo puede leer');
    assert(!visible.includes('Bad credentials'), 'se copió el cuerpo de la respuesta de GitHub');
    // Tampoco viaja en la URL ni en el cuerpo de la petición: solo en la cabecera Authorization
    const q = await cola(db);
    assert(q.length === 3, 'la petición sin respuesta debía salir de la cola; quedan ' + q.length);
    for(const p of q){
      assert(!p.url.includes('ZZZ-TOKEN') && !JSON.stringify(p.body).includes('ZZZ-TOKEN'), 'el token va en la URL o en el cuerpo');
      const fuera = { ...p.headers }; delete fuera.Authorization;
      assert(!JSON.stringify(fuera).includes('ZZZ-TOKEN'), 'el token va en otra cabecera además de Authorization');
    }
  });

  await prueba('con corrida buena de hoy no dispara, salvo p_forzar; una corrida fallida o una buena de ayer no lo impiden; una degradada sí', async () => {
    const db = await nueva();
    await secretos(db);
    await db.exec(`insert into public.exportaciones_estado (fecha, ok, detalle) values (${HOY_EC} - 1, true, 'ZZZ ayer'), (${HOY_EC}, false, 'ZZZ fallida de hoy')`);
    assert(/^enviado/.test(await disparar(db)), 'una corrida de ayer o una fallida de hoy impidieron el disparo');
    await corridaBuena(db);
    assert(await disparar(db) === 'ya hay corrida buena de hoy', 'disparó con corrida buena de hoy');
    assert(await uno(db, `select public.exportacion_estado_disparar(false) as r`).then(x => x.r) === 'ya hay corrida buena de hoy', 'disparar(false)');
    assert(await uno(db, `select public.exportacion_estado_disparar(null) as r`).then(x => x.r) === 'ya hay corrida buena de hoy', 'disparar(null)');
    assert((await cola(db)).length === 1 && await cuenta(db, 'public.exportacion_estado_disparos') === 1, 'la llamada sin efecto dejó petición o fila');
    assert(/^enviado/.test(await disparar(db, true)), 'p_forzar no forzó');
    assert((await cola(db)).length === 2 && await cuenta(db, 'public.exportacion_estado_disparos', `resultado = 'enviado'`) === 2, 'p_forzar no encoló');
    const db2 = await nueva();
    await secretos(db2);
    await db2.query(`select public.exportacion_estado_registrar(true, 'ZZZ degradada', 'ZZZ aviso de bloques')`);
    assert(await disparar(db2) === 'ya hay corrida buena de hoy', 'una corrida degradada (ok con aviso) cuenta como buena');
    // Con corrida buena y SIN secretos tampoco avisa de la credencial: no hace nada
    const db3 = await nueva();
    await corridaBuena(db3);
    assert(await disparar(db3) === 'ya hay corrida buena de hoy' && await cuenta(db3, 'public.notificaciones') === 0, 'avisó de la credencial aunque no había nada que lanzar');
  });

  // ── Comprobación ──────────────────────────────────────────────────────────
  await prueba('comprobar: 204 y 200 → «aceptado» con su código, sin aviso; una segunda llamada no tiene nada que comprobar', async () => {
    for(const status of [204, 200]){
      const db = await nueva();
      await secretos(db);
      await disparar(db);
      const id = (await cola(db))[0].id;
      await responder(db, id, { status, cuerpo: status === 200 ? '{"ZZZCUERPO":"workflow_run_id"}' : '' });
      assert(await comprobar(db) === 'aceptado', status + ': respuesta de comprobar');
      const d = await disparos(db);
      assert(d.length === 1 && d[0].resultado === 'aceptado' && d[0].detalle === 'GitHub aceptó el disparo (' + status + ').', status + ': ' + JSON.stringify(d));
      assert(await cuenta(db, 'public.notificaciones') === 0, status + ': un disparo aceptado no debe avisar');
      assert(await comprobar(db) === 'nada que comprobar', status + ': segunda llamada');
      // Aceptado, el vigilante no menciona el disparo si luego no hay corrida
      assert(await vigilar(db) === 2 && (await avisos(db))[0].mensaje === await textoNoGenero(db), status + ': el vigilante habló de un disparo aceptado');
      assert(!(await textoVisible(db)).includes('ZZZCUERPO'), status + ': se copió el cuerpo de la respuesta');
      await db.close();
    }
    assert(await comprobar(await nueva()) === 'nada que comprobar', 'sin disparos');
  });

  await prueba('comprobar: 401, 403, 404, 422, 500, otros 2xx/3xx, tiempo agotado y error de red → «rechazado» con su motivo y UN aviso por admin; no repite', async () => {
    const CASOS = [
      ['401', { status: 401, cuerpo: '{"message":"ZZZCUERPO Bad credentials"}' }, /^GitHub rechazó el token \(401\): está caducado, revocado o mal guardado en Vault\.$/, 'rechazado(401)'],
      ['403', { status: 403, cuerpo: '{"message":"ZZZCUERPO Resource not accessible"}' }, /^GitHub respondió 403: el token no tiene el permiso «Actions: lectura y escritura»/, 'rechazado(403)'],
      ['404', { status: 404, cuerpo: '{"message":"ZZZCUERPO Not Found"}' }, /^GitHub respondió 404: .*el repositorio o el workflow no existen/, 'rechazado(404)'],
      ['422', { status: 422, cuerpo: '{"message":"ZZZCUERPO Unexpected inputs"}' }, /^GitHub respondió 422: el workflow no acepta ese disparo/, 'rechazado(422)'],
      ['500', { status: 500, cuerpo: 'ZZZCUERPO' }, /^GitHub respondió 500\.$/, 'rechazado(500)'],
      ['201 (solo 200 y 204 son «aceptado»)', { status: 201, cuerpo: 'ZZZCUERPO' }, /^GitHub respondió 201\.$/, 'rechazado(201)'],
      ['202', { status: 202, cuerpo: 'ZZZCUERPO' }, /^GitHub respondió 202\.$/, 'rechazado(202)'],
      ['302', { status: 302, cuerpo: 'ZZZCUERPO' }, /^GitHub respondió 302\.$/, 'rechazado(302)'],
      ['tiempo agotado', { timedOut: true, error: 'ZZZ Timeout of 15000 ms reached' }, /^GitHub no respondió a tiempo \(ZZZ Timeout of 15000 ms reached\)\.$/, 'rechazado(sin código)'],
      ['error de red', { timedOut: false, error: 'ZZZ Could not resolve host' }, /^GitHub no respondió a tiempo \(ZZZ Could not resolve host\)\.$/, 'rechazado(sin código)'],
      ['sin código ni mensaje', {}, /^GitHub no respondió a tiempo\.$/, 'rechazado(sin código)']
    ];
    for(const [caso, resp, motivo, devuelve] of CASOS){
      const db = await nueva();
      await secretos(db);
      await disparar(db);
      await responder(db, (await cola(db))[0].id, resp);
      const r = await comprobar(db);
      assert(r === devuelve, caso + ': comprobar devolvió «' + r + '»');
      const d = await disparos(db);
      assert(d.length === 1 && d[0].resultado === 'rechazado' && motivo.test(d[0].detalle), caso + ': ' + JSON.stringify(d));
      const [a] = soloAdmins(await avisos(db), T_RECHAZO);
      assert(await cuenta(db, 'public.notificaciones') === 2, caso + ': avisos de más');
      assert(a.mensaje === d[0].detalle + M_RESERVA_MANO, caso + ': mensaje «' + a.mensaje + '»');
      assert(!(await textoVisible(db)).includes('ZZZCUERPO'), caso + ': se copió el cuerpo de la respuesta');
      // No repite: ni al volver a comprobar ni si el segundo disparo del día también se rechaza
      assert(await comprobar(db) === 'nada que comprobar', caso + ': la segunda comprobación volvió a tratar el disparo');
      await disparar(db);        // el de las 04:20 (sigue sin corrida buena)
      await responder(db, (await cola(db))[1].id, resp);
      assert(await comprobar(db) === devuelve, caso + ': segundo disparo');
      assert(await cuenta(db, 'public.exportacion_estado_disparos', `resultado = 'rechazado'`) === 2, caso + ': el segundo rechazo no quedó registrado');
      assert(await cuenta(db, 'public.notificaciones') === 2, caso + ': el segundo rechazo del día duplicó el aviso');
      await db.close();
    }
  });

  await prueba('comprobar: sin respuesta tras más de 2 minutos → «sin_respuesta» con aviso y la petición SALE de la cola de pg_net; reciente sin respuesta → sigue «enviado», en cola y sin aviso', async () => {
    const db = await nueva();
    await secretos(db);
    await disparar(db);
    await disparar(db);                                              // otra petición reciente: no se toca
    const [p1, p2] = await cola(db);
    assert(await comprobar(db) === 'nada que comprobar', 'un disparo recién enviado no debía resolverse');
    await db.query(`update public.exportacion_estado_disparos set creado_en = now() - interval '1 minute 50 seconds' where peticion_id = $1`, [p1.id]);
    assert(await comprobar(db) === 'nada que comprobar', 'a 1 min 50 s todavía no toca');
    let d = await disparos(db);
    assert(d.length === 2 && d.every(x => x.resultado === 'enviado' && x.detalle === null), JSON.stringify(d));
    assert(await cuenta(db, 'public.notificaciones') === 0, 'avisó antes de tiempo');
    assert((await cola(db)).length === 2, 'se retiró de la cola una petición que aún podía salir');
    await db.query(`update public.exportacion_estado_disparos set creado_en = now() - interval '2 minutes 5 seconds' where peticion_id = $1`, [p1.id]);
    assert(await comprobar(db) === 'sin_respuesta', 'pasados 2 minutos sin respuesta');
    d = (await disparos(db)).sort((a, b) => Number(a.peticion_id) - Number(b.peticion_id));
    assert(d[0].resultado === 'sin_respuesta' && d[0].detalle === M_SIN_RESPUESTA && d[1].resultado === 'enviado', JSON.stringify(d));
    const [a] = soloAdmins(await avisos(db), T_SIN_RESPUESTA);
    assert(a.mensaje.includes('05:20') && a.mensaje.includes('a mano'), a.mensaje);
    // La petición lleva el token en la cabecera: no se queda en la cola (solo esa; la otra sigue)
    const q = await cola(db);
    assert(q.length === 1 && Number(q[0].id) === Number(p2.id), 'cola tras «sin_respuesta»: ' + JSON.stringify(q.map(x => x.id)));
    assert(await comprobar(db) === 'nada que comprobar' && await cuenta(db, 'public.notificaciones') === 2, 'la segunda comprobación duplicó');
    // Si pg_net ya la había sacado de la cola (lo normal), tampoco pasa nada
    const db2 = await nueva();
    await secretos(db2);
    await disparar(db2);
    await db2.exec(`delete from net.http_request_queue; update public.exportacion_estado_disparos set creado_en = now() - interval '3 minutes'`);
    assert(await comprobar(db2) === 'sin_respuesta', 'sin fila en la cola');
    // Y si la cola no se puede tocar, el disparo queda igualmente resuelto y avisado
    const db3 = await nueva();
    await secretos(db3);
    await disparar(db3);
    await db3.exec(`alter table net.http_request_queue rename to zzz_cola_ausente; update public.exportacion_estado_disparos set creado_en = now() - interval '3 minutes'`);
    assert(await comprobar(db3) === 'sin_respuesta' && await cuenta(db3, 'public.notificaciones', `titulo = '${T_SIN_RESPUESTA}'`) === 2, 'un fallo al limpiar la cola tumbó la comprobación');
  });

  await prueba('comprobar: varios disparos se resuelven cada uno con su respuesta, los de hoy y los de ayer; los de anteayer y los «sin_secreto» no se tocan', async () => {
    const db = await nueva();
    await disparar(db);                                    // sin secretos → fila sin_secreto (sin petición)
    await secretos(db);
    await disparar(db, true); await disparar(db, true); await disparar(db, true);
    const q = await cola(db);
    await responder(db, q[0].id, { status: 204 });
    await responder(db, q[1].id, { status: 401 });         // el tercero, reciente y sin respuesta
    await db.exec(`insert into public.exportacion_estado_disparos (fecha, peticion_id, resultado, creado_en) values
      (${HOY_EC} - 1, 9001, 'enviado', now() - interval '1 day'),
      (${HOY_EC} - 2, 9002, 'enviado', now() - interval '2 days')`);
    await responder(db, 9001, { status: 403 });
    await responder(db, 9002, { status: 401 });
    assert(await comprobar(db) === 'rechazado(403) aceptado rechazado(401)', 'respuesta de comprobar (por orden de envío): ' + await comprobar(db));
    const r = (await filas(db, `select peticion_id, resultado from public.exportacion_estado_disparos order by peticion_id nulls first`)).map(x => (x.peticion_id === null ? '-' : Number(x.peticion_id)) + ':' + x.resultado);
    assert(JSON.stringify(r) === JSON.stringify(['-:sin_secreto', q[0].id + ':aceptado', q[1].id + ':rechazado', q[2].id + ':enviado', '9001:rechazado', '9002:enviado']), JSON.stringify(r));
    // El aviso de rechazo es el del disparo de HOY (401), no el de ayer (403)
    const [a] = soloAdmins(await avisos(db), T_RECHAZO);
    assert(a.mensaje === M_401 + M_RESERVA_MANO, a.mensaje);
    // El disparo aceptado de hoy retira el aviso de credencial anterior; queda el del rechazo posterior
    assert(igual(await titulos(db), [T_RECHAZO + ':2']), JSON.stringify(await titulos(db)));
  });

  await prueba('disparo de AYER que seguía en «enviado»: se resuelve (rechazado, aceptado o sin respuesta) SIN avisar por la campana y sin contar para el vigilante de hoy', async () => {
    const CASOS = [
      ['401', { status: 401, cuerpo: 'ZZZCUERPO' }, 'rechazado(401)', 'rechazado', M_401],
      ['tiempo agotado', { timedOut: true, error: 'ZZZ Timeout' }, 'rechazado(sin código)', 'rechazado', 'GitHub no respondió a tiempo (ZZZ Timeout).'],
      ['204', { status: 204 }, 'aceptado', 'aceptado', 'GitHub aceptó el disparo (204).'],
      ['200', { status: 200 }, 'aceptado', 'aceptado', 'GitHub aceptó el disparo (200).'],
      ['sin respuesta', null, 'sin_respuesta', 'sin_respuesta', M_SIN_RESPUESTA]
    ];
    for(const [caso, resp, devuelve, resultado, detalle] of CASOS){
      const db = await nueva();
      await secretos(db);
      await encolar(db, 9001);
      await db.exec(`insert into public.exportacion_estado_disparos (fecha, peticion_id, resultado, creado_en) values (${HOY_EC} - 1, 9001, 'enviado', now() - interval '20 hours')`);
      if(resp) await responder(db, 9001, resp);
      assert(await comprobar(db) === devuelve, caso + ': comprobar devolvió otra cosa');
      const d = await disparos(db);
      assert(d.length === 1 && d[0].hoy === false && d[0].resultado === resultado && d[0].detalle === detalle, caso + ': ' + JSON.stringify(d));
      assert(await cuenta(db, 'public.notificaciones') === 0, caso + ': un disparo de ayer avisó por la campana: ' + JSON.stringify(await titulos(db)));
      if(!resp) assert((await cola(db)).length === 0, caso + ': la petición de ayer (con el token) sigue en la cola');
      assert(await comprobar(db) === 'nada que comprobar', caso + ': segunda llamada');
      // El vigilante de hoy no achaca a hoy el disparo de ayer
      assert(await vigilar(db) === 2 && (await avisos(db))[0].mensaje === await textoNoGenero(db), caso + ': el aviso de hoy habla del disparo de ayer');
      await db.close();
    }
  });

  await prueba('limpieza de 90 días: comprobar borra del registro de disparos lo de más de 90 días y nada más', async () => {
    const db = await nueva();
    await db.exec(`insert into public.exportacion_estado_disparos (fecha, peticion_id, resultado, detalle, creado_en) values
      (${HOY_EC} - 200, 1, 'aceptado', 'ZZZ fila 200', now() - interval '200 days'),
      (${HOY_EC} - 91, 2, 'rechazado', 'ZZZ fila 91', now() - interval '91 days'),
      (${HOY_EC} - 91, null, 'sin_secreto', 'ZZZ fila 91 b', now() - interval '91 days'),
      (${HOY_EC} - 90, 3, 'enviado', 'ZZZ fila 90', now() - interval '90 days'),
      (${HOY_EC} - 1, 4, 'sin_respuesta', 'ZZZ fila 1', now() - interval '1 day'),
      (${HOY_EC}, 5, 'aceptado', 'ZZZ fila 0', now());
      insert into public.exportaciones_estado (fecha, ok, detalle) values (${HOY_EC} - 200, true, 'ZZZ corrida 200');
      insert into public.notificaciones (perfil_id, tipo, titulo, mensaje, created_at) values ('${ADMIN_1}', 'exportacion_estado', 'ZZZ aviso 200', 'ZZZ', now() - interval '200 days');`);
    assert(await comprobar(db) === 'nada que comprobar', 'no había disparos de hoy pendientes');
    const quedan = (await filas(db, `select detalle from public.exportacion_estado_disparos order by fecha`)).map(x => x.detalle);
    assert(JSON.stringify(quedan) === JSON.stringify(['ZZZ fila 90', 'ZZZ fila 1', 'ZZZ fila 0']), 'quedaron: ' + JSON.stringify(quedan));
    assert(await cuenta(db, 'public.exportaciones_estado') === 1 && await cuenta(db, 'public.notificaciones') === 1, 'la limpieza tocó otras tablas (eso es cosa de exportacion_estado_registrar)');
  });

  // ── Vigilante ─────────────────────────────────────────────────────────────
  await prueba('vigilante, lo de antes: sin corrida buena de hoy avisa a cada admin UNA vez (la segunda llamada no duplica); con corrida buena, 0', async () => {
    for(const conSecretos of [false, true]){
      const db = await nueva();
      if(conSecretos) await secretos(db, { dias: 200 });
      assert(await vigilar(db) === 2, 'la primera llamada debía dejar 2 avisos (con secretos: ' + conSecretos + ')');
      assert(await vigilar(db) === 0, 'la segunda llamada duplicó');
      const n = await avisos(db);
      assert(n.length === 2, 'avisos: ' + n.length);
      const [a] = soloAdmins(n, T_NO_GENERO);
      assert(a.mensaje === await textoNoGenero(db), 'mensaje: ' + a.mensaje);
      assert(await cuenta(db, 'public.exportaciones_estado') === 0 && await cuenta(db, 'public.exportacion_estado_disparos') === 0 && (await cola(db)).length === 0, 'el vigilante no debe escribir en los registros ni disparar');
      const db2 = await nueva();
      if(conSecretos) await secretos(db2, { dias: 200 });
      await db2.exec(`insert into public.exportaciones_estado (fecha, ok, detalle) values (${HOY_EC} - 1, true, 'ZZZ ayer')`);
      assert(await vigilar(db2) === 2, 'la corrida de ayer no debía silenciar al vigilante');
      await corridaBuena(db2);
      assert(await vigilar(db2) === 0 && await cuenta(db2, 'public.notificaciones') === 0, 'avisó aunque había corrida buena de hoy');
    }
  });

  await prueba('vigilante, lo de antes: un aviso de ayer no impide el de hoy; tras una corrida fallida y luego una buena, calla', async () => {
    const db = await nueva();
    await vigilar(db);
    await db.query(`update public.notificaciones set created_at = now() - interval '1 day' where perfil_id = $1`, [ADMIN_2]);
    assert(await vigilar(db) === 1, 'debía avisar solo al admin sin aviso de hoy');
    await db.query(`select public.exportacion_estado_registrar(false, 'ZZZ fallo de las 03:10')`);
    await corridaBuena(db);
    assert(await vigilar(db) === 0, 'el vigilante avisó tras la corrida buena');
  });

  await prueba('vigilante: si la corrida fallida ya avisó hoy («falló») NO añade «no se generó» (como la 20261121), pero SÍ deja el aviso de caducidad', async () => {
    const antes = await previa();                                    // la misma secuencia con la versión anterior del vigilante
    await antes.query(`select public.exportacion_estado_registrar(false, 'ZZZ fallo de las 03:10')`);
    assert((await uno(antes, `select public.exportacion_estado_vigilar() as n`)).n === 0, 'la versión anterior ya no se comporta como se creía');
    // Sin nada que decir del token: 0 avisos nuevos
    for(const cfg of [null, { dias: 200 }, { descripcion: 'caduca=nunca' }]){
      const db = await nueva();
      if(cfg) await secretos(db, cfg);
      await db.query(`select public.exportacion_estado_registrar(false, 'ZZZ fallo de las 03:10')`);
      assert(await vigilar(db) === 0, 'el vigilante añadió avisos encima de los de «falló» (' + JSON.stringify(cfg) + '): ' + JSON.stringify(await titulos(db)));
      assert(igual(await titulos(db), [T_FALLO + ':2']), JSON.stringify(await titulos(db)));
      await db.close();
    }
    // Con el token por caducar, caducado o sin fecha: solo el aviso de caducidad
    for(const [cfg, titulo] of [[{ dias: 3 }, T_POR_CADUCAR], [{ dias: -3 }, T_CADUCO], [{ descripcion: 'ZZZ sin fecha' }, T_SIN_FECHA]]){
      const db = await nueva();
      await secretos(db, cfg);
      await db.query(`select public.exportacion_estado_registrar(false, 'ZZZ fallo de las 03:10')`);
      assert(await vigilar(db) === 2, titulo + ': debía dejar solo los 2 avisos de caducidad');
      assert(igual(await titulos(db), [T_FALLO + ':2', titulo + ':2'].sort()), JSON.stringify(await titulos(db)));
      assert(await vigilar(db) === 0, titulo + ': la segunda llamada duplicó');
      await db.close();
    }
    // Es por admin: al que no tiene «falló» de hoy sí le llega «no se generó»
    const db = await nueva();
    await db.query(`select public.exportacion_estado_registrar(false, 'ZZZ fallo de las 03:10')`);
    await db.query(`update public.notificaciones set created_at = now() - interval '1 day' where perfil_id = $1`, [ADMIN_2]);
    assert(await vigilar(db) === 1, 'debía avisar solo al admin sin aviso de corrida de hoy');
    const n = (await avisos(db)).filter(x => x.titulo === T_NO_GENERO);
    assert(n.length === 1 && n[0].perfil_id === ADMIN_2, JSON.stringify(n.map(x => x.perfil_id)));
    // Un aviso de otro título del mismo tipo (credencial, rechazo, caducidad) NO silencia «no se generó»
    const db2 = await nueva();
    await secretos(db2, { dias: 2 });
    await disparar(db2);
    await responder(db2, (await cola(db2))[0].id, { status: 401 });
    await comprobar(db2);
    await corridaBuena(db2); await vigilar(db2);                     // deja el aviso de caducidad con corrida buena…
    await db2.exec(`delete from public.exportaciones_estado`);       // …y la corrida «desaparece» (montaje): quedan rechazo y caducidad
    assert(await vigilar(db2) === 2 && igual(await titulos(db2), [T_RECHAZO + ':2', T_POR_CADUCAR + ':2', T_NO_GENERO + ':2'].sort()), JSON.stringify(await titulos(db2)));
  });

  await prueba('caducidad del token (con corrida buena de hoy): a 15 días nada; a 14 y a 2 «caduca el … (faltan N días)»; a 1 «mañana (falta 1 día)»; a 0 «hoy»; caducado, título «CADUCÓ»; un aviso por admin y día', async () => {
    for(const dias of [200, 15, 14, 2, 1, 0, -1, -400]){
      const db = await nueva();
      await secretos(db, { dias });
      await corridaBuena(db);
      const esperado = await textoCaducidad(db, dias);
      const n = await vigilar(db);
      if(!esperado){
        assert(n === 0 && await cuenta(db, 'public.notificaciones') === 0, 'a ' + dias + ' días no debía avisar y dejó ' + n);
      }else{
        assert(n === 2, 'a ' + dias + ' días debía dejar 2 avisos y dejó ' + n);
        assert(igual(await titulos(db), [esperado.titulo + ':2']), 'a ' + dias + ' días: títulos ' + JSON.stringify(await titulos(db)));
        const [a] = soloAdmins(await avisos(db), esperado.titulo);
        assert(a.mensaje === esperado.mensaje, 'a ' + dias + ' días: «' + a.mensaje + '» y se esperaba «' + esperado.mensaje + '»');
        assert(await vigilar(db) === 0 && await cuenta(db, 'public.notificaciones') === 2, 'a ' + dias + ' días: la segunda llamada duplicó');
        // Al día siguiente vuelve a avisar («cada día»)
        await db.exec(`update public.notificaciones set created_at = created_at - interval '1 day'`);
        assert(await vigilar(db) === 2, 'a ' + dias + ' días: un aviso de ayer impidió el de hoy');
      }
      assert(!(await textoVisible(db)).includes(TOKEN), 'el aviso de caducidad lleva el token');
      await db.close();
    }
    // Los textos literales de los tres casos cercanos
    const db = await nueva();
    const [t0, t1, t2, tc] = [await textoCaducidad(db, 0), await textoCaducidad(db, 1), await textoCaducidad(db, 2), await textoCaducidad(db, -1)];
    assert(t0.mensaje.includes(' caduca hoy. ') && t1.mensaje.includes(' caduca mañana (falta 1 día). ') && / caduca el \d{4}-\d{2}-\d{2} \(faltan 2 días\)\. /.test(t2.mensaje) && / caducó el \d{4}-\d{2}-\d{2}\. /.test(tc.mensaje),
      'los textos esperados de esta prueba no son los del diseño');
    assert(new Set([T_POR_CADUCAR, T_CADUCO, T_SIN_FECHA, T_VAULT]).size === 4, 'los títulos de caducidad deben ser distintos');
  });

  await prueba('caducidad: descripción sin fecha, vacía, nula o con una fecha imposible → aviso con título propio de que no está anotada; sin el secreto del token, nada', async () => {
    // En este doble la descripción admite nulo, para probar también ese caso
    const conNulos = await nueva();
    await conNulos.exec(`alter table vault.secrets alter column description drop not null`);
    const copiaConNulos = await conNulos.dumpDataDir('none');
    await conNulos.close();
    for(const descripcion of ['ZZZ token de la exportación', '', null, 'caduca=2026-13-45', 'caduca=2027-02-30', 'caduca=0000-00-00', 'caduca=26-11-30', 'caduca: 2027-01-01', 'caduca=', 'caduca=jamás']){
      const db = new PGlite({ loadDataDir: copiaConNulos }); await db.waitReady;
      await secretos(db, { descripcion });
      await corridaBuena(db);
      assert(await vigilar(db) === 2, JSON.stringify(descripcion) + ': debía avisar');
      assert(igual(await titulos(db), [T_SIN_FECHA + ':2']), JSON.stringify(descripcion) + ': títulos ' + JSON.stringify(await titulos(db)));
      const [a] = soloAdmins(await avisos(db), T_SIN_FECHA);
      assert(a.mensaje === M_SIN_FECHA, JSON.stringify(descripcion) + ': «' + a.mensaje + '»');
      assert(await vigilar(db) === 0, JSON.stringify(descripcion) + ': la segunda llamada duplicó');
      await db.close();
    }
    // La fecha se lee aunque la descripción traiga más texto
    const db = await nueva();
    await db.query(`insert into vault.secrets (secret, name, description) values ($1, 'github_estado_diario', 'ZZZ token fino; caduca=' || to_char(${HOY_EC} + 5, 'YYYY-MM-DD') || ' (renovar)')`, [TOKEN]);
    await corridaBuena(db);
    assert(await vigilar(db) === 2 && (await avisos(db))[0].mensaje === (await textoCaducidad(db, 5)).mensaje, 'no leyó la fecha dentro de un texto más largo');
    // Solo el secreto del repositorio (sin token): el vigilante no dice nada de caducidad
    const db2 = await nueva();
    await secretos(db2, { token: null });
    await corridaBuena(db2);
    assert(await vigilar(db2) === 0, 'avisó de caducidad sin que exista el secreto del token');
  });

  await prueba('«caduca=nunca» en la descripción: el vigilante no avisa de caducidad, ni con corrida buena ni dentro de «no se generó»; el disparo funciona igual', async () => {
    for(const descripcion of ['caduca=nunca', 'ZZZ token clásico; caduca=nunca (sin fecha)']){
      const db = await nueva();
      await secretos(db, { descripcion });
      assert(/^enviado/.test(await disparar(db)), descripcion + ': no disparó');
      assert(await vigilar(db) === 2, descripcion + ': sin corrida debía dejar solo «no se generó»');
      assert(igual(await titulos(db), [T_NO_GENERO + ':2']), descripcion + ': ' + JSON.stringify(await titulos(db)));
      assert((await avisos(db))[0].mensaje === await textoNoGenero(db), descripcion + ': «' + (await avisos(db))[0].mensaje + '»');
      await corridaBuena(db);
      assert(await vigilar(db) === 0 && await cuenta(db, 'public.notificaciones') === 0, descripcion + ': avisó con corrida buena');
      await db.close();
    }
  });

  await prueba('caducidad con corrida AUSENTE: SIEMPRE en su propio aviso (insertado antes) y además DENTRO del texto de «no se generó»; devuelve la suma; a 15 días no se añade nada', async () => {
    const CASOS = [[{ dias: 14 }, 14], [{ dias: 1 }, 1], [{ dias: 0 }, 0], [{ dias: -2 }, -2], [{ descripcion: 'ZZZ sin fecha' }, null]];
    for(const [cfg, dias] of CASOS){
      const db = await nueva();
      await secretos(db, cfg);
      const esperado = dias === null ? { titulo: T_SIN_FECHA, mensaje: M_SIN_FECHA } : await textoCaducidad(db, dias);
      assert(await vigilar(db) === 4, JSON.stringify(cfg) + ' sin corrida: debía devolver 4 (2 de caducidad + 2 de «no se generó»)');
      const n = await avisos(db);
      assert(igual(await titulos(db), [esperado.titulo + ':2', T_NO_GENERO + ':2'].sort()), JSON.stringify(cfg) + ': ' + JSON.stringify(await titulos(db)));
      const [c] = soloAdmins(n, esperado.titulo);
      assert(c.mensaje === esperado.mensaje, JSON.stringify(cfg) + ': aviso propio «' + c.mensaje + '»');
      const [a] = soloAdmins(n, T_NO_GENERO);
      assert(a.mensaje === await textoNoGenero(db, null, esperado.mensaje), JSON.stringify(cfg) + ': «no se generó» dice «' + a.mensaje + '»');
      assert(await vigilar(db) === 0 && await cuenta(db, 'public.notificaciones') === 4, JSON.stringify(cfg) + ': la segunda llamada duplicó');
      await db.close();
    }
    const db2 = await nueva();
    await secretos(db2, { dias: 15 });
    assert(await vigilar(db2) === 2 && igual(await titulos(db2), [T_NO_GENERO + ':2']), 'a 15 días: ' + JSON.stringify(await titulos(db2)));
    assert((await avisos(db2))[0].mensaje === await textoNoGenero(db2), 'a 15 días el aviso de «no se generó» no debía hablar del token');
  });

  await prueba('Vault ilegible al VIGILAR: no revienta; avisa «No se pudo comprobar la caducidad…» y la alarma de «no se generó» sale igual; con corrida buena, solo el de caducidad', async () => {
    for(const [caso, romper] of [['sin vista', VAULT_SIN_VISTA], ['descifrado roto', VAULT_ROTO]]){
      const db = await nueva();
      await secretos(db, { dias: 200 });
      await db.exec(romper);
      const e = await falla(() => vigilar(db));
      assert(e === null, caso + ': el vigilante reventó y calló la alarma: ' + (e && e.message));
      assert(igual(await titulos(db), [T_VAULT + ':2', T_NO_GENERO + ':2'].sort()), caso + ': ' + JSON.stringify(await titulos(db)));
      const n = await avisos(db);
      const [c] = soloAdmins(n, T_VAULT);
      assert(c.mensaje === M_VAULT_CADUCIDAD, caso + ': «' + c.mensaje + '»');
      const [a] = soloAdmins(n, T_NO_GENERO);
      assert(a.mensaje === await textoNoGenero(db, null, M_VAULT_CADUCIDAD), caso + ': «' + a.mensaje + '»');
      assert(await vigilar(db) === 0 && await cuenta(db, 'public.notificaciones') === 4, caso + ': la segunda llamada duplicó');
      const visible = await textoVisible(db);
      assert(!visible.includes('ZZZERRORVAULT') && !visible.includes('decrypted_secrets') && !visible.includes(TOKEN), caso + ': el error de Vault quedó a la vista');
      // Primera llamada: devuelve la suma (2 + 2)
      const db2 = await nueva();
      await secretos(db2, { dias: 200 });
      await db2.exec(romper);
      assert(await vigilar(db2) === 4, caso + ': debía devolver 4');
      // Con corrida buena de hoy: solo el aviso de que no se pudo comprobar
      const db3 = await nueva();
      await secretos(db3, { dias: 200 });
      await db3.exec(romper);
      await corridaBuena(db3);
      assert(await vigilar(db3) === 2 && igual(await titulos(db3), [T_VAULT + ':2']), caso + ' con corrida buena: ' + JSON.stringify(await titulos(db3)));
      // Y como service_role (así lo llama el workflow)
      const db4 = await nueva();
      await db4.exec(romper);
      const e4 = await como(db4, 'service_role', '', () => falla(() => db4.query(`select public.exportacion_estado_vigilar()`)));
      assert(e4 === null && await cuenta(db4, 'public.notificaciones', `titulo = '${T_NO_GENERO}'`) === 2, caso + ' como service_role: ' + (e4 && e4.message));
      for(const d of [db, db2, db3, db4]) await d.close();
    }
  });

  await prueba('«no se generó» incluye «Disparo de hoy: …» con el motivo del ÚLTIMO disparo fallido de hoy (rechazado, sin secreto o sin respuesta); nada si no falló o si el fallo fue de ayer', async () => {
    // Rechazado hoy (422)
    let db = await nueva();
    await secretos(db);
    await disparar(db);
    await responder(db, (await cola(db))[0].id, { status: 422, cuerpo: 'ZZZCUERPO' });
    await comprobar(db);
    const det422 = (await disparos(db))[0].detalle;
    assert(/^GitHub respondió 422: /.test(det422), det422);
    assert(await vigilar(db) === 2, 'rechazado: debía dejar 2 avisos');
    let [a] = soloAdmins(await avisos(db), T_NO_GENERO);
    assert(a.mensaje === await textoNoGenero(db, det422) && a.mensaje.includes(' Disparo de hoy: GitHub respondió 422: '), 'rechazado: «' + a.mensaje + '»');
    // Rechazado (401) y con el token caducado: primero el disparo, después la caducidad
    db = await nueva();
    await secretos(db, { dias: -1 });
    await disparar(db);
    await responder(db, (await cola(db))[0].id, { status: 401 });
    await comprobar(db);
    assert(await vigilar(db) === 4, '401 + caducado: debía devolver 4');
    [a] = soloAdmins(await avisos(db), T_NO_GENERO);
    assert(a.mensaje === await textoNoGenero(db, M_401, (await textoCaducidad(db, -1)).mensaje), '401 + caducado: «' + a.mensaje + '»');
    // Sin respuesta
    db = await nueva();
    await secretos(db);
    await disparar(db);
    await db.exec(`update public.exportacion_estado_disparos set creado_en = now() - interval '3 minutes'`);
    await comprobar(db);
    await vigilar(db);
    [a] = soloAdmins(await avisos(db), T_NO_GENERO);
    assert(a.mensaje === await textoNoGenero(db, M_SIN_RESPUESTA), 'sin respuesta: «' + a.mensaje + '»');
    // Varios fallos hoy: manda el último (rechazado a las 03:13, sin secreto a las 04:20)
    db = await nueva();
    await secretos(db);
    await disparar(db);
    await responder(db, (await cola(db))[0].id, { status: 401 });
    await comprobar(db);
    await db.exec(`update public.exportacion_estado_disparos set creado_en = now() - interval '70 minutes'; delete from vault.secrets where name = 'github_estado_diario_repo'`);
    await disparar(db);
    await vigilar(db);
    [a] = soloAdmins(await avisos(db), T_NO_GENERO);
    assert(a.mensaje === await textoNoGenero(db, M_REPO), 'último fallo: «' + a.mensaje + '»');
    // El fallo fue de ayer; hoy solo hay uno en «enviado» reciente: no se menciona ningún disparo
    db = await nueva();
    await secretos(db);
    await db.exec(`insert into public.exportacion_estado_disparos (fecha, peticion_id, resultado, detalle, creado_en) values (${HOY_EC} - 1, 9001, 'rechazado', 'ZZZ rechazo de ayer', now() - interval '1 day')`);
    await disparar(db);
    await vigilar(db);
    [a] = soloAdmins(await avisos(db), T_NO_GENERO);
    assert(a.mensaje === await textoNoGenero(db) && !a.mensaje.includes('Disparo de hoy'), 'fallo de ayer: «' + a.mensaje + '»');
  });

  await prueba('día completo sin credencial: 03:10 «sin secreto», 03:13 nada que comprobar, 04:20 otra vez, 05:20 el vigilante avisa además de «no se generó» y dice por qué no se lanzó', async () => {
    const db = await nueva();
    assert(await disparar(db) === 'sin secreto' && await comprobar(db) === 'nada que comprobar' && await disparar(db) === 'sin secreto' && await comprobar(db) === 'nada que comprobar', 'secuencia de la madrugada');
    assert(await vigilar(db) === 2, 'el aviso de la credencial de las 03:10 no debe silenciar al vigilante');
    assert(igual(await titulos(db), [T_NO_GENERO + ':2', T_CREDENCIAL + ':2'].sort()), JSON.stringify(await titulos(db)));
    const [a] = soloAdmins(await avisos(db), T_NO_GENERO);
    assert(a.mensaje === await textoNoGenero(db, M_TOKEN), a.mensaje);
    // La corrida de reserva llega y sale bien: se va «no se generó», se queda el de la credencial
    await corridaBuena(db);
    assert(igual(await titulos(db), [T_CREDENCIAL + ':2']), 'tras la corrida de reserva: ' + JSON.stringify(await titulos(db)));
  });

  // ── Registro de la corrida: la buena retira SOLO los avisos de corrida ────
  await prueba('registrar(true) tras un rechazo de GitHub (la corrida de reserva, que llega tarde): el aviso de que GitHub rechazó el token se conserva', async () => {
    const db = await nueva();
    await secretos(db);
    await disparar(db);                                              // 03:10
    await responder(db, (await cola(db))[0].id, { status: 401 });
    await comprobar(db);                                             // 03:13 → aviso «GitHub rechazó el token (401)»
    assert(await cuenta(db, 'public.notificaciones', `titulo = '${T_RECHAZO}'`) === 2, 'la prueba no llegó a dejar el aviso de rechazo');
    // Horas después corre el horario de reserva y registra la corrida buena (como hace el workflow, con service_role)
    await como(db, 'service_role', '', () => db.query(`select * from public.exportacion_estado_registrar(p_ok => true, p_detalle => 'ZZZ corrida de reserva', p_aviso => null)`));
    assert(igual(await titulos(db), [T_RECHAZO + ':2']), 'tras la corrida buena: ' + JSON.stringify(await titulos(db)));
    assert(await cuenta(db, 'public.exportaciones_estado', `ok and fecha = ${HOY_EC}`) === 1, 'la corrida no quedó registrada');
  });

  await prueba('registrar(true) después de las 05:20: se va «no se generó» y el aviso propio de caducidad del token se conserva', async () => {
    const db = await nueva();
    await secretos(db, { dias: -1 });                                // token caducado ayer → el disparo falla → la corrida llega tarde
    assert(await vigilar(db) === 4, 'el vigilante debía dejar caducidad y «no se generó»');   // 05:20
    await corridaBuena(db);                                          // la corrida de reserva, después de las 05:20
    assert(igual(await titulos(db), [T_CADUCO + ':2']), 'tras la corrida buena: ' + JSON.stringify(await titulos(db)));
    const [a] = soloAdmins(await avisos(db), T_CADUCO);
    assert(a.mensaje === (await textoCaducidad(db, -1)).mensaje, a.mensaje);
    assert(await vigilar(db) === 0 && await cuenta(db, 'public.notificaciones') === 2, 'el vigilante repitió tras la corrida buena');
  });

  await prueba('registrar(true) conserva los avisos de credencial, de disparo (rechazado y sin respuesta) y de caducidad (los cuatro títulos) y borra SOLO los de corrida de HOY (falló, no se generó, salió incompleta)', async () => {
    const db = await nueva();
    await disparar(db);                                              // sin secretos → aviso de credencial
    await secretos(db, { dias: -1 });
    await disparar(db);
    await responder(db, (await cola(db))[0].id, { status: 401 });
    await comprobar(db);                                             // → aviso de rechazo
    await disparar(db);
    await db.query(`update public.exportacion_estado_disparos set creado_en = now() - interval '3 minutes' where resultado = 'enviado'`);
    await comprobar(db);                                             // → aviso de «no se sabe si se lanzó»
    assert(await vigilar(db) === 4, 'vigilante');                    // → «CADUCÓ» + «no se generó»
    await db.query(`select public.exportacion_estado_registrar(false, 'ZZZ fallo')`);                          // → «falló»
    await db.query(`select public.exportacion_estado_registrar(true, 'ZZZ degradada', 'ZZZ faltan bloques')`); // → «salió incompleta» (no borra nada)
    for(const t of [T_POR_CADUCAR, T_SIN_FECHA, T_VAULT]) await db.query(`select public.exportacion_estado_avisar($1, 'ZZZ aviso de caducidad')`, [t]);
    // Lo que NO es de hoy o no es de este tipo tampoco se toca
    await db.exec(`insert into public.notificaciones (perfil_id, tipo, titulo, mensaje, created_at) values
      ('${ADMIN_1}', 'exportacion_estado', '${T_FALLO}', 'ZZZ fallo de ayer', now() - interval '1 day'),
      ('${ADMIN_1}', 'exportacion_estado', '${T_NO_GENERO}', 'ZZZ no se generó de ayer', now() - interval '1 day'),
      ('${ADMIN_1}', 'zzz_otro_tipo', '${T_FALLO}', 'ZZZ otro tipo, hoy', now()),
      ('${ADMIN_1}', 'exportacion_estado', 'ZZZ título desconocido', 'ZZZ hoy', now())`);
    const CONSERVA = [T_CREDENCIAL + ':2', T_RECHAZO + ':2', T_SIN_RESPUESTA + ':2', T_CADUCO + ':2', T_POR_CADUCAR + ':2', T_SIN_FECHA + ':2', T_VAULT + ':2', 'ZZZ título desconocido:1'];
    assert(igual(await titulos(db), [...CONSERVA, T_NO_GENERO + ':3', T_FALLO + ':4', T_INCOMPLETA + ':2'].sort()), 'montaje: ' + JSON.stringify(await titulos(db)));
    await como(db, 'service_role', '', () => db.query(`select public.exportacion_estado_registrar(true, 'ZZZ corrida buena de reserva')`));
    assert(igual(await titulos(db), [...CONSERVA, T_NO_GENERO + ':1', T_FALLO + ':2'].sort()), 'tras la corrida buena: ' + JSON.stringify(await titulos(db)));
    const restos = (await filas(db, `select mensaje from public.notificaciones where titulo in ('${T_FALLO}', '${T_NO_GENERO}', '${T_INCOMPLETA}') order by mensaje`)).map(x => x.mensaje);
    assert(igual(restos, ['ZZZ fallo de ayer', 'ZZZ no se generó de ayer', 'ZZZ otro tipo, hoy']), 'de corrida quedaron: ' + JSON.stringify(restos));
    // Los avisos conservados siguen diciendo lo suyo
    const n = await avisos(db);
    assert(soloAdmins(n, T_CREDENCIAL)[0].mensaje === M_TOKEN + M_RESERVA && soloAdmins(n, T_RECHAZO)[0].mensaje === M_401 + M_RESERVA_MANO
      && soloAdmins(n, T_CADUCO)[0].mensaje === (await textoCaducidad(db, -1)).mensaje, 'un aviso conservado cambió de texto');
  });

  await prueba('registrar: lo demás sigue como en la 20261121 (fallida avisa «falló»; degradada avisa «salió incompleta» y no borra; p_ok nulo se rechaza; limpieza de 90 días)', async () => {
    const db = await nueva();
    await db.query(`select public.exportacion_estado_registrar(false, 'ZZZ detalle del fallo', 'ZZZ aviso que se descarta')`);
    let [a] = soloAdmins(await avisos(db), T_FALLO);
    assert(a.mensaje === 'ZZZ detalle del fallo Los archivos de Drive pueden ser de un día anterior: mira la fecha «válido para».', a.mensaje);
    assert((await uno(db, `select aviso from public.exportaciones_estado`)).aviso === null, 'una corrida fallida guardó el aviso');
    await db.query(`select public.exportacion_estado_registrar(true, 'ZZZ degradada', 'ZZZ faltan bloques.')`);
    assert(igual(await titulos(db), [T_FALLO + ':2', T_INCOMPLETA + ':2'].sort()), 'la degradada borró o no avisó: ' + JSON.stringify(await titulos(db)));
    [a] = soloAdmins(await avisos(db), T_INCOMPLETA);
    assert(a.mensaje === 'ZZZ faltan bloques. Los archivos de hoy sí están en Drive, pero les faltan partes que no se pudieron calcular.', a.mensaje);
    const e = await falla(() => db.query(`select public.exportacion_estado_registrar(null, 'ZZZ')`));
    assert(e && e.code === '22004', 'p_ok nulo no se rechazó: ' + (e && e.code));
    await db.exec(`insert into public.exportaciones_estado (fecha, ok, detalle) values (${HOY_EC} - 91, true, 'ZZZ vieja'), (${HOY_EC} - 90, true, 'ZZZ en el límite');
      insert into public.notificaciones (perfil_id, tipo, titulo, mensaje, created_at) values
        ('${ADMIN_1}', 'exportacion_estado', '${T_RECHAZO}', 'ZZZ de hace 91 días', now() - interval '91 days'),
        ('${ADMIN_1}', 'zzz_otro_tipo', 'ZZZ', 'ZZZ otro tipo de hace 91 días', now() - interval '91 days')`);
    await corridaBuena(db);
    assert(await cuenta(db, 'public.exportaciones_estado', `detalle = 'ZZZ vieja'`) === 0 && await cuenta(db, 'public.exportaciones_estado', `detalle = 'ZZZ en el límite'`) === 1, 'limpieza del registro de corridas');
    assert(await cuenta(db, 'public.notificaciones', `mensaje = 'ZZZ de hace 91 días'`) === 0 && await cuenta(db, 'public.notificaciones', `mensaje = 'ZZZ otro tipo de hace 91 días'`) === 1, 'limpieza de avisos viejos');
    assert(igual(await titulos(db), ['ZZZ:1']), 'tras la corrida buena limpia: ' + JSON.stringify(await titulos(db)));
  });

  // ── La madrugada mala, entera ─────────────────────────────────────────────
  await prueba('MADRUGADA MALA completa: 03:10 disparo, 03:13 401, 04:20 segundo disparo, 04:23 401, 05:20 vigilante, 07:40 corrida de reserva buena → quedan el aviso de GitHub y el de caducidad (si aplica), no el de «no se generó»', async () => {
    for(const dias of [-1, 0, 5, 200]){
      const db = await nueva();
      const paso = t => 'token a ' + dias + ' días, ' + t;
      await secretos(db, { dias });
      const cad = await textoCaducidad(db, dias);                    // null a 200 días
      // 03:10
      assert(/^enviado \(petición \d+\)$/.test(await disparar(db)), paso('03:10: no disparó'));
      // 03:13
      await responder(db, (await cola(db))[0].id, { status: 401, cuerpo: '{"message":"ZZZCUERPO Bad credentials"}' });
      assert(await comprobar(db) === 'rechazado(401)', paso('03:13'));
      assert(igual(await titulos(db), [T_RECHAZO + ':2']), paso('03:13: ') + JSON.stringify(await titulos(db)));
      // 04:20 (sigue sin corrida buena: vuelve a disparar)
      assert(/^enviado \(petición \d+\)$/.test(await disparar(db)), paso('04:20: no disparó'));
      // 04:23
      await responder(db, (await cola(db))[1].id, { status: 401, cuerpo: '{"message":"ZZZCUERPO Bad credentials"}' });
      assert(await comprobar(db) === 'rechazado(401)', paso('04:23'));
      assert(igual(await titulos(db), [T_RECHAZO + ':2']), paso('04:23: el segundo rechazo duplicó: ') + JSON.stringify(await titulos(db)));
      // 05:20
      assert(await vigilar(db) === (cad ? 4 : 2), paso('05:20: número de avisos del vigilante'));
      assert(igual(await titulos(db), [T_RECHAZO + ':2', T_NO_GENERO + ':2', ...(cad ? [cad.titulo + ':2'] : [])].sort()), paso('05:20: ') + JSON.stringify(await titulos(db)));
      const [a] = soloAdmins(await avisos(db), T_NO_GENERO);
      assert(a.mensaje === await textoNoGenero(db, M_401, cad && cad.mensaje), paso('05:20: «' + a.mensaje + '»'));
      // 07:40: la corrida de reserva de GitHub, buena, registrada por el workflow (service_role)
      await como(db, 'service_role', '', () => db.query(`select public.exportacion_estado_registrar(true, 'ZZZ corrida de reserva de las 07:40')`));
      const final = await titulos(db);
      assert(igual(final, [T_RECHAZO + ':2', ...(cad ? [cad.titulo + ':2'] : [])].sort()), paso('07:40: quedaron ') + JSON.stringify(final));
      assert(!final.some(t => t.startsWith(T_NO_GENERO)), paso('07:40: sigue el aviso de «no se generó»'));
      const n = await avisos(db);
      assert(soloAdmins(n, T_RECHAZO)[0].mensaje === M_401 + M_RESERVA_MANO, paso('el aviso de GitHub cambió'));
      if(cad) assert(soloAdmins(n, cad.titulo)[0].mensaje === cad.mensaje, paso('el aviso de caducidad cambió'));
      // El resto del día no añade ni quita nada
      assert(await disparar(db) === 'ya hay corrida buena de hoy' && await comprobar(db) === 'nada que comprobar' && await vigilar(db) === 0, paso('después de la corrida buena'));
      assert(igual(await titulos(db), final), paso('algo cambió después: ') + JSON.stringify(await titulos(db)));
      const d = await disparos(db);
      assert(d.length === 2 && d.every(x => x.resultado === 'rechazado' && x.detalle === M_401 && x.hoy === true), paso('registro de disparos: ') + JSON.stringify(d));
      const visible = await textoVisible(db);
      assert(!visible.includes('ZZZ-TOKEN') && !visible.includes('ZZZCUERPO'), paso('el token o el cuerpo de la respuesta quedaron a la vista'));
      await db.close();
    }
  });

  // ── DEFECTO: esta prueba afirma lo correcto y falla con la migración tal como está ──
  // La campana (index.html, cargarNotificaciones) enseña UN solo aviso de tipo exportacion_estado: el último por created_at
  // (order created_at desc, limit 1). El vigilante inserta el aviso de caducidad y el de «no se generó» en la misma
  // transacción, así que los dos nacen con el mismo created_at (default now()) y cuál se ve queda al azar del desempate.
  await defecto('vigilante sin corrida y con algo que decir del token: «no se generó» debe quedar DESPUÉS del aviso de caducidad (created_at mayor), porque es el único que la campana muestra', async () => {
    for(const [caso, cfg, romper] of [['token caducado', { dias: -1 }, null], ['token por caducar', { dias: 3 }, null], ['sin fecha anotada', { descripcion: 'ZZZ sin fecha' }, null], ['Vault ilegible', {}, VAULT_SIN_VISTA]]){
      const db = await nueva();
      await secretos(db, cfg);
      if(romper) await db.exec(romper);
      assert(await vigilar(db) === 4, caso + ': el vigilante debía dejar caducidad y «no se generó»');
      for(const admin of [ADMIN_1, ADMIN_2]){
        const r = await filas(db, `select titulo, created_at from public.notificaciones where perfil_id = $1 and tipo = 'exportacion_estado'`, [admin]);
        const cad = r.find(x => x.titulo !== T_NO_GENERO), gen = r.find(x => x.titulo === T_NO_GENERO);
        assert(r.length === 2 && cad && gen, caso + ': avisos ' + JSON.stringify(r.map(x => x.titulo)));
        assert(new Date(gen.created_at).getTime() > new Date(cad.created_at).getTime(),
          caso + ': «' + cad.titulo + '» y «' + T_NO_GENERO + '» tienen el mismo created_at (' + new Date(gen.created_at).toISOString()
          + '): la campana (order by created_at desc limit 1) puede enseñar el de caducidad y tapar la alarma de que hoy no hay archivos');
      }
      // La misma lectura que hace la campana
      const visto = (await filas(db, `select titulo from public.notificaciones where perfil_id = $1 and tipo = 'exportacion_estado' order by created_at desc limit 1`, [ADMIN_1]))[0].titulo;
      assert(visto === T_NO_GENERO, caso + ': la campana enseñaría «' + visto + '»');
      await db.close();
    }
  });

  resumen();
  // Las bases embebidas que quedan abiertas mantienen vivo el proceso: se sale con el código de resumen().
  process.exit(process.exitCode || 0);
})().catch(e => { console.error(e); process.exit(1); });
