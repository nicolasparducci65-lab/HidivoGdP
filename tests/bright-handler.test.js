// Edge Function bright-handler (borrado de cuentas) y sus dos llamadores en la app.
//
// 1) Ejecuta el manejador REAL de supabase/functions/bright-handler/index.ts en Node (tipos
//    quitados con node:module, createClient y Deno simulados): sin sesión de administrador
//    no se borra nada.
// 2) Ejecuta eliminarUsuario / cancelarInvitacion REALES de index.html con fetch simulado:
//    envían el token de la sesión, nunca la clave pública.
//
//   node bright-handler.test.js
'use strict';
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('node:module');
const { RAIZ, RUTA_INDEX, leer, scriptPrincipal, extraerFuncion, crearSb, prueba, resumen, assert } = require('./lib/arnes');

// ── 1. La función ───────────────────────────────────────────────────────────
const FUENTE_TS = leer(path.join(RAIZ, 'supabase', 'functions', 'bright-handler', 'index.ts'));
const FUENTE_JS = stripTypeScriptTypes(FUENTE_TS)
  .replace(/^import \{ createClient \} from .*$/m, '')
  .replace('export async function manejar', 'async function manejar')
  .replace(/^Deno\.serve\(manejar\);\s*$/m, 'globalThis.manejar = manejar;');

const ADMIN = 'u-admin', RESIDENTE = 'u-residente', OTRO = 'u-otro', FANTASMA = 'u-fantasma';
const TOKENS = { 'tok-admin': ADMIN, 'tok-residente': RESIDENTE };
const CLAVE_PUBLICA = 'clave-publica-de-la-app';

// Proyecto simulado: cuentas de Auth + perfiles. `borradas` registra cada deleteUser.
function crearProyecto({ sinSecretos = false } = {}){
  const cuentas = [
    { id: ADMIN, email: 'admin@hidivo.test' }, { id: RESIDENTE, email: 'residente@hidivo.test' },
    { id: OTRO, email: 'Otro@hidivo.test' }, { id: FANTASMA, email: 'fantasma@hidivo.test' },
  ];
  const perfiles = [{ id: ADMIN, rol: 'admin' }, { id: RESIDENTE, rol: null }, { id: OTRO, rol: null }];
  const borradas = [], listados = [];
  const cliente = {
    auth: {
      getUser: async token => TOKENS[token] ? { data: { user: { id: TOKENS[token] } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } },
      admin: {
        deleteUser: async id => { borradas.push(id); return { error: null }; },
        listUsers: async ({ page, perPage }) => { listados.push(page); return { data: { users: cuentas.slice((page - 1) * perPage, page * perPage) }, error: null }; },
      },
    },
    from: tabla => ({ select: () => ({ eq: (col, v) => ({ maybeSingle: async () => ({ data: tabla === 'perfiles' ? (perfiles.find(p => p[col] === v) || null) : null, error: null }) }) }) }),
  };
  const env = sinSecretos ? {} : { SUPABASE_URL: 'https://proyecto.test', SUPABASE_SERVICE_ROLE_KEY: 'clave-de-servicio' };
  const ctx = { Request, Response, JSON, console, Promise, Error, globalThis: null,
    createClient: () => cliente, Deno: { env: { get: k => env[k] }, serve(){} } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(FUENTE_JS, ctx, { filename: 'bright-handler.js' });
  const llamar = async (cuerpo, token, metodo = 'POST') => {
    const resp = await ctx.manejar(new Request('https://proyecto.test/functions/v1/bright-handler', {
      method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: metodo === 'POST' ? (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)) : undefined }));
    return { status: resp.status, cors: resp.headers.get('Access-Control-Allow-Origin'), cuerpo: await resp.json().catch(() => null) };
  };
  return { llamar, borradas, listados };
}

// ── 2. Los llamadores de la app ─────────────────────────────────────────────
const src = scriptPrincipal(leer(RUTA_INDEX));
const CLIENTE = ['llamarBrightHandler', 'eliminarUsuario', 'cancelarInvitacion'].map(f => extraerFuncion(src, f)).join('\n');

