import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LEGACY_STORAGE_KEYS, migrateStorageKey, removeStorageWithLegacy, STORAGE_KEYS, writeStorageWithLegacyCleanup } from '@/lib/storageKeys';

export interface User {
  id: string;
  companyId: string | null;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string;
}

export interface Company {
  id: string;
  name: string;
  gstin?: string;
  logoUrl?: string;
  itemTerminology: string;
  itemTerminologyPlural: string;
}

export interface LicenseInfo {
  license_key: string;
  status: string; // 'active' | 'trial' | 'expired' | 'revoked' | 'pending'
  tier_name: string;
  tier_display_name: string;
  max_users: number;
  used_users: number;
  activated_at: string | null;
  expires_at: string | null;
  trial_days_remaining: number | null;
}

interface AuthState {
  user: User | null;
  company: Company | null;
  license: LicenseInfo | null;
  isAuthenticated: boolean;
  accessToken: string | null;
  refreshToken: string | null;

  // Actions
  login: (user: User, company: Company | null, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  updateCompany: (updates: Partial<Company>) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setLicense: (license: LicenseInfo | null) => void;
}

migrateStorageKey(STORAGE_KEYS.authStore, LEGACY_STORAGE_KEYS.authStore);
migrateStorageKey(STORAGE_KEYS.accessToken, LEGACY_STORAGE_KEYS.accessToken);
migrateStorageKey(STORAGE_KEYS.refreshToken, LEGACY_STORAGE_KEYS.refreshToken);

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      company: null,
      license: null,
      isAuthenticated: false,
      accessToken: null,
      refreshToken: null,

      login: (user, company, accessToken, refreshToken) => {
        writeStorageWithLegacyCleanup(STORAGE_KEYS.accessToken, accessToken, LEGACY_STORAGE_KEYS.accessToken);
        writeStorageWithLegacyCleanup(STORAGE_KEYS.refreshToken, refreshToken, LEGACY_STORAGE_KEYS.refreshToken);
        set({
          user,
          company,
          isAuthenticated: true,
          accessToken,
          refreshToken,
        });
      },

      logout: () => {
        removeStorageWithLegacy(STORAGE_KEYS.accessToken, LEGACY_STORAGE_KEYS.accessToken);
        removeStorageWithLegacy(STORAGE_KEYS.refreshToken, LEGACY_STORAGE_KEYS.refreshToken);
        set({
          user: null,
          company: null,
          license: null,
          isAuthenticated: false,
          accessToken: null,
          refreshToken: null,
        });
      },

      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),

      updateCompany: (updates) =>
        set((state) => ({
          company: state.company ? { ...state.company, ...updates } : null,
        })),

      setTokens: (accessToken, refreshToken) => {
        writeStorageWithLegacyCleanup(STORAGE_KEYS.accessToken, accessToken, LEGACY_STORAGE_KEYS.accessToken);
        writeStorageWithLegacyCleanup(STORAGE_KEYS.refreshToken, refreshToken, LEGACY_STORAGE_KEYS.refreshToken);
        set({ accessToken, refreshToken });
      },

      setLicense: (license) => set({ license }),
    }),
    {
      name: STORAGE_KEYS.authStore,
      partialize: (state) => ({
        user: state.user,
        company: state.company,
        license: state.license,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
