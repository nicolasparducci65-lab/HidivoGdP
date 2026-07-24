// Edge Function: resumen-cartera
//
// Agente matinal: arma los indicadores de la cartera (mismos criterios que el
// Panel Cartera del frontend), pide a Claude Haiku un resumen ejecutivo por
// conjunto de proyectos, y lo entrega a cada destinatario como notificación
// persistente (tabla notificaciones, tipo 'resumen_cartera') + Web Push
// (reutilizando la función enviar-push existente).
//
// Invocación: cron (pg_cron + pg_net) con header x-cron-secret == CRON_SECRET,
// o manualmente por un usuario admin autenticado (Bearer JWT).
//
// Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//           ANTHROPIC_API_KEY, CRON_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const PROMPT_RESUMEN = `Eres el asistente matinal de HIDIVO, fiscalizadora de obras. Con los indicadores entregados, escribe un resumen ejecutivo de la cartera en español, máximo 120 palabras, tono directo de ingeniero a ingeniero. Empieza por lo urgente (rojos, vencimientos, suspensiones), luego amarillos, y cierra con una línea de lo que está en verde. Sin saludos, sin markdown, solo el texto. Si no hay nada urgente, dilo en la primera línea.`;

// Fecha YYYY-MM-DD en Ecuador (mismo criterio que hoyEcuador() del frontend)
function hoyEcuador(desplazamientoDias = 0): string {
  const d = new Date(Date.now() + desplazamientoDias * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(d);
}

function fechaLegibleEcuador(): string {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil', weekday: 'long', day: 'numeric', month: 'long'
  }).format(new Date());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) return json({ error: 'ANTHROPIC_API_KEY no configurada' }, 500);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ── Autorización: cron (x-cron-secret) o admin autenticado (prueba manual) ──
    const cronSecret = Deno.env.get('CRON_SECRET') || '';
    const headerSecret = req.headers.get('x-cron-secret') || '';
    let autorizado = !!cronSecret && headerSecret === cronSecret;

    if (!autorizado) {
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
      if (token) {
        const { data: userData } = await sb.auth.getUser(token);
        if (userData?.user) {
          const { data: perfil } = await sb.from('perfiles').select('rol').eq('id', userData.user.id).maybeSingle();
          autorizado = perfil?.rol === 'admin';
        }
      }
    }
    if (!autorizado) return json({ error: 'No autorizado' }, 401);

    // ── Proyectos activos (excluye liquidados; incluye estado_cierre null) ──
    const { data: proyectos, error: errProy } = await sb.from('proyectos')
      .select('id,nombre,estado,estado_cierre')
      .or('estado_cierre.is.null,estado_cierre.neq.liquidado');
    if (errProy) return json({ error: 'Proyectos: ' + errProy.message }, 500);
    const activos = proyectos || [];
    if (!activos.length) return json({ ok: true, mensaje: 'Sin proyectos activos' });
    const ids = activos.map(p => p.id);

    // ── Destinatarios: admins (cartera completa) y fiscalizadores (sus proyectos) ──
    const [{ data: admins }, { data: miembrosFis }] = await Promise.all([
      sb.from('perfiles').select('id').eq('rol', 'admin'),
      sb.from('proyecto_miembros').select('usuario_id,proyecto_id').eq('rol', 'fiscalizador').in('proyecto_id', ids)
    ]);

    const proyectosPorUsuario = new Map<string, Set<string>>();
    (admins || []).forEach(a => proyectosPorUsuario.set(a.id, new Set(ids)));
    (miembrosFis || []).forEach(m => {
      if (proyectosPorUsuario.has(m.usuario_id)) return; // admin ya tiene todo
      if (!proyectosPorUsuario.get(m.usuario_id)) proyectosPorUsuario.set(m.usuario_id, new Set());
      proyectosPorUsuario.get(m.usuario_id)!.add(m.proyecto_id);
    });
    // Sin proyectos activos → no se envía nada
    for (const [uid, set] of proyectosPorUsuario) if (!set.size) proyectosPorUsuario.delete(uid);
    if (!proyectosPorUsuario.size) return json({ ok: true, mensaje: 'Sin destinatarios' });

    // ── Indicadores por proyecto (mismos criterios que cargarCartera del frontend) ──
    const hoyStr = hoyEcuador();
    const limite5 = hoyEcuador(5);
    const hoyMs = new Date(hoyStr + 'T00:00:00').getTime();

    const [rubR, cronR, lbR, planR, garR, obsR, solR] = await Promise.all([
      sb.from('rubros').select('id,proyecto_id,monto_contrato,total_produccion').in('proyecto_id', ids),
      sb.from('cronograma_rubros').select('proyecto_id,rubro_id,fecha_inicio,fecha_fin,linea_base_id').in('proyecto_id', ids),
      sb.from('lineas_base').select('id').eq('activa', true).in('proyecto_id', ids),
      sb.from('planillas_pago').select('proyecto_id,estado').in('estado', ['enviada', 'en_revision']).in('proyecto_id', ids),
      sb.from('garantias').select('proyecto_id,vigencia_hasta').eq('estado', 'vigente').in('proyecto_id', ids),
      sb.from('observaciones').select('proyecto_id,created_at').eq('estado', 'abierta').in('proyecto_id', ids),
      sb.from('solicitudes').select('proyecto_id').in('estado', ['pendiente', 'en_revision']).in('proyecto_id', ids)
    ]);

    const setLBs = new Set((lbR.data || []).map(l => l.id));
    const cron = (cronR.data || []).filter(c => !c.linea_base_id || setLBs.has(c.linea_base_id));

    type Ind = {
      nombre: string; estado: string; vigente: number; ejecutado: number; plan: number;
      garVencidas: number; garPorVencer: number; obs: number; obsDiasMax: number;
      planillasRev: number; sol: number;
    };
    const porP: Record<string, Ind> = {};
    activos.forEach(p => porP[p.id] = {
      nombre: p.nombre || 'Proyecto', estado: p.estado || '', vigente: 0, ejecutado: 0, plan: 0,
      garVencidas: 0, garPorVencer: 0, obs: 0, obsDiasMax: 0, planillasRev: 0, sol: 0
    });
    const montoRubro: Record<string, number> = {};
    (rubR.data || []).forEach(r => {
      const p = porP[r.proyecto_id]; if (!p) return;
      p.vigente += (r.monto_contrato || 0); p.ejecutado += (r.total_produccion || 0);
      montoRubro[r.id] = r.monto_contrato || 0;
    });
    cron.forEach(c => {
      const p = porP[c.proyecto_id]; if (!p || !c.fecha_inicio || !c.fecha_fin) return;
      const ini = new Date(c.fecha_inicio + 'T00:00:00').getTime();
      const fin = new Date(c.fecha_fin + 'T00:00:00').getTime();
      const frac = fin <= ini ? (hoyMs >= fin ? 1 : 0) : Math.max(0, Math.min(1, (hoyMs - ini) / (fin - ini)));
      const peso = p.vigente > 0 ? ((montoRubro[c.rubro_id] || 0) / p.vigente * 100) : 0;
      p.plan += peso * frac;
    });
    (planR.data || []).forEach(pl => { if (porP[pl.proyecto_id]) porP[pl.proyecto_id].planillasRev++; });
    (garR.data || []).forEach(g => {
      const p = porP[g.proyecto_id]; if (!p || !g.vigencia_hasta) return; // fechas null se ignoran
      if (g.vigencia_hasta < hoyStr) p.garVencidas++;
      else if (g.vigencia_hasta <= limite5) p.garPorVencer++;
    });
    (obsR.data || []).forEach(o => {
      const p = porP[o.proyecto_id]; if (!p) return;
      p.obs++;
      if (o.created_at) {
        const dias = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 86400000);
        if (dias > p.obsDiasMax) p.obsDiasMax = dias;
      }
    });
    (solR.data || []).forEach(s => { if (porP[s.proyecto_id]) porP[s.proyecto_id].sol++; });

    // Semáforo, SPI y atraso — misma fórmula que el Panel Cartera
    const lineaProyecto = (pid: string): string => {
      const d = porP[pid];
      const real = d.vigente > 0 ? d.ejecutado / d.vigente * 100 : 0;
      const spi = d.plan > 0.5 ? (real / d.plan) : null;
      let atraso = 0;
      if (spi && spi < 1) {
        const crons = cron.filter(c => c.proyecto_id === pid && c.fecha_inicio);
        if (crons.length) {
          const iniMin = Math.min(...crons.map(c => new Date(c.fecha_inicio + 'T00:00:00').getTime()));
          const diasTrans = Math.max(0, (hoyMs - iniMin) / 86400000);
          atraso = Math.round(diasTrans * (1 / spi - 1));
        }
      }
      const pend = d.obs + d.sol + d.planillasRev;
      let sem = 'VERDE';
      if ((spi !== null && spi < 0.85) || d.garVencidas > 0 || atraso > 30) sem = 'ROJO';
      else if ((spi !== null && spi < 0.95) || d.garPorVencer > 0 || pend > 5) sem = 'AMARILLO';
      const partes = [
        `avance ${real.toFixed(1)}% vs plan ${d.plan.toFixed(1)}%`,
        spi !== null ? `SPI ${spi.toFixed(2)}` : 'sin cronograma',
        atraso > 0 ? `~${atraso} días de atraso` : null,
        d.garVencidas ? `${d.garVencidas} garantía(s) VENCIDA(S)` : null,
        d.garPorVencer ? `${d.garPorVencer} garantía(s) por vencer en ≤5 días` : null,
        d.obs ? `${d.obs} observación(es) abierta(s)${d.obsDiasMax ? ` (la más antigua lleva ${d.obsDiasMax} días sin responder)` : ''}` : null,
        d.planillasRev ? `${d.planillasRev} planilla(s) en revisión` : null,
        d.sol ? `${d.sol} solicitud(es) pendiente(s)` : null,
        d.estado === 'pausado' ? 'PROYECTO SUSPENDIDO/PAUSADO' : null
      ].filter(Boolean).join('; ');
      return `- [${sem}] ${d.nombre}: ${partes}`;
    };

    // ── Agrupar usuarios por conjunto de proyectos (una llamada IA por grupo) ──
    const grupos = new Map<string, { proyectoIds: string[]; usuarios: string[] }>();
    for (const [uid, set] of proyectosPorUsuario) {
      const clave = [...set].sort().join(',');
      if (!grupos.has(clave)) grupos.set(clave, { proyectoIds: [...set], usuarios: [] });
      grupos.get(clave)!.usuarios.push(uid);
    }

    const fechaLegible = fechaLegibleEcuador();
    const titulo = `Resumen de cartera — ${fechaLegible}`;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const errores: string[] = [];
    let entregados = 0;

    for (const [, grupo] of grupos) {
      try {
        const indicadores = grupo.proyectoIds.map(lineaProyecto).join('\n');

        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 500,
            messages: [{ role: 'user', content: `${PROMPT_RESUMEN}\n\nINDICADORES DE HOY (${hoyStr}):\n${indicadores}` }]
          })
        });
        if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
        const data = await resp.json();
        const resumen = (data.content || []).filter((b: { type: string }) => b.type === 'text')
          .map((b: { text: string }) => b.text).join('\n').trim();
        if (!resumen) throw new Error('El modelo no devolvió texto');

        // Notificación persistente por usuario (errores individuales no abortan el grupo).
        // Esquema real de la tabla existente: perfil_id / mensaje / url_destino / created_at.
        for (const uid of grupo.usuarios) {
          const { error: insErr } = await sb.from('notificaciones').insert({
            perfil_id: uid, tipo: 'resumen_cartera', titulo, mensaje: resumen, url_destino: '/HidivoGdP/'
          });
          if (insErr) { errores.push(`notif ${uid}: ${insErr.message}`); continue; }
          entregados++;
        }

        // Web Push del grupo completo, reutilizando enviar-push (mecanismo existente)
        try {
          const pushResp = await fetch(`${supaUrl}/functions/v1/enviar-push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}` },
            body: JSON.stringify({
              usuarioIds: grupo.usuarios,
              titulo: `🌅 ${titulo}`,
              cuerpo: resumen.split('\n')[0].slice(0, 140),
              url: '/HidivoGdP/',
              tag: 'resumen_cartera'
            })
          });
          if (!pushResp.ok) errores.push(`push grupo: HTTP ${pushResp.status}`);
        } catch (e) { errores.push('push grupo: ' + (e as Error).message); }

      } catch (e) {
        errores.push('grupo: ' + (e as Error).message);
        console.error('resumen-cartera grupo:', e);
      }
    }

    return json({ ok: true, proyectos: activos.length, grupos: grupos.size, entregados, errores });

  } catch (err) {
    console.error('resumen-cartera:', err);
    return json({ error: (err as Error).message || 'Error interno' }, 500);
  }
});
