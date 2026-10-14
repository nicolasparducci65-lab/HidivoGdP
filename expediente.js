// expediente.js — Expediente de obra de HidivoGdP.
//
// Se carga en index.html DESPUÉS de constantes.js y ANTES del script principal.
// Contiene, en este orden:
//   1) Formateadores canónicos de los documentos (fmtUSD, expEsc).
//   2) Renderers puros de los documentos que ya existían (orden de cambio formal,
//      acta de recepción, liquidación): reciben datos y devuelven HTML. Las
//      funciones de impresión de index.html los llaman y abren la ventana como
//      siempre; el expediente los incrusta.
//   3) El expediente: carga de datos, estimación, generación del documento
//      (función pura, pensada para ejecutarse también en Puppeteer en la fase 3)
//      y vista previa.
//
// Regla: nada de aquí toca window, document ni la red, salvo las funciones
// marcadas como de navegador (expedienteCargarDatos, expedientePrevisualizar).

// ── 1) Formateadores ─────────────────────────────────────────────────────────
// Dinero: dos decimales siempre, separadores de Ecuador y signo "−$" para los
// negativos. Es exactamente el `f` que usaban imprimirOC e imprimirLiquidacion.
function fmtUSD(v){
  return (v<0?'−$':'$') + Math.abs(v||0).toLocaleString('es-EC',{minimumFractionDigits:2,maximumFractionDigits:2});
}
// Escapa texto para HTML (nodos de texto). Es exactamente el `e` de las impresiones.
function expEsc(s){
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── 2) Renderers de documentos existentes ────────────────────────────────────

