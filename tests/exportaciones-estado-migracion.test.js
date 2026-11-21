// Migración 20261121_exportaciones_estado.sql ejecutada de verdad en un Postgres
// embebido (pglite): tabla, RLS, permisos, registro de corridas, vigilante, tarea
// de pg_cron (con un doble mínimo del esquema cron) y la función de datos
// exportacion_estado_datos(), sobre un esquema mínimo de las tablas que lee (misma
// estructura que la base; datos sintéticos, prefijo ZZZ). Nunca toca producción
// ni la red.
//
// Además comprueba que el cuerpo de exportacion_estado_datos() en la migración es
// el mismo texto que exportacion/consulta.sql: si se cambia uno sin el otro, falla.
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
const CONSULTA = leer(path.join(RAIZ, 'exportacion', 'consulta.sql'));
// Las claves que el generador exige en los datos (cada una, un arreglo) y el generador mismo.
const { TABLAS, desenvolver } = require(path.join(RAIZ, 'exportacion', 'exportar.js'));
const { construirEstado } = require(path.join(RAIZ, 'exportacion', 'estado-proyectos.js'));
const EMPRESA = '00000000-0000-4000-8000-0000000000e1';
const PROY_1 = '00000000-0000-4000-8000-0000000000c1';
const PROY_2 = '00000000-0000-4000-8000-0000000000c2';
const FUNCIONES = [
  ['datos', `select public.exportacion_estado_datos()`],
  ['registrar', `select public.exportacion_estado_registrar(true, 'ZZZ intento', null)`],
  ['vigilar', `select public.exportacion_estado_vigilar()`]
];
// Texto SQL comparable: sin líneas de comentario, espacios en blanco reducidos a uno
// y sin el punto y coma final.
const normalizar = sql => sql.replace(/\r/g, '').split('\n').filter(l => !/^\s*--/.test(l)).join(' ')
  .replace(/\s+/g, ' ').trim().replace(/;$/, '').trim();
function cuerpoDeDatosEnLaMigracion(){
  const m = /create or replace function public\.exportacion_estado_datos\(\)([\s\S]*?)as \$datos\$\n([\s\S]*?)\n\$datos\$;/.exec(MIGRACION);
  assert(m, 'no se encontró exportacion_estado_datos() con su cuerpo entre $datos$ en la migración');
  return { cabecera: m[1], cuerpo: m[2] };
}
const ADMIN_1 = '00000000-0000-4000-8000-0000000000a1';
const ADMIN_2 = '00000000-0000-4000-8000-0000000000a2';
const USUARIO = '00000000-0000-4000-8000-0000000000b1';

