import { useAuth } from '../auth/AuthContext';
import { APP_NAME, isBackendConfigured } from '../lib/config';
import { Alert, BackButton, Button, SetupRequired } from '../components/ui';

export default function Settings() {
  const { signOut } = useAuth();

  if (!isBackendConfigured()) return <SetupRequired what="Settings" />;

  return (
    <div>
      <BackButton />
      <h1 className="page-title">Application settings</h1>
      <p className="page-sub">App-level preferences. Business-specific defaults live under Businesses.</p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>About</h2>
        <p>
          <strong>{APP_NAME}</strong>
          <br />
          Phase 1 build: architecture, authentication, businesses, customers, item catalog, and the
          persistent draft editor.
        </p>
        <Alert kind="info">
          Backend: {isBackendConfigured() ? 'connected' : 'not configured'}. Invoice issuance,
          PDF generation, email, imports, and backups arrive in later phases.
        </Alert>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Sign out</h2>
        <p style={{ color: 'var(--muted)' }}>Signing out clears sensitive application state on this device.</p>
        <Button variant="secondary" onClick={() => signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
