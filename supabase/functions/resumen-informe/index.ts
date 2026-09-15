// Edge Function: resumen-informe
//
// Redacta el resumen ejecutivo del informe PDF del Libro de Obra a partir de
// un JSON de HECHOS calculados por la app (solo registros aprobados). El modelo
// NO calcula ni inventa: redacta únicamente lo provisto y declara lo que falta.
//
// POST { proyecto_id, hechos }
//  ->  { texto, modelo }
//
// Mismo patrón que extraer-contrato: clave en secrets, validación manual del
// JWT, rol admin/fiscalizador (global o en el proyecto). Modelo pequeño y barato.
// Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const MODELO = 'claude-haiku-4-5';
const MAX_HECHOS_BYTES = 60 * 1024;

const PROMPT_SISTEMA = `Eres el redactor técnico de una fiscalización de obra civil en Ecuador. Redactas el RESUMEN EJECUTIVO del informe periódico del Libro de Obra a partir de un JSON de hechos ya calculados por el sistema.

REGLAS ESTRICTAS
1. Usa ÚNICAMENTE los datos del JSON. No inventes, no supongas, no extrapoles y NO hagas cálculos propios (ni sumas, ni porcentajes, ni promedios, ni fechas): todo número que escribas debe aparecer tal cual en el JSON.
2. Si una sección no tiene datos en el JSON, escríbelo explícitamente ("Sin incidencias registradas en el período", "Sin datos de cronograma para calcular el avance programado").
3. Español técnico, tercera persona, sin adjetivos valorativos ni recomendaciones no sustentadas. Nada de saludos ni cierres.
4. Extensión: unas 200 palabras en total, más las viñetas que hagan falta.
5. Formato de salida (texto plano, sin markdown salvo el guion de las viñetas), con EXACTAMENTE estos siete encabezados en este orden y en mayúsculas:

CONTEXTO
(una o dos frases: proyecto, contratista, período, días con registro aprobado)

AVANCE
(avance físico del período y acumulado real vs programado según la línea base activa; SPI y su lectura; si falta el dato, decirlo)

ACTIVIDADES
(viñetas "- " con los rubros trabajados: código, descripción breve, cantidad y unidad)

INCIDENCIAS
(paralizaciones y novedades registradas; si no hay, decirlo)

OBSERVACIONES
(observaciones de fiscalización abiertas o en proceso; si no hay, decirlo)

ALERTAS
(rubros con ejecución por encima del contrato, órdenes de cambio pendientes; si no hay, decirlo)

PENDIENTES
(registros del período pendientes u observados; si no hay, decirlo)`;

const fmtErr = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (req.method !== 'POST') return fmtErr({ error: 'Método no permitido' }, 405);

    const { proyecto_id, hechos } = await req.json();
    if (!proyecto_id) return fmtErr({ error: 'Falta proyecto_id' }, 400);
    if (!hechos || typeof hechos !== 'object') return fmtErr({ error: 'Faltan los hechos del informe' }, 400);
    const hechosJSON = JSON.stringify(hechos);
    if (hechosJSON.length > MAX_HECHOS_BYTES) return fmtErr({ error: 'Los hechos del informe superan el tamaño máximo' }, 413);

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) return fmtErr({ error: 'ANTHROPIC_API_KEY no configurada' }, 500);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ── Autenticación y autorización (admin global o admin/fiscalizador del proyecto) ──
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return fmtErr({ error: 'No autorizado: falta sesión' }, 401);

    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userData?.user) return fmtErr({ error: 'No autorizado: sesión inválida' }, 401);
    const userId = userData.user.id;

    const { data: perfil } = await sb.from('perfiles').select('rol').eq('id', userId).maybeSingle();
    let autorizado = perfil?.rol === 'admin';
    if (!autorizado) {
      const { data: miembro } = await sb.from('proyecto_miembros')
        .select('rol').eq('usuario_id', userId).eq('proyecto_id', proyecto_id).maybeSingle();
      autorizado = ['admin', 'fiscalizador'].includes(miembro?.rol);
    }
    if (!autorizado) return fmtErr({ error: 'No autorizado: se requiere rol admin o fiscalizador en el proyecto' }, 403);

    // ── Llamada a Anthropic ──
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 1500,
        temperature: 0.2,
        system: PROMPT_SISTEMA,
        messages: [{
          role: 'user',
          content: `Hechos del informe (JSON):\n${hechosJSON}\n\nRedacta el resumen ejecutivo siguiendo las reglas.`
        }]
      })
    });

    if (!resp.ok) {
      const detalle = await resp.text();
      console.error('Error Anthropic', resp.status, detalle);
      return fmtErr({ error: `Error del servicio de IA (${resp.status})` }, 502);
    }

    const data = await resp.json();
    if (data.stop_reason === 'refusal') return fmtErr({ error: 'El modelo declinó redactar este resumen.' }, 422);

    const texto = (data.content || [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('\n')
      .trim();
    if (!texto) return fmtErr({ error: 'El modelo no devolvió contenido.' }, 502);
    if (data.stop_reason === 'max_tokens') console.warn('resumen-informe: salida truncada por max_tokens');

    return fmtErr({ texto, modelo: data.model || MODELO, truncado: data.stop_reason === 'max_tokens' });

  } catch (err) {
    console.error('resumen-informe:', err);
    return fmtErr({ error: (err as Error).message || 'Error interno' }, 500);
  }
});
