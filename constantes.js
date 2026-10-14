// Constantes de datos de HIDIVO - extraidas de index.html sin cambios de contenido.
// Este archivo debe cargarse ANTES del script principal de index.html.

// Logo HIDIVO vendorizado (vendor/logo-hidivo.png): la app ya no depende de cdn.gamma.app.
// URL absoluta porque los documentos de impresión se abren en una ventana about:blank,
// donde una ruta relativa no resuelve. Fuera del navegador (pruebas, Puppeteer) apunta
// al dominio público.
const LOGO_URL = (() => {
  try{ if(typeof document !== 'undefined' && document.baseURI) return new URL('vendor/logo-hidivo.png', document.baseURI).href; }catch(_){ /* about:blank u otra base no válida */ }
  return 'https://hidivo.com/vendor/logo-hidivo.png';
})();
const PLANTILLA_RUBROS_URL = 'https://kpswaoqxaxvhrgxntkcq.supabase.co/storage/v1/object/public/hidivo-archivos/plantillas/plantilla_rubros_hidivo.xlsx';

const ESTADOS_OC = {
  borrador:   { label:'Borrador',   color:'#676879', bg:'#f5f6f8' },
  solicitada: { label:'Solicitada', color:'#b8860b', bg:'#fdf6e3' },
  aprobada:   { label:'Aprobada',   color:'#00854d', bg:'#e6f4ee' },
  rechazada:  { label:'Rechazada',  color:'#e2445c', bg:'#fdecef' }
};

const ESTADOS_LIBRO = {
  pendiente: { label:'Pendiente', color:'#b8860b', bg:'#fdf6e3', emoji:'⏳' },
  aprobado:  { label:'Aprobado',  color:'#00854d', bg:'#e6f4ee', emoji:'✅' },
  observado: { label:'Observado', color:'#e2445c', bg:'#fdecef', emoji:'⚠️' }
};

const MODULO_LABELS = {
  rubros:'Rubros', libro:'Libro de Obra', curvaS:'Curva S',
  fiscalizacion:'Observaciones', recorridos360:'Recorridos 360', solicitudes:'Solicitudes',
  planillas:'Planillas', equipos:'Equipos', materiales:'Materiales',
  contratos:'Contratos', general:'General'
};

const TIPOS_CAMPO_FORMATO = {
  seccion:        { label:'Sección (título)', icon:'📌' },
  texto:          { label:'Texto', icon:'📝' },
  numero:         { label:'Número', icon:'🔢' },
  fecha:          { label:'Fecha', icon:'📅' },
  si_no:          { label:'Sí / No', icon:'✅' },
  seleccion:      { label:'Selección', opciones:true, icon:'📋' },
  foto:           { label:'Foto', icon:'📷' },
  tabla_repetible:{ label:'Tabla repetible', icon:'📑', columnas:true }
};

const ESTADOS_PLANILLA = {
  borrador:    { label:'Borrador',          color:'#676879', bg:'#f5f6f8', emoji:'📝' },
  enviada:     { label:'Enviada',           color:'#0073ea', bg:'#e8f4ff', emoji:'📤' },
  en_revision: { label:'En revisión',       color:'#ff9f00', bg:'#fff3e0', emoji:'🔵' },
  aprobada:    { label:'Aprobada',          color:'#00c875', bg:'#e8f5e9', emoji:'✅' },
  pagada:      { label:'Pagada',            color:'#9b59b6', bg:'#f3e5f5', emoji:'💰' },
  rechazada:   { label:'Rechazada',         color:'#e2445c', bg:'#fce4ec', emoji:'❌' }
};

const TIPOS_GARANTIA = {
  buen_uso_anticipo: 'Buen uso del anticipo',
  fiel_cumplimiento: 'Fiel cumplimiento',
  buena_calidad_materiales: 'Buena calidad de materiales y equipos',
  todo_riesgo: 'Todo riesgo',
  otra: 'Otra'
};

const ESTADOS_CIERRE = {
  en_ejecucion:          { label:'En ejecución',          idx:0 },
  recepcion_provisional: { label:'Recepción provisional', idx:1 },
  recepcion_definitiva:  { label:'Recepción definitiva',  idx:2 },
  liquidado:             { label:'Liquidado',             idx:3 }
};

