BEGIN;

-- Phase 6: production agent / exchange-desk operating controls.
-- Money movement remains exclusively inside the existing native Ledger v2
-- agent primitives. This layer adds lifecycle, product, compliance and limit
-- controls without introducing a second balance system.

CREATE TABLE public.agent_desks_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id uuid NOT NULL UNIQUE REFERENCES public.users(id),
  desk_code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  country_code text NOT NULL DEFAULT 'SS',
  city text,
  address_line text,
  status text NOT NULL DEFAULT 'pending',
  created_by_admin_user_id uuid REFERENCES public.users(id),
  updated_by_admin_user_id uuid REFERENCES public.users(id),
  activated_at timestamptz,
  suspended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_desks_v1_code_format CHECK (desk_code ~ '^AG-[A-Z0-9]{8,20}$'),
  CONSTRAINT agent_desks_v1_country_format CHECK (country_code ~ '^[A-Z]{2,10}$'),
  CONSTRAINT agent_desks_v1_status_check CHECK (status IN ('pending','active','suspended','closed')),
  CONSTRAINT agent_desks_v1_display_name_check CHECK (length(btrim(display_name)) BETWEEN 2 AND 120),
  CONSTRAINT agent_desks_v1_city_check CHECK (city IS NULL OR length(city) <= 120),
  CONSTRAINT agent_desks_v1_address_check CHECK (address_line IS NULL OR length(address_line) <= 300)
);

CREATE INDEX agent_desks_v1_status_idx
  ON public.agent_desks_v1(status, country_code);

CREATE TABLE public.agent_desk_capabilities_v1 (
  desk_id uuid NOT NULL REFERENCES public.agent_desks_v1(id) ON DELETE CASCADE,
  currency text NOT NULL,
  cash_in_enabled boolean NOT NULL DEFAULT false,
  cash_out_enabled boolean NOT NULL DEFAULT false,
  min_tx_amount numeric(38,12) NOT NULL DEFAULT 1,
  max_tx_amount numeric(38,12),
  daily_cash_in_limit numeric(38,12),
  daily_cash_out_limit numeric(38,12),
  updated_by_admin_user_id uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (desk_id, currency),
  CONSTRAINT agent_desk_capabilities_v1_currency_format CHECK (currency ~ '^[A-Z0-9]{3,10}$'),
  CONSTRAINT agent_desk_capabilities_v1_min_positive CHECK (min_tx_amount > 0),
  CONSTRAINT agent_desk_capabilities_v1_max_valid CHECK (max_tx_amount IS NULL OR max_tx_amount >= min_tx_amount),
  CONSTRAINT agent_desk_capabilities_v1_cash_in_limit CHECK (
    cash_in_enabled IS FALSE OR (daily_cash_in_limit IS NOT NULL AND daily_cash_in_limit > 0)
  ),
  CONSTRAINT agent_desk_capabilities_v1_cash_out_limit CHECK (
    cash_out_enabled IS FALSE OR (daily_cash_out_limit IS NOT NULL AND daily_cash_out_limit > 0)
  )
);

CREATE INDEX agent_desk_capabilities_v1_enabled_idx
  ON public.agent_desk_capabilities_v1(currency, cash_in_enabled, cash_out_enabled);

