WITH refs AS (
  SELECT url AS u FROM archivos
  UNION SELECT url FROM planos
  UNION SELECT url FROM libro_obra_fotos
  UNION SELECT url FROM observacion_fotos
  UNION SELECT archivo_url FROM observacion_respuestas
  UNION SELECT url FROM formatos_calidad_fotos
  UNION SELECT url FROM planilla_archivos
  UNION SELECT url FROM solicitud_archivos
  UNION SELECT archivo_url FROM solicitud_respuestas
  UNION SELECT archivo_url FROM mensajes_chat
  UNION SELECT archivo_url FROM ensayos
  UNION SELECT archivo_url FROM ordenes_cambio
  UNION SELECT archivo_url FROM garantias
  UNION SELECT archivo_url FROM actas_recepcion
  UNION SELECT foto_url FROM sst_epp_entregas
  UNION SELECT material_url FROM sst_capacitaciones
  UNION SELECT foto_url FROM sst_incidentes
  UNION SELECT foto_url FROM gdm_equipos
  UNION SELECT url FROM gdm_equipos_documentos
  UNION SELECT foto_url FROM gdm_lecturas_horometro
  UNION SELECT evidencia_url FROM gdm_mantenimientos_historial
  UNION SELECT foto_falla_url FROM gdm_mantenimientos_programados
),
paths AS (
  SELECT DISTINCT regexp_replace(split_part(u, '/object/public/', 2), '^[^/]+/', '') AS p
  FROM refs WHERE u IS NOT NULL AND u LIKE '%/object/public/%'
)
SELECT o.bucket_id,
       count(*) AS huerfanos,
       pg_size_pretty(sum(coalesce((o.metadata->>'size')::bigint,0))) AS peso,
       count(*) FILTER (WHERE o.created_at < now() - interval '30 days') AS mas_de_30_dias
FROM storage.objects o
WHERE o.bucket_id IN ('hidivo-fotos','hidivo-archivos')
  AND replace(o.name, '%20', ' ') NOT IN (SELECT replace(p, '%20', ' ') FROM paths)
  AND o.name NOT IN (SELECT p FROM paths)
GROUP BY o.bucket_id;