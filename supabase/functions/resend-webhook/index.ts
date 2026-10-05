// supabase/functions/resend-webhook/index.ts
// Receives Resend delivery events and updates invoice_emails status.
// No auth header — authenticity is verified via the Svix webhook signature.
// Secrets required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_WEBHOOK_SECRET.
// In Resend: Developers > Webhooks > Add webhook, URL = <project>/functions/v1/resend-webhook,
// subscribe to: email.sent, email.delivered, email.opened, email.bounced, email.failed.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Verifies a Svix-style signature: v1,<base64 hmac_sha256(secret, "id.timestamp.payload")>. */
async function verifySignature(secret: string, headers: Headers, payload: string): Promise<boolean> {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signature = headers.get('svix-signature');
  if (!id || !timestamp || !signature) return false;
  const signed = `${id}.${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return signature.split(' ').some((part) => {
    const [, sig] = part.split(',');
    return sig === expected;
  });
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  if (!webhookSecret) return json({ error: 'Webhook not configured' }, 500);

  const payload = await req.text();
  if (!(await verifySignature(webhookSecret, req.headers, payload))) {
    return json({ error: 'Invalid signature' }, 401);
  }

  let event: { type?: string; data?: { email_id?: string; [k: string]: unknown } };
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const emailId = event.data?.email_id;
  if (!emailId) return json({ ok: true, skipped: 'no email_id' });

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  switch (event.type) {
    case 'email.sent':
      patch.status = 'sent';
      patch.sent_at = now;
      break;
    case 'email.delivered':
      patch.status = 'delivered';
      patch.delivered_at = now;
      break;
    case 'email.opened':
      patch.status = 'opened';
      patch.opened_at = now;
      break;
    case 'email.bounced':
      patch.status = 'bounced';
      break;
    case 'email.failed':
      patch.status = 'failed';
      patch.error = 'Delivery failed (provider event)';
      break;
    default:
      return json({ ok: true, skipped: `unhandled ${event.type}` });
  }

  const sb = createClient(supabaseUrl, serviceKey);
  // Don't downgrade: delivered/opened must not be overwritten by a late 'sent'.
  const { data: existing } = await sb
    .from('invoice_emails')
    .select('id, status')
    .eq('provider_message_id', emailId)
    .maybeSingle();
  if (!existing) return json({ ok: true, skipped: 'unknown email_id' });
  const rank: Record<string, number> = { queued: 0, failed: 1, bounced: 1, sent: 2, delivered: 3, opened: 4 };
  if ((rank[String(existing.status)] ?? 0) > (rank[String(patch.status)] ?? 0)) {
    return json({ ok: true, skipped: 'stale event' });
  }

  await sb.from('invoice_emails').update(patch).eq('id', existing.id);
  return json({ ok: true });
});
