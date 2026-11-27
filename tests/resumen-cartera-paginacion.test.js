// Edge Function resumen-cartera: lecturas paginadas y errores. Ejecuta la auxiliar REAL
// leerPaginado extraída de supabase/functions/resumen-cartera/index.ts (tipos quitados con
// node:module) contra un cliente simulado con tope de filas (como el max-rows de PostgREST), y
// la función COMPLETA (con Deno, createClient y fetch simulados) para comprobar que con más de
// 1.000 filas el resumen se calcula con todas y que un error de lectura responde 500 con el
// nombre de la tabla, sin llamar al modelo ni dejar notificaciones. Datos sintéticos (ZZZ).
//
//   node resumen-cartera-paginacion.test.js
'use strict';
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('node:module');
const { RAIZ, leer, crearSb, prueba, resumen, assert } = require('./lib/arnes');

const RUTA = path.join(RAIZ, 'supabase', 'functions', 'resumen-cartera', 'index.ts');
const fuente = leer(RUTA).replace(/\r\n/g, '\n');
const js = stripTypeScriptTypes(fuente);

// Las ocho tablas que deben leerse siempre por la auxiliar
const TABLAS = ['rubros', 'cronograma_rubros', 'lineas_base', 'planillas_pago', 'garantias', 'observaciones', 'solicitudes', 'proyecto_miembros'];

function igual(real, esp, que){ assert(real === esp, `${que}: se esperaba ${JSON.stringify(esp)} y salió ${JSON.stringify(real)}`); }

// Fuente JS de la auxiliar: desde su declaración hasta la primera línea que es exactamente `}`.
function fuenteAuxiliar(){
  const i = js.indexOf('async function leerPaginado(');
  assert(i >= 0, 'index.ts no tiene la auxiliar leerPaginado');
  return js.slice(i, js.indexOf('\n}', i) + 2);
}
function cargarAuxiliar(){
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fuenteAuxiliar() + '\nglobalThis.aux = leerPaginado;', ctx);
  return ctx.aux;
}

// Consulta que falla como supabase-js: no lanza, resuelve { data: null, error }.
function consultaQueFalla(mensaje){
  const q = new Proxy({}, { get: (_, k) => k === 'then'
    ? (res, rej) => Promise.resolve({ data: null, error: { message: mensaje } }).then(res, rej)
    : () => q });
  return q;
}
// Cliente cuyo .range() de `tabla` falla a partir de la fila `desdeFila` (la primera página llega bien).
function conFalloEnPagina(sb, tabla, desdeFila, mensaje){
  const from = sb.from;
  sb.from = t => {
    const q = from(t);
    if(t !== tabla) return q;
    const range = q.range;
    q.range = (a, z) => a >= desdeFila ? consultaQueFalla(mensaje) : range(a, z);
    return q;
  };
  return sb;
}

const id4 = (pref, i) => pref + String(i).padStart(4, '0');

// Cartera sintética: un proyecto con 2.500 rubros de 100. Los 1.000 primeros por id no tienen
// producción y los 1.500 siguientes están completos: avance real 60,0 %. Una lectura cortada en
// 1.000 filas daría 0,0 %.
function fixtureGrande(){
  const fx = {
    proyectos: [{ id: 'zzz-p1', nombre: 'ZZZ Grande', estado: 'ejecucion', estado_cierre: null }],
    perfiles: [{ id: 'zzz-adm', rol: 'admin' }],
    proyecto_miembros: [], rubros: [], cronograma_rubros: [], lineas_base: [], planillas_pago: [], garantias: [], observaciones: [], solicitudes: [], notificaciones: []
  };
  for(let i = 0; i < 2500; i++) fx.rubros.push({ id: id4('zzz-r', i), proyecto_id: 'zzz-p1', monto_contrato: 100, total_produccion: i < 1000 ? 0 : 100 });
  // 1.200 observaciones abiertas y 1.100 solicitudes pendientes: también por encima del tope
  for(let i = 0; i < 1200; i++) fx.observaciones.push({ id: id4('zzz-o', i), proyecto_id: 'zzz-p1', estado: 'abierta', created_at: null });
  for(let i = 0; i < 1100; i++) fx.solicitudes.push({ id: id4('zzz-s', i), proyecto_id: 'zzz-p1', estado: 'pendiente' });
  // La garantía vencida es la fila 1.001 de las vigentes
  for(let i = 0; i < 1000; i++) fx.garantias.push({ id: id4('zzz-g', i), proyecto_id: 'zzz-p1', estado: 'vigente', vigencia_hasta: '2099-01-01' });
  fx.garantias.push({ id: 'zzz-gz', proyecto_id: 'zzz-p1', estado: 'vigente', vigencia_hasta: '2020-01-01' });
  return fx;
}

