// Escrituras que la base filtra por permisos (RLS): un UPDATE o DELETE filtrado NO devuelve error,
// devuelve 0 filas. La interfaz no debe darlas por hechas ni borrar archivos antes de confirmarlas.
// Ejecuta las funciones REALES de index.html en jsdom; `denegar` simula la RLS.
//
//   node escrituras-filtradas.test.js
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, leer, scriptPrincipal, extraerFuncion, crearSb, prueba, resumen, assert } = require('./lib/arnes');

const src = scriptPrincipal();
const CODIGO = [
  leer(path.join(RAIZ, 'constantes.js')), leer(path.join(RAIZ, 'expediente.js')),
  'let currentPerfil = null; let currentUser = { id: "u1" }; let currentProyecto = "p1"; let _camposPlantillaActual = [{ id: "c1", etiqueta: "Campo", tipo: "texto" }];',
  'function toast(msg, tipo){ window._toasts.push({ msg, tipo }); } function cerrarModal(){} function cargarFormatosCalidad(){ window._recargas++; }',
  'function cargarMiembrosPorProyecto(){ window._recargas++; } function cargarSubcontratistas(){ window._recargas++; } function cargarCanalesChat(){}',
  'async function eliminarObjetosStorage(urls){ window._storageBorrado.push(...urls); }',
  ...['esAdminDeEmpresa', 'puedeEscribirCatalogos', 'eliminarPlantillaCalidad', 'guardarPlantillaCalidad', 'guardarSubcontratista', 'eliminarMiembro', 'guardarNuevoCanal'].map(f => extraerFuncion(src, f)),
  'window._fijarPerfil = p => { currentPerfil = p; };'
].join('\n');

const DOM = `<input id="plantillaCalidadId"/><input id="pcNombre"/><textarea id="pcDescripcion"></textarea><button id="btnGuardarPlantillaCalidad"></button>
  <input id="subcontratistaId"/><input id="subNombre"/><input id="subRuc"/><input id="subEspecialidad"/><input id="subRepresentante"/><input id="subTelefono"/><input id="subEmail"/>
  <input id="nuevoCanalnombre"/><input id="nuevoCanalDesc"/><input type="checkbox" id="nuevoCanalPrivado"/>`;
const FIXTURE = () => ({
  formatos_calidad_plantillas: [{ id: 'pl1', nombre: 'Plantilla', campos: [] }],
  formatos_calidad_respuestas: [{ id: 'r1', plantilla_id: 'pl1' }, { id: 'r2', plantilla_id: 'pl1' }],
  formatos_calidad_fotos: [{ id: 'f1', respuesta_id: 'r1', url: 'https://x/hidivo-fotos/a.jpg' }, { id: 'f2', respuesta_id: 'r2', url: 'https://x/hidivo-fotos/b.jpg' }],
  subcontratistas: [{ id: 's1', nombre: 'Sub Uno' }],
  proyecto_miembros: [{ id: 'm1', proyecto_id: 'p1', usuario_id: 'u2', rol: 'residente' }],
  canales_chat: []
});
const EMPRESAS = [{ id: 'e-b', nombre: 'Beta', sigla: 'BET', es_gestora: true, activa: true }, { id: 'e-x', nombre: 'Inactiva', sigla: 'INA', es_gestora: true, activa: false }];

