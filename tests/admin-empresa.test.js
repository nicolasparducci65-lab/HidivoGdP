// Multiempresa fase 3, frontend: rol «admin de empresa». Ejecuta las funciones REALES de
// index.html (rol efectivo, listas de proyectos, diálogo de rol global) en jsdom.
//
//   node admin-empresa.test.js
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, leer, scriptPrincipal, extraerFuncion, crearSb, prueba, resumen, assert } = require('./lib/arnes');

const src = scriptPrincipal();
const CODIGO = [
  leer(path.join(RAIZ, 'constantes.js')), leer(path.join(RAIZ, 'expediente.js')),
  'let proyectos = []; let currentPerfil = null; let currentUser = null; let currentProyecto = null;',
  'function toast(msg, tipo){ window._toasts.push({ msg, tipo }); } function aplicarAccesosPorRol(r){ window._accesos.push(r); } function cargarUsuarios(){ window._recargas++; }',
  ...['esAdminDeEmpresa', 'veProyectosPorRLS', 'actualizarRolEfectivo', 'cargarProyectosDelUsuario', 'multiempresaActiva', 'gestorasActivas', 'cambiarRolUsuario'].map(f => extraerFuncion(src, f)),
  'window.PERMISOS = PERMISOS; window._fijar = (perfil, usuario, lista) => { currentPerfil = perfil; currentUser = usuario; proyectos = lista; }; window._perfil = () => currentPerfil;'
].join('\n');

const EMPRESAS = [
  { id: 'e-a', nombre: 'Alfa', sigla: 'ALF', es_gestora: true, activa: true },
  { id: 'e-b', nombre: 'Beta', sigla: 'BET', es_gestora: true, activa: true },
  { id: 'e-c', nombre: 'Gama', sigla: 'GAM', es_gestora: false, activa: true }
];
const PROYECTOS = [
  { id: 'pa1', nombre: 'A uno', empresa_id: 'e-a', created_at: '2026-01-01' },
  { id: 'pb1', nombre: 'B uno', empresa_id: 'e-b', created_at: '2026-02-01' },
  { id: 'pb2', nombre: 'B dos', empresa_id: 'e-b', created_at: '2026-03-01' }
];

function montar(perfil, { miembros = [], visibles = PROYECTOS } = {}){
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only' });
  const w = dom.window;
  // El fixture de proyectos hace de RLS: solo trae lo que la base dejaría ver a este usuario.
  const fixture = { proyectos: visibles.map(p => ({ ...p })), proyecto_miembros: miembros, perfiles: [{ id: 'u9', nombre: 'Otro', rol: null, empresa_id: null }] };
  w.sb = crearSb(fixture);
  w._toasts = []; w._accesos = []; w._recargas = 0; w.console = console;
  w.eval(CODIGO);
  w._fijar({ ...perfil, rolGlobal: perfil.rol }, { id: perfil.id }, []);
  w.fijarEmpresas(EMPRESAS);
  return { w, fixture, cerrar: () => w.close() };
}
const ADMIN_B = { id: 'u1', rol: 'admin_empresa', empresa_id: 'e-b' };