function crearApp({ sesion = { access_token: 'tok-admin', user: { id: ADMIN } }, respuesta = { status: 200, cuerpo: { ok: true } } } = {}){
  const fx = { perfiles: [{ id: OTRO, email: 'otro@hidivo.test' }], invitaciones: [{ id: 'inv-1', email: 'fantasma@hidivo.test' }], proyecto_miembros: [{ usuario_id: OTRO, proyecto_id: 'p1' }] };
  const peticiones = [], toasts = [];
  const ctx = { console: { error(){} }, JSON, Promise, Error,
    SUPABASE_URL: 'https://proyecto.test', SUPABASE_KEY: CLAVE_PUBLICA,
    sb: crearSb(fx, { auth: { getSession: async () => ({ data: { session: sesion } }) } }),
    currentUser: sesion ? sesion.user : null, event: undefined,
    confirm: () => true, toast: (msg, tipo) => toasts.push({ msg, tipo }), cargarUsuarios(){}, cargarInvitacionesPendientes(){},
    fetch: async (url, opciones) => { peticiones.push({ url, ...opciones }); return { ok: respuesta.status < 400, status: respuesta.status, json: async () => respuesta.cuerpo }; } };
  vm.createContext(ctx);
  vm.runInContext(CLIENTE, ctx, { filename: 'llamadores.js' });
  return { ctx, fx, peticiones, toasts };
}

