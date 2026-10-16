// supabase/functions/send-boardup-email/index.ts
// Sends a board-up job email via Resend with two condensed PDF attachments:
// the job-information PDF and the pictures PDF (both built client-side by the
// Aquick app; photos are already downscaled before embedding, so what the
// customer receives is always the condensed version, never full size).
// Auth: caller passes their Supabase JWT; the function verifies the user and
// checks they belong to the workspace.
// Secrets required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API = 'https://api.resend.com/emails';
/** Fallback sender when the business has no email_from set. Domain must be verified in Resend. */
const FALLBACK_FROM = 'aquick@kalekycomputer.com';
/** Total attachment budget (decoded bytes). Resend allows 40MB per email; stay well under. */
const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024;

// Browser calls via supabase-js send Authorization + apikey headers, which
// trigger a CORS preflight. Answer it, and tag every response.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  if (!resendKey) return json({ error: 'Email is not set up yet (missing provider key).' }, 503);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401);

  const sb = createClient(supabaseUrl, serviceKey);
  const { data: userData, error: userErr } = await sb.auth.getUser(authHeader.slice(7));
  const user = userData?.user;
  if (userErr || !user) return json({ error: 'Not signed in' }, 401);

  let body: {
    business_id?: string;
    to?: string;
    subject?: string;
    message?: string;
    attachments?: { filename?: string; content?: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const to = (body.to || '').trim();
  if (!isValidEmail(to)) return json({ error: 'A valid recipient email is required' }, 400);

  const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (rawAttachments.length === 0 || rawAttachments.length > 4) {
    return json({ error: 'Attach 1 to 4 PDF files' }, 400);
  }
  let totalBytes = 0;
  const attachments: { filename: string; content: string }[] = [];
  for (const a of rawAttachments) {
    const filename = (a?.filename || '').trim();
    const content = (a?.content || '').replace(/\s+/g, '');
    if (!filename || !content || !/^[A-Za-z0-9+/=]+$/.test(content)) {
      return json({ error: 'One of the attachments is invalid' }, 400);
    }
    // Base64 is ~4/3 the size of the decoded bytes.
    totalBytes += Math.floor((content.length * 3) / 4);
    attachments.push({ filename, content });
  }
  if (totalBytes > MAX_ATTACHMENTS_BYTES) {
    return json({ error: 'Attachments are too large to email' }, 400);
  }

  // Access check: the sender must belong to the workspace.
  const { data: membership } = await sb
    .from('workspace_members')
    .select('role')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return json({ error: 'You do not have access to send email' }, 403);

  // Sender: the business's from-address, or the Aquick default.
  let fromEmail = FALLBACK_FROM;
  if (body.business_id) {
    const { data: business } = await sb
      .from('businesses')
      .select('id, email_from')
      .eq('id', body.business_id)
      .single();
    const configured = (business?.email_from || '').trim();
    if (configured && isValidEmail(configured)) fromEmail = configured;
  }

  const emailSubject = (body.subject || '').trim() || 'Board-up job';
  const emailText = (body.message || '').trim() || 'Please see the attached job files.';

  // Send via Resend.
  let resendId: string | null = null;
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject: emailSubject,
        text: emailText,
        attachments,
      }),
    });
    const resJson = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(resJson?.message || `Provider error (${res.status})`);
    }
    resendId = resJson?.id ?? null;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Send failed';
    return json({ error: errMsg }, 502);
  }

  return json({ ok: true, provider_message_id: resendId });
});
