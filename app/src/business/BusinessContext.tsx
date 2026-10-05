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
import { redeemInvites } from '../data/team';
import { requireSupabase, BackendNotConfiguredError } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

interface BusinessState {
  workspace: Workspace | null;
  businesses: Business[];
  activeBusiness: Business | null;
  /** True when the signed-in user owns the workspace (full access). Agents get false. */
  isOwner: boolean;
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
  onSaveDraftRef: React.MutableRefObject<(() => Promise<string | null>) | null>;
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
  // Start true so the first paint shows "Loading…" instead of flashing the
  // "no business" empty state before businesses have been fetched.
  const [loading, setLoading] = useState(true);
  const [notConfigured, setNotConfigured] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const onSaveDraftRef = useRef<(() => Promise<string | null>) | null>(null);
  const switchResolver = useRef<((v: boolean) => void) | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setWorkspace(null);
      setBusinesses([]);
      setIsOwner(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      // Redeem email invites BEFORE ensureWorkspace, so an invited agent
      // joins the existing workspace instead of getting their own.
      await redeemInvites();
      const ws = await ensureWorkspace();
      setWorkspace(ws);
      const sb = requireSupabase();
      const { data: membership } = await sb
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', ws.id)
        .eq('user_id', user.id)
        .single();
      setIsOwner(membership?.role === 'owner');
      const list = await listBusinesses(ws.id);
      // Agents only see their assigned businesses
      let visibleList = list;
      if (membership?.role !== 'owner') {
        const { data: bizMembers } = await sb
          .from('business_members')
          .select('business_id')
          .eq('user_id', user.id);
        if (bizMembers && bizMembers.length > 0) {
          const allowedIds = new Set(bizMembers.map((m) => m.business_id));
          visibleList = list.filter((b) => allowedIds.has(b.id));
        }
      }
      setBusinesses(visibleList);
      setNotConfigured(false);
      setActiveBusinessId((prev) => {
        if (prev && visibleList.some((b) => b.id === prev)) return prev;
        return visibleList[0]?.id ?? null;
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
        isOwner,
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
