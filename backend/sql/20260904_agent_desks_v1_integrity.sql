BEGIN;

ALTER TABLE public.agent_desk_capabilities_v1
  ADD CONSTRAINT agent_desk_capabilities_v1_cash_in_limit_usable
  CHECK (
    cash_in_enabled IS FALSE
    OR daily_cash_in_limit >= min_tx_amount
  );

ALTER TABLE public.agent_desk_capabilities_v1
  ADD CONSTRAINT agent_desk_capabilities_v1_cash_out_limit_usable
  CHECK (
    cash_out_enabled IS FALSE
    OR daily_cash_out_limit >= min_tx_amount
  );

COMMIT;
