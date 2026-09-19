import { createCalendarFeedHandler } from './handler.ts';
import type { CalendarFeed } from '../_shared/calendarIcs.ts';

// No client SDK or third-party dependencies. The service key exists only in Edge
// secrets; neither it nor bearer URLs are included in logs or error responses.
Deno.serve(createCalendarFeedHandler({
  async readFeed(tokenHash:string):Promise<CalendarFeed|null> {
    const url=Deno.env.get('SUPABASE_URL');const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!url||!key)throw new Error('Feed service unavailable');
    const response=await fetch(url.replace(/\/$/,'')+'/rest/v1/rpc/calendar_feed_read',{
      method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({p_token_hash:tokenHash}),signal:AbortSignal.timeout(15000),
    });
    if(!response.ok)throw new Error('Feed service unavailable');
    return await response.json() as CalendarFeed|null;
  },
}));