(async () => {
  console.log('admin-empresa.test.js');

  await prueba('rol efectivo: admin sin proyecto y en los de su empresa; en uno ajeno, su membresía o nada', async () => {
    const t = montar(ADMIN_B, { miembros: [{ id: 'm1', proyecto_id: 'pa1', usuario_id: 'u1', rol: 'residente' }] });
    assert(t.w.esAdminDeEmpresa() && t.w.veProyectosPorRLS(), 'se reconoce como admin de empresa');
    assert(await t.w.actualizarRolEfectivo(null) === 'admin', 'sin proyecto: admin (plataforma)');
    assert(await t.w.actualizarRolEfectivo('pb1') === 'admin' && t.w._perfil().rol === 'admin', 'proyecto de su empresa: admin');
    assert(await t.w.actualizarRolEfectivo('pa1') === 'residente', 'proyecto de otra empresa donde es miembro: su membresía');
    t.cerrar();
    const sin = montar(ADMIN_B);
    assert(await sin.w.actualizarRolEfectivo('pa1') === null, 'proyecto de otra empresa sin membresía: sin rol');
    assert(await sin.w.actualizarRolEfectivo('no-existe') === null, 'proyecto que la base no le deja ver: sin rol');
    sin.cerrar();
  });

  await prueba('admin_empresa sin empresa en el perfil no administra nada; el admin global no cambia', async () => {
    const t = montar({ id: 'u1', rol: 'admin_empresa', empresa_id: null });
    assert(!t.w.esAdminDeEmpresa() && !t.w.veProyectosPorRLS(), 'sin empresa no es admin de empresa');
    assert(await t.w.actualizarRolEfectivo(null) === null && await t.w.actualizarRolEfectivo('pb1') === null, 'sin rol');
    t.cerrar();
    const g = montar({ id: 'u0', rol: 'admin', empresa_id: null });
    assert(!g.w.esAdminDeEmpresa() && g.w.veProyectosPorRLS() && await g.w.actualizarRolEfectivo('pa1') === 'admin', 'admin global: admin en todo');
    g.cerrar();
  });

  await prueba('lista de proyectos: el admin de empresa pide sin filtro y recibe lo que la base le deja ver', async () => {
    const t = montar(ADMIN_B, { visibles: PROYECTOS.filter(p => p.empresa_id === 'e-b') });
    const lista = await t.w.cargarProyectosDelUsuario();
    assert(lista.map(p => p.id).join() === 'pb2,pb1', 'los dos de su empresa, sin necesidad de membresías: ' + lista.map(p => p.id));
    assert(!t.w.sb.llamadas.some(l => l.tabla === 'proyecto_miembros'), 'no consulta membresías');
    t.cerrar();
    const fis = montar({ id: 'u2', rol: null, empresa_id: 'e-b' }, { miembros: [{ id: 'm1', proyecto_id: 'pb1', usuario_id: 'u2', rol: 'fiscalizador' }] });
    assert((await fis.w.cargarProyectosDelUsuario()).map(p => p.id).join() === 'pb1', 'un fiscalizador sigue viendo solo sus membresías');
    fis.cerrar();
  });

  await prueba('matriz PERMISOS: columna «Admin de empresa» igual a Admin salvo Empresas', () => {
    const t = montar(ADMIN_B);
    const P = t.w.PERMISOS;
    assert(P.roles[1].id === 'admin_empresa' && P.roles.length === 8, 'rol nuevo junto a Admin');
    assert(P.secciones.every(s => 'admin_empresa' in s.roles), 'todas las secciones tienen la celda');
    assert(P.secciones.find(s => s.id === 'empresas').roles.admin_empresa === null, 'Empresas: sin acceso');
    assert(P.secciones.filter(s => s.id !== 'empresas').every(s => s.roles.admin_empresa === s.roles.admin), 'el resto, como Admin');
    assert(/Admin de empresa/.test(P.secciones.find(s => s.id === 'usuarios').nota), 'la nota de Usuarios explica el alcance');
    t.cerrar();
  });

  await prueba('diálogo de rol global (admin global): nombra admin de empresa con su empresa, y lo quita', async () => {
    const t = montar({ id: 'u0', rol: 'admin', empresa_id: null });
    const d = t.w.document;
    let p = t.w.cambiarRolUsuario('u9', '', '');
    const radios = () => [...d.querySelectorAll('input[name="_rolGlobal"]')];
    assert(radios().map(r => r.value).join() === ',admin,admin_empresa' && radios()[0].checked, 'tres opciones, marcada la actual');
    assert([...d.querySelector('#_rolEmpresa').options].map(o => o.value).join() === 'e-a,e-b', 'solo gestoras activas');
    radios()[2].checked = true; d.querySelector('#_rolEmpresa').value = 'e-b';
    d.querySelector('#_rolGuardar').click(); await p;
    const perfil = t.fixture.perfiles[0];
    assert(perfil.rol === 'admin_empresa' && perfil.empresa_id === 'e-b', 'perfil actualizado: ' + JSON.stringify(perfil));
    assert(/administra Beta/.test(t.w._toasts.at(-1).msg) && t.w._recargas === 1, 'aviso y recarga');
    p = t.w.cambiarRolUsuario('u9', 'admin_empresa', 'e-b');
    assert(radios()[2].checked && d.querySelector('#_rolEmpresa').value === 'e-b', 'reabre con el rol y la empresa actuales');
    radios()[0].checked = true;
    d.querySelector('#_rolGuardar').click(); await p;
    assert(perfil.rol === null && perfil.empresa_id === 'e-b', 'quitar el rol no toca la empresa del perfil');
    p = t.w.cambiarRolUsuario('u9', '', '');
    d.querySelector('#_rolCancelar').click(); await p;
    assert(t.w._recargas === 2 && !d.querySelector('#_rolGuardar'), 'cancelar no guarda y cierra el diálogo');
    t.cerrar();
  });

  resumen();
})();
