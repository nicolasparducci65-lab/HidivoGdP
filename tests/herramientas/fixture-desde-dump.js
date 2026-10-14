#!/usr/bin/env node
// Extrae de un dump de pg_dump (formato COPY ... FROM stdin) las filas de un
// proyecto y las escribe como fixture JSON para el arnés.
//
//   node fixture-desde-dump.js <dump.sql> <proyecto_id> <salida.json>
//
// El resultado tiene la forma { proyectos:[...], rubros:[...], ... } con las
// filas tal cual están en la base (los NULL quedan como null, los números como
// número y los jsonb parseados). Cubre las tablas de las fases 1 y 2 del
// expediente. Los datos reales NO se commitean: la salida va a
// tests/fixtures/*.real.json, que está en .gitignore.
'use strict';
const fs = require('fs');

const [,, rutaDump, proyectoId, salida] = process.argv;
if(!rutaDump || !proyectoId || !salida){
  console.error('Uso: node fixture-desde-dump.js <dump.sql> <proyecto_id> <salida.json>');
  process.exit(2);
}

// Tablas por proyecto (columna proyecto_id).
const POR_PROYECTO = ['proyectos','contrato_anticipo','garantias','reajuste_terminos','rubros',
  'ordenes_cambio','planillas_pago','actas_recepcion','liquidaciones','proyecto_miembros',
  'libro_obra','observaciones','planos','ensayos','ensayo_especificaciones','formatos_calidad_asignaciones',
  'formatos_calidad_respuestas','sst_config','sst_matriz_riesgos','sst_epp_matriz','sst_epp_entregas',
  'sst_capacitaciones','sst_capacitacion_asistentes','sst_checklist_respuestas','sst_examenes_matriz',
  'sst_examenes_registros','sst_incidentes','sst_pte','subcontratos','lineas_base','cronograma_rubros'];
// Tablas hijas: [columna padre, tabla padre].
const HIJAS = {
  orden_cambio_items: ['orden_id','ordenes_cambio'], planilla_rubros: ['planilla_id','planillas_pago'],
  planilla_historial: ['planilla_id','planillas_pago'], libro_obra_fotos: ['registro_id','libro_obra'],
  libro_obra_rubros: ['registro_id','libro_obra'], libro_obra_aprobaciones: ['registro_id','libro_obra'],
  libro_obra_items: ['registro_id','libro_obra'], observacion_fotos: ['observacion_id','observaciones'],
  observacion_respuestas: ['observacion_id','observaciones'], formatos_calidad_fotos: ['respuesta_id','formatos_calidad_respuestas'],
  subcontrato_rubros: ['subcontrato_id','subcontratos']
};
// Catálogos referenciados por id: [columna en la tabla hija ya cargada, tabla hija].
const CATALOGOS = {
  ensayo_tipos: ['tipo_id','ensayo_especificaciones'],
  formatos_calidad_plantillas: ['plantilla_id','formatos_calidad_asignaciones'],
  subcontratistas: ['subcontratista_id','subcontratos']
};
const COLUMNAS_JSON = new Set(['contrato_datos','datos','reajuste_indices','modulos','campos','respuestas','trabajadores','grupos_atencion_prioritaria']);
const COLUMNAS_TEXTO = new Set(['codigo','numero_registro','telefono','ruc','cedula','trabajador_cedula','item_codigo','oficio_referencia','referencia']);

const texto = fs.readFileSync(rutaDump, 'utf8');
const lineas = texto.split('\n');
const FIN = String.fromCharCode(92) + '.';
const NULO = String.fromCharCode(92) + 'N';

function desescapar(v){
  if(v === NULO) return null;
  return v.replace(/\\(.)/g, (m, c) => ({ n:'\n', t:'\t', r:'\r', '\\':'\\' }[c] ?? c));
}
function convertir(col, v){
  if(v === null) return null;
  if(COLUMNAS_JSON.has(col)){ try{ return JSON.parse(v); }catch{ return v; } }
  if(col === 'id' || col.endsWith('_id') || col.endsWith('_por') || col.endsWith('_by') || COLUMNAS_TEXTO.has(col)) return v;
  if(/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if(v === 't') return true;
  if(v === 'f') return false;
  return v;
}

function leerTabla(nombre){
  const ini = lineas.findIndex(l => l.startsWith(`COPY public.${nombre} (`));
  if(ini < 0) return { columnas: [], filas: [] };
  const columnas = lineas[ini].slice(lineas[ini].indexOf('(')+1, lineas[ini].indexOf(')')).split(',').map(s=>s.trim());
  const filas = [];
  for(let i = ini+1; i < lineas.length; i++){
    const l = lineas[i].replace(/\r$/, '');
    if(l === FIN) break;
    const vals = l.split('\t');
    const fila = {};
    columnas.forEach((c, k) => { fila[c] = convertir(c, desescapar(vals[k] ?? NULO)); });
    filas.push(fila);
  }
  return { columnas, filas };
}

const out = {};
for(const t of POR_PROYECTO){
  const { filas } = leerTabla(t);
  out[t] = filas.filter(f => (t === 'proyectos' ? f.id : f.proyecto_id) === proyectoId);
}
for(const [t, [colPadre, tablaPadre]] of Object.entries(HIJAS)){
  const idsPadre = new Set((out[tablaPadre]||[]).map(f => f.id));
  out[t] = leerTabla(t).filas.filter(f => idsPadre.has(f[colPadre]));
}
for(const [t, [col, tablaHija]] of Object.entries(CATALOGOS)){
  const ids = new Set((out[tablaHija]||[]).map(f => f[col]).filter(Boolean));
  out[t] = leerTabla(t).filas.filter(f => ids.has(f.id));
}
// Perfiles referenciados (autores, aprobadores, miembros): solo id, nombre, apellido, rol.
const ids = new Set();
['creado_por','aprobado_por','revisado_por','autor_id','usuario_id','created_by','subido_por','residente_id','corregido_por','evaluado_por','registrado_por','inspector_id'].forEach(c =>
  Object.values(out).flat().forEach(f => { if(f && typeof f[c] === 'string' && /^[0-9a-f-]{36}$/.test(f[c])) ids.add(f[c]); }));
out.perfiles = leerTabla('perfiles').filas.filter(p => ids.has(p.id)).map(p => ({ id:p.id, nombre:p.nombre, apellido:p.apellido, rol:p.rol }));
out.expedientes_generados = [];

fs.writeFileSync(salida, JSON.stringify(out, null, 1));
console.log(Object.entries(out).filter(([, f]) => f.length).map(([t, f]) => `${t}: ${f.length}`).join(' · '));
