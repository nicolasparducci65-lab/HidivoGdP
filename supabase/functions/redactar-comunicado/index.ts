// Edge Function: redactar-comunicado
//
// Genera el borrador de una comunicación formal de Fiscalización Externa
// (suspensión, llamado de atención, requerimiento, multa, reinicio, informe)
// a partir de los datos reales del proyecto: contrato/anticipo, garantías,
// observaciones abiertas y últimos registros del libro de obra.
//
// POST { proyecto_id, tipo_comunicado, instrucciones_adicionales }
//  ->  { borrador: "<texto plano listo para pegar en Word>" }
//
// Requiere las variables de entorno:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// ── PROMPT DEL AGENTE ──
const PROMPT_AGENTE = `Eres el asistente de redacción de la Fiscalización Externa de HIDIVO, empresa fiscalizadora de obras civiles en Ecuador. Redactas comunicaciones formales dirigidas a contratistas o al Administrador del Contrato.

REGLAS ESTRICTAS:
1. Usa ÚNICAMENTE los datos del contrato y los hechos proporcionados. NUNCA inventes cláusulas, montos, fechas, nombres ni hechos no indicados. Si falta un dato necesario, deja un marcador entre corchetes, p. ej. [FECHA].
2. Cada incumplimiento citado debe vincularse a la cláusula o numeral contractual que lo sustenta, según los datos entregados.
3. Registro formal jurídico-técnico ecuatoriano de obra civil: "LA CONTRATISTA", "LA CONTRATANTE", "esta Fiscalización", "se deja expresa constancia", "sin perjuicio de".
4. Estructura de la carta:
   - Ciudad y fecha ([CIUDAD], [FECHA] si no se indican)
   - Destinatario (empresa, representante, cargo)
   - Ref.: en mayúsculas, tipo de comunicado + nombre del contrato
   - Saludo: "De nuestra consideración:"
   - Párrafo de fundamento: calidad de Fiscalización Externa + cláusulas que facultan la acción
   - Incumplimientos o hechos en lista numerada, cada uno con su sustento contractual
   - Disposiciones o requerimientos en lista numerada (qué debe hacer el contratista)
   - Reservas: efectos sobre plazo, multas, garantías y demás acciones, SOLO si los datos del contrato lo sustentan
   - Cierre: "Atentamente," + bloque de firma "Ing. [NOMBRE] / Fiscalización Externa – HIDIVO / Proyecto: [nombre]"
   - c.c.: Administrador del Contrato si consta en los datos
5. Aplica las instrucciones adicionales del usuario si las hay.
6. Extensión objetivo: 1 a 2 páginas. Sin encabezados markdown (#), sin negritas con asteriscos: solo texto plano listo para pegar en Word.
7. Responde SOLO con el texto de la carta, sin preámbulos ni comentarios.`;

const TIPOS_COMUNICADO: Record<string, string> = {
  suspension_temporal:  'SUSPENSIÓN TEMPORAL DE LOS TRABAJOS',
  llamado_atencion:     'LLAMADO DE ATENCIÓN',
  requerimiento:        'REQUERIMIENTO DE SUBSANACIÓN',
  notificacion_multa:   'NOTIFICACIÓN DE APLICACIÓN DE MULTA',
  autorizacion_reinicio:'AUTORIZACIÓN DE REINICIO DE TRABAJOS',
  informe_administrador:'INFORME AL ADMINISTRADOR DEL CONTRATO'
};

const fmtMonto = (v: number | null | undefined) =>
  v == null ? 'no registrado' : '$' + Number(v).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtFecha = (v: string | null | undefined) => v || 'no registrada';

