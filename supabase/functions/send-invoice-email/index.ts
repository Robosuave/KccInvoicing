// supabase/functions/send-invoice-email/index.ts
// Sends an issued invoice by email via Resend, attaching the frozen PDF and,
// when requested, the invoice's timesheet PDF.
// Auth: caller passes their Supabase JWT; the function verifies the user and
// checks they may see the invoice (owner of the workspace, or its creator).
// Secrets required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API = 'https://api.resend.com/emails';

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

async function downloadBase64(
  sb: ReturnType<typeof createClient>,
  bucket: string,
  path: string,
): Promise<string> {
  const { data, error } = await sb.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Could not load attachment (${bucket})`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
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
    invoice_id?: string;
    to?: string;
    subject?: string;
    message?: string;
    include_timesheet?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }
  const { invoice_id: invoiceId, to, subject, message } = body;
  const includeTimesheet = body.include_timesheet !== false;
  if (!invoiceId) return json({ error: 'invoice_id is required' }, 400);
  if (!to || !isValidEmail(to)) return json({ error: 'A valid recipient email is required' }, 400);

  // Load the invoice; must be issued (frozen snapshot + stored PDF).
  const { data: invoice, error: invErr } = await sb
    .from('invoices')
    .select('id, business_id, invoice_number, status, issued_pdf_path, timesheet_path, created_by')
    .eq('id', invoiceId)
    .single();
  if (invErr || !invoice) return json({ error: 'Invoice not found' }, 404);
  if (invoice.status !== 'issued') return json({ error: 'Only issued invoices can be emailed' }, 400);
  if (!invoice.issued_pdf_path) return json({ error: 'No finalized PDF stored for this invoice' }, 400);

  // Access check: workspace owner, or the agent who created it.
  const { data: membership } = await sb
    .from('workspace_members')
    .select('role')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  const isOwner = membership?.role === 'owner';
  if (!isOwner && invoice.created_by !== user.id) {
    return json({ error: 'You do not have access to this invoice' }, 403);
  }

  const { data: business } = await sb
    .from('businesses')
    .select('id, display_name, email_from')
    .eq('id', invoice.business_id)
    .single();
  const fromEmail = (business?.email_from || '').trim();
  if (!fromEmail || !isValidEmail(fromEmail)) {
    return json({ error: 'Email is not set up yet — set a from address in Businesses > Edit business.' }, 400);
  }

  // Build the attachment list: frozen invoice PDF, plus the timesheet when asked.
  const attachments: { filename: string; content: string }[] = [];
  const invNum = invoice.invoice_number ?? invoice.id.slice(0, 8);
  try {
    attachments.push({
      filename: `Invoice-${invNum}.pdf`,
      content: await downloadBase64(sb, 'issued-pdfs', invoice.issued_pdf_path),
    });
  } catch {
    return json({ error: 'Could not load the invoice PDF' }, 500);
  }

  let timesheetIncluded = false;
  if (includeTimesheet && invoice.timesheet_path) {
    try {
      attachments.push({
        filename: `Timesheet-${invNum}.pdf`,
        content: await downloadBase64(sb, 'invoice-attachments', invoice.timesheet_path),
      });
      timesheetIncluded = true;
    } catch {
      return json({ error: 'Could not load the timesheet PDF' }, 500);
    }
  }

  const emailSubject = (subject || '').trim() ||
    `Invoice #${invoice.invoice_number ?? ''} from ${business?.display_name ?? 'us'}`.trim();
  const emailText = (message || '').trim() ||
    `Please find attached invoice #${invoice.invoice_number ?? ''}.`;

  // Record the attempt before calling the provider.
  const { data: emailRow, error: rowErr } = await sb
    .from('invoice_emails')
    .insert({
      invoice_id: invoice.id,
      business_id: invoice.business_id,
      to_email: to.trim(),
      from_email: fromEmail,
      subject: emailSubject,
      status: 'queued',
      provider: 'resend',
      created_by: user.id,
      timesheet_included: timesheetIncluded,
    })
    .select('id')
    .single();
  if (rowErr || !emailRow) return json({ error: 'Could not record the email' }, 500);

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
        to: [to.trim()],
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
    await sb.from('invoice_emails').update({ status: 'failed', error: errMsg }).eq('id', emailRow.id);
    return json({ error: errMsg }, 502);
  }

  await sb.from('invoice_emails').update({
    status: 'sent',
    provider_message_id: resendId,
    sent_at: new Date().toISOString(),
  }).eq('id', emailRow.id);

  return json({ ok: true, email_id: emailRow.id, provider_message_id: resendId });
});
