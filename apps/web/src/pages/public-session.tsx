import { useMutation, useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useParams } from 'react-router';
import { Alert, Button, Field, Textarea } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { MODE_LABEL, STATUS_LABEL } from '../lib/format';
import type { Mode, Status } from '../lib/types';

interface PublicSession {
  clinicName: string;
  psychologistName: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  mode: Mode;
  roomName: string | null;
  status: Status;
  canConfirm: boolean;
  canCancel: boolean;
  lateCancelHours: number;
  cancellingNowIsLate: boolean;
}

const Shell = ({ children }: { children: ReactNode }) => (
  <main className="flex min-h-screen items-start justify-center px-4 py-12 sm:items-center">
    <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">{children}</div>
  </main>
);

/** The patient's side: what the reminder links to. Neutral wording, nothing about the treatment. */
export function PublicSessionPage() {
  const { token = '' } = useParams();
  const path = `/public/sessions/${encodeURIComponent(token)}`;
  const session = useQuery({ queryKey: ['public-session', token], queryFn: () => api.get<PublicSession>(path), retry: false });
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const act = useMutation({
    mutationFn: (kind: 'confirm' | 'cancel') => api.post(`${path}/${kind}`, kind === 'cancel' ? { reason: reason || undefined } : {}),
    onSuccess: () => {
      setCancelling(false);
      return session.refetch();
    },
  });

  if (session.isPending) return <Shell><p className="text-sm text-stone-500">Carregando…</p></Shell>;
  if (session.error) {
    const gone = session.error instanceof ApiError && [400, 401, 403, 404, 410].includes(session.error.status);
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-stone-900">Link indisponível</h1>
        <p className="mt-2 text-sm text-stone-600">
          {gone ? 'Este link não é mais válido: o horário pode ter mudado ou a sessão já passou. Fale com a clínica se precisar.' : session.error.message}
        </p>
      </Shell>
    );
  }
  const s = session.data;
  const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { timeZone: s.timezone, ...opts }).format(new Date(s.startsAt));
  const end = new Intl.DateTimeFormat('pt-BR', { timeZone: s.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(s.endsAt));

  return (
    <Shell>
      <p className="text-sm font-medium text-brand-700">{s.clinicName}</p>
      <h1 className="mt-1 text-xl font-semibold text-stone-900">Seu horário</h1>
      <div className="mt-5 rounded-xl bg-stone-50 p-4">
        <p className="text-lg font-semibold text-stone-900 first-letter:uppercase">{fmt({ weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <p className="text-stone-700">
          {fmt({ hour: '2-digit', minute: '2-digit' })} às {end}
        </p>
        <p className="mt-2 text-sm text-stone-600">
          Com {s.psychologistName} · {s.mode === 'online' ? MODE_LABEL.online : `${MODE_LABEL.in_person}${s.roomName ? `, ${s.roomName}` : ''}`}
        </p>
      </div>
      <p className="mt-4 text-sm">
        Situação: <strong>{STATUS_LABEL[s.status]}</strong>
      </p>

      {act.error && (
        <div className="mt-4">
          <Alert>{act.error.message}</Alert>
        </div>
      )}
      {act.isSuccess && (
        <div className="mt-4">
          <Alert tone="success">{s.status === 'confirmed' ? 'Presença confirmada. Até lá!' : 'Cancelamento registrado. A clínica foi avisada.'}</Alert>
        </div>
      )}

      {!cancelling && (s.canConfirm || s.canCancel) && (
        <div className="mt-6 flex flex-col gap-2">
          {s.canConfirm && (
            <Button busy={act.isPending} onClick={() => act.mutate('confirm')}>
              Confirmar presença
            </Button>
          )}
          {s.canCancel && (
            <Button variant="secondary" onClick={() => setCancelling(true)}>
              Não poderei ir
            </Button>
          )}
        </div>
      )}

      {cancelling && (
        <form
          className="mt-6 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            act.mutate('cancel');
          }}
        >
          {s.cancellingNowIsLate && (
            <Alert tone="warning">
              Faltam menos de {s.lateCancelHours}h para a sessão. Pela política da clínica, o cancelamento agora pode ser cobrado.
            </Alert>
          )}
          <Field label="Quer deixar um recado? (opcional)">{(id) => <Textarea id={id} className="min-h-20" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setCancelling(false)}>
              Voltar
            </Button>
            <Button type="submit" variant="danger" className="flex-1" busy={act.isPending}>
              Cancelar sessão
            </Button>
          </div>
        </form>
      )}
    </Shell>
  );
}
