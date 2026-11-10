import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, use } from 'react';
import { Navigate, useLocation } from 'react-router';
import { api, ApiError } from './api';
import type { Clinic, User } from './types';

interface Session {
  user: User;
  clinic: Clinic;
}

const SessionContext = createContext<Session | null>(null);

/** Who is signed in, and their clinic; null when signed out (the API answers 401). */
export function useSessionQuery() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async (): Promise<Session | null> => {
      try {
        const user = await api.get<User>('/me');
        const clinic = await api.get<Clinic>('/clinic');
        return { user, clinic };
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error('useSession outside a signed-in route');
  return session;
}

export function useRefreshSession() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['session'] });
}

/** Signed-in routes: sends anyone else to the sign-in page, back here afterwards. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { data, isPending, error } = useSessionQuery();
  const location = useLocation();
  if (isPending) return <p className="p-10 text-center text-sm text-stone-500">Carregando…</p>;
  if (error) return <p className="p-10 text-center text-sm text-red-700">Não foi possível falar com o servidor.</p>;
  if (!data) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  return <SessionContext value={data}>{children}</SessionContext>;
}
