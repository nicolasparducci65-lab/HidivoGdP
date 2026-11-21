// Campana: aviso de la exportación diaria del estado (notificaciones.tipo = 'exportacion_estado').
// Ejecuta el código REAL de index.html (cargarNotificacionesGlobales, totalNotificaciones,
// renderPanelNotificaciones) con datos sintéticos.
//
//   node campana-exportacion.test.js
'use strict';
const path = require('path');
const { RAIZ, scriptPrincipal, extraerFuncion, crearSb, crearContexto, prueba, resumen, assert } = require('./lib/arnes');

const src = scriptPrincipal();
const AHORA = '2026-11-21T11:00:00Z';              // 06:00 en Ecuador
const HOY_0520 = '2026-11-21T10:20:00Z';           // aviso del vigilante de hoy
const AYER = '2026-11-20T10:20:00Z';
const AVISO = (extra = {}) => ({ id: 'n1', perfil_id: 'u-admin', tipo: 'exportacion_estado',
  titulo: 'ZZZ La exportación diaria falló', mensaje: 'ZZZ Falló el paso <Subir a Drive>', created_at: HOY_0520, ...extra });

function contexto({ notificaciones = [], perfil = { rolGlobal: 'admin' }, usuario = 'u-admin', extra = {} } = {}){
  const fixture = { proyectos: [], proyecto_miembros: [], canales_chat: [], notificaciones, ...extra };
  const sb = crearSb(fixture);
  const elementos = {
    notiBadge: { style: {}, textContent: '' },
    panelNotificaciones: { style: { display: 'none' }, innerHTML: '' },
    selectProyecto: { options: [] }
  };
  const ctx = crearContexto({
    fecha: AHORA,
    codigo: [
      { ruta: path.join(RAIZ, 'constantes.js'), nombre: 'constantes.js' },
      { ruta: path.join(RAIZ, 'expediente.js'), nombre: 'expediente.js' },
      'let notiDatos = null;\n' +
      ['hoyEcuador', 'cargarNotificacionesGlobales', 'totalNotificaciones', 'pintarBadgeNotificaciones', 'nombreProyectoNoti', 'renderPanelNotificaciones']
        .map(f => extraerFuncion(src, f)).join('\n')
    ],
    globals: { sb, currentUser: { id: usuario }, currentPerfil: perfil, esAdminDeEmpresa: () => false,
      document: { getElementById: id => elementos[id] || null } }
  });
  return { ctx, sb, elementos };
}

