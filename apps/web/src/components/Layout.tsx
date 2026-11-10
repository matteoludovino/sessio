import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { ROLE_LABEL } from '../lib/format';
import { useSession } from '../lib/session';
import type { Role } from '../lib/types';

const NAV: { to: string; label: string; roles: Role[] }[] = [
  { to: '/agenda', label: 'Agenda', roles: ['owner', 'reception', 'psychologist'] },
  { to: '/pacientes', label: 'Pacientes', roles: ['owner', 'reception', 'psychologist'] },
  { to: '/equipe', label: 'Equipe', roles: ['owner', 'reception'] },
  { to: '/disponibilidade', label: 'Disponibilidade', roles: ['owner', 'reception', 'psychologist'] },
  { to: '/caixa-de-saida', label: 'Caixa de saída', roles: ['owner', 'reception'] },
  { to: '/configuracoes', label: 'Configurações', roles: ['owner'] },
  { to: '/auditoria', label: 'Auditoria', roles: ['owner'] },
];

export function Layout() {
  const { user, clinic } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const current = NAV.find((i) => pathname.startsWith(i.to))?.to ?? '';
  const client = useQueryClient();
  const signOut = useMutation({
    mutationFn: () => api.post('/auth/sign-out'),
    onSettled: () => {
      client.clear();
      navigate('/entrar', { replace: true });
    },
  });
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-stone-200 bg-white px-4 py-6 md:flex">
        <p className="px-2 text-xl font-bold tracking-tight text-brand-700">Sessio</p>
        <p className="mt-1 truncate px-2 text-xs text-stone-500">{clinic.name}</p>
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {NAV.filter((item) => item.roles.includes(user.role)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-stone-600 hover:bg-stone-100'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-stone-200 pt-4">
          <p className="truncate px-2 text-sm font-medium text-stone-800">{user.name}</p>
          <p className="px-2 text-xs text-stone-500">{ROLE_LABEL[user.role]}</p>
          <button onClick={() => signOut.mutate()} className="mt-3 w-full rounded-lg px-2 py-1.5 text-left text-sm text-stone-600 hover:bg-stone-100">
            Sair
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3 md:hidden">
          <span className="font-bold text-brand-700">Sessio</span>
          <select aria-label="Navegação" className="rounded border border-stone-300 px-2 py-1 text-sm" onChange={(e) => navigate(e.target.value)} value={current}>
            <option value="" disabled>
              Menu
            </option>
            {NAV.filter((i) => i.roles.includes(user.role)).map((i) => (
              <option key={i.to} value={i.to}>
                {i.label}
              </option>
            ))}
          </select>
        </header>
        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
