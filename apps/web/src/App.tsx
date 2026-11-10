import { createBrowserRouter, Navigate } from 'react-router';
import { Layout } from './components/Layout';
import { RequireSession } from './lib/session';
import { AuditPage } from './pages/audit';
import { AcceptInvitation, SignIn, SignUp } from './pages/auth';
import { AvailabilityPage } from './pages/availability';
import { OutboxPage } from './pages/outbox';
import { PatientDetailPage, PatientsPage } from './pages/patients';
import { PublicSessionPage } from './pages/public-session';
import { SettingsPage } from './pages/settings';
import { TeamPage } from './pages/team';

export const router = createBrowserRouter([
  { path: '/entrar', element: <SignIn /> },
  { path: '/criar-clinica', element: <SignUp /> },
  { path: '/convite', element: <AcceptInvitation /> },
  // The patient's page, from the reminder e-mail: no account, the link is the credential.
  { path: '/sessao/:token', element: <PublicSessionPage /> },
  {
    element: (
      <RequireSession>
        <Layout />
      </RequireSession>
    ),
    hydrateFallbackElement: <p className="p-10 text-center text-sm text-stone-500">Carregando…</p>,
    children: [
      { index: true, element: <Navigate to="/agenda" replace /> },
      // FullCalendar is most of the bundle: loaded only once someone opens the agenda.
      { path: '/agenda', lazy: () => import('./features/agenda/AgendaPage').then((m) => ({ Component: m.AgendaPage })) },
      { path: '/pacientes', element: <PatientsPage /> },
      { path: '/pacientes/:id', element: <PatientDetailPage /> },
      { path: '/equipe', element: <TeamPage /> },
      { path: '/disponibilidade', element: <AvailabilityPage /> },
      { path: '/caixa-de-saida', element: <OutboxPage /> },
      { path: '/configuracoes', element: <SettingsPage /> },
      { path: '/auditoria', element: <AuditPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/agenda" replace /> },
]);
