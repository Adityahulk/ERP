import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LEGACY_STORAGE_KEYS, migrateStorageKey, removeStorageWithLegacy, STORAGE_KEYS, writeStorageWithLegacyCleanup } from '@/lib/storageKeys';

export interface Registrant {
  id: string;
  name: string;
  email: string;
  phone?: string;
  is_verified: boolean;
}

interface RegistrantState {
  registrant: Registrant | null;
  token: string | null;
  isAuthenticated: boolean;

  login: (registrant: Registrant, token: string) => void;
  logout: () => void;
  updateRegistrant: (updates: Partial<Registrant>) => void;
}

const TOKEN_KEY = STORAGE_KEYS.registrantToken;
const LEGACY_TOKEN_KEY = LEGACY_STORAGE_KEYS.registrantToken;

migrateStorageKey(STORAGE_KEYS.registrantStore, LEGACY_STORAGE_KEYS.registrantStore);
migrateStorageKey(TOKEN_KEY, LEGACY_TOKEN_KEY);

export const useRegistrantStore = create<RegistrantState>()(
  persist(
    (set) => ({
      registrant: null,
      token: localStorage.getItem(TOKEN_KEY),
      isAuthenticated: !!localStorage.getItem(TOKEN_KEY),

      login: (registrant, token) => {
        writeStorageWithLegacyCleanup(TOKEN_KEY, token, LEGACY_TOKEN_KEY);
        set({ registrant, token, isAuthenticated: true });
      },

      logout: () => {
        removeStorageWithLegacy(TOKEN_KEY, LEGACY_TOKEN_KEY);
        set({ registrant: null, token: null, isAuthenticated: false });
      },

      updateRegistrant: (updates) =>
        set((state) => ({
          registrant: state.registrant ? { ...state.registrant, ...updates } : null,
        })),
    }),
    {
      name: STORAGE_KEYS.registrantStore,
      partialize: (state) => ({
        registrant: state.registrant,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
