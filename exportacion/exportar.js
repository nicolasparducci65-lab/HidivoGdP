#!/usr/bin/env node
// ============================================================================
// Exportación diaria del estado de proyectos: línea de comandos.
//
//   node exportar.js <datos.json> <carpeta-salida> [--version-app X] [--ahora ISO]
//
// <datos.json> es la salida de consulta.sql o, lo que es lo mismo, la respuesta de
// la función public.exportacion_estado_datos() llamada por la API (rpc), que
// devuelve el objeto directo. Se acepta en cuatro formas:
//   · el objeto «datos» directo                 { proyectos: […], … }
//   · envuelto                                  { datos: { … } }
//   · un arreglo de filas                       [ { datos: { … } } ]
//   · la envoltura de la CLI de Supabase        { rows: [ { datos: { … } } ] }
//
// Si hay al menos un proyecto escribe SIEMPRE los dos archivos
// (GDO-estado-proyectos.json y GDO-estado-proyectos.md) en la carpeta de salida,
// aunque algún bloque no se haya podido calcular. El .md se genera en memoria
// antes de escribir nada: si falla, no queda ningún archivo a medias.
//
// Salida estándar, dos líneas:
//   Estado válido para AAAA-MM-DD: N proyectos de T, M bloques fallidos
//   RESULTADO proyectos=N fallidos=M resumen=ok|parcial|null
// La segunda es para máquinas: «resumen» dice si las seis partes del resumen
// se calcularon (ok), solo algunas (parcial) o ninguna (null).
// El .json sale en «formato: 2» (lo describe la cabecera de estado-proyectos.js).
//
// Código de salida:
//   0  todo bien: archivos escritos y ningún bloque fallido
//   3  corrida DEGRADADA: archivos escritos, pero hay bloques fallidos
//      (fallidos > 0; el resumen puede estar parcial o null)
//   2  uso incorrecto, o el JSON de entrada no tiene la forma esperada
//   1  cualquier otro error (también: la exportación no tiene ningún proyecto;
//      en ese caso no se escribe nada)
//
// Ningún mensaje de error vuelca contenido del JSON de entrada: los mensajes son
// fijos y, en un error inesperado, solo se imprime el tipo de error y las líneas
// de la pila (archivos y funciones), nunca su mensaje.
// No toca la red ni la base: solo lee un archivo y escribe dos.
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { construirEstado, estadoAMarkdown, estadoDelResumen } = require('./estado-proyectos.js');

const NOMBRE_JSON = 'GDO-estado-proyectos.json';
const NOMBRE_MD = 'GDO-estado-proyectos.md';
// Las claves que consulta.sql siempre devuelve (cada una, un arreglo).
const TABLAS = ['proyectos', 'empresas', 'rubros', 'cronograma_rubros', 'lineas_base', 'planillas_pago',
  'planilla_historial', 'garantias', 'ordenes_cambio', 'libro_obra', 'observaciones', 'ensayos', 'sst_incidentes', 'solicitudes',
  'archivos', 'proyecto_miembros', 'perfiles', 'actas_recepcion', 'liquidaciones'];
const SALIDA = { BIEN: 0, ERROR: 1, ENTRADA: 2, DEGRADADA: 3 };

class ErrorDeEntrada extends Error {}

// Quita las envolturas hasta llegar al objeto «datos».
function desenvolver(entrada){
  let x = entrada;
  for(let i = 0; i < 6; i++){
    if(typeof x === 'string'){ try{ x = JSON.parse(x); }catch(e){ throw new ErrorDeEntrada('la columna «datos» no es JSON'); } continue; }
    if(Array.isArray(x)){
      if(x.length !== 1) throw new ErrorDeEntrada(`se esperaba una sola fila y llegaron ${x.length}`);
      x = x[0]; continue;
    }
    if(x && typeof x === 'object' && !Array.isArray(x.proyectos)){
      if(x.datos !== undefined){ x = x.datos; continue; }
      if(Array.isArray(x.rows)){ x = x.rows; continue; }
    }
    break;
  }
  if(!x || typeof x !== 'object' || Array.isArray(x)) throw new ErrorDeEntrada('no se encontró el objeto «datos»');
  const faltan = TABLAS.filter(t => !Array.isArray(x[t]));
  if(faltan.length) throw new ErrorDeEntrada('faltan tablas en los datos: ' + faltan.join(', '));
  return x;
}

// Versión de la app: el nombre de caché de la primera línea de service-worker.js.
function versionDeLaApp(){
  try{
    const primera = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8').split(/\r?\n/)[0];
    const m = /['"]([^'"]+)['"]/.exec(primera);
    return m ? m[1] : null;
  }catch(e){ return null; }
}

