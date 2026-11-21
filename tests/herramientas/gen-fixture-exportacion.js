// Genera tests/fixtures/exportacion-estado.json: la entrada de la exportación diaria
// (la forma que devuelve exportacion/consulta.sql) con datos SINTÉTICOS, todo con prefijo ZZZ.
// Ningún dato sale de la base: nombres, códigos, correos e identificadores son inventados.
//
//   node herramientas/gen-fixture-exportacion.js            (escribe el fixture del repo)
//   node herramientas/gen-fixture-exportacion.js <ruta>     (escribe en otra ruta)
//
// Las fechas están pensadas para «hoy» = 2026-11-21 (el instante fijo de
// exportacion-estado.test.js). Si se cambia algo aquí, hay que regenerar el fixture y
// revisar las cifras esperadas de esa prueba.
//
// La forma es la de la consulta NUEVA (migración 20261123): perfiles con es_prueba, columnas de
// autor en planillas, órdenes de cambio, ensayos, incidentes y solicitudes, y excluidos_prueba en
// los agregados del libro y de los archivos. La prueba deriva de aquí la forma ANTERIOR.
//
// 32 proyectos. Entran 26, uno al menos de cada estado y uno sin estado. Solo los que están
// en ejecución llevan semáforo:
//   En ejecución (13):
//   001 amarillo, con dos rubros fuera del cronograma vigente (OC-01, con producción, y el 4.06,
//       de monto 0 y solo en la línea base antigua): avance principal 61,67 % (todos los
//       rubros) y valor ganado en cronograma 58,33 % (el del SPI 0,92)
//   002 rojo (con una planilla de fecha corrupta, a propósito)
//   015 verde, sin línea base activa y con dos líneas base
//   016 amarillo SOLO por «sin cronograma» (no tiene rubros), con recepción provisional y sin la
//       fila del acta (fila sin fecha)
//   018 rojo SOLO por «cronograma vencido sin haber terminado lo programado» (97 %: el SPI 0,97
//       y el atraso a la fecha de 24 días no llegan a sus umbrales; proyectado 21 días, los que
//       ya lleva pasado del fin). Su plazo contractual (15-dic) no ha vencido
//   019 verde: cronograma vencido y 100 % de valor ganado (vencido, pero la obra está terminada)
//   022 amarillo («sin cronograma») con «datos por completar»: rubro terminado (valor ganado
//       100 %) con producción de solo el 40 % (más de 10 puntos de diferencia)
//   023 rojo con SPI 0: nada hecho de lo programado. Atraso a la fecha = los 51 días que
//       lleva el cronograma; atraso proyectado no estimable (null)
//   027 rojo por SPI 0,60 con una MESETA en el plan: el plan se queda en 50 % del 31-ago al
//       1-nov. Con 50 % ganado, el atraso a la fecha cuenta desde el ÚLTIMO día de la meseta
//       (1-nov: 20 días), no desde el primero (31-ago: 82 días)
//   028 verde: lo programado está terminado (60 % de 60 %) y el cronograma vencido; un rubro
//       SIN cronograma sigue en obra (avance principal 70 %). Plazo contractual sin vencer (31-dic)
//   029 rojo SOLO por «plazo contractual vencido» (10-nov) con 68,3 % de avance: el cronograma va
//       al día (SPI 1,02). Tiene 12 rubros de monto 0 que empiezan en los próximos 14 días (la
//       lista muestra 10 «y 2 más») y la planilla 2 registrada DOS veces, una «en revisión» y otra
//       «aprobada» (doble envío): sale una vez, como aprobada, y avisa en «datos por completar»
//   030 amarillo («sin cronograma»): proyecto de PRUEBA. Todo su equipo son usuarios de prueba
//       (equipo vacío) y todo lo que tiene lo creó un usuario de prueba: una observación de 40
//       días (no entra en «Esperan decisión»), una solicitud, una orden de cambio solicitada, una
//       planilla en revisión, un ensayo fallido, un incidente SST, 2 registros del libro y 4 archivos
//   031 verde con «datos por completar»: el monto vigente (56.000) no cuadra con el contractual
//       (50.000) más la orden de cambio aprobada (2.000)
//   Sin semáforo (13):
//   003 pausado · 017 en planificación (sin rubros)
//   025 pausado con el cronograma atrasado y vencido (SPI 0,30): sin atrasos en la salida
//   004 finalizado SIN acta que entra solo por su garantía vigente (sin fila de acta)
//   005 finalizado con acta definitiva y sin liquidación
//   008 / 009 / 010 finalizados con acta definitiva y liquidación cuyo ÚNICO pendiente es,
//       respectivamente, una garantía vigente, una planilla aprobada y una observación en proceso
//   020 finalizado con una garantía VENCIDA: no da color, pero espera decisión
//   021 finalizado sin producción registrada («datos por completar») y con una observación
//   024 finalizado sin producción registrada y SIN ningún otro pendiente: entra solo por su
//       aviso de «datos por completar»
//   013 cancelado con pendientes (y con un correo y un uuid dentro de textos libres)
//   026 SIN estado (null): sin color, al final, con su bloque de avance y el aviso del núcleo
// Usuarios de prueba (es_prueba): «Prueba Uno», «PRUEBA Dos» y «Zoe Zzzcorreo» (la que la base marca
// por su correo con «+»: aquí solo llega el booleano). Además de lo del 030, en el 001 hay una
// observación de 50 días y un archivo de un usuario de prueba, y la fiscalizadora de prueba es
// miembro: nada de eso debe cambiar las cifras del 001.
// Quedan fuera 6: 006 liquidado · 011 en ejecución pero liquidado · el que no tiene código ·
//   007 finalizado sin pendientes · 012 cancelado sin pendientes · 014 finalizado sin acta ni pendientes
// El orden de los proyectos en el archivo está revuelto a propósito.
'use strict';
const fs = require('fs');
const path = require('path');
const DESTINO = process.argv[2] || path.join(__dirname, '..', 'fixtures', 'exportacion-estado.json');