const TIPOS_GARANTIA_OPC = [
  ['buen_uso_anticipo','Buen uso del anticipo'],
  ['fiel_cumplimiento','Fiel cumplimiento'],
  ['buena_calidad_materiales','Buena calidad de materiales y equipos'],
  ['todo_riesgo','Todo riesgo'],
  ['otra','Otra']
];

const TIPOS_SOLICITUD = {
  planilla:      { label:'Aprobación de Planillas',    emoji:'📄', color:'#0073ea' },
  liberacion:    { label:'Liberación de Actividad',    emoji:'✅', color:'#00c875' },
  documentacion: { label:'Documentación',              emoji:'📁', color:'#ff9f00' },
  presupuesto:   { label:'Aprobación de Presupuestos', emoji:'💰', color:'#9b59b6' },
  qhse:          { label:'QHSE',                       emoji:'🦺', color:'#e2445c' },
  cambio:        { label:'Cambios',                    emoji:'🔄', color:'#676879' }
};

const ESTADOS_SOLICITUD = {
  pendiente:    { label:'Pendiente',          color:'#ff9f00', bg:'#fff3e0' },
  en_revision:  { label:'En revisión',        color:'#0073ea', bg:'#e8f4ff' },
  aprobada:     { label:'Aprobada',           color:'#00c875', bg:'#e8f5e9' },
  rechazada:    { label:'Rechazada',          color:'#e2445c', bg:'#fce4ec' },
  correccion:   { label:'Requiere corrección',color:'#856404', bg:'#fff3cd' }
};

const TIPOS_PERMITIDOS = {
  'application/pdf': '📄 PDF',
  'application/msword': '📝 Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝 Word',
  'application/vnd.ms-excel': '📊 Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📊 Excel',
  'image/vnd.dwg': '📐 DWG',
  'application/acad': '📐 DWG',
  'image/x-dwg': '📐 DWG',
  'application/octet-stream': '📐 Archivo'
};

