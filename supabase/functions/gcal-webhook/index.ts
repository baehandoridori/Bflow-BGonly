// supabase/functions/gcal-webhook/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const resourceState = req.headers.get('X-Goog-Resource-State');
  const channelToken = req.headers.get('X-Goog-Channel-Token') || '';
  const channelId = req.headers.get('X-Goog-Channel-ID');
  const resourceId = req.headers.get('X-Goog-Resource-ID');

  // 토큰 형식: "secret:userId"
  const [secret, userId] = channelToken.split(':');
  const expectedSecret = Deno.env.get('GCAL_WEBHOOK_TOKEN');

  if (secret !== expectedSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  // sync 알림은 채널 생성 확인용
  if (resourceState === 'sync') {
    console.log(`[gcal-webhook] sync received for channel ${channelId}`);
    return new Response('OK', { status: 200 });
  }

  // 변경 발생 → Realtime Broadcast
  if (resourceState === 'exists') {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const channel = supabase.channel('gcal-sync');

    await channel.send({
      type: 'broadcast',
      event: 'calendar-changed',
      payload: {
        userId: userId || null,
        channelId,
        resourceId,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[gcal-webhook] broadcast sent for user ${userId}`);
  }

  return new Response('OK', { status: 200 });
});
