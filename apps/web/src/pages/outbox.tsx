import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Card, Empty, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useSession } from '../lib/session';
import type { SentNotification } from '../lib/types';

const KIND: Record<SentNotification['kind'], string> = { appointment_reminder: 'Lembrete', staff_invitation: 'Convite' };

/** Links open in a new tab; the sandbox runs no script and has no access to this page. */
const preview = (html: string) => `<base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;color:#292524;margin:16px}</style>${html}`;

export function OutboxPage() {
  const { clinic } = useSession();
  const sent = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<SentNotification[]>('/notifications'), refetchInterval: 15_000 });
  const [openId, setOpenId] = useState<string | null>(null);
  const open = sent.data?.find((n) => n.id === openId) ?? sent.data?.[0];

  return (
    <>
      <PageHeader title="Caixa de saída" description="E-mails enviados pela clínica: lembretes com link de confirmação e convites da equipe" />
      {sent.data?.length === 0 ? (
        <Card>
          <Empty>Nada enviado ainda. Os lembretes saem automaticamente {clinic.reminderLeadHours}h antes de cada sessão.</Empty>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Card className="p-0">
            <ul className="divide-y divide-stone-100">
              {sent.data?.map((n) => (
                <li key={n.id}>
                  <button onClick={() => setOpenId(n.id)} className={`w-full px-5 py-3 text-left text-sm hover:bg-stone-50 ${open?.id === n.id ? 'bg-brand-50' : ''}`}>
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate font-medium text-stone-900">{n.subject}</span>
                      <Badge>{KIND[n.kind]}</Badge>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-stone-500">
                      {n.recipient} · {formatDateTime(n.sentAt, clinic.timezone)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {open && (
            <Card className="flex min-h-96 flex-col p-0">
              <div className="border-b border-stone-200 px-5 py-3 text-sm">
                <p className="font-medium text-stone-900">{open.subject}</p>
                <p className="text-xs text-stone-500">Para {open.recipient}</p>
              </div>
              {open.html ? (
                <iframe title="Conteúdo do e-mail" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={preview(open.html)} className="w-full flex-1 rounded-b-2xl" />
              ) : (
                <Empty>O conteúdo só fica guardado no modo demonstração.</Empty>
              )}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
