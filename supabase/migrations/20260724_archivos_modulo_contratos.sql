-- Permitir el módulo 'contratos' en archivos (para los PDF de contrato que se
-- suben desde la sección Contrato y se extraen con IA).
-- Se recrea la restricción conservando todos los valores previos + 'contratos'.
alter table archivos drop constraint archivos_modulo_check;
alter table archivos add constraint archivos_modulo_check
  check (modulo = any (array['libro_obra','rubros','fiscalizacion','general','curva_s','curvaS','contratos']::text[]));
