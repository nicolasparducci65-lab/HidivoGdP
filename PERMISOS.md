# Matriz de permisos por rol — FASE 1 (realidad actual)

> Auditoría de solo lectura del código (2026-07-28, commit `aa6757a`). Documenta lo que la app
> **hace hoy**, no lo que debería hacer. Ninguna lógica de permisos fue modificada.
> Los números de línea refieren a `index.html` y `styles.css` en ese commit.

## 1. Modelo de roles

La app tiene **dos niveles de rol** y **tres capas de aplicación**:

**Niveles:**
- **Rol global** (`perfiles.rol`): solo dos valores asignables — `'admin'` o `null`. Se gestiona con el
  checkbox "Admin global" de Usuarios (`cambiarRolUsuario`, 12465). Un admin global es admin en
  todos los proyectos sin consultar membresías (`actualizarRolEfectivo`, 2969-2991).
- **Rol por proyecto** (`proyecto_miembros.rol`): 6 valores asignables en el select de miembros
  (1457-1464): `fiscalizador`, `residente`, `tecnico_sst`, `visualizador`, `bodeguero`, `cliente`.
  El **rol efectivo** (`currentPerfil.rol`) es el de la membresía del proyecto activo, o `null` sin membresía.

**Capas de aplicación (de más a menos fiable):**
1. **Mapa `accesos`** (2996-3003, duplicado en 3596-3604): decide qué nav-items se ven por rol.
2. **Chequeos JS en el render** (`puedeEditar = [...]`, helpers `sst*`, `esAprobadorLibro`): deciden qué botones se pintan.
3. **CSS por clase de body** (`styles.css:197-247`): `body.modo-visualizador` y `body.modo-cliente`
   ocultan botones por selector de atributo (`button[onclick*="eliminar"]`, etc.). Es la capa que
   sostiene la solo-lectura del visualizador y del cliente — y es **frágil**: cualquier botón cuyo
   `onclick` no coincida con los patrones queda expuesto (ver inconsistencias I-8 e I-9).

Las funciones de guardado casi **nunca revalidan el rol** (ver I-12): si un botón se muestra
(o se invoca la función por consola), la escritura llega a Supabase y la única defensa es RLS.

**Roles fantasma:**
- **`'director'`**: `guardarProyecto` (3750-3754) inserta al creador del proyecto en
  `proyecto_miembros` con `rol:'director'`, valor que no existe en el select ni en `accesos`
  → ese usuario cae al fallback `['dashboard']` y pierde el acceso al proyecto que creó (I-1).
- `'admin'` como rol de proyecto: existe como clave de `accesos` pero no es asignable en el select;
  solo llega sintéticamente desde el rol global (o escrito a mano en la BD, ver I-11).
- `'contratante'` **no** es un rol (es un campo de texto del proyecto).

## 2. Matriz — PLATAFORMA (secciones sin proyecto)

✏️ = gestionar · 👁 = solo ver · — = sin acceso

| Sección | admin | fiscalizador | residente | tecnico_sst | bodeguero | visualizador | cliente |
|---|---|---|---|---|---|---|---|
| Dashboard | ✏️ | 👁 | — | — | — | — | 👁 |
| Proyectos | ✏️ | ✏️ ⚠I-4 | — | — | — | — | — |
| Cartera | ✏️ | 👁 ⚠I-14 | — | — | — | — | — |
| Usuarios | ✏️ ⚠I-11 | — | — | — | — | — | — |
| Reportes Globales | 👁 ⚠I-11 | — | — | — | — | — | — |

- Dashboard: la tabla de proyectos embebida solo permite editar a admin (3379); fiscalizador y cliente la consultan.
- Cartera: visible para admin o para quien sea `fiscalizador` en **algún** proyecto (4762-4769); "Generar resumen" solo admin.

## 3. Matriz — POR PROYECTO

🧩 = la sección además requiere el módulo activado en `proyectos.modulos` (si es `null`, todos los módulos cuentan como activos).

