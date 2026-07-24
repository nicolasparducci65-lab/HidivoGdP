-- Las garantías pueden registrarse sin fecha de vencimiento (la póliza suele
-- llegar después de firmado el contrato). La fecha se completa al editarlas.
alter table garantias alter column vigencia_hasta drop not null;