CREATE OR REPLACE FUNCTION public.admin_set_agent_desk_capability_v1(
  p_admin_user_id uuid,
  p_agent_user_id uuid,
  p_currency text,
  p_cash_in_enabled boolean,
  p_cash_out_enabled boolean,
  p_min_tx_amount numeric,
  p_max_tx_amount numeric,
  p_daily_cash_in_limit numeric,
  p_daily_cash_out_limit numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_admin_role text;
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
  v_desk public.agent_desks_v1%ROWTYPE;
  v_cap public.agent_desk_capabilities_v1%ROWTYPE;
BEGIN
  SELECT role INTO v_admin_role
  FROM public.users
  WHERE id = p_admin_user_id
    AND COALESCE(is_active, true) = true
    AND COALESCE(is_system, false) = false;

  IF v_admin_role NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'AGENT_DESK_ADMIN_NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_desk
  FROM public.agent_desks_v1
  WHERE agent_user_id = p_agent_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AGENT_DESK_NOT_FOUND' USING ERRCODE='P0001';
  END IF;

  IF v_currency !~ '^[A-Z0-9]{3,10}$' THEN
    RAISE EXCEPTION 'AGENT_DESK_INVALID_CURRENCY' USING ERRCODE='P0001';
  END IF;

  IF p_min_tx_amount IS NULL OR p_min_tx_amount <= 0
     OR (p_max_tx_amount IS NOT NULL AND p_max_tx_amount < p_min_tx_amount) THEN
    RAISE EXCEPTION 'AGENT_DESK_INVALID_TX_LIMITS' USING ERRCODE='P0001';
  END IF;

  IF COALESCE(p_cash_in_enabled, false) = true
     AND (p_daily_cash_in_limit IS NULL OR p_daily_cash_in_limit <= 0) THEN
    RAISE EXCEPTION 'AGENT_DESK_INVALID_CASH_IN_DAILY_LIMIT' USING ERRCODE='P0001';
  END IF;

  IF COALESCE(p_cash_out_enabled, false) = true
     AND (p_daily_cash_out_limit IS NULL OR p_daily_cash_out_limit <= 0) THEN
    RAISE EXCEPTION 'AGENT_DESK_INVALID_CASH_OUT_DAILY_LIMIT' USING ERRCODE='P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.country_products cp
    WHERE cp.country_code = v_desk.country_code
      AND cp.currency = v_currency
  ) THEN
    RAISE EXCEPTION 'AGENT_DESK_PRODUCT_NOT_CONFIGURED' USING ERRCODE='P0001';
  END IF;

  IF COALESCE(p_cash_in_enabled, false) = true AND NOT EXISTS (
    SELECT 1
    FROM public.country_products cp
    JOIN public.product_capabilities pc
      ON pc.country_code = cp.country_code
     AND pc.currency = cp.currency
    WHERE cp.country_code = v_desk.country_code
      AND cp.currency = v_currency
      AND cp.enabled = true
      AND pc.capability = 'CASH_IN'
      AND pc.enabled = true
  ) THEN
    RAISE EXCEPTION 'AGENT_DESK_CASH_IN_PRODUCT_DISABLED' USING ERRCODE='P0001';
  END IF;

  IF COALESCE(p_cash_out_enabled, false) = true AND NOT EXISTS (
    SELECT 1
    FROM public.country_products cp
    JOIN public.product_capabilities pc
      ON pc.country_code = cp.country_code
     AND pc.currency = cp.currency
    WHERE cp.country_code = v_desk.country_code
      AND cp.currency = v_currency
      AND cp.enabled = true
      AND pc.capability = 'CASH_OUT'
      AND pc.enabled = true
  ) THEN
    RAISE EXCEPTION 'AGENT_DESK_CASH_OUT_PRODUCT_DISABLED' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.agent_desk_capabilities_v1(
    desk_id, currency, cash_in_enabled, cash_out_enabled,
    min_tx_amount, max_tx_amount, daily_cash_in_limit, daily_cash_out_limit,
    updated_by_admin_user_id, updated_at
  ) VALUES (
    v_desk.id, v_currency,
    COALESCE(p_cash_in_enabled, false), COALESCE(p_cash_out_enabled, false),
    p_min_tx_amount, p_max_tx_amount, p_daily_cash_in_limit, p_daily_cash_out_limit,
    p_admin_user_id, now()
  )
  ON CONFLICT(desk_id, currency) DO UPDATE SET
    cash_in_enabled = EXCLUDED.cash_in_enabled,
    cash_out_enabled = EXCLUDED.cash_out_enabled,
    min_tx_amount = EXCLUDED.min_tx_amount,
    max_tx_amount = EXCLUDED.max_tx_amount,
    daily_cash_in_limit = EXCLUDED.daily_cash_in_limit,
    daily_cash_out_limit = EXCLUDED.daily_cash_out_limit,
    updated_by_admin_user_id = EXCLUDED.updated_by_admin_user_id,
    updated_at = now()
  RETURNING * INTO v_cap;

  UPDATE public.agent_desks_v1
  SET updated_by_admin_user_id = p_admin_user_id,
      updated_at = now()
  WHERE id = v_desk.id;

  RETURN jsonb_build_object('ok', true, 'capability', to_jsonb(v_cap));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_agent_desk_v1(
  p_admin_user_id uuid,
  p_agent_user_id uuid,
  p_display_name text,
  p_country_code text DEFAULT 'SS',
  p_city text DEFAULT NULL,
  p_address_line text DEFAULT NULL,
  p_status text DEFAULT 'pending'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_admin_role text;
  v_target public.users%ROWTYPE;
  v_status text := lower(btrim(COALESCE(p_status, 'pending')));
  v_country text := upper(btrim(COALESCE(p_country_code, 'SS')));
  v_display text := btrim(COALESCE(p_display_name, ''));
  v_city text := NULLIF(btrim(COALESCE(p_city, '')), '');
  v_address text := NULLIF(btrim(COALESCE(p_address_line, '')), '');
  v_desk public.agent_desks_v1%ROWTYPE;
BEGIN
  SELECT role INTO v_admin_role
  FROM public.users
  WHERE id = p_admin_user_id
    AND COALESCE(is_active, true) = true
    AND COALESCE(is_system, false) = false;

  IF v_admin_role NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'AGENT_DESK_ADMIN_NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_target
  FROM public.users
  WHERE id = p_agent_user_id
  FOR UPDATE;

  IF NOT FOUND OR COALESCE(v_target.is_system, false) = true
     OR v_target.role NOT IN ('user','agent') THEN
    RAISE EXCEPTION 'AGENT_DESK_USER_NOT_ELIGIBLE' USING ERRCODE='P0001';
  END IF;

  IF length(v_display) < 2 OR length(v_display) > 120
     OR (v_city IS NOT NULL AND length(v_city) > 120)
     OR (v_address IS NOT NULL AND length(v_address) > 300) THEN
    RAISE EXCEPTION 'AGENT_DESK_INVALID_PROFILE' USING ERRCODE='P0001';
  END IF;

  IF v_country !~ '^[A-Z]{2,10}$' OR v_status NOT IN ('pending','active','suspended','closed') THEN
    RAISE EXCEPTION 'AGENT_DESK_INVALID_PROFILE' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.agent_desks_v1(
    agent_user_id, desk_code, display_name, country_code, city, address_line,
    status, created_by_admin_user_id, updated_by_admin_user_id,
    activated_at, suspended_at
  ) VALUES (
    p_agent_user_id,
    'AG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    v_display, v_country, v_city, v_address, v_status,
    p_admin_user_id, p_admin_user_id,
    CASE WHEN v_status = 'active' THEN now() ELSE NULL END,
    CASE WHEN v_status = 'suspended' THEN now() ELSE NULL END
  )
  ON CONFLICT(agent_user_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    country_code = EXCLUDED.country_code,
    city = EXCLUDED.city,
    address_line = EXCLUDED.address_line,
    status = EXCLUDED.status,
    updated_by_admin_user_id = p_admin_user_id,
    activated_at = CASE
      WHEN EXCLUDED.status = 'active' THEN COALESCE(public.agent_desks_v1.activated_at, now())
      ELSE public.agent_desks_v1.activated_at
    END,
    suspended_at = CASE
      WHEN EXCLUDED.status = 'suspended' THEN now()
      WHEN EXCLUDED.status = 'active' THEN NULL
      ELSE public.agent_desks_v1.suspended_at
    END,
    updated_at = now()
  RETURNING * INTO v_desk;

  IF v_status = 'active' THEN
    IF COALESCE(v_target.is_active, true) IS FALSE THEN
      RAISE EXCEPTION 'AGENT_DESK_USER_SUSPENDED' USING ERRCODE='P0001';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.kyc_profiles kp
      WHERE kp.user_id = p_agent_user_id AND kp.status = 'approved'
    ) THEN
      RAISE EXCEPTION 'AGENT_DESK_KYC_REQUIRED' USING ERRCODE='P0001';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.compliance_entity_controls c
      WHERE c.entity_type = 'USER'
        AND c.entity_ref = p_agent_user_id::text
        AND c.status IN ('review','frozen')
    ) THEN
      RAISE EXCEPTION 'AGENT_DESK_COMPLIANCE_RESTRICTED' USING ERRCODE='P0001';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.agent_desk_capabilities_v1 cap
      JOIN public.country_products cp
        ON cp.country_code = v_desk.country_code
       AND cp.currency = cap.currency
       AND cp.enabled = true
      JOIN public.product_capabilities pc
        ON pc.country_code = cp.country_code
       AND pc.currency = cp.currency
       AND pc.enabled = true
       AND pc.capability IN ('CASH_IN','CASH_OUT')
      WHERE cap.desk_id = v_desk.id
        AND (
          (cap.cash_in_enabled = true AND pc.capability = 'CASH_IN')
          OR (cap.cash_out_enabled = true AND pc.capability = 'CASH_OUT')
        )
    ) THEN
      RAISE EXCEPTION 'AGENT_DESK_NO_ENABLED_CAPABILITY' USING ERRCODE='P0001';
    END IF;

    UPDATE public.users
    SET role = 'agent'
    WHERE id = p_agent_user_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'desk', to_jsonb(v_desk),
    'userRole', (SELECT role FROM public.users WHERE id = p_agent_user_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_agent_desk_operation_v1(
  p_agent_user_id uuid,
  p_operation_type text,
  p_currency text,
  p_amount numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_operation text := lower(btrim(COALESCE(p_operation_type, '')));
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
  v_desk public.agent_desks_v1%ROWTYPE;
  v_cap public.agent_desk_capabilities_v1%ROWTYPE;
  v_today_start timestamptz;
  v_used numeric(38,12);
  v_daily_limit numeric(38,12);
  v_capability text;
BEGIN
  IF p_agent_user_id IS NULL OR p_amount IS NULL OR p_amount <= 0
     OR v_operation NOT IN ('cash_in','cash_out') THEN
    RAISE EXCEPTION 'AGENT_DESK_INVALID_OPERATION' USING ERRCODE='P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_agent_user_id
      AND u.role = 'agent'
      AND COALESCE(u.is_active, true) = true
      AND COALESCE(u.is_system, false) = false
  ) THEN
    RAISE EXCEPTION 'AGENT_DESK_AGENT_NOT_ELIGIBLE' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_desk
  FROM public.agent_desks_v1
  WHERE agent_user_id = p_agent_user_id
  FOR SHARE;

  IF NOT FOUND OR v_desk.status <> 'active' THEN
    RAISE EXCEPTION 'AGENT_DESK_NOT_ACTIVE' USING ERRCODE='P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.kyc_profiles kp
    WHERE kp.user_id = p_agent_user_id AND kp.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'AGENT_DESK_KYC_REQUIRED' USING ERRCODE='P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.compliance_entity_controls c
    WHERE c.entity_type = 'USER'
      AND c.entity_ref = p_agent_user_id::text
      AND c.status IN ('review','frozen')
  ) THEN
    RAISE EXCEPTION 'AGENT_DESK_COMPLIANCE_RESTRICTED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_cap
  FROM public.agent_desk_capabilities_v1
  WHERE desk_id = v_desk.id
    AND currency = v_currency
  FOR SHARE;

  IF NOT FOUND
     OR (v_operation = 'cash_in' AND v_cap.cash_in_enabled IS NOT TRUE)
     OR (v_operation = 'cash_out' AND v_cap.cash_out_enabled IS NOT TRUE) THEN
    RAISE EXCEPTION 'AGENT_DESK_CAPABILITY_DISABLED' USING ERRCODE='P0001';
  END IF;

  v_capability := CASE WHEN v_operation = 'cash_in' THEN 'CASH_IN' ELSE 'CASH_OUT' END;

  IF NOT EXISTS (
    SELECT 1
    FROM public.country_products cp
    JOIN public.product_capabilities pc
      ON pc.country_code = cp.country_code
     AND pc.currency = cp.currency
    WHERE cp.country_code = v_desk.country_code
      AND cp.currency = v_currency
      AND cp.enabled = true
      AND pc.capability = v_capability
      AND pc.enabled = true
  ) THEN
    RAISE EXCEPTION 'AGENT_DESK_PRODUCT_DISABLED' USING ERRCODE='P0001';
  END IF;

  IF p_amount < v_cap.min_tx_amount
     OR (v_cap.max_tx_amount IS NOT NULL AND p_amount > v_cap.max_tx_amount) THEN
    RAISE EXCEPTION 'AGENT_DESK_TX_LIMIT_EXCEEDED' USING ERRCODE='P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'AGENT_DESK_DAILY:' || p_agent_user_id::text || ':' || v_operation || ':' || v_currency,
      0
    )
  );

  v_today_start := (
    date_trunc('day', now() AT TIME ZONE 'Africa/Juba')
    AT TIME ZONE 'Africa/Juba'
  );

  SELECT COALESCE(sum(ao.amount), 0)::numeric(38,12)
  INTO v_used
  FROM public.agent_operations ao
  WHERE ao.agent_user_id = p_agent_user_id
    AND ao.type = v_operation
    AND upper(ao.currency) = v_currency
    AND ao.status = 'completed'
    AND ao.created_at >= v_today_start;

  v_daily_limit := CASE
    WHEN v_operation = 'cash_in' THEN v_cap.daily_cash_in_limit
    ELSE v_cap.daily_cash_out_limit
  END;

  IF v_daily_limit IS NULL OR v_used + p_amount > v_daily_limit THEN
    RAISE EXCEPTION 'AGENT_DESK_DAILY_LIMIT_EXCEEDED'
      USING ERRCODE='P0001',
            DETAIL=jsonb_build_object(
              'used', v_used,
              'requested', p_amount,
              'limit', v_daily_limit,
              'currency', v_currency,
              'operation', v_operation
            )::text;
  END IF;

  RETURN v_desk.id;