const ANEXO1_CHECKLIST = [
  { id:'I', nombre:'Gestión Administrativa', items:[
    ['I.1','¿Cuenta con Plan de Prevención de Riesgos Laborales (1-10 trabajadores) aprobado y registrado en la plataforma SUT?'],
    ['I.2','¿Cuenta con Reglamento de Higiene y Seguridad (+10 trabajadores) aprobado y registrado en la plataforma SUT?'],
    ['I.3','¿Se ha socializado a todos los trabajadores la Política de SST?'],
    ['I.4','¿Cuenta con registro del Monitor de Seguridad e Higiene en la plataforma SUT?'],
    ['I.5','¿Cuenta con registro del Técnico de Seguridad e Higiene en la plataforma SUT?'],
    ['I.6','¿Cuenta con registro del Servicio Externo de SST en la plataforma SUT?'],
    ['I.7','¿Cuenta con informe de actividades del técnico/servicio externo (objetivo, estadísticas de AT/incidentes/EP, actividades con horas, conclusiones, registro fotográfico, firmas)?'],
    ['I.8','¿Cuenta con registro del profesional médico en la plataforma SUT?'],
    ['I.9','¿Cuenta con registro del Delegado de SST en la plataforma SUT?'],
    ['I.10','¿Cuenta con registro del Comité de SST en la plataforma SUT?'],
    ['I.11','¿Cuenta con informe de gestión del Organismo Paritario (objetivo, cronograma según Art. 39 Decreto 255, conclusiones, fotos, firmas)?'],
    ['I.12','¿Se evidencia por escrito el procedimiento de deber de colaboración entre empleadores que realizan actividades simultáneas en un mismo lugar/centro (contratistas, subcontratistas)?'],
  ]},
  { id:'II', nombre:'Gestión Técnica', items:[
    ['II.1','¿Cuenta con diagrama de flujo de procesos productivos/servicios?'],
    ['II.2','¿Dispone de descriptivo por puesto de trabajo (n° trabajadores, actividades, horas/actividad, recursos/máquinas/químicos/biológicos)?'],
    ['II.3','¿Cuenta con mapa de riesgos (señalización, EPP, dispositivos de parada de emergencia)?'],
    ['II.4','¿Cuenta con matriz de identificación de peligros y evaluación de riesgos por puesto con metodología reconocida?'],
    ['II.5','¿Cuenta con informe de medición de agentes físico/químico/biológico (fecha, puesto, n° expuestos, agente, metodología, resultados, comparación normativa, firmas, certificados de calibración, fotos)?'],
    ['II.6','¿Cuenta con informe de evaluación de riesgos de seguridad/ergonómicos/psicosociales?'],
    ['II.7','¿Cuenta con informe de medidas de prevención/protección por puesto (jerarquía eliminación→sustitución→ing.→admin.→EPP, con fechas, seguimiento, firmas, evidencia fotográfica)?'],
    ['II.8','¿Cuenta con cálculo del riesgo residual en la matriz?'],
    ['II.9','¿Se ha verificado in situ la implementación de medidas?'],
    ['II.10','¿Limpieza/mantenimiento periódico de luminarias?'],
    ['II.11','¿Mantenimiento periódico de sistemas de ventilación?'],
    ['II.12','¿Se han clasificado agentes químicos según GHS (físicos, salud, ambiente)?'],
    ['II.13','¿Recipientes de químicos con tapas/cubiertas adecuadas?'],
    ['II.14','¿Se almacenan químicos por compatibilidad en áreas específicas?'],
    ['II.15','¿Se dispone de fichas de datos de seguridad (FDS) de fácil acceso?'],
    ['II.16','¿Etiquetado adecuado de químicos en español?'],
    ['II.17','¿Se aplican lineamientos NTE-INEN de transporte/almacenamiento/manejo de químicos?'],
    ['II.18','¿Se aplican medidas de bioseguridad?'],
    ['II.19','¿Área específica para desechos biológicos según autoridad competente?'],
    ['II.20','¿Mecanismos de control de plagas/vectores?'],
    ['II.21','¿Lugares/centros de trabajo ordenados y limpios?'],
    ['II.22','¿Áreas de circulación/pasillos con niveles mínimos de iluminación?'],
    ['II.23','¿Áreas delimitadas para circulación de personal/vehículos?'],
    ['II.24','¿Áreas delimitadas para emplazamiento de máquinas?'],
    ['II.25','¿Rampas diseñadas conforme a la norma?'],
    ['II.26','¿Estructuras de prevención contra caída de objetos/personas en buen estado (plataformas, barandillas, rodapiés, escaleras, cadenas, cuerdas, cables, eslingas, ganchos, poleas, tambores)?'],
    ['II.27','¿Dispositivos de parada de emergencia señalizados, accesibles y en lugar seguro?'],
    ['II.28','¿Partes fijas/móviles de motores y máquinas protegidas con resguardos?'],
    ['II.30','¿Puertas y salidas señalizadas y libres de obstáculos?'],
    ['II.31','Señalización preventiva.'],
    ['II.32','Señalización prohibitiva.'],
    ['II.33','Señalización de información.'],
    ['II.34','Señalización de obligación.'],
    ['II.35','Señalización de equipos contra incendio.'],
    ['II.36','Señalización de orientación para evacuación en emergencia.'],
    ['II.37','¿Cuenta con procedimientos de SST para trabajos especiales (objetivo, responsable, puesto, n° expuestos, riesgos, medidas de control, EPP, formato de permiso, registro de socialización)?'],
    ['II.38','¿Se emiten permisos de trabajo conforme al procedimiento?'],
    ['II.39','¿Cuenta con registros de apertura y cierre de permisos de trabajos especiales?'],
  ]},
  { id:'III', nombre:'Gestión del Talento Humano', items:[
    ['III.1','¿Se ha identificado en las evaluaciones de riesgo a grupos de atención prioritaria (adultos mayores, mujeres en lactancia, mujeres embarazadas, personas con discapacidad, enfermedades catastróficas)?'],
    ['III.2','¿Se evidencia in situ la implementación de medidas de prevención para estos grupos?'],
    ['III.3','¿Cuenta con certificación de Prevención de Riesgos Laborales en Actividades de Alto Riesgo: CONSTRUCCIÓN?'],
    ['III.4','¿Cuenta con certificación de Prevención de Riesgos Laborales en Actividades de Alto Riesgo: ENERGÍA ELÉCTRICA?'],
    ['III.5','¿El personal que opera vehículos/maquinaria agrícola cuenta con licencia de conducir según categoría?'],
    ['III.6','¿Cuenta con registro de asistencia a inducciones/re-inducciones (fecha, tema, nombre/cédula/firma trabajador, firma técnico SST, material, evaluación)?'],
    ['III.7','¿Se han efectuado campañas de comunicación en SST (con respaldos)?'],
    ['III.8','¿Cuenta con programa de formación/capacitación/entrenamiento en SST (objetivos, diagnóstico, contenido, cronograma por puesto, metodología, duración/frecuencia, responsables, material, firmas)?'],
    ['III.9','¿Cuenta con registro de asistencia a capacitaciones/entrenamientos?'],
    ['III.10','¿Las capacitaciones/entrenamientos están registrados en la plataforma SUT?'],
  ]},
  { id:'IV', nombre:'Procedimientos Operativos Básicos', items:[
    ['IV.1','¿Cuenta con matriz de exámenes médico-ocupacionales por puesto (puesto, n° expuestos, riesgo, tipo de examen, frecuencia, responsable, firmas)?'],
    ['IV.2','¿Cuenta con cronograma de planificación/ejecución de exámenes médicos?'],
    ['IV.3','¿Cuenta con informe de resultados de exámenes médicos por puesto?'],
    ['IV.4','¿Cuenta con certificados de aptitud médica laboral de ingreso y periódicos (firma trabajador + médico)?'],
    ['IV.5','¿Cuenta con informe trimestral de indicadores de enfermedad común/profesional y accidentes de trabajo?'],
    ['IV.6','¿Cuenta con procedimiento documentado de investigación de accidentes de trabajo aprobado por la máxima autoridad?'],
    ['IV.7','¿Cuenta con registro interno de incidentes/accidentes (fecha/hora, nombre/cédula, puesto, lugar, descripción, consecuencias)?'],
    ['IV.8','¿Cuenta con informe de investigación de accidente de trabajo (fecha/hora, lugar, trabajador, puesto, descripción, testigos, causas/consecuencias, acciones inmediatas, firmas)?'],
    ['IV.9','¿Se ha reportado el accidente de trabajo a la autoridad competente (evidencia de reporte)?'],
    ['IV.10','¿Se han aplicado medidas correctivas para evitar nuevos accidentes?'],
    ['IV.11','¿Cuenta con procedimiento documentado de investigación de enfermedades profesionales?'],
    ['IV.12','¿Se ha reportado la presunción de enfermedad profesional a la autoridad (evidencia)?'],
    ['IV.13','¿Se han aplicado medidas correctivas para evitar nuevas enfermedades profesionales?'],
    ['IV.14','¿Cuenta con programa anual de inspecciones internas de SST (objetivos, alcance, cronograma, lista de verificación, firmas)?'],
    ['IV.15','¿Se evidencia in situ la ejecución de inspecciones internas e implementación de correctivos?'],
    ['IV.16','¿Cuenta con plan de emergencias/contingencia (amenazas, procedimientos antes/durante/después, mapa de recursos, mapa de evacuación, cronograma de mantenimiento contra incendios, cronograma de simulacros, brigadas, firmas)?'],
    ['IV.17','¿Cuenta con informe anual de simulacros (fecha/hora, objetivo, tipo, lugar, duración, participantes, roles, descripción, incidencias, lecciones aprendidas, fotos, firmas)?'],
    ['IV.18','¿Se evidencia implementación de las acciones del plan de emergencia?'],
    ['IV.19','¿Cuenta con programa de mantenimiento de instalaciones/vehículos/máquinas/equipos/herramientas?'],
    ['IV.20','¿Se evidencia in situ la ejecución del programa de mantenimiento?'],
    ['IV.21','¿Cuenta con procedimiento de adquisición de EPP (identificación de necesidades, matriz de EPP por puesto, firmas)?'],
    ['IV.22','¿Cuenta con registro de entrega-recepción de EPP (fecha, nombre/cédula, detalle del EPP, firma trabajador, registro de devoluciones)?'],
    ['IV.23','¿Se evidencia in situ la correcta utilización de EPP y ropa de trabajo?'],
    ['IV.24','¿Se ha implementado el programa de prevención de riesgo psicosocial?'],
    ['IV.25','¿Se ha registrado el programa de prevención de riesgo psicosocial en la plataforma SUT?'],
    ['IV.26','¿Se ha implementado el programa de prevención del uso/consumo de alcohol, tabaco u otras drogas?'],
    ['IV.27','¿Se ha registrado dicho programa en la plataforma SUT?'],
  ]},
  { id:'V', nombre:'Servicios Permanentes', items:[
    ['V.1','¿Cuenta con botiquín de emergencia?'],
    ['V.2','¿El comedor tiene adecuada salubridad/ambientación (aplica ≥50 trabajadores y >2km de la población más cercana)?'],
    ['V.3','¿Servicios de cocina con adecuada salubridad y almacenamiento de alimentos?'],
    ['V.4','¿Abastecimiento de agua para consumo?'],
    ['V.5','¿Servicios higiénicos/excusados/urinarios en buenas condiciones, separados por sexo?'],
    ['V.6','¿Duchas en buenas condiciones?'],
    ['V.7','¿Lavabos en buenas condiciones con útiles de aseo?'],
    ['V.8','¿Vestuarios separados por sexo, limpios?'],
    ['V.9','¿Campamentos en buenas condiciones (luz eléctrica, ventilación, agua, servicios higiénicos, comedores, alojamiento/vestuarios separados)?'],
  ]},
];

