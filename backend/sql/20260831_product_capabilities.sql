BEGIN;

-- Phase 2.1: country/product capability model.
-- Keep the architecture multi-country and multi-currency while enabling only
-- the South Sudan SSP product for the first launch.

CREATE TABLE IF NOT EXISTS public.country_products (
  country_code text NOT NULL,
  currency text NOT NULL,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country_code, currency),
  CONSTRAINT country_products_country_code_format
    CHECK (country_code ~ '^[A-Z]{2,10}$'),
  CONSTRAINT country_products_currency_format
    CHECK (currency ~ '^[A-Z0-9]{3,10}$'),
  CONSTRAINT country_products_sort_order_nonnegative
    CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS country_products_one_enabled_default_per_country_uidx
  ON public.country_products (country_code)
  WHERE enabled IS TRUE AND is_default IS TRUE;

CREATE TABLE IF NOT EXISTS public.product_capabilities (
  country_code text NOT NULL,
  currency text NOT NULL,
  capability text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country_code, currency, capability),
  CONSTRAINT product_capabilities_product_fk
    FOREIGN KEY (country_code, currency)
    REFERENCES public.country_products (country_code, currency)
    ON DELETE CASCADE,
  CONSTRAINT product_capabilities_capability_check
    CHECK (capability IN (
      'FIAT_HOLD',
      'P2P_TRANSFER',
      'CASH_IN',
      'CASH_OUT',
      'MERCHANT_PAYMENT',
      'CROSS_BORDER_SEND',
      'CROSS_BORDER_RECEIVE',
      'FX_CONVERT',
      'USDT_HOLD',
      'USDT_SEND',
      'USDT_RECEIVE',
      'USDT_BUY',
      'USDT_SELL'
    ))
);

CREATE INDEX IF NOT EXISTS product_capabilities_enabled_lookup_idx
  ON public.product_capabilities (country_code, currency, capability)
  WHERE enabled IS TRUE;

INSERT INTO public.country_products (
  country_code,
  currency,
  display_name,
  enabled,
  is_default,
  sort_order
)
VALUES
  ('SS', 'SSP', 'South Sudanese Pound', true,  true,  10),
  ('UG', 'UGX', 'Ugandan Shilling',      false, false, 20),
  ('SD', 'SDG', 'Sudanese Pound',        false, false, 30),
  ('EG', 'EGP', 'Egyptian Pound',        false, false, 40),
  ('GLOBAL', 'USDT', 'Tether USD',       false, false, 50)
ON CONFLICT (country_code, currency) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  enabled = EXCLUDED.enabled,
  is_default = EXCLUDED.is_default,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- Explicitly seed every supported capability so future enablement is a data
-- change, not an application-code rewrite.
WITH capability_catalog(capability) AS (
  VALUES
    ('FIAT_HOLD'),
    ('P2P_TRANSFER'),
    ('CASH_IN'),
    ('CASH_OUT'),
    ('MERCHANT_PAYMENT'),
    ('CROSS_BORDER_SEND'),
    ('CROSS_BORDER_RECEIVE'),
    ('FX_CONVERT'),
    ('USDT_HOLD'),
    ('USDT_SEND'),
    ('USDT_RECEIVE'),
    ('USDT_BUY'),
    ('USDT_SELL')
), product_catalog(country_code, currency) AS (
  VALUES
    ('SS', 'SSP'),
    ('UG', 'UGX'),
    ('SD', 'SDG'),
    ('EG', 'EGP'),
    ('GLOBAL', 'USDT')
)
INSERT INTO public.product_capabilities (
  country_code,
  currency,
  capability,
  enabled
)
SELECT
  p.country_code,
  p.currency,
  c.capability,
  CASE
    WHEN p.country_code = 'SS'
      AND p.currency = 'SSP'
      AND c.capability IN (
        'FIAT_HOLD',
        'P2P_TRANSFER',
        'CASH_IN',
        'CASH_OUT',
        'MERCHANT_PAYMENT'
      )
    THEN true
    ELSE false
  END AS enabled
FROM product_catalog AS p
CROSS JOIN capability_catalog AS c
ON CONFLICT (country_code, currency, capability) DO UPDATE
SET
  enabled = EXCLUDED.enabled,
  updated_at = now();

COMMENT ON TABLE public.country_products IS
  'Country/currency products exposed by JeezPay. Disabled rows remain available for future launches.';

COMMENT ON TABLE public.product_capabilities IS
  'Server-side feature entitlements for each country/currency product.';

COMMIT;
