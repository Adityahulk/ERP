import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { useAuthStore } from './store/authStore';
import { LEGACY_STORAGE_KEYS, readStorageWithLegacy, STORAGE_KEYS } from './lib/storageKeys';
import './index.css';
import toast from 'react-hot-toast';

// After persist rehydrates: if shell says logged-in but tokens are gone, clear store (avoids redirect loops).
useAuthStore.persist.onFinishHydration(() => {
  const { isAuthenticated, logout } = useAuthStore.getState();
  if (isAuthenticated && !readStorageWithLegacy(STORAGE_KEYS.accessToken, LEGACY_STORAGE_KEYS.accessToken)) {
    logout();
  }
});

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error: unknown) => {
      const err = error as { code?: string; message?: string; response?: { data?: { error?: string; message?: string } } };
      const message =
        err.response?.data?.error ||
        err.response?.data?.message ||
        (err.code === 'ECONNABORTED' ? 'The server is taking too long to respond. Please try again.' : err.message) ||
        'Could not load data from the server.';
      toast.error(message);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: (failureCount, error: unknown) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: 'hsl(var(--card))',
              color: 'hsl(var(--card-foreground))',
              border: '1px solid hsl(var(--border))',
            },
            success: {
              iconTheme: {
                primary: '#10b981',
                secondary: '#ffffff',
              },
            },
            error: {
              iconTheme: {
                primary: '#ef4444',
                secondary: '#ffffff',
              },
            },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
