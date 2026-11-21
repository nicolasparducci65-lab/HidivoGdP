// Chat: alta de canales y de mensajes directos. La base rechaza un INSERT … RETURNING sobre
// canales_chat (la política de lectura busca la fila por id y todavía no existe), así que la app
// genera el id y no pide la fila de vuelta. El Supabase simulado reproduce ese rechazo.
// Ejecuta las funciones REALES de index.html en jsdom.
//
//   node chat-altas.test.js
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, leer, scriptPrincipal, extraerFuncion, crearSb, prueba, resumen, assert } = require('./lib/arnes');

const src = scriptPrincipal();
const CODIGO = [
  leer(path.join(RAIZ, 'constantes.js')), leer(path.join(RAIZ, 'expediente.js')),
  'let currentPerfil = { id: "u1", rol: "admin", rolGlobal: "admin", empresa_id: null }; let currentUser = { id: "u1" }; let currentProyecto = "p1";',
  'function toast(msg, tipo){ window._toasts.push({ msg, tipo }); } function cerrarModal(){} function cargarCanalesChat(){ window._recargas++; } function cargarDMsChat(){ window._recargas++; }',
  'function abrirCanal(id, nombre, tipo){ window._abiertos.push({ id, nombre, tipo }); }',
  ...['esAdminDeEmpresa', 'nuevoUuid', 'crearCanalChat', 'iniciarDMCon', 'guardarNuevoCanal'].map(f => extraerFuncion(src, f))
].join('\n');
const DOM = '<input id="nuevoCanalnombre"/><input id="nuevoCanalDesc"/><input type="checkbox" id="nuevoCanalPrivado"/>';
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function montar({ fallaMiembro = false } = {}){
  const dom = new JSDOM(`<!doctype html><html><body>${DOM}</body></html>`, { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only' });
  const w = dom.window;
  const fixture = { canales_chat: [], canal_miembros: [] };
  w.sb = crearSb(fixture, { rechazarInsertConSelect: ['canales_chat'] });
  if(fallaMiembro){
    const original = w.sb.from;
    w.sb.from = tabla => {
      const b = original(tabla);
      if(tabla === 'canal_miembros'){ const ins = b.insert; b.insert = fila => { ins(fila); b._ejecutar = () => ({ data: null, error: { message: 'violates row-level security policy' } }); return b; }; }
      return b;
    };
  }
  w._toasts = []; w._recargas = 0; w._abiertos = []; w.console = console;
  w.eval(CODIGO);
  const el = id => w.document.getElementById(id);
  return { w, el, fixture, ultimo: () => w._toasts.at(-1), cerrar: () => w.close() };
}

(async () => {
  console.log('chat-altas.test.js');

  await prueba('el Supabase simulado reproduce el fallo: insert().select() en canales_chat se rechaza', async () => {
    const t = montar();
    const r = await t.w.sb.from('canales_chat').insert({ nombre: 'x', tipo: 'canal' }).select().single();
    assert(r.error && /row-level security/.test(r.error.message) && t.fixture.canales_chat.length === 0, 'rechazado y sin fila');
    t.cerrar();
  });

  await prueba('crearCanalChat: genera el id, inserta sin pedir la fila y devuelve {id, …fila}', async () => {
    const t = montar();
    const r = await t.w.crearCanalChat({ nombre: 'obra', tipo: 'canal', proyecto_id: 'p1', es_privado: false });
    assert(!r.error && RE_UUID.test(r.data.id) && r.data.nombre === 'obra', JSON.stringify(r));
    assert(t.fixture.canales_chat.length === 1 && t.fixture.canales_chat[0].id === r.data.id, 'la fila insertada lleva ese id');
    const ids = new Set(Array.from({ length: 50 }, () => t.w.nuevoUuid()));
    assert(ids.size === 50 && [...ids].every(x => RE_UUID.test(x)), 'nuevoUuid da UUID v4 distintos');
    t.cerrar();
  });

  await prueba('mensaje directo nuevo: se crea y se abre', async () => {
    const t = montar();
    await t.w.iniciarDMCon('u2', 'Ana Pérez');
    const dm = t.fixture.canales_chat[0];
    assert(dm && dm.tipo === 'dm' && dm.dm_user1_id === 'u1' && dm.dm_user2_id === 'u2', JSON.stringify(dm));
    assert(t.w._abiertos.length === 1 && t.w._abiertos[0].id === dm.id && t.w._abiertos[0].tipo === 'dm', 'abre el canal recién creado');
    t.cerrar();
  });

  await prueba('canal público nuevo: se crea', async () => {
    const t = montar();
    t.el('nuevoCanalnombre').value = 'Avance Semanal';
    await t.w.guardarNuevoCanal();
    assert(t.fixture.canales_chat.length === 1 && t.fixture.canales_chat[0].nombre === 'avance-semanal' && t.fixture.canales_chat[0].es_privado === false, JSON.stringify(t.fixture.canales_chat));
    assert(t.ultimo().tipo === 'success' && t.fixture.canal_miembros.length === 0, 'aviso de éxito; un canal público no necesita miembros');
    t.cerrar();
  });

  await prueba('canal privado nuevo: el creador queda como primer miembro', async () => {
    const t = montar();
    t.el('nuevoCanalnombre').value = 'reservado'; t.el('nuevoCanalPrivado').checked = true;
    await t.w.guardarNuevoCanal();
    const canal = t.fixture.canales_chat[0];
    assert(canal && canal.es_privado === true, 'canal privado creado');
    assert(t.fixture.canal_miembros.length === 1 && t.fixture.canal_miembros[0].canal_id === canal.id && t.fixture.canal_miembros[0].usuario_id === 'u1', 'creador agregado: ' + JSON.stringify(t.fixture.canal_miembros));
    assert(t.ultimo().tipo === 'success', 'aviso de éxito');
    t.cerrar();
  });

  await prueba('canal privado cuyo creador no puede agregarse: se retira el canal y se avisa', async () => {
    const t = montar({ fallaMiembro: true });
    t.el('nuevoCanalnombre').value = 'reservado'; t.el('nuevoCanalPrivado').checked = true;
    await t.w.guardarNuevoCanal();
    assert(t.fixture.canales_chat.length === 0, 'no queda un canal privado sin miembros');
    assert(t.ultimo().tipo === 'error' && /No se pudo crear el canal privado/.test(t.ultimo().msg), JSON.stringify(t.ultimo()));
    t.cerrar();
  });

  await prueba('ninguna alta de canales_chat pide la fila de vuelta', () => {
    const trozos = src.split("sb.from('canales_chat').insert(").slice(1);
    assert(trozos.length >= 2, 'hay altas directas (canal general y crearCanalChat)');
    for(const tr of trozos){
      const hasta = tr.indexOf(';');
      assert(!/\.select\(/.test(tr.slice(0, hasta)), 'alta con .select(): ' + tr.slice(0, 80));
    }
    assert(src.split('await crearCanalChat(').length - 1 === 5, 'las cinco altas pasan por crearCanalChat');
  });

  resumen();
})();