(async () => {
  console.log('bright-handler.test.js');

  await prueba('función: sin sesión, con la clave pública o con un token inválido → 401 y no se borra nada', async () => {
    const p = crearProyecto();
    for(const token of [null, CLAVE_PUBLICA, 'tok-inventado']){
      for(const cuerpo of [{ accion: 'eliminarUsuario', userId: OTRO }, { accion: 'buscarYEliminarUsuarioPorEmail', email: 'otro@hidivo.test' }]){
        const r = await p.llamar(cuerpo, token);
        assert(r.status === 401 && r.cuerpo.error, `token ${token} / ${cuerpo.accion}: ${r.status}`);
      }
    }
    assert(p.borradas.length === 0 && p.listados.length === 0, 'ni borra ni lista cuentas');
  });

  await prueba('función: sesión válida que no es de administrador → 403 y no se borra nada', async () => {
    const p = crearProyecto();
    const r1 = await p.llamar({ accion: 'eliminarUsuario', userId: OTRO }, 'tok-residente');
    const r2 = await p.llamar({ accion: 'buscarYEliminarUsuarioPorEmail', email: 'fantasma@hidivo.test' }, 'tok-residente');
    assert(r1.status === 403 && r2.status === 403 && p.borradas.length === 0 && p.listados.length === 0, r1.status + '/' + r2.status);
  });

  await prueba('función: administrador → elimina la cuenta pedida; no puede eliminarse a sí mismo; userId obligatorio', async () => {
    const p = crearProyecto();
    const r = await p.llamar({ accion: 'eliminarUsuario', userId: OTRO }, 'tok-admin');
    assert(r.status === 200 && r.cuerpo.ok === true && p.borradas.join() === OTRO, JSON.stringify(r));
    const propio = await p.llamar({ accion: 'eliminarUsuario', userId: ADMIN }, 'tok-admin');
    const vacio = await p.llamar({ accion: 'eliminarUsuario' }, 'tok-admin');
    assert(propio.status === 400 && vacio.status === 400 && p.borradas.length === 1, 'no borra la cuenta propia ni sin userId');
  });

  await prueba('función: borrado por correo solo para cuentas sin perfil (fantasma); con perfil → 409; inexistente → ok sin borrar', async () => {
    const p = crearProyecto();
    const fantasma = await p.llamar({ accion: 'buscarYEliminarUsuarioPorEmail', email: ' Fantasma@HIDIVO.test ' }, 'tok-admin');
    assert(fantasma.status === 200 && fantasma.cuerpo.eliminado === FANTASMA && p.borradas.join() === FANTASMA, JSON.stringify(fantasma));
    const conPerfil = await p.llamar({ accion: 'buscarYEliminarUsuarioPorEmail', email: 'otro@hidivo.test' }, 'tok-admin');
    assert(conPerfil.status === 409 && p.borradas.length === 1, 'una cuenta con perfil no se borra por correo: ' + conPerfil.status);
    const propio = await p.llamar({ accion: 'buscarYEliminarUsuarioPorEmail', email: 'admin@hidivo.test' }, 'tok-admin');
    const nadie = await p.llamar({ accion: 'buscarYEliminarUsuarioPorEmail', email: 'nadie@hidivo.test' }, 'tok-admin');
    const sinCorreo = await p.llamar({ accion: 'buscarYEliminarUsuarioPorEmail' }, 'tok-admin');
    assert(propio.status === 400 && nadie.status === 200 && nadie.cuerpo.ok && !nadie.cuerpo.eliminado && sinCorreo.status === 400 && p.borradas.length === 1, 'propio/inexistente/sin correo');
  });

  await prueba('función: ya no hay rama de IA ni acciones por defecto; CORS solo para el origen de la app; sin secretos → 500', async () => {
    const p = crearProyecto();
    const otra = await p.llamar({ nombre: 'plano', ext: 'pdf' }, 'tok-admin');
    const basura = await p.llamar('esto no es json', 'tok-admin');
    const get = await p.llamar(null, 'tok-admin', 'GET');
    assert(otra.status === 400 && basura.status === 400 && get.status === 405 && p.borradas.length === 0, [otra.status, basura.status, get.status].join('/'));
    assert(!/anthropic/i.test(FUENTE_TS), 'sin llamadas a la API de IA');
    assert(otra.cors === 'https://nicolasparducci65-lab.github.io' && !/Allow-Origin': '\*'/.test(FUENTE_TS), 'CORS: ' + otra.cors);
    const roto = await crearProyecto({ sinSecretos: true }).llamar({ accion: 'eliminarUsuario', userId: OTRO }, 'tok-admin');
    assert(roto.status === 500, 'sin secretos: ' + roto.status);
    // El permiso se comprueba ANTES de leer el cuerpo y antes de cualquier operación de administración
    const iAuth = FUENTE_TS.indexOf("perfil?.rol !== 'admin'"), iAdmin = FUENTE_TS.indexOf('sb.auth.admin.');
    assert(iAuth > 0 && iAdmin > iAuth, 'orden: permiso antes que auth.admin');
  });

  await prueba('app: eliminarUsuario envía el token de la sesión (no la clave pública) y muestra el rechazo de la función', async () => {
    const a = crearApp();
    await a.ctx.eliminarUsuario(OTRO, 'Otro');
    const [pet] = a.peticiones;
    assert(a.peticiones.length === 1 && pet.url === 'https://proyecto.test/functions/v1/bright-handler', 'una llamada a la función');
    assert(pet.headers.Authorization === 'Bearer tok-admin' && pet.headers.apikey === CLAVE_PUBLICA, JSON.stringify(pet.headers));
    assert(JSON.parse(pet.body).accion === 'eliminarUsuario' && JSON.parse(pet.body).userId === OTRO && a.toasts.at(-1).tipo === 'success', pet.body);
    assert(!/Bearer eyJ/.test(src) && !/bright-handler[\s\S]{0,400}Bearer \$\{SUPABASE_KEY\}/.test(src), 'sin claves fijas en las llamadas a bright-handler');

    // Rechazo de la función y rechazo de la pasarela ({message} sin .error): ambos se ven como error
    for(const respuesta of [{ status: 403, cuerpo: { error: 'No autorizado: solo un administrador puede eliminar usuarios' } }, { status: 401, cuerpo: { code: 401, message: 'Invalid JWT' } }]){
      const b = crearApp({ respuesta });
      await b.ctx.eliminarUsuario(OTRO, 'Otro');
      assert(b.toasts.at(-1).tipo === 'error' && b.toasts.at(-1).msg.includes(respuesta.cuerpo.error || respuesta.cuerpo.message), JSON.stringify(b.toasts.at(-1)));
    }
  });

  await prueba('app: sin sesión o sobre la cuenta propia no se borra nada (ni en la base ni en Auth)', async () => {
    const a = crearApp({ sesion: null });
    await a.ctx.eliminarUsuario(OTRO, 'Otro');
    assert(a.peticiones.length === 0 && a.fx.perfiles.length === 1 && a.fx.proyecto_miembros.length === 1 && a.toasts.at(-1).tipo === 'error', 'sin sesión: nada');
    const b = crearApp();
    await b.ctx.eliminarUsuario(ADMIN, 'Yo');
    assert(b.peticiones.length === 0 && b.toasts.at(-1).msg === 'No puedes eliminar tu propia cuenta', 'cuenta propia');
  });

  await prueba('app: cancelarInvitacion limpia el usuario fantasma con el token de la sesión; con perfil no llama a la función', async () => {
    const a = crearApp();
    await a.ctx.cancelarInvitacion('inv-1', 'fantasma@hidivo.test');
    assert(a.peticiones.length === 1 && a.peticiones[0].headers.Authorization === 'Bearer tok-admin' && JSON.parse(a.peticiones[0].body).accion === 'buscarYEliminarUsuarioPorEmail', JSON.stringify(a.peticiones));
    assert(a.fx.invitaciones.length === 0 && a.toasts.at(-1).msg === 'Invitación cancelada', 'la invitación se cancela');
    const b = crearApp();
    await b.ctx.cancelarInvitacion('inv-1', 'otro@hidivo.test');
    assert(b.peticiones.length === 0, 'correo con perfil: no se llama a la función');
  });

  resumen();
})();