(async () => {
  await prueba('el admin global ve el aviso de hoy: título y mensaje en el panel, y cuenta 1 en el globo', async () => {
    const { ctx, elementos } = contexto({ notificaciones: [AVISO()] });
    await ctx.cargarNotificacionesGlobales();
    assert(ctx._eval('notiDatos.avisoExport') !== null, 'no cargó el aviso');
    assert(ctx.totalNotificaciones() === 1, 'el globo debía contar 1 y cuenta ' + ctx.totalNotificaciones());
    assert(elementos.notiBadge.style.display === 'flex' && elementos.notiBadge.textContent === 1, 'el globo no se pintó');
    ctx.renderPanelNotificaciones();
    const h = elementos.panelNotificaciones.innerHTML;
    assert(h.includes('Exportación diaria del estado'), 'falta el encabezado');
    assert(h.includes('ZZZ La exportación diaria falló'), 'falta el título');
    assert(h.includes('ZZZ Falló el paso &lt;Subir a Drive&gt;'), 'el mensaje no aparece escapado: ' + h);
    assert(!h.includes('No tienes pendientes'), 'no debía decir que no hay pendientes');
  });

  await prueba('un aviso de ayer no se muestra', async () => {
    const { ctx, elementos } = contexto({ notificaciones: [AVISO({ created_at: AYER })] });
    await ctx.cargarNotificacionesGlobales();
    assert(ctx._eval('notiDatos.avisoExport') === null, 'mostró un aviso viejo');
    assert(ctx.totalNotificaciones() === 0, 'el globo debía quedar en 0');
    ctx.renderPanelNotificaciones();
    assert(elementos.panelNotificaciones.innerHTML.includes('No tienes pendientes'), 'debía decir que no hay pendientes');
  });

  await prueba('con varios avisos de hoy se muestra el más reciente', async () => {
    const { ctx, elementos } = contexto({ notificaciones: [
      AVISO({ id: 'n1', titulo: 'ZZZ primero', created_at: '2026-11-21T08:15:00Z' }),
      AVISO({ id: 'n2', titulo: 'ZZZ segundo', created_at: '2026-11-21T09:25:00Z' })
    ] });
    await ctx.cargarNotificacionesGlobales();
    ctx.renderPanelNotificaciones();
    const h = elementos.panelNotificaciones.innerHTML;
    assert(h.includes('ZZZ segundo') && !h.includes('ZZZ primero'), 'no mostró el más reciente');
    assert(ctx.totalNotificaciones() === 1, 'debía contar 1 aunque haya dos avisos');
  });

  await prueba('solo se muestra la notificación del propio usuario', async () => {
    const { ctx } = contexto({ notificaciones: [AVISO({ perfil_id: 'u-otro' })] });
    await ctx.cargarNotificacionesGlobales();
    assert(ctx._eval('notiDatos.avisoExport') === null, 'mostró el aviso de otro usuario');
  });

  await prueba('quien no es admin global no consulta ni ve el aviso', async () => {
    const { ctx, sb } = contexto({ notificaciones: [AVISO({ perfil_id: 'u-fis' })], perfil: { rolGlobal: 'usuario' }, usuario: 'u-fis' });
    await ctx.cargarNotificacionesGlobales();
    assert(ctx._eval('notiDatos.avisoExport') === null, 'un no admin vio el aviso');
    assert(sb.llamadas.filter(l => l.tabla === 'notificaciones').length === 1, 'debía consultar notificaciones una sola vez (resumen de cartera)');
  });

  await prueba('el resumen de cartera de hoy sigue apareciendo y no suma al globo', async () => {
    const { ctx, elementos } = contexto({ notificaciones: [
      { id: 'r1', perfil_id: 'u-admin', tipo: 'resumen_cartera', titulo: 'ZZZ Resumen de cartera', mensaje: 'ZZZ', created_at: '2026-11-21T12:00:00Z' }
    ] });
    await ctx.cargarNotificacionesGlobales();
    assert(ctx._eval('notiDatos.resumenHoy') !== null && ctx._eval('notiDatos.avisoExport') === null, 'mezcló los dos tipos');
    assert(ctx.totalNotificaciones() === 0, 'el resumen no debe sumar al globo');
    ctx.renderPanelNotificaciones();
    const h = elementos.panelNotificaciones.innerHTML;
    assert(h.includes('Resumen del día') && h.includes('ZZZ Resumen de cartera'), 'el resumen dejó de mostrarse');
    assert(!h.includes('Exportación diaria del estado'), 'apareció el bloque del aviso sin aviso');
  });

  await prueba('corrida degradada: el aviso sale con su propio título («salió incompleta») y cuenta 1 en el globo', async () => {
    const { ctx, elementos } = contexto({ notificaciones: [AVISO({
      titulo: 'La exportación diaria del estado salió incompleta',
      mensaje: 'ZZZ Corrida degradada: 4 bloques sin calcular; resumen parcial (corrida 123). Los archivos de hoy sí están en Drive, pero les faltan partes que no se pudieron calcular.' })] });
    await ctx.cargarNotificacionesGlobales();
    assert(ctx.totalNotificaciones() === 1, 'el globo debía contar 1');
    ctx.renderPanelNotificaciones();
    const h = elementos.panelNotificaciones.innerHTML;
    assert(h.includes('La exportación diaria del estado salió incompleta'), 'falta el título de la corrida degradada');
    assert(h.includes('4 bloques sin calcular') && h.includes('sí están en Drive'), 'falta el mensaje');
    assert(!h.includes('La exportación diaria falló'), 'usó el título por defecto en lugar del que trae el aviso');
  });

  await prueba('el mensaje se parte aunque traiga una palabra larguísima (overflow-wrap) y no se convierte en enlace', async () => {
    const { ctx, elementos } = contexto({ notificaciones: [AVISO({ mensaje: 'ZZZ ' + 'x'.repeat(300) })] });
    await ctx.cargarNotificacionesGlobales();
    ctx.renderPanelNotificaciones();
    const h = elementos.panelNotificaciones.innerHTML;
    const m = /<div style="([^"]*)">ZZZ x{300}<\/div>/.exec(h);
    assert(m, 'no se encontró el bloque del mensaje');
    assert(/overflow-wrap:\s*anywhere/.test(m[1]), 'el bloque del mensaje no parte las palabras largas: ' + m[1]);
    assert(!/<a\s/i.test(h.slice(h.indexOf('Exportación diaria del estado'))), 'el aviso no debe llevar enlaces');
  });

  await prueba('decisión aceptada: el aviso no se puede descartar; aunque esté marcado como leído se sigue mostrando hasta la siguiente corrida buena', async () => {
    const { ctx, elementos } = contexto({ notificaciones: [AVISO({ leida: true })] });
    await ctx.cargarNotificacionesGlobales();
    assert(ctx._eval('notiDatos.avisoExport') !== null && ctx.totalNotificaciones() === 1, 'un aviso leído dejó de mostrarse: si esto cambia, hay que actualizar la GUIA (sección 7)');
    ctx.renderPanelNotificaciones();
    const bloque = elementos.panelNotificaciones.innerHTML;
    const desde = bloque.indexOf('Exportación diaria del estado');
    assert(desde >= 0, 'falta el bloque');
    assert(!/onclick=/.test(bloque.slice(desde, bloque.indexOf('ZZZ La exportación diaria falló') + 40)), 'el bloque del aviso no debía tener acciones');
    // Cuando la función de la base borra el aviso (corrida buena), deja de verse
    const { ctx: ctx2 } = contexto({ notificaciones: [] });
    await ctx2.cargarNotificacionesGlobales();
    assert(ctx2._eval('notiDatos.avisoExport') === null && ctx2.totalNotificaciones() === 0, 'sin avisos en la tabla no debe mostrarse nada');
  });

  resumen();
})();
