\pset pager off
\echo '=== PHASE 5.1 KYC LIFECYCLE V2 TESTS ==='
\echo 'ROLLBACK-ONLY: submission, review, replay, guards, review history.'

BEGIN;
SET LOCAL statement_timeout = '90s';
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE
  v_admin_id uuid;
  v_user_id uuid;
  v_result jsonb;
  v_replay jsonb;
  v_direct_blocked boolean := false;
  v_reason_blocked boolean := false;
  v_path_blocked boolean := false;
  v_baseline_events bigint;
  v_after_events bigint;
BEGIN
  SELECT id INTO v_admin_id
  FROM public.users
  WHERE role IN ('admin','super_admin','kyc_officer')
    AND COALESCE(is_system,false)=false
    AND COALESCE(is_active,true)=true
  ORDER BY id
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'TEST_KYC_REVIEWER_MISSING';
  END IF;

  SELECT id INTO v_user_id
  FROM public.users
  WHERE id <> v_admin_id
    AND role='user'
    AND COALESCE(is_system,false)=false
    AND COALESCE(is_active,true)=true
  ORDER BY id
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'TEST_KYC_USER_MISSING';
  END IF;

  SELECT count(*) INTO v_baseline_events
  FROM public.kyc_review_events;

  -- Normalize the chosen user's starting state inside this rollback transaction.
  IF EXISTS (SELECT 1 FROM public.kyc_profiles WHERE user_id=v_user_id) THEN
    PERFORM set_config('jeezpay.kyc_lifecycle_v2','on',true);
    UPDATE public.kyc_profiles
    SET status='rejected',
        reviewed_by=v_admin_id,
        reviewed_at=now(),
        rejection_reason='Phase 5.1 rollback fixture',
        updated_at=now()
    WHERE user_id=v_user_id;
    PERFORM set_config('jeezpay.kyc_lifecycle_v2','off',true);
  END IF;

  v_result := public.submit_kyc_v2(
    v_user_id,
    'Phase Five Test User',
    '1995-01-01',
    'Rollback-only KYC address',
    v_user_id::text || '/id_1756940000000.jpg',
    v_user_id::text || '/selfie_1756940000001.jpg'
  );

  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE
     OR v_result->>'status' <> 'pending' THEN
    RAISE EXCEPTION 'TEST_KYC_SUBMIT_FAILED: %', v_result;
  END IF;

  v_replay := public.submit_kyc_v2(
    v_user_id,
    'Phase Five Test User',
    '1995-01-01',
    'Rollback-only KYC address',
    v_user_id::text || '/id_1756940000000.jpg',
    v_user_id::text || '/selfie_1756940000001.jpg'
  );

  IF COALESCE((v_replay->>'ok')::boolean,true) IS TRUE
     OR v_replay->>'code' <> 'KYC_ALREADY_PENDING' THEN
    RAISE EXCEPTION 'TEST_KYC_PENDING_REPLAY_NOT_BLOCKED: %', v_replay;
  END IF;

  BEGIN
    PERFORM public.submit_kyc_v2(
      v_user_id,
      'Phase Five Test User',
      '1995-01-01',
      'Rollback-only KYC address',
      'someone-else/id_1756940000000.jpg',
      v_user_id::text || '/selfie_1756940000001.jpg'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%KYC_DOCUMENT_PATH_OWNERSHIP_INVALID%' THEN
      v_path_blocked := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF v_path_blocked IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_KYC_PATH_OWNERSHIP_NOT_BLOCKED';
  END IF;

  BEGIN
    PERFORM public.review_kyc_v2(v_admin_id,v_user_id,'rejected',NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%KYC_REVIEW_REJECTION_REASON_REQUIRED%' THEN
      v_reason_blocked := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF v_reason_blocked IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_KYC_REJECTION_REASON_NOT_REQUIRED';
  END IF;

  v_result := public.review_kyc_v2(v_admin_id,v_user_id,'approved',NULL);

  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE
     OR v_result->>'status' <> 'approved'
     OR COALESCE((v_result->>'idempotentReplay')::boolean,true) IS TRUE THEN
    RAISE EXCEPTION 'TEST_KYC_APPROVE_FAILED: %', v_result;
  END IF;

  v_replay := public.review_kyc_v2(v_admin_id,v_user_id,'approved',NULL);

  IF COALESCE((v_replay->>'ok')::boolean,false) IS NOT TRUE
     OR COALESCE((v_replay->>'idempotentReplay')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_KYC_APPROVE_REPLAY_FAILED: %', v_replay;
  END IF;

  v_result := public.submit_kyc_v2(
    v_user_id,
    'Phase Five Test User',
    '1995-01-01',
    'Rollback-only KYC address',
    v_user_id::text || '/id_1756940000002.jpg',
    v_user_id::text || '/selfie_1756940000003.jpg'
  );

  IF COALESCE((v_result->>'ok')::boolean,true) IS TRUE
     OR v_result->>'code' <> 'KYC_ALREADY_APPROVED' THEN
    RAISE EXCEPTION 'TEST_KYC_APPROVED_RESUBMISSION_NOT_BLOCKED: %', v_result;
  END IF;

  BEGIN
    UPDATE public.kyc_profiles
    SET status='rejected'
    WHERE user_id=v_user_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%KYC_LIFECYCLE_DIRECT_MUTATION_FORBIDDEN%' THEN
      v_direct_blocked := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF v_direct_blocked IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_KYC_DIRECT_STATUS_MUTATION_NOT_BLOCKED';
  END IF;

  SELECT count(*) INTO v_after_events
  FROM public.kyc_review_events;

  IF v_after_events <> v_baseline_events + 2 THEN
    RAISE EXCEPTION 'TEST_KYC_EVENT_COUNT_INVALID: baseline %, after %',
      v_baseline_events, v_after_events;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.kyc_review_events
    WHERE user_id=v_user_id
      AND event_type IN ('submitted','resubmitted')
      AND to_status='pending'
  ) THEN
    RAISE EXCEPTION 'TEST_KYC_SUBMISSION_EVENT_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.kyc_review_events
    WHERE user_id=v_user_id
      AND event_type='approved'
      AND to_status='approved'
      AND actor_user_id=v_admin_id
  ) THEN
    RAISE EXCEPTION 'TEST_KYC_APPROVAL_EVENT_MISSING';
  END IF;

  RAISE NOTICE 'PHASE 5.1 KYC LIFECYCLE V2 TESTS: OK';
END;
$$;

\echo ''
\echo '=== TEMPORARY KYC EVENT COUNTS ==='
SELECT event_type,count(*)
FROM public.kyc_review_events
GROUP BY event_type
ORDER BY event_type;

ROLLBACK;
