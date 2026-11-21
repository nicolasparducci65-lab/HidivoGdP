// Multiempresa, interfaz: formulario de proyecto (gestora, emisor, tipo, código), filtros por
// empresa y tipo, distintivo y pantalla Empresas. Ejecuta las funciones REALES de index.html
// en jsdom, con constantes.js y expediente.js, contra un Supabase simulado.
//
//   node multiempresa-ui.test.js
'use strict';
const path = require('path');
const { JSDOM } = require('jsdom');
const { RAIZ, leer, scriptPrincipal, extraerFuncion, extraerBloque, extraerConst, crearSb, prueba, resumen, assert } = require('./lib/arnes');

const src = scriptPrincipal();
const FUNCIONES = ['cargarEmpresas', 'multiempresaActiva', 'gestorasActivas', 'gestoraPorDefecto', 'prepararEmpresaProyecto', 'siguienteCodigoProyecto',
  'sugerirCodigoProyecto', 'leerEmpresaProyecto', 'mensajeErrorProyecto', 'filtrarPorEmpresaTipo', 'opcionesEmpresaTipo', 'barraFiltroEmpresaTipo',
  'colorEmpresa', 'distintivoEmpresa', 'bordeEmpresa', 'codigoTipoTexto', 'aplicarFiltroProyectos', 'poblarSelectsFiltro', 'leerFiltrosDeSelects',
  'textoBusquedaProyecto', 'estadoLabel', 'hoyEcuador', 'cargarEmpresasAdmin', 'renderEmpresasAdmin', 'abrirFormEmpresa', 'cerrarFormEmpresa',
  'renderFormEmpresa', 'guardarEmpresa'];
const CODIGO = [
  leer(path.join(RAIZ, 'constantes.js')), leer(path.join(RAIZ, 'expediente.js')),
  'let proyectos = []; let currentPerfil = null; let currentProyecto = null;',
  'function toast(msg, tipo){ window._toasts.push({ msg, tipo }); } function invalidarCacheProyectos(){ window._invalidaciones++; } function navTo(){}',
  ...['filtrosDashboard', 'filtrosProyectos', 'CLAVES_FILTRO', 'filtrosCartera', 'filtrosReportes', '_empresaEditando', 'LOGO_EMPRESA_MAX'].map(c => extraerConst(src, c)),
  'let _empresaLogoPendiente;',
  extraerBloque(src, 'const SELECTS_FILTRO = {'),
  ...FUNCIONES.map(f => extraerFuncion(src, f))
].join('\n');

const EMPRESAS = () => [
  { id: 'e-a', nombre: 'Alfa', sigla: 'ALF', razon_social: 'Alfa Fiscalización S.A.S.', ruc: '0990000000001', color: '#0073ea', logo_data: null, es_gestora: true, activa: true },
  { id: 'e-b', nombre: 'Beta', sigla: 'BET', razon_social: null, ruc: null, color: '#00854d', logo_data: 'data:image/png;base64,QkJC', es_gestora: true, activa: true },
  { id: 'e-c', nombre: 'Gama', sigla: 'GAM', razon_social: 'Gama S.A.', ruc: null, color: 'rojo', logo_data: null, es_gestora: false, activa: true },
  { id: 'e-v', nombre: 'Vieja', sigla: null, razon_social: null, ruc: null, color: null, logo_data: null, es_gestora: false, activa: false }
];
const PROYECTOS = () => [
  { id: 'p1', nombre: 'Fiscalización uno', empresa_id: 'e-a', emisor_empresa_id: null, tipo: 'fiscalizacion', codigo: 'ALF-FIS-2026-001', contratante: 'C1', contratista: 'X', estado: 'ejecucion' },
  { id: 'p2', nombre: 'Pilotes dos', empresa_id: 'e-b', emisor_empresa_id: 'e-c', tipo: 'pilotes', codigo: null, contratante: 'C2', contratista: 'Y', estado: 'ejecucion' },
  { id: 'p3', nombre: 'Puente tres', empresa_id: 'e-b', emisor_empresa_id: null, tipo: 'puentes', codigo: 'BET-PUE-2026-001', contratante: 'C1', contratista: 'Y', estado: 'finalizado' }
];
const DOM = `<input id="editProyectoId"/><div id="pBloqueEmpresa" style="display:none"><select id="pEmpresa"></select><select id="pTipo"></select><select id="pEmisor"></select>
  <input id="pCodigo"/><button id="pCodigoSugerir"></button><div id="pCodigoNota"></div></div><input id="pFechaInicio"/>
  ${['filtroEmpresa', 'filtroTipo', 'filtroContratante', 'filtroContratista', 'filtroEstado'].map(i => `<select id="${i}" style="display:none"></select>`).join('')}
  <div id="empresasContent"></div>`;

