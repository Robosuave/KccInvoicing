import { useCallback, useEffect, useState } from 'react';
import { useBusiness } from '../business/BusinessContext';
import { APP_URL } from '../lib/config';
import {
  cancelInvite,
  inviteAgent,
  listBusinessInvites,
  listBusinessMembers,
  removeMember,
  type BusinessInvite,
  type BusinessMember,
} from '../data/team';
import { Alert, Button, EmptyState, Field, TextField } from '../components/ui';

/** Link that drops a new agent straight onto account creation with their email prefilled. */
export function inviteLinkFor(inviteEmail: string): string {
  const params = new URLSearchParams({ signup: '1', email: inviteEmail });
  return `${APP_URL}/login?${params.toString()}`;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for browsers without async clipboard access.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

export default function Team() {
  const { businesses, isOwner } = useBusiness();
  const [businessId, setBusinessId] = useState<string>('');
  const [members, setMembers] = useState<BusinessMember[]>([]);
  const [invites, setInvites] = useState<BusinessInvite[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Default to Dania Realty when present.
  useEffect(() => {
    if (!businessId && businesses.length > 0) {
      const dania = businesses.find((b) => /dania/i.test(b.display_name));
      setBusinessId((dania ?? businesses[0]).id);
    }
  }, [businesses, businessId]);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const [m, i] = await Promise.all([
        listBusinessMembers(businessId),
        listBusinessInvites(businessId),
      ]);
      setMembers(m);
      setInvites(i);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the team.');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const copyInviteLink = async (link: string) => {
    await copyText(link);
    setCopied(true);
    setNotice('Invite link copied — paste it into a text message to the agent.');
    window.setTimeout(() => setCopied(false), 2000);
  };

  const doInvite = async () => {
    if (!businessId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const inviteEmail = email.trim();
      await inviteAgent(businessId, inviteEmail);
      setEmail('');
      setLastInviteLink(inviteLinkFor(inviteEmail));
      setNotice(
        'Invite sent. Text the agent the invite link below — it takes them straight to creating their account.',
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the invite.');
    } finally {
      setSaving(false);
    }
  };

  const doCancelInvite = async (id: string) => {
    try {
      await cancelInvite(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel the invite.');
    }
  };

  const doRemove = async (userId: string, memberEmail: string) => {
    if (!window.confirm(`Remove ${memberEmail} from this business? They will lose access immediately.`)) return;
    try {
      await removeMember(businessId, userId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the member.');
    }
  };

  if (!isOwner) {
    return (
      <EmptyState
        title="Team management is for the owner"
        body="Only the workspace owner can invite agents."
      />
    );
  }

  const business = businesses.find((b) => b.id === businessId);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Team</h1>
      <p style={{ color: 'var(--muted)', maxWidth: 640 }}>
        Invite agents by email. An invited agent signs up with that email address and gets access
        to <strong>only the selected business</strong> — they can create invoices for it, but they
        never see your other businesses or settings.
      </p>

      {businesses.length > 1 && (
        <div style={{ maxWidth: 420, marginBottom: 16 }}>
          <Field label="Business" htmlFor="team-business">
            <select
              id="team-business"
              className="input"
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value)}
            >
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.display_name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 12 }}>
          <Alert kind="error">{error}</Alert>
        </div>
      )}
      {notice && (
        <div style={{ marginBottom: 12 }}>
          <Alert kind="success">{notice}</Alert>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Invite an agent{business ? ` to ${business.display_name}` : ''}</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px' }}>
            <Field label="Agent's email address" htmlFor="team-email">
              <TextField
                id="team-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="agent@example.com"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') doInvite();
                }}
              />
            </Field>
          </div>
          <Button onClick={doInvite} disabled={saving || !email.trim()}>
            {saving ? 'Sending…' : 'Send invite'}
          </Button>
        </div>
      </div>

      {lastInviteLink && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
          <h2 style={{ marginTop: 0 }}>Invite link — text this to the agent</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 0 }}>
            It opens the app directly on account creation with their email already filled in.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px' }}>
              <TextField value={lastInviteLink} readOnly onFocus={(e) => e.target.select()} aria-label="Invite link" />
            </div>
            <Button onClick={() => copyInviteLink(lastInviteLink)}>
              {copied ? 'Copied!' : 'Copy link'}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : (
        <>
          <h2>Agents with access</h2>
          {members.length === 0 ? (
            <p style={{ color: 'var(--muted)' }}>No agents yet — just you (the owner).</p>
          ) : (
            <div className="table-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Added</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.user_id}>
                      <td>{m.email}</td>
                      <td style={{ fontSize: 14, color: 'var(--muted)' }}>
                        {new Date(m.created_at).toLocaleDateString()}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <Button variant="ghost" size="sm" onClick={() => doRemove(m.user_id, m.email)}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {invites.length > 0 && (
            <>
              <h2 style={{ marginTop: 24 }}>Pending invites</h2>
              <div className="table-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Invited</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((i) => (
                      <tr key={i.id}>
                        <td>{i.email}</td>
                        <td style={{ fontSize: 14, color: 'var(--muted)' }}>
                          {new Date(i.created_at).toLocaleDateString()}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                          <Button variant="ghost" size="sm" onClick={() => copyInviteLink(inviteLinkFor(i.email))}>
                            Copy link
                          </Button>{' '}
                          <Button variant="ghost" size="sm" onClick={() => doCancelInvite(i.id)}>
                            Cancel
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
