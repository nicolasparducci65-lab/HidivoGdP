// «¿Olvidaste tu contraseña?» y «Cambiar mi contraseña»: ejecuta en jsdom las funciones REALES
// de index.html (bloque RECUPERAR / CAMBIAR CONTRASEÑA, checkAuth, login, logout, mostrarApp)
// sobre el HTML REAL de las pantallas de ingreso, con Supabase Auth simulado.
//
//   node olvide-clave.test.js
'use strict';
const { JSDOM } = require('jsdom');
const { RUTA_INDEX, leer, scriptPrincipal, extraerFuncion, extraerBloque, extraerConst, crearSb, prueba, resumen, assert } = require('./lib/arnes');

const html = leer(RUTA_INDEX);
const src = scriptPrincipal(html);
const PANTALLAS = html.slice(html.indexOf('<!-- AUTH SCREEN -->'), html.indexOf('<!-- APP PRINCIPAL -->'));
const BLOQUE = extraerBloque(src, '// ── RECUPERAR / CAMBIAR CONTRASEÑA ──', '// ── FIN RECUPERAR / CAMBIAR CONTRASEÑA ──');
// Lo que index.html define fuera del bloque y aquí no hace falta de verdad.
const PRELUDIO = `
let currentUser = null, currentPerfil = null, currentPage = 'dashboard', currentProyecto = null;
let _histIdx = 0, _histMax = 0;
const CACHE_RUBROS_LIBRO = 'cache_rubros_libro_';
function actualizarBotonesHistorial(){}
async function cargarPerfil(){ currentPerfil = window._perfil; }
function toast(msg, tipo){ window._toasts.push({ msg, tipo }); }
// mostrarApp es la REAL; solo se simula lo que arranca al entrar. iniciarHistorialApp se
// llama únicamente cuando la app se muestra de verdad: cuenta los aterrizajes.
function iniciarHistorialApp(){ window._aterrizajes += 1; }
function iniciarPresencia(){} function cargarDashboard(){} function cargarProyectosSelector(){} function actualizarEstadoBotonPush(){}
async function actualizarRolEfectivo(){} function actualizarBadgeChat(){} function suscribirseGlobalChat(){}
function cargarNotificacionesGlobales(){} function sincronizarRegistrosOffline(){} function mostrarNavCartera(){}
`;
const CODIGO = [PRELUDIO, BLOQUE, extraerConst(src, '_retornoRecuperacion'), extraerConst(src, '_tokenRetornoRecuperacion'),
  ...['checkAuth', 'login', 'logout', 'showAuthError', 'mostrarCompletarPerfil', 'togglePasswordVisibility', 'mostrarApp'].map(f => extraerFuncion(src, f))].join('\n');

const BASE = 'https://hidivo.test/HidivoGdP/';
const abiertas = []; // ventanas montadas: se cierran todas al final (sus temporizadores retendrían el proceso)
const pausa = () => new Promise(r => setTimeout(r, 20)); // checkAuth no espera a mostrarApp
const CORREO = 'visualizador@hidivo.test';
const TOKEN = 'token-del-enlace';
const RETORNO_OK = BASE + '#access_token=' + TOKEN + '&expires_in=3600&refresh_token=r1&token_type=bearer&type=recovery';
const RETORNO_VENCIDO = BASE + '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
const MSG_ENVIADO = 'Si el correo está registrado, recibirás un enlace para crear una contraseña nueva.';
const sesionCon = token => ({ access_token: token, user: { id: 'u1', email: CORREO } });
const PERFIL = { id: 'u1', nombre: 'Prueba', apellido: 'Uno', rol: null };
const MIEMBRO = [{ usuario_id: 'u1', proyecto_id: 'p1', rol: 'visualizador' }];

