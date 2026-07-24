// Constantes de datos de HIDIVO - extraidas de index.html sin cambios de contenido.
// Este archivo debe cargarse ANTES del script principal de index.html.

const LOGO_URL = 'https://cdn.gamma.app/7qw1kgi7655gw0b/741d4537f4c946fe9e75c05b6b91378e/original/logo-Hidivo.png';
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
  fiscalizacion:'Observaciones', solicitudes:'Solicitudes',
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

