-- ============================================================
-- 배플레이그라운드 JBBJ 증권시장 v2 영구 계좌
-- date: 2026-07-11
--
-- 원칙:
-- - public table은 renderer 역할에 직접 열지 않고 hardened RPC만 anon에 공개한다.
-- - 현재 인증 경계는 Electron main의 canonical SessionManager이며, 모든 RPC는
--   DB의 정확한 배한솔 name + Slack ID 한 행을 다시 확인한다.
-- - user UUID를 migration에 박지 않고 public.users의 canonical 행에서 가져온다.
-- - 모든 금액/수량은 JavaScript Number.MAX_SAFE_INTEGER 범위의 정수만 다룬다.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.playground_wallet_accounts (
  user_id text PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  wallet_points bigint NOT NULL DEFAULT 0,
  lifetime_earned_points bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT playground_wallet_points_nonnegative CHECK (wallet_points >= 0),
  CONSTRAINT playground_wallet_points_safe CHECK (wallet_points <= 9007199254740991),
  CONSTRAINT playground_lifetime_points_nonnegative CHECK (lifetime_earned_points >= 0),
  CONSTRAINT playground_lifetime_points_safe CHECK (lifetime_earned_points <= 9007199254740991)
);

CREATE TABLE IF NOT EXISTS public.playground_brokerage_accounts (
  user_id text PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  cash_won bigint NOT NULL DEFAULT 0,
  realized_pnl_this_month_won bigint NOT NULL DEFAULT 0,
  unrealized_pnl_at_month_start_won bigint NOT NULL DEFAULT 0,
  favorite_stock_ids text[] NOT NULL DEFAULT ARRAY['jbbj', 'youtube', 'wacom']::text[],
  beginner_mission text NOT NULL DEFAULT 'reason',
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT playground_cash_nonnegative CHECK (cash_won >= 0),
  CONSTRAINT playground_cash_safe CHECK (cash_won <= 9007199254740991),
  CONSTRAINT playground_realized_pnl_safe CHECK (
    realized_pnl_this_month_won BETWEEN -9007199254740991 AND 9007199254740991
  ),
  CONSTRAINT playground_month_start_pnl_safe CHECK (
    unrealized_pnl_at_month_start_won BETWEEN -9007199254740991 AND 9007199254740991
  ),
  CONSTRAINT playground_beginner_mission_valid CHECK (
    beginner_mission IN ('favorite', 'reason', 'first-order', 'complete')
  ),
  CONSTRAINT playground_account_revision_positive CHECK (revision > 0),
  CONSTRAINT playground_account_revision_safe CHECK (revision <= 9007199254740991)
);

CREATE TABLE IF NOT EXISTS public.playground_market_holdings (
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stock_id text NOT NULL,
  quantity_shares bigint NOT NULL,
  cost_basis_won bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, stock_id),
  CONSTRAINT playground_holding_stock_valid CHECK (
    stock_id IN ('jbbj', 'youtube', 'meta-comedy', 'netflix', 'adobe', 'wacom', 'slack', 'google-drive')
  ),
  CONSTRAINT playground_holding_quantity_positive CHECK (quantity_shares > 0),
  CONSTRAINT playground_holding_quantity_safe CHECK (quantity_shares <= 9007199254740991),
  CONSTRAINT playground_holding_cost_nonnegative CHECK (cost_basis_won >= 0),
  CONSTRAINT playground_holding_cost_safe CHECK (cost_basis_won <= 9007199254740991)
);

