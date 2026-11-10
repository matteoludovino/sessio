import { useQuery } from '@tanstack/react-query';
import { Badge, Card, Empty, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { ROLE_LABEL, formatDateTime } from '../lib/format';
import { usePatients } from '../lib/queries';
import { useSession } from '../lib/session';
import type { AuditEvent } from '../lib/types';

const ACTION: Record<string, string> = {
  'note.create': 'Escreveu no prontuário',
  'note.list': 'Abriu o prontuário',
  'note.read': 'Leu um registro do prontuário',
};

export function AuditPage() {
  const { clinic } = useSession();
  const events = useQuery({ queryKey: ['audit'], queryFn: () => api.get<AuditEvent[]>('/audit-events?limit=200') });
  const patients = usePatients('', true);
  const patientName = (id: string | null) => patients.data?.find((p) => p.id === id)?.name ?? '—';

  return (
    <>
      <PageHeader title="Auditoria" description="Quem acessou prontuários, e quando. Você vê o registro de acesso, nunca o conteúdo." />
      <Card className="overflow-x-auto p-0">
        {events.data?.length === 0 ? (
          <Empty>Nenhum acesso registrado.</Empty>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-5 py-3 font-medium">Quando</th>
                <th className="px-5 py-3 font-medium">Quem</th>
                <th className="px-5 py-3 font-medium">O quê</th>
                <th className="px-5 py-3 font-medium">Paciente</th>
                <th className="px-5 py-3 font-medium">Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {events.data?.map((e) => (
                <tr key={e.id} className={e.outcome === 'denied' ? 'bg-red-50/50' : ''}>
                  <td className="whitespace-nowrap px-5 py-3 text-stone-600">{formatDateTime(e.at, clinic.timezone)}</td>
                  <td className="px-5 py-3">
                    {e.actorName ?? '—'}
                    {e.actorRole && <span className="block text-xs text-stone-500">{ROLE_LABEL[e.actorRole]}</span>}
                  </td>
                  <td className="px-5 py-3">{ACTION[e.action] ?? e.action}</td>
                  <td className="px-5 py-3 text-stone-600">{patientName(e.patientId)}</td>
                  <td className="px-5 py-3">
                    <Badge color={e.outcome === 'allowed' ? '#2f766c' : '#b91c1c'}>{e.outcome === 'allowed' ? 'Permitido' : 'Negado'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