// Lo mínimo de Supabase que la migración da por hecho: roles, auth.uid(), perfiles,
// notificaciones (columnas del esquema real), sst_es_admin_global() y los privilegios
// por defecto (Supabase concede todo a anon/authenticated/service_role al crear objetos).
// service_role salta la RLS, como en Supabase.
const BASE = `
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
  create table public.perfiles (id uuid primary key, empresa_id uuid, nombre text not null, apellido text not null,
    cargo text, avatar_url text, rol text default 'visualizador', created_at timestamptz default now(), email text);
  create table public.notificaciones (
    id uuid default gen_random_uuid() not null primary key, perfil_id uuid references public.perfiles(id) on delete cascade,
    tipo text, titulo text not null, mensaje text, leida boolean default false, url_destino text,
    created_at timestamptz default now());
  create function public.sst_es_admin_global() returns boolean language sql stable security definer as $$
    select exists (select 1 from perfiles p where p.id = auth.uid() and p.rol = 'admin'); $$;
  insert into public.perfiles (id, nombre, apellido, rol, email) values
    ('${ADMIN_1}', 'ZZZ Admin', 'Uno', 'admin', 'zzz.uno@example.invalid'), ('${ADMIN_2}', 'ZZZ Admin', 'Dos', 'admin', 'zzz.dos@example.invalid'),
    ('${USUARIO}', 'ZZZ Usuario', 'Tres', 'usuario', 'zzz.tres@example.invalid');
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

// Tablas que lee exportacion_estado_datos(): columnas y tipos de la base (dump de
// estructura más las migraciones 20261120_multiempresa_*), sin políticas ni
// disparadores. Las columnas que la consulta NO debe traer (correo, cédula, textos
// de los incidentes…) están para comprobar que no salen. Todos los datos son inventados.
const ESQUEMA = `
  create table public.empresas (id uuid default gen_random_uuid() primary key, nombre text not null, ruc text, logo_url text,
    created_at timestamptz default now(), sigla text, razon_social text, color text, logo_data text,
    es_gestora boolean not null default false, activa boolean not null default true);
  create table public.proyectos (id uuid default gen_random_uuid() primary key, empresa_id uuid not null references public.empresas(id),
    nombre text not null, descripcion text, contratante text, contratista text, fiscalizador text, monto_contrato numeric(15,2),
    fecha_inicio date, fecha_fin_planificada date, fecha_fin_real date, estado text default 'planificacion', ubicacion text,
    latitud numeric(10,6), longitud numeric(10,6), created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
    modulos jsonb, estado_cierre text default 'en_ejecucion' not null, contrato_datos jsonb,
    emisor_empresa_id uuid references public.empresas(id), tipo text, codigo text);
  create table public.rubros (id uuid default gen_random_uuid() primary key, proyecto_id uuid, codigo text, descripcion text not null, unidad text,
    cantidad_contrato numeric(15,4), precio_unitario numeric(15,4),
    monto_contrato numeric(15,2) generated always as (cantidad_contrato * precio_unitario) stored,
    cantidad_ejecutada numeric(15,4) default 0,
    total_produccion numeric(15,2) generated always as (cantidad_ejecutada * precio_unitario) stored,
    estado text default 'planificado', orden integer, created_at timestamptz default now(), updated_at timestamptz default now());
  create table public.lineas_base (id uuid default gen_random_uuid() primary key, proyecto_id uuid not null, numero integer not null, motivo text,
    referencia text, activa boolean default false not null, creado_por uuid, created_at timestamptz default now());
  create table public.cronograma_rubros (id uuid default gen_random_uuid() primary key, rubro_id uuid, proyecto_id uuid, peso_pct numeric(6,2),
    fecha_inicio date, fecha_fin date, created_at timestamptz default now(), linea_base_id uuid);
  create table public.planillas_pago (id uuid default gen_random_uuid() primary key, proyecto_id uuid, numero integer not null,
    fecha_inicio date not null, fecha_fin date not null, estado text default 'borrador', total_monto numeric(14,2) default 0, observaciones text,
    creado_por uuid, fecha_aprobacion date, fecha_pago date, created_at timestamptz default now(), updated_at timestamptz default now(),
    total_liquido numeric);
  create table public.planilla_historial (id uuid default gen_random_uuid() primary key, planilla_id uuid, accion text not null, comentario text,
    autor_id uuid, created_at timestamptz default now());
  create table public.garantias (id uuid default gen_random_uuid() primary key, proyecto_id uuid not null, tipo text not null, aseguradora text,
    numero text, monto numeric, vigencia_desde date, vigencia_hasta date, archivo_url text, estado text default 'vigente' not null, notas text,
    created_at timestamptz default now());
  create table public.ordenes_cambio (id uuid default gen_random_uuid() primary key, proyecto_id uuid not null, numero integer not null,
    titulo text not null, justificacion text, estado text default 'borrador' not null, fecha_aprobacion date, monto_total numeric default 0 not null,
    creado_por uuid, created_at timestamptz default now());
  create table public.libro_obra (id uuid default gen_random_uuid() primary key, proyecto_id uuid, fecha date not null, numero_registro integer,
    actividades_ejecutadas text, novedades text, residente_nombre text, residente_email text, created_at timestamptz default now(),
    estado_aprobacion text default 'pendiente' not null);
  create table public.observaciones (id uuid default gen_random_uuid() primary key, proyecto_id uuid, plano_id uuid, titulo text not null,
    descripcion text, estado text default 'abierta', pin_x numeric, pin_y numeric, creado_por uuid, created_at timestamptz default now(), numero integer);
  create table public.ensayos (id uuid default gen_random_uuid() primary key, proyecto_id uuid not null, especificacion_id uuid not null,
    numero integer not null, fecha date not null, valor numeric not null, detalle text, cumple boolean not null, resuelto boolean default false not null,
    reensayo_de uuid, created_at timestamptz default now());
  create table public.sst_incidentes (id uuid default gen_random_uuid() primary key, proyecto_id uuid not null, tipo text default 'incidente' not null,
    fecha_hora timestamptz default now() not null, trabajador_nombre text, trabajador_cedula text, descripcion text, causas text,
    estado text default 'abierto', created_at timestamptz default now());
  create table public.solicitudes (id uuid default gen_random_uuid() primary key, proyecto_id uuid, tipo text not null, titulo text not null,
    descripcion text, estado text default 'pendiente', creado_por uuid, created_at timestamptz default now(), numero integer);
  create table public.archivos (id uuid default gen_random_uuid() primary key, proyecto_id uuid, modulo text, referencia_id uuid, nombre text not null,
    tipo text, url text not null, tamanio integer, subido_por uuid, created_at timestamptz default now());
  create table public.proyecto_miembros (id uuid default gen_random_uuid() primary key, proyecto_id uuid, perfil_id uuid, rol text,
    created_at timestamptz default now(), usuario_id uuid);
  create table public.actas_recepcion (id uuid default gen_random_uuid() primary key, proyecto_id uuid not null, tipo text not null, fecha date not null,
    lugar text, asistentes text, observaciones text, created_at timestamptz default now(), contenido_html text);
  create table public.liquidaciones (id uuid default gen_random_uuid() primary key, proyecto_id uuid not null, fecha date default current_date not null,
    datos jsonb not null, observaciones text, created_at timestamptz default now());

  insert into public.empresas (id, nombre, sigla, ruc, es_gestora) values ('${EMPRESA}', 'ZZZ Gestora', 'ZZZ', '0000000000001', true);
  insert into public.proyectos (id, empresa_id, codigo, tipo, nombre, descripcion, contratante, contratista, monto_contrato,
      fecha_inicio, fecha_fin_planificada, estado, ubicacion, latitud, longitud) values
    ('${PROY_1}', '${EMPRESA}', 'ZZZ-FIS-2026-001', 'fiscalizacion', 'ZZZ Obra Uno', 'ZZZ descripción de la obra uno, sector ZZZ', 'ZZZ Contratante',
      'ZZZ Contratista', 100000, current_date - 60, current_date + 120, 'ejecucion', 'ZZZ ciudad', -1.234567, -78.123456),
    ('${PROY_2}', '${EMPRESA}', 'ZZZ-CON-2026-002', 'construccion', 'ZZZ Obra Dos', null, 'ZZZ Contratante', 'ZZZ Contratista', 50000,
      current_date + 10, current_date + 200, 'planificacion', null, null, null);
  insert into public.rubros (id, proyecto_id, codigo, descripcion, unidad, cantidad_contrato, precio_unitario, cantidad_ejecutada, estado) values
    ('00000000-0000-4000-8000-0000000000d1', '${PROY_1}', '1.01', 'ZZZ Rubro A', 'm3', 100, 400, 40, 'trabajando'),
    ('00000000-0000-4000-8000-0000000000d2', '${PROY_1}', '1.02', 'ZZZ Rubro B', 'm2', 200, 300, 0, 'planificado'),
    ('00000000-0000-4000-8000-0000000000d3', '${PROY_2}', '1.01', 'ZZZ Rubro C', 'u', 10, 5000, 0, 'planificado');
  insert into public.lineas_base (id, proyecto_id, numero, activa) values ('00000000-0000-4000-8000-0000000000f1', '${PROY_1}', 1, true);
  insert into public.cronograma_rubros (rubro_id, proyecto_id, linea_base_id, fecha_inicio, fecha_fin) values
    ('00000000-0000-4000-8000-0000000000d1', '${PROY_1}', '00000000-0000-4000-8000-0000000000f1', current_date - 60, current_date + 30),
    ('00000000-0000-4000-8000-0000000000d2', '${PROY_1}', '00000000-0000-4000-8000-0000000000f1', current_date + 31, current_date + 120);
  insert into public.planillas_pago (id, proyecto_id, numero, fecha_inicio, fecha_fin, estado, total_monto, total_liquido, observaciones) values
    ('00000000-0000-4000-8000-000000000091', '${PROY_1}', 1, current_date - 60, current_date - 31, 'enviada', 16000, 15000, 'ZZZ nota interna');
  insert into public.planilla_historial (planilla_id, accion, comentario) values ('00000000-0000-4000-8000-000000000091', 'enviada', 'ZZZ comentario');
  insert into public.garantias (proyecto_id, tipo, aseguradora, numero, monto, vigencia_hasta, estado) values
    ('${PROY_1}', 'fiel_cumplimiento', 'ZZZ Aseguradora', 'ZZZ-1', 5000, current_date + 90, 'vigente');
  insert into public.ordenes_cambio (proyecto_id, numero, titulo, justificacion, estado, monto_total) values
    ('${PROY_1}', 1, 'ZZZ Orden de cambio', 'ZZZ justificación', 'solicitada', 1200);
  insert into public.libro_obra (proyecto_id, fecha, numero_registro, novedades, residente_email, estado_aprobacion) values
    ('${PROY_1}', current_date - 3, 1, 'ZZZ novedad', 'zzz.residente@example.invalid', 'aprobado'),
    ('${PROY_1}', current_date - 2, 2, 'ZZZ novedad', 'zzz.residente@example.invalid', 'pendiente'),
    ('${PROY_1}', current_date - 1, 3, 'ZZZ novedad', 'zzz.residente@example.invalid', 'pendiente');
  insert into public.observaciones (proyecto_id, numero, titulo, descripcion, estado, creado_por) values
    ('${PROY_1}', 1, 'ZZZ Observación uno', 'ZZZ texto de la observación. Antecedente: ZZZ anterior', 'abierta', '${USUARIO}'),
    ('${PROY_1}', 2, 'ZZZ Observación dos', 'ZZZ texto sin la marca', 'resuelta', '${USUARIO}');
  insert into public.ensayos (proyecto_id, especificacion_id, numero, fecha, valor, detalle, cumple, resuelto) values
    ('${PROY_1}', gen_random_uuid(), 1, current_date - 5, 18.5, 'ZZZ detalle', false, false);
  insert into public.sst_incidentes (proyecto_id, trabajador_nombre, trabajador_cedula, descripcion, estado) values
    ('${PROY_1}', 'ZZZ Trabajador', '0000000000', 'ZZZ relato del incidente', 'abierto');
  insert into public.solicitudes (proyecto_id, tipo, titulo, descripcion, estado, numero) values
    ('${PROY_1}', 'documentacion', 'ZZZ Solicitud', 'ZZZ texto', 'pendiente', 1);
  insert into public.archivos (proyecto_id, modulo, nombre, url) values
    ('${PROY_1}', 'contratos', 'ZZZ contrato.pdf', 'zzz/contrato.pdf'), ('${PROY_1}', 'general', 'ZZZ a.pdf', 'zzz/a.pdf'),
    ('${PROY_1}', 'general', 'ZZZ b.pdf', 'zzz/b.pdf');
  insert into public.proyecto_miembros (proyecto_id, perfil_id, usuario_id, rol) values ('${PROY_1}', '${USUARIO}', '${USUARIO}', 'fiscalizador');
  insert into public.actas_recepcion (proyecto_id, tipo, fecha, asistentes) values ('${PROY_2}', 'provisional', current_date - 1, 'ZZZ asistentes');
  insert into public.liquidaciones (proyecto_id, datos, observaciones) values ('${PROY_2}', '{"zzz": true}', 'ZZZ nota');
