import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

const TOKEN_KEY = 'bizflow_registrant_token';

export const useRegistrantStore = create<RegistrantState>()(
  persist(
    (set) => ({
      registrant: null,
      token: localStorage.getItem(TOKEN_KEY),
      isAuthenticated: !!localStorage.getItem(TOKEN_KEY),

      login: (registrant, token) => {
        localStorage.setItem(TOKEN_KEY, token);
        set({ registrant, token, isAuthenticated: true });
      },

      logout: () => {
        localStorage.removeItem(TOKEN_KEY);
        set({ registrant: null, token: null, isAuthenticated: false });
      },

      updateRegistrant: (updates) =>
        set((state) => ({
          registrant: state.registrant ? { ...state.registrant, ...updates } : null,
        })),
    }),
    {
      name: 'bizflow-registrant',
      partialize: (state) => ({
        registrant: state.registrant,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
