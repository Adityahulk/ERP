import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: string;
  companyId: string;
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

interface AuthState {
  user: User | null;
  company: Company | null;
  isAuthenticated: boolean;
  accessToken: string | null;
  refreshToken: string | null;

  // Actions
  login: (user: User, company: Company, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  updateCompany: (updates: Partial<Company>) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      company: null,
      isAuthenticated: false,
      accessToken: null,
      refreshToken: null,

      login: (user, company, accessToken, refreshToken) => {
        localStorage.setItem('bizflow_access_token', accessToken);
        localStorage.setItem('bizflow_refresh_token', refreshToken);
        set({
          user,
          company,
          isAuthenticated: true,
          accessToken,
          refreshToken,
        });
      },

      logout: () => {
        localStorage.removeItem('bizflow_access_token');
        localStorage.removeItem('bizflow_refresh_token');
        set({
          user: null,
          company: null,
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
        localStorage.setItem('bizflow_access_token', accessToken);
        localStorage.setItem('bizflow_refresh_token', refreshToken);
        set({ accessToken, refreshToken });
      },
    }),
    {
      name: 'bizflow-auth',
      partialize: (state) => ({
        user: state.user,
        company: state.company,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