`;

async function nueva(){
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(ESQUEMA);
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
      has_function_privilege('authenticated', 'public.exportacion_estado_datos()', 'execute') as a_dat,
      has_function_privilege('anon', 'public.exportacion_estado_datos()', 'execute') as n_dat,
      has_function_privilege('public', 'public.exportacion_estado_datos()', 'execute') as p_dat,
      has_function_privilege('service_role', 'public.exportacion_estado_datos()', 'execute') as s_dat,
      (select relrowsecurity from pg_class where oid = 'public.exportaciones_estado'::regclass) as rls`);
    assert(t.a_sel && !t.a_ins && !t.a_del && !t.n_sel && t.s_ins, 'permisos de tabla: ' + JSON.stringify(t));
    assert(!t.a_reg && !t.n_reg && t.s_reg && !t.a_vig && !t.n_vig && t.s_vig, 'permisos de función: ' + JSON.stringify(t));
    assert(!t.a_dat && !t.n_dat && !t.p_dat && t.s_dat, 'permisos de exportacion_estado_datos: ' + JSON.stringify(t));
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

  await prueba('segundo intento por la API (service_role): mira si hay corrida buena de hoy y registra solo si falta; no duplica', async () => {
    const db = await nueva();
    // Lo que hace el workflow: GET exportaciones_estado?ok=is.true&fecha=eq.<hoy> y, si viene vacío, rpc registrar.
    const intento = () => como(db, 'service_role', '', async () => {
      const hay = (await db.query(`select id from public.exportaciones_estado where ok is true and fecha = ${HOY_EC} limit 1`)).rows;
      if(!hay.length) await db.query(`select * from public.exportacion_estado_registrar(p_ok => true, p_detalle => 'ZZZ ya estaba')`);
    });
    await intento(); await intento();
    assert((await uno(db, `select count(*)::int as n from public.exportaciones_estado where ok`)).n === 1, 'duplicó el registro');
  });

  await prueba('service_role registra por la API con parámetros con nombre: buena (p_aviso null), degradada y fallida', async () => {
    const db = await nueva();
    await como(db, 'service_role', '', async () => {
      await db.query(`select * from public.exportacion_estado_registrar(p_ok => $1, p_detalle => $2, p_aviso => $3)`, [true, 'ZZZ buena', null]);
      await db.query(`select * from public.exportacion_estado_registrar(p_ok => $1, p_detalle => $2, p_aviso => $3)`, [true, 'ZZZ degradada', 'ZZZ aviso']);
      await db.query(`select * from public.exportacion_estado_registrar(p_ok => $1, p_detalle => $2, p_aviso => $3)`, [false, 'ZZZ Falló el paso «Subir a Drive» (corrida 123, schedule).', null]);
    });
    const reg = (await db.query(`select ok, aviso from public.exportaciones_estado`)).rows;
    assert(reg.length === 3 && reg.filter(x => x.ok).length === 2 && reg.filter(x => x.aviso === 'ZZZ aviso').length === 1, JSON.stringify(reg));
    // service_role no tiene por qué poder tocar perfiles ni notificaciones: la función corre con los permisos del dueño.
    assert((await uno(db, `select count(*)::int as n from public.notificaciones where titulo like '%falló'`)).n === 2, 'la corrida fallida no dejó un aviso por admin');
  });

  await prueba('la firma antigua de dos parámetros se retira: la llamada con dos argumentos no es ambigua', async () => {
    const db = new PGlite();
    await db.exec(BASE);
    await db.exec(ESQUEMA);
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

  // ── exportacion_estado_datos() ────────────────────────────────────────────
  await prueba('PERMISOS REALES: anon y authenticated reciben «permission denied» en las tres funciones; service_role las ejecuta', async () => {
    const db = await nueva();
    for(const rol of ['anon', 'authenticated']){
      for(const [nombre, sql] of FUNCIONES){
        const e = await como(db, rol, rol === 'authenticated' ? ADMIN_1 : '', () => falla(() => db.query(sql)));
        assert(e, rol + ' pudo ejecutar ' + nombre);
        assert(e.code === '42501' && /permission denied for function exportacion_estado_/.test(e.message), rol + ' / ' + nombre + ': ' + e.code + ' ' + e.message);
      }
    }
    // Ningún intento rechazado dejó rastro
    assert((await uno(db, `select (select count(*) from public.exportaciones_estado)::int + (select count(*) from public.notificaciones)::int as n`)).n === 0, 'un intento rechazado escribió algo');
    for(const [nombre, sql] of FUNCIONES){
      const e = await como(db, 'service_role', '', () => falla(() => db.query(sql)));
      assert(e === null, 'service_role no pudo ejecutar ' + nombre + ': ' + (e && (e.code + ' ' + e.message)));
    }
    assert((await uno(db, `select count(*)::int as n from public.exportaciones_estado where detalle = 'ZZZ intento'`)).n === 1, 'service_role no registró');
  });

  await prueba('exportacion_estado_datos devuelve UNA fila con UN json (no SETOF) y exactamente las claves que exige el generador', async () => {
    const db = await nueva();
    const def = await uno(db, `select prorettype::regtype::text as devuelve, proretset, prosecdef, provolatile, proconfig, lanname
                                from pg_proc p join pg_language l on l.oid = p.prolang where proname = 'exportacion_estado_datos'`);
    assert(def.devuelve === 'json' && def.proretset === false, 'debía devolver json y no filas: ' + JSON.stringify(def));
    assert(def.prosecdef === true && def.provolatile === 's' && def.lanname === 'sql', 'debía ser SQL, STABLE y SECURITY DEFINER: ' + JSON.stringify(def));
    assert(Array.isArray(def.proconfig) && def.proconfig.some(c => /^search_path=/.test(c)), 'sin search_path fijo: ' + JSON.stringify(def.proconfig));
    // Las dos formas de llamarla (la segunda es la de la API)
    for(const sql of [`select public.exportacion_estado_datos() as d`, `select * from public.exportacion_estado_datos() as d`]){
      const r = await como(db, 'service_role', '', () => db.query(sql));
      assert(r.rows.length === 1 && r.fields.length === 1, sql + ' → ' + r.rows.length + ' filas, ' + r.fields.length + ' columnas');
      const d = r.rows[0].d;
      assert(d && typeof d === 'object' && !Array.isArray(d), 'no es un objeto json');
      assert(JSON.stringify(Object.keys(d).sort()) === JSON.stringify(TABLAS.slice().sort()), 'claves: ' + Object.keys(d).sort().join(','));
      assert(TABLAS.every(t => Array.isArray(d[t])), 'alguna clave no es un arreglo');
      assert(desenvolver(d) === d, 'exportar.js no acepta el objeto tal cual');
    }
  });

  await prueba('exportacion_estado_datos: el contenido es el de la consulta (agregados, marca de antecedente) y no trae datos personales', async () => {
    const db = await nueva();
    const d = (await como(db, 'service_role', '', () => uno(db, `select public.exportacion_estado_datos() as d`))).d;
    assert(d.proyectos.length === 2 && d.proyectos[0].codigo === 'ZZZ-CON-2026-002' && d.proyectos[1].codigo === 'ZZZ-FIS-2026-001', 'proyectos u orden: ' + d.proyectos.map(p => p.codigo));
    assert(!('latitud' in d.proyectos[0]) && !('longitud' in d.proyectos[0]) && 'ubicacion' in d.proyectos[0] && 'descripcion' in d.proyectos[0], 'D8: sin coordenadas, con ubicación y descripción');
    assert(d.rubros.length === 3 && Number(d.rubros.find(r => r.descripcion === 'ZZZ Rubro A').total_produccion) === 16000, 'rubros');
    assert(d.libro_obra.length === 1 && Number(d.libro_obra[0].pendientes_aprobacion) === 2 && /^\d{4}-\d{2}-\d{2}$/.test(d.libro_obra[0].ultimo_registro), 'libro agregado: ' + JSON.stringify(d.libro_obra));
    const arch = d.archivos.map(a => a.modulo + ':' + a.cantidad).sort();
    assert(JSON.stringify(arch) === JSON.stringify(['contratos:1', 'general:2']), 'archivos agregados: ' + arch);
    const obs = d.observaciones.slice().sort((a, b) => a.numero - b.numero);
    assert(obs.length === 2 && obs[0].con_antecedente === true && obs[1].con_antecedente === false && !('descripcion' in obs[0]), 'observaciones: ' + JSON.stringify(obs));
    assert(JSON.stringify(Object.keys(d.perfiles[0]).sort()) === JSON.stringify(['apellido', 'id', 'nombre']), 'perfiles trae de más: ' + Object.keys(d.perfiles[0]));
    assert(JSON.stringify(Object.keys(d.sst_incidentes[0]).sort()) === JSON.stringify(['estado', 'proyecto_id']), 'sst trae de más: ' + Object.keys(d.sst_incidentes[0]));
    const texto = JSON.stringify(d);
    for(const prohibido of ['example.invalid', '0000000000001', 'ZZZ relato del incidente', 'ZZZ Trabajador', 'ZZZ nota interna', 'ZZZ comentario', 'ZZZ texto de la observación', 'ZZZ asistentes', '-78.123456']){
      assert(!texto.includes(prohibido), 'la exportación trae un dato que no debía salir: ' + prohibido);
    }
    // El generador real lo acepta y calcula sin bloques fallidos
    const estado = construirEstado(desenvolver(d), { versionApp: 'zzz-prueba' });
    assert(estado.formato === 2, 'formato: ' + estado.formato);
    assert(estado.proyectos_total === 2 && estado.proyectos.length >= 1, 'proyectos en el estado: ' + estado.proyectos.length + ' de ' + estado.proyectos_total);
    assert(estado.bloques_fallidos.length === 0, 'bloques fallidos: ' + JSON.stringify(estado.bloques_fallidos));
  });

  await prueba('exportacion_estado_datos: con más de 1.000 filas en una tabla sigue siendo UN valor (el tope de filas de la API no aplica)', async () => {
    const db = await nueva();
    await db.exec(`insert into public.rubros (proyecto_id, codigo, descripcion, cantidad_contrato, precio_unitario)
                   select '${PROY_2}', 'Z.' || g, 'ZZZ Rubro ' || g, 1, 1 from generate_series(1, 1500) g;`);
    const r = await como(db, 'service_role', '', () => db.query(`select * from public.exportacion_estado_datos() as d`));
    assert(r.rows.length === 1, 'filas: ' + r.rows.length);
    assert(r.rows[0].d.rubros.length === 1503, 'rubros en el json: ' + r.rows[0].d.rubros.length);
  });

  await prueba('exportacion_estado_datos lee con los permisos del dueño (SECURITY DEFINER) y no puede escribir (STABLE)', async () => {
    const db = await nueva();
    await db.exec(`revoke all on public.proyectos, public.rubros, public.perfiles from service_role, anon, authenticated;`);
    const directo = await como(db, 'service_role', '', () => falla(() => db.query(`select count(*) from public.proyectos`)));
    assert(directo && directo.code === '42501', 'la prueba no quitó el permiso de lectura directa');
    const d = (await como(db, 'service_role', '', () => uno(db, `select public.exportacion_estado_datos() as d`))).d;
    assert(d.proyectos.length === 2 && d.rubros.length === 3 && d.perfiles.length === 3, 'la función no leyó con los permisos del dueño');
    // Dentro de una transacción de solo lectura también funciona: no escribe nada.
    await db.exec(`begin transaction read only; select public.exportacion_estado_datos(); rollback;`);
  });

  await prueba('el cuerpo de exportacion_estado_datos() en la migración es idéntico a exportacion/consulta.sql', async () => {
    const { cabecera, cuerpo } = cuerpoDeDatosEnLaMigracion();
    assert(/returns json\b/.test(cabecera) && !/setof|returns table/i.test(cabecera), 'la función no devuelve un json simple: ' + cabecera.trim());
    assert(/language sql\b/.test(cabecera) && /\bstable\b/.test(cabecera) && /security definer/.test(cabecera) && /set search_path to /.test(cabecera), 'cabecera de la función: ' + cabecera.trim());
    const a = normalizar(cuerpo), b = normalizar(CONSULTA);
    assert(b.startsWith('select json_build_object(') && b.endsWith(') as datos'), 'consulta.sql no tiene la forma esperada');
    if(a !== b){
      let i = 0; while(i < a.length && a[i] === b[i]) i++;
      assert(false, 'la migración y exportacion/consulta.sql difieren desde el carácter ' + i + ':\n      migración: …' + a.slice(Math.max(0, i - 30), i + 50) + '…\n      consulta:  …' + b.slice(Math.max(0, i - 30), i + 50) + '…');
    }
    // consulta.sql sigue siendo incrustable: un único punto y coma, sin signo de dólar ni comentarios de bloque
    const sentencia = CONSULTA.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n').trim();
    assert(sentencia.split(';').length === 2 && sentencia.endsWith(';'), 'consulta.sql debe tener un único punto y coma, al final');
    assert(!sentencia.includes('$') && !sentencia.includes('/*') && !sentencia.includes('--'), 'consulta.sql no puede llevar $, /* ni -- dentro de la sentencia');
    // Y lo que quedó instalado en la base es ese mismo texto
    const db = await nueva();
    const src = (await uno(db, `select prosrc from pg_proc where proname = 'exportacion_estado_datos'`)).prosrc;
    assert(normalizar(src) === b, 'el cuerpo instalado en la base no es el de consulta.sql');
    // La consulta suelta y la función dan lo mismo
    const suelta = (await uno(db, CONSULTA)).datos;
    const funcion = (await uno(db, `select public.exportacion_estado_datos() as d`)).d;
    assert(JSON.stringify(suelta) === JSON.stringify(funcion), 'la consulta suelta y la función no devuelven lo mismo');
  });

  await prueba('la migración PRUEBA los permisos al aplicarse: si anon o authenticated pueden ejecutar una función, aborta y no aplica nada', async () => {
    assert(/do \$prueba\$[\s\S]*set local role %I[\s\S]*insufficient_privilege[\s\S]*end \$prueba\$;\s*commit;/.test(MIGRACION), 'la migración no trae la prueba de permisos antes del commit');
    const REVOKES = [
      'revoke all on function public.exportacion_estado_datos() from public, anon, authenticated;',
      'revoke all on function public.exportacion_estado_registrar(boolean, text, text) from public, anon, authenticated;',
      'revoke all on function public.exportacion_estado_vigilar() from public, anon, authenticated;'
    ];
    for(const linea of REVOKES){
      assert(MIGRACION.split(linea).length === 2, 'no se encontró en la migración: ' + linea);
      // Variantes mal hechas: sin el REVOKE, o quitándoselo solo a PUBLIC (el descuido típico en Supabase)
      for(const mala of ['', linea.replace('from public, anon, authenticated', 'from public')]){
        const db = new PGlite();
        await db.exec(BASE); await db.exec(ESQUEMA);
        const e = await falla(() => db.exec(MIGRACION.replace(linea, mala)));
        assert(e && e.code === '42501' && /Permisos mal puestos/.test(e.message), 'la migración mal hecha se aplicó (' + (mala || 'sin revoke') + '): ' + (e && e.message));
        await db.exec('rollback;');
        const quedo = await uno(db, `select to_regclass('public.exportaciones_estado') is not null as tabla,
          (select count(*)::int from pg_proc where proname like 'exportacion\\_estado\\_%') as funciones, (select count(*)::int from cron.job) as tareas`);
        assert(!quedo.tabla && quedo.funciones === 0 && quedo.tareas === 0, 'la migración abortada dejó algo aplicado: ' + JSON.stringify(quedo));
      }
    }
    // Y tampoco se aplica si service_role se queda sin permiso
    const db = new PGlite();
    await db.exec(BASE); await db.exec(ESQUEMA);
    const sinGrant = 'grant execute on function public.exportacion_estado_datos() to service_role;';
    assert(MIGRACION.split(sinGrant).length === 2, 'no se encontró el grant a service_role');
    const e = await falla(() => db.exec(MIGRACION.replace(sinGrant, 'revoke all on function public.exportacion_estado_datos() from service_role;')));
    assert(e && e.code === '42501', 'la migración se aplicó sin el permiso de service_role: ' + (e && e.message));
  });

  await prueba('la prueba de permisos de la migración no deja el rol cambiado ni escribe nada', async () => {
    const db = await nueva();
    const r = await uno(db, `select current_user = session_user as mismo,
      (select count(*)::int from public.exportaciones_estado) as filas, (select count(*)::int from public.notificaciones) as avisos`);
    assert(r.mismo === true && r.filas === 0 && r.avisos === 0, JSON.stringify(r));
  });

  resumen();
})();
