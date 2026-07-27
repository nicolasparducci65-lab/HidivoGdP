// Edge Function: procesar-observacion-voz
//
// Convierte el dictado informal de una observación de campo en un título y
// descripción formales de fiscalización, detectando reincidencias contra el
// historial reciente del proyecto (observaciones + libro de obra). El
// resultado precarga el formulario de observación existente en el frontend;
// NUNCA se guarda sin revisión del usuario.
//
// POST { proyecto_id, texto_dictado }  (con JWT del usuario)
//  ->  { titulo, descripcion, reincidencia }
//
// Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const PROMPT_VOZ = `Eres el asistente de campo de un fiscalizador de obras civiles en Ecuador. Recibes el dictado informal de una observación hecha en obra y el historial reciente del proyecto. Devuelve SOLO un JSON válido, sin markdown: {"titulo": string (máx 10 palabras, formal), "descripcion": string (redacción formal de fiscalización en tercera persona, 2-5 oraciones, fiel a los hechos dictados sin agregar hechos no mencionados; incluye ubicación si se dictó), "reincidencia": string|null (si el hecho dictado tiene antecedentes en el historial entregado, UNA oración citándolos con su número de observación o registro, ej.: 'Antecedente: hecho similar registrado en Observación N.º 3 y Registro de Libro de Obra N.º 22.'; si no hay antecedentes claros, null — no fuerces coincidencias)}. Registro formal ecuatoriano de obra civil.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

    const { proyecto_id, texto_dictado } = await req.json();
    if (!proyecto_id) return json({ error: 'Falta proyecto_id' }, 400);
    if (!texto_dictado || !String(texto_dictado).trim()) return json({ error: 'Falta texto_dictado' }, 400);

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) return json({ error: 'ANTHROPIC_API_KEY no configurada' }, 500);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ── Auth: mismo patrón que redactar-comunicado, ampliado a residente
    // (los residentes también crean observaciones en la app).
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'No autorizado: falta sesión' }, 401);
    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: 'No autorizado: sesión inválida' }, 401);
    const userId = userData.user.id;

    const { data: perfil } = await sb.from('perfiles').select('rol').eq('id', userId).maybeSingle();
    let autorizado = perfil?.rol === 'admin';
    if (!autorizado) {
      const { data: miembro } = await sb.from('proyecto_miembros')
        .select('rol').eq('usuario_id', userId).eq('proyecto_id', proyecto_id).maybeSingle();
      autorizado = ['admin', 'fiscalizador', 'residente'].includes(miembro?.rol);
    }
    if (!autorizado) return json({ error: 'No autorizado para este proyecto' }, 403);

    // ── Contexto del proyecto ──
    const [{ data: proyecto }, { data: obs }, { data: libro }] = await Promise.all([
      sb.from('proyectos').select('nombre,contratista').eq('id', proyecto_id).single(),
      sb.from('observaciones')
        .select('numero,titulo,estado,created_at')
        .eq('proyecto_id', proyecto_id)
        .order('numero', { ascending: false }).limit(15),
      sb.from('libro_obra')
        .select('numero_registro,fecha,actividades_ejecutadas,novedades,resoluciones')
        .eq('proyecto_id', proyecto_id)
        .order('fecha', { ascending: false }).limit(15)
    ]);

    if (!proyecto) return json({ error: 'Proyecto no encontrado' }, 404);

    const L: string[] = [];
    L.push(`Proyecto: ${proyecto.nombre || 'sin nombre'} — Contratista: ${proyecto.contratista || 'no registrado'}`);
    L.push('');
    L.push('OBSERVACIONES RECIENTES:');
    if (obs?.length) {
      obs.forEach(o => L.push(
        `- Observación N.º ${o.numero} (${o.estado}, ${(o.created_at || '').slice(0, 10)}): ${o.titulo}`
      ));
    } else L.push('(ninguna)');
    L.push('');
    L.push('LIBRO DE OBRA RECIENTE:');
    if (libro?.length) {
      libro.forEach(r => {
        const partes = [
          r.actividades_ejecutadas ? `actividades: ${r.actividades_ejecutadas}` : null,
          r.novedades ? `novedades: ${r.novedades}` : null,
          r.resoluciones ? `resoluciones: ${r.resoluciones}` : null
        ].filter(Boolean).join(' | ');
        L.push(`- Registro N.º ${r.numero_registro ?? 's/n'} del ${r.fecha}: ${partes || '(sin detalle)'}`);
      });
    } else L.push('(ninguno)');

    const contenido =
      PROMPT_VOZ +
      '\n\n=====================\nHISTORIAL DEL PROYECTO\n=====================\n' + L.join('\n') +
      '\n\n=====================\nDICTADO DEL FISCALIZADOR\n=====================\n' + String(texto_dictado).trim();

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content: contenido }]
      })
    });

    if (!resp.ok) {
      const detalle = await resp.text();
      console.error('procesar-observacion-voz: error Anthropic', resp.status, detalle);
      return json({ error: `Error del servicio de IA (${resp.status})` }, 502);
    }

    const data = await resp.json();
    if (data.stop_reason === 'refusal') return json({ error: 'El modelo declinó procesar este dictado.' }, 422);

    const texto = (data.content || [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text).join('\n').trim();
    if (!texto) return json({ error: 'El modelo no devolvió contenido' }, 500);

    let resultado;
    try {
      resultado = JSON.parse(limpiarJSON(texto));
    } catch (_e) {
      console.error('procesar-observacion-voz: JSON inválido', texto.slice(0, 400));
      return json({ error: 'La respuesta del modelo no fue un JSON válido' }, 500);
    }

    return json({
      titulo: String(resultado.titulo || '').trim(),
      descripcion: String(resultado.descripcion || '').trim(),
      reincidencia: resultado.reincidencia ? String(resultado.reincidencia).trim() : null
    });

  } catch (err) {
    console.error('procesar-observacion-voz:', err);
    return json({ error: (err as Error).message || 'Error interno' }, 500);
  }
});

// Quita fences de markdown y recorta a las llaves externas del objeto JSON
function limpiarJSON(t: string): string {
  let s = t.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const ini = s.indexOf('{');
  const fin = s.lastIndexOf('}');
  if (ini >= 0 && fin > ini) s = s.substring(ini, fin + 1);
  return s;
}