function montar({ empresas = EMPRESAS(), perfil = { id: 'u1', rol: 'admin', rolGlobal: 'admin', empresa_id: null }, conDocumentos = false, confirmar = true } = {}){
  const dom = new JSDOM(`<!doctype html><html><body>${DOM}</body></html>`, { url: 'https://hidivo.test/HidivoGdP/', runScripts: 'outside-only' });
  const w = dom.window;
  const fixture = { empresas, proyectos: PROYECTOS() };
  w.sb = crearSb(fixture);
  w._rpc = [];
  w.sb.rpc = (fn, args) => {
    w._rpc.push([fn, args]);
    if(fn === 'proyecto_tiene_documentos_emitidos') return Promise.resolve({ data: conDocumentos, error: null });
    if(fn === 'proyecto_siguiente_codigo'){
      const e = fixture.empresas.find(x => x.id === args.p_empresa), t = w.TIPOS_PROYECTO.find(x => x.id === args.p_tipo);
      return Promise.resolve({ data: e && e.sigla && t ? `${e.sigla}-${t.abrev}-${args.p_anio}-007` : null, error: null });
    }
    return Promise.resolve({ data: null, error: { message: 'rpc desconocida' } });
  };
  w._toasts = []; w._invalidaciones = 0; w._confirmaciones = []; w.console = console;
  w.confirm = msg => { w._confirmaciones.push(msg); return confirmar; };
  w.Element.prototype.scrollIntoView = () => {};
  w.eval(CODIGO + '\nwindow.TIPOS_PROYECTO = TIPOS_PROYECTO; window._fijar = (p, pr) => { currentPerfil = p; proyectos = pr; }; window._filtros = { filtrosDashboard, filtrosCartera };');
  w._fijar(perfil, fixture.proyectos);
  w.fijarEmpresas(empresas);
  const el = id => w.document.getElementById(id);
  return { w, el, fixture, toasts: () => w._toasts, cerrar: () => w.close() };
}
const opciones = sel => [...sel.options].map(o => o.value);
const pausa = () => new Promise(r => setTimeout(r, 5));

