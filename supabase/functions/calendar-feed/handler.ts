import { serializeCalendarIcs, type CalendarFeed } from '../_shared/calendarIcs.ts';
export interface CalendarFeedDependencies {readFeed(tokenHash:string):Promise<CalendarFeed|null>}
const headers={
  'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'X-Robots-Tag':'noindex, nofollow, noarchive','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
};
export function createCalendarFeedHandler(dependencies:CalendarFeedDependencies):(request:Request)=>Promise<Response> {
  return async(request:Request)=>{
    const respond=(body:string,status:number,extra:Record<string,string>={})=>new Response(request.method==='HEAD'?null:body,{status,headers:{...headers,'Content-Type':'text/plain; charset=utf-8',...extra}});
    if(request.method!=='GET'&&request.method!=='HEAD')return respond('Method not allowed',405,{Allow:'GET, HEAD'});
    const url=new URL(request.url);const match=/^\/(?:functions\/v1\/)?calendar-feed\/([A-Za-z0-9_-]{43})\.ics$/.exec(url.pathname);
    if(!match||url.search)return respond('Calendar not found',404);
    try {
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(match[1]));
      const hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
      // Authenticate every poll, including HEAD/conditional requests: never serve a
      // cached 304 after rotation/revocation. Request URLs/tokens are never logged.
      const feed=await dependencies.readFeed(hash);if(!feed)return respond('Calendar not found',404);
      return respond(serializeCalendarIcs(feed),200,{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'inline; filename="bflow-calendar.ics"'});
    }catch{return respond('Calendar temporarily unavailable',503,{'Retry-After':'60'});}
  };
}
