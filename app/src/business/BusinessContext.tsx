import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Business, Workspace } from '../db/types';
import { ensureWorkspace, listBusinesses } from '../data/businesses';
import { BackendNotConfiguredError } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

interface BusinessState {
  workspace: Workspace | null;
  businesses: Business[];
  activeBusiness: Business | null;
  loading: boolean;
  notConfigured: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
  /** Editor registers its dirty state here. */
  setEditorDirty: (dirty: boolean) => void;
  /** Ask to switch business; resolves true when the switch happened. */
  requestSwitch: (businessId: string) => Promise<boolean>;
  pendingSwitch: string | null;
  resolvePendingSwitch: (choice: 'save' | 'discard' | 'cancel') => void;
  onSaveDraftRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

const BusinessContext = createContext<BusinessState | null>(null);
const STORAGE_KEY = 'mbid.activeBusinessId'; // non-sensitive preference only

export function BusinessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const onSaveDraftRef = useRef<(() => Promise<boolean>) | null>(null);
  const switchResolver = useRef<((v: boolean) => void) | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setWorkspace(null);
      setBusinesses([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const ws = await ensureWorkspace();
      setWorkspace(ws);
      const list = await listBusinesses(ws.id);
      setBusinesses(list);
      setNotConfigured(false);
      setActiveBusinessId((prev) => {
        if (prev && list.some((b) => b.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (e) {
      if (e instanceof BackendNotConfiguredError) {
        setNotConfigured(true);
      } else {
        setLoadError(e instanceof Error ? e.message : 'Failed to load businesses.');
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      if (activeBusinessId) localStorage.setItem(STORAGE_KEY, activeBusinessId);
    } catch {
      /* non-critical */
    }
  }, [activeBusinessId]);

  const setEditorDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const doSwitch = useCallback(
    (businessId: string) => {
      setActiveBusinessId(businessId);
      dirtyRef.current = false;
    },
    [],
  );

  const requestSwitch = useCallback(
    (businessId: string): Promise<boolean> => {
      if (businessId === activeBusinessId) return Promise.resolve(false);
      if (!dirtyRef.current) {
        doSwitch(businessId);
        return Promise.resolve(true);
      }
      // Unsaved changes: offer Save draft / Discard / Cancel (spec §1).
      setPendingSwitch(businessId);
      return new Promise((resolve) => {
        switchResolver.current = resolve;
      });
    },
    [activeBusinessId, doSwitch],
  );

  const resolvePendingSwitch = useCallback(
    async (choice: 'save' | 'discard' | 'cancel') => {
      const target = pendingSwitch;
      setPendingSwitch(null);
      const resolve = switchResolver.current;
      switchResolver.current = null;
      if (!target || choice === 'cancel' || !resolve) {
        resolve?.(false);
        return;
      }
      if (choice === 'save') {
        const saver = onSaveDraftRef.current;
        if (saver) {
          const ok = await saver();
          if (!ok) {
            resolve(false);
            return;
          }
        }
      }
      doSwitch(target);
      resolve(true);
    },
    [pendingSwitch, doSwitch],
  );

  const activeBusiness = businesses.find((b) => b.id === activeBusinessId) ?? null;

  return (
    <BusinessContext.Provider
      value={{
        workspace,
        businesses,
        activeBusiness,
        loading,
        notConfigured,
        loadError,
        refresh,
        setEditorDirty,
        requestSwitch,
        pendingSwitch,
        resolvePendingSwitch,
        onSaveDraftRef,
      }}
    >
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusiness(): BusinessState {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error('useBusiness must be used within BusinessProvider');
  return ctx;
}