// Ejecuta la función completa: el import de supabase-js se sustituye por un createClient que
// devuelve el cliente simulado; Deno.serve entrega el manejador; fetch queda registrado.
// `destinatarios` es el secreto RESUMEN_CARTERA_DESTINATARIOS (sin él: solo admins).
async function invocar(sb, { secreto = 'zzz-secreto', destinatarios } = {}){
  const peticiones = [];
  let manejador = null;
  const ctx = {
    console: { ...console, error(){} },
    Response, URL,
    __sb: sb,
    Deno: {
      env: { get: k => ({ ANTHROPIC_API_KEY: 'zzz-clave', SUPABASE_URL: 'https://zzz.test', SUPABASE_SERVICE_ROLE_KEY: 'zzz-servicio', SUPABASE_ANON_KEY: 'zzz-anon', CRON_SECRET: 'zzz-secreto', RESUMEN_CARTERA_DESTINATARIOS: destinatarios })[k] },
      serve: h => { manejador = h; }
    },
    fetch: async (url, opciones) => {
      peticiones.push({ url: String(url), cuerpo: opciones && opciones.body ? JSON.parse(opciones.body) : null });
      if(String(url).includes('api.anthropic.com')) return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ZZZ resumen de prueba' }] }), text: async () => '' };
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }
  };
  vm.createContext(ctx);
  const codigo = js.replace(/^import \{ createClient \} from [^\n]+$/m, 'const createClient = () => globalThis.__sb;');
  assert(codigo !== js, 'se sustituyó el import de supabase-js');
  vm.runInContext(codigo, ctx, { filename: 'resumen-cartera.js' });
  assert(typeof manejador === 'function', 'Deno.serve recibió el manejador');
  const resp = await manejador(new Request('https://zzz.test/functions/v1/resumen-cartera', { method: 'POST', headers: { 'x-cron-secret': secreto }, body: '{}' }));
  return { status: resp.status, cuerpo: await resp.json(), peticiones };
}

