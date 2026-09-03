BEGIN;

-- Phase 2 follow-up: model Bills/Services as an explicit product capability.
-- The first South Sudan launch does not include service payments, so seed the
-- capability disabled for every currently known product. Future enablement is
-- a data change, not an application-code change.

ALTER TABLE public.product_capabilities
  DROP CONSTRAINT IF EXISTS product_capabilities_capability_check;

ALTER TABLE public.product_capabilities
  ADD CONSTRAINT product_capabilities_capability_check
  CHECK (capability IN (
    'FIAT_HOLD',
    'P2P_TRANSFER',
    'CASH_IN',
    'CASH_OUT',
    'MERCHANT_PAYMENT',
    'SERVICE_PAYMENT',
    'CROSS_BORDER_SEND',
    'CROSS_BORDER_RECEIVE',
    'FX_CONVERT',
    'USDT_HOLD',
    'USDT_SEND',
    'USDT_RECEIVE',
    'USDT_BUY',
    'USDT_SELL'
  ));

INSERT INTO public.product_capabilities (
  country_code,
  currency,
  capability,
  enabled
)
SELECT
  country_code,
  currency,
  'SERVICE_PAYMENT',
  false
FROM public.country_products
ON CONFLICT (country_code, currency, capability) DO NOTHING;

COMMIT;