END;
$$;

-- Preserve the already-proven Phase 4.4B money primitives under owner-only
-- names, then keep their public RPC names as policy wrappers.
DO $$
BEGIN
  IF to_regprocedure('public.agent_cash_in_ledger_v2_pre_desk_v1(uuid,text,text,numeric,text,text)') IS NULL THEN
    IF to_regprocedure('public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text)') IS NULL THEN
      RAISE EXCEPTION 'AGENT_DESK_CASH_IN_PRIMITIVE_MISSING' USING ERRCODE='P0001';
    END IF;
    ALTER FUNCTION public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text)
      RENAME TO agent_cash_in_ledger_v2_pre_desk_v1;
  END IF;

  IF to_regprocedure('public.agent_cash_out_ledger_v2_pre_desk_v1(uuid,text,text,numeric,text,text)') IS NULL THEN
    IF to_regprocedure('public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text)') IS NULL THEN
      RAISE EXCEPTION 'AGENT_DESK_CASH_OUT_PRIMITIVE_MISSING' USING ERRCODE='P0001';
    END IF;
    ALTER FUNCTION public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text)
      RENAME TO agent_cash_out_ledger_v2_pre_desk_v1;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_cash_in_ledger_v2(
  p_agent_user_id uuid,
  p_customer_identifier text,
  p_currency text,
  p_amount numeric,
  p_description text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_ledger_key text;
BEGIN
  IF p_agent_user_id IS NOT NULL AND v_key <> '' THEN
    v_ledger_key := p_agent_user_id::text || ':' || v_key;
    IF EXISTS (
      SELECT 1 FROM public.ledger_journals_v2
      WHERE source_type = 'AGENT_CASH_IN_V2'
        AND idempotency_key = v_ledger_key
    ) THEN
      RETURN public.agent_cash_in_ledger_v2_pre_desk_v1(
        p_agent_user_id, p_customer_identifier, p_currency, p_amount, p_description, p_idempotency_key
      );
    END IF;
  END IF;

  PERFORM public.assert_agent_desk_operation_v1(
    p_agent_user_id, 'cash_in', p_currency, p_amount
  );

  RETURN public.agent_cash_in_ledger_v2_pre_desk_v1(
    p_agent_user_id, p_customer_identifier, p_currency, p_amount, p_description, p_idempotency_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_cash_out_ledger_v2(
  p_customer_user_id uuid,
  p_agent_identifier text,
  p_currency text,
  p_amount numeric,
  p_description text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_identifier text := btrim(COALESCE(p_agent_identifier, ''));
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_agent_id uuid;
  v_ledger_key text;
BEGIN
  SELECT id INTO v_agent_id
  FROM public.users
  WHERE COALESCE(is_system, false) = false
    AND COALESCE(is_active, true) = true
    AND role = 'agent'
    AND (
      phone = v_identifier
      OR (
        v_identifier ~ '^[0-9]+$'
        AND wallet_account_number = v_identifier::bigint
      )
    )
  LIMIT 1;

  IF v_agent_id IS NULL THEN
    RETURN public.agent_cash_out_ledger_v2_pre_desk_v1(
      p_customer_user_id, p_agent_identifier, p_currency, p_amount, p_description, p_idempotency_key
    );
  END IF;

  IF p_customer_user_id IS NOT NULL AND v_key <> '' THEN
    v_ledger_key := p_customer_user_id::text || ':' || v_key;
    IF EXISTS (
      SELECT 1 FROM public.ledger_journals_v2
      WHERE source_type = 'AGENT_CASH_OUT_V2'
        AND idempotency_key = v_ledger_key
    ) THEN
      RETURN public.agent_cash_out_ledger_v2_pre_desk_v1(
        p_customer_user_id, p_agent_identifier, p_currency, p_amount, p_description, p_idempotency_key
      );
    END IF;
  END IF;

  PERFORM public.assert_agent_desk_operation_v1(
    v_agent_id, 'cash_out', p_currency, p_amount
  );

  RETURN public.agent_cash_out_ledger_v2_pre_desk_v1(
    p_customer_user_id, p_agent_identifier, p_currency, p_amount, p_description, p_idempotency_key
  );
END;
$$;

ALTER TABLE public.agent_desks_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_desk_capabilities_v1 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agent_desks_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.agent_desk_capabilities_v1 FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_upsert_agent_desk_v1(uuid,uuid,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_agent_desk_capability_v1(uuid,uuid,text,boolean,boolean,numeric,numeric,numeric,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_agent_desk_operation_v1(uuid,text,text,numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.agent_cash_in_ledger_v2_pre_desk_v1(uuid,text,text,numeric,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.agent_cash_out_ledger_v2_pre_desk_v1(uuid,text,text,numeric,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text) FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.agent_desks_v1 TO service_role;
GRANT SELECT ON public.agent_desk_capabilities_v1 TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_agent_desk_v1(uuid,uuid,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_agent_desk_capability_v1(uuid,uuid,text,boolean,boolean,numeric,numeric,numeric,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text) TO service_role;

COMMENT ON TABLE public.agent_desks_v1 IS
  'Operational registry for JeezPay agents/exchange desks. Role=agent alone never authorizes cash operations.';
COMMENT ON TABLE public.agent_desk_capabilities_v1 IS
  'Per-currency agent cash-in/out enablement and limits. Launch activation remains controlled by country_products/product_capabilities.';
COMMENT ON FUNCTION public.assert_agent_desk_operation_v1(uuid,text,text,numeric) IS
  'Owner-only policy gate for active agent desk, KYC/compliance state, product capability, per-transaction and Africa/Juba daily limits.';

COMMIT;
