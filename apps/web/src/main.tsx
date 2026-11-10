import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './App';
import { ApiError } from './lib/api';
import './index.css';

const client: QueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2, refetchOnWindowFocus: true },
  },
  // Any write may change what the agenda shows: refresh what's on screen afterwards.
  mutationCache: new MutationCache({ onSuccess: () => client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'session' }) }),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
