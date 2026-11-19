BEGIN;

-- No elegir silenciosamente una version si existen datos historicos ambiguos.
DO $$
BEGIN
  IF EXISTS (
    SELECT capability FROM prompt_versions WHERE active = true
    GROUP BY capability HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay varios prompts activos para una capacidad. Activa la version elegida por API antes de aplicar esta migracion.';
  END IF;
END $$;

ALTER TABLE prompt_versions ALTER COLUMN active SET DEFAULT false;

CREATE UNIQUE INDEX prompt_versions_one_active_per_capability_idx
ON prompt_versions (capability) WHERE active = true;

COMMIT;
