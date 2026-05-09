import { create } from 'zustand';
import type { AuthSession, Subscription } from '@/types';
import { data } from '@/data';

interface AuthState {
  session: AuthSession | null;
  subscription: Subscription | null;
  loading: boolean;
  activeBranchId: string | null;
  init: () => Promise<void>;
  signOut: () => Promise<void>;
  setSession: (s: AuthSession | null) => void;
  setActiveBranch: (id: string) => void;
  refreshSubscription: () => Promise<void>;
}

async function loadSubscription(): Promise<Subscription | null> {
  try {
    return await data.getSubscription();
  } catch {
    return null;
  }
}

export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  subscription: null,
  loading: true,
  activeBranchId: null,
  init: async () => {
    try {
      const s = await data.currentSession();
      const sub = s ? await loadSubscription() : null;
      set({
        session: s,
        subscription: sub,
        loading: false,
        activeBranchId: s?.branchId ?? null,
      });
    } catch {
      set({ session: null, subscription: null, loading: false, activeBranchId: null });
    }
  },
  signOut: async () => {
    await data.logout();
    set({ session: null, subscription: null, activeBranchId: null });
  },
  setSession: (s) => {
    set({ session: s, activeBranchId: s?.branchId ?? null });
    if (s) {
      void loadSubscription().then((sub) => set({ subscription: sub }));
    } else {
      set({ subscription: null });
    }
  },
  setActiveBranch: (id) => set({ activeBranchId: id }),
  refreshSubscription: async () => {
    if (!get().session) return;
    const sub = await loadSubscription();
    set({ subscription: sub });
  },
}));