(async () => {
  console.log('multiempresa-ui.test.js');

  await prueba('base sin migrar (empresas sin sigla): no hay bloque de empresa, ni filtros, ni distintivo, y el guardado no añade columnas', () => {
    const t = montar({ empresas: [{ id: 'e-v', nombre: 'Vieja' }] });
    assert(t.w.multiempresaActiva() === false, 'multiempresa inactiva');
    t.w.prepararEmpresaProyecto(null);
    assert(t.el('pBloqueEmpresa').style.display === 'none', 'bloque oculto');
    t.w.poblarSelectsFiltro({ empresa: 'filtroEmpresa', tipo: 'filtroTipo', contratante: 'filtroContratante', contratista: 'filtroContratista', estado: 'filtroEstado' }, t.w._filtros.filtrosDashboard, PROYECTOS());
    assert(t.el('filtroEmpresa').style.display === 'none' && t.el('filtroTipo').style.display === 'none', 'filtros de empresa y tipo ocultos');
    assert(t.el('filtroContratante').options.length === 3, 'los filtros de siempre siguen funcionando');
    assert(t.w.distintivoEmpresa(PROYECTOS()[0]) === '' && t.w.bordeEmpresa(PROYECTOS()[0]) === '' && t.w.codigoTipoTexto(PROYECTOS()[0]) === '', 'sin distintivo');
    t.cerrar();
  });

  await prueba('alta por admin global: elige gestora entre las activas, tipo obligatorio y código asignado por la base', async () => {
    const t = montar();
    t.w.prepararEmpresaProyecto(null);
    assert(t.el('pBloqueEmpresa').style.display === '', 'bloque visible');
    assert(opciones(t.el('pEmpresa')).join() === ',e-a,e-b' && !t.el('pEmpresa').disabled, 'gestoras activas: ' + opciones(t.el('pEmpresa')));
    assert(t.el('pEmpresa').value === '', 'con dos gestoras y perfil sin empresa no se preselecciona ninguna');
    assert(opciones(t.el('pEmisor')).join() === ',e-a,e-b,e-c', 'emisores: vacío (la gestora) + activas con sigla: ' + opciones(t.el('pEmisor')));
    assert(opciones(t.el('pTipo')).length === 8, '7 tipos + vacío');
    assert(await t.w.leerEmpresaProyecto('') === null && /empresa gestora/.test(t.toasts().at(-1).msg), 'sin gestora no guarda');
    t.el('pEmpresa').value = 'e-b';
    assert(await t.w.leerEmpresaProyecto('') === null && /tipo de proyecto/.test(t.toasts().at(-1).msg), 'sin tipo no guarda');
    t.el('pTipo').value = 'pilotes'; t.el('pFechaInicio').value = '2027-03-01'; t.el('pEmisor').value = 'e-c';
    const cols = await t.w.leerEmpresaProyecto('');
    assert(JSON.stringify(cols) === JSON.stringify({ tipo: 'pilotes', emisor_empresa_id: 'e-c', codigo: 'BET-PIL-2027-007', empresa_id: 'e-b' }), JSON.stringify(cols));
    assert(t.w._rpc.at(-1)[1].p_anio === 2027, 'el año del código es el de la fecha de inicio');
    t.cerrar();
  });

  await prueba('alta por fiscalizador: la gestora es la de su perfil y no la puede cambiar; «Sugerir» propone el código', async () => {
    const t = montar({ perfil: { id: 'u2', rol: 'fiscalizador', rolGlobal: null, empresa_id: 'e-b' } });
    t.w.prepararEmpresaProyecto(null);
    assert(t.el('pEmpresa').value === 'e-b' && t.el('pEmpresa').disabled, 'gestora del perfil, bloqueada');
    await t.w.sugerirCodigoProyecto();
    assert(/gestora y el tipo/.test(t.toasts().at(-1).msg), 'sin tipo no sugiere');
    t.el('pTipo').value = 'puentes';
    await t.w.sugerirCodigoProyecto();
    assert(/^BET-PUE-\d{4}-007$/.test(t.el('pCodigo').value), 'código sugerido: ' + t.el('pCodigo').value);
    t.el('pCodigo').value = 'bet-pue-2026-12';
    assert(await t.w.leerEmpresaProyecto('') === null && /SIGLA-TIP-AAAA-NNN/.test(t.toasts().at(-1).msg), 'código mal formado no guarda');
    t.el('pCodigo').value = 'bet-pue-2026-012';
    assert((await t.w.leerEmpresaProyecto('')).codigo === 'BET-PUE-2026-012', 'el código escrito a mano se respeta, en mayúsculas');
    t.cerrar();
    const sin = montar({ perfil: { id: 'u3', rol: 'fiscalizador', rolGlobal: null, empresa_id: null } });
    sin.w.prepararEmpresaProyecto(null);
    sin.el('pTipo').value = 'puentes';
    assert(await sin.w.leerEmpresaProyecto('') === null && /no tiene empresa asignada/.test(sin.toasts().at(-1).msg), 'fiscalizador sin empresa y con dos gestoras: no adivina');
    sin.cerrar();
  });

  await prueba('edición: sin cambio de gestora no la envía; código vacío no se autoasigna; reasignar pide confirmación', async () => {
    const t = montar({ confirmar: false });
    const p2 = t.fixture.proyectos[1];
    t.el('editProyectoId').value = 'p2';
    t.w.prepararEmpresaProyecto(p2);
    assert(t.el('pEmpresa').value === 'e-b' && t.el('pEmisor').value === 'e-c' && t.el('pTipo').value === 'pilotes' && t.el('pCodigo').value === '', 'carga los valores del proyecto');
    let cols = await t.w.leerEmpresaProyecto('p2');
    assert(JSON.stringify(cols) === JSON.stringify({ tipo: 'pilotes', emisor_empresa_id: 'e-c', codigo: null }), 'sin empresa_id ni código inventado: ' + JSON.stringify(cols));
    assert(!t.w._rpc.some(r => r[0] === 'proyecto_siguiente_codigo'), 'en edición no se pide código a la base');
    t.el('pEmpresa').value = 'e-a';
    assert(await t.w.leerEmpresaProyecto('p2') === null, 'cancelar la confirmación detiene el guardado');
    assert(/Reasignar este proyecto de Beta a Alfa/.test(t.w._confirmaciones[0]) && /emisor de documentos no cambia/.test(t.w._confirmaciones[0]), t.w._confirmaciones[0]);
    t.cerrar();
    const si = montar({ confirmar: true });
    si.el('editProyectoId').value = 'p3';
    si.w.prepararEmpresaProyecto(si.fixture.proyectos[2]);
    si.el('pEmpresa').value = 'e-a';
    cols = await si.w.leerEmpresaProyecto('p3');
    assert(cols.empresa_id === 'e-a', 'al confirmar envía la gestora nueva');
    assert(/conservan a Beta/.test(si.w._confirmaciones[0]), 'sin emisor propio avisa del cambio de membrete: ' + si.w._confirmaciones[0]);
    si.cerrar();
  });

  await prueba('reasignar la gestora es solo del admin global; código con documentos emitidos queda de solo lectura', async () => {
    const t = montar({ perfil: { id: 'u2', rol: 'admin', rolGlobal: null, empresa_id: 'e-b' }, conDocumentos: true });
    const p3 = t.fixture.proyectos[2];
    t.el('editProyectoId').value = 'p3';
    t.w.prepararEmpresaProyecto(p3);
    assert(t.el('pEmpresa').disabled, 'el select de gestora está bloqueado para quien no es admin global');
    t.el('pEmpresa').value = 'e-a';
    assert(await t.w.leerEmpresaProyecto('p3') === null && /Solo un administrador global/.test(t.toasts().at(-1).msg), 'y si lo fuerza, se rechaza');
    await pausa();
    assert(t.el('pCodigo').readOnly && t.el('pCodigoSugerir').style.display === 'none' && /documentos emitidos/.test(t.el('pCodigoNota').textContent), 'código bloqueado');
    t.cerrar();
    const libre = montar({ conDocumentos: false });
    libre.el('editProyectoId').value = 'p3';
    libre.w.prepararEmpresaProyecto(libre.fixture.proyectos[2]);
    await pausa();
    assert(!libre.el('pCodigo').readOnly, 'sin documentos el código se puede corregir');
    assert(/Ya existe un proyecto con ese código/.test(libre.w.mensajeErrorProyecto({ message: 'duplicate key value violates unique constraint "proyectos_codigo_uniq"' })), 'mensaje de código duplicado');
    libre.cerrar();
  });

  await prueba('filtros: empresa y tipo se combinan con los de siempre y sus selects se pueblan de los datos', () => {
    const t = montar();
    const lista = PROYECTOS();
    const f = (extra) => t.w.aplicarFiltroProyectos(lista, { empresa: '', tipo: '', contratante: '', contratista: '', estado: '', ...extra }).map(p => p.id).join();
    assert(f({}) === 'p1,p2,p3' && f({ empresa: 'e-b' }) === 'p2,p3' && f({ tipo: 'pilotes' }) === 'p2', 'empresa y tipo');
    assert(f({ empresa: 'e-b', contratante: 'C1' }) === 'p3' && f({ empresa: 'e-a', tipo: 'puentes' }) === '', 'AND con los demás filtros');
    const ids = { empresa: 'filtroEmpresa', tipo: 'filtroTipo', contratante: 'filtroContratante', contratista: 'filtroContratista', estado: 'filtroEstado' };
    const filtros = t.w._filtros.filtrosDashboard;
    filtros.empresa = 'e-inexistente';
    t.w.poblarSelectsFiltro(ids, filtros, lista);
    assert(t.el('filtroEmpresa').style.display === '' && opciones(t.el('filtroEmpresa')).join() === ',e-a,e-b', 'empresas presentes: ' + opciones(t.el('filtroEmpresa')));
    assert(opciones(t.el('filtroTipo')).join() === ',fiscalizacion,pilotes,puentes', 'tipos presentes, en el orden del catálogo');
    assert(filtros.empresa === '', 'un filtro que ya no existe en los datos vuelve a «Todas»');
    t.el('filtroTipo').value = 'puentes';
    t.w.leerFiltrosDeSelects(ids, filtros);
    assert(filtros.tipo === 'puentes', 'leerFiltrosDeSelects lee el tipo');
    const barra = t.w.barraFiltroEmpresaTipo('filtrosCartera', 'cargarCartera()', lista, t.w._filtros.filtrosCartera);
    assert(barra.includes('filtrosCartera.empresa=this.value;cargarCartera()') && barra.includes('>Beta<') && barra.includes('>Pilotes<'), 'barra de Cartera');
    assert(/Pilotes/.test(t.w.textoBusquedaProyecto(lista[1])) && /BET/.test(t.w.textoBusquedaProyecto(lista[1])) && /ALF-FIS-2026-001/.test(t.w.textoBusquedaProyecto(lista[0])), 'el buscador encuentra por sigla, tipo y código');
    t.cerrar();
  });

  await prueba('distintivo: sigla sobre el color de la gestora; color inválido cae en gris; código y tipo en la línea secundaria', () => {
    const t = montar();
    const [p1, p2] = PROYECTOS();
    assert(t.w.distintivoEmpresa(p1).includes('background:#0073ea') && t.w.distintivoEmpresa(p1).includes('>ALF<'), t.w.distintivoEmpresa(p1));
    assert(t.w.bordeEmpresa(p2) === 'border-left:4px solid #00854d;', t.w.bordeEmpresa(p2));
    assert(t.w.colorEmpresa(EMPRESAS()[2]) === '#676879', 'color que no es #rrggbb → gris (no se inyecta en el estilo)');
    assert(t.w.codigoTipoTexto(p1) === 'ALF-FIS-2026-001 · Fiscalización' && t.w.codigoTipoTexto(p2) === 'Pilotes', 'código y tipo');
    assert(t.w.distintivoEmpresa({ empresa_id: 'no-existe' }) === '', 'empresa desconocida: sin distintivo');
    t.cerrar();
  });

  await prueba('pantalla Empresas: solo admin global; lista, valida y guarda; refresca el catálogo', async () => {
    const no = montar({ perfil: { id: 'u2', rol: 'admin', rolGlobal: null, empresa_id: 'e-b' } });
    await no.w.cargarEmpresasAdmin();
    assert(/Solo el administrador global/.test(no.el('empresasContent').textContent), 'bloqueada para quien no es admin global');
    no.cerrar();

    const t = montar();
    await t.w.cargarEmpresasAdmin();
    const txt = t.el('empresasContent').textContent;
    assert(/Alfa/.test(txt) && /Beta/.test(txt) && /Gama/.test(txt) && !/Vieja/.test(txt), 'lista las empresas con sigla (no las filas viejas)');
    assert(/Solo emisor/.test(txt) && /emite 1/.test(txt) && /sin logo/.test(txt), 'papel, proyectos que emite y aviso de logo faltante');
    t.w.abrirFormEmpresa('nueva');
    t.el('empNombre').value = 'Delta'; t.el('empSigla').value = 'd';
    await t.w.guardarEmpresa();
    assert(/La sigla debe tener/.test(t.toasts().at(-1).msg) && t.fixture.empresas.length === 4, 'sigla inválida: no guarda');
    assert(t.el('empGestora').checked === false, 'en «Nueva empresa» la casilla Gestora no viene marcada');
    t.el('empSigla').value = 'del';
    for(const malo of ['123', '09933798960', '099337989600', '0993379896-001', '09933798960011']){
      t.el('empRuc').value = malo;
      await t.w.guardarEmpresa();
      assert(/RUC/.test(t.toasts().at(-1).msg) && t.fixture.empresas.length === 4, 'RUC inválido «' + malo + '»: no guarda');
    }
    t.el('empRuc').value = '0990000000009'; t.el('empRazon').value = 'Delta Construcciones S.A.'; t.el('empGestora').checked = true;
    await t.w.guardarEmpresa();
    const nueva = t.fixture.empresas.find(e => e.sigla === 'DEL');
    assert(nueva && nueva.nombre === 'Delta' && nueva.razon_social === 'Delta Construcciones S.A.' && nueva.es_gestora && nueva.activa && !('logo_data' in nueva), 'insertada sin tocar el logo: ' + JSON.stringify(nueva));
    assert(t.w.gestorasActivas().some(e => e.sigla === 'DEL') && /Delta/.test(t.el('empresasContent').textContent), 'el catálogo y la lista se refrescan');
    // Editar: quitar de gestora una empresa con proyectos pide confirmación
    t.w.abrirFormEmpresa('e-b');
    assert(t.el('empNombre').value === 'Beta' && t.el('empSigla').value === 'BET' && t.el('empColor').value === '#00854d', 'el formulario carga la empresa');
    t.el('empGestora').checked = false;
    await t.w.guardarEmpresa();
    assert(/gestiona 2 proyecto/.test(t.w._confirmaciones.at(-1)), 'avisa de los proyectos que gestiona');
    assert(t.fixture.empresas.find(e => e.id === 'e-b').es_gestora === false && t.fixture.empresas.find(e => e.id === 'e-b').logo_data === 'data:image/png;base64,QkJC', 'guarda el cambio y conserva el logo');
    t.cerrar();
  });

  await prueba('RUC: validación de estructura, sin dígito verificador (el de HIDIVO no cumple módulo 11 y es válido)', async () => {
    // Módulo 11 de sociedades (coeficientes 4,3,2,7,6,5,4,3,2): 0993379896001 da 1 y su décimo dígito es 6.
    const mod11 = r => { const c = [4,3,2,7,6,5,4,3,2]; const s = c.reduce((a, k, i) => a + k * +r[i], 0); const d = 11 - (s % 11); return d === 11 ? 0 : d; };
    assert(mod11('0993379896001') !== 6 && mod11('0990521786001') === 6, 'el RUC de HIDIVO no cumple módulo 11; el de CIPORT sí');
    assert(!/mod(ulo)?\s*11|% ?11/i.test(extraerFuncion(src, 'guardarEmpresa')), 'guardarEmpresa no calcula dígito verificador');
    const t = montar();
    await t.w.cargarEmpresasAdmin();
    for(const [sigla, ruc] of [['HDZ', '0993379896001'], ['CIZ', '0990521786001'], ['CED', '0912345678']]){
      t.w.abrirFormEmpresa('nueva');
      t.el('empNombre').value = 'Empresa ' + sigla; t.el('empSigla').value = sigla; t.el('empRuc').value = ruc;
      await t.w.guardarEmpresa();
      const fila = t.fixture.empresas.find(e => e.sigla === sigla);
      assert(fila && fila.ruc === ruc && t.toasts().at(-1).tipo === 'success', 'RUC ' + ruc + ' aceptado y guardado tal cual: ' + JSON.stringify(t.toasts().at(-1)));
      assert(fila.es_gestora === false, 'una empresa nueva no nace como gestora si no se marca');
    }
    t.cerrar();
  });

  await prueba('gestoras: no se puede dejar la plataforma sin ninguna; una segunda pide confirmación', async () => {
    const una = montar({ empresas: EMPRESAS().filter(e => e.id !== 'e-b'), confirmar: false });
    await una.w.cargarEmpresasAdmin();
    una.w.abrirFormEmpresa('e-a'); una.el('empActiva').checked = false;
    await una.w.guardarEmpresa();
    assert(/al menos una empresa gestora activa/.test(una.toasts().at(-1).msg) && una.fixture.empresas.find(e => e.id === 'e-a').activa === true, 'la única gestora no se puede desactivar');
    una.w.abrirFormEmpresa('nueva'); una.el('empNombre').value = 'Nueva'; una.el('empSigla').value = 'NUE'; una.el('empGestora').checked = true;
    await una.w.guardarEmpresa();
    assert(/2 gestoras activas/.test(una.w._confirmaciones.at(-1)) && !una.fixture.empresas.some(e => e.sigla === 'NUE'), 'segunda gestora: avisa y, si se cancela, no guarda');
    una.w.abrirFormEmpresa('nueva'); una.el('empNombre').value = 'Emisora'; una.el('empSigla').value = 'EMI';
    const antes = una.w._confirmaciones.length;
    await una.w.guardarEmpresa();
    assert(una.fixture.empresas.some(e => e.sigla === 'EMI' && e.es_gestora === false) && una.w._confirmaciones.length === antes, 'una empresa solo emisora se crea sin aviso');
    una.cerrar();
  });

  resumen();
})();