| Sección | Módulo | admin | fiscalizador | residente | tecnico_sst | bodeguero | visualizador | cliente |
|---|---|---|---|---|---|---|---|---|
| Rubros (+OC) | — | ✏️ | ✏️ | — | — | — | 👁 ⚠I-8 | — |
| Libro de Obra | 🧩 libro | ✏️ | ✏️ | ✏️ | — | — | 👁 ⚠I-8 | — |
| Curva S | 🧩 curvaS | ✏️ | ✏️ | — | — | — | 👁 ⚠I-8 | 👁 ⚠I-8 |
| Observaciones | 🧩 observaciones | ✏️ | ✏️ | ✏️ | — | — | — | — |
| Solicitudes | 🧩 solicitudes | ✏️ | ✏️ | ✏️ ⚠I-10 | — | — | — | — |
| Planillas | 🧩 planillas | ✏️ | ✏️ | ✏️ | — | — | — | — |
| Contrato | — | ✏️ | ✏️ | 👁 ⚠I-3 | — ⚠I-3 | 👁 ⚠I-3 | 👁 | 👁 ⚠I-3 |
| Ensayos | — | ✏️ | ✏️ | 👁 ⚠I-3 | — ⚠I-3 | 👁 ⚠I-3 | 👁 | 👁 ⚠I-3 |
| Formatos de Calidad | 🧩 formatosCalidad | ✏️ | ✏️ | ✏️ ⚠I-13 | — | — | — | — |
| SST / SSO | 🧩 sst | ✏️ | ✏️ | ✏️ | ✏️ | — | 👁 ⚠I-9 | — |
| Archivos | — | ✏️ | ✏️ | ✏️ ⚠I-7 | ✏️ ⚠I-7 | ✏️ ⚠I-7 | 👁 | — |
| Subcontratistas | 🧩 subcontratistas | ✏️ | ✏️ | 👁 | — | 👁 | 👁 | — |
| Equipos | 🧩 equipos | ✏️ | ✏️ | ✏️ ⚠I-7 | — | — | — | — |
| Materiales | 🧩 materiales | ✏️ | ✏️ | ✏️ ⚠I-7 | — | ✏️ | — | — |
| Chat de proyecto | — | ✏️ | ✏️ | ✏️ | ✏️ | ✏️ | ✏️ ⚠I-9 | — |

Detalles dentro de cada ✏️ (subacciones con gate más estricto):
- **Rubros**: "Eliminar todos" y eliminar rubro individual solo admin (3106; CSS 236/238); Órdenes de Cambio solo admin/fiscalizador (3108).
- **Libro**: aprobar/observar solo admin/fiscalizador (`esAprobadorLibro`, 5226-5228); reabrir solo admin (5265); residente crea (sus registros nacen `pendiente`, 5599).
- **Curva S**: crear línea base admin/fiscalizador (6043); activar línea base solo admin (6090, única función que revalida).
- **Solicitudes**: aprobar/rechazar admin/fiscalizador (12109); eliminar solo admin (12147); residente crea.
- **Planillas**: la sección mejor cerrada — flujo por estado (10533-11024): crear admin/fisc/residente; revisar/aprobar admin/fisc; pagar solo admin; eliminar no-borrador solo admin.
- **Ensayos**: gestionar admin/fiscalizador (4516); eliminar solo admin (4575).
- **SST**: `sstPuedeGestionar` = admin/fisc/residente/tecnico_sst; eliminar = admin/fisc; config = admin/fisc/tecnico_sst; checklist con reglas propias por modo (14554).
- **Archivos**: eliminar solo admin/fiscalizador (7557); subir sin gate (7596).
- **Chat**: eliminar canal solo admin y nunca `general` (11294-11296); invitar a canal privado solo admin (11195); eliminar mensaje solo el autor (11411).

## 4. Dimensión `proyectos.modulos`

Mapeo módulo→sección en `aplicarModulosProyecto` (3608-3619). Ojo con los nombres asimétricos:
la clave **`observaciones`** controla la sección `fiscalizacion` y la clave **`sst`** controla `sso`.

