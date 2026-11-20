// Emisor documental (multiempresa): emisorDeProyecto() y los documentos que lo usan.
// Ejecuta el código REAL de constantes.js, expediente.js e index.html (imprimirActa,
// abrirVentanaDocCierre) con empresas ficticias.
//
//   node emisor.test.js
'use strict';
const path = require('path');
const { RAIZ, scriptPrincipal, extraerFuncion, crearSb, crearContexto, prueba, resumen, assert } = require('./lib/arnes');

const src = scriptPrincipal();
const LOGO_B = 'data:image/png;base64,QkJC';
const LOGO_C = 'data:image/png;base64,Q0ND';
const EMPRESAS = [
  { id: 'e-plat', nombre: 'HIDIVO', sigla: 'HDV', razon_social: null, ruc: null, color: '#0073ea', logo_data: null, es_gestora: true, activa: true },
  { id: 'e-b', nombre: 'Gestora B', sigla: 'GEB', razon_social: 'Gestora B Construcciones S.A.', ruc: '0990000000001', color: '#00854d', logo_data: LOGO_B, es_gestora: true, activa: true },
  { id: 'e-c', nombre: 'Emisor C', sigla: 'EMC', razon_social: 'Emisor C & Hijos "Obras" S.A.', ruc: '0990000000002', color: null, logo_data: LOGO_C, es_gestora: false, activa: true },
  { id: 'e-sin', nombre: 'Sin Logo', sigla: 'SLG', razon_social: 'Sin Logo Cía. Ltda.', ruc: null, color: null, logo_data: null, es_gestora: true, activa: true }
];
const PROY = (extra = {}) => ({ id: 'p1', nombre: 'Proyecto de prueba', contratante: 'Cliente', contratista: 'Contratista', empresa_id: 'e-b', emisor_empresa_id: null, tipo: 'pilotes', ...extra });
const OC = { id: 'oc1', numero: 3, titulo: 'Cambio de prueba', estado: 'aprobada', fecha_aprobacion: '2026-05-10', monto_total: 0 };

function contexto(fixture = {}){
  const sb = crearSb(fixture);
  const ctx = crearContexto({
    codigo: [
      { ruta: path.join(RAIZ, 'constantes.js'), nombre: 'constantes.js' },
      { ruta: path.join(RAIZ, 'expediente.js'), nombre: 'expediente.js' },
      ['imprimirActa', 'abrirVentanaDocCierre', 'obtenerLogoDataUri'].map(f => extraerFuncion(src, f)).join('\n')
    ],
    globals: { sb, currentProyecto: 'p1', currentPerfil: { rol: 'visualizador' } }
  });
  return ctx;
}
const ocHtml = (ctx, proy, oc = OC) => ctx.ocDocumentoHTML({ oc, items: [], rubrosMap: {}, perfMap: {}, proy, montoContrato: 1000, fechaTexto: '14 de octubre de 2026' });
const cierreHtml = (ctx, proy, emisor) => ctx.docCierreHTML('ACTA DE PRUEBA', proy, '<p>cuerpo</p>', [['Fiscalización', '']], '14 de octubre de 2026', null, emisor);

