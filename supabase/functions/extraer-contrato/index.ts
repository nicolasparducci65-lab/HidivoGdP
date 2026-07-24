// Edge Function: extraer-contrato
//
// Extrae datos estructurados de un contrato de obra civil en PDF usando Claude.
// Descarga el PDF desde Storage (con service role), lo envía como documento
// base64 a la API de Anthropic y devuelve un objeto JSON con los datos.
//
// POST { proyecto_id, archivo_id }
//  ->  { datos: <objeto estructurado> }
//
// Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const BUCKET = 'hidivo-archivos';

// ── PROMPT DEL EXTRACTOR ──
// Define el esquema JSON EXACTO que se devuelve. El formulario del frontend
// está mapeado contra estas mismas claves. Si se cambia el esquema aquí, hay
// que ajustar el formulario en index.html (abrirModalExtraccion / guardarDatosContrato).
const PROMPT_EXTRACTOR = `Eres un asistente experto en contratos de obra civil pública del Ecuador. Analiza el PDF adjunto (un contrato de construcción/fiscalización) y extrae sus datos en un ÚNICO objeto JSON.

REGLAS ESTRICTAS:
1. Extrae SOLO lo que conste explícitamente en el documento. Si un dato no aparece, usa null. NUNCA inventes montos, fechas, nombres ni cláusulas.
2. Montos como número puro sin símbolos ni separadores de miles (ej. 111555.00, no "$111.555,00").
3. Fechas en formato ISO YYYY-MM-DD. Si solo hay texto ("a los 15 días del mes de marzo de 2024"), conviértelo. Si es ambiguo, usa null.
4. Responde ÚNICAMENTE con el objeto JSON, sin texto adicional, sin explicaciones y sin fences de markdown.

ESQUEMA JSON EXACTO A DEVOLVER:
{
  "descripcion_archivo": string|null,   // UNA sola línea, máx 20 palabras, que identifique el documento: tipo de contrato, partes, monto y fecha de suscripción. Ej.: "Contrato de obra civil SONGA-RINOMAQ, USD 779,535.25, suscrito 17-jun-2026, plazo 8 semanas"
  "proyecto": {
    "nombre": string|null,              // objeto del contrato / nombre de la obra
    "contratante": string|null,         // entidad/municipio que contrata
    "contratista": string|null,         // empresa/persona que ejecuta
    "fiscalizador": string|null,        // fiscalizador o empresa de fiscalización, si consta
    "monto_contrato": number|null,      // valor total del contrato sin IVA si se distingue
    "fecha_inicio": string|null,        // YYYY-MM-DD
    "fecha_fin_planificada": string|null, // YYYY-MM-DD (fecha de término prevista)
    "ubicacion": string|null,           // ciudad/cantón/provincia de la obra
    "descripcion": string|null          // breve descripción del alcance, 1-2 frases
  },
  "anticipo": {
    "porcentaje": number|null,          // % del anticipo (ej. 30 para 30%)
    "monto": number|null,               // valor del anticipo
    "modo_amortizacion": string|null,   // "proporcional" o "manual" si se deduce; si no, null
    "iva_pct": number|null,             // % de IVA si consta (ej. 15)
    "notas": string|null                // condiciones o detalles del anticipo
  },
  "garantias": [                        // una entrada por cada garantía/póliza mencionada
    {
      "tipo": string,                   // uno de: "buen_uso_anticipo","fiel_cumplimiento","buena_calidad_materiales","todo_riesgo","otra"
      "aseguradora": string|null,
      "numero": string|null,            // número de póliza
      "monto": number|null,
      "vigencia_desde": string|null,    // YYYY-MM-DD
      "vigencia_hasta": string|null,    // YYYY-MM-DD
      "notas": string|null
    }
  ],
  "datos_adicionales": {                // referencia, no se guarda en columnas propias
    "plazo": string|null,               // plazo de ejecución (ej. "180 días")
    "multas": string|null,              // régimen de multas por mora
    "clausulas": string|null            // otras cláusulas relevantes, resumidas
  },
  "reajuste_terminos": [                // fórmula polinómica de reajuste, SOLO si el contrato la trae explícita
    {
      "simbolo": string,                // ej. "B1"
      "descripcion": string|null,       // ej. "Cuadrilla tipo"
      "coeficiente": number,            // ej. 0.20
      "indice_base": number             // índice base del componente
    }
  ],
  "datos_no_mapeados": object           // cualquier otro dato relevante del contrato como pares clave/valor
}`;

