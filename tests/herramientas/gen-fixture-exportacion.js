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
// 17 proyectos. Entran 11:
//   001 amarillo · 002 rojo (con una planilla de fecha corrupta, a propósito) · 003 pausado
//   004 finalizado SIN acta que entra solo por su garantía vigente (sin fila de acta)
//   005 finalizado con acta definitiva y sin liquidación
//   008 / 009 / 010 finalizados con acta definitiva y liquidación cuyo ÚNICO pendiente es,
//       respectivamente, una garantía vigente, una planilla aprobada y una observación en proceso
//   013 cancelado con pendientes (y con un correo y un uuid dentro de textos libres)
//   015 sin línea base activa y con dos líneas base
//   016 en ejecución con recepción provisional y sin la fila del acta (fila sin fecha)
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
const perfiles = [
  { id: U.ana, nombre: 'Ana', apellido: 'Zzzperez' },
  { id: U.luis, nombre: 'Luis', apellido: 'Zzzmora' },
  { id: U.eva, nombre: 'Eva', apellido: 'Zzzleon' }
];
const P = {};
['p1', 'p2', 'p3', 'p4', 'p5', 'liq', 'sin', 'fin', 'p8', 'p9', 'p10', 'p11', 'p12', 'p13', 'p14', 'p15', 'p16'].forEach(k => { P[k] = id(); });
const proy = (pid, x) => ({ id: pid, empresa_id: E.g, emisor_empresa_id: null, codigo: null, tipo: 'fiscalizacion', nombre: 'ZZZ', descripcion: null,
  contratante: 'ZZZ Cliente de Ejemplo S.A.', contratista: 'ZZZ Constructora de Ejemplo', monto_contrato: null, fecha_inicio: null,
  fecha_fin_planificada: null, fecha_fin_real: null, estado: 'ejecucion', estado_cierre: 'en_ejecucion', ubicacion: null, latitud: null, longitud: null, ...x });
const cerradoCompleto = { estado: 'finalizado', estado_cierre: 'recepcion_definitiva', monto_contrato: 10000 };
const porClave = {
  p1: proy(P.p1, { codigo: 'ZZZ-FIS-2026-001', nombre: 'ZZZ Edificio de ejemplo', descripcion: 'Construcción de un edificio de dos plantas.\nIncluye obras exteriores | y cerramiento.',
    monto_contrato: 410000, fecha_inicio: '2026-08-03', fecha_fin_planificada: '2026-12-15', ubicacion: 'ZZZ Ciudad de Ejemplo' }),
  p2: proy(P.p2, { codigo: 'ZZZ-PIL-2026-002', nombre: 'ZZZ Pilotes de ejemplo', tipo: 'pilotes', emisor_empresa_id: E.e, monto_contrato: 50000,
    fecha_inicio: '2026-09-01', fecha_fin_planificada: '2026-11-30', ubicacion: 'ZZZ Muelle de Ejemplo', latitud: -2.19, longitud: -79.88 }),
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
  p16: proy(P.p16, { codigo: 'ZZZ-MUR-2026-016', nombre: 'ZZZ Muro con recepcion provisional', tipo: 'muros_pantalla', estado_cierre: 'recepcion_provisional' })
};
// Orden revuelto a propósito: la salida no puede depender del orden de llegada.
const proyectos = ['p15', 'p5', 'p1', 'p13', 'liq', 'p10', 'p3', 'p16', 'p8', 'sin', 'p2', 'p9', 'p4', 'fin', 'p12', 'p14', 'p11'].map(k => porClave[k]);

const rubros = [], cronograma_rubros = [], lineas_base = [];
const rubro = (pid, codigo, descripcion, monto, prod, estado = 'trabajando') => { const r = { id: id(), proyecto_id: pid, codigo, descripcion, monto_contrato: monto, total_produccion: prod, estado }; rubros.push(r); return r; };
const lb = (pid, numero, activa) => { const l = { id: id(), proyecto_id: pid, numero, activa }; lineas_base.push(l); return l; };
const cron = (r, l, ini, fin, creada = '2026-07-20') => cronograma_rubros.push({ id: id(), proyecto_id: r.proyecto_id, rubro_id: r.id, linea_base_id: l.id, fecha_inicio: ini, fecha_fin: fin, created_at: ts(creada) });

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
// Sin cronograma y con producción: cuenta en el avance ejecutado (61,67 %) pero no en el valor ganado (58,33 %).
rubro(P.p1, 'OC-01', 'ZZZ Refuerzo adicional', 28600, 14300);
// Rubros de monto 0 (no mueven el SPI) para los bordes de «próximos 14 días» (hoy = 2026-11-21):
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

