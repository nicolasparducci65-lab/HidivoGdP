-- ============================================================================
-- APLICADA en producción el 27-nov-2026 (07:37 de Ecuador), con el secreto
-- «resumen_cartera_cron_secret» ya creado en Vault (64 caracteres) y el mismo
-- valor puesto por Nicolás en CRON_SECRET. Falta ver la corrida del 28-nov.
-- Cron «resumen-cartera-diario»: el x-cron-secret se lee de Vault en cada
-- corrida, del secreto «resumen_cartera_cron_secret», y deja de estar escrito
-- en el comando de cron.job.
-- SIN APLICAR. Solo cambia el comando de ESE job de pg_cron. No crea ni cambia
-- ningún secreto, no toca la función resumen-cartera ni ningún otro job. La
-- aplica el rol dueño de la base (postgres): en el SQL Editor, o con
-- «supabase db query --linked -f».
--
-- Por qué (27-nov-2026):
--   Con la migración 20261127 la llamada del cron ya pasa la puerta de
--   verify_jwt, pero la corrida de las 07:00 respondió 401 {"error":"No
--   autorizado"}: el x-cron-secret escrito en el comando no coincide con el
--   CRON_SECRET de la función (o ese secreto no está definido). El valor del
--   comando no se puede validar contra la función y además está en texto plano.
--
-- Revisado antes de escribirla:
--   - CRON_SECRET solo lo lee resumen-cartera (ni las otras funciones del repo
--     ni las cuatro desplegadas que no están en él: enviar-push,
--     dynamic-service, alertas-mantenimiento, notificar-observacion).
--   - x-cron-secret solo lo manda este job. No hay otra tarea que comparta el
--     secreto, así que no se incluye ninguna más.
--
-- ANTES DE APLICAR (lo hace Nicolás; el valor no pasa por el repositorio):
--   1) Generar un secreto nuevo, largo y al azar (por ejemplo 64 caracteres
--      hexadecimales).
--   2) Panel de Supabase → Edge Functions → Secrets: poner ese valor como
--      CRON_SECRET.
--   3) SQL Editor, con el MISMO valor:
--        select vault.create_secret('<valor>', 'resumen_cartera_cron_secret',
--               'x-cron-secret del cron resumen-cartera-diario; igual a CRON_SECRET de la función');
--   Si el secreto de Vault no existe o está vacío, esta migración LANZA y no
--   cambia nada.
--
-- Qué hace: en el comando del job sustituye
--     'x-cron-secret','<valor escrito>'
--   por
--     'x-cron-secret',(select … from vault.decrypted_secrets … 'resumen_cartera_cron_secret')
--   Lo demás del comando (URL, Authorization desde Vault, cuerpo, timeout de
--   60 s) queda igual.
--
-- Seguro de repetir: si el comando ya lee ese secreto de Vault, no hace nada.
-- Si el comando no tiene la forma esperada, LANZA y no cambia nada.
--
-- Si el valor de Vault y el CRON_SECRET de la función no coinciden, la función
-- responde 401 «No autorizado» y no se envía nada (se ve en net._http_response).
-- Al rotar el secreto se cambian los dos, sin tocar el job:
--   select vault.update_secret((select id from vault.secrets where name = 'resumen_cartera_cron_secret'), '<valor nuevo>');
--   y el mismo valor en CRON_SECRET (panel).
--
-- Comprobación posterior (la respuesta se guarda 6 horas), tras la corrida de
-- las 07:00 de Ecuador (lunes a sábado):
--   select created, status_code, timed_out, left(content, 300)
--     from net._http_response order by created desc limit 5;
--   -- esperado: 200 y {"ok":true,…,"grupos":1,"entregados":1,"destinatarios":"admins","errores":[]}
--
-- Para deshacer: cron.alter_job con el comando anterior (un valor escrito en
-- lugar de la subconsulta). El valor antiguo no se conserva en ningún sitio:
-- deshacer significa escribir en el comando el valor vigente de CRON_SECRET.
-- ============================================================================

do $$
declare
  v_id      bigint;
  v_cmd     text;
  v_nuevo   text;
  v_largo   int;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Vault no está disponible: no se cambia nada';
  end if;

  select jobid, command into v_id, v_cmd
    from cron.job
   where jobname = 'resumen-cartera-diario';

  if v_id is null then
    raise exception 'No existe el job resumen-cartera-diario';
  end if;

  select length(btrim(s.decrypted_secret, E' \t\r\n')) into v_largo
    from vault.decrypted_secrets s
   where s.name = 'resumen_cartera_cron_secret';

  if v_largo is null or v_largo = 0 then
    raise exception 'Falta el secreto de Vault «resumen_cartera_cron_secret» (o está vacío): créalo con el mismo valor que CRON_SECRET antes de aplicar. No se cambia nada';
  end if;
  if v_largo < 32 then
    raise exception 'El secreto «resumen_cartera_cron_secret» tiene % caracteres: demasiado corto (mínimo 32). No se cambia nada', v_largo;
  end if;

  if v_cmd ~ 'resumen_cartera_cron_secret' then
    raise notice 'El job % ya lee el x-cron-secret de Vault: no se cambia nada', v_id;
    return;
  end if;

  v_nuevo := regexp_replace(
    v_cmd,
    $r$('x-cron-secret'\s*,\s*)'[^']*'$r$,
    $s$\1(select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'resumen_cartera_cron_secret')$s$
  );
  if v_nuevo = v_cmd then
    raise exception 'El comando del job % no tiene el x-cron-secret con la forma esperada: no se cambia nada', v_id;
  end if;

  perform cron.alter_job(job_id := v_id, command := v_nuevo);
  raise notice 'Job % (resumen-cartera-diario) actualizado: x-cron-secret desde Vault', v_id;
end
$$;