- Secciones con módulo: curvaS, libro, observaciones→fiscalizacion, solicitudes, planillas,
  equipos, materiales, subcontratistas, formatosCalidad, sst→sso.
- Sin módulo (siempre disponibles si el rol las tiene): dashboard, proyectos, cartera, rubros,
  contrato, ensayos, archivos, chat, usuarios, reportesGlobales.
- `proyectos.modulos = null` ⇒ **todos los módulos activos** (comparación `!== false`, 3609-3618).
- El rol **cliente ignora los módulos**: ve Curva S aunque el módulo esté desactivado (3639).
- Los módulos se editan en el modal de proyecto (625-660, `guardarProyecto` 3737). El único gate
  real es el botón ✏️ de la tabla (admin, 3379); las otras 3 rutas al modal no chequean rol (I-4).

## 5. INCONSISTENCIAS ENCONTRADAS

**I-1. Rol fantasma `director` deja al creador del proyecto sin acceso a su propio proyecto.**
`guardarProyecto` (3750-3754) inserta la membresía del creador con `rol:'director'`, que no existe
en `accesos` (2996-3003) ni en el select de miembros (1457-1464). `accesos['director']` → fallback
`['dashboard']`: un fiscalizador que crea un proyecto solo ve Dashboard dentro de él.

**I-2. El auto-registro público otorga admin global.** `register()` (2476) crea el perfil con
`rol:'admin'`, mientras la gestión de usuarios crea con `rol:null` (12407). Dos políticas opuestas;
cualquiera que se registre por el formulario público es admin de toda la plataforma.

**I-3. Contrato y Ensayos son visibles para todos salvo tecnico_sst — incluso sin membresía.**
La regla es `rol==='tecnico_sst' ? 'none' : 'flex'` (3057-3058), fuera del mapa `accesos`. Un usuario
sin rol en el proyecto (o bodeguero/cliente) ve el módulo financiero completo (anticipo, garantías,
reajuste, cierre) en solo-lectura de facto y sin ningún aviso de solo lectura.

**I-4. Fiscalizador puede crear proyectos (y definir sus módulos) pero no editarlos.**
`acciones.proyectos.show = true` sin gate (3113); `abrirModalProyecto` (3661) y `guardarProyecto`
(3713) no chequean rol; el empty-state (3373) y el botón del Dashboard (356) tampoco. En cambio la
columna ✏️ exige admin (3379). Crea lo que luego no puede modificar (y cae en I-1).

**I-5. `navTo` no tiene ninguna comprobación de autorización.** Ocultar el nav-item es la única
protección; `navTo('usuarios')` desde consola ejecuta `cargarUsuarios()` (12211, lee todos los
perfiles) y `navTo('reportesGlobales')` lee todos los proyectos (8969). La defensa real es RLS.

**I-6. El mapa `accesos` está duplicado literalmente** en `aplicarAccesosPorRol` (2995-3003) y
`aplicarModulosProyecto` (3596-3604). Hoy son idénticos; editar uno sin el otro divergirá el
comportamiento entre "cambiar de rol" y "cambiar de proyecto".

**I-7. Escrituras sin gate en secciones con gate parcial.** Registro de horas de Equipos (9397,
9454) sin chequeo mientras el catálogo exige admin/fisc (9385); subir Archivos sin gate (7596)
mientras eliminar exige admin/fisc (7557); Materiales entero sin un solo chequeo de rol (9079-9356);
el panel de archivos adjuntos del Libro pinta 🗑 sin gate (12657) mientras la vista global sí lo gatea (7649).

**I-8. La solo-lectura de visualizador y cliente depende de CSS frágil.** `esVisualizador()` (2964)
es código muerto y no hay chequeos JS: la contención real son los selectores
`body.modo-visualizador button[onclick*="..."]` (styles.css:197-247). Funciona hoy, pero cualquier
botón futuro cuyo `onclick` no coincida con los patrones queda expuesto, y las funciones de guardado
no revalidan (p.ej. `guardarCronograma` 6299, `guardarRubro` 4019 — solo validan proyecto cerrado).

