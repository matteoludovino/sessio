import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Alert, Badge, Button, Card, Dialog, Empty, Field, Input, PageHeader, Select, Textarea } from '../components/ui';
import { api, qs } from '../lib/api';
import { MODE_LABEL, STATUS_COLOR, STATUS_LABEL, formatDate, formatDateTime } from '../lib/format';
import { usePatients, usePsychologists } from '../lib/queries';
import { useSession } from '../lib/session';
import { daysFromNow } from '../lib/time';
import type { CalendarEntry, Note, Patient } from '../lib/types';

/** Empty inputs are "no value", not empty strings. */
const patientBody = (form: HTMLFormElement) => {
  const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]));
};

export function PatientsPage() {
  const { user } = useSession();
  const frontDesk = user.role !== 'psychologist';
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const patients = usePatients(q, archived);
  const psychologists = usePsychologists();
  const nameOf = (id: string) => psychologists.data?.find((p) => p.id === id)?.name ?? '—';

  return (
    <>
      <PageHeader title="Pacientes" description={frontDesk ? 'Todos os pacientes da clínica' : 'Seus pacientes'} actions={<Button onClick={() => setCreating(true)}>Novo paciente</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input aria-label="Buscar" placeholder="Buscar por nome, e-mail ou telefone" className="max-w-sm" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" className="accent-brand-600" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Incluir arquivados
        </label>
      </div>
      <Card className="overflow-x-auto p-0">
        {patients.data?.length === 0 ? (
          <Empty>Nenhum paciente encontrado.</Empty>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">Contato</th>
                {frontDesk && <th className="px-5 py-3 font-medium">Psicóloga(o)</th>}
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {patients.data?.map((p) => (
                <tr key={p.id} className="hover:bg-stone-50">
                  <td className="px-5 py-3">
                    <Link to={`/pacientes/${p.id}`} className="font-medium text-stone-900 hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-stone-600">{[p.email, p.phone].filter(Boolean).join(' · ') || '—'}</td>
                  {frontDesk && <td className="px-5 py-3 text-stone-600">{nameOf(p.psychologistId)}</td>}
                  <td className="px-5 py-3 text-right">{!p.active && <Badge>Arquivado</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Dialog open={creating} onClose={() => setCreating(false)} title="Novo paciente">
        <PatientForm onSaved={() => setCreating(false)} />
      </Dialog>
    </>
  );
}

function PatientForm({ patient, onSaved }: { patient?: Patient; onSaved: () => void }) {
  const { user } = useSession();
  const frontDesk = user.role !== 'psychologist';
  const psychologists = usePsychologists();
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => (patient ? api.patch(`/patients/${patient.id}`, body) : api.post('/patients', body)),
    onSuccess: onSaved,
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const body = patientBody(e.currentTarget);
    if (!frontDesk) delete body.psychologistId;
    save.mutate(body);
  };
  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="Nome">{(id) => <Input id={id} name="name" required minLength={2} defaultValue={patient?.name} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="E-mail" hint="Para onde vão os lembretes.">
          {(id) => <Input id={id} name="email" type="email" defaultValue={patient?.email ?? ''} />}
        </Field>
        <Field label="Telefone">{(id) => <Input id={id} name="phone" defaultValue={patient?.phone ?? ''} />}</Field>
        <Field label="Nascimento">{(id) => <Input id={id} name="birthDate" type="date" defaultValue={patient?.birthDate ?? ''} />}</Field>
        {frontDesk && (
          <Field label="Psicóloga(o) responsável">
            {(id) => (
              <Select id={id} name="psychologistId" required defaultValue={patient?.psychologistId ?? ''}>
                <option value="" disabled>
                  Selecione…
                </option>
                {psychologists.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
      {save.error && <Alert>{save.error.message}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" busy={save.isPending}>
          Salvar
        </Button>
      </div>
    </form>
  );
}

export function PatientDetailPage() {
  const { id = '' } = useParams();
  const { user, clinic } = useSession();
  const frontDesk = user.role !== 'psychologist';
  const [editing, setEditing] = useState(false);
  const patient = useQuery({ queryKey: ['patients', id], queryFn: () => api.get<Patient>(`/patients/${id}`) });
  const sessions = useQuery({
    queryKey: ['appointments', 'patient', id],
    queryFn: () => api.get<CalendarEntry[]>(`/appointments${qs({ patientId: id, from: daysFromNow(-31), to: daysFromNow(31) })}`),
  });
  const archive = useMutation({ mutationFn: (active: boolean) => api.patch(`/patients/${id}`, { active }) });

  if (patient.error) return <Alert>{patient.error.message}</Alert>;
  if (!patient.data) return <p className="text-sm text-stone-500">Carregando…</p>;
  const p = patient.data;
  const isAuthor = user.role === 'psychologist' && p.psychologistId === user.id;

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/pacientes" className="text-stone-500 hover:underline">
          ← Pacientes
        </Link>
      </p>
      <PageHeader
        title={p.name}
        description={[p.email, p.phone, p.birthDate && `nasc. ${formatDate(`${p.birthDate}T12:00:00Z`, 'UTC')}`].filter(Boolean).join(' · ') || undefined}
        actions={
          <div className="flex gap-2">
            {!p.active && <Badge>Arquivado</Badge>}
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Editar
            </Button>
            {frontDesk && (
              <Button variant={p.active ? 'danger' : 'secondary'} busy={archive.isPending} onClick={() => archive.mutate(!p.active)}>
                {p.active ? 'Arquivar' : 'Reativar'}
              </Button>
            )}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <h2 className="mb-3 font-semibold text-stone-900">Sessões (últimos e próximos 30 dias)</h2>
          {sessions.data?.length === 0 && <Empty>Nenhuma sessão no período.</Empty>}
          <ul className="divide-y divide-stone-100 text-sm">
            {sessions.data?.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {formatDateTime(s.startsAt, clinic.timezone)}
                  <span className="text-stone-500"> · {s.mode === 'online' ? MODE_LABEL.online : s.roomName}</span>
                </span>
                <Badge color={STATUS_COLOR[s.status]}>{STATUS_LABEL[s.status]}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        {isAuthor ? (
          <Notes patientId={p.id} sessions={sessions.data ?? []} />
        ) : (
          <Card>
            <h2 className="font-semibold text-stone-900">Prontuário</h2>
            <p className="mt-2 text-sm text-stone-500">
              Restrito à psicóloga(o) responsável. Nem a recepção nem a proprietária da clínica têm acesso, e tentativas ficam registradas na auditoria.
            </p>
          </Card>
        )}
      </div>
      <Dialog open={editing} onClose={() => setEditing(false)} title="Editar paciente">
        <PatientForm patient={p} onSaved={() => setEditing(false)} />
      </Dialog>
    </>
  );
}

function Notes({ patientId, sessions }: { patientId: string; sessions: CalendarEntry[] }) {
  const { clinic } = useSession();
  const tz = clinic.timezone;
  const [amending, setAmending] = useState<Note | null>(null);
  const [saved, setSaved] = useState(0);
  const notes = useQuery({ queryKey: ['notes', patientId], queryFn: () => api.get<Note[]>(`/patients/${patientId}/notes`) });
  const add = useMutation({
    mutationFn: (body: { content: string; appointmentId?: string; amendsNoteId?: string }) => api.post(`/patients/${patientId}/notes`, body),
    onSuccess: () => {
      setAmending(null);
      setSaved((n) => n + 1);
    },
  });
  const attended = sessions.filter((s) => s.status === 'completed');
  const originals = (notes.data ?? []).filter((n) => !n.amendsNoteId);
  const amendmentsOf = (id: string) => (notes.data ?? []).filter((n) => n.amendsNoteId === id);
  const sessionLabel = (appointmentId: string | null) => {
    const s = sessions.find((x) => x.id === appointmentId);
    return s ? `Sessão de ${formatDateTime(s.startsAt, tz)}` : null;
  };

  return (
    <Card>
      <h2 className="font-semibold text-stone-900">Prontuário</h2>
      <p className="mt-1 text-xs text-stone-500">Cifrado no banco e visível só para você. Registros não são editados nem apagados: correções entram como adendo.</p>
      <form
        key={saved}
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          add.mutate({ content: data.content, appointmentId: data.appointmentId || undefined, amendsNoteId: amending?.id });
        }}
      >
        {amending && (
          <Alert tone="info">
            <span className="flex justify-between gap-3">
              Adendo ao registro de {formatDateTime(amending.createdAt, tz)}
              <button type="button" className="text-xs underline" onClick={() => setAmending(null)}>
                desfazer
              </button>
            </span>
          </Alert>
        )}
        <Field label={amending ? 'Adendo' : 'Novo registro'}>{(id) => <Textarea id={id} name="content" required maxLength={20_000} />}</Field>
        {!amending && attended.length > 0 && (
          <Field label="Sessão (opcional)">
            {(id) => (
              <Select id={id} name="appointmentId" defaultValue="">
                <option value="">Sem vínculo com sessão</option>
                {attended.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatDateTime(s.startsAt, tz)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {add.error && <Alert>{add.error.message}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" busy={add.isPending}>
            Registrar
          </Button>
        </div>
      </form>
      <div className="mt-6 space-y-4">
        {notes.error && <Alert>{notes.error.message}</Alert>}
        {notes.data?.length === 0 && <Empty>Nenhum registro ainda.</Empty>}
        {originals.map((n) => (
          <article key={n.id} className="rounded-xl border border-stone-200 p-4">
            <header className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
              <span>
                {formatDateTime(n.createdAt, tz)}
                {sessionLabel(n.appointmentId) && ` · ${sessionLabel(n.appointmentId)}`}
              </span>
              <button className="underline hover:text-stone-800" onClick={() => setAmending(n)}>
                Adicionar adendo
              </button>
            </header>
            <p className="whitespace-pre-wrap text-sm text-stone-800">{n.content}</p>
            {amendmentsOf(n.id).map((a) => (
              <div key={a.id} className="mt-3 border-l-2 border-brand-100 pl-3">
                <p className="text-xs text-stone-500">Adendo · {formatDateTime(a.createdAt, tz)}</p>
                <p className="whitespace-pre-wrap text-sm text-stone-800">{a.content}</p>
              </div>
            ))}
          </article>
        ))}
      </div>
    </Card>
  );
}
