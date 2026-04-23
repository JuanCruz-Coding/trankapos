import { create } from 'zustand';
import type { AuthSession } from '@/types';
import { data } from '@/data';

interface AuthState {
  session: AuthSession | null;
  loading: boolean;
  activeDepotId: string | null;
  init: () => Promise<void>;
  signOut: () => Promise<void>;
  setSession: (s: AuthSession | null) => void;
  setActiveDepot: (id: string) => void;
}

export const useAuth = create<AuthState>((set) => ({
  session: null,
  loading: true,
  activeDepotId: null,
  init: async () => {
    try {
      const s = await data.currentSession();
      set({
        session: s,
        loading: false,
        activeDepotId: s?.depotId ?? null,
      });
    } catch {
      set({ session: null, loading: false, activeDepotId: null });
    }
  },
  signOut: async () => {
    await data.logout();
    set({ session: null, activeDepotId: null });
  },
  setSession: (s) => set({ session: s, activeDepotId: s?.depotId ?? null }),
  setActiveDepot: (id) => set({ activeDepotId: id }),
}));
