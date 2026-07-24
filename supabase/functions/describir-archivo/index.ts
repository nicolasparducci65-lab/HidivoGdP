// Edge Function: describir-archivo
//
// Genera una descripción de UNA línea (máx 20 palabras) para un archivo del
// proyecto usando Claude Haiku, y la guarda en archivos.descripcion_ia.
// Pensada para llamadas fire-and-forget tras subir un archivo, y para el
// barrido "Generar descripciones faltantes".
//
// POST { archivo_id }
//  ->  { descripcion: string }  |  { skip: true }  |  { error: string }
//
// Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const BUCKET = 'hidivo-archivos';
const MAX_PDF = 30 * 1024 * 1024;   // 30 MB
const MAX_IMG = 5 * 1024 * 1024;    // 5 MB

const MEDIA_IMG: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

    const { archivo_id } = await req.json();
    if (!archivo_id) return json({ error: 'Falta archivo_id' }, 400);

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) return json({ error: 'ANTHROPIC_API_KEY no configurada' }, 500);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ── Autenticación: cualquier usuario con sesión válida que sea admin
    // global o miembro del proyecto del archivo (cualquier rol sube archivos).
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'No autorizado: falta sesión' }, 401);
    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: 'No autorizado: sesión inválida' }, 401);
    const userId = userData.user.id;

    // ── Leer el archivo ──
    const { data: archivo, error: errArch } = await sb.from('archivos')
      .select('id, url, nombre, tipo, modulo, proyecto_id, descripcion_ia')
      .eq('id', archivo_id).single();
    if (errArch || !archivo) return json({ error: 'Archivo no encontrado' }, 404);

    // Autorización sobre el proyecto del archivo
    const { data: perfil } = await sb.from('perfiles').select('rol').eq('id', userId).maybeSingle();
    let autorizado = perfil?.rol === 'admin';
    if (!autorizado && archivo.proyecto_id) {
      const { data: miembro } = await sb.from('proyecto_miembros')
        .select('rol').eq('usuario_id', userId).eq('proyecto_id', archivo.proyecto_id).maybeSingle();
      autorizado = !!miembro;
    }
    if (!autorizado) return json({ error: 'No autorizado para este proyecto' }, 403);

    // Ya tiene descripción: no gastar tokens
    if (archivo.descripcion_ia && String(archivo.descripcion_ia).trim()) {
      return json({ skip: true });
    }

    // ── Tipo compatible ──
    const ext = (archivo.nombre || '').split('.').pop()?.toLowerCase() || '';
    const esPDF = ext === 'pdf' || archivo.tipo === 'application/pdf';
    const mediaImg = MEDIA_IMG[ext];
    if (!esPDF && !mediaImg) return json({ skip: true });

    // ── Descargar del bucket (path desde la URL pública; respaldo: fetch directo) ──
    const marcador = `/object/public/${BUCKET}/`;
    const idx = (archivo.url || '').indexOf(marcador);
    let bytes: Uint8Array | null = null;
    if (idx >= 0) {
      const path = decodeURIComponent(archivo.url.substring(idx + marcador.length));
      const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(path);
      if (!dlErr && blob) bytes = new Uint8Array(await blob.arrayBuffer());
    }
    if (!bytes && archivo.url) {
      const r = await fetch(archivo.url);
      if (r.ok) bytes = new Uint8Array(await r.arrayBuffer());
    }
    if (!bytes) return json({ error: 'No se pudo descargar el archivo' }, 502);

    // Límites de tamaño por tipo
    if (esPDF && bytes.byteLength > MAX_PDF) return json({ skip: true });
    if (mediaImg && bytes.byteLength > MAX_IMG) return json({ skip: true });

    // ── Contexto del proyecto para el prompt ──
    let nombreProyecto = '';
    if (archivo.proyecto_id) {
      const { data: proy } = await sb.from('proyectos').select('nombre').eq('id', archivo.proyecto_id).maybeSingle();
      nombreProyecto = proy?.nombre || '';
    }

    const prompt = `Describe este documento o imagen en UNA sola línea de máximo 20 palabras, en español, identificando qué es y su contenido esencial (tipo de documento, partes, fechas, o qué se ve en la foto y dónde, si es identificable). Contexto: pertenece al módulo ${archivo.modulo || 'general'} de un proyecto de obra civil llamado ${nombreProyecto || '(sin nombre)'}. Responde SOLO con la descripción, sin comillas ni preámbulos.`;

    const bloqueArchivo = esPDF
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytesToBase64(bytes) } }
      : { type: 'image', source: { type: 'base64', media_type: mediaImg, data: bytesToBase64(bytes) } };

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 200,
        messages: [{ role: 'user', content: [bloqueArchivo, { type: 'text', text: prompt }] }]
      })
    });

    if (!resp.ok) {
      const detalle = await resp.text();
      console.error('describir-archivo: error Anthropic', resp.status, detalle);
      return json({ error: `Error del servicio de IA (${resp.status})` }, 502);
    }

    const data = await resp.json();
    const descripcion = (data.content || [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join(' ')
      .trim();

    if (!descripcion) return json({ error: 'El modelo no devolvió descripción' }, 502);

    // Guardar SOLO si sigue vacía (evita pisar una descripción puesta entre tanto)
    const { error: updErr } = await sb.from('archivos')
      .update({ descripcion_ia: descripcion })
      .eq('id', archivo_id)
      .or('descripcion_ia.is.null,descripcion_ia.eq.""');
    if (updErr) {
      console.error('describir-archivo: error al guardar', updErr.message);
      return json({ error: 'No se pudo guardar la descripción' }, 500);
    }

    return json({ descripcion });

  } catch (err) {
    console.error('describir-archivo:', err);
    return json({ error: (err as Error).message || 'Error interno' }, 500);
  }
});

// Conversión a base64 en chunks (evita desbordar el stack con archivos grandes)
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