// ── MATRIZ DE PERMISOS POR ROL (FASE 1: solo documentación) ──
// Refleja EXACTAMENTE la realidad actual del código (auditoría en PERMISOS.md,
// commit aa6757a). Las celdas afectadas por inconsistencias llevan un comentario
// // I-n que refiere a la sección 5 de PERMISOS.md. NINGÚN chequeo de la app lee
// esta constante todavía, salvo la fila `expediente` (puedeGenerarExpediente() la
// consulta); las demás siguen siendo solo la fuente del cuadro de la vista "Permisos"
// hasta que se migren los gates.
// Valores por celda: 'gestionar' (edita/crea/elimina algo en la sección),
// 'ver' (solo lectura), null (sin acceso).
const PERMISOS = {
  roles: [
    { id:'admin',        nombre:'Admin' },
    { id:'fiscalizador', nombre:'Fiscalizador' },
    { id:'residente',    nombre:'Residente' },
    { id:'tecnico_sst',  nombre:'Técnico SST' },
    { id:'bodeguero',    nombre:'Bodeguero' },
    { id:'visualizador', nombre:'Visualizador' },
    { id:'cliente',      nombre:'Cliente' }
  ],
  secciones: [
    // ── PLATAFORMA ──
    { id:'dashboard', nombre:'Dashboard', ambito:'plataforma', requiereModulo:null,
      roles:{ admin:'gestionar', fiscalizador:'ver', residente:null, tecnico_sst:null, bodeguero:null, visualizador:'ver', cliente:'ver' },
      nota:'Solo admin edita desde la tabla embebida de proyectos. Residente, Técnico SST y Bodeguero no lo tienen: aterrizan en su primera sección permitida (Proyectos / Materiales).' },
    { id:'proyectos', nombre:'Proyectos', ambito:'plataforma', requiereModulo:null,
      // I-4: fiscalizador puede CREAR proyectos (y definir sus módulos) pero no editarlos ni eliminarlos.
      // Residente, técnico SST y visualizador ven la lista de SUS proyectos en solo lectura.
      roles:{ admin:'gestionar', fiscalizador:'gestionar', residente:'ver', tecnico_sst:'ver', bodeguero:null, visualizador:'ver', cliente:null },
      nota:'Editar solo admin; crear admin/fiscalizador (I-4). Residente, técnico SST y visualizador: solo lectura de sus proyectos (respaldado por RLS ola1_update/delete).' },
    { id:'cartera', nombre:'Cartera', ambito:'plataforma', requiereModulo:null,
      // I-14: el ítem del nav solo se calcula al iniciar sesión; ser fiscalizador en ALGÚN proyecto basta.
      roles:{ admin:'gestionar', fiscalizador:'ver', residente:null, tecnico_sst:null, bodeguero:null, visualizador:null, cliente:null },
      nota:'Fiscalizador la ve si lo es en algún proyecto (I-14). "Generar resumen" solo admin.' },
    { id:'usuarios', nombre:'Usuarios', ambito:'plataforma', requiereModulo:null,
      // I-11: el gate usa el rol efectivo del proyecto, no el rol global.
      roles:{ admin:'gestionar', fiscalizador:null, residente:null, tecnico_sst:null, bodeguero:null, visualizador:null, cliente:null },
      nota:'I-11: el gate usa el rol efectivo del proyecto activo, no el rol global.' },
    { id:'reportesGlobales', nombre:'Reportes Globales', ambito:'plataforma', requiereModulo:null,
      roles:{ admin:'ver', fiscalizador:null, residente:null, tecnico_sst:null, bodeguero:null, visualizador:null, cliente:null },
      nota:'Sección de solo consulta. Mismo gate que Usuarios (I-11).' },
    // ── POR PROYECTO ──
    { id:'rubros', nombre:'Rubros (+ Órdenes de Cambio)', ambito:'proyecto', requiereModulo:null,
      roles:{ admin:'gestionar', fiscalizador:'gestionar', residente:'ver', tecnico_sst:null, bodeguero:null, visualizador:'ver', cliente:null },
      nota:'Órdenes de Cambio y "Eliminar todos" solo admin/fiscalizador. Residente y visualizador: solo lectura por gate de ROL (ya no por CSS, cierra I-8). Ojo: por API el residente aún puede cambiar cantidad_ejecutada y estado (lo exige el Libro de Obra).' },
    { id:'libro', nombre:'Libro de Obra', ambito:'proyecto', requiereModulo:'libro',
      roles:{ admin:'gestionar', fiscalizador:'gestionar', residente:'gestionar', tecnico_sst:null, bodeguero:null, visualizador:'ver', cliente:null },
      nota:'Aprobar/observar solo admin/fiscalizador; reabrir solo admin. Residente crea (nace pendiente). Visualizador: solo lectura vía CSS (I-8).' },
    { id:'curvaS', nombre:'Curva S', ambito:'proyecto', requiereModulo:'curvaS',
      // I-8: cronograma sin gate JS; visualizador y cliente contenidos solo por CSS.
      roles:{ admin:'gestionar', fiscalizador:'gestionar', residente:null, tecnico_sst:null, bodeguero:null, visualizador:'ver', cliente:'ver' },
      nota:'Crear línea base admin/fiscalizador; activarla solo admin. Visualizador y cliente: solo lectura vía CSS (I-8).' },
    { id:'fiscalizacion', nombre:'Observaciones', ambito:'proyecto', requiereModulo:'observaciones',
      roles:{ admin:'gestionar', fiscalizador:'gestionar', residente:'gestionar', tecnico_sst:null, bodeguero:null, visualizador:null, cliente:null },
      nota:'El residente RESPONDE pero no RESUELVE: no puede cambiar el estado a mano y su respuesta mueve la observación de "abierta" a "en proceso" (si ya estaba resuelta, no la reabre). Solo admin/fiscalizador marcan "resuelta". Gate de UI; a nivel de datos observaciones sigue con USING(true) → Ola 2.' },
    { id:'solicitudes', nombre:'Solicitudes', ambito:'proyecto', requiereModulo:'solicitudes',
      // I-10: por un ID duplicado, el residente ve "Enviar comentario" y eso mueve la solicitud a en_revision.
      roles:{ admin:'gestionar', fiscalizador:'gestionar', residente:'gestionar', tecnico_sst:null, bodeguero:null, visualizador:null, cliente:null },
      nota:'Residente crea; aprobar/rechazar admin/fiscalizador; eliminar solo admin. I-10: residente puede comentar y cambiar el estado.' },
    { id:'planillas', nombre:'Planillas', ambito:'proyecto', requiereModulo:'planillas',
      roles:{ admin:'gestionar', fiscalizador:'gestionar', residente:'gestionar', tecnico_sst:null, bodeguero:null, visualizador:null, cliente:null },
      nota:'Flujo por estado: crear los tres; revisar/aprobar admin/fiscalizador; pagar solo admin. La sección mejor cerrada.' },
    { id:'contrato', nombre:'Contrato', ambito:'proyecto', requiereModulo:null,
      // I-3: visible para TODOS salvo tecnico_sst (incluso sin membresía); solo-lectura de facto sin aviso.
      roles:{ admin:'gestionar', fiscalizador:'gestionar', residente:'ver', tecnico_sst:null, bodeguero:'ver', visualizador:'ver', cliente:'ver' },
      nota:'I-3: visible para todos salvo Técnico SST, incluso sin rol en el proyecto; solo lectura de facto sin aviso.' },
    { id:'expediente', nombre:'Expediente de obra', ambito:'proyecto', requiereModulo:null,
      // Primera fila consumida por código: puedeGenerarExpediente() / puedeVerExpedientes() leen esta celda.
      // 'gestionar' = generar y ver la lista; 'ver' = solo la lista; null = nada. Solo admin (decisión del 14-oct-2026).
      roles:{ admin:'gestionar', fiscalizador:null, residente:null, tecnico_sst:null, bodeguero:null, visualizador:null, cliente:null },
      nota:'Vive en Cierre de proyecto (dentro de Contrato). Solo admin (global o del proyecto) ve la lista y genera; en móvil solo la lista. Esta fila la lee el código (puedeGenerarExpediente / puedeVerExpedientes); las demás siguen siendo documentación. RLS: tabla expedientes_generados (20261014_expedientes_solo_admin).' },
    { id:'ensayos', nombre:'Ensayos', ambito:'proyecto', requiereModulo:null,
      roles:{ admin:'gestionar', fiscalizador:'gestionar', residente:'ver', tecnico_sst:null, bodeguero:'ver', visualizador:'ver', cliente:null },
      nota:'Oculto para Técnico SST y Cliente. Eliminar solo admin. Los no-miembros ya no ven datos (RLS Ola 1).' },
    { id:'formatosCalidad', nombre:'Formatos de Calidad', ambito:'proyecto', requiereModulo:'formatosCalidad',
      // I-13: el botón "Revisar/Corregir" no tiene gate de rol.
      roles:{ admin:'gestionar', fiscalizador:'gestionar', residente:'gestionar', tecnico_sst:null, bodeguero:null, visualizador:null, cliente:null },
      nota:'Plantillas y asignación admin/fiscalizador; residente llena. I-13: "Revisar/Corregir" sin gate.' },
    { id:'sso', nombre:'SST / SSO', ambito:'proyecto', requiereModulo:'sst',
      // I-9: el botón "Asistentes" de Capacitaciones escapa al CSS y no tiene gate.
      // Residente SIN acceso a la sección (pendiente cerrarlo también en RLS → Ola 2).
      roles:{ admin:'gestionar', fiscalizador:'gestionar', residente:null, tecnico_sst:'gestionar', bodeguero:null, visualizador:'ver', cliente:null },
      nota:'Residente sin acceso a la sección (RLS sst_* aún lo permite escribir → Ola 2). Eliminar admin/fiscalizador; configurar admin/fisc/técnico SST. I-9: visualizador puede editar asistentes de capacitaciones.' },
    { id:'archivos', nombre:'Archivos', ambito:'proyecto', requiereModulo:null,
      // I-7: subir no tiene gate; todo rol que ve la sección puede subir (salvo visualizador, contenido por CSS).
      roles:{ admin:'gestionar', fiscalizador:'gestionar', residente:'gestionar', tecnico_sst:'gestionar', bodeguero:'gestionar', visualizador:'ver', cliente:null },
      nota:'I-7: subir sin gate para todo rol con acceso; eliminar solo admin/fiscalizador. Visualizador: solo lectura vía CSS (I-8).' },
    { id:'subcontratistas', nombre:'Subcontratistas', ambito:'proyecto', requiereModulo:'subcontratistas',
      roles:{ admin:'gestionar', fiscalizador:'gestionar', residente:'ver', tecnico_sst:null, bodeguero:'ver', visualizador:'ver', cliente:null },
      nota:'Gate coherente en el render (admin/fiscalizador); el resto solo lectura silenciosa.' },
    { id:'equipos', nombre:'Equipos', ambito:'proyecto', requiereModulo:'equipos',
      // I-7: el registro de horas no tiene gate, a diferencia del catálogo.
      roles:{ admin:'gestionar', fiscalizador:'gestionar', residente:'gestionar', tecnico_sst:null, bodeguero:null, visualizador:null, cliente:null },
      nota:'Catálogo admin/fiscalizador; I-7: registro de horas sin gate (residente escribe).' },
    { id:'materiales', nombre:'Materiales', ambito:'proyecto', requiereModulo:'materiales',
      // I-7: la sección no tiene un solo chequeo de rol.
      roles:{ admin:'gestionar', fiscalizador:'gestionar', residente:'gestionar', tecnico_sst:null, bodeguero:'gestionar', visualizador:null, cliente:null },
      nota:'I-7: sin ningún chequeo de rol; todo rol con acceso gestiona todo.' },
    { id:'chat', nombre:'Chat de proyecto', ambito:'proyecto', requiereModulo:null,
      // I-9: crear canal no tiene gate (el "+" escapa al CSS de visualizador).
      roles:{ admin:'gestionar', fiscalizador:'gestionar', residente:'gestionar', tecnico_sst:'gestionar', bodeguero:'gestionar', visualizador:'gestionar', cliente:null },
      nota:'Participar es la función normal. Eliminar canal solo admin; invitar a privados solo admin. I-9: crear canal sin gate.' }
  ]
};

