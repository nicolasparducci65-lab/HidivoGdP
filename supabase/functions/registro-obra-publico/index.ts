// Edge Function: registro-obra-publico
//
// Backend del formulario público registro-obra.html (Libro de Obra sin login).
// Reemplaza los accesos anónimos directos a Supabase: valida un token por
// proyecto (proyectos.registro_token, revocable regenerándolo) y opera con el
// service role. Permite ejecutar el Bloque B de sql/parche-anonimo.sql sin
// romper el formulario.
//
// Acciones (POST):
//   JSON  { token, action:'contexto' }
//     -> { proyecto:{nombre,contratista,ubicacion}, siguienteNumero,
//          catalogo:[{id,nombre,unidad,tipo}], rubros:[{id,codigo,descripcion,unidad}] }
//   JSON  { token, action:'guardar', registro:{...}, items:[...], rubros:[{id,cantidad}] }
//     -> { registro_id, numero_registro }
//   FORM  token, action:'foto',    registro_id, orden, descripcion?, file
//     -> { url }   (sube a hidivo-fotos e inserta libro_obra_fotos)
//   FORM  token, action:'adjunto', registro_id, file
//     -> { url }   (sube a hidivo-archivos e inserta en archivos — corrige el
//                   INSERT que fallaba en silencio desde el cliente anónimo)
//
// Desplegar con --no-verify-jwt (el token del proyecto es la autenticación).
// Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // El cuerpo puede ser JSON (contexto/guardar) o multipart (foto/adjunto)
    const contentType = req.headers.get('content-type') || '';
    let token = '', action = '', body: Record<string, unknown> = {}, form: FormData | null = null;

    if (contentType.includes('multipart/form-data')) {
      form = await req.formData();
      token = String(form.get('token') || '');
      action = String(form.get('action') || '');
    } else {
      body = await req.json();
      token = String(body.token || '');
      action = String(body.action || '');
    }

    if (!UUID_RE.test(token)) return json({ error: 'Link inválido o caducado' }, 401);

    // Validar token -> proyecto
    const { data: proyecto } = await sb.from('proyectos')
      .select('id,nombre,contratista,ubicacion')
      .eq('registro_token', token)
      .maybeSingle();
    if (!proyecto) return json({ error: 'Link inválido o caducado. Solicita uno nuevo al equipo de fiscalización.' }, 401);

    // ── contexto ──
    if (action === 'contexto') {
      const [{ count }, { data: catalogo }, { data: rubros }] = await Promise.all([
        sb.from('libro_obra').select('id', { count: 'exact', head: true }).eq('proyecto_id', proyecto.id),
        sb.from('catalogo_items').select('id,nombre,unidad,tipo')
          .or(`es_base.eq.true,proyecto_id.eq.${proyecto.id}`).order('nombre'),
        sb.from('rubros').select('id,codigo,descripcion,unidad')
          .eq('proyecto_id', proyecto.id).order('orden')
      ]);
      return json({
        proyecto: { nombre: proyecto.nombre, contratista: proyecto.contratista, ubicacion: proyecto.ubicacion },
        siguienteNumero: (count || 0) + 1,
        catalogo: catalogo || [],
        rubros: rubros || []
      });
    }

    // ── guardar ──
    if (action === 'guardar') {
      const reg = (body.registro || {}) as Record<string, unknown>;
      if (!reg.fecha || !reg.actividades_ejecutadas) {
        return json({ error: 'Fecha y actividades son obligatorias' }, 400);
      }

      // El número de registro se calcula en el servidor (no se confía en el cliente)
      const { count } = await sb.from('libro_obra')
        .select('id', { count: 'exact', head: true }).eq('proyecto_id', proyecto.id);

      const { data: registro, error } = await sb.from('libro_obra').insert({
        proyecto_id: proyecto.id,
        numero_registro: (count || 0) + 1,
        residente_nombre: reg.residente_nombre ?? null,
        residente_email: reg.residente_email ?? null,
        residente_empresa: reg.residente_empresa ?? null,
        fecha: reg.fecha,
        clima: reg.clima ?? null,
        temperatura_min: reg.temperatura_min ?? null,
        temperatura_max: reg.temperatura_max ?? null,
        personal_total: reg.personal_total ?? 0,
        actividades_ejecutadas: reg.actividades_ejecutadas,
        equipos_maquinaria: reg.equipos_maquinaria ?? null,
        materiales_utilizados: reg.materiales_utilizados ?? null,
        novedades: reg.novedades ?? null,
        resoluciones: reg.resoluciones ?? null
      }).select().single();
      if (error || !registro) return json({ error: 'Error al guardar: ' + (error?.message || 'desconocido') }, 500);

      // Items (equipos/materiales)
      const items = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
      if (items.length) {
        await sb.from('libro_obra_items').insert(items.map(i => ({
          registro_id: registro.id,
          item_id: i.item_id ?? null,
          nombre_libre: i.item_id ? null : (i.nombre ?? null),
          tipo: i.tipo === 'equipo' ? 'equipo' : 'material',
          cantidad: Number(i.cantidad) || 0
        })));
      }

      // Rubros del día + acumulado (solo rubros que pertenecen a este proyecto)
      const rubrosDia = (Array.isArray(body.rubros) ? body.rubros as { id: string; cantidad: number }[] : [])
        .filter(r => UUID_RE.test(String(r.id)) && Number(r.cantidad) > 0);
      if (rubrosDia.length) {
        const { data: propios } = await sb.from('rubros')
          .select('id,cantidad_ejecutada')
          .eq('proyecto_id', proyecto.id)
          .in('id', rubrosDia.map(r => r.id));
        const mapa = new Map((propios || []).map(r => [r.id, r]));
        const validos = rubrosDia.filter(r => mapa.has(r.id));
        if (validos.length) {
          await sb.from('libro_obra_rubros').insert(validos.map(r => ({
            registro_id: registro.id, rubro_id: r.id, cantidad_dia: Number(r.cantidad)
          })));
          for (const r of validos) {
            const actual = mapa.get(r.id)!;
            await sb.from('rubros')
              .update({ cantidad_ejecutada: (Number(actual.cantidad_ejecutada) || 0) + Number(r.cantidad) })
              .eq('id', r.id);
          }
        }
      }

      return json({ registro_id: registro.id, numero_registro: registro.numero_registro });
    }

    // ── foto / adjunto (multipart) ──
    if (action === 'foto' || action === 'adjunto') {
      if (!form) return json({ error: 'Se esperaba multipart/form-data' }, 400);
      const registroId = String(form.get('registro_id') || '');
      const file = form.get('file');
      if (!UUID_RE.test(registroId) || !(file instanceof File)) {
        return json({ error: 'Parámetros inválidos' }, 400);
      }

      // El registro debe pertenecer al proyecto del token
      const { data: registro } = await sb.from('libro_obra')
        .select('id').eq('id', registroId).eq('proyecto_id', proyecto.id).maybeSingle();
      if (!registro) return json({ error: 'Registro no encontrado en este proyecto' }, 404);

      const nombreSeguro = (file.name || 'archivo').replace(/[^\w.\-]+/g, '_');

      if (action === 'foto') {
        if (!file.type.startsWith('image/')) return json({ error: 'Solo imágenes' }, 400);
        const orden = parseInt(String(form.get('orden') || '1')) || 1;
        const path = `libro_obra/${registroId}/${Date.now()}_${orden}.${nombreSeguro.split('.').pop() || 'jpg'}`;
        const { error: upErr } = await sb.storage.from('hidivo-fotos')
          .upload(path, file, { contentType: file.type, upsert: true });
        if (upErr) return json({ error: 'Error al subir la foto: ' + upErr.message }, 500);
        const { data: urlData } = sb.storage.from('hidivo-fotos').getPublicUrl(path);
        await sb.from('libro_obra_fotos').insert({
          registro_id: registroId, url: urlData.publicUrl,
          descripcion: String(form.get('descripcion') || '') || null, orden
        });
        return json({ url: urlData.publicUrl });
      }

      // adjunto
      const path = `libro_obra/${registroId}/${Date.now()}_${nombreSeguro}`;
      const { error: upErr } = await sb.storage.from('hidivo-archivos')
        .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: true });
      if (upErr) return json({ error: 'Error al subir el archivo: ' + upErr.message }, 500);
      const { data: urlData } = sb.storage.from('hidivo-archivos').getPublicUrl(path);
      const { error: insErr } = await sb.from('archivos').insert({
        proyecto_id: proyecto.id,
        modulo: 'libro_obra',
        referencia_id: registroId,
        nombre: file.name,
        tipo: file.type || null,
        url: urlData.publicUrl,
        tamanio: file.size
      });
      if (insErr) return json({ error: 'Archivo subido pero no registrado: ' + insErr.message }, 500);
      return json({ url: urlData.publicUrl });
    }

    return json({ error: 'Acción no reconocida' }, 400);

  } catch (err) {
    console.error('registro-obra-publico:', err);
    return json({ error: (err as Error).message || 'Error interno' }, 500);
  }
});
