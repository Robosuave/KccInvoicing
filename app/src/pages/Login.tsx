import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getSupabase } from '../lib/supabase';
import { APP_NAME, APP_URL, isBackendConfigured } from '../lib/config';
import { Alert, Button, Field, SetupRequired, TextField } from '../components/ui';

export default function Login() {
  const { signIn, authError } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Invite links land here as /login?signup=1&email=agent@x.com — open directly
  // on account creation with the invited email prefilled.
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>(() =>
    searchParams.get('signup') === '1' || searchParams.get('mode') === 'signup' ? 'signup' : 'signin',
  );
  const [email, setEmail] = useState(() => searchParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  if (!isBackendConfigured()) {
    return <SetupRequired what="Sign-in" />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'forgot') {
        const sb = getSupabase();
        if (!sb) throw new Error('Backend not configured.');
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${APP_URL}/reset-password`,
        });
        if (error) throw error;
        setResetSent(true);
      } else if (mode === 'signin') {
        await signIn(email, password);
        navigate('/', { replace: true });
      } else {
        const sb = getSupabase();
        if (!sb) throw new Error('Backend not configured.');
        const { error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        await signIn(email, password);
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (m: 'signin' | 'signup' | 'forgot') => {
    setMode(m);
    setError(null);
    setResetSent(false);
  };

  return (
    <div style={{ maxWidth: 440, margin: '80px auto', padding: '0 16px' }}>
      <div className="card">
        <h1 className="page-title">{APP_NAME}</h1>
        <p className="page-sub">
          {mode === 'signin' && 'Sign in to your invoice desk.'}
          {mode === 'signup' &&
            (searchParams.get('email')
              ? 'You\u2019ve been invited to the team — create your account below with your invited email address.'
              : 'Create your account. Team members: sign up with the email address the invite was sent to.')}
          {mode === 'forgot' && 'Enter your account email and we\u2019ll send you a link to reset your password.'}
        </p>
        {(error || authError) && <Alert kind="error">{error ?? authError}</Alert>}
        {mode === 'forgot' && resetSent ? (
          <Alert kind="success">
            Reset link sent — check your inbox for an email from us, then follow the link to choose a new password.
          </Alert>
        ) : (
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
          {mode !== 'forgot' && (
          <Field label="Password" htmlFor="password">
            <div style={{ position: 'relative' }}>
              <TextField
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
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
          )}
          {mode === 'signin' && (
            <p style={{ marginTop: -8, marginBottom: 16, fontSize: 14, textAlign: 'right' }}>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => switchMode('forgot')}>
                Forgot password?
              </button>
            </p>
          )}
          <Button type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
          </Button>
        </form>
        )}
        <p style={{ marginTop: 16, fontSize: 14 }}>
          {mode === 'signin' && (
            <>
              No account yet?{' '}
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => switchMode('signup')}>
                Create an account
              </button>
            </>
          )}
          {mode === 'signup' && (
            <>
              Already have an account?{' '}
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => switchMode('signin')}>
                Sign in
              </button>
            </>
          )}
          {mode === 'forgot' && (
            <>
              Remembered it?{' '}
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => switchMode('signin')}>
                Back to sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