// ── EXPEDIENTE DE OBRA ──
// Catálogo de secciones del expediente, en el orden del documento. fase: 1 =
// disponible; 2 y 3 = el modal las muestra deshabilitadas como «próximamente»
// para que el catálogo ya refleje la estructura final. fija: siempre incluida.
const EXPEDIENTE_SECCIONES = [
  { clave:'portada',             etiqueta:'Portada y ficha del proyecto',                      fase:1, orden:1,  fija:true },
  { clave:'indice',              etiqueta:'Índice',                                             fase:1, orden:2,  fija:true },
  { clave:'contrato',            etiqueta:'Contrato (datos, anticipo, garantías, fórmula polinómica)', fase:1, orden:3 },
  { clave:'presupuesto',         etiqueta:'Presupuesto (rubros)',                               fase:1, orden:4 },
  { clave:'ordenes_cambio',      etiqueta:'Órdenes de cambio',                                  fase:1, orden:5 },
  { clave:'cronograma',          etiqueta:'Cronograma, líneas base y Curva S',                  fase:1, orden:6 },
  { clave:'libro_obra',          etiqueta:'Libro de obra (todos los registros y sus fotos)',    fase:1, orden:7 },
  { clave:'planillas',           etiqueta:'Planillas de pago',                                  fase:1, orden:8 },
  { clave:'ensayos',             etiqueta:'Ensayos de laboratorio',                             fase:1, orden:9 },
  { clave:'formatos_calidad',    etiqueta:'Formatos de calidad (listado con referencia)',       fase:1, orden:10 },
  { clave:'observaciones',       etiqueta:'Observaciones de fiscalización (con respuestas y fotos)', fase:1, orden:11 },
  { clave:'sst',                 etiqueta:'Seguridad y salud en el trabajo',                    fase:1, orden:12 },
  { clave:'subcontratistas',     etiqueta:'Subcontratistas',                                    fase:1, orden:13 },
  { clave:'comunicados',         etiqueta:'Comunicados',                                        fase:3, orden:14 },
  { clave:'chat',                etiqueta:'Chat del proyecto (anexo, solo canales)',            fase:3, orden:15 },
  { clave:'archivos_planos_360', etiqueta:'Índice de archivos, planos y recorridos 360',        fase:3, orden:16 },
  { clave:'actas',               etiqueta:'Actas de recepción',                                 fase:1, orden:17 },
  { clave:'liquidacion',         etiqueta:'Liquidación',                                        fase:1, orden:18 }
];