const fmtErr = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (req.method !== 'POST') return fmtErr({ error: 'Método no permitido' }, 405);

    const { proyecto_id, archivo_id } = await req.json();
    if (!proyecto_id) return fmtErr({ error: 'Falta proyecto_id' }, 400);
    if (!archivo_id) return fmtErr({ error: 'Falta archivo_id' }, 400);

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

    // ── Buscar el archivo y descargar el PDF ──
    const { data: archivo, error: errArch } = await sb.from('archivos')
      .select('id, url, nombre, tipo, proyecto_id').eq('id', archivo_id).single();

    if (errArch || !archivo) return fmtErr({ error: 'Archivo no encontrado' }, 404);
    if (archivo.proyecto_id !== proyecto_id) return fmtErr({ error: 'El archivo no pertenece a este proyecto' }, 400);

    // El path de Storage se deriva de la URL pública: .../object/public/<bucket>/<path>
    const marcador = `/object/public/${BUCKET}/`;
    const idx = (archivo.url || '').indexOf(marcador);
    let pdfBytes: Uint8Array | null = null;

    if (idx >= 0) {
      const path = decodeURIComponent(archivo.url.substring(idx + marcador.length));
      const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(path);
      if (!dlErr && blob) pdfBytes = new Uint8Array(await blob.arrayBuffer());
    }
    // Respaldo: descargar directamente desde la URL pública
    if (!pdfBytes && archivo.url) {
      const r = await fetch(archivo.url);
      if (r.ok) pdfBytes = new Uint8Array(await r.arrayBuffer());
    }
    if (!pdfBytes) return fmtErr({ error: 'No se pudo descargar el PDF desde Storage' }, 502);

    // Guardas de tamaño (la API acepta PDFs de hasta ~32 MB en base64)
    if (pdfBytes.byteLength > 30 * 1024 * 1024) {
      return fmtErr({ error: 'El PDF es demasiado grande (máx. 30 MB)' }, 413);
    }

    const base64 = bytesToBase64(pdfBytes);

    // ── Llamada a Anthropic con el PDF como documento ──
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: PROMPT_EXTRACTOR }
          ]
        }]
      })
    });

    if (!resp.ok) {
      const detalle = await resp.text();
      console.error('Error Anthropic', resp.status, detalle);
      return fmtErr({ error: `Error del servicio de IA (${resp.status})` }, 502);
    }

    const data = await resp.json();
    if (data.stop_reason === 'refusal') {
      return fmtErr({ error: 'El modelo declinó procesar este documento.' }, 422);
    }

    const texto = (data.content || [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('\n')
      .trim();

    if (!texto) return fmtErr({ error: 'El modelo no devolvió contenido.' }, 502);

    // ── Parsear el JSON (limpiando fences ``` por si acaso) ──
    let datos;
    try {
      datos = JSON.parse(limpiarJSON(texto));
    } catch (_e) {
      console.error('JSON inválido del modelo:', texto.slice(0, 500));
      return fmtErr({ error: 'La respuesta del modelo no fue un JSON válido.' }, 502);
    }

    return fmtErr({ datos });

  } catch (err) {
    console.error('extraer-contrato:', err);
    return fmtErr({ error: (err as Error).message || 'Error interno' }, 500);
  }
});

// Quita fences de markdown y texto alrededor del objeto JSON
function limpiarJSON(t: string): string {
  let s = t.trim();
  // Quitar ```json ... ``` o ``` ... ```
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // Recortar a las llaves externas por si quedó texto envolvente
  const ini = s.indexOf('{');
  const fin = s.lastIndexOf('}');
  if (ini >= 0 && fin > ini) s = s.substring(ini, fin + 1);
  return s;
}

// Conversión a base64 en chunks (evita desbordar el stack con PDFs grandes)
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