CREATE TABLE IF NOT EXISTS public.playground_value_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  kind text NOT NULL,
  payload_fingerprint text NOT NULL,
  wallet_delta bigint NOT NULL DEFAULT 0,
  lifetime_earned_delta bigint NOT NULL DEFAULT 0,
  cash_delta bigint NOT NULL DEFAULT 0,
  stock_id text,
  share_delta bigint NOT NULL DEFAULT 0,
  cost_basis_delta bigint NOT NULL DEFAULT 0,
  realized_pnl_delta bigint NOT NULL DEFAULT 0,
  response_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id),
  CONSTRAINT playground_ledger_request_id_valid CHECK (length(btrim(request_id)) BETWEEN 1 AND 200),
  CONSTRAINT playground_ledger_kind_valid CHECK (
    kind IN ('initial-grant', 'favorite', 'read-reason', 'transfer', 'buy', 'sell')
  ),
  CONSTRAINT playground_ledger_wallet_delta_safe CHECK (
    wallet_delta BETWEEN -9007199254740991 AND 9007199254740991
  ),
  CONSTRAINT playground_ledger_lifetime_delta_safe CHECK (
    lifetime_earned_delta BETWEEN -9007199254740991 AND 9007199254740991
  ),
  CONSTRAINT playground_ledger_cash_delta_safe CHECK (
    cash_delta BETWEEN -9007199254740991 AND 9007199254740991
  ),
  CONSTRAINT playground_ledger_share_delta_safe CHECK (
    share_delta BETWEEN -9007199254740991 AND 9007199254740991
  ),
  CONSTRAINT playground_ledger_cost_delta_safe CHECK (
    cost_basis_delta BETWEEN -9007199254740991 AND 9007199254740991
  ),
  CONSTRAINT playground_ledger_realized_delta_safe CHECK (
    realized_pnl_delta BETWEEN -9007199254740991 AND 9007199254740991
  )
);

CREATE TABLE IF NOT EXISTS public.playground_market_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  impact_bps integer NOT NULL DEFAULT 0,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  revision bigint NOT NULL,
  created_by text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT playground_market_event_stock_valid CHECK (
    stock_id IN ('jbbj', 'youtube', 'meta-comedy', 'netflix', 'adobe', 'wacom', 'slack', 'google-drive')
  ),
  CONSTRAINT playground_market_event_kind_valid CHECK (
    kind IN ('news', 'shock-up', 'shock-down', 'trend', 'halt')
  ),
  CONSTRAINT playground_market_event_title_valid CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  CONSTRAINT playground_market_event_window_valid CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT playground_market_event_revision_positive CHECK (revision > 0),
  CONSTRAINT playground_market_event_revision_safe CHECK (revision <= 9007199254740991),
  UNIQUE (revision)
);

CREATE INDEX IF NOT EXISTS playground_market_events_created_by_idx
  ON public.playground_market_events(created_by);

ALTER TABLE public.playground_wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playground_brokerage_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playground_market_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playground_value_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playground_market_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.playground_wallet_accounts FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.playground_brokerage_accounts FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.playground_market_holdings FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.playground_value_ledger FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.playground_market_events FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.playground_wallet_accounts FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.playground_brokerage_accounts FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.playground_market_holdings FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.playground_value_ledger FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.playground_market_events FROM PUBLIC;

-- 정확히 한 명의 canonical 배한솔에게만 최초 지급한다. ledger insert가 성공한
-- transaction에서만 지갑을 올리므로 migration 재실행은 잔액을 다시 늘리지 않는다.
DO $$
DECLARE
  v_hansol_id text;
  v_match_count integer;
  v_seed_inserted integer;
