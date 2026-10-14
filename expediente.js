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
// slug: sin tildes, espacios y símbolos a guiones, máximo 40 caracteres.
function expedienteNombreArchivo(proyecto, version, fechaISO){
  const slug = String(proyecto?.nombre || 'proyecto').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '') || 'proyecto';
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
async function expedienteCargarDatos(proyectoId, seleccion, cliente){
  const c = cliente || (typeof sb !== 'undefined' ? sb : null);
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
  return {
    proyecto, anticipo: anticipo || null, garantias, reajusteTerminos, rubros,
    ordenesCambio: ocs.map(o => ({ ...o, items: items.filter(i => i.orden_id === o.id) })),
    planillas: planillas.map(p => ({
      ...p,
      rubros: planRubros.filter(r => r.planilla_id === p.id).sort((x, y) => (ordenRubro[x.rubro_id] ?? 1e9) - (ordenRubro[y.rubro_id] ?? 1e9)),
      historial: historial.filter(h => h.planilla_id === p.id)
    })),
    actas, liquidacion: liquidacion || null, perfiles
  };
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
        ${a ? `<div class="doc-cierre-cuerpo">${actaCuerpoHTML(a, proy)}</div>${bloqueFirmas}${a.archivo_url ? '<p class="nota">El acta firmada está adjunta en la plataforma.</p>' : ''}<p class="nota">Texto generado a partir de los datos registrados (fecha, lugar, asistentes y observaciones).</p>` : vacio('No emitida a la fecha de generación')}
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
  <button type="button" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
  <span>A4, márgenes predeterminados, activar «Gráficos de fondo». Nombre sugerido: ${e(nombreArchivo)}.pdf</span>
</div>
<header class="enc-pagina"><img src="${logo}" alt="HIDIVO"><span class="enc-proyecto">${e(proy.nombre || '')}</span><span class="enc-version">Expediente v${version}</span></header>
<footer class="pie-pagina">${pie}</footer>
${calc.parcial ? '<div class="marca-agua" aria-hidden="true">EXPEDIENTE PARCIAL – PROYECTO EN EJECUCIÓN</div>' : ''}
<main>
${cuerpo}
</main>
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