// Supabase Auth simulado: registra las llamadas y responde con los errores que se le pidan.
function crearAuth(estado){
  const llamadas = [], oyentes = [];
  return {
    llamadas,
    emitir(evento){ oyentes.slice().forEach(fn => fn(evento, estado.sesion)); },
    onAuthStateChange(fn){
      oyentes.push(fn);
      Promise.resolve().then(() => { if(oyentes.includes(fn)) fn('INITIAL_SESSION', estado.sesion); });
      return { data: { subscription: { unsubscribe(){ const i = oyentes.indexOf(fn); if(i >= 0) oyentes.splice(i, 1); } } } };
    },
    getSession: async () => ({ data: { session: estado.sesion } }),
    resetPasswordForEmail: async (correo, opciones) => { llamadas.push(['resetPasswordForEmail', correo, opciones]); return { data: {}, error: estado.errores.reset || null }; },
    updateUser: async atributos => { llamadas.push(['updateUser', atributos]); return { data: {}, error: estado.errores.update || null }; },
    signInWithPassword: async cred => {
      llamadas.push(['signInWithPassword', cred]);
      const error = estado.errores.ingreso || (estado.clave && cred.password !== estado.clave ? { status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' } : null);
      return error ? { data: { user: null, session: null }, error } : { data: { user: estado.sesion.user, session: estado.sesion }, error: null };
    },
    signOut: async () => { llamadas.push(['signOut']); estado.sesion = null; return { error: null }; },
  };
}

// Monta la ventana como al cargar la app: lee el retorno de la URL, crea el cliente y lo vigila.
function montar({ url = BASE, sesion = null, perfil = PERFIL, miembros = MIEMBRO, errores = {}, clave = null, marca = false, enLinea = true } = {}){
  const dom = new JSDOM(`<!doctype html><html><body>${PANTALLAS}
    <div id="appScreen" style="display:none"><div id="menuUsuario" style="display:none"></div></div><div id="toast"></div></body></html>`, { url, runScripts: 'outside-only' });
  const w = dom.window;
  const estado = { sesion, errores, clave };
  const auth = crearAuth(estado);
  w.sb = crearSb({ proyecto_miembros: miembros }, { auth });
  w._perfil = perfil; w._toasts = []; w._aterrizajes = 0; w.console = console;
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => t.enLinea });
  if(marca) w.sessionStorage.setItem('hidivo_recuperacion', '1');
  const el = id => w.document.getElementById(id);
  const t = { w, auth, estado, el, enLinea,
    visible: id => el(id).style.display !== 'none',
    texto: id => el(id).textContent,
    de: nombre => auth.llamadas.filter(l => l[0] === nombre),
    cerrar: () => w.close() };
  abiertas.push(w);
  w.eval(CODIGO);
  w.vigilarRecuperacion(w.sb);
  return t;
}
const soloNuevaClave = t => t.visible('nuevaClaveScreen') && t.visible('nuevaClaveForm') && !t.visible('nuevaClaveVencido')
  && !t.visible('appScreen') && !t.visible('authScreen') && !t.visible('completarPerfilScreen') && !t.visible('esperaAsignacionScreen');
const escribir = (t, valores) => Object.entries(valores).forEach(([id, v]) => { t.el(id).value = v; });

