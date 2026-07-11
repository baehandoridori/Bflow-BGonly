-- ============================================================
-- 배플레이그라운드 주문 시세 리비전 검증 운영 핫픽스
-- date: 2026-07-12
--
-- 이미 2026-07-11 v2 마이그레이션을 적용한 DB에서 execute RPC만 안전하게
-- 교체한다. CREATE OR REPLACE + 명시적 권한 재설정으로 반복 실행할 수 있다.
-- 이 파일은 배포 시 별도 적용하며 개발/테스트 과정에서는 자동 실행하지 않는다.
-- ============================================================

BEGIN;

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
  v_quoted_revision bigint;
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

  IF p_request_id IS NULL
    OR char_length(p_request_id) NOT BETWEEN 1 AND 200
    OR char_length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
    OR p_request_id IS DISTINCT FROM btrim(p_request_id)
    OR p_request_id ~ '^[[:space:]]|[[:space:]]$' THEN
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
        OR jsonb_typeof(p_payload -> 'quotedRevision') IS DISTINCT FROM 'number'
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(payload_key)
          WHERE payload_key NOT IN ('stockId', 'quantityShares', 'quotedPriceWon', 'quotedRevision')
        ) THEN
        RAISE EXCEPTION 'buy payload is invalid' USING ERRCODE = '22023';
      END IF;
      v_stock_id := p_payload ->> 'stockId';
      IF v_stock_id NOT IN ('jbbj', 'youtube', 'meta-comedy', 'netflix', 'adobe', 'wacom', 'slack', 'google-drive') THEN
        RAISE EXCEPTION 'market stock was not found' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM public.playground_market_events AS market_event
        WHERE market_event.stock_id = v_stock_id
          AND market_event.kind = 'halt'
          AND market_event.starts_at <= now()
          AND (market_event.ends_at IS NULL OR market_event.ends_at > now())
      ) THEN
        RAISE EXCEPTION 'market trading is halted for this stock' USING ERRCODE = 'P0001';
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
      v_raw := p_payload ->> 'quotedRevision';
      IF v_raw !~ '^[0-9]+$' OR length(v_raw) > 16 THEN
        RAISE EXCEPTION 'quoted revision must be a positive safe integer' USING ERRCODE = '22023';
      END IF;
      v_quoted_revision := v_raw::bigint;
      IF v_quantity <= 0 OR v_quantity > v_max_safe
        OR v_price <= 0 OR v_price > v_max_safe
        OR v_quoted_revision <= 0 OR v_quoted_revision > v_max_safe THEN
        RAISE EXCEPTION 'order values must be positive safe integers' USING ERRCODE = '22023';
      END IF;
      IF v_quoted_revision IS DISTINCT FROM v_broker.revision THEN
        RAISE EXCEPTION '가격이 바뀌었어요. 현재 가격을 확인하고 다시 주문해 주세요.' USING ERRCODE = 'P0001';
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
        OR jsonb_typeof(p_payload -> 'quotedRevision') IS DISTINCT FROM 'number'
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(payload_key)
          WHERE payload_key NOT IN ('stockId', 'quantityShares', 'quotedPriceWon', 'quotedRevision')
        ) THEN
        RAISE EXCEPTION 'sell payload is invalid' USING ERRCODE = '22023';
      END IF;
      v_stock_id := p_payload ->> 'stockId';
      IF v_stock_id NOT IN ('jbbj', 'youtube', 'meta-comedy', 'netflix', 'adobe', 'wacom', 'slack', 'google-drive') THEN
        RAISE EXCEPTION 'market stock was not found' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM public.playground_market_events AS market_event
        WHERE market_event.stock_id = v_stock_id
          AND market_event.kind = 'halt'
          AND market_event.starts_at <= now()
          AND (market_event.ends_at IS NULL OR market_event.ends_at > now())
      ) THEN
        RAISE EXCEPTION 'market trading is halted for this stock' USING ERRCODE = 'P0001';
      END IF;
      v_raw := p_payload ->> 'quotedPriceWon';
      IF v_raw !~ '^[0-9]+$' OR length(v_raw) > 16 THEN
        RAISE EXCEPTION 'quoted price must be a positive safe integer' USING ERRCODE = '22023';
      END IF;
      v_price := v_raw::bigint;
      v_raw := p_payload ->> 'quotedRevision';
      IF v_raw !~ '^[0-9]+$' OR length(v_raw) > 16 THEN
        RAISE EXCEPTION 'quoted revision must be a positive safe integer' USING ERRCODE = '22023';
      END IF;
      v_quoted_revision := v_raw::bigint;
      IF v_price <= 0 OR v_price > v_max_safe
        OR v_quoted_revision <= 0 OR v_quoted_revision > v_max_safe THEN
        RAISE EXCEPTION 'quoted price must be a positive safe integer' USING ERRCODE = '22023';
      END IF;
      IF v_quoted_revision IS DISTINCT FROM v_broker.revision THEN
        RAISE EXCEPTION '가격이 바뀌었어요. 현재 가격을 확인하고 다시 주문해 주세요.' USING ERRCODE = 'P0001';
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

-- SECURITY DEFINER 함수의 기본 PUBLIC EXECUTE 권한을 회수한 뒤
-- 현재 단일 사용자 테스트 위협 모델에 필요한 anon 역할만 다시 허용한다.
REVOKE EXECUTE ON FUNCTION public.playground_market_execute(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.playground_market_execute(uuid, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.playground_market_execute(uuid, text, text, jsonb) TO anon;

COMMIT;
