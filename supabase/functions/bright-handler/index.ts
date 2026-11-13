// Edge Function: bright-handler
//
// Borra cuentas de Supabase Auth. SOLO la puede usar un administrador global
// (perfiles.rol === 'admin') con su sesión iniciada: la función valida el token
// de quien llama antes de tocar nada. La clave pública de la app no basta.
//
// POST { accion: 'eliminarUsuario', userId }
//   Borra la cuenta indicada. Un admin no puede borrarse a sí mismo.
// POST { accion: 'buscarYEliminarUsuarioPorEmail', email }
//   Limpia el usuario «fantasma» que deja una invitación cancelada: solo borra
//   la cuenta si NO tiene perfil. Una cuenta con perfil se elimina con la otra acción.
//
//  ->  { ok: true, ... }  |  { error: string }
//
// Requiere: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (los pone Supabase). Se acepta
// también el secreto antiguo SERVICE_ROLE_KEY.
// Desplegar con --no-verify-jwt: la sesión se valida aquí dentro, con auth.getUser.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Único origen desde el que se sirve la app
const ORIGEN_APP = 'https://nicolasparducci65-lab.github.io';

const corsHeaders = {
  'Access-Control-Allow-Origin': ORIGEN_APP,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
};

const POR_PAGINA = 200;
const MAX_PAGINAS = 50; // tope de seguridad del barrido por correo (10 000 cuentas)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

export async function manejar(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

    const url = Deno.env.get('SUPABASE_URL');
    const claveServicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY');
    if (!url || !claveServicio) return json({ error: 'Función mal configurada' }, 500);
    const sb = createClient(url, claveServicio);

    // ── Autenticación: sesión válida de un usuario (no vale la clave pública) ──
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'No autorizado: falta sesión' }, 401);
    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: 'No autorizado: sesión inválida' }, 401);
    const llamante = userData.user.id;

    // ── Autorización: solo administradores globales ──
    const { data: perfil, error: perfilErr } = await sb.from('perfiles').select('rol').eq('id', llamante).maybeSingle();
    if (perfilErr) return json({ error: 'No se pudo comprobar el permiso' }, 500);
    if (perfil?.rol !== 'admin') return json({ error: 'No autorizado: solo un administrador puede eliminar usuarios' }, 403);

    let cuerpo: Record<string, unknown> = {};
    try { cuerpo = (await req.json()) || {}; } catch { return json({ error: 'Cuerpo no válido' }, 400); }
    const accion = cuerpo.accion;

    if (accion === 'eliminarUsuario') {
      const userId = typeof cuerpo.userId === 'string' ? cuerpo.userId.trim() : '';
      if (!userId) return json({ error: 'Falta userId' }, 400);
      if (userId === llamante) return json({ error: 'No puedes eliminar tu propia cuenta' }, 400);
      const { error } = await sb.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (accion === 'buscarYEliminarUsuarioPorEmail') {
      const email = typeof cuerpo.email === 'string' ? cuerpo.email.trim().toLowerCase() : '';
      if (!email) return json({ error: 'Falta email' }, 400);

      // listUsers no filtra por correo: se pagina y se busca
      let encontrado: { id: string } | null = null;
      for (let page = 1; page <= MAX_PAGINAS && !encontrado; page++) {
        const { data, error } = await sb.auth.admin.listUsers({ page, perPage: POR_PAGINA });
        if (error) return json({ error: error.message }, 400);
        const usuarios = data?.users || [];
        encontrado = usuarios.find((u: { id: string; email?: string }) => (u.email || '').toLowerCase() === email) || null;
        if (usuarios.length < POR_PAGINA) break;
      }
      if (!encontrado) return json({ ok: true, mensaje: 'No se encontró usuario con ese email, nada que eliminar' });
      if (encontrado.id === llamante) return json({ error: 'No puedes eliminar tu propia cuenta' }, 400);

      // Solo usuarios fantasma: si la cuenta ya tiene perfil, no se toca
      const { data: perfilObjetivo, error: errObjetivo } = await sb.from('perfiles').select('id').eq('id', encontrado.id).maybeSingle();
      if (errObjetivo) return json({ error: 'No se pudo comprobar el perfil de la cuenta' }, 500);
      if (perfilObjetivo) return json({ error: 'Esa cuenta tiene perfil: elimínala desde Usuarios' }, 409);

      const { error: errDel } = await sb.auth.admin.deleteUser(encontrado.id);
      if (errDel) return json({ error: errDel.message }, 400);
      return json({ ok: true, eliminado: encontrado.id });
    }

    return json({ error: 'Acción no reconocida' }, 400);
  } catch (err) {
    return json({ error: (err as Error)?.message || 'Error interno' }, 500);
  }
}

Deno.serve(manejar);
