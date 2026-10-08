-- Transactional production check: synthetic rows only; no raw tokens returned.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $smoke$
DECLARE
 owner_id TEXT:='feed-smoke-'||gen_random_uuid()::TEXT;
 reader_id TEXT:='feed-smoke-'||gen_random_uuid()::TEXT;
 outsider_id TEXT:='feed-smoke-'||gen_random_uuid()::TEXT;
 source_id UUID:=gen_random_uuid();
 owner_token TEXT:=encode(extensions.gen_random_bytes(32),'hex');
 reader_token TEXT:=encode(extensions.gen_random_bytes(32),'hex');
 outsider_token TEXT:=encode(extensions.gen_random_bytes(32),'hex');
 primary_a TEXT:=encode(sha256(extensions.gen_random_bytes(32)),'hex');
 primary_b TEXT:=encode(sha256(extensions.gen_random_bytes(32)),'hex');
 first JSONB; rotated JSONB; current_state JSONB; payload JSONB;
 first_hash TEXT; second_hash TEXT; saved_secret UUID; denied BOOLEAN:=false;
BEGIN
 INSERT INTO public.users(id,name,role) VALUES(owner_id,owner_id,'user'),(reader_id,reader_id,'user'),(outsider_id,outsider_id,'admin');
 INSERT INTO public.app_sessions(token_hash,user_id,expires_at) VALUES
 (encode(sha256(convert_to(owner_token,'UTF8')),'hex'),owner_id,now()+interval '5 minutes'),
 (encode(sha256(convert_to(reader_token,'UTF8')),'hex'),reader_id,now()+interval '5 minutes'),
 (encode(sha256(convert_to(outsider_token,'UTF8')),'hex'),outsider_id,now()+interval '5 minutes');
 INSERT INTO public.calendars(id,name,owner_id,visibility) VALUES(source_id,'TRANSACTIONAL FEED SMOKE',owner_id,'members');
 INSERT INTO public.calendar_members(calendar_id,user_id,can_edit) VALUES(source_id,reader_id,false);
 INSERT INTO public.calendar_events(calendar_id,title,start_date,end_date,recurrence_rule)
 VALUES(source_id,'Synthetic recurring event','2026-09-21','2026-09-21','{"frequency":"weekly","interval":1,"count":3}'::JSONB);
 first:=public.calendar_session_feed_manage(owner_token,source_id,'enable',primary_a,NULL);
 IF first->>'aliasToken' IS NULL OR first->>'aliasToken' !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'SMOKE alias issuance failed'; END IF;
 IF public.calendar_session_feed_status(reader_token,source_id) IS DISTINCT FROM first THEN RAISE EXCEPTION 'SMOKE reader/reopen mismatch'; END IF;
 first_hash:=encode(sha256(convert_to(first->>'aliasToken','UTF8')),'hex');
 SELECT secret_id INTO saved_secret FROM calendar_feed_private.aliases WHERE calendar_id=source_id;
 IF NOT EXISTS(SELECT 1 FROM vault.secrets WHERE id=saved_secret AND secret::TEXT<>first->>'aliasToken') THEN RAISE EXCEPTION 'SMOKE encrypted secret missing'; END IF;
 payload:=public.calendar_feed_read(primary_a);
 IF payload IS DISTINCT FROM public.calendar_feed_read(first_hash) OR payload->'events'->0->'recurrence_rule'->>'frequency'<>'weekly' THEN RAISE EXCEPTION 'SMOKE alias/primary/recurrence mismatch'; END IF;
 BEGIN PERFORM public.calendar_session_feed_manage(reader_token,source_id,'revoke',NULL,(first->>'revision')::UUID);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'SMOKE viewer manage accepted'; END IF;
 denied:=false;
 BEGIN PERFORM public.calendar_session_feed_status(outsider_token,source_id);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'SMOKE unrelated admin read accepted'; END IF;
 DELETE FROM public.calendar_members WHERE calendar_id=source_id AND user_id=reader_id;
 denied:=false;
 BEGIN PERFORM public.calendar_session_feed_status(reader_token,source_id);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'SMOKE revoked member read accepted'; END IF;
 UPDATE public.calendars SET visibility='team' WHERE id=source_id;
 IF public.calendar_session_feed_status(reader_token,source_id)->>'aliasToken' IS DISTINCT FROM first->>'aliasToken' THEN RAISE EXCEPTION 'SMOKE team read mismatch'; END IF;
 rotated:=public.calendar_session_feed_manage(owner_token,source_id,'rotate',primary_b,(first->>'revision')::UUID);
 second_hash:=encode(sha256(convert_to(rotated->>'aliasToken','UTF8')),'hex');
 IF public.calendar_feed_read(primary_a) IS NOT NULL OR public.calendar_feed_read(first_hash) IS NOT NULL
 OR public.calendar_feed_read(primary_b) IS NULL OR public.calendar_feed_read(second_hash) IS NULL THEN RAISE EXCEPTION 'SMOKE rotation lifecycle failed'; END IF;
 IF EXISTS(SELECT 1 FROM vault.secrets WHERE id=saved_secret) THEN RAISE EXCEPTION 'SMOKE old Vault secret remains'; END IF;
 IF public.calendar_session_feed_manage(owner_token,source_id,'rotate',primary_b,(first->>'revision')::UUID) IS DISTINCT FROM rotated THEN RAISE EXCEPTION 'SMOKE retry changed alias'; END IF;
 denied:=false;
 BEGIN PERFORM public.calendar_session_feed_manage(owner_token,source_id,'revoke',NULL,(first->>'revision')::UUID);
 EXCEPTION WHEN serialization_failure THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'SMOKE stale CAS accepted'; END IF;
 current_state:=public.calendar_session_feed_manage(owner_token,source_id,'revoke',NULL,(rotated->>'revision')::UUID);
 IF current_state->>'aliasToken' IS NOT NULL OR public.calendar_feed_read(primary_b) IS NOT NULL OR public.calendar_feed_read(second_hash) IS NOT NULL THEN RAISE EXCEPTION 'SMOKE revoke failed'; END IF;
 current_state:=public.calendar_session_feed_manage(owner_token,source_id,'enable',primary_a,(current_state->>'revision')::UUID);
 UPDATE public.calendars SET owner_id=reader_id WHERE id=source_id;
 IF public.calendar_feed_read(primary_a) IS NOT NULL OR EXISTS(SELECT 1 FROM calendar_feed_private.aliases WHERE calendar_id=source_id) THEN RAISE EXCEPTION 'SMOKE transfer failed'; END IF;
 DELETE FROM public.calendars WHERE id=source_id;
 IF has_schema_privilege('anon','calendar_feed_private','USAGE') OR has_schema_privilege('authenticated','calendar_feed_private','USAGE')
 OR has_function_privilege('anon','public.calendar_feed_read(text)','EXECUTE')
 OR has_function_privilege('service_role','calendar_feed_private.read_primary(text)','EXECUTE')
 OR has_table_privilege('anon','vault.decrypted_secrets','SELECT')
 OR has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') THEN RAISE EXCEPTION 'SMOKE unexpected direct grants'; END IF;
END $smoke$;
ROLLBACK;
SELECT 'calendar_feed_shared_links: all synthetic assertions passed; rolled back' AS result;