**I-9. Huecos ya existentes en esa capa CSS.** (a) El "+" de nuevo canal de chat (469,
`abrirModalNuevoCanal`) no coincide con ningún patrón: un visualizador puede crear canales
(`guardarNuevoCanal` 11623 no chequea). (b) El botón "👥 Asistentes" de Capacitaciones SST (14317,
`abrirModalAsistentes`) tampoco: un visualizador puede reescribir la lista de asistentes
(`guardarAsistentes` 14397 hace delete+insert sin chequeo).

**I-10. IDs duplicados rompen el gate de Solicitudes.** Hay dos `<div id="solBotonesAccion">`
(2264 y 2271); `getElementById` solo oculta el primero. El bloque "Enviar comentario" queda siempre
visible y `responderSolicitud('comentario')` (12168) **cambia el estado a `en_revision`** (12196-12197):
un residente puede mover de estado solicitudes que no debería poder tocar.

**I-11. El gate de Usuarios/Reportes Globales usa el rol efectivo, no el global.** `rol==='admin'`
(3047) se satisface con una membresía `proyecto_miembros.rol='admin'` (escrita a mano en BD, no
asignable por UI): ese usuario vería la gestión de usuarios y los reportes de **toda la plataforma**.

**I-12. El render gatea pero el guardado no revalida (patrón general).** Solo 4 funciones de
escritura revalidan rol: `aprobarRegistroLibro` (5231), `observarRegistroLibro` (5247),
`reabrirRegistroLibro` (5265) y `activarLineaBase` (6090). Las demás ~60 (`guardarAnticipo`,
`guardarGarantia`, `aprobarOC`, `generarLiquidacion`, todas las SST, `guardarProyecto`,
`cambiarRolUsuario`…) confían en que el botón no se pintó. La defensa efectiva es RLS de Supabase.

**I-13. Formatos de Calidad: el botón "Revisar/Corregir" (8397) no tiene gate de rol** aunque la
puerta de entrada sí (7986); el modo corrección desactiva la solo-lectura (8469) y
`guardarLlenadoFormato` (8694) no valida.

**I-14. El nav de Cartera no se recalcula al cambiar de proyecto.** `mostrarNavCartera()` se llama
una sola vez al arrancar (2703); quien sea fiscalizador en algún proyecto conserva el ítem visible
siempre (los datos sí se filtran, 4749-4760). Además compara `rol` efectivo donde el resto de la
plataforma usa `rolGlobal` — coincide solo por orden de ejecución frágil.

**I-15. `window._proyectoCerrado` (proyecto liquidado = "solo lectura") se respeta en 6 de ~60
escrituras.** Lo chequean: `guardarRubro`, `guardarOC`, `guardarRegistroLibro`,
`guardarObservacionNueva`, `eliminarTodosRubros`, `guardarPlanilla`. No lo chequean, entre otras:
`eliminarRubro`, `aprobarOC` (que inserta rubros en un proyecto liquidado), `importarRubrosExcel`,
y secciones enteras (Curva S, Contrato, Ensayos, SST, Archivos, Equipos, Materiales, Chat).
El toast "🏁 Proyecto LIQUIDADO — solo lectura" (3571) promete más de lo que el código cumple.

**I-16. No hay UI para cambiar el rol de un miembro existente** (12321-12350: solo texto + eliminar).
El flujo real es eliminar la membresía y volver a crearla.

**I-17. Dos tablas de "página de inicio por rol" divergentes** (3072 vs 3647): una no contempla
`cliente` y la otra no contempla `rol=null`. Hoy ambas caen en valores con acceso, pero es asimétrico.

## 6. Nota sobre la constante `PERMISOS`

`constantes.js` define `PERMISOS`, la versión declarativa de estas dos matrices (celdas:
`'gestionar' | 'ver' | null`). Refleja la **realidad actual**, incluidas las celdas afectadas por
inconsistencias (marcadas con comentarios `// I-n`). La vista "Permisos" de la app (accesible para
admin desde Usuarios) se renderiza desde esa constante. **Ningún chequeo de la app lee todavía esta
constante** — es solo documentación visible (FASE 1).