(async () => {
  console.log('olvide-clave.test.js');

  await prueba('pedir enlace: resetPasswordForEmail con redirectTo = origin + pathname; mismo mensaje con éxito y con «usuario no encontrado»', async () => {
    const t = montar({ url: BASE + 'index.html?origen=correo#algo' });
    escribir(t, { loginEmail: '  ' + CORREO + ' ' });
    t.w.mostrarOlvideClave();
    assert(t.visible('olvideClaveForm') && !t.visible('loginForm') && t.el('olvideClaveEmail').value === CORREO, 'abre el formulario con el correo precargado');
    await t.w.enviarEnlaceClave();
    const [llamada] = t.de('resetPasswordForEmail');
    assert(llamada && llamada[1] === CORREO && llamada[2].redirectTo === BASE + 'index.html', 'redirectTo: ' + JSON.stringify(llamada));
    assert(t.visible('authSuccess') && t.texto('authSuccess') === MSG_ENVIADO && !t.visible('authError'), 'mensaje de éxito: ' + t.texto('authSuccess'));
    assert(t.el('btnOlvideClave').disabled && /en \d+ s$/.test(t.texto('btnOlvideClave')), 'botón bloqueado con cuenta atrás: ' + t.texto('btnOlvideClave'));
    await t.w.enviarEnlaceClave();
    assert(t.de('resetPasswordForEmail').length === 1, 'dentro de los 60 s no se envía otra vez');
    t.cerrar();

    const t2 = montar({ errores: { reset: { status: 400, code: 'user_not_found', message: 'User not found' } } });
    t2.w.mostrarOlvideClave(); escribir(t2, { olvideClaveEmail: 'nadie@hidivo.test' });
    await t2.w.enviarEnlaceClave();
    assert(t2.de('resetPasswordForEmail')[0][2].redirectTo === BASE, 'redirectTo en la raíz: ' + t2.de('resetPasswordForEmail')[0][2].redirectTo);
    assert(t2.visible('authSuccess') && t2.texto('authSuccess') === MSG_ENVIADO && !t2.visible('authError'), 'correo sin cuenta: exactamente el mismo mensaje');
    t2.cerrar();
  });

  await prueba('pedir enlace: límite de envíos → «Demasiados intentos…»; sin conexión → «Necesitas conexión…» y no se llama a Supabase', async () => {
    const t = montar({ errores: { reset: { status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' } } });
    t.w.mostrarOlvideClave(); escribir(t, { olvideClaveEmail: CORREO });
    await t.w.enviarEnlaceClave();
    assert(t.visible('authError') && t.texto('authError') === 'Demasiados intentos, prueba en unos minutos' && !t.visible('authSuccess'), 'límite: ' + t.texto('authError'));
    assert(!/rate limit/i.test(t.el('authScreen').textContent), 'no se muestra el error crudo');
    t.cerrar();

    const t2 = montar({ enLinea: false });
    t2.w.mostrarOlvideClave();
    assert(!t2.visible('olvideClaveForm') && t2.texto('authError') === 'Necesitas conexión para restablecer tu contraseña', 'sin conexión el enlace solo avisa: ' + t2.texto('authError'));
    t2.enLinea = true; t2.w.mostrarOlvideClave(); escribir(t2, { olvideClaveEmail: CORREO }); t2.enLinea = false;
    await t2.w.enviarEnlaceClave();
    assert(t2.de('resetPasswordForEmail').length === 0 && t2.texto('authError') === 'Necesitas conexión para restablecer tu contraseña', 'se cayó la red con el formulario abierto');
    t2.cerrar();
  });

  await prueba('login: el error de Supabase se muestra en español', async () => {
    const t = montar({ errores: { ingreso: { status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' } } });
    escribir(t, { loginEmail: CORREO, loginPassword: 'equivocada' });
    await t.w.login();
    assert(t.texto('authError') === 'Correo o contraseña incorrectos' && t.w._aterrizajes === 0, t.texto('authError'));
    t.cerrar();
  });

  await prueba('retorno de recuperación: se muestra SOLO la pantalla de contraseña nueva, no el landing por rol (también tras recargar)', async () => {
    const t = montar({ url: RETORNO_OK, sesion: sesionCon(TOKEN) });
    t.auth.emitir('PASSWORD_RECOVERY');
    await t.w.checkAuth();
    assert(soloNuevaClave(t), 'solo la pantalla de contraseña nueva');
    assert(!t.visible('nuevaClaveActualGrupo') && t.texto('nuevaClaveTitulo') === 'Crear contraseña nueva', 'en recuperación no se pide la contraseña actual');
    assert(t.w._aterrizajes === 0 && t.de('updateUser').length === 0, 'no se entró a la app');
    await t.w.mostrarApp();
    assert(t.w._aterrizajes === 0 && soloNuevaClave(t), 'mostrarApp no entra con la recuperación pendiente');
    t.cerrar();

    // Sin el evento (llegó antes de registrar el oyente): basta con que la sesión sea la del enlace
    const t2 = montar({ url: RETORNO_OK, sesion: sesionCon(TOKEN) });
    await t2.w.checkAuth();
    assert(soloNuevaClave(t2) && t2.w._aterrizajes === 0, 'sin evento, por el token de la URL');
    t2.cerrar();

    // Recarga: el hash ya no está, queda la marca de la pestaña
    const t3 = montar({ url: BASE, sesion: sesionCon(TOKEN), marca: true });
    await t3.w.checkAuth();
    assert(soloNuevaClave(t3) && t3.w._aterrizajes === 0, 'tras recargar sigue en la pantalla de contraseña nueva');
    t3.cerrar();
  });

  await prueba('la pantalla no se abre por URL: sesión normal + hash escrito a mano → aviso de enlace no válido y, al volver, landing normal', async () => {
    const t = montar({ url: BASE + '#access_token=inventado&type=recovery', sesion: sesionCon('token-de-la-sesion-normal') });
    await t.w.checkAuth();
    assert(!t.visible('nuevaClaveForm') && t.visible('nuevaClaveVencido') && t.w._aterrizajes === 0, 'no ofrece cambiar la contraseña');
    assert(t.w.sessionStorage.getItem('hidivo_recuperacion') === null, 'no deja marca de recuperación');
    t.w.salirEnlaceVencido(); await pausa();
    assert(t.visible('appScreen') && !t.visible('nuevaClaveScreen') && t.w._aterrizajes === 1, 'vuelve a la app por el landing');
    t.cerrar();

    const t2 = montar({ url: BASE + '#type=recovery', sesion: sesionCon('token-de-la-sesion-normal') });
    await t2.w.checkAuth(); await pausa();
    assert(t2.visible('appScreen') && !t2.visible('nuevaClaveScreen') && t2.w._aterrizajes === 1, 'sesión normal: landing de siempre');
    t2.cerrar();
  });

  await prueba('contraseñas que no coinciden o demasiado cortas: no se llama a updateUser', async () => {
    const t = montar({ url: RETORNO_OK, sesion: sesionCon(TOKEN) });
    await t.w.checkAuth();
    escribir(t, { nuevaClave: '12345', nuevaClaveConfirm: '12345' });
    await t.w.guardarNuevaClave();
    assert(t.texto('nuevaClaveError') === 'La contraseña debe tener al menos 6 caracteres' && t.visible('nuevaClaveError'), 'corta: ' + t.texto('nuevaClaveError'));
    escribir(t, { nuevaClave: 'Clave-nueva-1', nuevaClaveConfirm: 'Clave-nueva-2' });
    await t.w.guardarNuevaClave();
    assert(t.texto('nuevaClaveError') === 'Las contraseñas no coinciden', 'distintas: ' + t.texto('nuevaClaveError'));
    assert(t.de('updateUser').length === 0 && soloNuevaClave(t) && t.w._aterrizajes === 0, 'updateUser no se llamó y sigue en la pantalla');
    t.cerrar();
  });

  await prueba('éxito: se llama a updateUser, se limpia la URL y se entra por el landing del rol', async () => {
    const t = montar({ url: RETORNO_OK, sesion: sesionCon(TOKEN) });
    await t.w.checkAuth();
    escribir(t, { nuevaClave: 'Clave-nueva-1', nuevaClaveConfirm: 'Clave-nueva-1' });
    await t.w.guardarNuevaClave(); await pausa();
    const llamadas = t.de('updateUser');
    assert(llamadas.length === 1 && llamadas[0][1].password === 'Clave-nueva-1' && t.de('signInWithPassword').length === 0, 'updateUser una vez, sin pedir la clave actual');
    assert(t.w.location.href === BASE && t.w.location.hash === '' && t.w.location.search === '', 'URL limpia: ' + t.w.location.href);
    assert(t.w.sessionStorage.getItem('hidivo_recuperacion') === null, 'marca de recuperación borrada');
    assert(t.visible('appScreen') && !t.visible('nuevaClaveScreen') && t.w._aterrizajes === 1, 'entra a la app por el landing');
    assert(t.w._toasts.some(x => x.msg === 'Contraseña actualizada ✓' && x.tipo === 'success'), 'confirmación');
    t.cerrar();

    // Usuario sin membresías: su landing es la pantalla de espera, igual que en un ingreso normal
    const t2 = montar({ url: RETORNO_OK, sesion: sesionCon(TOKEN), miembros: [] });
    await t2.w.checkAuth();
    escribir(t2, { nuevaClave: 'Clave-nueva-1', nuevaClaveConfirm: 'Clave-nueva-1' });
    await t2.w.guardarNuevaClave(); await pausa();
    assert(t2.visible('esperaAsignacionScreen') && !t2.visible('appScreen') && !t2.visible('nuevaClaveScreen'), 'sin proyectos: pantalla de espera');
    t2.cerrar();
  });

  await prueba('enlace vencido o ya usado: mensaje claro y botón para pedir otro; una invitación vencida (?token=) sigue como antes', async () => {
    const t = montar({ url: RETORNO_VENCIDO });
    await t.w.checkAuth();
    assert(t.visible('nuevaClaveScreen') && t.visible('nuevaClaveVencido') && !t.visible('nuevaClaveForm') && !t.visible('appScreen') && !t.visible('authScreen'), 'solo el aviso');
    assert(t.texto('nuevaClaveVencidoMsg') === 'El enlace venció o ya fue usado' && t.texto('btnPedirOtroEnlace') === 'Pedir otro enlace', t.texto('nuevaClaveVencidoMsg'));
    assert(t.w.location.href === BASE, 'URL limpia: ' + t.w.location.href);
    t.w.pedirOtroEnlace();
    assert(t.visible('authScreen') && t.visible('olvideClaveForm') && !t.visible('nuevaClaveScreen'), 'el botón abre el formulario de envío');
    t.cerrar();

    // El enlace traía token pero no se pudo abrir sesión (token inválido)
    const t2 = montar({ url: RETORNO_OK, sesion: null });
    await t2.w.checkAuth();
    assert(t2.visible('nuevaClaveVencido') && !t2.visible('nuevaClaveForm') && !t2.visible('appScreen'), 'sin sesión: aviso, no pantalla en blanco');
    t2.cerrar();

    // La sesión de recuperación caducó antes de guardar
    const t3 = montar({ url: RETORNO_OK, sesion: sesionCon(TOKEN), errores: { update: { name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' } } });
    await t3.w.checkAuth();
    escribir(t3, { nuevaClave: 'Clave-nueva-1', nuevaClaveConfirm: 'Clave-nueva-1' });
    await t3.w.guardarNuevaClave();
    assert(t3.visible('nuevaClaveVencido') && !t3.visible('nuevaClaveForm') && t3.w._aterrizajes === 0, 'updateUser sin sesión: aviso de enlace vencido');
    t3.cerrar();

    const t4 = montar({ url: BASE + '?token=inv-1#error=access_denied&error_code=otp_expired' });
    await t4.w.checkAuth();
    assert(t4.visible('authScreen') && !t4.visible('nuevaClaveScreen'), 'invitación vencida: pantalla de ingreso, como antes');
    t4.cerrar();
  });

  await prueba('atrás/adelante: con la pantalla activa el popstate no navega; cancelar una recuperación cierra la sesión', async () => {
    const popstate = src.slice(src.indexOf("window.addEventListener('popstate'"), src.indexOf('function accionPrincipal('));
    assert(/^window\.addEventListener\('popstate', async \(e\)=>\{\s*(\/\/[^\n]*\s*)*if\(_modoNuevaClave\)\{ history\.pushState\(\{ nuevaClave: true \}, ''\); return; \}/.test(popstate), 'el guardia es lo primero del popstate');
    const t = montar({ url: RETORNO_OK, sesion: sesionCon(TOKEN) });
    const antes = t.w.history.length;
    await t.w.checkAuth();
    assert(t.w.history.length === antes + 1 && t.w.history.state && t.w.history.state.nuevaClave === true, 'entrada centinela en el historial');
    t.w.cancelarNuevaClave(); await pausa();
    assert(t.de('signOut').length === 1 && t.visible('authScreen') && !t.visible('nuevaClaveScreen') && !t.visible('appScreen'), 'cancelar: sin sesión y al ingreso');
    assert(t.w.sessionStorage.getItem('hidivo_recuperacion') === null, 'marca borrada al cancelar');
    t.cerrar();
  });

  await prueba('cambiar mi contraseña (menú, sesión normal): pide la clave actual y la verifica antes de updateUser', async () => {
    const t = montar({ sesion: sesionCon('token-de-la-sesion-normal'), clave: 'Clave-de-hoy-1' });
    await t.w.checkAuth(); await pausa();
    assert(t.visible('appScreen') && t.w._aterrizajes === 1, 'sesión normal: entra a la app');
    t.w.toggleMenuUsuario(); assert(t.visible('menuUsuario'), 'la pastilla abre el menú');
    t.w.abrirCambiarClave();
    assert(soloNuevaClave(t) && t.visible('nuevaClaveActualGrupo') && t.texto('nuevaClaveTitulo') === 'Cambiar mi contraseña' && !t.visible('menuUsuario'), 'misma pantalla, con contraseña actual');

    escribir(t, { nuevaClave: 'Clave-nueva-1', nuevaClaveConfirm: 'Clave-nueva-1' });
    await t.w.guardarNuevaClave();
    assert(t.texto('nuevaClaveError') === 'Escribe tu contraseña actual' && t.de('signInWithPassword').length === 0, 'sin clave actual no se intenta nada');
    escribir(t, { nuevaClaveActual: 'no-es-esta' });
    await t.w.guardarNuevaClave();
    assert(t.texto('nuevaClaveError') === 'La contraseña actual no es correcta' && t.de('updateUser').length === 0 && soloNuevaClave(t), 'clave actual incorrecta: no se llama a updateUser');
    escribir(t, { nuevaClaveActual: 'Clave-de-hoy-1' });
    await t.w.guardarNuevaClave();
    const orden = t.auth.llamadas.map(l => l[0]).slice(-2).join('>');
    assert(orden === 'signInWithPassword>updateUser' && t.de('updateUser')[0][1].password === 'Clave-nueva-1', 'verifica y luego guarda: ' + orden);
    assert(t.de('signInWithPassword').at(-1)[1].email === CORREO, 'verifica con el correo de la sesión');
    assert(t.visible('appScreen') && !t.visible('nuevaClaveScreen') && t.w._aterrizajes === 1, 'vuelve a la app sin pasar otra vez por el landing');
    assert(t.w.history.state && t.w.history.state.seccion === 'dashboard', 'la entrada centinela vuelve a ser una entrada de la app');

    t.w.abrirCambiarClave(); t.w.cancelarNuevaClave();
    assert(t.visible('appScreen') && !t.visible('nuevaClaveScreen') && t.de('signOut').length === 0, 'cancelar desde el menú vuelve a la app sin cerrar sesión');
    t.enLinea = false; t.w.abrirCambiarClave();
    assert(!t.visible('nuevaClaveScreen') && t.w._toasts.at(-1).msg === 'Necesitas conexión para cambiar tu contraseña', 'sin conexión no se abre');
    t.cerrar();
  });

  await prueba('lo que no cambia: signUp y signInWithOtp (creación manual e invitaciones) siguen igual en el código', () => {
    assert((src.match(/sb\.auth\.signUp\(/g) || []).length === 1 && (src.match(/sb\.auth\.signInWithOtp\(/g) || []).length === 2, 'mismas llamadas de alta e invitación');
    assert(/emailRedirectTo: window\.location\.origin\+window\.location\.pathname\+'\?token='\+token/.test(src), 'la invitación vuelve con ?token=');
    assert(!/flowType/.test(src), 'el cliente sigue en flujo implícito (sin flowType)');
  });

  abiertas.forEach(w => { try{ w.close(); }catch(e){} });
  resumen();
})();
