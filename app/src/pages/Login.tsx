import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getSupabase } from '../lib/supabase';
import { APP_NAME, isBackendConfigured } from '../lib/config';
import { Alert, Button, Field, SetupRequired, TextField } from '../components/ui';

export default function Login() {
  const { signIn, authError } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isBackendConfigured()) {
    return <SetupRequired what="Sign-in" />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        const sb = getSupabase();
        if (!sb) throw new Error('Backend not configured.');
        const { error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        await signIn(email, password);
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 440, margin: '80px auto', padding: '0 16px' }}>
      <div className="card">
        <h1 className="page-title">{APP_NAME}</h1>
        <p className="page-sub">{mode === 'signin' ? 'Sign in to your invoice desk.' : 'Create your account. Invited agents: sign up with the email address the invite was sent to.'}</p>
        {(error || authError) && <Alert kind="error">{error ?? authError}</Alert>}
        <form onSubmit={submit}>
          <Field label="Email" htmlFor="email">
            <TextField
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <TextField
              id="password"
              type="password"
              required
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create owner account'}
          </Button>
        </form>
        <p style={{ marginTop: 16, fontSize: 14 }}>
          {mode === 'signin' ? (
            <>
              No account yet?{' '}
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setMode('signup')}>
                Create the owner account
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setMode('signin')}>
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