BEGIN
  SELECT COUNT(*), (array_agg(users.id ORDER BY users.id))[1]
  INTO v_match_count, v_hansol_id
  FROM public.users
  WHERE users.name = '배한솔'
    AND users.slack_id = 'U05DFV9UAN5';

  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'canonical Hansol lookup must match exactly one user';
  END IF;

  INSERT INTO public.playground_wallet_accounts (user_id)
  VALUES (v_hansol_id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.playground_brokerage_accounts (user_id)
  VALUES (v_hansol_id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.playground_value_ledger (
    user_id,
    request_id,
    kind,
    payload_fingerprint,
    wallet_delta,
    lifetime_earned_delta
  )
  VALUES (
    v_hansol_id,
    'test-initial-grant-v1',
    'initial-grant',
    encode(sha256(convert_to('test-initial-grant-v1:1000000', 'UTF8')), 'hex'),
    1000000,
    1000000
  )
  ON CONFLICT (user_id, request_id) DO NOTHING;

  GET DIAGNOSTICS v_seed_inserted = ROW_COUNT;
  IF v_seed_inserted = 1 THEN
    UPDATE public.playground_wallet_accounts
    SET
      wallet_points = wallet_points + 1000000,
      lifetime_earned_points = lifetime_earned_points + 1000000,
      updated_at = now()
    WHERE user_id = v_hansol_id;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.playground_market_read(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_match_count integer;
  v_wallet public.playground_wallet_accounts%ROWTYPE;
  v_broker public.playground_brokerage_accounts%ROWTYPE;
  v_holdings jsonb;
  v_events jsonb;
BEGIN
  SELECT COUNT(*)
  INTO v_match_count
  FROM public.users
  WHERE users.name = '배한솔'
    AND users.slack_id = 'U05DFV9UAN5';

  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'canonical Hansol account is unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE users.id = p_user_id::text
      AND users.name = '배한솔'
      AND users.slack_id = 'U05DFV9UAN5'
  ) THEN
    RAISE EXCEPTION 'market access is limited to canonical Hansol' USING ERRCODE = '42501';
  END IF;

  SELECT wallet.*
  INTO v_wallet
  FROM public.playground_wallet_accounts AS wallet
  WHERE wallet.user_id = p_user_id::text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'market wallet account is not initialized' USING ERRCODE = 'P0002';
  END IF;

  SELECT broker.*
  INTO v_broker
  FROM public.playground_brokerage_accounts AS broker
  WHERE broker.user_id = p_user_id::text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'market brokerage account is not initialized' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'stockId', holding.stock_id,
        'quantityShares', holding.quantity_shares,
        'costBasisWon', holding.cost_basis_won
      )
      ORDER BY holding.stock_id
    ),
    '[]'::jsonb
  )
  INTO v_holdings
  FROM public.playground_market_holdings AS holding
  WHERE holding.user_id = p_user_id::text;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', event.id,
        'stockId', event.stock_id,
        'kind', event.kind,
        'title', event.title,
        'impactBps', event.impact_bps,
        'startsAt', event.starts_at,
        'endsAt', event.ends_at,
        'revision', event.revision
      )
      ORDER BY event.starts_at, event.revision
    ),
    '[]'::jsonb
  )
  INTO v_events
  FROM public.playground_market_events AS event;

  RETURN jsonb_build_object(
    'revision', v_broker.revision,
    'account', jsonb_build_object(
      'walletPoints', v_wallet.wallet_points,
      'lifetimeEarnedPoints', v_wallet.lifetime_earned_points,
      'cashWon', v_broker.cash_won,
      'realizedPnlThisMonthWon', v_broker.realized_pnl_this_month_won,
      'unrealizedPnlAtMonthStartWon', v_broker.unrealized_pnl_at_month_start_won,
      'holdings', v_holdings
    ),
    'favoriteStockIds', to_jsonb(v_broker.favorite_stock_ids),
    'beginnerMission', v_broker.beginner_mission,
    'adminEvents', v_events
  );
END
$$;

