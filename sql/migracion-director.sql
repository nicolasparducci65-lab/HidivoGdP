-- PUNTO 3 (PERMISOS.md I-1): migrar las membresías con rol fantasma 'director'
-- al rol 'fiscalizador' (el rol de proyecto más alto que existe en los mapas
-- de acceso). El código ya no escribe 'director' desde el commit 0c3a5dc.
--
-- Estado verificado el 2026-07-28: 14 filas, todas de nparducci@hidivo.com
-- (admin global, por lo que el rol de membresía nunca le afectó en la práctica).
--
-- Verificación previa:
SELECT pm.id, pe.email, p.nombre AS proyecto, pm.rol
FROM proyecto_miembros pm
LEFT JOIN perfiles pe ON pe.id = pm.usuario_id
LEFT JOIN proyectos p ON p.id = pm.proyecto_id
WHERE pm.rol = 'director';

-- Migración (14 filas esperadas):
UPDATE proyecto_miembros SET rol = 'fiscalizador' WHERE rol = 'director';

-- Comprobación posterior (debe devolver 0):
SELECT count(*) FROM proyecto_miembros WHERE rol = 'director';