(async () => {
  console.log('resumen-cartera-paginacion.test.js');

  await prueba('el archivo es sintaxis válida tras quitar los tipos y declara la auxiliar', () => {
    new vm.Script(js.replace(/^import [^\n]+$/m, ''), { filename: 'resumen-cartera.js' });   // lanza si no compila
    assert(/async function leerPaginado\(sb\s*,\s*tabla\s*,\s*columnas\s*,\s*filtrar\s*,\s*orden\s*=\s*\['id'\]\s*,\s*tam\s*=\s*1000\s*\)/.test(fuenteAuxiliar()),'firma de la auxiliar: (sb, tabla, columnas, filtrar, orden, tam)');
  });

  await prueba('auxiliar: 2.500 filas con tope de 1.000 por respuesta se leen completas, en orden y sin repetir', async () => {
    const fx = fixtureGrande();
    // El cliente simulado corta de verdad: sin paginar solo llegan 1.000
    igual((await crearSb(fx, { maxFilas: 1000 }).from('rubros').select('id').in('proyecto_id', ['zzz-p1'])).data.length, 1000, 'lectura sin paginar');
    const sb = crearSb(fx, { maxFilas: 1000 });
    const filas = await cargarAuxiliar()(sb, 'rubros', 'id,proyecto_id,monto_contrato,total_produccion', q => q.in('proyecto_id', ['zzz-p1']));
    igual(filas.length, 2500, 'filas leídas');
    igual(new Set(filas.map(f => f.id)).size, 2500, 'sin repetidas');
    igual(filas.map(f => f.id).join(','), fx.rubros.map(f => f.id).slice().sort().join(','), 'en orden estable por id');
    igual(filas.reduce((s, f) => s + f.total_produccion, 0), 150000, 'la producción de las filas posteriores a la 1.000 está');
    const rangos = sb.llamadas.filter(l => l.tabla === 'rubros').map(l => l.rango.join('-'));
    igual(rangos.join(' '), '0-999 1000-1999 2000-2999', 'tres páginas con .range()');
  });

  await prueba('auxiliar: páginas exactas, tabla vacía, filtro, orden pedido y tamaño de página', async () => {
    const aux = cargarAuxiliar();
    const fx = { t: [] };
    for(let i = 0; i < 2000; i++) fx.t.push({ id: id4('zzz-', i), grupo: i % 2 ? 'a' : 'b', creado: 5000 - i });
    // 2.000 filas justas: hace falta una tercera lectura (vacía) para saber que se acabó
    const sb = crearSb(fx, { maxFilas: 1000 });
    igual((await aux(sb, 't', 'id')).length, 2000, 'múltiplo exacto del tamaño de página');
    igual(sb.llamadas.length, 3, 'tres lecturas (la última, vacía)');
    igual((await aux(crearSb({ t: [] }), 't', 'id')).length, 0, 'tabla vacía');
    igual((await aux(crearSb({}), 't', 'id', null)).length, 0, 'tabla inexistente en el fixture y filtro null');
    const soloA = await aux(crearSb(fx, { maxFilas: 1000 }), 't', 'id,grupo', q => q.eq('grupo', 'a'));
    igual(soloA.length, 1000, 'respeta el filtro'); assert(soloA.every(f => f.grupo === 'a'), 'solo las filas del filtro');
    const porCreado = await aux(crearSb(fx, { maxFilas: 1000 }), 't', 'id', null, ['creado', 'id']);
    igual(porCreado[0].id, 'zzz-1999', 'orden pedido (creado, id): primero la más antigua'); igual(porCreado.length, 2000, 'orden pedido: todas');
    // Tamaño de página a pedido: 7 filas de 3 en 3
    const sb7 = crearSb({ t: fx.t.slice(0, 7) });
    igual((await aux(sb7, 't', 'id', null, ['id'], 3)).length, 7, 'páginas de 3');
    igual(sb7.llamadas.map(l => l.rango.join('-')).join(' '), '0-2 3-5 6-8', 'rangos de 3');
  });

  await prueba('auxiliar: un error en la primera o en la SEGUNDA página se propaga con el nombre de la tabla', async () => {
    const aux = cargarAuxiliar();
    for(const [que, desdeFila] of [['primera página', 0], ['segunda página', 1000], ['tercera página', 2000]]){
      const sb = conFalloEnPagina(crearSb(fixtureGrande(), { maxFilas: 1000 }), 'rubros', desdeFila, 'ZZZ corte de red');
      let error = null, filas = null;
      try{ filas = await aux(sb, 'rubros', 'id', q => q.in('proyecto_id', ['zzz-p1'])); }catch(e){ error = e; }
      // (el Error nace en el contexto vm de la auxiliar: se reconoce por su mensaje, no con instanceof)
      assert(error && typeof error.message === 'string', que + ': lanza (no devuelve ' + (filas && filas.length) + ' filas parciales)');
      assert(error.message.includes('rubros') && error.message.includes('ZZZ corte de red'), que + ': el mensaje nombra la tabla y la causa: ' + error.message);
    }
  });

  await prueba('función completa: con 2.500 rubros y tope de 1.000 el resumen usa todas las filas', async () => {
    const fx = fixtureGrande();
    const sb = crearSb(fx, { maxFilas: 1000 });
    const r = await invocar(sb, { destinatarios: 'equipo' });
    igual(r.status, 200, 'estado HTTP'); igual(r.cuerpo.ok, true, 'ok'); igual(r.cuerpo.entregados, 1, 'una notificación entregada');
    igual(JSON.stringify(r.cuerpo.errores), '[]', 'sin errores');
    const ia = r.peticiones.find(p => p.url.includes('api.anthropic.com'));
    assert(ia, 'se llamó al modelo');
    const indicadores = ia.cuerpo.messages[0].content;
    assert(indicadores.includes('ZZZ Grande: avance 60.0%'), 'avance con los 2.500 rubros (cortado en 1.000 sería 0.0 %): ' + indicadores.slice(indicadores.indexOf('- [')));
    assert(indicadores.includes('1 garantía(s) VENCIDA(S)') && indicadores.includes('[ROJO]'), 'la garantía vencida que era la fila 1.001');
    assert(indicadores.includes('1200 observación(es) abierta(s)') && indicadores.includes('1100 solicitud(es) pendiente(s)'), 'pendientes completos');
    igual(fx.notificaciones.length, 1, 'notificación guardada'); igual(fx.notificaciones[0].mensaje, 'ZZZ resumen de prueba', 'con el texto del modelo');
    // Todas las lecturas de las ocho tablas fueron con .range()
    assert(sb.llamadas.filter(l => TABLAS.includes(l.tabla)).every(l => Array.isArray(l.rango)), 'las ocho tablas se leen con .range()');
    for(const t of TABLAS) assert(sb.llamadas.some(l => l.tabla === t), 'se leyó ' + t);
  });

  await prueba('función completa: los fiscalizadores salen de proyecto_miembros paginado (1.500 miembros)', async () => {
    const fx = fixtureGrande();
    fx.perfiles = [];
    for(let i = 0; i < 1500; i++) fx.proyecto_miembros.push({ id: id4('zzz-m', i), usuario_id: id4('zzz-u', i), proyecto_id: 'zzz-p1', rol: 'fiscalizador' });
    const r = await invocar(crearSb(fx, { maxFilas: 1000 }), { destinatarios: 'equipo' });
    igual(r.status, 200, 'estado HTTP'); igual(r.cuerpo.entregados, 1500, 'los 1.500 fiscalizadores reciben el resumen (cortado serían 1.000)');
    igual(r.cuerpo.grupos, 1, 'un solo grupo (mismo conjunto de proyectos)'); igual(r.cuerpo.destinatarios, 'equipo', 'modo equipo');
  });

  await prueba('destinatarios: sin el secreto (o con otro valor) solo reciben los admins y proyecto_miembros ni se lee', async () => {
    for(const valor of [undefined, '', 'admins', 'todos']){
      const fx = fixtureGrande();
      for(let i = 0; i < 30; i++) fx.proyecto_miembros.push({ id: id4('zzz-m', i), usuario_id: id4('zzz-u', i), proyecto_id: 'zzz-p1', rol: 'fiscalizador' });
      const sb = crearSb(fx, { maxFilas: 1000 });
      const r = await invocar(sb, { destinatarios: valor });
      const que = 'valor ' + JSON.stringify(valor) + ': ';
      igual(r.status, 200, que + 'estado HTTP'); igual(r.cuerpo.destinatarios, 'admins', que + 'modo');
      igual(r.cuerpo.entregados, 1, que + 'una sola notificación'); igual(r.cuerpo.grupos, 1, que + 'un grupo');
      igual(fx.notificaciones.map(n => n.perfil_id).join(','), 'zzz-adm', que + 'la notificación es del admin');
      const push = r.peticiones.filter(p => p.url.includes('/functions/v1/enviar-push'));
      igual(push.length, 1, que + 'un push'); igual(JSON.stringify(push[0].cuerpo.usuarioIds), '["zzz-adm"]', que + 'el push va solo al admin');
      assert(!sb.llamadas.some(l => l.tabla === 'proyecto_miembros'), que + 'proyecto_miembros no se lee');
    }
    // «equipo» se reconoce con espacios y mayúsculas
    const fx = fixtureGrande();
    for(let i = 0; i < 30; i++) fx.proyecto_miembros.push({ id: id4('zzz-m', i), usuario_id: id4('zzz-u', i), proyecto_id: 'zzz-p1', rol: 'fiscalizador' });
    const r = await invocar(crearSb(fx, { maxFilas: 1000 }), { destinatarios: ' Equipo ' });
    igual(r.cuerpo.destinatarios, 'equipo', 'modo equipo'); igual(r.cuerpo.entregados, 31, 'admin y 30 fiscalizadores');
  });

  await prueba('destinatarios: solo admins y ningún admin → no se envía nada ni se llama al modelo', async () => {
    const fx = fixtureGrande();
    fx.perfiles = [];
    for(let i = 0; i < 30; i++) fx.proyecto_miembros.push({ id: id4('zzz-m', i), usuario_id: id4('zzz-u', i), proyecto_id: 'zzz-p1', rol: 'fiscalizador' });
    const r = await invocar(crearSb(fx, { maxFilas: 1000 }));
    igual(r.status, 200, 'estado HTTP'); igual(r.cuerpo.mensaje, 'Sin destinatarios', 'mensaje'); igual(r.cuerpo.destinatarios, 'admins', 'modo');
    igual(r.peticiones.length, 0, 'sin llamada al modelo ni push'); igual(fx.notificaciones.length, 0, 'sin notificaciones');
  });

  await prueba('función completa: un error al leer cualquiera de las ocho tablas responde 500 con su nombre, sin resumen', async () => {
    for(const tabla of TABLAS){
      const fx = fixtureGrande();
      const sb = crearSb(fx, { maxFilas: 1000 }), from = sb.from;
      sb.from = t => t === tabla ? consultaQueFalla('ZZZ fallo de ' + tabla) : from(t);
      const r = await invocar(sb, { destinatarios: 'equipo' });
      igual(r.status, 500, tabla + ': estado HTTP');
      assert(typeof r.cuerpo.error === 'string' && r.cuerpo.error.includes(tabla) && r.cuerpo.error.includes('ZZZ fallo de ' + tabla), tabla + ': el error nombra la tabla: ' + JSON.stringify(r.cuerpo));
      igual(r.peticiones.length, 0, tabla + ': no se llamó al modelo ni a enviar-push');
      igual(fx.notificaciones.length, 0, tabla + ': ninguna notificación');
    }
  });

  await prueba('función completa: error en la SEGUNDA página de rubros → 500, no un resumen con las 1.000 primeras', async () => {
    const fx = fixtureGrande();
    const r = await invocar(conFalloEnPagina(crearSb(fx, { maxFilas: 1000 }), 'rubros', 1000, 'ZZZ corte en la página 2'));
    igual(r.status, 500, 'estado HTTP');
    assert(r.cuerpo.error.includes('rubros') && r.cuerpo.error.includes('ZZZ corte en la página 2'), 'mensaje: ' + r.cuerpo.error);
    igual(r.peticiones.length, 0, 'sin llamada al modelo'); igual(fx.notificaciones.length, 0, 'sin notificaciones');
  });

  await prueba('función completa: sin el secreto del cron ni sesión de admin responde 401 antes de leer nada', async () => {
    const sb = crearSb(fixtureGrande());
    const r = await invocar(sb, { secreto: 'zzz-otro' });
    igual(r.status, 401, 'estado HTTP'); igual(sb.llamadas.length, 0, 'ninguna lectura');
  });

  await prueba('fuente: ninguna lectura de esas tablas fuera de la auxiliar', () => {
    // Sin comentarios de línea, para no tropezar con texto explicativo
    const codigo = fuente.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    for(const t of TABLAS){
      assert(!new RegExp(`from\\(\\s*['"\`]${t}['"\`]\\s*\\)`).test(codigo), t + ': sin sb.from(\'' + t + '\') directo');
      igual(codigo.split(`leerPaginado(sb, '${t}',`).length - 1, 1, t + ': una lectura, por leerPaginado');
    }
    // La única llamada a .from con nombre variable y el único .range() están dentro de la auxiliar
    const aux = fuente.slice(fuente.indexOf('async function leerPaginado('), fuente.indexOf('\n}', fuente.indexOf('async function leerPaginado(')) + 2);
    igual(codigo.split('.range(').length - 1, 1, 'un solo .range() en el archivo');
    assert(aux.includes('.range(desde, desde + tam - 1)') && aux.includes('sb.from(tabla).select(columnas)'), 'y está en la auxiliar, que es la que hace sb.from(tabla)');
    igual(codigo.split('sb.from(tabla)').length - 1, 1, 'sb.from(tabla) solo en la auxiliar');
    assert(/for \(const columna of orden\) q = q\.order\(columna\)/.test(aux) && /orden: string\[\] = \['id'\]/.test(aux), 'orden estable (por defecto, id)');
    assert(/if \(error\) throw new Error\(/.test(aux), 'un error de página lanza');
    // Ya no quedan respuestas { data } sin comprobar de aquellas lecturas
    assert(!/\b(rubR|cronR|lbR|planR|garR|obsR|solR)\b/.test(codigo), 'sin las respuestas { data } antiguas');
    assert(!/miembrosFis \|\| \[\]/.test(codigo), 'proyecto_miembros ya no pasa por «data || []»');
    // El catch general es el que convierte el error en 500
    assert(/catch \(err\) \{[\s\S]*?return json\(\{ error: \(err as Error\)\.message \|\| 'Error interno' \}, 500\)/.test(codigo), 'el error de lectura acaba en un 500 con su mensaje');
  });

  await prueba('fuente: las fórmulas del resumen no cambiaron (eso es la fase 2)', () => {
    // Paginación y errores únicamente: los umbrales y cálculos siguen tal cual
    for(const trozo of [
      "const spi = d.plan > 0.5 ? (d.ev / d.plan) : null;",
      "atraso = Math.round(diasTrans * (1 / spi - 1));",
      "if ((spi !== null && spi < 0.85) || d.garVencidas > 0 || atraso > 30) sem = 'ROJO';",
      "else if ((spi !== null && spi < 0.95) || d.garPorVencer > 0 || pend > 5) sem = 'AMARILLO';",
      "const pend = d.obs + d.sol + d.planillasRev;",
      "return lbActiva ? c.linea_base_id === lbActiva : true;"
    ]) assert(fuente.includes(trozo), 'sigue estando: ' + trozo);
  });

  resumen();
})();
