BEGIN;

CREATE TABLE IF NOT EXISTS public.ledger_v2_runtime_controls (
  control_key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_v2_runtime_controls_key_check
    CHECK (control_key = 'LEGACY_BALANCE_MIRROR'),
  CONSTRAINT ledger_v2_runtime_controls_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

INSERT INTO public.ledger_v2_runtime_controls (control_key, enabled, metadata)
VALUES ('LEGACY_BALANCE_MIRROR', false, '{"installedBy":"phase4.1"}'::jsonb)
ON CONFLICT (control_key) DO NOTHING;

CREATE OR REPLACE VIEW public.ledger_v2_legacy_live_reconciliation
WITH (security_invoker = true) AS
WITH current_sources AS (
  SELECT
    source_kind,
    source_id,
    source_owner_ref,
    currency,
    account_key,
    legacy_balance
  FROM public.ledger_v2_legacy_source_candidates
),
mapped_sources AS (
  SELECT
    m.source_kind,
    m.source_id,
    m.source_owner_ref,
    m.currency,
    m.account_key,
    m.ledger_account_id,
    b.balance::numeric(38, 12) AS ledger_balance
  FROM public.ledger_legacy_account_map_v2 AS m
  LEFT JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = m.ledger_account_id
)
SELECT
  COALESCE(c.source_kind, m.source_kind) AS source_kind,
  COALESCE(c.source_id, m.source_id) AS source_id,
  c.source_owner_ref AS current_owner_ref,
  m.source_owner_ref AS mapped_owner_ref,
  c.currency AS current_currency,
  m.currency AS mapped_currency,
  c.account_key AS current_account_key,
  m.account_key AS mapped_account_key,
  m.ledger_account_id,
  c.legacy_balance::numeric(38, 12) AS legacy_balance,
  m.ledger_balance,
  CASE
    WHEN c.source_id IS NULL THEN 'ORPHAN_MAPPING'
    WHEN m.source_id IS NULL THEN 'UNMAPPED_SOURCE'
    WHEN m.ledger_account_id IS NULL OR m.ledger_balance IS NULL THEN 'LEDGER_ACCOUNT_MISSING'
    WHEN c.source_owner_ref IS DISTINCT FROM m.source_owner_ref
      OR c.currency IS DISTINCT FROM m.currency
      OR c.account_key IS DISTINCT FROM m.account_key
      THEN 'IDENTITY_MISMATCH'
    WHEN c.legacy_balance IS DISTINCT FROM m.ledger_balance THEN 'BALANCE_MISMATCH'
    ELSE 'MATCHED'
  END AS reconciliation_status,
  CASE
    WHEN c.legacy_balance IS NULL OR m.ledger_balance IS NULL THEN NULL
    ELSE (c.legacy_balance - m.ledger_balance)::numeric(38, 12)
  END AS difference
FROM current_sources AS c
FULL OUTER JOIN mapped_sources AS m
  ON m.source_kind = c.source_kind
 AND m.source_id = c.source_id;

CREATE OR REPLACE FUNCTION public.ledger_v2_legacy_balance_mirror_enabled()
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT COALESCE((
    SELECT enabled
    FROM public.ledger_v2_runtime_controls
    WHERE control_key = 'LEGACY_BALANCE_MIRROR'
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.set_legacy_balance_mirror_v2(
  p_enabled boolean,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_enabled boolean := COALESCE(p_enabled, false);
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
  v_bad_count integer;
  v_mapping jsonb;
  v_currency text;
  v_bridge_id uuid;
BEGIN
  IF jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_INVALID_METADATA'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('ledger_v2_legacy_balance_mirror_control', 0)
  );

  IF v_enabled THEN
    IF (SELECT count(*) FROM public.ledger_legacy_opening_cutovers_v2) <> 1 THEN
      RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_OPENING_NOT_COMPLETED'
        USING ERRCODE = 'P0001';
    END IF;

    v_mapping := public.materialize_legacy_account_mappings_v2();

    FOR v_currency IN
      SELECT DISTINCT currency
      FROM public.ledger_v2_legacy_source_candidates
      ORDER BY currency
    LOOP
      v_bridge_id := public.ensure_ledger_account_v2(
        'LEGACY_MIRROR_BRIDGE:' || v_currency,
        'LEGACY_MIRROR_BRIDGE',
        'SYSTEM',
        'LEGACY_MIRROR',
        v_currency,
        true,
        jsonb_build_object(
          'purpose', 'temporary legacy balance mirror bridge',
          'phase', '4.1'
        )
      );

      IF v_bridge_id IS NULL THEN
        RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_BRIDGE_CREATE_FAILED'
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    SELECT count(*) INTO v_bad_count
    FROM public.ledger_v2_legacy_live_reconciliation
    WHERE reconciliation_status <> 'MATCHED'
       OR difference IS DISTINCT FROM 0::numeric;

    IF v_bad_count <> 0 THEN
      RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_RECONCILIATION_FAILED'
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object('badRows', v_bad_count)::text;
    END IF;
  END IF;

  UPDATE public.ledger_v2_runtime_controls
  SET enabled = v_enabled,
      metadata = v_metadata,
      updated_at = now()
  WHERE control_key = 'LEGACY_BALANCE_MIRROR';

  IF NOT FOUND THEN
    INSERT INTO public.ledger_v2_runtime_controls (
      control_key,
      enabled,
      metadata
    ) VALUES (
      'LEGACY_BALANCE_MIRROR',
      v_enabled,
      v_metadata
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'controlKey', 'LEGACY_BALANCE_MIRROR',
    'enabled', v_enabled,
    'metadata', v_metadata
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mirror_legacy_balance_change_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_source_kind text := TG_ARGV[0];
  v_source_id uuid;
  v_currency text;
  v_old_balance numeric(38, 12);
  v_new_balance numeric(38, 12);
  v_delta numeric(38, 12);
  v_mapping public.ledger_legacy_account_map_v2%ROWTYPE;
  v_ledger_balance numeric(38, 12);
  v_bridge_id uuid;
  v_bridge_balance numeric(38, 12);
  v_entries jsonb;
  v_post_result jsonb;
  v_idempotency_key text;
BEGIN
  IF public.ledger_v2_legacy_balance_mirror_enabled() IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_source_id := NEW.id;
    v_currency := upper(NEW.currency);
    v_old_balance := 0;
    v_new_balance := NEW.balance::numeric(38, 12);
  ELSIF TG_OP = 'UPDATE' THEN
    v_source_id := NEW.id;
    v_currency := upper(NEW.currency);
    v_old_balance := OLD.balance::numeric(38, 12);
    v_new_balance := NEW.balance::numeric(38, 12);
  ELSE
    RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_UNSUPPORTED_TRIGGER_OP'
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.materialize_legacy_account_mappings_v2();
  END IF;

  SELECT * INTO v_mapping
  FROM public.ledger_legacy_account_map_v2
  WHERE source_kind = v_source_kind
    AND source_id = v_source_id;

  IF NOT FOUND THEN
    PERFORM public.materialize_legacy_account_mappings_v2();

    SELECT * INTO v_mapping
    FROM public.ledger_legacy_account_map_v2
    WHERE source_kind = v_source_kind
      AND source_id = v_source_id;
  END IF;

  IF v_mapping.ledger_account_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_MAPPING_MISSING'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'sourceKind', v_source_kind,
              'sourceId', v_source_id
            )::text;
  END IF;

  IF v_mapping.currency IS DISTINCT FROM v_currency THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_MAPPING_CURRENCY_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT balance::numeric(38, 12)
  INTO v_ledger_balance
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_mapping.ledger_account_id;

  IF v_ledger_balance IS NULL
     OR v_ledger_balance IS DISTINCT FROM v_old_balance THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_PRE_BALANCE_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'sourceKind', v_source_kind,
              'sourceId', v_source_id,
              'legacyBefore', v_old_balance,
              'ledgerBefore', v_ledger_balance
            )::text;
  END IF;

  v_delta := (v_new_balance - v_old_balance)::numeric(38, 12);

  IF v_delta = 0 THEN
    RETURN NEW;
  END IF;

  v_bridge_id := public.ensure_ledger_account_v2(
    'LEGACY_MIRROR_BRIDGE:' || v_currency,
    'LEGACY_MIRROR_BRIDGE',
    'SYSTEM',
    'LEGACY_MIRROR',
    v_currency,
    true,
    jsonb_build_object(
      'purpose', 'temporary legacy balance mirror bridge',
      'phase', '4.1'
    )
  );

  v_idempotency_key := gen_random_uuid()::text;

  v_entries := jsonb_build_array(
    jsonb_build_object(
      'accountId', v_mapping.ledger_account_id,
      'currency', v_currency,
      'amountDelta', v_delta,
      'description', 'Legacy balance mirror source delta',
      'metadata', jsonb_build_object(
        'mirrorRole', 'SOURCE',
        'sourceKind', v_source_kind,
        'sourceId', v_source_id,
        'operation', TG_OP,
        'legacyBefore', v_old_balance,
        'legacyAfter', v_new_balance
      )
    ),
    jsonb_build_object(
      'accountId', v_bridge_id,
      'currency', v_currency,
      'amountDelta', -v_delta,
      'description', 'Legacy balance mirror bridge delta',
      'metadata', jsonb_build_object(
        'mirrorRole', 'BRIDGE',
        'sourceKind', v_source_kind,
        'sourceId', v_source_id,
        'operation', TG_OP
      )
    )
  );

  v_post_result := public.post_ledger_journal_v2(
    'LEGACY_BALANCE_MIRROR',
    v_source_kind || ':' || v_source_id::text,
    v_idempotency_key,
    'Mirror legacy balance delta',
    jsonb_build_object(
      'sourceKind', v_source_kind,
      'sourceId', v_source_id,
      'currency', v_currency,
      'operation', TG_OP,
      'legacyBefore', v_old_balance,
      'legacyAfter', v_new_balance,
      'delta', v_delta,
      'txid', txid_current()::text
    ),
    v_entries
  );

  IF COALESCE((v_post_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_POST_FAILED'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT balance::numeric(38, 12)
  INTO v_ledger_balance
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_mapping.ledger_account_id;

  IF v_ledger_balance IS DISTINCT FROM v_new_balance THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_POST_BALANCE_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'sourceKind', v_source_kind,
              'sourceId', v_source_id,
              'legacyAfter', v_new_balance,
              'ledgerAfter', v_ledger_balance
            )::text;
  END IF;

  SELECT balance::numeric(38, 12)
  INTO v_bridge_balance
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_bridge_id;

  IF v_bridge_balance IS NULL THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_BRIDGE_BALANCE_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_legacy_mapped_source_identity_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_source_kind text := TG_ARGV[0];
BEGIN
  IF public.ledger_v2_legacy_balance_mirror_enabled() IS NOT TRUE THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1
      FROM public.ledger_legacy_account_map_v2
      WHERE source_kind = v_source_kind
        AND source_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_SOURCE_DELETE_FORBIDDEN'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF v_source_kind = 'USER_WALLET' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.currency IS DISTINCT FROM OLD.currency THEN
      RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_SOURCE_IDENTITY_IMMUTABLE'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_source_kind = 'MERCHANT_BALANCE' THEN
    IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
       OR NEW.currency IS DISTINCT FROM OLD.currency THEN
      RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_SOURCE_IDENTITY_IMMUTABLE'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ledger_v2_mirror_wallet_insert ON public.wallets;
CREATE TRIGGER ledger_v2_mirror_wallet_insert
AFTER INSERT ON public.wallets
FOR EACH ROW
EXECUTE FUNCTION public.mirror_legacy_balance_change_v2('USER_WALLET');

DROP TRIGGER IF EXISTS ledger_v2_mirror_wallet_balance_update ON public.wallets;
CREATE TRIGGER ledger_v2_mirror_wallet_balance_update
AFTER UPDATE OF balance ON public.wallets
FOR EACH ROW
WHEN (OLD.balance IS DISTINCT FROM NEW.balance)
EXECUTE FUNCTION public.mirror_legacy_balance_change_v2('USER_WALLET');

DROP TRIGGER IF EXISTS ledger_v2_guard_wallet_identity_update ON public.wallets;
CREATE TRIGGER ledger_v2_guard_wallet_identity_update
BEFORE UPDATE OF user_id, currency ON public.wallets
FOR EACH ROW
EXECUTE FUNCTION public.guard_legacy_mapped_source_identity_v2('USER_WALLET');

DROP TRIGGER IF EXISTS ledger_v2_guard_wallet_delete ON public.wallets;
CREATE TRIGGER ledger_v2_guard_wallet_delete
BEFORE DELETE ON public.wallets
FOR EACH ROW
EXECUTE FUNCTION public.guard_legacy_mapped_source_identity_v2('USER_WALLET');

DROP TRIGGER IF EXISTS ledger_v2_mirror_merchant_balance_insert ON public.merchant_balances;
CREATE TRIGGER ledger_v2_mirror_merchant_balance_insert
AFTER INSERT ON public.merchant_balances
FOR EACH ROW
EXECUTE FUNCTION public.mirror_legacy_balance_change_v2('MERCHANT_BALANCE');

DROP TRIGGER IF EXISTS ledger_v2_mirror_merchant_balance_update ON public.merchant_balances;
CREATE TRIGGER ledger_v2_mirror_merchant_balance_update
AFTER UPDATE OF balance ON public.merchant_balances
FOR EACH ROW
WHEN (OLD.balance IS DISTINCT FROM NEW.balance)
EXECUTE FUNCTION public.mirror_legacy_balance_change_v2('MERCHANT_BALANCE');

DROP TRIGGER IF EXISTS ledger_v2_guard_merchant_balance_identity_update ON public.merchant_balances;
CREATE TRIGGER ledger_v2_guard_merchant_balance_identity_update
BEFORE UPDATE OF merchant_id, currency ON public.merchant_balances
FOR EACH ROW
EXECUTE FUNCTION public.guard_legacy_mapped_source_identity_v2('MERCHANT_BALANCE');

DROP TRIGGER IF EXISTS ledger_v2_guard_merchant_balance_delete ON public.merchant_balances;
CREATE TRIGGER ledger_v2_guard_merchant_balance_delete
BEFORE DELETE ON public.merchant_balances
FOR EACH ROW
EXECUTE FUNCTION public.guard_legacy_mapped_source_identity_v2('MERCHANT_BALANCE');

ALTER TABLE public.ledger_v2_runtime_controls ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.ledger_v2_runtime_controls,
  public.ledger_v2_legacy_live_reconciliation
FROM PUBLIC;

REVOKE ALL ON FUNCTION public.ledger_v2_legacy_balance_mirror_enabled() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_legacy_balance_mirror_v2(boolean, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mirror_legacy_balance_change_v2() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_legacy_mapped_source_identity_v2() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ledger_v2_runtime_controls, public.ledger_v2_legacy_live_reconciliation FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.ledger_v2_legacy_balance_mirror_enabled() FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.set_legacy_balance_mirror_v2(boolean, jsonb) FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ledger_v2_runtime_controls, public.ledger_v2_legacy_live_reconciliation FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.ledger_v2_legacy_balance_mirror_enabled() FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.set_legacy_balance_mirror_v2(boolean, jsonb) FROM authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ledger_v2_runtime_controls, public.ledger_v2_legacy_live_reconciliation FROM service_role';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.ledger_v2_legacy_balance_mirror_enabled() FROM service_role';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.set_legacy_balance_mirror_v2(boolean, jsonb) FROM service_role';
  END IF;
END;
$$;

COMMENT ON TABLE public.ledger_v2_runtime_controls IS
  'Operator-only runtime controls for Ledger v2 migration. LEGACY_BALANCE_MIRROR is installed disabled and cannot be controlled by app roles.';
COMMENT ON VIEW public.ledger_v2_legacy_live_reconciliation IS
  'Live Phase 4 reconciliation of each legacy wallet/merchant balance against its mapped Ledger v2 account.';
COMMENT ON FUNCTION public.set_legacy_balance_mirror_v2(boolean, jsonb) IS
  'Operator-only fail-closed switch for the temporary legacy balance mirror. Enabling requires exact legacy-to-ledger reconciliation.';
COMMENT ON FUNCTION public.mirror_legacy_balance_change_v2() IS
  'Trigger function that atomically mirrors each legacy balance delta into Ledger v2 against a temporary per-currency bridge account.';

COMMIT;
