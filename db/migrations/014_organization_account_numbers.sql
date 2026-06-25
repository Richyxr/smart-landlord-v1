-- Landlord organization account numbers.
-- These stable references are reserved for future platform billing payment flows.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS account_number TEXT;

CREATE SEQUENCE IF NOT EXISTS organization_account_number_seq START WITH 1;

CREATE OR REPLACE FUNCTION next_organization_account_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  candidate TEXT;
BEGIN
  LOOP
    candidate := 'SL-ORG-' || LPAD(nextval('organization_account_number_seq')::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM organizations
      WHERE UPPER(account_number) = UPPER(candidate)
    );
  END LOOP;

  RETURN candidate;
END;
$$;

UPDATE organizations
SET account_number = UPPER(BTRIM(account_number))
WHERE account_number IS NOT NULL
  AND account_number <> UPPER(BTRIM(account_number));

DO $$
DECLARE
  max_suffix BIGINT;
BEGIN
  SELECT GREATEST(
    COALESCE(MAX(id), 0),
    COALESCE(MAX(NULLIF(SUBSTRING(account_number FROM '^SL-ORG-([0-9]+)$'), '')::BIGINT), 0)
  )
  INTO max_suffix
  FROM organizations;

  IF max_suffix > 0 THEN
    PERFORM setval('organization_account_number_seq', max_suffix, TRUE);
  ELSE
    PERFORM setval('organization_account_number_seq', 1, FALSE);
  END IF;
END;
$$;

DO $$
DECLARE
  org_record RECORD;
  candidate TEXT;
BEGIN
  FOR org_record IN
    SELECT id
    FROM organizations
    WHERE account_number IS NULL OR BTRIM(account_number) = ''
    ORDER BY id
  LOOP
    candidate := 'SL-ORG-' || LPAD(org_record.id::TEXT, 6, '0');

    IF EXISTS (
      SELECT 1
      FROM organizations
      WHERE id <> org_record.id
        AND UPPER(account_number) = UPPER(candidate)
    ) THEN
      candidate := next_organization_account_number();
    END IF;

    UPDATE organizations
    SET account_number = candidate,
        updated_at = now()
    WHERE id = org_record.id;
  END LOOP;
END;
$$;

DO $$
DECLARE
  max_suffix BIGINT;
BEGIN
  SELECT COALESCE(MAX(NULLIF(SUBSTRING(account_number FROM '^SL-ORG-([0-9]+)$'), '')::BIGINT), 0)
  INTO max_suffix
  FROM organizations;

  IF max_suffix > 0 THEN
    PERFORM setval('organization_account_number_seq', max_suffix, TRUE);
  ELSE
    PERFORM setval('organization_account_number_seq', 1, FALSE);
  END IF;
END;
$$;

ALTER TABLE organizations
  ALTER COLUMN account_number SET DEFAULT next_organization_account_number(),
  ALTER COLUMN account_number SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organizations_account_number_not_blank'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_account_number_not_blank
      CHECK (BTRIM(account_number) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organizations_account_number_format'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_account_number_format
      CHECK (account_number ~ '^SL-ORG-[0-9]{6,}$');
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_account_number_upper_unique
  ON organizations (UPPER(account_number));

COMMENT ON COLUMN organizations.account_number IS 'Stable system-generated account reference for landlord organizations.';