let n = 0;
const id = () => 'aaaaaaaa-0000-4000-8000-' + String(++n).padStart(12, '0');
const ts = (fecha, hora = '15:00:00') => `${fecha}T${hora}+00:00`;

const E = { g: id(), h: id(), e: id() };
const empresas = [
  { id: E.g, nombre: 'ZZZ GESTORA', sigla: 'ZZG' },
  { id: E.h, nombre: 'ZZZ SEGUNDA', sigla: 'ZZH' },
  { id: E.e, nombre: 'ZZZ EMISOR', sigla: 'ZZE' }
];
const U = { ana: id(), luis: id(), eva: id() };
// Usuarios de prueba: la base los marca (nombre que empieza por «Prueba», o correo con «+»).
const T = { uno: 'aaaaaaaa-0000-4000-8000-00000000f001', dos: 'aaaaaaaa-0000-4000-8000-00000000f002', zoe: 'aaaaaaaa-0000-4000-8000-00000000f003' };
const perfiles = [
  { id: U.ana, nombre: 'Ana', apellido: 'Zzzperez', es_prueba: false },
  { id: U.luis, nombre: 'Luis', apellido: 'Zzzmora', es_prueba: false },
  { id: U.eva, nombre: 'Eva', apellido: 'Zzzleon', es_prueba: false },
  { id: T.uno, nombre: 'Prueba Uno', apellido: 'Zzzresidente', es_prueba: true },
  { id: T.dos, nombre: 'PRUEBA Dos', apellido: 'Zzzfiscal', es_prueba: true },
  { id: T.zoe, nombre: 'Zoe', apellido: 'Zzzcorreo', es_prueba: true }   // de prueba por su correo (con «+»), que no sale de la base
];
const P = {};
['p1', 'p2', 'p3', 'p4', 'p5', 'liq', 'sin', 'fin', 'p8', 'p9', 'p10', 'p11', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22', 'p23', 'p24', 'p25', 'p26', 'p27', 'p28'].forEach(k => { P[k] = id(); });
// Los proyectos añadidos con el formato 3 llevan id fijo para no mover los de los demás.
P.p29 = 'aaaaaaaa-0000-4000-8000-00000000e029'; P.p30 = 'aaaaaaaa-0000-4000-8000-00000000e030'; P.p31 = 'aaaaaaaa-0000-4000-8000-00000000e031';
const proy = (pid, x) => ({ id: pid, empresa_id: E.g, emisor_empresa_id: null, codigo: null, tipo: 'fiscalizacion', nombre: 'ZZZ', descripcion: null,
  contratante: 'ZZZ Cliente de Ejemplo S.A.', contratista: 'ZZZ Constructora de Ejemplo', monto_contrato: null, fecha_inicio: null,
  fecha_fin_planificada: null, fecha_fin_real: null, estado: 'ejecucion', estado_cierre: 'en_ejecucion', ubicacion: null, ...x });
const cerradoCompleto = { estado: 'finalizado', estado_cierre: 'recepcion_definitiva', monto_contrato: 10000 };
const porClave = {
  p1: proy(P.p1, { codigo: 'ZZZ-FIS-2026-001', nombre: 'ZZZ Edificio de ejemplo', descripcion: 'Construcción de un edificio de dos plantas.\nIncluye obras exteriores | y cerramiento.',
    monto_contrato: 410000, fecha_inicio: '2026-08-03', fecha_fin_planificada: '2026-12-15', ubicacion: 'ZZZ Ciudad de Ejemplo' }),
  p2: proy(P.p2, { codigo: 'ZZZ-PIL-2026-002', nombre: 'ZZZ Pilotes de ejemplo', tipo: 'pilotes', emisor_empresa_id: E.e, monto_contrato: 50000,
    fecha_inicio: '2026-09-01', fecha_fin_planificada: '2026-11-30', ubicacion: 'ZZZ Muelle de Ejemplo' }),
  p3: proy(P.p3, { codigo: 'ZZZ-CON-2026-003', nombre: 'ZZZ Obra pausada', tipo: 'construccion', empresa_id: E.h, estado: 'pausado' }),
  p4: proy(P.p4, { codigo: 'ZZZ-FIS-2025-004', nombre: 'ZZZ Finalizado sin acta', estado: 'finalizado', monto_contrato: 80000, fecha_inicio: '2025-03-01', fecha_fin_planificada: '2025-12-20' }),
  p5: proy(P.p5, { codigo: 'ZZZ-FIS-2025-005', nombre: 'ZZZ Finalizado sin liquidar', estado: 'finalizado', estado_cierre: 'recepcion_definitiva', monto_contrato: 60000 }),
  liq: proy(P.liq, { codigo: 'ZZZ-FIS-2024-006', nombre: 'ZZZ Liquidado', estado: 'finalizado', estado_cierre: 'liquidado', monto_contrato: 30000 }),
  sin: proy(P.sin, { codigo: null, nombre: 'ZZZ Sin codigo', tipo: null, estado: 'planificacion' }),
  fin: proy(P.fin, { codigo: 'ZZZ-FIS-2024-007', nombre: 'ZZZ Finalizado sin pendientes', estado: 'finalizado', estado_cierre: 'recepcion_definitiva', monto_contrato: 20000 }),
  p8: proy(P.p8, { ...cerradoCompleto, codigo: 'ZZZ-FIS-2024-008', nombre: 'ZZZ Solo garantia vigente' }),
  p9: proy(P.p9, { ...cerradoCompleto, codigo: 'ZZZ-FIS-2024-009', nombre: 'ZZZ Solo planilla aprobada' }),
  p10: proy(P.p10, { ...cerradoCompleto, codigo: 'ZZZ-FIS-2024-010', nombre: 'ZZZ Solo observacion en proceso' }),
  p11: proy(P.p11, { codigo: 'ZZZ-GER-2026-011', nombre: 'ZZZ En ejecucion pero liquidado', tipo: 'gerencia', estado: 'ejecucion', estado_cierre: 'liquidado', monto_contrato: 15000 }),
  p12: proy(P.p12, { codigo: 'ZZZ-FIS-2025-012', nombre: 'ZZZ Cancelado sin pendientes', estado: 'cancelado' }),
  p13: proy(P.p13, { codigo: 'ZZZ-DIS-2026-013', nombre: 'ZZZ Cancelado con pendientes', tipo: 'disenos', estado: 'cancelado',
    descripcion: 'ZZZ Diseños cancelados. Contacto: zzz.contratista@zzz-ejemplo.test (ref. cccccccc-1111-4222-8333-444444444444).' }),
  p14: proy(P.p14, { codigo: 'ZZZ-FIS-2023-014', nombre: 'ZZZ Cerrado sin acta ni pendientes', estado: 'finalizado' }),
  p15: proy(P.p15, { codigo: 'ZZZ-PUE-2026-015', nombre: 'ZZZ Puente sin linea base activa', tipo: 'puentes', emisor_empresa_id: E.e, monto_contrato: 100000 }),
  p16: proy(P.p16, { codigo: 'ZZZ-MUR-2026-016', nombre: 'ZZZ Muro con recepcion provisional', tipo: 'muros_pantalla', estado_cierre: 'recepcion_provisional' }),
  p17: proy(P.p17, { codigo: 'ZZZ-GER-2026-017', nombre: 'ZZZ Proyecto en planificacion', tipo: 'gerencia', estado: 'planificacion', fecha_inicio: '2027-01-11' }),
  p18: proy(P.p18, { codigo: 'ZZZ-CON-2026-018', nombre: 'ZZZ Cronograma vencido sin terminar', tipo: 'construccion', monto_contrato: 40000,
    fecha_inicio: '2026-08-01', fecha_fin_planificada: '2026-12-15' }),
  p19: proy(P.p19, { codigo: 'ZZZ-CON-2026-019', nombre: 'ZZZ Cronograma vencido y obra terminada', tipo: 'construccion', monto_contrato: 20000,
    fecha_inicio: '2026-08-01', fecha_fin_planificada: '2026-10-31' }),
  p20: proy(P.p20, { ...cerradoCompleto, codigo: 'ZZZ-FIS-2024-020', nombre: 'ZZZ Finalizado con garantia vencida' }),
  p21: proy(P.p21, { ...cerradoCompleto, codigo: 'ZZZ-FIS-2024-021', nombre: 'ZZZ Finalizado sin produccion' }),
  p22: proy(P.p22, { codigo: 'ZZZ-CON-2026-022', nombre: 'ZZZ Avance y cantidades distintos', tipo: 'construccion', monto_contrato: 50000 }),
  p23: proy(P.p23, { codigo: 'ZZZ-MUR-2026-023', nombre: 'ZZZ Muro sin nada ejecutado', tipo: 'muros_pantalla', monto_contrato: 40000,
    fecha_inicio: '2026-10-01', fecha_fin_planificada: '2026-12-31' }),
  p24: proy(P.p24, { ...cerradoCompleto, codigo: 'ZZZ-FIS-2024-024', nombre: 'ZZZ Finalizado sin produccion ni pendientes' }),
  p25: proy(P.p25, { codigo: 'ZZZ-CON-2026-025', nombre: 'ZZZ Pausado con cronograma atrasado', tipo: 'construccion', estado: 'pausado', monto_contrato: 30000,
    fecha_inicio: '2026-08-01', fecha_fin_planificada: '2026-10-30' }),
  p26: proy(P.p26, { codigo: 'ZZZ-GER-2026-026', nombre: 'ZZZ Proyecto sin estado', tipo: 'gerencia', estado: null, monto_contrato: 20000,
    fecha_inicio: '2026-10-01', fecha_fin_planificada: '2026-12-31' }),
  p27: proy(P.p27, { codigo: 'ZZZ-CON-2026-027', nombre: 'ZZZ Plan con meseta', tipo: 'construccion', monto_contrato: 100000,
    fecha_inicio: '2026-08-01', fecha_fin_planificada: '2026-12-01' }),
  p28: proy(P.p28, { codigo: 'ZZZ-CON-2026-028', nombre: 'ZZZ Programado terminado y rubro sin cronograma', tipo: 'construccion', monto_contrato: 100000,
    fecha_inicio: '2026-08-01', fecha_fin_planificada: '2026-12-31' }),
  p29: proy(P.p29, { codigo: 'ZZZ-PUE-2026-029', nombre: 'ZZZ Plazo contractual vencido', tipo: 'puentes', monto_contrato: 60000,
    fecha_inicio: '2026-09-01', fecha_fin_planificada: '2026-11-10' }),
  p30: proy(P.p30, { codigo: 'ZZZ-PIL-2026-030', nombre: 'ZZZ Proyecto solo de pruebas', tipo: 'pilotes' }),
  p31: proy(P.p31, { codigo: 'ZZZ-PUE-2026-031', nombre: 'ZZZ Monto que no cuadra', tipo: 'puentes', monto_contrato: 50000,
    fecha_inicio: '2026-11-01', fecha_fin_planificada: '2026-12-31' })
};
// Orden revuelto a propósito: la salida no puede depender del orden de llegada.
const proyectos = ['p15', 'p21', 'p26', 'p5', 'p1', 'p13', 'p28', 'p19', 'liq', 'p10', 'p3', 'p23', 'p16', 'p8', 'sin', 'p25', 'p2', 'p20', 'p9', 'p4', 'p17', 'fin', 'p24', 'p12', 'p22', 'p14', 'p27', 'p18', 'p11', 'p31', 'p29', 'p30'].map(k => porClave[k]);

const rubros = [], cronograma_rubros = [], lineas_base = [];
const rubro = (pid, codigo, descripcion, monto, prod, estado = 'trabajando') => { const r = { id: id(), proyecto_id: pid, codigo, descripcion, monto_contrato: monto, total_produccion: prod, estado }; rubros.push(r); return r; };
const lb = (pid, numero, activa) => { const l = { id: id(), proyecto_id: pid, numero, activa }; lineas_base.push(l); return l; };
const cron = (r, l, ini, fin, creada = '2026-07-20') => cronograma_rubros.push({ id: id(), proyecto_id: r.proyecto_id, rubro_id: r.id, linea_base_id: l.id, fecha_inicio: ini, fecha_fin: fin, created_at: ts(creada) });
// Identificadores fijos para lo añadido con el formato 3 (no mueven los de lo anterior).
let n3 = 0;
const id3 = () => 'aaaaaaaa-0000-4000-8000-0000000d' + String(++n3).padStart(4, '0');

// P15: SIN línea base activa y con dos líneas base. Cuenta una fila por rubro, la más
// reciente (LB-2: plan 50 %, SPI 1,00, verde). La fila antigua va DESPUÉS en el archivo: si
// el generador se fiara del orden de llegada, contaría esa (plan 100 %, SPI 0,50, rojo).
const r151 = rubro(P.p15, '1', 'ZZZ Tablero', 100000, 50000);
const lb151 = lb(P.p15, 1, false), lb152 = lb(P.p15, 2, false);
cron(r151, lb152, '2026-11-01', '2026-12-11', '2026-10-20');
cron(r151, lb151, '2026-09-01', '2026-10-31', '2026-08-01');

// P1: SPI 250/270 = 0,926 (amarillo); la línea base antigua (LB-1) no debe contar.
const r11 = rubro(P.p1, '1.01', 'ZZZ Estructura', 100000, 100000, 'terminado');
const r12 = rubro(P.p1, '1.02', 'ZZZ Mampostería', 200000, 150000);
const r13 = rubro(P.p1, '3.01', 'ZZZ Instalaciones eléctricas', 100000, 0, 'planificado');
// Sin cronograma y con producción: cuenta en el avance principal y en el ejecutado por cantidades (61,67 % los dos),
// pero no en el valor ganado en cronograma (58,33 %), que es el numerador del SPI.
rubro(P.p1, 'OC-01', 'ZZZ Refuerzo adicional', 28600, 14300);
// Rubros de monto 0 (no mueven el SPI) para los bordes de «próximos 14 días» (hoy = 2026-11-21;
// la ventana va del 21-nov al 5-dic). Salen los que EMPIEZAN o TERMINAN en ella y no están terminados:
//   1.02 (01-oct a 30-nov): empezó antes y termina dentro: sale
//   3.01 (24-nov a 15-dic): empieza dentro: sale
const r14 = rubro(P.p1, '4.01', 'ZZZ Limpieza final', 0, 0, 'terminado');            // dentro de la ventana pero terminado: no sale
const r15 = rubro(P.p1, '4.02', 'ZZZ Jardinería', 0, 0, 'planificado');              // empieza a hoy+15: no sale
const r16 = rubro(P.p1, '4.03', 'ZZZ Pintura exterior', 0, 0, 'planificado');        // empieza a hoy+14: sale
const r17 = rubro(P.p1, '4.04', 'ZZZ Desencofrado', 0, 0);                           // termina hoy: sale
const r18 = rubro(P.p1, '4.05', 'ZZZ Replanteo', 0, 0);                              // terminó ayer: no sale
const r19 = rubro(P.p1, '4.06', 'ZZZ Solo en línea base antigua', 0, 0);             // solo en LB-1: no sale
// Las dos líneas base del proyecto llegan con la activa primero (el orden no debe importar).
const lb12 = lb(P.p1, 2, true), lb11 = lb(P.p1, 1, false);
cron(r11, lb12, '2026-08-03', '2026-09-30', '2026-09-25'); cron(r12, lb12, '2026-10-01', '2026-11-30', '2026-09-25'); cron(r13, lb12, '2026-11-24', '2026-12-15', '2026-09-25');
cron(r14, lb12, '2026-11-15', '2026-11-28', '2026-09-25'); cron(r15, lb12, '2026-12-06', '2026-12-20', '2026-09-25'); cron(r16, lb12, '2026-12-05', '2026-12-18', '2026-09-25');
cron(r17, lb12, '2026-11-10', '2026-11-21', '2026-09-25'); cron(r18, lb12, '2026-11-01', '2026-11-20', '2026-09-25');
cron(r11, lb11, '2026-08-03', '2026-08-20'); cron(r12, lb11, '2026-08-21', '2026-09-30'); cron(r13, lb11, '2026-10-01', '2026-10-31');
cron(r19, lb11, '2026-11-20', '2026-11-30');
// P2: SPI 0,22 (rojo)
const r21 = rubro(P.p2, 'P-01', 'ZZZ Pilotes hincados', 50000, 10000);
cron(r21, lb(P.p2, 1, true), '2026-09-01', '2026-11-30');
// P4 y P5: sin cronograma
rubro(P.p4, '1', 'ZZZ Obra civil', 80000, 80000, 'terminado');
rubro(P.p5, '1', 'ZZZ Obra civil', 60000, 60000, 'terminado');
rubro(P.fin, '1', 'ZZZ Obra civil', 20000, 20000, 'terminado');
rubro(P.liq, '1', 'ZZZ Obra civil', 30000, 30000, 'terminado');
rubro(P.p8, '1', 'ZZZ Obra civil', 10000, 10000, 'terminado');
// P9: cronograma ya vencido y obra terminada (SPI 1,00; cronograma_vencido = true)
const r91 = rubro(P.p9, '1', 'ZZZ Obra civil', 10000, 10000, 'terminado');
cron(r91, lb(P.p9, 1, true), '2024-01-01', '2024-06-30', '2023-12-15');
rubro(P.p10, '1', 'ZZZ Obra civil', 10000, 10000, 'terminado');
rubro(P.p11, '1', 'ZZZ Gerencia', 15000, 5000);
rubro(P.p14, '1', 'ZZZ Obra civil', 5000, 5000, 'terminado');
// P18: en ejecución, cronograma vencido el 31-oct y obra SIN terminar (97 %). Plan 100 %, SPI 0,97
// (no llega al amarillo). El plan (91 días) no superaba el 97 % hasta el día 88 (28-oct): atraso a
// la fecha 24 días (no pasa de 30). El ÚNICO motivo de rojo es el cronograma vencido.
const r181 = rubro(P.p18, '1', 'ZZZ Obra gris', 40000, 38800);
cron(r181, lb(P.p18, 1, true), '2026-08-01', '2026-10-31');
// P19: en ejecución, cronograma vencido y 100 % de valor ganado: verde.
const r191 = rubro(P.p19, '1', 'ZZZ Obra gris', 20000, 20000, 'terminado');
cron(r191, lb(P.p19, 1, true), '2026-08-01', '2026-10-31');
// P20: finalizado y completo; su único pendiente es una garantía vencida (ver garantias).
rubro(P.p20, '1', 'ZZZ Obra civil', 10000, 10000, 'terminado');
// P21: finalizado SIN producción registrada (su único pendiente es una observación abierta).
rubro(P.p21, '1', 'ZZZ Obra civil', 10000, 0, 'planificado');
// P22: sin cronograma. Rubro marcado «terminado» (valor ganado 100 %) con producción del 40 %.
rubro(P.p22, '1', 'ZZZ Estructura metálica', 50000, 20000, 'terminado');
// P23: SPI 0. Nada ejecutado, con el plan al 56 % (51 de 91 días).
const r231 = rubro(P.p23, '1', 'ZZZ Muro pantalla', 40000, 0);
cron(r231, lb(P.p23, 1, true), '2026-10-01', '2026-12-31');
// P24: finalizado, con las dos actas y la liquidación, SIN producción y sin ningún otro pendiente.
rubro(P.p24, '1', 'ZZZ Obra civil', 10000, 0, 'planificado');
// P25: pausado. Cronograma del 1-ago al 30-oct (90 días), ya vencido, con 30 % ganado: SPI 0,30.
// El núcleo le calcula 85 días de atraso a la fecha, pero la exportación no los escribe.
const r251 = rubro(P.p25, '1', 'ZZZ Estructura', 30000, 9000);
cron(r251, lb(P.p25, 1, true), '2026-08-01', '2026-10-30');
// P26: sin estado. Cronograma del 1-oct al 31-dic (91 días); plan a hoy 51/91 = 56,04 %; 25 % ganado: SPI 0,4461.
const r261 = rubro(P.p26, '1', 'ZZZ Gerencia', 20000, 5000);
cron(r261, lb(P.p26, 1, true), '2026-10-01', '2026-12-31');
// P27: meseta. Rubro A (50 %) del 1 al 31-ago, terminado; rubro B (50 %) del 1-nov al 1-dic, sin
// empezar. El plan vale 50 % del 31-ago al 1-nov; hoy (20 de 30 días de B) vale 83,33 %. SPI 0,60.
// Atraso a la fecha: 20 días (desde el 1-nov). Proyectado: 122 × (1/0,6 − 1) = 81.
const r271 = rubro(P.p27, '1', 'ZZZ Cimentación', 50000, 50000, 'terminado');
const r272 = rubro(P.p27, '2', 'ZZZ Estructura', 50000, 0, 'planificado');
const lb27 = lb(P.p27, 1, true);
cron(r271, lb27, '2026-08-01', '2026-08-31'); cron(r272, lb27, '2026-11-01', '2026-12-01');
// P28: lo programado (rubro A, 60 %) está terminado y su cronograma vencido el 31-oct; el rubro B
// (40 %) no tiene cronograma y va al 25 %: avance principal 60 + 10 = 70 %, SPI 1,00, verde.
const r281 = rubro(P.p28, '1', 'ZZZ Obra gris', 60000, 60000, 'terminado');
rubro(P.p28, '2', 'ZZZ Acabados', 40000, 10000);
cron(r281, lb(P.p28, 1, true), '2026-08-01', '2026-10-31');

const planillas_pago = [], planilla_historial = [];
const planilla = (pid, numero, ini, fin, estado, bruto, liquido, creada, x = {}) => {
  const pl = { id: id(), proyecto_id: pid, numero, fecha_inicio: ini, fecha_fin: fin, estado, total_monto: bruto, total_liquido: liquido,
    fecha_aprobacion: null, fecha_pago: null, created_at: creada, updated_at: creada, creado_por: U.luis, ...x };
  planillas_pago.push(pl); return pl;
};
const hist = (pl, accion, cuando) => planilla_historial.push({ planilla_id: pl.id, accion, created_at: cuando });
const pl13 = planilla(P.p1, 3, '2026-09-01', '2026-09-30', 'aprobada', 41000, 39100, ts('2026-10-05'));
hist(pl13, 'Planilla enviada a revisión', ts('2026-10-05')); hist(pl13, 'Planilla en revisión', ts('2026-10-10'));
// 02:30 UTC del 1-nov es todavía 31-oct en Ecuador
hist(pl13, 'Planilla aprobada por fiscalizador', ts('2026-11-01', '02:30:00'));
const pl14 = planilla(P.p1, 4, '2026-10-01', '2026-10-31', 'en_revision', 50000, 48250, ts('2026-11-10'));
hist(pl14, 'Planilla guardada como borrador', ts('2026-11-10')); hist(pl14, 'Planilla enviada a revisión', ts('2026-11-12')); hist(pl14, 'Planilla en revisión', ts('2026-11-14'));
planilla(P.p1, 5, '2026-11-01', '2026-11-30', 'borrador', 1000, null, ts('2026-11-20'));
// P2: dato corrupto a propósito (el bloque de planillas de este proyecto debe fallar)
planilla(P.p2, 1, '2026-09-01', '2026-09-30', 'enviada', 9000, null, 'fecha-corrupta');
const plFin = planilla(P.fin, 1, '2024-01-01', '2024-01-31', 'pagada', 20000, 19000, ts('2024-02-05'), { fecha_pago: '2024-03-01' });
hist(plFin, 'Planilla aprobada por fiscalizador', ts('2024-02-20'));
// P9: su único pendiente es esta planilla aprobada y sin pagar
const pl9 = planilla(P.p9, 7, '2024-06-01', '2024-06-30', 'aprobada', 10000, 9500, ts('2026-09-01'));
hist(pl9, 'Planilla enviada a revisión', ts('2026-09-01')); hist(pl9, 'Planilla aprobada por fiscalizador', ts('2026-09-15'));
// Planillas ya pagadas o rechazadas no son un pendiente
planilla(P.p8, 1, '2024-01-01', '2024-01-31', 'pagada', 10000, 9500, ts('2024-02-05'), { fecha_pago: '2024-03-01' });
planilla(P.p12, 1, '2025-01-01', '2025-01-31', 'rechazada', 500, null, ts('2025-02-05'));

const garantias = [
  { proyecto_id: P.p1, tipo: 'fiel_cumplimiento', vigencia_hasta: '2026-11-25', estado: 'vigente' },
  { proyecto_id: P.p1, tipo: 'buen_uso_anticipo', vigencia_hasta: '2027-02-01', estado: 'vigente' },
  { proyecto_id: P.p1, tipo: 'todo_riesgo', vigencia_hasta: null, estado: 'vigente' },
  { proyecto_id: P.p2, tipo: 'fiel_cumplimiento', vigencia_hasta: '2026-11-10', estado: 'vigente' },
  { proyecto_id: P.p3, tipo: 'otra', vigencia_hasta: '2026-12-07', estado: 'vigente' },                       // 16 días: no espera decisión
  { proyecto_id: P.p4, tipo: 'buena_calidad_materiales', vigencia_hasta: '2026-12-06', estado: 'vigente' },   // 15 días: sí
  { proyecto_id: P.p8, tipo: 'fiel_cumplimiento', vigencia_hasta: '2027-06-30', estado: 'vigente' },          // único pendiente de P8
  { proyecto_id: P.p20, tipo: 'buena_calidad_materiales', vigencia_hasta: '2026-10-01', estado: 'vigente' },  // vencida hace 51 días en un FINALIZADO: sin color
  { proyecto_id: P.fin, tipo: 'fiel_cumplimiento', vigencia_hasta: '2024-06-30', estado: 'devuelta' },
  { proyecto_id: P.p12, tipo: 'fiel_cumplimiento', vigencia_hasta: '2025-06-30', estado: 'devuelta' }
];
const ordenes_cambio = [
  { proyecto_id: P.p1, numero: 1, titulo: 'ZZZ Cambio de cubierta', estado: 'aprobada', monto_total: 10000, created_at: ts('2026-09-01'), creado_por: U.luis },
  { proyecto_id: P.p1, numero: 2, titulo: 'ZZZ Rampa de acceso', estado: 'aprobada', monto_total: 8600, created_at: ts('2026-09-20'), creado_por: U.luis },
  { proyecto_id: P.p1, numero: 3, titulo: 'ZZZ Refuerzo de losa', estado: 'solicitada', monto_total: 12000, created_at: ts('2026-11-15'), creado_por: U.luis },
  { proyecto_id: P.p1, numero: 4, titulo: 'ZZZ Descartada', estado: 'rechazada', monto_total: 500, created_at: ts('2026-08-15'), creado_por: null },
  { proyecto_id: P.fin, numero: 1, titulo: 'ZZZ Ajuste final', estado: 'aprobada', monto_total: 0, created_at: ts('2024-01-20'), creado_por: U.ana },
  { proyecto_id: P.p12, numero: 1, titulo: 'ZZZ Borrador olvidado', estado: 'borrador', monto_total: 100, created_at: ts('2025-01-20'), creado_por: U.ana },
  // Un uuid dentro de un título: no debe llegar a la salida
  { proyecto_id: P.p13, numero: 2, titulo: 'ZZZ Ajuste ref. bbbbbbbb-1111-4222-8333-444444444444', estado: 'solicitada', monto_total: 3000, created_at: ts('2026-11-01'), creado_por: U.luis },
  // 031: la orden de cambio aprobada que, sumada al contrato, no llega al monto vigente
  { proyecto_id: P.p31, numero: 1, titulo: 'ZZZ Barandas', estado: 'aprobada', monto_total: 2000, created_at: ts('2026-11-05'), creado_por: U.ana },
  // 030: solicitada por un usuario de prueba hace 30 días: no cuenta ni espera decisión
  { proyecto_id: P.p30, numero: 1, titulo: 'ZZZ Orden de cambio de prueba', estado: 'solicitada', monto_total: 999, created_at: ts('2026-10-22'), creado_por: T.uno }
];
// Agregado de la consulta: ya sin lo de los usuarios de prueba, que se cuenta en excluidos_prueba.
const libro_obra = [
  { proyecto_id: P.p1, ultimo_registro: '2026-11-19', pendientes_aprobacion: 2, excluidos_prueba: 0 },
  { proyecto_id: P.p2, ultimo_registro: '2026-11-21', pendientes_aprobacion: 0, excluidos_prueba: 0 },
  { proyecto_id: P.p4, ultimo_registro: '2025-12-20', pendientes_aprobacion: 0, excluidos_prueba: 0 },
  // 030: sus dos registros son de un usuario de prueba: la fila llega sin último registro
  { proyecto_id: P.p30, ultimo_registro: null, pendientes_aprobacion: 0, excluidos_prueba: 2 }
];
const obs = (pid, numero, titulo, estado, creada, por, ant = false) => ({ proyecto_id: pid, numero, titulo, estado, creado_por: por, created_at: ts(creada), con_antecedente: ant });
const observaciones = [
  obs(P.p1, 12, 'ZZZ Curado deficiente', 'abierta', '2026-10-18', U.ana, true),   // 34 días
  obs(P.p1, 15, 'ZZZ Acero expuesto', 'abierta', '2026-11-11', U.ana),            // 10 días
  obs(P.p1, 16, 'ZZZ Andamio sin anclaje', 'abierta', '2026-11-18', null),        // 3 días, sin autor
  obs(P.p1, 14, 'ZZZ Encofrado desalineado', 'en_proceso', '2026-11-01', U.luis), // 20 días
  obs(P.p1, 9, 'ZZZ Ya resuelta', 'resuelta', '2026-08-20', U.ana, true),
  obs(P.p3, 2, 'ZZZ Drenaje obstruido', 'en_proceso', '2026-11-05', U.eva),       // 16 días: entra
  obs(P.p3, 3, 'ZZZ Señalética faltante', 'abierta', '2026-11-06', U.eva),        // 15 días: no entra
  obs(P.fin, 1, 'ZZZ Cerrada', 'resuelta', '2024-01-10', U.ana),
  obs(P.p10, 4, 'ZZZ Sello de junta', 'en_proceso', '2026-11-16', U.eva),         // 5 días: único pendiente de P10
  obs(P.p12, 1, 'ZZZ Cerrada antes de cancelar', 'resuelta', '2025-02-10', U.ana),
  obs(P.p21, 1, 'ZZZ Falta el registro de cantidades', 'abierta', '2026-11-17', U.eva),   // 4 días: único pendiente de P21
  // Un correo dentro de un título: no debe llegar a la salida. 40 días.
  obs(P.p13, 7, 'ZZZ Avisar a zzz.residente@zzz-ejemplo.test', 'abierta', '2026-10-12', U.luis),
  // De usuarios de prueba: no cuentan, no se listan y no esperan decisión (40 y 50 días).
  obs(P.p30, 1, 'ZZZ Observación de prueba', 'abierta', '2026-10-12', T.uno),
  obs(P.p1, 99, 'ZZZ Observación de prueba en el edificio', 'abierta', '2026-10-02', T.zoe, true)
];
const en = (pid, cumple, resuelto, de = null, por = U.ana) => ({ id: id(), proyecto_id: pid, cumple, resuelto, reensayo_de: de, creado_por: por });
const e1 = en(P.p1, false, false), e2 = en(P.p1, false, false), e3 = en(P.p1, false, true);
const ensayos = [e1, e2, en(P.p1, false, false, e2.id), e3, en(P.p1, true, false, e3.id), en(P.p1, true, false)];
const sst_incidentes = [
  { proyecto_id: P.p1, estado: 'cerrado', created_by: U.ana },
  { proyecto_id: P.p2, estado: 'investigando', created_by: U.eva },
  { proyecto_id: P.p2, estado: 'abierto', created_by: null },
  { proyecto_id: P.p30, estado: 'abierto', created_by: T.dos }                      // de prueba: no cuenta
];
const solicitudes = [
  { proyecto_id: P.p1, estado: 'pendiente', creado_por: U.luis }, { proyecto_id: P.p1, estado: 'en_revision', creado_por: U.luis },
  { proyecto_id: P.p1, estado: 'aprobada', creado_por: U.luis }, { proyecto_id: P.p1, estado: 'correccion', creado_por: null },
  { proyecto_id: P.p30, estado: 'pendiente', creado_por: T.uno }                   // de prueba: no cuenta
];
// Agregado de la consulta: «cantidad» ya no cuenta lo subido por usuarios de prueba.
const archivos = [
  { proyecto_id: P.p1, modulo: 'general', cantidad: 4, excluidos_prueba: 1 }, { proyecto_id: P.p1, modulo: 'contratos', cantidad: 1, excluidos_prueba: 0 },
  { proyecto_id: P.p1, modulo: 'libro_obra', cantidad: 12, excluidos_prueba: 0 }, { proyecto_id: P.p1, modulo: 'curva_s', cantidad: 2, excluidos_prueba: 0 },
  { proyecto_id: P.p1, modulo: 'curvaS', cantidad: 1, excluidos_prueba: 0 }, { proyecto_id: P.p2, modulo: 'general', cantidad: 3, excluidos_prueba: 0 },
  { proyecto_id: P.p2, modulo: null, cantidad: 1, excluidos_prueba: 0 },
  // 030: todo lo subido es de prueba: los módulos llegan con cantidad 0 y no se listan
  { proyecto_id: P.p30, modulo: 'contratos', cantidad: 0, excluidos_prueba: 1 }, { proyecto_id: P.p30, modulo: 'general', cantidad: 0, excluidos_prueba: 3 }
];
const proyecto_miembros = [
  { proyecto_id: P.p1, usuario_id: U.ana, perfil_id: null, rol: 'fiscalizador' },
  { proyecto_id: P.p1, usuario_id: U.luis, perfil_id: null, rol: 'residente' },
  { proyecto_id: P.p1, usuario_id: U.luis, perfil_id: null, rol: 'residente' },   // duplicado: sale una vez
  { proyecto_id: P.p2, usuario_id: null, perfil_id: U.eva, rol: 'fiscalizador' }, // alta antigua, por perfil_id
  { proyecto_id: P.p2, usuario_id: id(), perfil_id: null, rol: 'residente' },     // perfil que no existe
  // 030: todo el equipo son usuarios de prueba (uno, dado de alta por perfil_id): equipo vacío
  { proyecto_id: P.p30, usuario_id: T.uno, perfil_id: null, rol: 'residente' },
  { proyecto_id: P.p30, usuario_id: T.dos, perfil_id: null, rol: 'fiscalizador' },
  { proyecto_id: P.p30, usuario_id: null, perfil_id: T.zoe, rol: 'fiscalizador' },
  // 001: una usuaria de prueba entre los miembros reales: no sale en el equipo
  { proyecto_id: P.p1, usuario_id: T.zoe, perfil_id: null, rol: 'fiscalizador' }
];
// Con las dos actas y la liquidación (pero sin el estado «liquidado»): nada pendiente de cierre.
const cierreCompleto = pid => [{ proyecto_id: pid, tipo: 'provisional', fecha: '2024-03-01' }, { proyecto_id: pid, tipo: 'definitiva', fecha: '2024-09-01' }];
const actas_recepcion = [
  { proyecto_id: P.p5, tipo: 'provisional', fecha: '2026-04-01' },
  { proyecto_id: P.p5, tipo: 'definitiva', fecha: '2026-11-01' },
  ...cierreCompleto(P.fin), ...cierreCompleto(P.liq), ...cierreCompleto(P.p8), ...cierreCompleto(P.p9), ...cierreCompleto(P.p10),
  ...cierreCompleto(P.p20), ...cierreCompleto(P.p21), ...cierreCompleto(P.p24)
  // P16 tiene estado de cierre «recepcion_provisional» y NO tiene la fila del acta: fila sin fecha.
];
const liquidaciones = [P.fin, P.liq, P.p8, P.p9, P.p10, P.p11, P.p20, P.p21, P.p24].map(pid => ({ proyecto_id: pid }));

// ── Añadido con el formato 3 (identificadores fijos id3) ─────────────────────
const rubro3 = (pid, codigo, descripcion, monto, prod, estado = 'trabajando') => { const r = { id: id3(), proyecto_id: pid, codigo, descripcion, monto_contrato: monto, total_produccion: prod, estado }; rubros.push(r); return r; };
const lb3 = (pid, numero, activa) => { const l = { id: id3(), proyecto_id: pid, numero, activa }; lineas_base.push(l); return l; };
const cron3 = (r, l, ini, fin, creada = '2026-08-20') => cronograma_rubros.push({ id: id3(), proyecto_id: r.proyecto_id, rubro_id: r.id, linea_base_id: l.id, fecha_inicio: ini, fecha_fin: fin, created_at: ts(creada) });
const planilla3 = (pid, numero, ini, fin, estado, bruto, liquido, creada, x = {}) => {
  const pl = { id: id3(), proyecto_id: pid, numero, fecha_inicio: ini, fecha_fin: fin, estado, total_monto: bruto, total_liquido: liquido,
    fecha_aprobacion: null, fecha_pago: null, created_at: creada, updated_at: creada, creado_por: U.luis, ...x };
  planillas_pago.push(pl); return pl;
};
// 001: una actividad EN CURSO (01-nov a 19-dic) que ni empieza ni termina en la ventana: no sale.
const r1c = rubro3(P.p1, '4.07', 'ZZZ Obra exterior en curso', 0, 0);
cron3(r1c, lb12, '2026-11-01', '2026-12-19', '2026-09-25');
// 029: plazo contractual vencido el 10-nov. Cronograma del 1-sep al 31-dic (121 días): plan a hoy
// 81/121 = 66,94 %; ganado 41.000 de 60.000 = 68,33 %: SPI 1,02, sin atraso. Rojo solo por el plazo.
const lb29 = lb3(P.p29, 1, true);
const r291 = rubro3(P.p29, '1', 'ZZZ Tablero y estribos', 60000, 41000);
cron3(r291, lb29, '2026-09-01', '2026-12-31');
// Doce rubros de monto 0 que empiezan dentro de la ventana, uno por día del 22-nov al 3-dic: la
// lista trae los diez primeros «y 2 más». El rubro 1 ni empieza ni termina en la ventana: no cuenta.
for(let k = 1; k <= 12; k++){
  const r = rubro3(P.p29, '2.' + String(k).padStart(2, '0'), 'ZZZ Acabado ' + k, 0, 0, 'planificado');
  cron3(r, lb29, new Date(Date.UTC(2026, 10, 21 + k)).toISOString().slice(0, 10), '2026-12-' + String(10 + k));
}
// Planilla 2 del 029 registrada DOS veces por un doble envío (mismo periodo y mismo monto, creadas
// a la vez): una quedó «en revisión» y la otra se aprobó. Sale una sola vez, como aprobada.
const pl29a = planilla3(P.p29, 2, '2026-10-01', '2026-10-31', 'en_revision', 21000, 20000, ts('2026-11-03'));
const pl29b = planilla3(P.p29, 2, '2026-10-01', '2026-10-31', 'aprobada', 21000, 20000, ts('2026-11-03'), { fecha_aprobacion: '2026-11-12', updated_at: ts('2026-11-12') });
[pl29a, pl29b].forEach(pl => hist(pl, 'Planilla enviada a revisión', ts('2026-11-03')));
hist(pl29b, 'Planilla aprobada por fiscalizador', ts('2026-11-12'));
planilla3(P.p29, 1, '2026-09-01', '2026-09-30', 'pagada', 21000, 20000, ts('2026-10-03'), { fecha_pago: '2026-10-20' });
// 030: lo único que tiene lo creó un usuario de prueba (ver también observaciones, órdenes de
// cambio, solicitudes, incidentes, libro, archivos y miembros).
planilla3(P.p30, 1, '2026-10-01', '2026-10-31', 'en_revision', 5000, 4800, ts('2026-11-01'), { creado_por: T.uno });
ensayos.push({ id: id3(), proyecto_id: P.p30, cumple: false, resuelto: false, reensayo_de: null, creado_por: T.dos });
// 031: monto vigente 56.000 frente a 50.000 de contrato + 2.000 de órdenes de cambio aprobadas.
// Cronograma del 1-nov al 11-dic (40 días): plan a hoy 50 %; ganado 28.000 = 50 %: SPI 1,00, verde.
const r311 = rubro3(P.p31, '1', 'ZZZ Superestructura', 56000, 28000);
cron3(r311, lb3(P.p31, 1, true), '2026-11-01', '2026-12-11');

const datos = { proyectos, empresas, rubros, cronograma_rubros, lineas_base, planillas_pago, planilla_historial,
  garantias, ordenes_cambio, libro_obra, observaciones, ensayos, sst_incidentes, solicitudes, archivos, proyecto_miembros, perfiles,
  actas_recepcion, liquidaciones };
fs.writeFileSync(DESTINO, JSON.stringify(datos, null, 1) + '\n');
console.log('fixture escrito en ' + DESTINO + ': ' + Object.keys(datos).map(k => `${k} ${datos[k].length}`).join(', '));
