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
// Sanitizador mínimo del HTML editado de un acta (se aplica al guardar y al
// renderizar). Sin DOM, por expresiones regulares: quita script, iframe, object,
// embed, style, link, meta y base (con su contenido), los atributos on*, las URLs
// javascript:/vbscript:/data:text/html en href/src/action/formaction/xlink:href,
// srcdoc y los style= con expression() o javascript:. El resto del marcado
// (p, b, div, table, br, img con URL normal) se conserva tal cual.
function sanitizarHtmlActa(html){
  let s = String(html ?? '');
  s = s.replace(/<\s*(script|iframe|object|embed|style|link|meta|base)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  s = s.replace(/<\s*(script|iframe|object|embed|style|link|meta|base)\b[^>]*\/?>/gi, '');
  s = s.replace(/<\s*\/\s*(script|iframe|object|embed|style|link|meta|base)\s*>/gi, '');
  s = s.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/\s+(href|src|action|formaction|xlink:href|srcdoc)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (m, attr, val) => {
    // Se decodifican entidades numéricas y &tab;/&newline;/&colon; antes de mirar el
    // esquema: el navegador las decodifica en el atributo (j&#97;vascript: es javascript:).
    const v = val.replace(/^["']|["']$/g, '')
      .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/&(tab|newline);/gi, '').replace(/&colon;/gi, ':')
      .replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
    if(attr.toLowerCase() === 'srcdoc' || /^(javascript|vbscript|data:text\/html)/.test(v)) return '';
    return m;
  });
  s = s.replace(/\s+style\s*=\s*("[^"]*"|'[^']*')/gi, (m, val) => /expression\s*\(|javascript:|url\s*\(\s*["']?\s*javascript/i.test(val) ? '' : m);
  return s;
}

// ── 1b) Cálculos canónicos compartidos (antes en index.html) ─────────────────
// La app y el expediente usan exactamente las mismas funciones; se movieron
// aquí sin cambios para que el generador (función pura) no dependa de index.html.

// ── MONTO DE CONTRATO PARA PRESENTACIÓN ──
// Hay dos fuentes legítimas: proyectos.monto_contrato (el contractual, escrito
// por la ficha o la extracción IA del PDF) y Σ rubros.monto_contrato (el vigente,
// que incluye órdenes de cambio). Para MOSTRAR el monto (tabla del Dashboard,
// Proyectos, tarjeta "Suma contratos", PDFs) la regla es: registro; si está
// vacío, Σ rubros; si ambos existen y difieren más de la tolerancia, indicador
// con los dos valores. Todo CÁLCULO (avance, EVM/SPI, cartera, liquidación,
// amortización, totales de Rubros) sigue usando Σ rubros: son magnitudes
// ponderadas por ejecución y deben cuadrar con los rubros.
const MONTO_CONTRATO_TOLERANCIA = 1.00;

function montoContratoProyecto(p, sumaRubros){
  const contractual = Number(p?.monto_contrato) || 0;
  const vigente = Number(sumaRubros) || 0;
  const valor = contractual > 0 ? contractual : vigente;
  const difiere = contractual > 0 && vigente > 0 && Math.abs(contractual - vigente) > MONTO_CONTRATO_TOLERANCIA;
  return {
    valor, contractual, vigente, difiere,
    delta: vigente - contractual,
    fuente: contractual > 0 ? 'registro' : (vigente > 0 ? 'rubros' : null)
  };
}

// ── NÚCLEO DE PLANILLAS ──
// Universo canónico de toda cifra de dinero comprometido del contrato: solo las
// planillas aprobadas o pagadas. Antes cada consumidor filtraba por su cuenta
// (tarjetas de Contrato con estado!=='rechazada', liquidación y cartera con
// aprobada/pagada, y el reporte PDF sin filtro), así que el mismo proyecto
// mostraba tres cifras distintas de retención acumulada. Una sola fuente.
const PLANILLAS_COMPROMETIDAS = ['aprobada','pagada'];

function agregarPlanillas(plans){
  const pv = (plans||[]).filter(p=>PLANILLAS_COMPROMETIDAS.includes(p.estado));
  const suma = f => pv.reduce((s,p)=>s+(f(p)||0), 0);
  return {
    n: pv.length,
    planillado: suma(p=>p.total_monto),
    reajustes:  suma(p=>p.reajuste_monto),
    amortizado: suma(p=>p.amortizacion_anticipo),
    retenido:   suma(p=>p.retencion_garantia),
    multas:     suma(p=>p.multa_monto),
    liquido:    suma(p=>p.total_liquido ?? p.total_monto)
  };
}

// hoyISO (YYYY-MM-DD) opcional: el expediente lo pasa para que el resultado no
// dependa de la hora de generación; la app lo omite y usa la fecha actual.
function semaforoGarantia(g, hoyISO){
  if(g.estado !== 'vigente') return { color:'#676879', bg:'#f5f6f8', label:{renovada:'Renovada',devuelta:'Devuelta',ejecutada:'Ejecutada'}[g.estado]||g.estado };
  if(!g.vigencia_hasta) return { color:'#676879', bg:'#f5f6f8', label:'Por definir' };
  const hoy = hoyISO ? new Date(String(hoyISO).slice(0,10) + 'T00:00:00') : new Date(); hoy.setHours(0,0,0,0);
  const hasta = new Date(g.vigencia_hasta + 'T00:00:00');
  const dias = Math.round((hasta - hoy) / 86400000);
  if(dias < 0)  return { color:'#e2445c', bg:'#fdecef', label:`Vencida hace ${-dias} día(s)` };
  if(dias <= 5) return { color:'#b8860b', bg:'#fdf6e3', label:`Vence en ${dias} día(s)` };
  return { color:'#00854d', bg:'#e6f4ee', label:`Vigente · ${dias} días` };
}

// ── 2) Renderers de documentos existentes ────────────────────────────────────

// ── Orden de cambio: documento formal ───────────────────────────────────────
// ctx = { oc, items, rubrosMap, perfMap, proy, montoContrato, fechaTexto }.
// rubrosMap: {id → rubro} de los rubros referenciados por los ítems; perfMap:
// {id → "Nombre Apellido"} de creado_por/aprobado_por; montoContrato: Σ rubros
// vigente; fechaTexto: fecha de generación ya formateada (la pone quien llama).
function ocPartes(ctx){
  const { oc, items, rubrosMap, perfMap, proy, montoContrato, fechaTexto } = ctx;
  const logoUrl = ctx.logoUrl || LOGO_URL;
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

  return { oc, items, rubrosMap, perfMap, proy, montoContrato, fechaTexto, codigoOC, esBorrador, f, e, filasItems, logoUrl };
}

// Cuerpo del documento (encabezado, datos, tabla, resumen y firmas): lo que el
// expediente incrusta por cada orden de cambio.
function ocCuerpoHTML(ctx){
  const { oc, perfMap, proy, montoContrato, fechaTexto, codigoOC, esBorrador, f, e, filasItems, logoUrl } = ocPartes(ctx);
  return `
      <div class="encabezado">
        <div style="display:flex;align-items:center;gap:16px">
          <img src="${logoUrl}" alt="HiDiVo"/>
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
// Cuerpo y firmas van dentro de <div id="docCierreEditable">: es lo que «Guardar
// acta» persiste. Si llega editableHtml (texto guardado de un acta, ya saneado),
// sustituye a cuerpo y firmas dentro de ese mismo envoltorio.
function docCierreHTML(titulo, proy, cuerpoHtml, firmas, fechaTexto, editableHtml){
  const e = expEsc;
  const editable = editableHtml != null ? editableHtml : `${cuerpoHtml}
    <div class="firmas">${firmas.map(fi=>`<div class="fb"><div class="lf"></div><div style="font-size:12px;font-weight:700">${e(fi[0])}</div><div style="font-size:11px;color:#676879">${e(fi[1])}</div></div>`).join('')}</div>`;
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
    <div id="docCierreEditable">${editable}</div>
    </body></html>`;
}

// Firmantes de los documentos de cierre (mismo orden en acta y liquidación).
function firmasCierre(proy){
  return [['Fiscalización',''],['Contratista',proy?.contratista||''],['Contratante',proy?.contratante||'']];
}

// ── 2c) Helpers compartidos y renderers del reporte del libro y de SST ─────────
// Movidos desde index.html sin cambios (la app los sigue usando): escAttr,
// climaIcon, formatFecha, escapeHtml, PTE_TIPOS y los estilos/filas de SST.

// Escapa texto para insertarlo de forma segura en HTML (atributos y nodos de texto)
function escAttr(texto){
  return String(texto??'')
    .replace(/&/g,'&amp;')
    .replace(/"/g,'&quot;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

function climaIcon(clima){
  const map = {'Soleado':'☀️','Nublado':'☁️','Lluvioso':'🌧️','Parcialmente nublado':'⛅','Tormenta':'⛈️'};
  return map[clima]||'🌤️';
}



// Fecha corta (dd mmm aa) y escape con saltos de línea: los usan los cuerpos SST.
function formatFecha(f){ const d=new Date(f+'T00:00:00'); return d.toLocaleDateString('es-EC',{day:'2-digit',month:'short',year:'2-digit'}); }
function escapeHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }

const PTE_TIPOS = {
  caliente:'🔥 Trabajo en caliente', frio:'❄️ Trabajo en frío', alturas:'🪜 Trabajo en alturas',
  electrico:'⚡ Trabajo eléctrico', confinado:'🕳️ Espacio confinado', maritimo:'🌊 Marítimo/submarino/aguas abiertas',
  aereo:'🚁 Trabajo aéreo', radiaciones:'☢️ Radiaciones ionizantes', subterraneo:'⛏️ Trabajo subterráneo',
  sustancias:'☣️ Sustancias/materiales peligrosos'
};

const sstEstiloTabla = 'width:100%;border-collapse:collapse;font-size:12px;margin:10px 0';
const sstEstiloTh = 'border:1px solid #999;padding:6px 8px;background:#f0f0f0;text-align:left;font-size:11px';
const sstEstiloTd = 'border:1px solid #999;padding:6px 8px';

function sstFilaDato(label, valor){
  return `<tr><td style="${sstEstiloTd};background:#f7f7f7;font-weight:700;width:220px">${label}</td><td style="${sstEstiloTd}">${escapeHtml(valor||'—')}</td></tr>`;
}

// ── Registro del libro de obra (bloque del reporte PDF) ──────────────────────
// ctx = { nombresAprobadores: {id → nombre}, rubros: filas de libro_obra_rubros con
// `rubros` embebido, fotos: filas de libro_obra_fotos, inc: {actividades, equipos,
// materiales, rubros, novedades, fotos} }. Mismo HTML que imprimía el reporte.
function renderRegistroLibroHTML(r, ctx){
  const nombresAprobadores = ctx.nombresAprobadores || {};
  const rubrosReg = ctx.rubros || [];
  const fotosReg = ctx.fotos || [];
  const inc = ctx.inc || {};
  const incActividades = !!inc.actividades, incEquipos = !!inc.equipos, incMateriales = !!inc.materiales;
  const incRubros = !!inc.rubros, incNovedades = !!inc.novedades, incFotos = !!inc.fotos;
  return `
  <div class="registro-block">
    <div class="registro-header">
      <span class="reg-num">Registro N° ${r.numero_registro||'—'} — ${new Date(r.fecha+'T00:00:00').toLocaleDateString('es-EC',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</span>
      ${r.estado_aprobacion==='aprobado'
        ? `<span style="float:right;font-size:9px;color:#00854d;font-weight:700">✓ APROBADO${nombresAprobadores[r.aprobado_por]?' por '+nombresAprobadores[r.aprobado_por]:''}${r.aprobado_at?' — '+new Date(r.aprobado_at).toLocaleString('es-EC',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):''}</span>`
        : `<span style="float:right;font-size:9px;color:${r.estado_aprobacion==='observado'?'#e2445c':'#b8860b'};font-weight:700">${r.estado_aprobacion==='observado'?'⚠ OBSERVADO':'⏳ PENDIENTE DE APROBACIÓN'}</span>`}
    </div>
    <div class="registro-meta">
      <span>${climaIcon(r.clima_diurno||r.clima)} ${r.clima_diurno||r.clima||'—'} / 🌙 ${climaIcon(r.clima_nocturno)} ${r.clima_nocturno||'—'}</span>
      <span>🌡️ ${r.temperatura_min!=null?r.temperatura_min+'°C':'—'} / ${r.temperatura_max!=null?r.temperatura_max+'°C':'—'}</span>
      <span>👷 ${r.personal_total||0} personas</span>
    </div>
    <div class="registro-body">
      ${incActividades && r.actividades_ejecutadas ? `<div class="campo"><span class="lbl">Actividades ejecutadas</span><div class="val">${r.actividades_ejecutadas}</div></div>` : ''}
      ${incEquipos && r.equipos_maquinaria ? `<div class="campo"><span class="lbl">Equipos y maquinaria</span><div class="val">${r.equipos_maquinaria}</div></div>` : ''}
      ${incMateriales && r.materiales_utilizados ? `<div class="campo"><span class="lbl">Materiales utilizados</span><div class="val">${r.materiales_utilizados}</div></div>` : ''}
      ${incRubros && rubrosReg.length ? `<div class="campo"><span class="lbl">Rubros trabajados</span>
        <table><thead><tr><th>Cód.</th><th>Descripción</th><th style="text-align:right">Cantidad</th><th>Unidad</th></tr></thead><tbody>
        ${rubrosReg.map(rr=>`<tr><td>${rr.rubros?.codigo||'—'}</td><td>${rr.rubros?.descripcion||'—'}</td><td class="td-qty">${rr.cantidad_dia}</td><td>${rr.rubros?.unidad||'—'}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
      ${incNovedades && r.novedades ? `<div class="campo"><span class="lbl">Novedades</span><div class="novedad-box">${r.novedades}</div></div>` : ''}
      ${incNovedades && r.resoluciones ? `<div class="campo"><span class="lbl">Resoluciones</span><div class="val">${r.resoluciones}</div></div>` : ''}
      ${incFotos && fotosReg.length ? `<div class="campo"><span class="lbl">Fotos de avance (${fotosReg.length})</span>
        <div class="fotos-grid">
          ${fotosReg.map(f=>`<div class="foto-item">
            <img src="${f.url}" crossorigin="anonymous"/>
            ${f.descripcion ? `<div class="foto-desc">${escAttr(f.descripcion)}</div>` : ''}
          </div>`).join('')}
        </div></div>` : ''}
    </div>
  </div>`;
}

// Ensayos con su especificación resuelta (nombreTipo, espTxt, unidad), tal como
// los muestra la tabla de calidad del reporte.
function enriquecerEnsayos(ensR, espR, tipR){
  return (ensR||[]).map(e=>{
        const esp = (espR||[]).find(x=>x.id===e.especificacion_id)||{};
        const t = (tipR||[]).find(x=>x.id===esp.tipo_id)||{};
        const espTxt = t.criterio==='menor_igual' ? `≤ ${esp.valor_max}` : t.criterio==='rango' ? `${esp.valor_min}–${esp.valor_max}` : `≥ ${esp.valor_min}`;
        return {...e, nombreTipo: `${t.nombre||''}${esp.etiqueta?' — '+esp.etiqueta:''}`, espTxt, unidad: t.unidad||''};
  });
}

// ── Tabla de ensayos del período (reporte PDF) ───────────────────────────────
function renderEnsayosTablaHTML(ensayos){
  return `
  <h2 style="font-size:14px;color:#0073ea;margin-top:20px">Control de Calidad — Ensayos del Período</h2>
  <div style="font-size:11px;margin-bottom:6px">Total: <b>${ensayos.length}</b> · Cumplen: <b style="color:#00854d">${ensayos.filter(e=>e.cumple).length}</b> · No cumplen: <b style="color:#e2445c">${ensayos.filter(e=>!e.cumple).length}</b> (${ensayos.filter(e=>!e.cumple&&!e.resuelto).length} sin resolver) · Cumplimiento: <b>${(ensayos.filter(e=>e.cumple).length/ensayos.length*100).toFixed(1)}%</b></div>
  <table style="margin-top:4px">
    <thead><tr><th>N°</th><th>Fecha</th><th>Ensayo</th><th>Ubicación</th><th style="text-align:right">Valor</th><th style="text-align:right">Espec.</th><th>Veredicto</th></tr></thead>
    <tbody>
    ${ensayos.map(e=>`<tr>
      <td style="font-size:10px">E-${String(e.numero).padStart(3,'0')}${e.reensayo_de?' (R)':''}</td>
      <td style="font-size:10px;white-space:nowrap">${e.fecha}</td>
      <td style="font-size:10px">${e.nombreTipo}</td>
      <td style="font-size:10px">${(e.ubicacion||'—').replace(/</g,'&lt;')}</td>
      <td style="font-size:10px;text-align:right"><b>${e.valor}</b> ${e.unidad}</td>
      <td style="font-size:10px;text-align:right">${e.espTxt}</td>
      <td style="font-size:10px;font-weight:700;color:${e.cumple?'#00854d':'#e2445c'}">${e.cumple?'✓ CUMPLE':(e.resuelto?'✗ Resuelto':'✗ NO CUMPLE')}</td>
    </tr>`).join('')}
    </tbody>
  </table>`;
}

// ── 3) Expediente de obra ────────────────────────────────────────────────────
//
// Tres piezas separadas:
//   expedienteCargarDatos(proyectoId, seleccion, cliente)  → Promise<datos>   (red)
//   expedienteGenerarHTML(datos, seleccion, meta)          → string           (pura)
//   expedientePrevisualizar(html, nombreArchivo)           → {ventana, url}   (navegador)
//
// `seleccion` es el mismo objeto que se guarda en expedientes_generados
// (secciones = arreglo de claves de EXPEDIENTE_SECCIONES; filtros = objeto):
//   { preset, secciones:[...], filtros:{ incluirOCsNoAprobadas, detallePlanillas }, subtitulo }
// `datos` es un objeto plano serializable (JSON) con todo lo que el documento
// necesita; `meta` lleva lo que no sale de la base:
//   { version, generadoEn (ISO), generadoPor, rol, hoy (YYYY-MM-DD), logoDataUri, nombreArchivo }
// En la fase 3, Puppeteer ejecutará expedienteGenerarHTML tal cual con un
// `datos` cargado en el servidor.

// ── 3.1) Formateadores del documento ────────────────────────────────────────
// Fecha de la base (YYYY-MM-DD) → DD/MM/YYYY, sin pasar por Date (sin husos horarios).
function expFmtFecha(iso){
  if(!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return (d && m && y) ? `${d}/${m}/${y}` : String(iso);
}
// Fecha larga en español a partir de una fecha YYYY-MM-DD ("14 de octubre de 2026").
function expFmtFechaLarga(iso){
  if(!iso) return '—';
  return new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('es-EC', { day:'numeric', month:'long', year:'numeric' });
}
// Marca de tiempo ISO → fecha y hora de Ecuador ("14/10/2026, 10:05").
function expFmtFechaHora(iso){
  if(!iso) return '—';
  return new Intl.DateTimeFormat('es-EC', { timeZone:'America/Guayaquil', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(iso));
}
// Cantidades: hasta `dec` decimales (la base guarda 3 en planillas y 4 en rubros).
function expFmtNum(v, dec = 2){
  return Number(v || 0).toLocaleString('es-EC', { minimumFractionDigits: 0, maximumFractionDigits: dec });
}
function expFmtPct(v, dec = 1){
  return Number(v || 0).toLocaleString('es-EC', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' %';
}
// Texto con saltos de línea → HTML escapado con <br>.
function expParrafo(s){
  return expEsc(s).replace(/\n/g, '<br>');
}
// Valor jsonb de estructura variable (contrato_datos) → HTML genérico clave/valor
// con listas y tablas. Nunca imprime null/undefined: deja «—».
function expRenderJSON(valor, nivel = 0){
  if(valor === null || valor === undefined || valor === '') return '—';
  if(Array.isArray(valor)){
    if(!valor.length) return '—';
    if(valor.every(v => v && typeof v === 'object' && !Array.isArray(v))){
      const claves = [...new Set(valor.flatMap(v => Object.keys(v)))];
      return `<table class="tabla"><thead><tr>${claves.map(k => `<th>${expEsc(expClaveLegible(k))}</th>`).join('')}</tr></thead><tbody>` +
        valor.map(v => `<tr>${claves.map(k => `<td>${expRenderJSON(v[k], nivel + 1)}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
    }
    return `<ul class="lista">${valor.map(v => `<li>${expRenderJSON(v, nivel + 1)}</li>`).join('')}</ul>`;
  }
  if(typeof valor === 'object'){
    const entradas = Object.entries(valor);
    if(!entradas.length) return '—';
    return `<table class="tabla kv${nivel ? ' kv-anidada' : ''}"><tbody>` +
      entradas.map(([k, v]) => `<tr><th>${expEsc(expClaveLegible(k))}</th><td>${expRenderJSON(v, nivel + 1)}</td></tr>`).join('') + '</tbody></table>';
  }
  if(typeof valor === 'boolean') return valor ? 'Sí' : 'No';
  if(typeof valor === 'number') return expFmtNum(valor, 4);
  return expParrafo(String(valor));
}
function expClaveLegible(k){
  const s = String(k).replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// Nombre de archivo y título de la pestaña: Expediente_{slug}_v{N}_{fecha}.
// slug: sin tildes, espacios y símbolos a guiones, máximo 40 caracteres cortados en palabra entera.
function expedienteNombreArchivo(proyecto, version, fechaISO){
  let slug = String(proyecto?.nombre || 'proyecto').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  // Máximo 40 caracteres, cortando en límite de palabra (último guion) y no a mitad de una.
  if(slug.length > 40){ const corte = slug.lastIndexOf('-', 40); slug = (corte > 0 ? slug.slice(0, corte) : slug.slice(0, 40)).replace(/-+$/g, ''); }
  slug = slug || 'proyecto';
  return `Expediente_${slug}_v${version || 1}_${String(fechaISO || '').slice(0, 10)}`;
}

// ── 3.2) Carga de datos (red) ───────────────────────────────────────────────
// Pagina por range() de 1000 en 1000 hasta agotar (PostgREST corta en 1000 filas
// por llamada) y lanza error si cualquier llamada falla. `consultaBase` es una
// función que devuelve el builder sin range (se vuelve a construir en cada página).
async function expedienteSelectTodo(consultaBase, tam = 1000){
  const filas = [];
  let desde = 0;
  for(;;){
    const { data, error } = await consultaBase().range(desde, desde + tam - 1);
    if(error) throw new Error('No se pudo leer la base: ' + (error.message || error));
    filas.push(...(data || []));
    if(!data || data.length < tam) break;
    desde += tam;
  }
  return filas;
}
async function expedienteUna(consulta){
  const { data, error } = await consulta;
  if(error) throw new Error('No se pudo leer la base: ' + (error.message || error));
  return data;
}

// Dos tandas de consultas en paralelo: primero todo lo que depende solo del
// proyecto; después lo que depende de los ids obtenidos (ítems de OC, rubros e
// historial de planillas, nombres de usuarios). Devuelve un objeto plano.
async function expedienteCargarDatos(proyectoId, seleccion, cliente, opciones){
  const c = cliente || (typeof sb !== 'undefined' ? sb : null);
  const progreso = typeof opciones?.onProgreso === 'function' ? opciones.onProgreso : () => {};
  progreso('Cargando contrato, presupuesto, órdenes de cambio y planillas…');
  if(!c) throw new Error('Sin cliente de Supabase');
  const todo = (tabla, armar) => expedienteSelectTodo(() => armar(c.from(tabla).select('*')));

  const [proyecto, anticipo, garantias, reajusteTerminos, rubros, ocs, planillas, actas, liquidacion] = await Promise.all([
    expedienteUna(c.from('proyectos').select('*').eq('id', proyectoId).single()),
    expedienteUna(c.from('contrato_anticipo').select('*').eq('proyecto_id', proyectoId).maybeSingle()),
    todo('garantias',         q => q.eq('proyecto_id', proyectoId).order('vigencia_hasta')),
    todo('reajuste_terminos', q => q.eq('proyecto_id', proyectoId).order('orden')),
    todo('rubros',            q => q.eq('proyecto_id', proyectoId).order('orden')),
    todo('ordenes_cambio',    q => q.eq('proyecto_id', proyectoId).order('numero')),
    todo('planillas_pago',    q => q.eq('proyecto_id', proyectoId).order('numero')),
    todo('actas_recepcion',   q => q.eq('proyecto_id', proyectoId).order('fecha')),
    expedienteUna(c.from('liquidaciones').select('*').eq('proyecto_id', proyectoId).maybeSingle())
  ]);

  const idsOC = ocs.map(o => o.id);
  const idsPlan = planillas.map(p => p.id);
  const [items, planRubros, historial] = await Promise.all([
    idsOC.length   ? todo('orden_cambio_items', q => q.in('orden_id', idsOC).order('created_at')) : [],
    idsPlan.length ? todo('planilla_rubros',    q => q.in('planilla_id', idsPlan)) : [],
    idsPlan.length ? todo('planilla_historial', q => q.in('planilla_id', idsPlan).order('created_at')) : []
  ]);

  const idsPerfil = [...new Set([
    ...ocs.flatMap(o => [o.creado_por, o.aprobado_por]),
    ...planillas.flatMap(p => [p.creado_por, p.revisado_por, p.aprobado_por]),
    ...historial.map(h => h.autor_id),
    ...actas.map(a => a.creado_por),
    liquidacion?.creado_por
  ].filter(Boolean))];
  const perfilesFilas = idsPerfil.length
    ? await expedienteUna(c.from('perfiles').select('id,nombre,apellido').in('id', idsPerfil))
    : [];
  const perfiles = {};
  (perfilesFilas || []).forEach(p => { perfiles[p.id] = `${p.nombre || ''} ${p.apellido || ''}`.trim() || 'Usuario'; });

  const ordenRubro = {};
  rubros.forEach((r, i) => { ordenRubro[r.id] = i; });
  const datos = {
    proyecto, anticipo: anticipo || null, garantias, reajusteTerminos, rubros,
    ordenesCambio: ocs.map(o => ({ ...o, items: items.filter(i => i.orden_id === o.id) })),
    planillas: planillas.map(p => ({
      ...p,
      rubros: planRubros.filter(r => r.planilla_id === p.id).sort((x, y) => (ordenRubro[x.rubro_id] ?? 1e9) - (ordenRubro[y.rubro_id] ?? 1e9)),
      historial: historial.filter(h => h.planilla_id === p.id)
    })),
    actas, liquidacion: liquidacion || null, perfiles
  };
  // Fase 2: libro, observaciones, ensayos, formatos, SST, subcontratos, cronograma (solo las seleccionadas).
  await expedienteCargarFase2(datos, proyectoId, seleccion, c, opciones || {});
  progreso('Datos cargados');
  return datos;
}

// ── 3.3) Cálculos compartidos del documento ─────────────────────────────────
// Usa los helpers canónicos (montoContratoProyecto, agregarPlanillas); no repite
// fórmulas. Devuelve lo que portada, índice, estimación y secciones comparten.
function expedienteCalcular(datos, seleccion){
  const filtros = seleccion?.filtros || {};
  const rubros = datos.rubros || [];
  const sumaRubros = rubros.reduce((s, r) => s + (Number(r.monto_contrato) || 0), 0);
  const monto = montoContratoProyecto(datos.proyecto, sumaRubros);
  const tieneContractual = rubros.some(r => r.cantidad_contractual !== undefined && r.cantidad_contractual !== null)
    && rubros.some(r => Object.prototype.hasOwnProperty.call(r, 'precio_contractual'));
  const sumaContractual = tieneContractual
    ? rubros.reduce((s, r) => s + (Number(r.cantidad_contractual) || 0) * (Number(r.precio_contractual) || 0), 0) : null;
  const ocs = datos.ordenesCambio || [];
  const ocsAprobadas = ocs.filter(o => o.estado === 'aprobada');
  const ocsIncluidas = filtros.incluirOCsNoAprobadas ? ocs : ocsAprobadas;
  const montoOCs = ocsAprobadas.reduce((s, o) => s + (Number(o.monto_total) || 0), 0);
  const planillas = datos.planillas || [];
  const agg = agregarPlanillas(planillas);
  const garantiasVigentes = (datos.garantias || []).filter(g => g.estado === 'vigente');
  const parcial = (datos.proyecto?.estado_cierre || 'en_ejecucion') !== 'liquidado';
  return { sumaRubros, monto, tieneContractual, sumaContractual, ocsAprobadas, ocsIncluidas, montoOCs, agg, planillas, garantiasVigentes, parcial, filtros };
}

// Secciones de la selección que esta fase sabe renderizar, en el orden del catálogo.
function expedienteSeccionesActivas(seleccion){
  const pedidas = new Set(seleccion?.secciones || []);
  pedidas.add('portada'); pedidas.add('indice');
  return EXPEDIENTE_SECCIONES.filter(s => s.fase === 1 && pedidas.has(s.clave)).map(s => s.clave);
}

// Estimación de páginas. Fórmula (extensible en la fase 2 añadiendo términos):
//   2 (portada + índice) + 2 (contrato) + ⌈rubros/45⌉ + Σ por OC (1 + ⌈ítems/45⌉)
//   + 1 (resumen de planillas) + Σ por planilla (1 + ⌈ítems/45⌉ si hay detalle)
//   + 2 (actas) + 1 (liquidación). 45 = filas de tabla a 10 pt que caben en una A4.
function expedienteEstimar(datos, seleccion){
  const activas = expedienteSeccionesActivas(seleccion);
  const calc = expedienteCalcular(datos, seleccion);
  const FILAS = 45;
  const filas = {
    contrato: (datos.garantias || []).length + (datos.reajusteTerminos || []).length + (datos.anticipo ? 1 : 0),
    presupuesto: (datos.rubros || []).length,
    ordenes_cambio: calc.ocsIncluidas.length,
    planillas: calc.planillas.length,
    actas: (datos.actas || []).length,
    liquidacion: datos.liquidacion ? 1 : 0
  };
  let paginas = 2;
  if(activas.includes('contrato')) paginas += 2;
  if(activas.includes('presupuesto')) paginas += Math.ceil(filas.presupuesto / FILAS) || 1;
  if(activas.includes('ordenes_cambio')) paginas += calc.ocsIncluidas.reduce((s, o) => s + 1 + Math.ceil((o.items || []).length / FILAS), 0);
  if(activas.includes('planillas')) paginas += 1 + calc.planillas.reduce((s, p) => s + 1 + (calc.filtros.detallePlanillas ? Math.ceil((p.rubros || []).length / FILAS) : 0), 0);
  if(activas.includes('actas')) paginas += 2;
  if(activas.includes('liquidacion')) paginas += 1;
  return { filas, paginas, secciones: activas };
}

// ── 3.4) Generador (función pura) ───────────────────────────────────────────
function expedienteGenerarHTML(datos, seleccion, meta){
  meta = meta || {};
  const proy = datos.proyecto || {};
  const calc = expedienteCalcular(datos, seleccion);
  const activas = expedienteSeccionesActivas(seleccion);
  const version = meta.version || 1;
  const fechaGen = meta.generadoEn || '';
  const fechaTexto = expFmtFechaLarga(fechaGen);
  const nombreArchivo = meta.nombreArchivo || expedienteNombreArchivo(proy, version, fechaGen);
  const logo = meta.logoDataUri || LOGO_URL;
  const e = expEsc;
  const f = fmtUSD;

  // Numeración: sección n, subsecciones n.k (cada OC y cada planilla).
  const numero = {};
  activas.forEach((clave, i) => { numero[clave] = i + 1; });
  const titulo = (clave, texto) => `<h1 class="sec-titulo">${numero[clave]}. ${e(texto)}</h1>`;
  const sub = (clave, k, texto) => `<h2 class="sub-titulo">${numero[clave]}.${k}. ${e(texto)}</h2>`;
  const etiquetaSeccion = clave => EXPEDIENTE_SECCIONES.find(s => s.clave === clave)?.etiqueta || clave;
  const vacio = texto => `<p class="vacio">${e(texto)}</p>`;
  const estadoCierre = ESTADOS_CIERRE[proy.estado_cierre]?.label || proy.estado_cierre || 'En ejecución';
  const ESTADO_PROY = { planificacion:'Planificación', ejecucion:'En ejecución', pausado:'Pausado', finalizado:'Finalizado', cancelado:'Cancelado' };
  const montoHtml = m => !m.valor ? '—' : (!m.difiere ? f(m.valor)
    : `${f(m.valor)} <span class="aviso">⚠ Contrato ${f(m.contractual)} · Vigente (rubros) ${f(m.vigente)} · Δ ${(m.delta >= 0 ? '+' : '−') + f(Math.abs(m.delta))}</span>`);

  const S = {};

  // 1. Portada y ficha
  S.portada = () => {
    const filas = [
      ['Objeto', proy.descripcion ? expParrafo(proy.descripcion) : '—'],
      ['Ubicación', e(proy.ubicacion || '—')],
      ['Contratante', e(proy.contratante || '—')],
      ['Contratista', e(proy.contratista || '—')],
      ['Fiscalización', e(proy.fiscalizador || 'HIDIVO S.A.S.')],
      ['Fecha del contrato', expFmtFecha(proy.contrato_datos?.datos_no_mapeados?.fecha_suscripcion_contrato)],
      ['Inicio', expFmtFecha(proy.fecha_inicio)],
      ['Plazo', e(proy.contrato_datos?.datos_adicionales?.plazo || '—')],
      ['Fin contractual (planificado)', expFmtFecha(proy.fecha_fin_planificada)],
      ['Fin real', expFmtFecha(proy.fecha_fin_real)],
      ['Recepción provisional', expFmtFecha((datos.actas || []).find(a => a.tipo === 'provisional')?.fecha)],
      ['Recepción definitiva', expFmtFecha((datos.actas || []).find(a => a.tipo === 'definitiva')?.fecha)],
      ['Monto del contrato', montoHtml(calc.monto)],
      ['Anticipo', datos.anticipo ? `${f(datos.anticipo.monto)} (${expFmtPct(calc.sumaRubros > 0 ? datos.anticipo.monto / calc.sumaRubros * 100 : 0)} del vigente)` : 'Sin anticipo registrado'],
      ['Retención por planilla', datos.anticipo ? expFmtPct(datos.anticipo.retencion_pct) : '—'],
      ['Órdenes de cambio aprobadas', `${calc.ocsAprobadas.length} · monto neto ${f(calc.montoOCs)}`],
      ['Planillas aprobadas o pagadas', `${calc.agg.n} · líquido ${f(calc.agg.liquido)}`],
      ['Garantías vigentes', String(calc.garantiasVigentes.length)],
      ['Estado del proyecto', `${e(ESTADO_PROY[proy.estado] || proy.estado || '—')} · ${e(estadoCierre)}`]
    ];
    return `<section class="sec portada" id="sec-portada">
      <div class="portada-logo"><img src="${logo}" alt="HIDIVO"></div>
      <div class="portada-titulo">EXPEDIENTE DE OBRA</div>
      ${seleccion?.subtitulo ? `<div class="portada-subtitulo">${e(seleccion.subtitulo)}</div>` : ''}
      <div class="portada-proyecto">${e(proy.nombre || '')}</div>
      <table class="tabla kv portada-partes"><tbody>
        <tr><th>Contratante</th><td>${e(proy.contratante || '—')}</td></tr>
        <tr><th>Contratista</th><td>${e(proy.contratista || '—')}</td></tr>
        <tr><th>Fiscalización</th><td>${e(proy.fiscalizador || 'HIDIVO S.A.S.')}</td></tr>
        <tr><th>Estado</th><td>${e(estadoCierre)}</td></tr>
      </tbody></table>
      <div class="portada-meta">Expediente v${version} · generado el ${e(fechaTexto)} por ${e(meta.generadoPor || '—')}${meta.rol ? ` (${e(meta.rol)})` : ''}</div>
      <h2 class="sub-titulo">Ficha del proyecto</h2>
      <table class="tabla kv"><tbody>${filas.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>
    </section>`;
  };

  // 2. Índice
  S.indice = () => {
    const items = activas.map(clave => {
      let subs = '';
      if(clave === 'ordenes_cambio' && calc.ocsIncluidas.length)
        subs = `<ol class="indice-sub">${calc.ocsIncluidas.map(o => `<li>OC-${String(o.numero).padStart(2, '0')} — ${e(o.titulo)} (${e(ESTADOS_OC[o.estado]?.label || o.estado)})</li>`).join('')}</ol>`;
      if(clave === 'planillas' && calc.planillas.length)
        subs = `<ol class="indice-sub">${calc.planillas.map(p => `<li>Planilla N° ${p.numero} — ${expFmtFecha(p.fecha_inicio)} a ${expFmtFecha(p.fecha_fin)} (${e(ESTADOS_PLANILLA[p.estado]?.label || p.estado)})</li>`).join('')}</ol>`;
      if(clave === 'actas') subs = `<ol class="indice-sub"><li>Acta de recepción provisional</li><li>Acta de recepción definitiva</li></ol>`;
      return `<li>${e(etiquetaSeccion(clave))}${subs}</li>`;
    }).join('');
    const pedidas = new Set(seleccion?.secciones || []);
    const noIncluidas = EXPEDIENTE_SECCIONES.filter(s => !activas.includes(s.clave))
      .map(s => s.fase === 1 ? etiquetaSeccion(s.clave) : `${etiquetaSeccion(s.clave)} (disponible próximamente)`);
    const filtrosTxt = [
      calc.filtros.incluirOCsNoAprobadas ? 'incluye órdenes de cambio en borrador, solicitadas o rechazadas' : 'solo órdenes de cambio aprobadas',
      calc.filtros.detallePlanillas ? 'planillas con detalle por rubro' : 'planillas sin detalle por rubro'
    ];
    return `<section class="sec" id="sec-indice">
      ${titulo('indice', 'Índice')}
      <ol class="indice">${items}</ol>
      <p class="nota"><b>Este expediente no incluye:</b> ${noIncluidas.length ? e(noIncluidas.join('; ')) : 'ninguna sección quedó fuera'}.</p>
      <p class="nota"><b>Filtros aplicados:</b> ${e(filtrosTxt.join('; '))}.${pedidas.size ? '' : ''}</p>
    </section>`;
  };

  // 3. Contrato
  S.contrato = () => {
    const cd = proy.contrato_datos || null;
    const datosContrato = [
      ['Objeto', proy.descripcion ? expParrafo(proy.descripcion) : '—'],
      ['Contratante', e(proy.contratante || '—')],
      ['Contratista', e(proy.contratista || '—')],
      ['Fiscalización', e(proy.fiscalizador || 'HIDIVO S.A.S.')],
      ['Ubicación', e(proy.ubicacion || '—')],
      ['Inicio', expFmtFecha(proy.fecha_inicio)],
      ['Fin planificado', expFmtFecha(proy.fecha_fin_planificada)],
      ['Fin real', expFmtFecha(proy.fecha_fin_real)],
      ['Monto del contrato', montoHtml(calc.monto)],
      ['Plazo', e(cd?.datos_adicionales?.plazo || '—')],
      ['Multas', cd?.datos_adicionales?.multas ? expParrafo(cd.datos_adicionales.multas) : '—'],
      ['Cláusulas relevantes', cd?.datos_adicionales?.clausulas ? expParrafo(cd.datos_adicionales.clausulas) : '—']
    ];
    const extra = cd ? Object.fromEntries(Object.entries(cd).filter(([k]) => !['datos_adicionales', 'extraido_at', 'fiscalizador'].includes(k))) : null;
    const extraHtml = extra && Object.keys(extra).length
      ? `<h3 class="sub-sub">Otros datos extraídos del contrato</h3>${expRenderJSON(extra)}` : '';

    const ant = datos.anticipo;
    const anticipoHtml = ant ? (() => {
      const saldo = Math.max(0, (Number(ant.monto) || 0) - calc.agg.amortizado);
      return `<table class="tabla kv"><tbody>
        <tr><th>Monto del anticipo</th><td>${f(ant.monto)}</td></tr>
        <tr><th>% del monto vigente</th><td>${expFmtPct(calc.sumaRubros > 0 ? (Number(ant.monto) || 0) / calc.sumaRubros * 100 : 0)}</td></tr>
        <tr><th>Fecha de entrega</th><td>${expFmtFecha(ant.fecha_entrega)}</td></tr>
        <tr><th>Amortización</th><td>${ant.modo_amortizacion === 'manual' ? 'Manual por planilla' : 'Proporcional automática'}</td></tr>
        <tr><th>Retención por planilla</th><td>${expFmtPct(ant.retencion_pct)}</td></tr>
        <tr><th>IVA informativo</th><td>${expFmtPct(ant.iva_pct ?? 15)}</td></tr>
        <tr><th>Amortizado (planillas aprobadas o pagadas)</th><td>${f(calc.agg.amortizado)}</td></tr>
        <tr><th>Saldo por amortizar</th><td>${f(saldo)}</td></tr>
        ${ant.notas ? `<tr><th>Notas</th><td>${expParrafo(ant.notas)}</td></tr>` : ''}
      </tbody></table>`;
    })() : vacio('Sin anticipo registrado');

    const gars = datos.garantias || [];
    const garantiasHtml = gars.length ? `<table class="tabla"><thead><tr><th>Tipo</th><th>Entidad</th><th>N°</th><th class="num">Monto</th><th>Vigencia</th><th>Estado</th></tr></thead><tbody>${
      gars.map(g => { const s = semaforoGarantia(g, meta.hoy); return `<tr><td>${e(TIPOS_GARANTIA[g.tipo] || g.tipo)}</td><td>${e(g.aseguradora || '—')}</td><td>${e(g.numero || '—')}</td><td class="num">${g.monto ? f(g.monto) : '—'}</td><td>${expFmtFecha(g.vigencia_desde)} → ${expFmtFecha(g.vigencia_hasta)}</td><td><span class="pildora" style="color:${s.color};background:${s.bg}">${e(s.label)}</span></td></tr>`; }).join('')
    }</tbody></table>` : vacio('Sin garantías registradas');

    const terms = datos.reajusteTerminos || [];
    const suma = terms.reduce((s, t) => s + (Number(t.coeficiente) || 0), 0);
    const reajusteHtml = terms.length ? `<table class="tabla"><thead><tr><th>Término</th><th>Descripción</th><th class="num">Coeficiente</th><th class="num">Índice base</th></tr></thead><tbody>${
      terms.map(t => `<tr><td>${e(t.simbolo)}</td><td>${e(t.descripcion || '—')}</td><td class="num">${expFmtNum(t.coeficiente, 4)}</td><td class="num">${expFmtNum(t.indice_base, 4)}</td></tr>`).join('')
    }</tbody><tfoot><tr><th colspan="2">Suma de coeficientes</th><th class="num">${expFmtNum(suma, 4)}</th><th></th></tr></tfoot></table>${
      Math.abs(suma - 1) > 0.0005 ? `<p class="aviso">⚠ La suma de los coeficientes es ${expFmtNum(suma, 4)} y debería ser 1,000.</p>` : ''
    }<p class="nota">P = Po × ( Σ coeficiente × índice actual / índice base ).</p>` : vacio('Sin fórmula polinómica registrada');

    return `<section class="sec" id="sec-contrato">
      ${titulo('contrato', 'Contrato')}
      ${sub('contrato', 1, 'Datos del contrato')}
      <table class="tabla kv"><tbody>${datosContrato.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>
      ${extraHtml}
      ${sub('contrato', 2, 'Anticipo')}
      ${anticipoHtml}
      ${sub('contrato', 3, 'Garantías')}
      ${garantiasHtml}
      ${sub('contrato', 4, 'Fórmula polinómica de reajuste')}
      ${reajusteHtml}
    </section>`;
  };

  // 4. Presupuesto
  S.presupuesto = () => {
    const rubros = datos.rubros || [];
    const tc = calc.tieneContractual;
    const filas = rubros.map((r, i) => `<tr>
      <td class="num">${i + 1}</td><td>${e(r.codigo || '—')}${r.es_orden_cambio ? ` <span class="etq">${e(r.orden_cambio_codigo || 'OC')}</span>` : ''}</td>
      <td>${e(r.descripcion)}</td><td class="centro">${e(r.unidad || '—')}</td>
      ${tc ? `<td class="num">${r.cantidad_contractual == null ? '—' : expFmtNum(r.cantidad_contractual, 4)}</td><td class="num">${r.precio_contractual == null ? '—' : f(r.precio_contractual)}</td>` : ''}
      <td class="num">${expFmtNum(r.cantidad_contrato, 4)}</td><td class="num">${f(r.precio_unitario)}</td><td class="num">${f(r.monto_contrato)}</td>
    </tr>`).join('');
    const contractualMasOCs = calc.monto.contractual > 0 ? calc.monto.contractual + calc.montoOCs : null;
    const difiere = contractualMasOCs !== null && Math.abs(calc.sumaRubros - contractualMasOCs) > MONTO_CONTRATO_TOLERANCIA;
    return `<section class="sec" id="sec-presupuesto">
      ${titulo('presupuesto', 'Presupuesto')}
      ${rubros.length ? `<table class="tabla presupuesto"><thead><tr><th class="num">#</th><th>Código</th><th>Descripción</th><th class="centro">Und.</th>${tc ? '<th class="num">Cant. contractual</th><th class="num">P.U. contractual</th>' : ''}<th class="num">Cantidad vigente</th><th class="num">P. unitario vigente</th><th class="num">Monto vigente</th></tr></thead>
      <tbody>${filas}</tbody>
      <tfoot><tr><th colspan="${tc ? 6 : 4}">Totales</th>${tc ? `<th class="num" colspan="2">Contractual: ${f(calc.sumaContractual)}</th>` : '<th colspan="2"></th>'}<th class="num">${f(calc.sumaRubros)}</th></tr></tfoot></table>` : vacio('Sin rubros registrados')}
      ${difiere ? `<p class="aviso">⚠ El monto vigente (Σ rubros, ${f(calc.sumaRubros)}) difiere del monto contractual registrado más las órdenes de cambio aprobadas (${f(contractualMasOCs)}) en ${f(calc.sumaRubros - contractualMasOCs)}.</p>` : ''}
      <p class="nota">Cantidad, precio y monto vigentes incluyen las órdenes de cambio aprobadas.${tc ? ' Las columnas contractuales reflejan lo firmado en el contrato; los rubros nacidos de una orden de cambio no tienen valores contractuales.' : ''}</p>
    </section>`;
  };

  // 5. Órdenes de cambio
  S.ordenes_cambio = () => {
    const ocs = calc.ocsIncluidas;
    const rubrosMap = {};
    (datos.rubros || []).forEach(r => { rubrosMap[r.id] = r; });
    if(!ocs.length) return `<section class="sec" id="sec-ordenes_cambio">${titulo('ordenes_cambio', 'Órdenes de cambio')}${vacio(calc.filtros.incluirOCsNoAprobadas ? 'Sin órdenes de cambio registradas' : 'Sin órdenes de cambio aprobadas')}</section>`;
    const resumen = `<table class="tabla"><thead><tr><th>N°</th><th>Título</th><th>Fecha</th><th>Estado</th><th class="num">Monto neto</th></tr></thead><tbody>${
      ocs.map(o => `<tr><td>OC-${String(o.numero).padStart(2, '0')}</td><td>${e(o.titulo)}</td><td>${expFmtFecha(o.fecha_aprobacion || o.created_at)}</td><td>${e(ESTADOS_OC[o.estado]?.label || o.estado)}</td><td class="num">${f(o.monto_total)}</td></tr>`).join('')
    }</tbody><tfoot><tr><th colspan="4">Aprobadas: ${calc.ocsAprobadas.length} · monto neto</th><th class="num">${f(calc.montoOCs)}</th></tr></tfoot></table>`;
    const docs = ocs.map((o, k) => `<section class="sub oc-doc" id="oc-${o.id}">
      ${sub('ordenes_cambio', k + 1, `Orden de cambio OC-${String(o.numero).padStart(2, '0')} — ${o.titulo}`)}
      ${ocCuerpoHTML({ oc: o, items: o.items || [], rubrosMap, perfMap: datos.perfiles || {}, proy, montoContrato: calc.sumaRubros, fechaTexto, logoUrl: logo })}
    </section>`).join('');
    return `<section class="sec" id="sec-ordenes_cambio">${titulo('ordenes_cambio', 'Órdenes de cambio')}${resumen}</section>${docs}`;
  };

  // 6. Planillas
  S.planillas = () => {
    const plans = calc.planillas;
    const ivaPct = Number(datos.anticipo?.iva_pct ?? 15) || 0;
    const nombre = id => (datos.perfiles || {})[id] || '—';
    if(!plans.length) return `<section class="sec" id="sec-planillas">${titulo('planillas', 'Planillas de pago')}${vacio('Sin planillas registradas')}</section>`;
    const resumen = `<table class="tabla planillas-resumen"><thead><tr><th>N°</th><th>Periodo</th><th>Estado</th><th class="num">Bruto</th><th class="num">Reajuste</th><th class="num">Amortización</th><th class="num">Retención</th><th class="num">Multa</th><th class="num">IVA informativo (${expFmtPct(ivaPct, 0)})</th><th class="num">Líquido</th></tr></thead><tbody>${
      plans.map(p => `<tr><td>${p.numero}</td><td>${expFmtFecha(p.fecha_inicio)} → ${expFmtFecha(p.fecha_fin)}</td><td>${e(ESTADOS_PLANILLA[p.estado]?.label || p.estado)}</td><td class="num">${f(p.total_monto)}</td><td class="num">${f(p.reajuste_monto)}</td><td class="num">${f(p.amortizacion_anticipo)}</td><td class="num">${f(p.retencion_garantia)}</td><td class="num">${f(p.multa_monto)}</td><td class="num">${f((Number(p.total_monto) || 0) * ivaPct / 100)}</td><td class="num">${f(p.total_liquido ?? p.total_monto)}</td></tr>`).join('')
    }</tbody><tfoot><tr><th colspan="3">Aprobadas o pagadas (${calc.agg.n})</th><th class="num">${f(calc.agg.planillado)}</th><th class="num">${f(calc.agg.reajustes)}</th><th class="num">${f(calc.agg.amortizado)}</th><th class="num">${f(calc.agg.retenido)}</th><th class="num">${f(calc.agg.multas)}</th><th class="num">${f(calc.agg.planillado * ivaPct / 100)}</th><th class="num">${f(calc.agg.liquido)}</th></tr></tfoot></table>
    <p class="nota">Los totales suman solo las planillas aprobadas o pagadas (universo canónico de lo comprometido). El IVA es informativo: no forma parte del líquido.</p>`;
    const rubrosMap = {};
    (datos.rubros || []).forEach(r => { rubrosMap[r.id] = r; });
    const docs = plans.map((p, k) => {
      const cab = `<table class="tabla kv"><tbody>
        <tr><th>Periodo</th><td>${expFmtFecha(p.fecha_inicio)} → ${expFmtFecha(p.fecha_fin)}</td></tr>
        <tr><th>Estado</th><td>${e(ESTADOS_PLANILLA[p.estado]?.label || p.estado)}</td></tr>
        <tr><th>Elaborada por</th><td>${e(nombre(p.creado_por))} · ${expFmtFechaHora(p.created_at)}</td></tr>
        <tr><th>Aprobación</th><td>${p.aprobado_por ? `${e(nombre(p.aprobado_por))} · ${expFmtFecha(p.fecha_aprobacion)}` : 'Pendiente'}</td></tr>
        <tr><th>Pago</th><td>${p.fecha_pago ? expFmtFecha(p.fecha_pago) : (p.estado === 'pagada' ? 'Registrado sin fecha' : 'Pendiente')}</td></tr>
        ${p.observaciones ? `<tr><th>Observaciones</th><td>${expParrafo(p.observaciones)}</td></tr>` : ''}
      </tbody></table>`;
      const detalle = calc.filtros.detallePlanillas ? ((p.rubros || []).length ? `<table class="tabla"><thead><tr><th>Código</th><th>Descripción</th><th class="centro">Und.</th><th class="num">Cant. anterior</th><th class="num">Cant. periodo</th><th class="num">Cant. acumulada</th><th class="num">P. unitario</th><th class="num">Monto periodo</th></tr></thead><tbody>${
        p.rubros.map(r => { const ru = rubrosMap[r.rubro_id] || {}; return `<tr><td>${e(ru.codigo || '—')}</td><td>${e(ru.descripcion || '—')}</td><td class="centro">${e(ru.unidad || '—')}</td><td class="num">${expFmtNum(r.cantidad_anterior, 3)}</td><td class="num">${expFmtNum(r.cantidad_periodo, 3)}</td><td class="num">${expFmtNum(r.cantidad_acumulada, 3)}</td><td class="num">${f(r.precio_unitario)}</td><td class="num">${f(r.monto_periodo)}</td></tr>`; }).join('')
      }</tbody><tfoot><tr><th colspan="7">Total del periodo</th><th class="num">${f(p.rubros.reduce((s, r) => s + (Number(r.monto_periodo) || 0), 0))}</th></tr></tfoot></table>
      <p class="nota">Precios unitarios tal como quedaron guardados en la planilla (no los vigentes del presupuesto).</p>` : vacio('La planilla no tiene rubros registrados')) : '';
      const indices = p.reajuste_indices && typeof p.reajuste_indices === 'object'
        ? Object.entries(p.reajuste_indices).map(([k, v]) => `${e(k)} = ${expFmtNum(v, 4)}`).join(' · ') : '';
      const desglose = `<table class="tabla kv desglose"><tbody>
        <tr><th>Bruto del periodo</th><td class="num">${f(p.total_monto)}</td></tr>
        <tr><th>Reajuste${p.reajuste_factor ? ` (factor ${expFmtNum(p.reajuste_factor, 4)}${indices ? `; índices: ${indices}` : ''})` : ''}</th><td class="num">${f(p.reajuste_monto)}</td></tr>
        <tr><th>Amortización del anticipo</th><td class="num">${f(-(Number(p.amortizacion_anticipo) || 0))}</td></tr>
        <tr><th>Retención de garantía</th><td class="num">${f(-(Number(p.retencion_garantia) || 0))}</td></tr>
        <tr><th>Multa${p.multa_concepto ? ` (${e(p.multa_concepto)})` : ''}</th><td class="num">${f(-(Number(p.multa_monto) || 0))}</td></tr>
        <tr><th>IVA informativo (${expFmtPct(ivaPct, 0)}, no incluido)</th><td class="num">${f((Number(p.total_monto) || 0) * ivaPct / 100)}</td></tr>
        <tr class="total"><th>Líquido a pagar</th><td class="num">${f(p.total_liquido ?? p.total_monto)}</td></tr>
      </tbody></table>`;
      const hist = (p.historial || []).length ? `<h3 class="sub-sub">Historial</h3><ul class="lista">${
        p.historial.map(h => `<li>${expFmtFechaHora(h.created_at)} · ${e(h.accion)} · ${e(nombre(h.autor_id))}${h.comentario ? ` — ${e(h.comentario)}` : ''}</li>`).join('')
      }</ul>` : '';
      return `<section class="sub" id="planilla-${p.id}">
        ${sub('planillas', k + 1, `Planilla N° ${p.numero}`)}
        ${cab}${detalle}${desglose}${hist}
      </section>`;
    }).join('');
    return `<section class="sec" id="sec-planillas">${titulo('planillas', 'Planillas de pago')}${resumen}</section>${docs}`;
  };

  // 7. Actas de recepción
  S.actas = () => {
    const firmas = firmasCierre(proy);
    const bloqueFirmas = `<div class="firmas">${firmas.map(fi => `<div class="fb"><div class="lf"></div><div class="firma-rol">${e(fi[0])}</div><div class="firma-nombre">${e(fi[1])}</div></div>`).join('')}</div>`;
    const partes = ['provisional', 'definitiva'].map((tipo, k) => {
      const a = (datos.actas || []).find(x => x.tipo === tipo);
      return `<section class="sub doc-cierre" id="acta-${tipo}">
        ${sub('actas', k + 1, `Acta de recepción ${tipo}`)}
        ${a ? (a.contenido_html
          ? `<p class="nota"><b>Acta según texto guardado el ${expFmtFechaHora(a.contenido_actualizado_en)}</b> (editado en la ventana de impresión; incluye las firmas tal como se guardaron).</p><div class="doc-cierre-cuerpo acta-guardada">${sanitizarHtmlActa(a.contenido_html)}</div>`
          : `<div class="doc-cierre-cuerpo">${actaCuerpoHTML(a, proy)}</div>${bloqueFirmas}<p class="nota">Texto generado a partir de los datos registrados (fecha, lugar, asistentes y observaciones).</p>`)
          + (a.archivo_url ? '<p class="nota">El acta firmada está adjunta en la plataforma.</p>' : '') : vacio('No emitida a la fecha de generación')}
      </section>`;
    });
    return `<section class="sec" id="sec-actas">${titulo('actas', 'Actas de recepción')}</section>${partes.join('')}`;
  };

  // 8. Liquidación
  S.liquidacion = () => {
    const liq = datos.liquidacion;
    const firmas = firmasCierre(proy);
    return `<section class="sec doc-cierre" id="sec-liquidacion">
      ${titulo('liquidacion', 'Liquidación')}
      ${liq ? `<table class="tabla kv"><tbody><tr><th>Fecha de liquidación</th><td>${expFmtFecha(liq.fecha)}</td></tr><tr><th>Estado del proyecto</th><td>${e(estadoCierre)}</td></tr><tr><th>Registrada por</th><td>${e((datos.perfiles || {})[liq.creado_por] || '—')}</td></tr>${liq.observaciones ? `<tr><th>Observaciones</th><td>${expParrafo(liq.observaciones)}</td></tr>` : ''}</tbody></table>
      <div class="doc-cierre-cuerpo">${liquidacionCuerpoHTML(liq, proy)}</div>
      <div class="firmas">${firmas.map(fi => `<div class="fb"><div class="lf"></div><div class="firma-rol">${e(fi[0])}</div><div class="firma-nombre">${e(fi[1])}</div></div>`).join('')}</div>` : vacio('Pendiente de liquidación')}
    </section>`;
  };

  Object.assign(S, expedienteSeccionesFase2(datos, seleccion, meta, { e, f, titulo, sub, vacio, numero }));
  const cuerpo = activas.map(clave => S[clave] ? S[clave]() : '').join('\n');
  const pie = `Expediente v${version} · HidivoGdP · generado ${e(fechaTexto)}`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(nombreArchivo)}</title>
<style>${expedienteCSS()}</style>
</head>
<body class="${calc.parcial ? 'parcial' : 'final'}">
<div class="ui-barra">
  <button type="button" id="btnImprimir" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
  <span>A4, márgenes predeterminados, activar «Gráficos de fondo». Nombre sugerido: ${e(nombreArchivo)}.pdf</span>
  <span class="fotos-estado" id="fotosEstado"></span>
</div>
<header class="enc-pagina"><img src="${logo}" alt="HIDIVO"><span class="enc-proyecto">${e(proy.nombre || '')}</span><span class="enc-version">Expediente v${version}</span></header>
<footer class="pie-pagina">${pie}</footer>
${calc.parcial ? '<div class="marca-agua" aria-hidden="true">EXPEDIENTE PARCIAL – PROYECTO EN EJECUCIÓN</div>' : ''}
<main>
${cuerpo}
</main>
<script>${expedienteScriptCarga()}</script>
</body>
</html>`;
}

// CSS del documento (inline en el HTML generado). A4, encabezado y pie fijos que
// Chrome repite en cada página impresa, marca de agua, tablas con thead
// repetido y filas sin partir. Los estilos .oc-doc replican los del documento
// formal de la orden de cambio para que el cuerpo incrustado se vea igual.
function expedienteCSS(){
  return `
@page { size: A4; margin: 18mm 15mm 20mm 15mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #323338; background: #fff; line-height: 1.4; }
main { max-width: 190mm; margin: 0 auto; padding: 22mm 6mm 16mm; }
h1, h2, h3 { margin: 0 0 8px; color: #1a1a2e; }
.sec-titulo { font-size: 17pt; color: #0073ea; border-bottom: 3px solid #0073ea; padding-bottom: 6px; margin-bottom: 14px; }
.sub-titulo { font-size: 13pt; margin-top: 14px; }
.sub-sub { font-size: 11pt; margin-top: 12px; color: #676879; text-transform: uppercase; letter-spacing: .5px; }
.sec, .sub { break-before: page; page-break-before: always; }
.sec.portada { break-before: auto; page-break-before: auto; }
.tabla { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 9.5pt; }
.tabla th, .tabla td { border: 1px solid #e6e9ef; padding: 4px 6px; vertical-align: top; text-align: left; }
.tabla thead th { background: #1a1a2e; color: #fff; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .3px; }
.tabla tfoot th { background: #f0f7ff; font-weight: 700; }
.tabla thead { display: table-header-group; }
.tabla tr { break-inside: avoid; page-break-inside: avoid; }
.tabla.kv th { width: 34%; background: #f5f6f8; color: #323338; font-weight: 600; }
.tabla.kv-anidada { margin: 0; }
.tabla.kv-anidada th { width: 40%; }
.tabla .num, .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.tabla .centro, .centro { text-align: center; }
.tabla.desglose th { width: 60%; }
.tabla.desglose tr.total th, .tabla.desglose tr.total td { background: #e6f4ee; font-weight: 800; font-size: 11pt; }
.lista { margin: 4px 0 8px 18px; padding: 0; }
.indice { font-size: 11pt; line-height: 1.7; }
.indice-sub { font-size: 9.5pt; line-height: 1.5; margin: 2px 0 6px 18px; color: #676879; }
.nota { font-size: 8.5pt; color: #676879; margin: 4px 0 10px; }
.aviso { color: #b8860b; font-weight: 600; font-size: 9pt; }
.vacio { background: #f5f6f8; border-radius: 8px; padding: 12px 14px; color: #676879; font-style: italic; }
.etq { display: inline-block; font-size: 7.5pt; background: #fdf6e3; color: #b8860b; border-radius: 8px; padding: 0 6px; font-weight: 700; white-space: nowrap; }
.pildora { display: inline-block; border-radius: 10px; padding: 1px 8px; font-size: 8.5pt; font-weight: 700; white-space: nowrap; }
/* Portada */
.portada { text-align: center; padding-top: 30mm; }
.portada-logo img { height: 28mm; object-fit: contain; }
.portada-titulo { font-size: 26pt; font-weight: 800; letter-spacing: 3px; color: #0073ea; margin: 14mm 0 4mm; }
.portada-subtitulo { font-size: 13pt; color: #676879; margin-bottom: 6mm; }
.portada-proyecto { font-size: 16pt; font-weight: 700; margin: 0 0 10mm; }
.portada-partes { max-width: 140mm; margin: 0 auto 8mm; text-align: left; }
.portada-meta { font-size: 9.5pt; color: #676879; margin-bottom: 14mm; }
.portada .sub-titulo { text-align: left; break-before: page; page-break-before: always; }
.portada .tabla.kv { text-align: left; }
/* Encabezado y pie repetidos (position:fixed) */
.enc-pagina { position: fixed; top: 0; left: 0; right: 0; height: 14mm; display: flex; align-items: center; gap: 10px; padding: 0 6mm; border-bottom: 1px solid #e6e9ef; background: #fff; font-size: 8.5pt; color: #676879; }
.enc-pagina img { height: 9mm; object-fit: contain; }
.enc-proyecto { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; color: #323338; }
.pie-pagina { position: fixed; bottom: 0; left: 0; right: 0; height: 10mm; display: flex; align-items: center; justify-content: center; font-size: 8pt; color: #676879; border-top: 1px solid #e6e9ef; background: #fff; }
.marca-agua { position: fixed; top: 45%; left: 0; right: 0; text-align: center; transform: rotate(-30deg); font-size: 34pt; font-weight: 800; color: rgba(226, 68, 92, .13); letter-spacing: 2px; pointer-events: none; z-index: 5; }
${expedienteCSSFase2()}
/* Barra de pantalla (no se imprime) */
.ui-barra { position: fixed; top: 14mm; right: 8mm; z-index: 10; display: flex; align-items: center; gap: 10px; background: #1a1a2e; color: #fff; border-radius: 10px; padding: 8px 12px; font-size: 9pt; box-shadow: 0 6px 20px rgba(0,0,0,.25); max-width: 70%; }
.ui-barra button { background: #0073ea; color: #fff; border: 0; border-radius: 8px; padding: 8px 14px; font-weight: 700; cursor: pointer; font-size: 10pt; }
/* Documentos incrustados: orden de cambio (mismos estilos que imprimirOC) */
.oc-doc .encabezado { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 3px solid #0073ea; padding-bottom: 12px; margin-bottom: 16px; }
.oc-doc .encabezado img { height: 56px; object-fit: contain; }
.oc-doc h1 { font-size: 18px; color: #0073ea; margin: 0 0 4px 0; }
.oc-doc .sub { font-size: 11px; color: #676879; margin: 0; }
.oc-doc .grid-info { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 14px; }
.oc-doc .info-box { background: #f5f6f8; border-radius: 6px; padding: 8px 10px; }
.oc-doc .info-label { font-size: 9px; color: #676879; letter-spacing: .5px; text-transform: uppercase; }
.oc-doc .info-value { font-size: 12px; font-weight: 700; }
.oc-doc .marca-borrador { color: #b8860b; border: 2px dashed #b8860b; border-radius: 8px; padding: 4px 14px; font-weight: 800; font-size: 13px; }
.oc-doc table { width: 100%; border-collapse: collapse; margin-top: 6px; }
.oc-doc thead td { background: #1a1a2e; color: #fff; font-size: 10px; font-weight: 700; padding: 7px 8px; }
.oc-doc thead { display: table-header-group; }
.oc-doc tr { break-inside: avoid; page-break-inside: avoid; }
.oc-doc .resumen { margin-top: 14px; margin-left: auto; width: 320px; font-size: 12px; }
.oc-doc .resumen div { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #e6e9ef; }
.oc-doc .firmas, .doc-cierre .firmas { display: flex; justify-content: space-between; gap: 16px; margin-top: 64px; break-inside: avoid; page-break-inside: avoid; }
.oc-doc .firma-box, .doc-cierre .fb { flex: 1; text-align: center; }
.oc-doc .linea-firma, .doc-cierre .lf { border-top: 1px solid #323338; margin-bottom: 6px; }
.oc-doc .firma-rol, .doc-cierre .firma-rol { font-size: 12px; font-weight: 700; }
.oc-doc .firma-nombre, .doc-cierre .firma-nombre { font-size: 11px; color: #676879; }
.doc-cierre-cuerpo { margin-top: 10px; }
@media screen { body { background: #e9ecf1; } main { background: #fff; box-shadow: 0 0 0 1px #d8dbe2; margin: 16mm auto 14mm; } }
@media print {
  .ui-barra { display: none !important; }
  body { background: #fff; }
  main { box-shadow: none; margin: 0 auto; padding: 16mm 0 12mm; }
  .enc-pagina, .pie-pagina { background: transparent; }
}
`;
}

// ── 3.5) Vista previa (navegador) ───────────────────────────────────────────
// Crea un Blob con el HTML y lo abre en una pestaña nueva. No escribe sobre el
// documento actual. Si el navegador bloquea la ventana, devuelve ventana = null
// y la URL del Blob para que quien llama muestre un enlace.
function expedientePrevisualizar(html, nombreArchivo){
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  let ventana = null;
  try{ ventana = window.open(url, '_blank'); }catch(_){ ventana = null; }
  if(ventana){
    try{ ventana.document.title = nombreArchivo; }catch(_){ /* distinto origen hasta cargar: el <title> del HTML ya lo lleva */ }
  }
  return { ventana, url, nombreArchivo };
}

// ── SST: acta de entrega-recepción de EPP (cuerpo) ───────────────────────────
function renderActaEppCuerpoHTML(reg){
  return `
    <p style="font-size:12px">En cumplimiento del Decreto Ejecutivo 255 (Art. 15) y del Acuerdo Ministerial MDT-2024-196 (Art. 4 num. 10), se deja constancia de la entrega gratuita del siguiente equipo de protección personal:</p>
    <table style="${sstEstiloTabla}">
      ${sstFilaDato('Trabajador', reg.trabajador_nombre)}
      ${sstFilaDato('Cédula', reg.trabajador_cedula)}
      ${sstFilaDato('Puesto de trabajo', reg.puesto)}
      ${sstFilaDato('Fecha de entrega', formatFecha(reg.fecha_entrega))}
      ${sstFilaDato('Detalle del EPP entregado', reg.detalle_epp)}
    </table>
    <p style="font-size:11px;color:#444">El trabajador declara haber recibido el EPP detallado en buen estado, así como la instrucción sobre su uso, mantenimiento y disposición final, y se compromete a utilizarlo conforme a la capacitación recibida (Acuerdo MDT-2024-196, Art. 6).</p>`;
}

// ── SST: registro de asistencia a capacitación (cuerpo) ──────────────────────
const SST_TIPO_CAPACITACION = {induccion:'Inducción', reinduccion:'Re-inducción', capacitacion:'Capacitación', simulacro:'Simulacro'};
function renderCapacitacionCuerpoHTML(cap, asistentes){
  const tipoLabel = SST_TIPO_CAPACITACION;
  return `
    <table style="${sstEstiloTabla}">
      ${sstFilaDato('Tema', cap.tema)}
      ${sstFilaDato('Tipo', tipoLabel[cap.tipo]||cap.tipo)}
      ${sstFilaDato('Fecha', formatFecha(cap.fecha))}
      ${sstFilaDato('Duración', cap.duracion_horas?cap.duracion_horas+' horas':'—')}
      ${sstFilaDato('Responsable / instructor', cap.responsable)}
      ${sstFilaDato('Metodología', cap.metodologia)}
    </table>
    <h3 style="font-size:13px;margin:16px 0 6px">Registro de asistencia</h3>
    <table style="${sstEstiloTabla}">
      <tr><th style="${sstEstiloTh}">N°</th><th style="${sstEstiloTh}">Nombre</th><th style="${sstEstiloTh}">Cédula</th><th style="${sstEstiloTh}">Puesto</th><th style="${sstEstiloTh};width:120px">Firma</th></tr>
      ${(asistentes||[]).map((a,i)=>`<tr>
        <td style="${sstEstiloTd}">${i+1}</td>
        <td style="${sstEstiloTd}">${escapeHtml(a.nombre)}</td>
        <td style="${sstEstiloTd}">${escapeHtml(a.cedula||'')}</td>
        <td style="${sstEstiloTd}">${escapeHtml(a.puesto||'')}</td>
        <td style="${sstEstiloTd}"></td>
      </tr>`).join('')}
      ${!(asistentes||[]).length?`<tr><td colspan="5" style="${sstEstiloTd};text-align:center;color:#777">Sin asistentes registrados</td></tr>`:''}
    </table>
    <p style="font-size:11px;color:#444">Registro conforme al Acuerdo Ministerial MDT-2024-196 (Art. 4 num. 6) y a la Lista de Verificación SST del MDT (Gestión del Talento Humano, ítems 6-10).</p>`;
}

// ── SST: informe de investigación de incidente/accidente (cuerpo) ────────────
const SST_TIPO_INCIDENTE = {incidente:'Incidente', accidente:'Accidente de trabajo', enfermedad_profesional:'Presunción de enfermedad profesional'};
function renderIncidenteCuerpoHTML(x){
  const tipoLabel = SST_TIPO_INCIDENTE;
  const fh = new Date(x.fecha_hora);
  return `
    <table style="${sstEstiloTabla}">
      ${sstFilaDato('Tipo de evento', tipoLabel[x.tipo]||x.tipo)}
      ${sstFilaDato('Fecha y hora', fh.toLocaleDateString('es-EC')+' '+fh.toLocaleTimeString('es-EC',{hour:'2-digit',minute:'2-digit'}))}
      ${sstFilaDato('Trabajador', x.trabajador_nombre)}
      ${sstFilaDato('Cédula', x.trabajador_cedula)}
      ${sstFilaDato('Puesto de trabajo', x.puesto)}
      ${sstFilaDato('Lugar del evento', x.lugar)}
      ${sstFilaDato('Gravedad', x.gravedad)}
    </table>
    <h3 style="font-size:13px;margin:14px 0 4px">Descripción del evento</h3>
    <p style="font-size:12px;border:1px solid #ccc;padding:8px;min-height:50px">${escapeHtml(x.descripcion||'')}</p>
    <h3 style="font-size:13px;margin:14px 0 4px">Testigos</h3>
    <p style="font-size:12px;border:1px solid #ccc;padding:8px">${escapeHtml(x.testigos||'—')}</p>
    <h3 style="font-size:13px;margin:14px 0 4px">Análisis de causas</h3>
    <p style="font-size:12px;border:1px solid #ccc;padding:8px;min-height:40px">${escapeHtml(x.causas||'')}</p>
    <h3 style="font-size:13px;margin:14px 0 4px">Acciones inmediatas adoptadas</h3>
    <p style="font-size:12px;border:1px solid #ccc;padding:8px">${escapeHtml(x.acciones_inmediatas||'—')}</p>
    <h3 style="font-size:13px;margin:14px 0 4px">Acciones correctivas y preventivas</h3>
    <p style="font-size:12px;border:1px solid #ccc;padding:8px">${escapeHtml(x.acciones_correctivas||'—')}</p>
    <table style="${sstEstiloTabla}">
      ${sstFilaDato('Plazo legal de aviso al IESS (10 días hábiles)', x.fecha_limite_reporte_iess?formatFecha(x.fecha_limite_reporte_iess):'—')}
      ${sstFilaDato('Reportado al IESS', x.reportado_iess?('Sí'+(x.fecha_reporte_iess?' — '+formatFecha(x.fecha_reporte_iess):'')):'No')}
    </table>
    <p style="font-size:11px;color:#444">Informe de investigación conforme a la Resolución C.D. 513 del IESS (Art. 44-45 y Anexo B) y al Acuerdo Ministerial MDT-2024-196 (Art. 4 num. 7).</p>`;
}

// ── SST: permiso de trabajo especial (cuerpo) ────────────────────────────────
function renderPteCuerpoHTML(p){
  return `
    <table style="${sstEstiloTabla}">
      ${sstFilaDato('N° de permiso', 'PTE-'+String(p.numero).padStart(3,'0'))}
      ${sstFilaDato('Tipo de trabajo especial', (PTE_TIPOS[p.tipo]||p.tipo).replace(/^[^\s]+\s/,''))}
      ${sstFilaDato('Fecha (vigencia: una jornada, no renovable)', formatFecha(p.fecha))}
      ${sstFilaDato('Horario', (p.hora_inicio?p.hora_inicio.slice(0,5):'—')+' a '+(p.hora_fin_prevista?p.hora_fin_prevista.slice(0,5):'—'))}
      ${sstFilaDato('Ubicación', p.ubicacion)}
      ${sstFilaDato('Descripción del trabajo', p.descripcion_trabajo)}
      ${sstFilaDato('Riesgos identificados', p.riesgos)}
      ${sstFilaDato('Medidas de control', p.medidas_control)}
      ${sstFilaDato('EPP requerido', p.epp_requerido)}
      ${p.plan_rescate?sstFilaDato('Plan de rescate', p.plan_rescate):''}
    </table>
    <h3 style="font-size:13px;margin:14px 0 4px">Cuadrilla autorizada (firma obligatoria de todos)</h3>
    <table style="${sstEstiloTabla}">
      <tr><th style="${sstEstiloTh}">N°</th><th style="${sstEstiloTh}">Nombre</th><th style="${sstEstiloTh}">Cédula</th><th style="${sstEstiloTh};width:120px">Firma</th></tr>
      ${(p.trabajadores||[]).map((t,i)=>`<tr>
        <td style="${sstEstiloTd}">${i+1}</td>
        <td style="${sstEstiloTd}">${escapeHtml(t.nombre||'')}</td>
        <td style="${sstEstiloTd}">${escapeHtml(t.cedula||'')}</td>
        <td style="${sstEstiloTd}"></td>
      </tr>`).join('')}
    </table>
    ${p.estado==='cerrado'?`<table style="${sstEstiloTabla}">
      ${sstFilaDato('Cierre del permiso', p.hora_cierre?new Date(p.hora_cierre).toLocaleString('es-EC'):'')}
      ${sstFilaDato('Observaciones de cierre', p.observaciones_cierre)}
    </table>`:''}
    ${p.estado==='anulado'?`<table style="${sstEstiloTabla}">${sstFilaDato('ANULADO — motivo', p.motivo_anulacion)}</table>`:''}
    <p style="font-size:11px;color:#444">Permiso emitido conforme al Decreto Ejecutivo 255 (Art. 58) y a la Norma Técnica de Seguridad e Higiene del Trabajo (Anexo 3 del A.M. MDT-2024-196, Art. 110-115). Este permiso caduca al término de la jornada y se anula automáticamente si cambian las condiciones físicas o climáticas del sitio o la conformación del grupo de trabajo.</p>`;
}

// ── 3.6) Fase 2: fotos, secciones nuevas y script de carga ──────────────────

// Lotes de ids para consultas `in` (URL corta y paginación por lote).
async function expedienteEnLotes(ids, consulta, tam = 100){
  const filas = [];
  for(let i = 0; i < ids.length; i += tam){
    const lote = ids.slice(i, i + tam);
    filas.push(...await expedienteSelectTodo(() => consulta(lote)));
  }
  return filas;
}

// URLs de una foto para el documento. `url` es lo guardado en la fila (URL pública
// completa de Storage, o un data URI en pruebas). Devuelve { url, path, urlRender,
// noDisponible }: urlRender es la transformación de Storage (900 px o 1200 px,
// calidad 70) pedida con getPublicUrl(path, { transform }); el path se obtiene
// decodificando lo que sigue a /object/public/{bucket}/ y getPublicUrl lo vuelve a
// codificar. HEIC/HEIF no lo transforma Storage ni lo muestra Chrome: va directo al
// recuadro «Foto no disponible (formato HEIC)». Nunca se descarga nada aquí.
function expedienteFotoUrls(url, calidad, cliente){
  const u = String(url || '');
  if(!u) return { url: u, path: null, urlRender: null, noDisponible: 'sin URL' };
  if(u.startsWith('data:')) return { url: u, path: null, urlRender: u, noDisponible: null };
  const m = u.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+?)(\?.*)?$/);
  if(!m) return { url: u, path: null, urlRender: u, noDisponible: null };
  let path = m[2];
  try{ path = decodeURIComponent(path); }catch(_){ /* se deja tal cual */ }
  if(/\.(heic|heif)$/i.test(path)) return { url: u, path, urlRender: null, noDisponible: 'formato HEIC' };
  const width = calidad === 'alta' ? 1200 : 900;
  let urlRender = u;
  try{
    const r = cliente?.storage?.from(m[1]).getPublicUrl(path, { transform: { width, quality: 70 } });
    if(r?.data?.publicUrl) urlRender = r.data.publicUrl;
  }catch(_){ /* sin cliente: se usa la URL original */ }
  return { url: u, path, urlRender, noDisponible: null };
}

// Carga de las secciones de la fase 2 (solo las seleccionadas). Añade a `datos`:
// libro, observaciones, ensayos, formatos, sst, subcontratos, cronograma (filas),
// amplía `perfiles` y cuenta `imagenesOrigen` (fotos distintas de Storage).
async function expedienteCargarFase2(datos, proyectoId, seleccion, c, opciones){
  const activas = new Set(expedienteSeccionesActivas(seleccion));
  const filtros = seleccion?.filtros || {};
  const calidad = filtros.calidadFotos === 'alta' ? 'alta' : 'estandar';
  const progreso = typeof opciones.onProgreso === 'function' ? opciones.onProgreso : () => {};
  const todo = (tabla, armar) => expedienteSelectTodo(() => armar(c.from(tabla).select('*')));
  const idsPerfil = new Set();
  const foto = url => expedienteFotoUrls(url, calidad, c);
  const fotosDistintas = new Set();
  const contarFoto = f => { if(f.path) fotosDistintas.add(f.path); };

  // Libro de obra: registros del rango, fotos y rubros por lotes.
  if(activas.has('libro_obra')){
    progreso('Cargando libro de obra…');
    let registros = await todo('libro_obra', q => {
      q = q.eq('proyecto_id', proyectoId);
      if(filtros.libroDesde) q = q.gte('fecha', filtros.libroDesde);
      if(filtros.libroHasta) q = q.lte('fecha', filtros.libroHasta);
      return q.order('fecha').order('numero_registro');
    });
    const ids = registros.map(r => r.id);
    progreso(`Cargando fotos del libro (${registros.length} registros)…`);
    const fotos = await expedienteEnLotes(ids, lote => c.from('libro_obra_fotos').select('*').in('registro_id', lote).order('registro_id').order('orden'));
    const rubrosLibro = await expedienteEnLotes(ids, lote => c.from('libro_obra_rubros').select('*').in('registro_id', lote));
    const rubrosMap = {};
    (datos.rubros || []).forEach(r => { rubrosMap[r.id] = r; });
    registros.forEach(r => { idsPerfil.add(r.created_by); idsPerfil.add(r.aprobado_por); });
    datos.libro = registros.map(r => ({
      ...r,
      fotos: fotos.filter(f => f.registro_id === r.id).map(f => { const u = foto(f.url); contarFoto(u); return { ...f, ...u }; }),
      rubros: rubrosLibro.filter(x => x.registro_id === r.id).map(x => ({ ...x, rubros: rubrosMap[x.rubro_id] ? { codigo: rubrosMap[x.rubro_id].codigo, descripcion: rubrosMap[x.rubro_id].descripcion, unidad: rubrosMap[x.rubro_id].unidad, precio_unitario: rubrosMap[x.rubro_id].precio_unitario } : null }))
    }));
  }

  // Observaciones con respuestas, fotos y plano.
  if(activas.has('observaciones')){
    progreso('Cargando observaciones…');
    let obs = await todo('observaciones', q => {
      q = q.eq('proyecto_id', proyectoId);
      if(filtros.observaciones === 'resueltas') q = q.eq('estado', 'resuelta');
      return q.order('numero').order('created_at');
    });
    const ids = obs.map(o => o.id);
    const [resps, fotos, planos] = await Promise.all([
      expedienteEnLotes(ids, lote => c.from('observacion_respuestas').select('*').in('observacion_id', lote).order('created_at')),
      expedienteEnLotes(ids, lote => c.from('observacion_fotos').select('*').in('observacion_id', lote).order('created_at')),
      todo('planos', q => q.eq('proyecto_id', proyectoId))
    ]);
    const planoNombre = {};
    planos.forEach(p => { planoNombre[p.id] = p.nombre; });
    obs.forEach(o => idsPerfil.add(o.creado_por));
    resps.forEach(r => idsPerfil.add(r.autor_id));
    datos.observaciones = obs.map(o => ({
      ...o,
      plano_nombre: o.plano_id ? (planoNombre[o.plano_id] || 'Plano') : null,
      fotos: fotos.filter(f => f.observacion_id === o.id).map(f => { const u = foto(f.url); contarFoto(u); return { ...f, ...u }; }),
      respuestas: resps.filter(r => r.observacion_id === o.id).map(r => {
        const esImagen = /\.(jpe?g|png|webp|jfif)(\?|$)/i.test(String(r.archivo_nombre || r.archivo_url || ''));
        const u = esImagen && r.archivo_url ? foto(r.archivo_url) : null;
        if(u) contarFoto(u);
        return { ...r, adjunto: r.archivo_url ? (esImagen ? { tipo: 'foto', ...u } : { tipo: 'archivo', nombre: r.archivo_nombre || 'archivo', url: r.archivo_url }) : null };
      })
    }));
  }

  // Ensayos: especificaciones, tipos y resultados enriquecidos.
  if(activas.has('ensayos')){
    progreso('Cargando ensayos…');
    const [ens, especs, tipos] = await Promise.all([
      todo('ensayos', q => q.eq('proyecto_id', proyectoId).order('numero')),
      todo('ensayo_especificaciones', q => q.eq('proyecto_id', proyectoId).order('created_at')),
      todo('ensayo_tipos', q => q.order('nombre'))
    ]);
    ens.forEach(e => idsPerfil.add(e.creado_por));
    datos.ensayos = { especificaciones: especs.map(esp => ({ ...esp, tipo: tipos.find(t => t.id === esp.tipo_id) || null })), lista: enriquecerEnsayos(ens, especs, tipos) };
  }

  // Formatos de calidad: listado con referencia (no el formato completo).
  if(activas.has('formatos_calidad')){
    progreso('Cargando formatos de calidad…');
    const [asig, resp] = await Promise.all([
      todo('formatos_calidad_asignaciones', q => q.eq('proyecto_id', proyectoId)),
      todo('formatos_calidad_respuestas', q => q.eq('proyecto_id', proyectoId).order('created_at'))
    ]);
    const idsPl = [...new Set([...asig.map(a => a.plantilla_id), ...resp.map(r => r.plantilla_id)].filter(Boolean))];
    const plantillas = idsPl.length ? await expedienteEnLotes(idsPl, lote => c.from('formatos_calidad_plantillas').select('*').in('id', lote)) : [];
    const fotos = resp.length ? await expedienteEnLotes(resp.map(r => r.id), lote => c.from('formatos_calidad_fotos').select('*').in('respuesta_id', lote)) : [];
    resp.forEach(r => { idsPerfil.add(r.residente_id); idsPerfil.add(r.corregido_por); });
    const nombrePl = {}; plantillas.forEach(p => { nombrePl[p.id] = p.nombre; });
    datos.formatos = {
      plantillas: asig.map(a => ({ ...a, nombre: nombrePl[a.plantilla_id] || 'Formato' })),
      respuestas: resp.map(r => ({ ...r, plantilla_nombre: nombrePl[r.plantilla_id] || 'Formato', fotos: fotos.filter(f => f.respuesta_id === r.id).length }))
    };
  }

  // SST: tablas con datos; exámenes solo agregados (sin nombres ni resultados).
  if(activas.has('sst')){
    progreso('Cargando SST…');
    const porProy = tabla => todo(tabla, q => q.eq('proyecto_id', proyectoId));
    const [config, riesgos, eppMatriz, eppEntregas, caps, checklist, examMatriz, examRegs, incidentes, ptes] = await Promise.all([
      expedienteUna(c.from('sst_config').select('*').eq('proyecto_id', proyectoId).maybeSingle()),
      porProy('sst_matriz_riesgos'), porProy('sst_epp_matriz'), porProy('sst_epp_entregas'), porProy('sst_capacitaciones'),
      porProy('sst_checklist_respuestas'), porProy('sst_examenes_matriz'),
      todo('sst_examenes_registros', q => q.eq('proyecto_id', proyectoId).select('tipo,fecha_examen,fecha_proximo')),
      porProy('sst_incidentes'), porProy('sst_pte')
    ]);
    const asistentes = caps.length ? await expedienteEnLotes(caps.map(x => x.id), lote => c.from('sst_capacitacion_asistentes').select('*').in('capacitacion_id', lote).order('created_at')) : [];
    datos.sst = {
      config: config || null, riesgos, eppMatriz,
      eppEntregas: eppEntregas.map(x => ({ ...x, foto: x.foto_url ? (() => { const u = foto(x.foto_url); contarFoto(u); return u; })() : null })),
      capacitaciones: caps.map(x => ({ ...x, asistentes: asistentes.filter(a => a.capacitacion_id === x.id) })),
      checklist, examMatriz,
      // Solo lo agregable: tipo y fechas; nunca nombre, cédula, aptitud ni observaciones (datos de salud).
      examRegistros: examRegs.map(x => ({ tipo: x.tipo, fecha_examen: x.fecha_examen, fecha_proximo: x.fecha_proximo })),
      incidentes: incidentes.map(x => ({ ...x, foto: x.foto_url ? (() => { const u = foto(x.foto_url); contarFoto(u); return u; })() : null })),
      ptes
    };
  }

  // Subcontratistas.
  if(activas.has('subcontratistas')){
    progreso('Cargando subcontratos…');
    const subcontratos = await todo('subcontratos', q => q.eq('proyecto_id', proyectoId).order('created_at'));
    const idsSc = [...new Set(subcontratos.map(s => s.subcontratista_id).filter(Boolean))];
    const [scs, scRubros] = await Promise.all([
      idsSc.length ? expedienteEnLotes(idsSc, lote => c.from('subcontratistas').select('*').in('id', lote)) : [],
      subcontratos.length ? expedienteEnLotes(subcontratos.map(s => s.id), lote => c.from('subcontrato_rubros').select('*').in('subcontrato_id', lote)) : []
    ]);
    const rubrosMap = {}; (datos.rubros || []).forEach(r => { rubrosMap[r.id] = r; });
    datos.subcontratos = subcontratos.map(s => ({
      ...s, subcontratista: scs.find(x => x.id === s.subcontratista_id) || null,
      rubros: scRubros.filter(x => x.subcontrato_id === s.id).map(x => rubrosMap[x.rubro_id]).filter(Boolean).map(r => ({ codigo: r.codigo, descripcion: r.descripcion }))
    }));
  }

  // Cronograma: líneas base y filas de la activa. Los indicadores y la imagen de la
  // Curva S los añade la app (datos.cronograma.indicadores / imagen) tras esta carga.
  if(activas.has('cronograma')){
    progreso('Cargando cronograma…');
    const lbs = await todo('lineas_base', q => q.eq('proyecto_id', proyectoId).order('numero'));
    const activa = lbs.find(l => l.activa) || null;
    const filas = await todo('cronograma_rubros', q => activa ? q.eq('proyecto_id', proyectoId).eq('linea_base_id', activa.id) : q.eq('proyecto_id', proyectoId));
    lbs.forEach(l => idsPerfil.add(l.creado_por));
    datos.cronograma = Object.assign(datos.cronograma || {}, { lineasBase: lbs, activa, filas });
  }

  // Nombres de usuarios que faltaban.
  const faltan = [...idsPerfil].filter(id => id && !(datos.perfiles || {})[id]);
  if(faltan.length){
    const perfiles = await expedienteEnLotes(faltan, lote => c.from('perfiles').select('id,nombre,apellido').in('id', lote));
    datos.perfiles = datos.perfiles || {};
    perfiles.forEach(p => { datos.perfiles[p.id] = `${p.nombre || ''} ${p.apellido || ''}`.trim() || 'Usuario'; });
  }
  datos.imagenesOrigen = fotosDistintas.size;
  return datos;
}

// ── Fotos en el documento ───────────────────────────────────────────────────
// Dos por fila; cada figura y su pie no se parten. Pie: «Foto n/N · fecha · ref»
// y la descripción si la hay. Las no disponibles (HEIC) salen como recuadro
// desde el principio; las que fallen al cargar las reemplaza el script inline.
function expFotosHTML(fotos, ref, fecha){
  const lista = fotos || [];
  if(!lista.length) return '';
  const N = lista.length;
  return `<div class="fotos">${lista.map((f, i) => {
    const pie = `Foto ${i + 1}/${N} · ${expFmtFecha(fecha)} · ${expEsc(ref)}${f.descripcion ? ' · ' + expEsc(f.descripcion) : ''}`;
    if(f.noDisponible || !f.urlRender){
      return `<figure class="foto no-disponible"><div class="foto-caja">Foto no disponible (${expEsc(f.noDisponible || 'sin imagen')})<br><small>${expEsc(f.path || f.url || '')}</small></div><figcaption>${pie}</figcaption></figure>`;
    }
    return `<figure class="foto"><img src="${expEsc(f.urlRender)}" data-ruta="${expEsc(f.path || '')}" alt="${expEsc(ref)}" loading="eager"><figcaption>${pie}</figcaption></figure>`;
  }).join('')}</div>`;
}

// Script inline del documento (autocontenido): cuenta las imágenes, muestra
// «Fotos cargadas n/N», espera decode() (o load/error), reemplaza las fallidas por
// «Foto no disponible · ruta», habilita «Imprimir / Guardar PDF» al terminar (o
// «Imprimir de todos modos» a los 60 s) y marca documentElement.dataset.listo = '1'
// para que Puppeteer (fase 3) sepa cuándo imprimir. Sin fotos, listo de inmediato.
function expedienteScriptCarga(){
  return `(function(){
  var imgs = Array.prototype.slice.call(document.querySelectorAll('figure.foto img'));
  var total = imgs.length, hechas = 0, fallidas = 0, terminado = false;
  var estado = document.getElementById('fotosEstado');
  var boton = document.getElementById('btnImprimir');
  function pintar(){ if(estado) estado.textContent = total ? ('Fotos cargadas ' + hechas + '/' + total + (fallidas ? ' · ' + fallidas + ' no disponible(s)' : '')) : 'Sin fotos'; }
  function terminar(forzado){
    if(terminado) return; terminado = true;
    if(boton){ boton.disabled = false; boton.textContent = forzado ? '🖨️ Imprimir de todos modos' : '🖨️ Imprimir / Guardar PDF'; }
    pintar();
    document.documentElement.dataset.listo = '1';
  }
  function fallo(img){
    fallidas++;
    var fig = img.closest('figure');
    if(fig && !fig.classList.contains('no-disponible')){
      var ruta = img.getAttribute('data-ruta') || img.getAttribute('src') || '';
      var caja = document.createElement('div'); caja.className = 'foto-caja';
      caja.textContent = 'Foto no disponible';
      var small = document.createElement('small'); small.textContent = ruta;
      caja.appendChild(document.createElement('br')); caja.appendChild(small);
      fig.classList.add('no-disponible'); fig.replaceChild(caja, img);
    }
  }
  function una(img){
    var listo = false;
    function fin(ok){ if(listo) return; listo = true; if(!ok) fallo(img); hechas++; pintar(); if(hechas >= total) terminar(false); }
    if(img.complete && img.naturalWidth > 0){ fin(true); return; }
    if(img.complete && img.naturalWidth === 0 && !img.decode){ fin(false); return; }
    img.addEventListener('load', function(){ fin(true); });
    img.addEventListener('error', function(){ fin(false); });
    if(img.decode){ img.decode().then(function(){ fin(true); }, function(){ /* lo resuelve load/error */ }); }
  }
  if(boton){ boton.disabled = total > 0; }
  pintar();
  if(!total){ terminar(false); return; }
  imgs.forEach(una);
  setTimeout(function(){ terminar(true); }, 60000);
})();`;
}

// Etiqueta de mes «Febrero 2026» a partir de «2026-02».
function expMesLabel(ym){
  const [y, m] = String(ym).slice(0, 7).split('-');
  const mes = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-EC', { month: 'long' });
  return mes.charAt(0).toUpperCase() + mes.slice(1) + ' ' + y;
}

// Secciones de la fase 2. Reciben el mismo contexto que las de la fase 1.
function expedienteSeccionesFase2(datos, seleccion, meta, h){
  const { e, f, titulo, sub, vacio, numero } = h;
  const proy = datos.proyecto || {};
  const nombre = id => (datos.perfiles || {})[id] || '—';
  const S = {};

  // Cronograma: líneas base, rubros con fechas y peso, Curva S e indicadores.
  S.cronograma = () => {
    const cr = datos.cronograma || {};
    const lbs = cr.lineasBase || [];
    const filas = cr.filas || [];
    const rubros = datos.rubros || [];
    const porRubro = {}; filas.forEach(x => { porRubro[x.rubro_id] = x; });
    const sumaMonto = rubros.reduce((s, r) => s + (Number(r.monto_contrato) || 0), 0);
    const ind = cr.indicadores || null;
    const lbHtml = lbs.length ? `<table class="tabla"><thead><tr><th>N°</th><th>Motivo</th><th>Referencia</th><th>Fecha</th><th>Creada por</th><th>Estado</th></tr></thead><tbody>${
      lbs.map(l => `<tr><td>LB-${l.numero}</td><td>${e(l.motivo || '—')}</td><td>${e(l.referencia || '—')}</td><td>${expFmtFecha(l.created_at)}</td><td>${e(nombre(l.creado_por))}</td><td>${l.activa ? '<b>Activa</b>' : 'Histórica'}</td></tr>`).join('')
    }</tbody></table>` : vacio('Sin líneas base registradas');
    const conFechas = rubros.filter(r => porRubro[r.id] || r.fecha_inicio || r.fecha_fin);
    const tabla = conFechas.length ? `<table class="tabla"><thead><tr><th>Código</th><th>Descripción</th><th>Inicio</th><th>Fin</th><th class="num">Peso (%)</th><th class="num">Avance (%)</th></tr></thead><tbody>${
      conFechas.map(r => { const c = porRubro[r.id] || {}; const peso = sumaMonto > 0 ? (Number(r.monto_contrato) || 0) / sumaMonto * 100 : 0; const av = r.estado === 'terminado' ? 100 : (Number(r.monto_contrato) > 0 ? Math.min((Number(r.total_produccion) || 0) / Number(r.monto_contrato) * 100, 100) : 0);
        return `<tr><td>${e(r.codigo || '—')}</td><td>${e(r.descripcion)}</td><td>${expFmtFecha(c.fecha_inicio || r.fecha_inicio)}</td><td>${expFmtFecha(c.fecha_fin || r.fecha_fin)}</td><td class="num">${expFmtNum(peso, 2)}</td><td class="num">${expFmtNum(av, 1)}</td></tr>`; }).join('')
    }</tbody></table><p class="nota">Peso ponderado por costo (monto vigente del rubro / Σ rubros), igual que en la Curva S de la app.${cr.activa ? ` Fechas según LB-${cr.activa.numero}.` : ''}</p>` : vacio('Sin cronograma registrado');
    const curva = cr.imagen ? `<div class="curva"><img src="${cr.imagen}" alt="Curva S"></div>${cr.notaLineaBase ? `<p class="nota">📐 ${e(cr.notaLineaBase)}</p>` : ''}` : vacio('Sin Curva S: el proyecto no tiene cronograma con fechas');
    const indHtml = ind ? `<table class="tabla kv"><tbody>
      <tr><th>Avance real</th><td>${expFmtPct(ind.avanceRealTotal)}</td></tr>
      <tr><th>SPI (BCWP / BCWS)</th><td>${ind.SPI == null ? '—' : expFmtNum(ind.SPI, 2)}${ind.BCWP != null ? ` · BCWP ${expFmtNum(ind.BCWP, 2)} % · BCWS ${expFmtNum(ind.BCWS, 2)} %` : ''}</td></tr>
      <tr><th>Producción total</th><td>${f(ind.totalProduccion)}</td></tr>
      <tr><th>Rubros atrasados</th><td>${expFmtNum(ind.atrasados, 0)}</td></tr>
      ${ind.proyeccion ? `<tr><th>Fin planificado / estimado</th><td>${expFmtFecha(ind.proyeccion.fechaPlanificada)} / ${expFmtFecha(ind.proyeccion.fechaEstimada)} (${ind.proyeccion.diasAtraso <= 0 ? expFmtNum(Math.abs(ind.proyeccion.diasAtraso), 0) + ' días adelantado' : expFmtNum(ind.proyeccion.diasAtraso, 0) + ' días de atraso'})</td></tr>` : ''}
    </tbody></table><p class="nota">Indicadores EVM a la fecha de generación (${expFmtFecha(meta.hoy || meta.generadoEn)}).</p>` : '';
    return `<section class="sec" id="sec-cronograma">${titulo('cronograma', 'Cronograma y Curva S')}
      ${sub('cronograma', 1, 'Líneas base')}${lbHtml}
      ${sub('cronograma', 2, 'Rubros programados')}${tabla}
      ${sub('cronograma', 3, 'Curva S e indicadores')}${curva}${indHtml}
    </section>`;
  };

  // Libro de obra: todos los registros del rango, por mes, con sello y todas sus fotos.
  S.libro_obra = () => {
    const regs = datos.libro || [];
    const filtros = seleccion?.filtros || {};
    const rango = filtros.libroDesde || filtros.libroHasta ? ` (del ${expFmtFecha(filtros.libroDesde) } al ${expFmtFecha(filtros.libroHasta)})` : '';
    if(!regs.length) return `<section class="sec" id="sec-libro_obra">${titulo('libro_obra', 'Libro de obra')}${vacio('Sin registros del libro de obra' + rango)}</section>`;
    const meses = [...new Set(regs.map(r => String(r.fecha).slice(0, 7)))].sort();
    const totalFotos = regs.reduce((s, r) => s + (r.fotos || []).length, 0);
    const resumen = `<table class="tabla"><thead><tr><th>Mes</th><th class="num">Registros</th><th class="num">Fotos</th><th class="num">Aprobados</th><th class="num">Pendientes</th><th class="num">Observados</th></tr></thead><tbody>${
      meses.map(m => { const rs = regs.filter(r => String(r.fecha).startsWith(m)); const n = est => rs.filter(r => r.estado_aprobacion === est).length;
        return `<tr><td>${e(expMesLabel(m))}</td><td class="num">${rs.length}</td><td class="num">${rs.reduce((s, r) => s + (r.fotos || []).length, 0)}</td><td class="num">${n('aprobado')}</td><td class="num">${n('pendiente')}</td><td class="num">${n('observado')}</td></tr>`; }).join('')
    }</tbody><tfoot><tr><th>Total</th><th class="num">${regs.length}</th><th class="num">${totalFotos}</th><th colspan="3"></th></tr></tfoot></table>`;
    const bloques = meses.map((m, k) => {
      const rs = regs.filter(r => String(r.fecha).startsWith(m));
      return `<section class="sub libro-doc" id="libro-${m}">${sub('libro_obra', k + 1, `${expMesLabel(m)} — ${rs.length} registro(s)`)}${
        rs.map(r => `<div class="registro">${renderRegistroLibroHTML(r, { nombresAprobadores: datos.perfiles || {}, rubros: r.rubros, fotos: [], inc: { actividades: true, equipos: true, materiales: true, rubros: true, novedades: true, fotos: false } })}${
          r.estado_aprobacion === 'observado' && r.observacion_aprobacion ? `<p class="aviso">Observación de fiscalización: ${e(r.observacion_aprobacion)}</p>` : ''
        }${expFotosHTML(r.fotos, `Registro N° ${r.numero_registro ?? '—'}`, r.fecha)}</div>`).join('')
      }</section>`;
    }).join('');
    return `<section class="sec" id="sec-libro_obra">${titulo('libro_obra', 'Libro de obra')}<p class="nota">${regs.length} registro(s)${rango}, ${totalFotos} foto(s). Cada registro lleva su estado de aprobación y sello.</p>${resumen}</section>${bloques}`;
  };

  // Observaciones: cada una con fotos y respuestas en orden.
  S.observaciones = () => {
    const obs = datos.observaciones || [];
    const filtros = seleccion?.filtros || {};
    const ESTADO = { abierta: 'Abierta', en_proceso: 'En proceso', resuelta: 'Resuelta' };
    if(!obs.length) return `<section class="sec" id="sec-observaciones">${titulo('observaciones', 'Observaciones de fiscalización')}${vacio(filtros.observaciones === 'resueltas' ? 'Sin observaciones resueltas' : 'Sin observaciones registradas')}</section>`;
    const resumen = `<table class="tabla"><thead><tr><th>N°</th><th>Título</th><th>Fecha</th><th>Estado</th><th class="num">Fotos</th><th class="num">Respuestas</th></tr></thead><tbody>${
      obs.map(o => `<tr><td>${o.numero ?? '—'}</td><td>${e(o.titulo)}</td><td>${expFmtFecha(o.created_at)}</td><td>${ESTADO[o.estado] || e(o.estado)}</td><td class="num">${(o.fotos || []).length}</td><td class="num">${(o.respuestas || []).length}</td></tr>`).join('')
    }</tbody></table>`;
    const docs = obs.map((o, k) => `<section class="sub" id="obs-${o.id}">${sub('observaciones', k + 1, `Observación N° ${o.numero ?? '—'} — ${o.titulo}`)}
      <table class="tabla kv"><tbody>
        <tr><th>Fecha</th><td>${expFmtFechaHora(o.created_at)}</td></tr>
        <tr><th>Autor</th><td>${e(nombre(o.creado_por))}</td></tr>
        <tr><th>Estado</th><td>${ESTADO[o.estado] || e(o.estado)}</td></tr>
        <tr><th>Ubicación</th><td>${o.plano_nombre && o.pin_x != null ? `Plano ${e(o.plano_nombre)}, pág. ${Math.max(1, Math.round(Number(o.pin_pagina)) || 1)}` : 'Sin ubicación en plano'}</td></tr>
        ${o.descripcion ? `<tr><th>Descripción</th><td>${expParrafo(o.descripcion)}</td></tr>` : ''}
      </tbody></table>
      ${expFotosHTML(o.fotos, `Observación N° ${o.numero ?? '—'}`, o.created_at)}
      ${(o.respuestas || []).length ? `<h3 class="sub-sub">Respuestas</h3>${o.respuestas.map(r => `<div class="respuesta"><div class="respuesta-meta">${e(nombre(r.autor_id))} · ${expFmtFechaHora(r.created_at)}</div>${r.texto ? `<div>${expParrafo(r.texto)}</div>` : ''}${
        r.adjunto ? (r.adjunto.tipo === 'foto' ? expFotosHTML([r.adjunto], `Observación N° ${o.numero ?? '—'} · respuesta`, r.created_at) : `<div class="nota">📎 ${e(r.adjunto.nombre)}</div>`) : ''
      }</div>`).join('')}` : '<p class="nota">Sin respuestas.</p>'}
    </section>`).join('');
    return `<section class="sec" id="sec-observaciones">${titulo('observaciones', 'Observaciones de fiscalización')}${resumen}</section>${docs}`;
  };

  // Ensayos: especificaciones, resultados con veredicto, re-ensayos y certificados.
  S.ensayos = () => {
    const en = datos.ensayos || { especificaciones: [], lista: [] };
    const especs = en.especificaciones || [];
    const lista = en.lista || [];
    const numero = {}; lista.forEach(x => { numero[x.id] = x.numero; });
    const esp = especs.length ? `<table class="tabla"><thead><tr><th>Ensayo</th><th>Norma</th><th>Etiqueta</th><th>Criterio</th><th class="num">Mín.</th><th class="num">Máx.</th></tr></thead><tbody>${
      especs.map(x => `<tr><td>${e(x.tipo?.nombre || '—')}</td><td>${e(x.tipo?.norma || '—')}</td><td>${e(x.etiqueta || '—')}</td><td>${e({ mayor_igual: '≥ mínimo', menor_igual: '≤ máximo', rango: 'rango' }[x.tipo?.criterio] || x.tipo?.criterio || '—')}</td><td class="num">${x.valor_min == null ? '—' : expFmtNum(x.valor_min, 2)}</td><td class="num">${x.valor_max == null ? '—' : expFmtNum(x.valor_max, 2)}</td></tr>`).join('')
    }</tbody></table>` : vacio('Sin especificaciones registradas');
    const cumplen = lista.filter(x => x.cumple).length;
    const tabla = lista.length ? `<div class="libro-doc">${renderEnsayosTablaHTML(lista)}</div>` : vacio('Sin ensayos registrados');
    const extras = lista.filter(x => x.reensayo_de || x.archivo_url);
    const detalle = extras.length ? `<table class="tabla"><thead><tr><th>N°</th><th>Re-ensayo de</th><th>Informe / certificado</th></tr></thead><tbody>${
      extras.map(x => `<tr><td>E-${String(x.numero).padStart(3, '0')}</td><td>${x.reensayo_de ? `E-${String(numero[x.reensayo_de] ?? '?').padStart(3, '0')}` : '—'}</td><td>${x.archivo_url ? `Archivo en la plataforma: ${e(String(x.archivo_url).split('/').pop().split('?')[0])}` : '—'}</td></tr>`).join('')
    }</tbody></table>` : '';
    return `<section class="sec" id="sec-ensayos">${titulo('ensayos', 'Ensayos de laboratorio')}
      ${sub('ensayos', 1, 'Especificaciones del proyecto')}${esp}
      ${sub('ensayos', 2, 'Resultados')}${lista.length ? `<p class="nota">${lista.length} ensayo(s) · ${cumplen} cumplen · ${lista.length - cumplen} no cumplen (${lista.filter(x => !x.cumple && !x.resuelto).length} sin resolver).</p>` : ''}${tabla}${detalle}
    </section>`;
  };

  // Formatos de calidad: listado con referencia a la plataforma.
  S.formatos_calidad = () => {
    const fo = datos.formatos || { plantillas: [], respuestas: [] };
    const ESTADO = { borrador: 'Borrador', enviado: 'Enviado', corregido: 'Corregido' };
    const plantillas = (fo.plantillas || []).length ? `<ul class="lista">${fo.plantillas.map(p => `<li>${e(p.nombre)} (llena: ${e(p.rol_llenado || 'residente')})</li>`).join('')}</ul>` : vacio('Sin formatos asignados');
    const resp = (fo.respuestas || []).length ? `<table class="tabla"><thead><tr><th>Formato</th><th>Residente</th><th>Fecha</th><th>Estado</th><th class="num">Fotos</th><th>Referencia</th></tr></thead><tbody>${
      fo.respuestas.map(r => `<tr><td>${e(r.plantilla_nombre)}</td><td>${e(nombre(r.residente_id))}</td><td>${expFmtFecha(r.created_at)}</td><td>${ESTADO[r.estado] || e(r.estado)}</td><td class="num">${r.fotos}</td><td>Formatos de calidad → ${e(r.plantilla_nombre)} (${expFmtFecha(r.created_at)})</td></tr>`).join('')
    }</tbody></table><p class="nota">El formato completo (con su perfil estratigráfico y fotos) se consulta e imprime desde la plataforma.</p>` : vacio('Sin formatos llenados');
    return `<section class="sec" id="sec-formatos_calidad">${titulo('formatos_calidad', 'Formatos de calidad')}${sub('formatos_calidad', 1, 'Formatos asignados')}${plantillas}${sub('formatos_calidad', 2, 'Registros llenados')}${resp}</section>`;
  };

  // SST: configuración, riesgos, EPP, capacitaciones, PTE, checklist, exámenes agregados, incidentes.
  S.sst = () => {
    const s = datos.sst || {};
    const kv = pares => `<table class="tabla kv"><tbody>${pares.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;
    const c = s.config;
    const config = c ? kv([
      ['Gestión', c.tipo_gestion === 'fiscalizacion' ? 'Por fiscalización' : 'Propia del contratista'],
      ['Trabajadores', `${expFmtNum(c.num_trabajadores, 0)} (${expFmtNum(c.num_hombres, 0)} hombres, ${expFmtNum(c.num_mujeres, 0)} mujeres)`],
      ['Grupos de atención prioritaria', Array.isArray(c.grupos_atencion_prioritaria) && c.grupos_atencion_prioritaria.length ? e(c.grupos_atencion_prioritaria.join(', ')) : 'Ninguno declarado'],
      ['Responsable SST', `${e({ monitor: 'Monitor', tecnico: 'Técnico', servicio_externo: 'Servicio externo' }[c.responsable_sst_tipo] || c.responsable_sst_tipo || '—')}${c.responsable_sst_nombre ? ' · ' + e(c.responsable_sst_nombre) : ''}`],
      ['Médico ocupacional', e(c.medico_ocupacional_nombre || '—')],
      ['Representación', e({ participacion_directa: 'Participación directa', delegado: 'Delegado', comite: 'Comité' }[c.representacion_tipo] || c.representacion_tipo || '—')],
      ['Registrado en el SUT', c.registrado_sut ? 'Sí' : 'No']
    ]) : vacio('Sin configuración SST registrada');
    const riesgos = (s.riesgos || []).length ? `<table class="tabla"><thead><tr><th>Puesto</th><th class="num">Expuestos</th><th>Tipo</th><th>Peligro</th><th>Prob.</th><th>Consec.</th><th>Nivel</th><th>Control</th><th>Residual</th></tr></thead><tbody>${
      s.riesgos.map(r => `<tr><td>${e(r.puesto)}</td><td class="num">${expFmtNum(r.num_expuestos, 0)}</td><td>${e(r.tipo_riesgo || '—')}</td><td>${e(r.peligro)}</td><td>${e(r.probabilidad || '—')}</td><td>${e(r.consecuencia || '—')}</td><td>${e(r.nivel_riesgo || '—')}</td><td>${e(r.medidas_control || '—')}</td><td>${e(r.riesgo_residual || '—')}</td></tr>`).join('')
    }</tbody></table>` : vacio('Sin matriz de riesgos');
    const eppM = (s.eppMatriz || []).length ? `<table class="tabla"><thead><tr><th>Puesto</th><th>Riesgo</th><th>EPP requerido</th><th>Especificación</th><th>Reposición</th></tr></thead><tbody>${
      s.eppMatriz.map(r => `<tr><td>${e(r.puesto)}</td><td>${e(r.riesgo_asociado || '—')}</td><td>${e(r.epp_requerido)}</td><td>${e(r.especificacion_tecnica || '—')}</td><td>${e(r.frecuencia_reposicion || '—')}</td></tr>`).join('')
    }</tbody></table>` : vacio('Sin matriz de EPP');
    const eppE = (s.eppEntregas || []).length ? `<table class="tabla"><thead><tr><th>Trabajador</th><th>Puesto</th><th>Fecha</th><th>EPP entregado</th><th>Confirmado</th></tr></thead><tbody>${
      s.eppEntregas.map(r => `<tr><td>${e(r.trabajador_nombre)}</td><td>${e(r.puesto || '—')}</td><td>${expFmtFecha(r.fecha_entrega)}</td><td>${e(r.detalle_epp)}</td><td>${r.confirmado_trabajador ? 'Sí' : 'No'}</td></tr>`).join('')
    }</tbody></table>${s.eppEntregas.filter(r => r.foto).map(r => expFotosHTML([r.foto], `Entrega de EPP · ${r.trabajador_nombre}`, r.fecha_entrega)).join('')}` : vacio('Sin entregas de EPP registradas');
    const caps = (s.capacitaciones || []).length ? s.capacitaciones.map(cp => `<table class="tabla kv"><tbody><tr><th>Tema</th><td>${e(cp.tema)}</td></tr><tr><th>Tipo</th><td>${e(SST_TIPO_CAPACITACION[cp.tipo] || cp.tipo)}</td></tr><tr><th>Fecha · duración</th><td>${expFmtFecha(cp.fecha)}${cp.duracion_horas ? ` · ${expFmtNum(cp.duracion_horas, 1)} h` : ''}</td></tr><tr><th>Responsable</th><td>${e(cp.responsable || '—')}</td></tr><tr><th>Asistentes</th><td>${(cp.asistentes || []).length ? `<ul class="lista">${cp.asistentes.map(a => `<li>${e(a.nombre)}${a.puesto ? ' · ' + e(a.puesto) : ''}${a.asistio === false ? ' (no asistió)' : ''}</li>`).join('')}</ul>` : 'Sin asistentes registrados'}</td></tr></tbody></table>`).join('') : vacio('Sin capacitaciones registradas');
    const ptes = (s.ptes || []).length ? `<table class="tabla"><thead><tr><th>N°</th><th>Tipo</th><th>Fecha</th><th>Ubicación</th><th>Técnico</th><th>Estado</th></tr></thead><tbody>${
      s.ptes.map(p => `<tr><td>PTE-${String(p.numero).padStart(3, '0')}</td><td>${e((PTE_TIPOS[p.tipo] || p.tipo).replace(/^[^\s]+\s/, ''))}</td><td>${expFmtFecha(p.fecha)}</td><td>${e(p.ubicacion || '—')}</td><td>${e(p.tecnico_nombre || '—')}</td><td>${e({ abierto: 'Abierto', cerrado: 'Cerrado', anulado: 'Anulado' }[p.estado] || p.estado)}</td></tr>`).join('')
    }</tbody></table>` : vacio('Sin permisos de trabajo especial');
    // Checklist resumido por bloque y modo.
    const modos = [...new Set((s.checklist || []).map(x => x.modo))];
    const checklist = modos.length ? modos.map(modo => {
      const resp = s.checklist.filter(x => x.modo === modo);
      const fecha = resp.map(x => x.fecha).filter(Boolean).sort().pop();
      return `<h3 class="sub-sub">${modo === 'auditoria' ? 'Auditoría' : 'Autoevaluación'}${fecha ? ` (última respuesta ${expFmtFecha(fecha)})` : ''}</h3><table class="tabla"><thead><tr><th>Bloque</th><th class="num">Ítems</th><th class="num">Cumple</th><th class="num">No cumple</th><th class="num">No aplica</th><th class="num">Sin responder</th></tr></thead><tbody>${
        (typeof ANEXO1_CHECKLIST !== 'undefined' ? ANEXO1_CHECKLIST : []).map(b => { const codigos = b.items.map(i => i[0]); const r = resp.filter(x => codigos.includes(x.item_codigo)); const n = v => r.filter(x => x.respuesta === v).length;
          return `<tr><td>${e(b.id)}. ${e(b.nombre)}</td><td class="num">${codigos.length}</td><td class="num">${n('cumple')}</td><td class="num">${n('no_cumple')}</td><td class="num">${n('no_aplica')}</td><td class="num">${codigos.length - r.length}</td></tr>`; }).join('')
      }</tbody></table>`;
    }).join('') : vacio('Sin checklist respondido');
    // Exámenes: solo agregados por tipo (sin nombres ni resultados).
    const TIPO_EX = { preempleo: 'Preempleo', periodico: 'Periódico', reintegro: 'Reintegro', retiro: 'Retiro' };
    const hoy = String(meta.hoy || meta.generadoEn || '').slice(0, 10);
    const tiposEx = [...new Set((s.examRegistros || []).map(x => x.tipo))];
    const examenes = tiposEx.length ? `<table class="tabla"><thead><tr><th>Tipo de examen</th><th class="num">Realizados</th><th class="num">Vigentes</th><th class="num">Vencidos</th></tr></thead><tbody>${
      tiposEx.map(t => { const r = s.examRegistros.filter(x => x.tipo === t); const vig = r.filter(x => x.fecha_proximo && x.fecha_proximo >= hoy).length; const ven = r.filter(x => x.fecha_proximo && x.fecha_proximo < hoy).length;
        return `<tr><td>${e(TIPO_EX[t] || t)}</td><td class="num">${r.length}</td><td class="num">${vig}</td><td class="num">${ven}</td></tr>`; }).join('')
    }</tbody></table><p class="nota">Solo cifras agregadas: los resultados y nombres son datos de salud y se consultan en la plataforma.</p>` : vacio('Sin exámenes ocupacionales registrados');
    const examM = (s.examMatriz || []).length ? `<table class="tabla"><thead><tr><th>Puesto</th><th>Riesgo</th><th>Examen</th><th class="num">Frecuencia (meses)</th></tr></thead><tbody>${s.examMatriz.map(x => `<tr><td>${e(x.puesto)}</td><td>${e(x.riesgo_asociado || '—')}</td><td>${e(x.tipo_examen)}</td><td class="num">${x.frecuencia_meses == null ? '—' : expFmtNum(x.frecuencia_meses, 0)}</td></tr>`).join('')}</tbody></table>` : '';
    const incidentes = (s.incidentes || []).length ? `<table class="tabla"><thead><tr><th>Tipo</th><th>Fecha</th><th>Lugar</th><th>Descripción</th><th>Gravedad</th><th>Estado</th><th>IESS</th></tr></thead><tbody>${
      s.incidentes.map(x => `<tr><td>${e(SST_TIPO_INCIDENTE[x.tipo] || x.tipo)}</td><td>${expFmtFechaHora(x.fecha_hora)}</td><td>${e(x.lugar || '—')}</td><td>${e(x.descripcion || '—')}</td><td>${e(x.gravedad || '—')}</td><td>${e(x.estado || '—')}</td><td>${x.reportado_iess ? 'Reportado' : 'No reportado'}</td></tr>`).join('')
    }</tbody></table>${s.incidentes.filter(x => x.foto).map(x => expFotosHTML([x.foto], `Incidente · ${x.lugar || ''}`, x.fecha_hora)).join('')}` : vacio('Sin incidentes ni accidentes registrados');
    return `<section class="sec" id="sec-sst">${titulo('sst', 'Seguridad y salud en el trabajo')}
      ${sub('sst', 1, 'Configuración')}${config}
      ${sub('sst', 2, 'Matriz de riesgos')}${riesgos}
      ${sub('sst', 3, 'Equipos de protección personal')}${eppM}${eppE}
      ${sub('sst', 4, 'Capacitaciones')}${caps}
      ${sub('sst', 5, 'Permisos de trabajo especial')}${ptes}
      ${sub('sst', 6, 'Lista de verificación (resumen por bloque)')}${checklist}
      ${sub('sst', 7, 'Exámenes ocupacionales (agregado)')}${examM}${examenes}
      ${sub('sst', 8, 'Incidentes y accidentes')}${incidentes}
    </section>`;
  };

  // Subcontratistas.
  S.subcontratistas = () => {
    const sc = datos.subcontratos || [];
    const sumaRubros = (datos.rubros || []).reduce((s, r) => s + (Number(r.monto_contrato) || 0), 0);
    const ESTADO = { activo: 'Activo', finalizado: 'Finalizado', suspendido: 'Suspendido' };
    const tabla = sc.length ? `<table class="tabla"><thead><tr><th>Subcontratista</th><th>Especialidad</th><th>Representante</th><th class="num">Monto</th><th class="num">% del contrato</th><th>Inicio</th><th>Fin</th><th>Estado</th><th>Rubros</th></tr></thead><tbody>${
      sc.map(s => `<tr><td>${e(s.subcontratista?.nombre || '—')}</td><td>${e(s.subcontratista?.especialidad || '—')}</td><td>${e(s.subcontratista?.representante || '—')}</td><td class="num">${f(s.monto)}</td><td class="num">${sumaRubros > 0 ? expFmtPct((Number(s.monto) || 0) / sumaRubros * 100) : '—'}</td><td>${expFmtFecha(s.fecha_inicio)}</td><td>${expFmtFecha(s.fecha_fin)}</td><td>${ESTADO[s.estado] || e(s.estado)}</td><td>${(s.rubros || []).length ? e(s.rubros.map(r => r.codigo).join(', ')) : '—'}</td></tr>`).join('')
    }</tbody><tfoot><tr><th colspan="3">Total subcontratado</th><th class="num">${f(sc.reduce((a, s) => a + (Number(s.monto) || 0), 0))}</th><th class="num">${sumaRubros > 0 ? expFmtPct(sc.reduce((a, s) => a + (Number(s.monto) || 0), 0) / sumaRubros * 100) : '—'}</th><th colspan="4"></th></tr></tfoot></table>` : vacio('Sin subcontratos registrados');
    return `<section class="sec" id="sec-subcontratistas">${titulo('subcontratistas', 'Subcontratistas')}${tabla}</section>`;
  };

  return S;
}

// CSS de la fase 2: fotos, registros del libro (mismas clases que el reporte), observaciones y Curva S.
function expedienteCSSFase2(){
  return `
/* Fotos: dos por fila, figura y pie sin partir */
.fotos { display: flex; flex-wrap: wrap; gap: 6px 2%; margin: 8px 0 12px; }
.fotos figure.foto { width: 49%; margin: 0; break-inside: avoid; page-break-inside: avoid; }
.fotos figure.foto img { width: 100%; height: auto; max-height: 120mm; object-fit: contain; border: 1px solid #e6e9ef; border-radius: 4px; background: #f5f6f8; display: block; }
.fotos figcaption { font-size: 8pt; color: #676879; margin-top: 2px; line-height: 1.3; }
.foto-caja { border: 1px dashed #c5c7d4; border-radius: 4px; background: #f5f6f8; color: #676879; font-size: 9pt; padding: 18px 10px; text-align: center; min-height: 40mm; display: flex; flex-direction: column; justify-content: center; word-break: break-all; }
.foto-caja small { font-size: 7.5pt; color: #9fa2b2; }
.ui-barra .fotos-estado { color: #cfe3ff; font-size: 8.5pt; }
.ui-barra button:disabled { background: #5a6378; cursor: wait; }
/* Registros del libro: mismas clases que el reporte PDF del libro de obra */
.libro-doc .registro { margin-bottom: 14px; }
.libro-doc .registro-block { border: 1px solid #e6e9ef; border-radius: 6px; margin-bottom: 6px; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
.libro-doc .registro-header { background: #1a1a2e; color: #fff; padding: 7px 12px; display: flex; justify-content: space-between; align-items: center; }
.libro-doc .registro-header .reg-num { font-size: 10pt; font-weight: 700; color: #fff; }
.libro-doc .registro-meta { background: #f0f7ff; padding: 5px 12px; display: flex; gap: 16px; font-size: 8.5pt; color: #323338; border-bottom: 1px solid #e6e9ef; }
.libro-doc .registro-body { padding: 8px 12px; }
.libro-doc .campo { margin-bottom: 7px; }
.libro-doc .campo .lbl { font-size: 7.5pt; font-weight: 700; color: #0073ea; text-transform: uppercase; letter-spacing: .4px; display: block; margin-bottom: 2px; }
.libro-doc .campo .val { font-size: 9pt; line-height: 1.5; color: #323338; white-space: pre-wrap; }
.libro-doc .novedad-box { background: #fff8e1; border-left: 3px solid #ffc107; padding: 5px 8px; border-radius: 0 4px 4px 0; font-size: 9pt; color: #5d4037; white-space: pre-wrap; }
.libro-doc .campo table { width: 100%; border-collapse: collapse; font-size: 8pt; margin-top: 4px; }
.libro-doc .campo th { background: #1a1a2e; color: #fff; padding: 4px 6px; text-align: left; font-size: 7pt; text-transform: uppercase; }
.libro-doc .campo td { padding: 4px 6px; border-bottom: 1px solid #f0f2f5; vertical-align: top; }
.libro-doc .td-qty { font-weight: 700; color: #0073ea; text-align: right; }
.libro-doc h2 { font-size: 12pt; color: #0073ea; margin-top: 16px; }
.libro-doc table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
.libro-doc thead { display: table-header-group; }
.libro-doc th { background: #1a1a2e; color: #fff; padding: 4px 6px; text-align: left; font-size: 7.5pt; text-transform: uppercase; }
.libro-doc td { padding: 4px 6px; border-bottom: 1px solid #f0f2f5; vertical-align: top; }
/* Observaciones */
.respuesta { background: #f5f6f8; border-radius: 8px; padding: 8px 12px; margin: 6px 0; break-inside: avoid; page-break-inside: avoid; }
.respuesta-meta { font-size: 8.5pt; color: #676879; margin-bottom: 3px; }
/* Curva S */
.curva img { width: 100%; max-width: 180mm; height: auto; display: block; margin: 6px auto; border: 1px solid #e6e9ef; }
`;
}