(async () => {
  console.log('emisor.test.js');

  await prueba('sin catálogo de empresas: emite la plataforma con el logo vendorizado (comportamiento anterior)', () => {
    const ctx = contexto();
    const logoUrl = ctx._eval('LOGO_URL');
    const em = ctx.emisorDeProyecto(PROY());
    assert(em.porDefecto && em.nombre === 'HIDIVO' && em.logo === logoUrl && em.razonSocial === '' && em.ruc === '', 'emisor por defecto: ' + JSON.stringify(em));
    assert(ctx.emisorDeProyecto(null).porDefecto, 'sin proyecto también cae en la plataforma');
    const html = cierreHtml(ctx, PROY());
    assert(html.includes(`<div class="enc"><img src="${logoUrl}"/>`), 'docCierre con el logo vendorizado');
    assert(!/RUC/.test(html), 'sin línea legal cuando no hay razón social ni RUC');
  });

  await prueba('emisor por defecto = la gestora del proyecto: logo, razón social y RUC en OC, cierre y expediente', () => {
    const ctx = contexto();
    ctx.fijarEmpresas(EMPRESAS);
    const em = ctx.emisorDeProyecto(PROY());
    assert(em.id === 'e-b' && em.logo === LOGO_B && em.razonSocial === 'Gestora B Construcciones S.A.' && em.ruc === '0990000000001' && em.color === '#00854d', JSON.stringify(em));
    const oc = ocHtml(ctx, PROY());
    assert(oc.includes(`<img src="${LOGO_B}" alt="Gestora B"/>`), 'OC con el logo de la gestora');
    assert(oc.includes('Gestora B Construcciones S.A. · RUC 0990000000001'), 'OC con la línea legal');
    assert(!/hidivo/i.test(oc), 'la OC no menciona a la plataforma');
    const cierre = cierreHtml(ctx, PROY());
    assert(cierre.includes(`<img src="${LOGO_B}"/>`) && cierre.includes('Gestora B Construcciones S.A. · RUC 0990000000001'), 'docCierre con logo y línea legal');
    assert(!/hidivo/i.test(cierre), 'el documento de cierre no menciona a la plataforma');
  });

  await prueba('la gestora de la plataforma sin logo cargado usa el vendorizado; con logo cargado, el suyo', () => {
    const ctx = contexto();
    ctx.fijarEmpresas(EMPRESAS);
    assert(ctx.emisorDeProyecto(PROY({ empresa_id: 'e-plat' })).logo === ctx._eval('LOGO_URL'), 'plataforma sin logo_data → LOGO_URL');
    ctx.fijarEmpresas(EMPRESAS.map(x => x.id === 'e-plat' ? { ...x, logo_data: 'data:image/png;base64,UFBQ' } : x));
    assert(ctx.emisorDeProyecto(PROY({ empresa_id: 'e-plat' })).logo === 'data:image/png;base64,UFBQ', 'plataforma con logo_data → el cargado');
  });

  await prueba('emisor distinto de la gestora: los documentos salen a nombre del emisor', () => {
    const ctx = contexto();
    ctx.fijarEmpresas(EMPRESAS);
    const proy = PROY({ emisor_empresa_id: 'e-c' });
    const em = ctx.emisorDeProyecto(proy);
    assert(em.id === 'e-c' && em.logo === LOGO_C && em.nombre === 'Emisor C', JSON.stringify(em));
    const oc = ocHtml(ctx, proy);
    assert(oc.includes(`<img src="${LOGO_C}" alt="Emisor C"/>`) && !oc.includes(LOGO_B), 'OC con el logo del emisor, no el de la gestora');
    assert(oc.includes('Emisor C &amp; Hijos "Obras" S.A. · RUC 0990000000002'), 'la razón social se escapa');
    const cierre = cierreHtml(ctx, proy);
    assert(cierre.includes(LOGO_C) && !cierre.includes(LOGO_B) && !cierre.includes('Gestora B'), 'docCierre a nombre del emisor');
  });

  await prueba('emisor sin logo: ningún documento lleva <img> de membrete y conserva la razón social', () => {
    const ctx = contexto();
    ctx.fijarEmpresas(EMPRESAS);
    const proy = PROY({ empresa_id: 'e-sin' });
    const em = ctx.emisorDeProyecto(proy);
    assert(em.logo === '' && em.razonSocial === 'Sin Logo Cía. Ltda.', JSON.stringify(em));
    const oc = ocHtml(ctx, proy);
    assert(!/<img/.test(oc), 'OC sin imagen');
    assert(oc.includes('<h1>ORDEN DE CAMBIO OC-03</h1>') && oc.includes('Sin Logo Cía. Ltda.'), 'OC con título y razón social');
    const cierre = cierreHtml(ctx, proy);
    assert(!/<img/.test(cierre) && cierre.includes('<div class="enc">') && cierre.includes('Sin Logo Cía. Ltda.'), 'docCierre sin imagen, con encabezado');
    assert(ctx.estiloLogoReporte({ logo: LOGO_B }).includes('background:#fff') && ctx.estiloLogoReporte({ logo: ctx._eval('LOGO_URL') }).includes('invert(1)'), 'estilo del logo en reportes');
  });

  await prueba('fecha de corte: un documento anterior al cambio conserva el emisor de entonces', () => {
    const ctx = contexto();
    ctx.fijarEmpresas(EMPRESAS);
    const proy = PROY({ emisor_empresa_id: 'e-c' });            // hoy emite C
    ctx.fijarHistorialEmisor('p1', [
      { empresa_id: 'e-sin', hasta: '2026-03-01', creado_en: '2026-03-01T10:00:00Z' },   // hasta el 1-mar emitía «Sin Logo»
      { empresa_id: 'e-b', hasta: '2026-06-01', creado_en: '2026-06-01T10:00:00Z' }      // del 1-mar al 1-jun emitía B
    ]);
    const de = f => ctx.emisorDeProyecto(proy, f).id;
    assert(de('2026-02-15') === 'e-sin', 'antes del primer corte: ' + de('2026-02-15'));
    assert(de('2026-03-01') === 'e-b', 'el día del corte ya rige el siguiente: ' + de('2026-03-01'));
    assert(de('2026-05-31T23:00:00') === 'e-b', 'acepta fecha con hora');
    assert(de('2026-06-01') === 'e-c' && de('2026-12-01') === 'e-c', 'del último corte en adelante, el vigente');
    assert(de(null) === 'e-c' && de('') === 'e-c', 'sin fecha rige el vigente');
    assert(ocHtml(ctx, proy).includes(LOGO_B), 'la OC aprobada el 10-may sale con el emisor de mayo');
    assert(ocHtml(ctx, proy, { ...OC, estado: 'borrador', fecha_aprobacion: null }).includes(LOGO_C), 'la OC sin aprobar sale con el vigente');
    assert(ctx.emisorDeProyecto({ ...proy, id: 'otro' }, '2026-02-15').id === 'e-c', 'el historial de un proyecto no se aplica a otro');
    ctx.fijarHistorialEmisor(null, []);
    assert(de('2026-02-15') === 'e-c', 'con el historial limpio vuelve al vigente');
  });

  await prueba('imprimirActa (real): el acta sale con el emisor de la fecha del acta', async () => {
    const proy = PROY({ emisor_empresa_id: 'e-c' });
    const ctx = contexto({ proyectos: [proy], actas_recepcion: [{ id: 'a1', proyecto_id: 'p1', tipo: 'provisional', fecha: '2026-05-10', observaciones: '' }] });
    ctx.fijarEmpresas(EMPRESAS);
    ctx.fijarHistorialEmisor('p1', [{ empresa_id: 'e-b', hasta: '2026-06-01' }]);
    await ctx.imprimirActa('a1');
    const html = ctx._ventanas[0].html;
    assert(html.includes(LOGO_B) && !html.includes(LOGO_C), 'acta de mayo con el emisor de mayo');
    assert(html.includes('Gestora B Construcciones S.A. · RUC 0990000000001'), 'con su línea legal');
  });

  await prueba('reporte de varios proyectos: gestora común o, si hay mezcla, la plataforma', () => {
    const ctx = contexto();
    ctx.fijarEmpresas(EMPRESAS);
    assert(ctx.emisorDeLista([PROY(), PROY({ id: 'p2' })]).id === 'e-b', 'misma gestora');
    assert(ctx.emisorDeLista([PROY(), PROY({ id: 'p2', empresa_id: 'e-plat' })]).id === 'e-plat', 'mezcla → plataforma');
    assert(ctx.emisorDeLista([]).id === 'e-plat', 'lista vacía → plataforma');
    assert(ctx.emisorDeLista([PROY({ emisor_empresa_id: 'e-c' })]).id === 'e-b', 'el reporte de cartera es de la gestora, no del emisor de un proyecto');
  });

  await prueba('expediente: sin fiscalizador escrito, la fila Fiscalización es el emisor solo en proyectos de fiscalización', () => {
    const ctx = contexto();
    ctx.fijarEmpresas(EMPRESAS);
    const fuente = require('fs').readFileSync(path.join(RAIZ, 'expediente.js'), 'utf8');
    assert(!/HIDIVO S\.A\.S\./.test(fuente), 'expediente.js ya no trae la razón social fija');
    assert(/proy\.fiscalizador \|\| \(\(!proy\.tipo \|\| proy\.tipo === 'fiscalizacion'\) \? emisorNombreLegal\(emisor\) : '—'\)/.test(fuente), 'regla de la fila Fiscalización');
    assert(ctx.emisorNombreLegal(ctx.emisorDeProyecto(PROY())) === 'Gestora B Construcciones S.A.', 'nombre legal = razón social');
    assert(ctx.emisorNombreLegal(ctx.emisorDeProyecto(PROY({ empresa_id: 'e-plat' }))) === 'HIDIVO', 'sin razón social, el nombre corto');
  });

  await prueba('obtenerLogoDataUri: un logo de empresa pasa tal cual y sin logo devuelve vacío', async () => {
    const ctx = contexto();
    assert(await ctx.obtenerLogoDataUri(LOGO_B) === LOGO_B, 'data URI tal cual');
    assert(await ctx.obtenerLogoDataUri('') === '', 'sin logo → vacío');
  });

  await prueba('invariantes: el historial se limpia al cambiar de proyecto y al cerrar sesión; no queda marca fija en los PDF', () => {
    const limpiar = extraerFuncion(src, 'limpiarEstadoProyecto');
    assert(limpiar.includes('fijarHistorialEmisor(null, [])'), 'limpiarEstadoProyecto limpia el historial del emisor');
    const salir = extraerFuncion(src, 'logout');
    assert(salir.includes('fijarEmpresas([])') && salir.includes('fijarHistorialEmisor(null, [])'), 'logout limpia catálogo e historial');
    for(const f of ['exportarPdfFormato', 'generarReporteDashboard', 'generarReportePDF', 'imprimirOC', 'abrirVentanaDocCierre', 'generarExpediente']){
      const cuerpo = extraerFuncion(src, f);
      assert(!/LOGO_URL|HIDIVO|HiDiVo/.test(cuerpo), f + ' todavía tiene el logo o el nombre fijos');
    }
  });

  resumen();
})();