// Presets por audiencia: secciones marcadas y filtros por defecto. Que un preset
// liste secciones de fases futuras no importa: el generador ignora las que no
// estén implementadas. El usuario puede ajustar a mano después de elegir uno.
// Filtros de la fase 2: libroDesde/libroHasta (null = todo el proyecto),
// observaciones ('todas' | 'resueltas') y calidadFotos ('estandar' 900 px | 'alta' 1200 px).
const EXPEDIENTE_PRESETS = {
  completo:    { etiqueta:'Completo (interno)',      secciones: EXPEDIENTE_SECCIONES.map(s=>s.clave),
                 filtros:{ incluirOCsNoAprobadas:true,  detallePlanillas:true, libroDesde:null, libroHasta:null, observaciones:'todas', calidadFotos:'estandar' } },
  contratante: { etiqueta:'Entrega al contratante', secciones: EXPEDIENTE_SECCIONES.map(s=>s.clave).filter(c=>c!=='chat'),
                 filtros:{ incluirOCsNoAprobadas:false, detallePlanillas:true, libroDesde:null, libroHasta:null, observaciones:'todas', calidadFotos:'estandar' } },
  contratista: { etiqueta:'Entrega al contratista', secciones: EXPEDIENTE_SECCIONES.map(s=>s.clave).filter(c=>c!=='chat'),
                 filtros:{ incluirOCsNoAprobadas:false, detallePlanillas:true, libroDesde:null, libroHasta:null, observaciones:'todas', calidadFotos:'estandar' } }
};
