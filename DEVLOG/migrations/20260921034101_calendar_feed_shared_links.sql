-- Created with Supabase CLI 2.81.3: migration new calendar_feed_shared_links.
-- Requires installed pgcrypto (extensions) and Supabase Vault (vault).
-- Existing primary bearer hashes remain valid; owners alone enable/rotate/revoke.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
CREATE SCHEMA IF NOT EXISTS calendar_feed_private;
REVOKE ALL ON SCHEMA calendar_feed_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE IF NOT EXISTS calendar_feed_private.aliases (
 calendar_id UUID PRIMARY KEY REFERENCES public.calendar_external_feeds(calendar_id) ON DELETE CASCADE,
 primary_hash TEXT NOT NULL CHECK(primary_hash ~ '^[0-9a-f]{64}$'),
 alias_hash TEXT NOT NULL UNIQUE CHECK(alias_hash ~ '^[0-9a-f]{64}$'),
 secret_id UUID NOT NULL UNIQUE
);
ALTER TABLE calendar_feed_private.aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON calendar_feed_private.aliases FROM PUBLIC,anon,authenticated,service_role;
-- Vault is server-side encrypted storage. Never allow browser roles to decrypt it.
REVOKE ALL ON vault.secrets,vault.decrypted_secrets FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION calendar_feed_private.cleanup_alias_secret() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 DELETE FROM vault.secrets WHERE id=OLD.secret_id;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS calendar_feed_alias_cleanup ON calendar_feed_private.aliases;
CREATE TRIGGER calendar_feed_alias_cleanup AFTER DELETE ON calendar_feed_private.aliases
FOR EACH ROW EXECUTE FUNCTION calendar_feed_private.cleanup_alias_secret();

CREATE OR REPLACE FUNCTION calendar_feed_private.refresh_alias(p_calendar_id UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE feed public.calendar_external_feeds%ROWTYPE; raw_token TEXT; secret UUID;
BEGIN
 SELECT * INTO feed FROM public.calendar_external_feeds WHERE calendar_id=p_calendar_id;
 DELETE FROM calendar_feed_private.aliases WHERE calendar_id=p_calendar_id;
 IF feed.calendar_id IS NULL THEN RETURN; END IF;
 IF NOT coalesce(feed.enabled,false) THEN RETURN; END IF;
 raw_token:=rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
 secret:=vault.create_secret(raw_token,NULL,'B flow calendar subscription alias');
 INSERT INTO calendar_feed_private.aliases(calendar_id,primary_hash,alias_hash,secret_id)
 VALUES(p_calendar_id,feed.token_hash,encode(sha256(convert_to(raw_token,'UTF8')),'hex'),secret);
END $$;

CREATE OR REPLACE FUNCTION calendar_feed_private.sync_alias() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.token_hash IS NOT DISTINCT FROM OLD.token_hash
    AND NEW.enabled IS NOT DISTINCT FROM OLD.enabled AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN RETURN NEW; END IF;
 PERFORM calendar_feed_private.refresh_alias(NEW.calendar_id);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS calendar_feed_alias_sync ON public.calendar_external_feeds;
CREATE TRIGGER calendar_feed_alias_sync AFTER INSERT OR UPDATE OF token_hash,enabled,owner_id ON public.calendar_external_feeds
FOR EACH ROW EXECUTE FUNCTION calendar_feed_private.sync_alias();

-- Backfill only missing enabled aliases; never rotate an existing subscription URL.
DO $$ DECLARE item RECORD; BEGIN
 FOR item IN SELECT f.calendar_id FROM public.calendar_external_feeds f
 LEFT JOIN calendar_feed_private.aliases a ON a.calendar_id=f.calendar_id WHERE f.enabled AND a.calendar_id IS NULL LOOP
  PERFORM calendar_feed_private.refresh_alias(item.calendar_id);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.calendar_session_feed_status(p_session_token TEXT,p_calendar_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor TEXT:=public.app_session_user_id(p_session_token); result JSONB;
BEGIN
 -- One statement snapshot: a revoked reader must never observe a subsequently
 -- rotated alias using an earlier permission check from a different snapshot.
 SELECT jsonb_build_object('calendarId',c.id,'enabled',coalesce(f.enabled,false),
  'issuedAt',CASE WHEN f.enabled THEN f.issued_at ELSE NULL END,'revision',f.revision,
  'aliasToken',CASE WHEN f.enabled THEN s.decrypted_secret ELSE NULL END)
 INTO result FROM public.calendars c
 LEFT JOIN public.calendar_external_feeds f ON f.calendar_id=c.id AND f.owner_id=c.owner_id
 LEFT JOIN calendar_feed_private.aliases a ON a.calendar_id=f.calendar_id AND a.primary_hash=f.token_hash AND f.enabled
 LEFT JOIN vault.decrypted_secrets s ON s.id=a.secret_id
 WHERE c.id=p_calendar_id AND (c.owner_id=actor OR c.visibility='team' OR EXISTS(
  SELECT 1 FROM public.calendar_members m WHERE m.calendar_id=c.id AND m.user_id=actor));
 IF result IS NULL THEN RAISE EXCEPTION '캘린더 공유 권한이 없습니다' USING ERRCODE='42501'; END IF;
 IF (result->>'enabled')::BOOLEAN AND (result->>'aliasToken' IS NULL OR result->>'aliasToken' !~ '^[A-Za-z0-9_-]{43}$') THEN
  RAISE EXCEPTION '구독 주소를 확인하지 못했습니다' USING ERRCODE='55000';
 END IF;
 RETURN result;
END $$;

-- Keep the current recurrence-aware feed implementation intact, behind a private wrapper.
DO $$ BEGIN
 IF to_regprocedure('calendar_feed_private.read_primary(text)') IS NULL THEN
  ALTER FUNCTION public.calendar_feed_read(TEXT) RENAME TO read_primary;
  ALTER FUNCTION public.read_primary(TEXT) SET SCHEMA calendar_feed_private;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.calendar_feed_read(p_token_hash TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE primary_hash TEXT;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 SELECT f.token_hash INTO primary_hash FROM calendar_feed_private.aliases a
 JOIN public.calendar_external_feeds f ON f.calendar_id=a.calendar_id AND f.token_hash=a.primary_hash AND f.enabled
 WHERE a.alias_hash=p_token_hash;
 RETURN calendar_feed_private.read_primary(coalesce(primary_hash,p_token_hash));
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA calendar_feed_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.calendar_session_feed_status(TEXT,UUID),public.calendar_feed_read(TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.calendar_session_feed_status(TEXT,UUID) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_feed_read(TEXT) TO service_role;
COMMENT ON TABLE calendar_feed_private.aliases IS 'Recoverable subscription aliases: only digests and Vault secret references; no plaintext bearer storage.';
NOTIFY pgrst,'reload schema';
COMMIT;
