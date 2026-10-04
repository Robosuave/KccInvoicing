import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getSupabase } from '../lib/supabase';
import { APP_NAME, isBackendConfigured } from '../lib/config';
import { Alert, Button, Field, SetupRequired, TextField } from '../components/ui';

/**
 * Handles the password-recovery link emailed by Supabase. The Supabase client
 * automatically exchanges the recovery token in the URL for a session on load;
 * the user then chooses a new password.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [valid, setValid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setReady(true);
      return;
    }
    // Give the client a moment to process the recovery token in the URL.
    const t = setTimeout(async () => {
      const { data } = await sb.auth.getSession();
      setValid(!!data.session);
      setReady(true);
    }, 800);
    return () => clearTimeout(t);
  }, []);

  if (!isBackendConfigured()) {
    return <SetupRequired what="Password reset" />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    const sb = getSupabase();
    if (!sb) {
      setError('Backend not configured.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 440, margin: '80px auto', padding: '0 16px' }}>
      <div className="card">
        <h1 className="page-title">{APP_NAME}</h1>
        <p className="page-sub">Choose a new password for your account.</p>
        {!ready ? (
          <p>Checking your reset link…</p>
        ) : done ? (
          <>
            <Alert kind="success">Password updated — you can now sign in with your new password.</Alert>
            <Button style={{ width: '100%' }} onClick={() => navigate('/login', { replace: true })}>
              Go to sign in
            </Button>
          </>
        ) : !valid ? (
          <>
            <Alert kind="error">
              This reset link is invalid or has expired. Request a new one from the sign-in screen.
            </Alert>
            <Link className="btn btn-secondary" style={{ width: '100%' }} to="/login">
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={submit}>
            {error && <Alert kind="error">{error}</Alert>}
            <Field label="New password" htmlFor="new-password">
              <div style={{ position: 'relative' }}>
                <TextField
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ paddingRight: 64 }}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </Field>
            <Field label="Confirm new password" htmlFor="confirm-password">
              <TextField
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Please wait…' : 'Update password'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
