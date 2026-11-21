// Edge Functions y el rol «admin de empresa»: ejecuta la función auxiliar REAL
// esAdminDeEmpresaDelProyecto de cada supabase/functions/*/index.ts (tipos quitados con
// node:module) contra un cliente simulado, y comprueba que cada archivo sigue siendo sintaxis
// válida. La regla replica public.sst_rol_en_proyecto de la base.
//
//   node edge-admin-empresa.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { stripTypeScriptTypes } = require('node:module');
const { RAIZ, leer, crearSb, prueba, resumen, assert } = require('./lib/arnes');

const FUNCIONES = ['extraer-contrato', 'redactar-comunicado', 'resumen-informe', 'procesar-observacion-voz', 'describir-archivo'];
const ruta = f => path.join(RAIZ, 'supabase', 'functions', f, 'index.ts');

// Fuente JS de la auxiliar: desde su declaración hasta la primera línea que es exactamente `}`.
function auxiliar(f){
  const js = stripTypeScriptTypes(leer(ruta(f)));
  const i = js.indexOf('async function esAdminDeEmpresaDelProyecto(');
  assert(i >= 0, f + ': no tiene esAdminDeEmpresaDelProyecto');
  const fin = js.indexOf('\n}', i);
  return js.slice(i, fin + 2);
}
const FIXTURE = () => ({
  perfiles: [
    { id: 'adm-b', rol: 'admin_empresa', empresa_id: 'e-b' },
    { id: 'adm-sin', rol: 'admin_empresa', empresa_id: null },
    { id: 'adm-inactiva', rol: 'admin_empresa', empresa_id: 'e-x' },
    { id: 'adm-emisor', rol: 'admin_empresa', empresa_id: 'e-c' },
    { id: 'fis', rol: null, empresa_id: 'e-b' },
    { id: 'global', rol: 'admin', empresa_id: null }
  ],
  proyectos: [
    { id: 'pb', empresa_id: 'e-b' }, { id: 'pa', empresa_id: 'e-a' }, { id: 'px', empresa_id: 'e-x' },
    { id: 'pc', empresa_id: 'e-c' }, { id: 'p-sin', empresa_id: null }
  ],
  empresas: [
    { id: 'e-a', es_gestora: true, activa: true }, { id: 'e-b', es_gestora: true, activa: true },
    { id: 'e-x', es_gestora: true, activa: false }, { id: 'e-c', es_gestora: false, activa: true }
  ]
});
function cargar(f, fixture = FIXTURE(), romper = null){
  const sb = crearSb(fixture);
  if(romper){
    const original = sb.from;
    sb.from = tabla => tabla === romper.tabla ? romper.respuesta() : original(tabla);
  }
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(auxiliar(f) + '\nglobalThis.aux = esAdminDeEmpresaDelProyecto;', ctx);
  return (userId, proyectoId) => ctx.aux(sb, userId, proyectoId);
}

(async () => {
  console.log('edge-admin-empresa.test.js');

  for(const f of FUNCIONES){
    await prueba(f + ': el archivo es sintaxis válida tras quitar los tipos', () => {
      const tmp = path.join(os.tmpdir(), `hidivo-edge-${f}-${process.pid}.mjs`);
      fs.writeFileSync(tmp, stripTypeScriptTypes(leer(ruta(f))));
      try{ execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
      catch(e){ throw new Error(String(e.stderr || e.message).split('\n').slice(0, 6).join(' | ')); }
      finally{ fs.unlinkSync(tmp); }
    });

    await prueba(f + ': admin de empresa solo en proyectos de SU gestora activa', async () => {
      const es = cargar(f);
      assert(await es('adm-b', 'pb') === true, 'proyecto de su empresa → sí');
      assert(await es('adm-b', 'pa') === false, 'proyecto de otra empresa → no');
      assert(await es('adm-b', 'no-existe') === false, 'proyecto inexistente → no');
      assert(await es('adm-b', 'p-sin') === false, 'proyecto sin empresa → no');
      assert(await es('adm-sin', 'p-sin') === false, 'perfil y proyecto sin empresa (null con null) → no');
      assert(await es('adm-sin', 'pb') === false, 'admin_empresa sin empresa en el perfil → no');
      assert(await es('adm-inactiva', 'px') === false, 'empresa inactiva → no');
      assert(await es('adm-emisor', 'pc') === false, 'empresa que no es gestora → no');
      assert(await es('fis', 'pb') === false, 'usuario de la misma empresa sin el rol → no');
      assert(await es('global', 'pb') === false, 'el admin global no pasa por esta vía (tiene la suya)');
      assert(await es('no-existe', 'pb') === false, 'usuario sin perfil → no');
      assert(await es('adm-b', null) === false && await es('adm-b', undefined) === false, 'sin proyecto → no');
    });

    await prueba(f + ': base sin migrar o consulta con error → deniega sin lanzar', async () => {
      // empresas sin las columnas es_gestora/activa: PostgREST devuelve error
      const conError = { tabla: 'empresas', respuesta: () => { const b = { select: () => b, eq: () => b, maybeSingle: () => b, single: () => b, then: (r) => Promise.resolve({ data: null, error: { message: 'column empresas.es_gestora does not exist' } }).then(r) }; return b; } };
      assert(await cargar(f, FIXTURE(), conError)('adm-b', 'pb') === false, 'error al leer empresas → no');
      const lanza = { tabla: 'proyectos', respuesta: () => { throw new Error('red caída'); } };
      assert(await cargar(f, FIXTURE(), lanza)('adm-b', 'pb') === false, 'excepción al leer proyectos → no (sin propagar)');
      // filas con valores «casi verdaderos» no cuentan
      const fx = FIXTURE(); fx.empresas.find(e => e.id === 'e-b').activa = null;
      assert(await cargar(f, fx)('adm-b', 'pb') === false, 'activa = null → no');
    });

    await prueba(f + ': la auxiliar se usa en el punto de autorización y el JWT se valida antes', () => {
      const fuente = leer(ruta(f));
      const usos = fuente.split('esAdminDeEmpresaDelProyecto(').length - 1;
      assert(usos >= 2, 'declarada y llamada: ' + usos);
      const iJwt = fuente.indexOf('auth.getUser(');
      const iUso = fuente.indexOf('await esAdminDeEmpresaDelProyecto(');
      assert(iJwt > 0 && iUso > iJwt, 'la llamada va después de validar el token');
    });
  }

  resumen();
})();