const ETIQUETAS_GARANTIA: Record<string, string> = {
  buen_uso_anticipo: 'Buen uso del anticipo',
  fiel_cumplimiento: 'Fiel cumplimiento del contrato',
  tecnica:           'Técnica / calidad de materiales',
  otra:              'Otra'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return json({ error: 'Método no permitido' }, 405);
    }

    const { proyecto_id, tipo_comunicado, instrucciones_adicionales } = await req.json();

    if (!proyecto_id) return json({ error: 'Falta proyecto_id' }, 400);
    if (!tipo_comunicado || !TIPOS_COMUNICADO[tipo_comunicado]) {
      return json({ error: 'tipo_comunicado inválido' }, 400);
    }

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) return json({ error: 'ANTHROPIC_API_KEY no configurada' }, 500);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ── Autenticación y autorización ──
    // Requiere un usuario con sesión válida que además sea admin global, o
    // admin/fiscalizador en ESTE proyecto. Evita que se llame el endpoint
    // directamente sin permisos (protege el crédito y el uso indebido).
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'No autorizado: falta sesión' }, 401);

    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ error: 'No autorizado: sesión inválida o expirada' }, 401);
    }
    const userId = userData.user.id;

    // ¿Admin global? (perfiles.rol === 'admin' es el único rol verdaderamente global)
    const { data: perfil } = await sb.from('perfiles').select('rol').eq('id', userId).maybeSingle();
    let autorizado = perfil?.rol === 'admin';

    // Si no es admin global, debe ser admin/fiscalizador en este proyecto
    if (!autorizado) {
      const { data: miembro } = await sb.from('proyecto_miembros')
        .select('rol').eq('usuario_id', userId).eq('proyecto_id', proyecto_id).maybeSingle();
      autorizado = ['admin', 'fiscalizador'].includes(miembro?.rol);
    }

    if (!autorizado) {
      return json({ error: 'No autorizado: se requiere rol admin o fiscalizador en el proyecto' }, 403);
    }

    // ── Datos del proyecto ──
    const [
      { data: proyecto, error: errProy },
      { data: anticipo },
      { data: garantias },
      { data: observaciones },
      { data: libro },
      { data: rubros }
    ] = await Promise.all([
      sb.from('proyectos').select('*').eq('id', proyecto_id).single(),
      sb.from('contrato_anticipo').select('*').eq('proyecto_id', proyecto_id).maybeSingle(),
      sb.from('garantias').select('*').eq('proyecto_id', proyecto_id).order('vigencia_hasta'),
      sb.from('observaciones')
        .select('numero,titulo,descripcion,estado,created_at')
        .eq('proyecto_id', proyecto_id)
        .neq('estado', 'resuelta')
        .order('numero', { ascending: false })
        .limit(25),
      sb.from('libro_obra')
        .select('numero_registro,fecha,clima_diurno,personal_total,actividades_ejecutadas,novedades,resoluciones')
        .eq('proyecto_id', proyecto_id)
        .order('fecha', { ascending: false })
        .limit(10),
      sb.from('rubros')
        .select('monto_contrato,total_produccion')
        .eq('proyecto_id', proyecto_id)
    ]);

    if (errProy || !proyecto) {
      return json({ error: 'Proyecto no encontrado: ' + (errProy?.message || proyecto_id) }, 404);
    }

    const contexto = armarContexto({ proyecto, anticipo, garantias, observaciones, libro, rubros });

    // ── Mensaje único para el modelo ──
    const contenidoUsuario =
      PROMPT_AGENTE +
      '\n\n=====================\nDATOS DEL PROYECTO Y DEL CONTRATO\n=====================\n' +
      contexto +
      '\n\n=====================\nTIPO DE COMUNICADO SOLICITADO\n=====================\n' +
      TIPOS_COMUNICADO[tipo_comunicado] +
      '\n\n=====================\nINSTRUCCIONES ADICIONALES DEL USUARIO\n=====================\n' +
      ((instrucciones_adicionales || '').trim() || '(ninguna)') +
      '\n\nRedacta ahora la carta.';

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 3000,
        messages: [{ role: 'user', content: contenidoUsuario }]
      })
    });

    if (!resp.ok) {
      const detalle = await resp.text();
      console.error('Error Anthropic', resp.status, detalle);
      return json({ error: `Error del servicio de IA (${resp.status})` }, 502);
    }

    const data = await resp.json();

    if (data.stop_reason === 'refusal') {
      return json({ error: 'El modelo declinó generar este contenido.' }, 422);
    }

    const borrador = (data.content || [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('\n')
      .trim();

    if (!borrador) return json({ error: 'El modelo no devolvió texto.' }, 502);

    return json({ borrador });

  } catch (err) {
    console.error('redactar-comunicado:', err);
    return json({ error: (err as Error).message || 'Error interno' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// deno-lint-ignore no-explicit-any
function armarContexto({ proyecto, anticipo, garantias, observaciones, libro, rubros }: any): string {
  const L: string[] = [];

  L.push('-- CONTRATO --');
  L.push(`Proyecto / objeto: ${proyecto.nombre || 'no registrado'}`);
  L.push(`Contratante: ${proyecto.contratante || 'no registrado'}`);
  L.push(`Contratista: ${proyecto.contratista || 'no registrado'}`);
  L.push(`Ubicación: ${proyecto.ubicacion || 'no registrada'}`);
  L.push(`Monto del contrato: ${fmtMonto(proyecto.monto_contrato)}`);
  L.push(`Fecha de inicio: ${fmtFecha(proyecto.fecha_inicio)}`);
  L.push(`Fecha de fin planificada: ${fmtFecha(proyecto.fecha_fin_planificada)}`);
  L.push(`Estado del proyecto: ${proyecto.estado || 'no registrado'}`);
  if (proyecto.descripcion) L.push(`Descripción: ${proyecto.descripcion}`);

  // Avance económico calculado desde rubros
  if (rubros?.length) {
    const contratado = rubros.reduce((s: number, r: any) => s + (r.monto_contrato || 0), 0);
    const ejecutado  = rubros.reduce((s: number, r: any) => s + (r.total_produccion || 0), 0);
    const pct = contratado > 0 ? (ejecutado / contratado * 100).toFixed(2) : '0.00';
    L.push('');
    L.push('-- AVANCE ECONÓMICO --');
    L.push(`Monto contratado vigente (suma de rubros): ${fmtMonto(contratado)}`);
    L.push(`Producción ejecutada acumulada: ${fmtMonto(ejecutado)} (${pct}% de avance)`);
  }

  L.push('');
  L.push('-- ANTICIPO --');
  if (anticipo) {
    L.push(`Monto del anticipo: ${fmtMonto(anticipo.monto)}`);
    if (anticipo.porcentaje != null) L.push(`Porcentaje del anticipo: ${anticipo.porcentaje}%`);
    if (anticipo.fecha_entrega) L.push(`Fecha de entrega del anticipo: ${anticipo.fecha_entrega}`);
    if (anticipo.notas) L.push(`Notas: ${anticipo.notas}`);
  } else {
    L.push('No se registra anticipo para este contrato.');
  }

  L.push('');
  L.push('-- GARANTÍAS --');
  if (garantias?.length) {
    garantias.forEach((g: any, i: number) => {
      L.push(
        `${i + 1}. ${ETIQUETAS_GARANTIA[g.tipo] || g.tipo} — aseguradora: ${g.aseguradora || 'no registrada'}` +
        `; póliza N.º ${g.numero || 'no registrado'}; monto ${fmtMonto(g.monto)}` +
        `; vigencia ${fmtFecha(g.vigencia_desde)} a ${fmtFecha(g.vigencia_hasta)}; estado: ${g.estado || 'no registrado'}` +
        (g.notas ? `; observación: ${g.notas}` : '')
      );
    });
  } else {
    L.push('No se registran garantías para este contrato.');
  }

  L.push('');
  L.push('-- OBSERVACIONES DE FISCALIZACIÓN PENDIENTES --');
  if (observaciones?.length) {
    observaciones.forEach((o: any) => {
      L.push(
        `Observación N.º ${o.numero} (${o.estado}, registrada el ${(o.created_at || '').slice(0, 10) || 'fecha no registrada'}): ` +
        `${o.titulo}${o.descripcion ? ' — ' + o.descripcion : ''}`
      );
    });
  } else {
    L.push('No hay observaciones pendientes registradas.');
  }

  L.push('');
  L.push('-- LIBRO DE OBRA (últimos registros) --');
  if (libro?.length) {
    libro.forEach((r: any) => {
      const partes = [
        `Registro N.º ${r.numero_registro ?? 's/n'} del ${r.fecha}`,
        r.clima_diurno ? `clima: ${r.clima_diurno}` : null,
        r.personal_total != null ? `personal: ${r.personal_total}` : null,
        r.actividades_ejecutadas ? `actividades: ${r.actividades_ejecutadas}` : null,
        r.novedades ? `novedades: ${r.novedades}` : null,
        r.resoluciones ? `resoluciones: ${r.resoluciones}` : null
      ].filter(Boolean);
      L.push(partes.join(' | '));
    });
  } else {
    L.push('No hay registros en el libro de obra.');
  }

  L.push('');
  L.push(`Fecha de emisión sugerida (hoy): ${new Date().toISOString().slice(0, 10)}`);

  return L.join('\n');
}
