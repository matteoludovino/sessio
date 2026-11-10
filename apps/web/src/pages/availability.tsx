import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Empty, Field, Input, PageHeader, Select } from '../components/ui';
import { api, qs } from '../lib/api';
import { WEEKDAYS, formatDateTime } from '../lib/format';
import { usePsychologists } from '../lib/queries';
import { useSession } from '../lib/session';
import { fromLocalInput, nowIso } from '../lib/time';
import type { TimeOff, WorkingRange } from '../lib/types';

/** Monday first, as a week reads in Brazil. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export function AvailabilityPage() {
  const { user } = useSession();
  const frontDesk = user.role !== 'psychologist';
  const psychologists = usePsychologists();
  const [picked, setPicked] = useState('');
  const psychologistId = frontDesk ? picked || psychologists.data?.[0]?.id || '' : user.id;

  return (
    <>
      <PageHeader
        title="Disponibilidade"
        description="Horário de trabalho semanal e ausências. Sessões só podem ser marcadas dentro do horário."
        actions={
          frontDesk && (
            <Select aria-label="Psicólogo" className="w-auto" value={psychologistId} onChange={(e) => setPicked(e.target.value)}>
              {psychologists.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )
        }
      />
      {psychologistId ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <WorkingHours key={psychologistId} psychologistId={psychologistId} />
          <TimeOffList psychologistId={psychologistId} />
        </div>
      ) : (
        <Empty>Nenhuma psicóloga(o) na equipe ainda. Convide alguém em Equipe.</Empty>
      )}
    </>
  );
}

function WorkingHours({ psychologistId }: { psychologistId: string }) {
  const current = useQuery({
    queryKey: ['working-hours', psychologistId],
    queryFn: () => api.get<WorkingRange[]>(`/psychologists/${psychologistId}/working-hours`),
  });
  const [draft, setDraft] = useState<WorkingRange[] | null>(null);
  const ranges = draft ?? current.data ?? [];
  const save = useMutation({
    mutationFn: () => api.put(`/psychologists/${psychologistId}/working-hours`, { ranges }),
    onSuccess: () => setDraft(null),
  });
  const edit = (next: WorkingRange[]) => {
    save.reset();
    setDraft(next);
  };
  const replace = (target: WorkingRange, patch: Partial<WorkingRange>) => edit(ranges.map((r) => (r === target ? { ...r, ...patch } : r)));

  return (
    <Card>
      <h2 className="mb-4 font-semibold text-stone-900">Horário semanal</h2>
      <div className="divide-y divide-stone-100">
        {WEEK.map((weekday) => {
          const day = ranges.filter((r) => r.weekday === weekday);
          return (
            <div key={weekday} className="flex flex-wrap items-start gap-3 py-3">
              <span className="w-20 pt-2 text-sm font-medium text-stone-700">{WEEKDAYS[weekday]}</span>
              <div className="flex flex-1 flex-col gap-2">
                {day.length === 0 && <span className="pt-2 text-sm text-stone-400">Não atende</span>}
                {day.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input aria-label="Início" type="time" step={900} className="w-28" value={r.start} onChange={(e) => replace(r, { start: e.target.value })} />
                    <span className="text-stone-400">até</span>
                    <Input aria-label="Fim" type="time" step={900} className="w-28" value={r.end} onChange={(e) => replace(r, { end: e.target.value })} />
                    <button className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-red-700" aria-label="Remover intervalo" onClick={() => edit(ranges.filter((x) => x !== r))}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <Button variant="ghost" className="text-xs" onClick={() => edit([...ranges, { weekday, start: day.length ? '14:00' : '08:00', end: day.length ? '18:00' : '12:00' }])}>
                + intervalo
              </Button>
            </div>
          );
        })}
      </div>
      {save.error && <Alert>{save.error.message}</Alert>}
      {save.isSuccess && !draft && <Alert tone="success">Horário salvo.</Alert>}
      <div className="mt-4 flex justify-end gap-2">
        {draft && (
          <Button variant="secondary" onClick={() => setDraft(null)}>
            Descartar
          </Button>
        )}
        <Button disabled={!draft} busy={save.isPending} onClick={() => save.mutate()}>
          Salvar horário
        </Button>
      </div>
    </Card>
  );
}

function TimeOffList({ psychologistId }: { psychologistId: string }) {
  const { clinic } = useSession();
  const tz = clinic.timezone;
  const [round, setRound] = useState(0);
  const list = useQuery({
    queryKey: ['time-off', psychologistId],
    queryFn: () => api.get<TimeOff[]>(`/psychologists/${psychologistId}/time-off${qs({ from: nowIso() })}`),
  });
  const add = useMutation({
    mutationFn: (body: { startsAt: string; endsAt: string; reason?: string }) => api.post(`/psychologists/${psychologistId}/time-off`, body),
    onSuccess: () => setRound((n) => n + 1),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/psychologists/${psychologistId}/time-off/${id}`) });

  return (
    <Card>
      <h2 className="mb-4 font-semibold text-stone-900">Ausências e férias</h2>
      <form
        key={round}
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          add.mutate({ startsAt: fromLocalInput(d.startsAt, tz), endsAt: fromLocalInput(d.endsAt, tz), reason: d.reason || undefined });
        }}
      >
        <Field label="De">{(id) => <Input id={id} name="startsAt" type="datetime-local" required />}</Field>
        <Field label="Até">{(id) => <Input id={id} name="endsAt" type="datetime-local" required />}</Field>
        <div className="sm:col-span-2">
          <Field label="Motivo (opcional)">{(id) => <Input id={id} name="reason" maxLength={200} placeholder="Férias, congresso…" />}</Field>
        </div>
        {add.error && (
          <div className="sm:col-span-2">
            <Alert>{add.error.message}</Alert>
          </div>
        )}
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" busy={add.isPending}>
            Adicionar ausência
          </Button>
        </div>
      </form>
      <ul className="mt-5 divide-y divide-stone-100 text-sm">
        {list.data?.length === 0 && <Empty>Nenhuma ausência futura.</Empty>}
        {list.data?.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 py-2">
            <span>
              {formatDateTime(t.startsAt, tz)} → {formatDateTime(t.endsAt, tz)}
              {t.reason && <span className="text-stone-500"> · {t.reason}</span>}
            </span>
            <Button variant="ghost" className="text-xs" busy={remove.isPending && remove.variables === t.id} onClick={() => remove.mutate(t.id)}>
              Remover
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
