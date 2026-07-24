-- Extracción automática de contratos: columna cajón para los datos extraídos
-- del PDF que no tienen columna propia (fiscalizador, plazo, multas, cláusulas,
-- notas de anticipo, y cualquier dato_no_mapeado que devuelva el modelo).
alter table proyectos add column if not exists contrato_datos jsonb;