// ── Orden de cambio: documento formal ───────────────────────────────────────
// ctx = { oc, items, rubrosMap, perfMap, proy, montoContrato, fechaTexto }.
// rubrosMap: {id → rubro} de los rubros referenciados por los ítems; perfMap:
// {id → "Nombre Apellido"} de creado_por/aprobado_por; montoContrato: Σ rubros
// vigente; fechaTexto: fecha de generación ya formateada (la pone quien llama).
function ocPartes(ctx){
  const { oc, items, rubrosMap, perfMap, proy, montoContrato, fechaTexto } = ctx;
  const codigoOC = `OC-${String(oc.numero).padStart(2,'0')}`;
  const esBorrador = oc.estado==='borrador';
  const f = fmtUSD;
  const e = expEsc;

  const filasItems = (items||[]).map((it,i)=>{
    const r = it.rubro_id ? rubrosMap[it.rubro_id] : null;
    const desc = it.tipo==='nuevo' ? it.descripcion : (r ? `${r.codigo} — ${r.descripcion}` : '(rubro)');
    const cod = it.tipo==='nuevo' ? (it.codigo||'—') : (r?.codigo||'—');
    const und = it.tipo==='nuevo' ? (it.unidad||'—') : (r?.unidad||'—');
    return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e6e9ef;font-size:11px;text-align:center">${i+1}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e6e9ef;font-size:11px;text-align:center">${it.tipo==='nuevo'?'Rubro nuevo':'Modif. cantidad'}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e6e9ef;font-size:11px">${e(cod)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e6e9ef;font-size:11px">${e(desc)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e6e9ef;font-size:11px;text-align:center">${e(und)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e6e9ef;font-size:11px;text-align:right">${f(it.precio_unitario)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e6e9ef;font-size:11px;text-align:right;font-weight:600">${(it.cantidad||0)>0&&it.tipo==='modificacion'?'+':''}${(it.cantidad||0).toLocaleString('es-EC')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e6e9ef;font-size:11px;text-align:right;font-weight:700;color:${(it.monto||0)>=0?'#323338':'#e2445c'}">${f(it.monto)}</td>
    </tr>`;
  }).join('');

  return { oc, items, rubrosMap, perfMap, proy, montoContrato, fechaTexto, codigoOC, esBorrador, f, e, filasItems };
}

// Cuerpo del documento (encabezado, datos, tabla, resumen y firmas): lo que el
// expediente incrusta por cada orden de cambio.
function ocCuerpoHTML(ctx){
  const { oc, perfMap, proy, montoContrato, fechaTexto, codigoOC, esBorrador, f, e, filasItems } = ocPartes(ctx);
  return `
      <div class="encabezado">
        <div style="display:flex;align-items:center;gap:16px">
          <img src="${LOGO_URL}" alt="HiDiVo"/>
          <div>
            <h1>ORDEN DE CAMBIO ${codigoOC}</h1>
            <div class="sub">${e(oc.titulo)} — Generado: ${fechaTexto}</div>
          </div>
        </div>
        ${esBorrador?'<span class="marca-borrador">BORRADOR</span>':oc.estado==='aprobada'?'<span class="marca-borrador" style="color:#00854d;border-color:#00854d">APROBADA</span>':''}
      </div>
      <div class="grid-info">
        <div class="info-box"><div class="info-label">Proyecto</div><div class="info-value">${e(proy?.nombre||'')}</div></div>
        <div class="info-box"><div class="info-label">Contratante</div><div class="info-value">${e(proy?.contratante||'—')}</div></div>
        <div class="info-box"><div class="info-label">Contratista</div><div class="info-value">${e(proy?.contratista||'—')}</div></div>
      </div>
      ${oc.justificacion?`<div style="background:#f5f6f8;border-radius:8px;padding:12px 14px;margin-bottom:12px"><div class="info-label">Justificación técnica</div><div style="font-size:12px;white-space:pre-line;margin-top:4px">${e(oc.justificacion)}</div></div>`:''}
      ${oc.estado==='aprobada'?`<div style="font-size:12px;margin-bottom:10px;color:#00854d"><b>Aprobada</b> — Oficio: ${e(oc.oficio_referencia||'—')} · Fecha: ${oc.fecha_aprobacion||'—'}${perfMap[oc.aprobado_por]?' · Registrado por: '+e(perfMap[oc.aprobado_por]):''}</div>`:''}
      <table>
        <thead><tr><td>#</td><td>Tipo</td><td>Cód.</td><td>Descripción</td><td style="text-align:center">Und.</td><td style="text-align:right">P. Unitario</td><td style="text-align:right">Cantidad</td><td style="text-align:right">Monto</td></tr></thead>
        <tbody>${filasItems||'<tr><td colspan="8" style="padding:12px;text-align:center;color:#676879">Sin ítems</td></tr>'}</tbody>
      </table>
      <div class="resumen">
        <div><span>Monto contractual vigente</span><b>${f(montoContrato)}</b></div>
        <div><span>Impacto de esta orden</span><b style="color:${(oc.monto_total||0)>=0?'#00854d':'#e2445c'}">${f(oc.monto_total)}</b></div>
        <div style="border-bottom:2px solid #1a1a2e"><span><b>Monto resultante</b></span><b>${f(montoContrato + (oc.estado==='aprobada'?0:(oc.monto_total||0)))}</b></div>
      </div>
      <div class="firmas">
        <div class="firma-box"><div class="linea-firma"></div><div class="firma-rol">Fiscalización</div><div class="firma-nombre">${e(perfMap[oc.creado_por]||'')}</div></div>
        <div class="firma-box"><div class="linea-firma"></div><div class="firma-rol">Contratista</div><div class="firma-nombre">${e(proy?.contratista||'')}</div></div>
        <div class="firma-box"><div class="linea-firma"></div><div class="firma-rol">Contratante</div><div class="firma-nombre">${e(proy?.contratante||'')}</div></div>
      </div>
    `;
}

// Documento HTML completo (el que imprime imprimirOC).
function ocDocumentoHTML(ctx){
  const { oc, codigoOC, e } = ocPartes(ctx);
  return `
    <html><head><title>${codigoOC} — ${e(oc.titulo)}</title>
    <style>
      body{font-family:Arial,sans-serif;color:#323338;padding:24px;max-width:900px;margin:0 auto}
      .encabezado{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:3px solid #0073ea;padding-bottom:12px;margin-bottom:16px}
      .encabezado img{height:56px;object-fit:contain}
      h1{font-size:18px;color:#0073ea;margin:0 0 4px 0}
      .sub{font-size:11px;color:#676879;margin:0}
      .grid-info{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px}
      .info-box{background:#f5f6f8;border-radius:6px;padding:8px 10px}
      .info-label{font-size:9px;color:#676879;letter-spacing:.5px;text-transform:uppercase}
      .info-value{font-size:12px;font-weight:700}
      .marca-borrador{color:#b8860b;border:2px dashed #b8860b;border-radius:8px;padding:4px 14px;font-weight:800;font-size:13px}
      table{width:100%;border-collapse:collapse;margin-top:6px}
      thead td{background:#1a1a2e;color:#fff;font-size:10px;font-weight:700;padding:7px 8px}
      .resumen{margin-top:14px;margin-left:auto;width:320px;font-size:12px}
      .resumen div{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #e6e9ef}
      .firmas{display:flex;justify-content:space-between;gap:16px;margin-top:64px;page-break-inside:avoid}
      .firma-box{flex:1;text-align:center}
      .linea-firma{border-top:1px solid #323338;margin-bottom:6px}
      .firma-rol{font-size:12px;font-weight:700}
      .firma-nombre{font-size:11px;color:#676879}
      @media print{ body{padding:0} }
    </style></head>
    <body>` + ocCuerpoHTML(ctx) + `</body></html>
  `;
}

// ── Acta de recepción provisional/definitiva (cuerpo) ────────────────────────
// a: fila de actas_recepcion; proy: fila de proyectos. Deriva el texto de la
// fecha de a.fecha (dato), no de la hora actual.
function actaCuerpoHTML(a, proy){
  const e = expEsc;
  return `
    <p style="font-size:13px;line-height:1.7">En ${e(a.lugar||'________')}, a los ${new Date(a.fecha+'T00:00:00').toLocaleDateString('es-EC',{day:'numeric',month:'long',year:'numeric'})}, se reúnen las partes para la recepción ${a.tipo} de la obra <b>${e(proy?.nombre||'')}</b>, contratada por <b>${e(proy?.contratante||'________')}</b> y ejecutada por <b>${e(proy?.contratista||'________')}</b>.</p>
    ${a.asistentes?`<p style="font-size:13px"><b>Asistentes:</b><br>${e(a.asistentes).replace(/\n/g,'<br>')}</p>`:''}
    ${a.observaciones?`<p style="font-size:13px"><b>Observaciones por subsanar:</b><br>${e(a.observaciones).replace(/\n/g,'<br>')}</p>`:''}
    <p style="font-size:13px;line-height:1.7">Las partes suscriben la presente acta en señal de conformidad.</p>`;
}

// ── Liquidación final de obra (cuerpo) ───────────────────────────────────────
// liq: fila de liquidaciones (datos jsonb calculado por generarLiquidacion).
function liquidacionCuerpoHTML(liq, proy){
  const d = liq.datos||{};
  const f = fmtUSD;
  const fila = (k,v,b) => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #e6e9ef;font-size:13px${b?';font-weight:700':''}"><span>${k}</span><span>${f(v)}</span></div>`;
  return `
    <div style="max-width:460px;margin:0 auto">
      ${fila('Monto contractual original', d.monto_contrato_original)}
      ${fila('Órdenes de cambio aprobadas', d.monto_ocs_aprobadas)}
      ${fila('Monto contractual vigente', d.monto_contrato_vigente, true)}
      ${fila('Total planillado (bruto)', d.total_planillado)}
      ${fila('Reajustes de precios', d.total_reajustes)}
      ${fila('Anticipo entregado', d.anticipo_entregado)}
      ${fila('Anticipo amortizado', d.anticipo_amortizado)}
      ${fila('Anticipo por amortizar', d.anticipo_por_amortizar)}
      ${fila('Retenciones acumuladas (por devolver)', d.retenciones_acumuladas)}
      ${fila('Multas aplicadas', d.multas)}
      ${fila('Líquido pagado en planillas', d.liquido_pagado)}
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:3px double #1a1a2e;font-size:15px;font-weight:800;margin-top:6px"><span>SALDO FINAL A FAVOR DEL CONTRATISTA</span><span>${f(d.saldo_final)}</span></div>
    </div>
    <p style="font-size:12px;color:#676879;margin-top:14px">Saldo final = retenciones por devolver − anticipo no amortizado. Fecha de liquidación: ${liq.fecha}.</p>`;
}

// ── Documento de cierre editable (acta o liquidación para imprimir) ──────────
// firmas: [[rol, nombre], ...]; fechaTexto: fecha de generación formateada.
// Lleva <body contenteditable>: es el borrador editable de la impresión suelta.
// El expediente NO lo usa; incrusta solo los cuerpos (actaCuerpoHTML, etc.).
function docCierreHTML(titulo, proy, cuerpoHtml, firmas, fechaTexto){
  const e = expEsc;
  return `<html><head><title>${e(titulo)} — ${e(proy?.nombre||'')}</title>
    <style>body{font-family:Arial,sans-serif;color:#323338;padding:28px;max-width:800px;margin:0 auto}
    .enc{display:flex;align-items:center;gap:16px;border-bottom:3px solid #0073ea;padding-bottom:12px;margin-bottom:18px}
    .enc img{height:52px}h1{font-size:17px;color:#0073ea;margin:0}
    .firmas{display:flex;justify-content:space-between;gap:16px;margin-top:80px;page-break-inside:avoid}
    .fb{flex:1;text-align:center}.lf{border-top:1px solid #323338;margin-bottom:6px}
    .nota-edicion{background:#fdf6e3;color:#b8860b;border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:14px}
    @media print{.nota-edicion{display:none}body{padding:0}}</style></head>
    <body contenteditable="true">
    <div class="enc"><img src="${LOGO_URL}"/>
      <div><h1>${e(titulo)}</h1><div style="font-size:11px;color:#676879">${e(proy?.nombre||'')} — ${fechaTexto}</div></div></div>
    <div class="nota-edicion">✏️ Este borrador es editable: haz clic sobre cualquier texto para ajustarlo antes de imprimir (Ctrl+P). Esta nota no sale en el PDF.</div>
    ${cuerpoHtml}
    <div class="firmas">${firmas.map(fi=>`<div class="fb"><div class="lf"></div><div style="font-size:12px;font-weight:700">${e(fi[0])}</div><div style="font-size:11px;color:#676879">${e(fi[1])}</div></div>`).join('')}</div>
    </body></html>`;
}

// Firmantes de los documentos de cierre (mismo orden en acta y liquidación).
function firmasCierre(proy){
  return [['Fiscalización',''],['Contratista',proy?.contratista||''],['Contratante',proy?.contratante||'']];
}
