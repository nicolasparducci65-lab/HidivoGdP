-- ============================================================================
-- Cron «resumen-cartera-diario»: añade la cabecera Authorization a la llamada,
-- con la clave leída de Vault en cada corrida.
-- SIN APLICAR. Solo guarda un secreto en Vault y cambia el comando de ESE job
-- de pg_cron; no toca la función resumen-cartera, ni su verify_jwt, ni ningún
-- otro job. La aplica el rol dueño de la base (postgres): en el SQL Editor, o
-- con «supabase db query --linked -f».
--
-- ORDEN OBLIGATORIO: aplicar DESPUÉS de desplegar la función resumen-cartera
-- que limita los destinatarios a los admins (RESUMEN_CARTERA_DESTINATARIOS).
-- Con la versión 7 (la desplegada el 21-nov-2026), en cuanto el cron funcione
-- el resumen llegaría también a todos los fiscalizadores.
--
-- Por qué (diagnóstico del 27-nov-2026):
--   El job llama a /functions/v1/resumen-cartera solo con Content-Type y
--   x-cron-secret. La función está desplegada con verify_jwt = true, y la puerta
--   de Supabase rechaza toda petición sin Authorization con
--   401 UNAUTHORIZED_NO_AUTH_HEADER ANTES de ejecutar el código: el secreto del
--   cron ni se llega a comparar. Por eso el job figura «succeeded» (solo indica
--   que pg_net encoló la petición) y no hay ninguna notificación
--   «resumen_cartera» creada a las 07:00; las que existen son de «Generar ahora».
--
-- Qué hace:
--   1) Guarda en Vault el secreto «resumen_cartera_authorization» con la clave
--      publicable del proyecto (la misma que ya es pública en index.html,
--      SUPABASE_KEY). Si el secreto ya existe, NO lo toca.
--   2) Inserta en las cabeceras del job
--        'Authorization','Bearer ' || (select … from vault.decrypted_secrets …)
--      de modo que la clave se lee de Vault en CADA corrida y NO queda escrita
--      en cron.job. La clave solo pasa la puerta; la función sigue autorizando
--      por x-cron-secret, que no se toca.
--   3) Añade timeout_milliseconds := 60000. El valor por defecto de pg_net es
--      5 s y la función tarda más (llamada al modelo y notificaciones); con 5 s
--      la respuesta quedaría anotada como «timed out» en net._http_response.
--
-- El secreto del cron NO aparece en este archivo: el comando nuevo se arma a
-- partir del comando actual, tal como esté guardado en cron.job.
--
-- Seguro de repetir: si el comando ya manda Authorization, no cambia el job. Si
-- el comando no tiene la forma esperada, LANZA y no cambia nada (tampoco Vault:
-- el bloque es una sola transacción).
--
-- Si alguien borra el secreto de Vault, la cabecera sale vacía y la puerta
-- vuelve a responder 401 (se ve en net._http_response); no se envía nada.
-- Al rotar la clave publicable:
--   select vault.update_secret((select id from vault.secrets where name = 'resumen_cartera_authorization'), '<clave nueva>');
--
-- Efecto al aplicarla: desde la siguiente corrida (lunes a sábado, 07:00 de
-- Ecuador = 12:00 UTC) el resumen SÍ se envía, por notificación y push, a los
-- destinatarios que decida la función (hoy, con la función nueva: solo admins).
--
-- Comprobación posterior (la respuesta se guarda 6 horas):
--   select created, status_code, timed_out, left(content, 300)
--     from net._http_response order by created desc limit 5;
--   -- esperado: 200 y {"ok":true,"proyectos":…,"grupos":1,"entregados":1,"destinatarios":"admins","errores":[]}
--   select perfil_id, created_at from notificaciones
--    where tipo = 'resumen_cartera' and created_at > now() - interval '1 hour';
--
-- Para deshacer: cron.alter_job con el comando anterior (quitar del comando la
-- pareja 'Authorization','Bearer ' || (…), y el «, timeout_milliseconds := 60000»)
-- y, si se quiere, delete from vault.secrets where name = 'resumen_cartera_authorization';
--
-- Pendiente aparte, fuera de esta migración: el secreto del cron sigue en texto
-- plano dentro del comando (convendría pasarlo también a Vault), y el job
-- «gdm-alertas-mantenimiento» tiene el mismo defecto de la cabecera.
-- ============================================================================

do $$
declare
  v_id      bigint;
  v_cmd     text;
  v_nuevo   text;
  v_previo  text;
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

  -- 1) La clave, a Vault (solo si no está).
  if not exists (select 1 from vault.secrets where name = 'resumen_cartera_authorization') then
    perform vault.create_secret(
      'sb_publishable_KofUOOKhYd2a6g6O1_4g0w_LYAgjebm',
      'resumen_cartera_authorization',
      'clave publicable para la cabecera Authorization del cron resumen-cartera-diario');
  end if;

  if v_cmd ~* 'authorization' then
    raise notice 'El job % ya manda Authorization: no se cambia el comando', v_id;
    return;
  end if;

  -- 2) Cabecera Authorization leída de Vault en cada corrida, tras Content-Type.
  v_nuevo := replace(
    v_cmd,
    $a$'Content-Type','application/json',$a$,
    $b$'Content-Type','application/json','Authorization','Bearer ' || (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'resumen_cartera_authorization'),$b$
  );
  if v_nuevo = v_cmd then
    raise exception 'El comando del job % no tiene las cabeceras con la forma esperada: no se cambia nada', v_id;
  end if;

  -- 3) Tiempo de espera de 60 s, tras el cuerpo.
  v_previo := v_nuevo;
  v_nuevo := regexp_replace(
    v_nuevo,
    $r$(body\s*:=\s*'\{\}'::jsonb)\s*\)$r$,
    $s$\1,
       timeout_milliseconds := 60000 )$s$
  );
  if v_nuevo = v_previo then
    raise exception 'El comando del job % no tiene el cuerpo con la forma esperada: no se cambia nada', v_id;
  end if;

  perform cron.alter_job(job_id := v_id, command := v_nuevo);
  raise notice 'Job % (resumen-cartera-diario) actualizado', v_id;
end
$$;