CREATE OR REPLACE FUNCTION public.playground_market_execute(
  p_user_id uuid,
  p_request_id text,
  p_kind text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_match_count integer;
  v_wallet public.playground_wallet_accounts%ROWTYPE;
  v_broker public.playground_brokerage_accounts%ROWTYPE;
  v_holding public.playground_market_holdings%ROWTYPE;
  v_holding_found boolean := false;
  v_existing_fingerprint text;
  v_fingerprint text;
  v_raw text;
  v_stock_id text;
  v_direction text;
  v_wished boolean;
  v_amount bigint;
  v_quantity bigint;
  v_price bigint;
  v_order_total bigint;
  v_order_total_numeric numeric;
  v_sold_cost_basis bigint;
  v_next_realized numeric;
  v_wallet_delta bigint := 0;
  v_cash_delta bigint := 0;
  v_share_delta bigint := 0;
  v_cost_delta bigint := 0;
  v_realized_delta bigint := 0;
  v_response jsonb;
  v_max_safe constant bigint := 9007199254740991;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'market user is required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT COUNT(*)
  INTO v_match_count
  FROM public.users
  WHERE users.name = '배한솔'
    AND users.slack_id = 'U05DFV9UAN5';
  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'canonical Hansol account is unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE users.id = p_user_id::text
      AND users.name = '배한솔'
      AND users.slack_id = 'U05DFV9UAN5'
  ) THEN
    RAISE EXCEPTION 'market access is limited to canonical Hansol' USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'market request id is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('favorite', 'read-reason', 'transfer', 'buy', 'sell') THEN
    RAISE EXCEPTION 'market command kind is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'market command payload is invalid' USING ERRCODE = '22023';
  END IF;

  v_fingerprint := encode(
    sha256(convert_to(p_kind || E'\n' || p_payload::text, 'UTF8')),
    'hex'
  );

  SELECT wallet.*
  INTO v_wallet
  FROM public.playground_wallet_accounts AS wallet
  WHERE wallet.user_id = p_user_id::text
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'market wallet account is not initialized' USING ERRCODE = 'P0002';
  END IF;

  SELECT broker.*
  INTO v_broker
  FROM public.playground_brokerage_accounts AS broker
  WHERE broker.user_id = p_user_id::text
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'market brokerage account is not initialized' USING ERRCODE = 'P0002';
  END IF;

  SELECT ledger.payload_fingerprint
  INTO v_existing_fingerprint
  FROM public.playground_value_ledger AS ledger
  WHERE ledger.user_id = p_user_id::text
    AND ledger.request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'request id conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.playground_market_read(p_user_id);
  END IF;

  CASE p_kind
    WHEN 'favorite' THEN
      IF jsonb_typeof(p_payload -> 'stockId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(p_payload -> 'wished') IS DISTINCT FROM 'boolean'
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(payload_key)
          WHERE payload_key NOT IN ('stockId', 'wished')
        ) THEN
        RAISE EXCEPTION 'favorite payload is invalid' USING ERRCODE = '22023';
      END IF;
      v_stock_id := p_payload ->> 'stockId';
      IF v_stock_id NOT IN ('jbbj', 'youtube', 'meta-comedy', 'netflix', 'adobe', 'wacom', 'slack', 'google-drive') THEN
        RAISE EXCEPTION 'market stock was not found' USING ERRCODE = '22023';
      END IF;
      v_wished := (p_payload ->> 'wished')::boolean;
      UPDATE public.playground_brokerage_accounts
      SET
        favorite_stock_ids = CASE
          WHEN v_wished AND NOT (v_stock_id = ANY(favorite_stock_ids))
            THEN array_append(favorite_stock_ids, v_stock_id)
          WHEN NOT v_wished THEN array_remove(favorite_stock_ids, v_stock_id)
          ELSE favorite_stock_ids
        END,
        beginner_mission = CASE
          WHEN beginner_mission = 'favorite' AND v_wished THEN 'reason'
          ELSE beginner_mission
        END,
        updated_at = now()
      WHERE user_id = p_user_id::text;

    WHEN 'read-reason' THEN
      IF jsonb_typeof(p_payload -> 'stockId') IS DISTINCT FROM 'string'
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(payload_key)
          WHERE payload_key <> 'stockId'
        ) THEN
        RAISE EXCEPTION 'reason payload is invalid' USING ERRCODE = '22023';
      END IF;
      v_stock_id := p_payload ->> 'stockId';
      IF v_stock_id NOT IN ('jbbj', 'youtube', 'meta-comedy', 'netflix', 'adobe', 'wacom', 'slack', 'google-drive') THEN
        RAISE EXCEPTION 'market stock was not found' USING ERRCODE = '22023';
      END IF;
      UPDATE public.playground_brokerage_accounts
      SET
        beginner_mission = CASE WHEN beginner_mission = 'reason' THEN 'first-order' ELSE beginner_mission END,
        updated_at = now()
      WHERE user_id = p_user_id::text;

    WHEN 'transfer' THEN
      IF jsonb_typeof(p_payload -> 'direction') IS DISTINCT FROM 'string'
        OR jsonb_typeof(p_payload -> 'points') IS DISTINCT FROM 'number'
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(payload_key)
          WHERE payload_key NOT IN ('direction', 'points')
        ) THEN
        RAISE EXCEPTION 'transfer payload is invalid' USING ERRCODE = '22023';
      END IF;
      v_direction := p_payload ->> 'direction';
      v_raw := p_payload ->> 'points';
      IF v_direction NOT IN ('wallet-to-broker', 'broker-to-wallet')
        OR v_raw !~ '^[0-9]+$'
        OR length(v_raw) > 16 THEN
        RAISE EXCEPTION 'transfer amount must be a positive safe integer' USING ERRCODE = '22023';
      END IF;
      v_amount := v_raw::bigint;
      IF v_amount <= 0 OR v_amount > v_max_safe THEN
        RAISE EXCEPTION 'transfer amount must be a positive safe integer' USING ERRCODE = '22023';
      END IF;

      IF v_direction = 'wallet-to-broker' THEN
        IF v_wallet.wallet_points < v_amount THEN
          RAISE EXCEPTION 'wallet balance is insufficient' USING ERRCODE = 'P0001';
        END IF;
        IF v_broker.cash_won::numeric + v_amount::numeric > v_max_safe THEN
          RAISE EXCEPTION 'brokerage balance exceeds safe range' USING ERRCODE = '22003';
        END IF;
        UPDATE public.playground_wallet_accounts
        SET wallet_points = wallet_points - v_amount, updated_at = now()
        WHERE user_id = p_user_id::text;
        UPDATE public.playground_brokerage_accounts
        SET cash_won = cash_won + v_amount, updated_at = now()
        WHERE user_id = p_user_id::text;
        v_wallet_delta := -v_amount;
        v_cash_delta := v_amount;
      ELSE
        IF v_broker.cash_won < v_amount THEN
          RAISE EXCEPTION 'brokerage cash is insufficient' USING ERRCODE = 'P0001';
        END IF;
        IF v_wallet.wallet_points::numeric + v_amount::numeric > v_max_safe THEN
          RAISE EXCEPTION 'wallet balance exceeds safe range' USING ERRCODE = '22003';
        END IF;
        UPDATE public.playground_wallet_accounts
        SET wallet_points = wallet_points + v_amount, updated_at = now()
        WHERE user_id = p_user_id::text;
        UPDATE public.playground_brokerage_accounts
        SET cash_won = cash_won - v_amount, updated_at = now()
        WHERE user_id = p_user_id::text;
        v_wallet_delta := v_amount;
        v_cash_delta := -v_amount;
      END IF;

    WHEN 'buy' THEN
      IF jsonb_typeof(p_payload -> 'stockId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(p_payload -> 'quantityShares') IS DISTINCT FROM 'number'
        OR jsonb_typeof(p_payload -> 'quotedPriceWon') IS DISTINCT FROM 'number'
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(payload_key)
          WHERE payload_key NOT IN ('stockId', 'quantityShares', 'quotedPriceWon')
        ) THEN
        RAISE EXCEPTION 'buy payload is invalid' USING ERRCODE = '22023';
      END IF;
      v_stock_id := p_payload ->> 'stockId';
      IF v_stock_id NOT IN ('jbbj', 'youtube', 'meta-comedy', 'netflix', 'adobe', 'wacom', 'slack', 'google-drive') THEN
        RAISE EXCEPTION 'market stock was not found' USING ERRCODE = '22023';
      END IF;
      v_raw := p_payload ->> 'quantityShares';
      IF v_raw !~ '^[0-9]+$' OR length(v_raw) > 16 THEN
        RAISE EXCEPTION 'share quantity must be a positive safe integer' USING ERRCODE = '22023';
      END IF;
      v_quantity := v_raw::bigint;
      v_raw := p_payload ->> 'quotedPriceWon';
      IF v_raw !~ '^[0-9]+$' OR length(v_raw) > 16 THEN
        RAISE EXCEPTION 'quoted price must be a positive safe integer' USING ERRCODE = '22023';
      END IF;
      v_price := v_raw::bigint;
      IF v_quantity <= 0 OR v_quantity > v_max_safe OR v_price <= 0 OR v_price > v_max_safe THEN
        RAISE EXCEPTION 'order values must be positive safe integers' USING ERRCODE = '22023';
      END IF;
      v_order_total_numeric := v_quantity::numeric * v_price::numeric;
      IF v_order_total_numeric > v_max_safe THEN
        RAISE EXCEPTION 'order total exceeds safe range' USING ERRCODE = '22003';
      END IF;
      v_order_total := v_order_total_numeric::bigint;
      IF v_broker.cash_won < v_order_total THEN
        RAISE EXCEPTION 'brokerage cash is insufficient' USING ERRCODE = 'P0001';
      END IF;

      SELECT holding.*
      INTO v_holding
      FROM public.playground_market_holdings AS holding
      WHERE holding.user_id = p_user_id::text
        AND holding.stock_id = v_stock_id
      FOR UPDATE;
      v_holding_found := FOUND;
      IF v_holding_found THEN
        IF v_holding.quantity_shares::numeric + v_quantity::numeric > v_max_safe
          OR v_holding.cost_basis_won::numeric + v_order_total::numeric > v_max_safe THEN
          RAISE EXCEPTION 'holding exceeds safe range' USING ERRCODE = '22003';
        END IF;
        UPDATE public.playground_market_holdings
        SET
          quantity_shares = quantity_shares + v_quantity,
          cost_basis_won = cost_basis_won + v_order_total,
          updated_at = now()
        WHERE user_id = p_user_id::text AND stock_id = v_stock_id;
      ELSE
        INSERT INTO public.playground_market_holdings (
          user_id, stock_id, quantity_shares, cost_basis_won
        ) VALUES (
          p_user_id::text, v_stock_id, v_quantity, v_order_total
        );
      END IF;
      UPDATE public.playground_brokerage_accounts
      SET
        cash_won = cash_won - v_order_total,
        beginner_mission = CASE WHEN beginner_mission = 'first-order' THEN 'complete' ELSE beginner_mission END,
        updated_at = now()
      WHERE user_id = p_user_id::text;
      v_cash_delta := -v_order_total;
      v_share_delta := v_quantity;
      v_cost_delta := v_order_total;

    WHEN 'sell' THEN
      IF jsonb_typeof(p_payload -> 'stockId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(p_payload -> 'quotedPriceWon') IS DISTINCT FROM 'number'
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(payload_key)
          WHERE payload_key NOT IN ('stockId', 'quantityShares', 'quotedPriceWon')
        ) THEN
        RAISE EXCEPTION 'sell payload is invalid' USING ERRCODE = '22023';
      END IF;
      v_stock_id := p_payload ->> 'stockId';
      IF v_stock_id NOT IN ('jbbj', 'youtube', 'meta-comedy', 'netflix', 'adobe', 'wacom', 'slack', 'google-drive') THEN
        RAISE EXCEPTION 'market stock was not found' USING ERRCODE = '22023';
      END IF;
      v_raw := p_payload ->> 'quotedPriceWon';
      IF v_raw !~ '^[0-9]+$' OR length(v_raw) > 16 THEN
        RAISE EXCEPTION 'quoted price must be a positive safe integer' USING ERRCODE = '22023';
      END IF;
      v_price := v_raw::bigint;
      IF v_price <= 0 OR v_price > v_max_safe THEN
        RAISE EXCEPTION 'quoted price must be a positive safe integer' USING ERRCODE = '22023';
      END IF;

      SELECT holding.*
      INTO v_holding
      FROM public.playground_market_holdings AS holding
      WHERE holding.user_id = p_user_id::text
        AND holding.stock_id = v_stock_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'no shares are held for this stock' USING ERRCODE = 'P0001';
      END IF;

      v_raw := p_payload ->> 'quantityShares';
      IF jsonb_typeof(p_payload -> 'quantityShares') = 'string' AND v_raw = 'all' THEN
        v_quantity := v_holding.quantity_shares;
      ELSE
        IF jsonb_typeof(p_payload -> 'quantityShares') IS DISTINCT FROM 'number'
          OR v_raw !~ '^[0-9]+$'
          OR length(v_raw) > 16 THEN
          RAISE EXCEPTION 'share quantity must be a positive safe integer or all' USING ERRCODE = '22023';
        END IF;
        v_quantity := v_raw::bigint;
      END IF;
      IF v_quantity <= 0 OR v_quantity > v_max_safe THEN
        RAISE EXCEPTION 'share quantity must be a positive safe integer' USING ERRCODE = '22023';
      END IF;
      IF v_quantity > v_holding.quantity_shares THEN
        RAISE EXCEPTION 'held share quantity is insufficient' USING ERRCODE = 'P0001';
      END IF;

      v_order_total_numeric := v_quantity::numeric * v_price::numeric;
      IF v_order_total_numeric > v_max_safe THEN
        RAISE EXCEPTION 'order total exceeds safe range' USING ERRCODE = '22003';
      END IF;
      v_order_total := v_order_total_numeric::bigint;
      IF v_broker.cash_won::numeric + v_order_total::numeric > v_max_safe THEN
        RAISE EXCEPTION 'brokerage balance exceeds safe range' USING ERRCODE = '22003';
      END IF;
      IF v_quantity = v_holding.quantity_shares THEN
        v_sold_cost_basis := v_holding.cost_basis_won;
      ELSE
        v_sold_cost_basis := round(
          (v_holding.cost_basis_won::numeric * v_quantity::numeric)
          / v_holding.quantity_shares::numeric
        )::bigint;
      END IF;
      v_next_realized := v_broker.realized_pnl_this_month_won::numeric
        + v_order_total::numeric
        - v_sold_cost_basis::numeric;
      IF v_next_realized < -v_max_safe OR v_next_realized > v_max_safe THEN
        RAISE EXCEPTION 'realized profit exceeds safe range' USING ERRCODE = '22003';
      END IF;

      IF v_quantity = v_holding.quantity_shares THEN
        DELETE FROM public.playground_market_holdings
        WHERE user_id = p_user_id::text AND stock_id = v_stock_id;
      ELSE
        UPDATE public.playground_market_holdings
        SET
          quantity_shares = quantity_shares - v_quantity,
          cost_basis_won = cost_basis_won - v_sold_cost_basis,
          updated_at = now()
        WHERE user_id = p_user_id::text AND stock_id = v_stock_id;
      END IF;
      UPDATE public.playground_brokerage_accounts
      SET
        cash_won = cash_won + v_order_total,
        realized_pnl_this_month_won = v_next_realized::bigint,
        updated_at = now()
      WHERE user_id = p_user_id::text;
      v_cash_delta := v_order_total;
      v_share_delta := -v_quantity;
      v_cost_delta := -v_sold_cost_basis;
      v_realized_delta := v_order_total - v_sold_cost_basis;
  END CASE;

  UPDATE public.playground_brokerage_accounts
  SET revision = revision + 1, updated_at = now()
  WHERE user_id = p_user_id::text;

  v_response := public.playground_market_read(p_user_id);

  INSERT INTO public.playground_value_ledger (
    user_id,
    request_id,
    kind,
    payload_fingerprint,
    wallet_delta,
    cash_delta,
    stock_id,
    share_delta,
    cost_basis_delta,
    realized_pnl_delta,
    response_state
  ) VALUES (
    p_user_id::text,
    p_request_id,
    p_kind,
    v_fingerprint,
    v_wallet_delta,
    v_cash_delta,
    v_stock_id,
    v_share_delta,
    v_cost_delta,
    v_realized_delta,
    v_response
  );

  RETURN v_response;
