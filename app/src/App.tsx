import { useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { BusinessProvider, useBusiness } from './business/BusinessContext';
import { APP_NAME } from './lib/config';
import { Button, Modal } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Businesses from './pages/Businesses';
import Customers from './pages/Customers';
import Items from './pages/Items';
import Invoices from './pages/Invoices';
import InvoiceEditor from './pages/InvoiceEditor';
import Settings from './pages/Settings';
import Team from './pages/Team';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p style={{ padding: 40 }}>Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function OwnerRoute({ children }: { children: ReactNode }) {
  const { isOwner, loading } = useBusiness();
  if (loading) return <p style={{ padding: 40 }}>Loading…</p>;
  if (!isOwner) return <Navigate to="/" replace />;
  return children;
}

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/invoices', label: 'Invoices' },
  { to: '/customers', label: 'Customers' },
  { to: '/items', label: 'Products & services' },
  { to: '/businesses', label: 'Businesses', ownerOnly: true },
  { to: '/team', label: 'Team', ownerOnly: true },
  { to: '/settings', label: 'Settings' },
];

function BusinessSwitcher() {
  const { businesses, activeBusiness, requestSwitch } = useBusiness();
  if (businesses.length === 0) return null;
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
      <span className="sr-only">Active business</span>
      <select
        className="input"
        style={{ width: 'auto', minHeight: 44 }}
        aria-label="Switch business"
        value={activeBusiness?.id ?? ''}
        onChange={(e) => requestSwitch(e.target.value)}
      >
        {businesses.map((b) => (
          <option key={b.id} value={b.id}>
            {b.display_name}
          </option>
        ))}
      </select>
    </label>
  );
}

function PendingSwitchModal() {
  const { pendingSwitch, businesses, resolvePendingSwitch } = useBusiness();
  if (!pendingSwitch) return null;
  const target = businesses.find((b) => b.id === pendingSwitch);
  return (
    <Modal title="Unsaved invoice changes" onClose={() => resolvePendingSwitch('cancel')}>
      <p>
        You have unsaved changes in the current draft. What should happen before switching to{' '}
        <strong>{target?.display_name ?? 'the other business'}</strong>?
      </p>
      <div className="btn-row">
        <Button onClick={() => resolvePendingSwitch('save')}>Save draft</Button>
        <Button variant="secondary" onClick={() => resolvePendingSwitch('discard')}>
          Discard changes
        </Button>
        <Button variant="ghost" onClick={() => resolvePendingSwitch('cancel')}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

function Shell() {
  const { activeBusiness, isOwner } = useBusiness();
  const { signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="app-shell">
      <aside className={`sidebar${menuOpen ? ' open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <div className="brand-name">{APP_NAME}</div>
          <div className="brand-sub">Phase 1</div>
        </div>
        {NAV.filter((n) => !n.ownerOnly || isOwner).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            onClick={() => setMenuOpen(false)}
          >
            {n.label}
          </NavLink>
        ))}
        <div className="sidebar-footer">
          <button
            className="nav-link"
            style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', color: '#dbe4f2' }}
            onClick={() => signOut()}
          >
            Sign out
          </button>
          <div style={{ padding: '10px 14px 0' }}>Data stays in your database</div>
        </div>
      </aside>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <div className="main">
        <div className="topbar">
          <button className="menu-toggle" onClick={() => setMenuOpen((v) => !v)} aria-label="Open menu">
            ☰
          </button>
          {activeBusiness && (
            <span className="active-business-pill" title="Active business">
              {activeBusiness.display_name}
            </span>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <BusinessSwitcher />
          </div>
        </div>
        <main className="content" key={location.pathname}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/invoices/new" element={<InvoiceEditor />} />
            <Route path="/invoices/:id" element={<InvoiceEditor />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/items" element={<Items />} />
            <Route path="/businesses" element={<OwnerRoute><Businesses /></OwnerRoute>} />
            <Route path="/team" element={<OwnerRoute><Team /></OwnerRoute>} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <PendingSwitchModal />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <BusinessProvider>
                  <Shell />
                </BusinessProvider>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