const planillas_pago = [], planilla_historial = [];
const planilla = (pid, numero, ini, fin, estado, bruto, liquido, creada, x = {}) => {
  const pl = { id: id(), proyecto_id: pid, numero, fecha_inicio: ini, fecha_fin: fin, estado, total_monto: bruto, total_liquido: liquido,
    fecha_aprobacion: null, fecha_pago: null, created_at: creada, updated_at: creada, ...x };
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
  { proyecto_id: P.fin, tipo: 'fiel_cumplimiento', vigencia_hasta: '2024-06-30', estado: 'devuelta' },
  { proyecto_id: P.p12, tipo: 'fiel_cumplimiento', vigencia_hasta: '2025-06-30', estado: 'devuelta' }
];
const ordenes_cambio = [
  { proyecto_id: P.p1, numero: 1, titulo: 'ZZZ Cambio de cubierta', estado: 'aprobada', monto_total: 10000, created_at: ts('2026-09-01') },
  { proyecto_id: P.p1, numero: 2, titulo: 'ZZZ Rampa de acceso', estado: 'aprobada', monto_total: 8600, created_at: ts('2026-09-20') },
  { proyecto_id: P.p1, numero: 3, titulo: 'ZZZ Refuerzo de losa', estado: 'solicitada', monto_total: 12000, created_at: ts('2026-11-15') },
  { proyecto_id: P.p1, numero: 4, titulo: 'ZZZ Descartada', estado: 'rechazada', monto_total: 500, created_at: ts('2026-08-15') },
  { proyecto_id: P.fin, numero: 1, titulo: 'ZZZ Ajuste final', estado: 'aprobada', monto_total: 0, created_at: ts('2024-01-20') },
  { proyecto_id: P.p12, numero: 1, titulo: 'ZZZ Borrador olvidado', estado: 'borrador', monto_total: 100, created_at: ts('2025-01-20') },
  // Un uuid dentro de un título: no debe llegar a la salida
  { proyecto_id: P.p13, numero: 2, titulo: 'ZZZ Ajuste ref. bbbbbbbb-1111-4222-8333-444444444444', estado: 'solicitada', monto_total: 3000, created_at: ts('2026-11-01') }
];
const libro_obra = [
  { proyecto_id: P.p1, ultimo_registro: '2026-11-19', pendientes_aprobacion: 2 },
  { proyecto_id: P.p2, ultimo_registro: '2026-11-21', pendientes_aprobacion: 0 },
  { proyecto_id: P.p4, ultimo_registro: '2025-12-20', pendientes_aprobacion: 0 }
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
  // Un correo dentro de un título: no debe llegar a la salida. 40 días.
  obs(P.p13, 7, 'ZZZ Avisar a zzz.residente@zzz-ejemplo.test', 'abierta', '2026-10-12', U.luis)
];
const en = (pid, cumple, resuelto, de = null) => ({ id: id(), proyecto_id: pid, cumple, resuelto, reensayo_de: de });
const e1 = en(P.p1, false, false), e2 = en(P.p1, false, false), e3 = en(P.p1, false, true);
const ensayos = [e1, e2, en(P.p1, false, false, e2.id), e3, en(P.p1, true, false, e3.id), en(P.p1, true, false)];
const sst_incidentes = [
  { proyecto_id: P.p1, estado: 'cerrado' },
  { proyecto_id: P.p2, estado: 'investigando' },
  { proyecto_id: P.p2, estado: 'abierto' }
];
const solicitudes = [
  { proyecto_id: P.p1, estado: 'pendiente' }, { proyecto_id: P.p1, estado: 'en_revision' }, { proyecto_id: P.p1, estado: 'aprobada' },
  { proyecto_id: P.p1, estado: 'correccion' }
];
const archivos = [
  { proyecto_id: P.p1, modulo: 'general', cantidad: 4 }, { proyecto_id: P.p1, modulo: 'contratos', cantidad: 1 },
  { proyecto_id: P.p1, modulo: 'libro_obra', cantidad: 12 }, { proyecto_id: P.p1, modulo: 'curva_s', cantidad: 2 },
  { proyecto_id: P.p1, modulo: 'curvaS', cantidad: 1 }, { proyecto_id: P.p2, modulo: 'general', cantidad: 3 },
  { proyecto_id: P.p2, modulo: null, cantidad: 1 }
];
const proyecto_miembros = [
  { proyecto_id: P.p1, usuario_id: U.ana, perfil_id: null, rol: 'fiscalizador' },
  { proyecto_id: P.p1, usuario_id: U.luis, perfil_id: null, rol: 'residente' },
  { proyecto_id: P.p1, usuario_id: U.luis, perfil_id: null, rol: 'residente' },   // duplicado: sale una vez
  { proyecto_id: P.p2, usuario_id: null, perfil_id: U.eva, rol: 'fiscalizador' }, // alta antigua, por perfil_id
  { proyecto_id: P.p2, usuario_id: id(), perfil_id: null, rol: 'residente' }      // perfil que no existe
];
// Con las dos actas y la liquidación (pero sin el estado «liquidado»): nada pendiente de cierre.
const cierreCompleto = pid => [{ proyecto_id: pid, tipo: 'provisional', fecha: '2024-03-01' }, { proyecto_id: pid, tipo: 'definitiva', fecha: '2024-09-01' }];
const actas_recepcion = [
  { proyecto_id: P.p5, tipo: 'provisional', fecha: '2026-04-01' },
  { proyecto_id: P.p5, tipo: 'definitiva', fecha: '2026-11-01' },
  ...cierreCompleto(P.fin), ...cierreCompleto(P.liq), ...cierreCompleto(P.p8), ...cierreCompleto(P.p9), ...cierreCompleto(P.p10)
  // P16 tiene estado de cierre «recepcion_provisional» y NO tiene la fila del acta: fila sin fecha.
];
const liquidaciones = [P.fin, P.liq, P.p8, P.p9, P.p10, P.p11].map(pid => ({ proyecto_id: pid }));

const datos = { proyectos, empresas, rubros, cronograma_rubros, lineas_base, planillas_pago, planilla_historial,
  garantias, ordenes_cambio, libro_obra, observaciones, ensayos, sst_incidentes, solicitudes, archivos, proyecto_miembros, perfiles,
  actas_recepcion, liquidaciones };
fs.writeFileSync(DESTINO, JSON.stringify(datos, null, 1) + '\n');
console.log('fixture escrito en ' + DESTINO + ': ' + Object.keys(datos).map(k => `${k} ${datos[k].length}`).join(', '));