END
$$;

CREATE OR REPLACE FUNCTION public.playground_market_create_event(
  p_user_id uuid,
  p_stock_id text,
  p_kind text,
  p_title text,
  p_impact_bps integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_match_count integer;
  v_next_revision bigint;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'market user is required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT COUNT(*)
  INTO v_match_count
  FROM public.users
  WHERE users.name = '배한솔'
    AND users.slack_id = 'U05DFV9UAN5';
  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'canonical Hansol account is unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE users.id = p_user_id::text
      AND users.name = '배한솔'
      AND users.slack_id = 'U05DFV9UAN5'
  ) THEN
    RAISE EXCEPTION 'market access is limited to canonical Hansol' USING ERRCODE = '42501';
  END IF;

  IF p_stock_id IS NULL
    OR p_kind IS NULL
    OR p_stock_id NOT IN ('jbbj', 'youtube', 'meta-comedy', 'netflix', 'adobe', 'wacom', 'slack', 'google-drive')
    OR p_kind NOT IN ('news', 'shock-up', 'shock-down', 'trend', 'halt')
    OR p_title IS NULL
    OR length(btrim(p_title)) NOT BETWEEN 1 AND 160
    OR p_impact_bps IS NULL
    OR p_starts_at IS NULL
    OR (p_ends_at IS NOT NULL AND p_ends_at <= p_starts_at) THEN
    RAISE EXCEPTION 'market event input is invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_kind = 'shock-up' AND p_impact_bps <= 0)
    OR (p_kind = 'shock-down' AND p_impact_bps <= 0)
    OR (p_kind = 'halt' AND p_impact_bps <> 0) THEN
    RAISE EXCEPTION 'market event impact direction is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT broker.revision + 1
  INTO v_next_revision
  FROM public.playground_brokerage_accounts AS broker
  WHERE broker.user_id = p_user_id::text
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'market brokerage account is not initialized' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.playground_market_events (
    stock_id, kind, title, impact_bps, starts_at, ends_at, revision, created_by
  ) VALUES (
    p_stock_id, p_kind, btrim(p_title), p_impact_bps, p_starts_at, p_ends_at,
    v_next_revision, p_user_id::text
  );

  UPDATE public.playground_brokerage_accounts
  SET revision = v_next_revision, updated_at = now()
  WHERE user_id = p_user_id::text;

  RETURN public.playground_market_read(p_user_id);