function montar({ denegar = null, perfil = { id: 'u1', rol: 'admin', rolGlobal: 'admin', empresa_id: null } } = {}){
  const dom = new JSDOM(`<!doctype html><html><body>${DOM}</body></html>`, { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only' });
  const w = dom.window;
  const fixture = FIXTURE();
  w.sb = crearSb(fixture, { denegar: denegar ? (tabla, op) => denegar.includes(tabla) : null });
  w._toasts = []; w._recargas = 0; w._storageBorrado = []; w.console = console;
  w.confirm = () => true;
  w.eval(CODIGO);
  w.fijarEmpresas(EMPRESAS);
  w._fijarPerfil(perfil);
  const el = id => w.document.getElementById(id);
  return { w, el, fixture, ultimo: () => w._toasts.at(-1), cerrar: () => w.close() };
}

(async () => {
  console.log('escrituras-filtradas.test.js');

  await prueba('eliminar plantilla con permiso: borra la fila y DESPUÉS las fotos de sus respuestas', async () => {
    const t = montar();
    t.el('plantillaCalidadId').value = 'pl1';
    await t.w.eliminarPlantillaCalidad();
    assert(t.fixture.formatos_calidad_plantillas.length === 0, 'plantilla eliminada');
    assert(t.w._storageBorrado.join() === 'https://x/hidivo-fotos/a.jpg,https://x/hidivo-fotos/b.jpg', 'fotos borradas del Storage: ' + t.w._storageBorrado);
    assert(t.ultimo().tipo === 'success' && t.w._recargas === 1, 'aviso de éxito y recarga');
    t.cerrar();
  });

  await prueba('eliminar plantilla SIN permiso (la base filtra el borrado): no toca el Storage y avisa', async () => {
    const t = montar({ denegar: ['formatos_calidad_plantillas'] });
    t.el('plantillaCalidadId').value = 'pl1';
    await t.w.eliminarPlantillaCalidad();
    assert(t.fixture.formatos_calidad_plantillas.length === 1, 'la plantilla sigue');
    assert(t.w._storageBorrado.length === 0, 'NO se borró ninguna foto: ' + t.w._storageBorrado);
    assert(t.ultimo().tipo === 'error' && /No tienes permiso/.test(t.ultimo().msg) && t.w._recargas === 0, 'aviso de falta de permiso, sin «Plantilla eliminada»');
    t.cerrar();
  });

  await prueba('editar plantilla o subcontratista sin permiso: no dice «actualizado»', async () => {
    const t = montar({ denegar: ['formatos_calidad_plantillas', 'subcontratistas'] });
    t.el('plantillaCalidadId').value = 'pl1'; t.el("pcNombre").value = "Otro nombre";
    await t.w.guardarPlantillaCalidad();
    assert(t.ultimo().tipo === 'error' && /no tienes permiso/.test(t.ultimo().msg), 'plantilla: ' + JSON.stringify(t.ultimo()));
    assert(t.fixture.formatos_calidad_plantillas[0].nombre === 'Plantilla', 'la plantilla no cambió');
    t.el('subcontratistaId').value = 's1'; t.el('subNombre').value = 'Sub Cambiado';
    await t.w.guardarSubcontratista();
    assert(t.ultimo().tipo === 'error' && /no tienes permiso/.test(t.ultimo().msg), 'subcontratista: ' + JSON.stringify(t.ultimo()));
    t.cerrar();
    const ok = montar();
    ok.el('subcontratistaId').value = 's1'; ok.el('subNombre').value = 'Sub Cambiado';
    await ok.w.guardarSubcontratista();
    assert(ok.ultimo().tipo === 'success' && ok.fixture.subcontratistas[0].nombre === 'Sub Cambiado', 'con permiso sí actualiza');
    ok.cerrar();
  });

  await prueba('quitar miembro sin permiso: no dice «Miembro removido»', async () => {
    const t = montar({ denegar: ['proyecto_miembros'] });
    await t.w.eliminarMiembro('m1', 'p1');
    assert(t.ultimo().tipo === 'error' && /No tienes permiso/.test(t.ultimo().msg) && t.w._recargas === 0, JSON.stringify(t.ultimo()));
    t.cerrar();
    const ok = montar();
    await ok.w.eliminarMiembro('m1', 'p1');
    assert(ok.ultimo().msg === 'Miembro removido' && ok.fixture.proyecto_miembros.length === 0 && ok.w._recargas === 1, 'con permiso lo quita');
    ok.cerrar();
  });

  await prueba('admin de empresa: solo si su empresa es gestora activa; no escribe catálogos ni crea canales privados', async () => {
    const adm = { id: 'u1', rol: 'admin', rolGlobal: 'admin_empresa', empresa_id: 'e-b' };
    const t = montar({ perfil: adm });
    assert(t.w.esAdminDeEmpresa() === true && t.w.puedeEscribirCatalogos() === false, 'admin de una gestora activa: catálogos en solo lectura');
    t.el('nuevoCanalnombre').value = 'reservado'; t.el('nuevoCanalPrivado').checked = true;
    await t.w.guardarNuevoCanal();
    assert(/canales privados los crea el administrador global/.test(t.ultimo().msg) && t.fixture.canales_chat.length === 0, 'canal privado: no se crea');
    t.w._fijarPerfil({ ...adm, empresa_id: 'e-x' });
    assert(t.w.esAdminDeEmpresa() === false, 'empresa inactiva: deja de ser admin de empresa también en la interfaz');
    t.w._fijarPerfil({ ...adm, empresa_id: 'no-existe' });
    assert(t.w.esAdminDeEmpresa() === false, 'empresa que no está en el catálogo: no');
    t.w._fijarPerfil({ id: 'u0', rol: 'admin', rolGlobal: 'admin', empresa_id: null });
    assert(t.w.esAdminDeEmpresa() === false && t.w.puedeEscribirCatalogos() === true, 'admin global: escribe catálogos');
    t.cerrar();
  });

  resumen();
})();