function leerArgumentos(argv){
  const posicionales = [], op = {};
  for(let i = 0; i < argv.length; i++){
    const a = argv[i];
    if(a === '--version-app' || a === '--ahora'){
      if(i + 1 >= argv.length) throw new ErrorDeEntrada(`falta el valor de ${a}`);
      op[a === '--ahora' ? 'ahora' : 'versionApp'] = argv[++i];
    } else if(a.startsWith('--')) throw new ErrorDeEntrada(`opción desconocida: ${a}`);
    else posicionales.push(a);
  }
  if(posicionales.length !== 2) throw new ErrorDeEntrada('uso: node exportar.js <datos.json> <carpeta-salida> [--version-app X] [--ahora ISO]');
  if(op.ahora && isNaN(new Date(op.ahora).getTime())) throw new ErrorDeEntrada('--ahora no es un instante ISO válido');
  return { entrada: posicionales[0], salida: posicionales[1], op };
}

// Escribe los dos archivos: primero con nombre provisional y, con los dos ya en
// disco, los renombra. Así nunca queda un .json nuevo junto a un .md viejo a medias.
function escribirLosDos(carpeta, textoJson, textoMd){
  fs.mkdirSync(carpeta, { recursive: true });
  const pares = [[NOMBRE_JSON, textoJson], [NOMBRE_MD, textoMd]].map(([nombre, texto]) => ({ final: path.join(carpeta, nombre), tmp: path.join(carpeta, nombre + '.tmp'), texto }));
  try{
    pares.forEach(x => fs.writeFileSync(x.tmp, x.texto, 'utf8'));
    pares.forEach(x => fs.renameSync(x.tmp, x.final));
  } finally {
    pares.forEach(x => { try{ fs.unlinkSync(x.tmp); }catch(e){ /* ya renombrado o nunca escrito */ } });
  }
}

function principal(argv){
  const { entrada, salida, op } = leerArgumentos(argv);
  let texto;
  try{ texto = fs.readFileSync(entrada, 'utf8').replace(/^﻿/, ''); }
  catch(e){ throw new ErrorDeEntrada(`no se pudo leer ${entrada}: ${e.code || 'error de lectura'}`); }
  let crudo;
  try{ crudo = JSON.parse(texto); }
  catch(e){ throw new ErrorDeEntrada('el archivo de entrada no es JSON válido'); }
  const datos = desenvolver(crudo);

  const estado = construirEstado(datos, { ahora: op.ahora, versionApp: op.versionApp || versionDeLaApp() });
  const fallidos = estado.bloques_fallidos.length;
  const resultado = `RESULTADO proyectos=${estado.proyectos.length} fallidos=${fallidos} resumen=${estadoDelResumen(estado)}`;
  if(!estado.proyectos.length){
    console.error(`La exportación no tiene ningún proyecto (de ${estado.proyectos_total} en la base): no se escribe nada.`);
    console.log(resultado);
    return SALIDA.ERROR;
  }
  // Todo en memoria antes de tocar el disco.
  const textoJson = JSON.stringify(estado, null, 2) + '\n';
  const textoMd = estadoAMarkdown(estado);
  escribirLosDos(salida, textoJson, textoMd);
  console.log(`Estado válido para ${estado.valido_para}: ${estado.proyectos_incluidos} proyectos de ${estado.proyectos_total}, ${fallidos} bloques fallidos`);
  console.log(resultado);
  return fallidos > 0 ? SALIDA.DEGRADADA : SALIDA.BIEN;
}

// Un error inesperado puede llevar en su mensaje un valor de los datos: no se imprime.
// Solo el tipo de error y las líneas «at …» de la pila (archivo, línea y función).
function describirSinDatos(e){
  const tipo = e && typeof e.name === 'string' && /^[A-Za-z]+$/.test(e.name) ? e.name : 'Error';
  const pila = e && typeof e.stack === 'string' ? e.stack.split('\n').filter(l => /^\s+at /.test(l)).slice(0, 8) : [];
  return [tipo].concat(pila).join('\n');
}

if(require.main === module){
  try{ process.exitCode = principal(process.argv.slice(2)); }
  catch(e){
    if(e instanceof ErrorDeEntrada){ console.error('Entrada no válida: ' + e.message); process.exitCode = SALIDA.ENTRADA; }
    else { console.error('Error inesperado (el mensaje no se imprime para no volcar datos): ' + describirSinDatos(e)); process.exitCode = SALIDA.ERROR; }
  }
}

module.exports = { desenvolver, versionDeLaApp, principal, describirSinDatos, NOMBRE_JSON, NOMBRE_MD, TABLAS, SALIDA };