END
$$;

CREATE OR REPLACE FUNCTION public.playground_market_delete_event(
  p_user_id uuid,
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_match_count integer;
  v_deleted integer;
BEGIN
  IF p_user_id IS NULL OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'market user and event are required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT COUNT(*)
  INTO v_match_count
  FROM public.users
  WHERE users.name = '배한솔'
    AND users.slack_id = 'U05DFV9UAN5';
  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'canonical Hansol account is unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE users.id = p_user_id::text
      AND users.name = '배한솔'
      AND users.slack_id = 'U05DFV9UAN5'
  ) THEN
    RAISE EXCEPTION 'market access is limited to canonical Hansol' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.playground_brokerage_accounts AS broker
  WHERE broker.user_id = p_user_id::text
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'market brokerage account is not initialized' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.playground_market_events
  WHERE id = p_event_id
    AND created_by = p_user_id::text;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'market event was not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.playground_brokerage_accounts
  SET revision = revision + 1, updated_at = now()
  WHERE user_id = p_user_id::text;

  RETURN public.playground_market_read(p_user_id);
END
$$;

-- SECURITY DEFINER 함수는 생성 즉시 PUBLIC EXECUTE가 생기므로 먼저 회수한다.
REVOKE EXECUTE ON FUNCTION public.playground_market_read(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.playground_market_execute(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.playground_market_create_event(uuid, text, text, text, integer, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.playground_market_delete_event(uuid, uuid) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.playground_market_read(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.playground_market_execute(uuid, text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.playground_market_create_event(uuid, text, text, text, integer, timestamptz, timestamptz) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.playground_market_delete_event(uuid, uuid) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.playground_market_read(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.playground_market_execute(uuid, text, text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.playground_market_create_event(uuid, text, text, text, integer, timestamptz, timestamptz) TO anon;
GRANT EXECUTE ON FUNCTION public.playground_market_delete_event(uuid, uuid) TO anon;

COMMIT;
