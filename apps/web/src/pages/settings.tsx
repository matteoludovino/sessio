import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select } from '../components/ui';
import { api } from '../lib/api';
import { TIMEZONE_LABEL, timezoneLabel } from '../lib/format';
import { useRooms, useSessionTypes } from '../lib/queries';
import { useRefreshSession, useSession } from '../lib/session';
import type { Clinic } from '../lib/types';


export function SettingsPage() {
  return (
    <>
      <PageHeader title="Configurações" description="Regras da clínica, salas e tipos de sessão" />
      <div className="grid gap-6 xl:grid-cols-2">
        <ClinicSettings />
        <div className="space-y-6">
          <Rooms />
          <SessionTypes />
        </div>
      </div>
    </>
  );
}

function ClinicSettings() {
  const { clinic } = useSession();
  const refresh = useRefreshSession();
  const save = useMutation({
    mutationFn: (body: Partial<Clinic>) => api.patch<Clinic>('/clinic', body),
    onSuccess: () => refresh(),
  });
  return (
    <Card>
      <h2 className="mb-4 font-semibold text-stone-900">Clínica</h2>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          save.mutate({
            name: d.name,
            timezone: d.timezone,
            lateCancelHours: Number(d.lateCancelHours),
            bufferMinutes: Number(d.bufferMinutes),
            reminderLeadHours: Number(d.reminderLeadHours),
          });
        }}
      >
        <Field label="Nome">{(id) => <Input id={id} name="name" required minLength={2} defaultValue={clinic.name} />}</Field>
        <Field label="Fuso horário" hint="Horários de trabalho e e-mails usam este fuso.">
          {(id) => (
            <Select id={id} name="timezone" defaultValue={clinic.timezone}>
              {[...new Set([clinic.timezone, ...Object.keys(TIMEZONE_LABEL)])].map((tz) => (
                <option key={tz} value={tz}>
                  {timezoneLabel(tz)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Prazo de cancelamento" hint="Horas. Menos que isso, pelo paciente, é fora do prazo.">
            {(id) => <Input id={id} name="lateCancelHours" type="number" min={0} max={168} required defaultValue={clinic.lateCancelHours} />}
          </Field>
          <Field label="Intervalo entre sessões" hint="Minutos livres depois de cada sessão.">
            {(id) => <Input id={id} name="bufferMinutes" type="number" min={0} max={60} required defaultValue={clinic.bufferMinutes} />}
          </Field>
          <Field label="Lembrete" hint="Horas antes da sessão.">
            {(id) => <Input id={id} name="reminderLeadHours" type="number" min={2} max={168} required defaultValue={clinic.reminderLeadHours} />}
          </Field>
        </div>
        {save.error && <Alert>{save.error.message}</Alert>}
        {save.isSuccess && <Alert tone="success">Configurações salvas. Valem para os próximos agendamentos.</Alert>}
        <div className="flex justify-end">
          <Button type="submit" busy={save.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Rooms() {
  const rooms = useRooms(true);
  const [round, setRound] = useState(0);
  const add = useMutation({ mutationFn: (name: string) => api.post('/rooms', { name }), onSuccess: () => setRound((n) => n + 1) });
  const update = useMutation({ mutationFn: ({ id, ...body }: { id: string; active?: boolean; name?: string }) => api.patch(`/rooms/${id}`, body) });
  return (
    <Card>
      <h2 className="mb-4 font-semibold text-stone-900">Salas</h2>
      <ul className="divide-y divide-stone-100 text-sm">
        {rooms.data?.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2">
            <span className={r.active ? '' : 'text-stone-400'}>{r.name}</span>
            <span className="flex items-center gap-2">
              {!r.active && <Badge>Inativa</Badge>}
              <Button variant="ghost" className="py-1 text-xs" onClick={() => update.mutate({ id: r.id, active: !r.active })}>
                {r.active ? 'Desativar' : 'Reativar'}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <form
        key={round}
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(String(new FormData(e.currentTarget).get('name')));
        }}
      >
        <Input aria-label="Nova sala" name="name" placeholder="Nova sala" required minLength={1} />
        <Button type="submit" busy={add.isPending}>
          Adicionar
        </Button>
      </form>
      {(add.error ?? update.error) && <div className="mt-3"><Alert>{(add.error ?? update.error)!.message}</Alert></div>}
    </Card>
  );
}

function SessionTypes() {
  const types = useSessionTypes(true);
  const [round, setRound] = useState(0);
  const add = useMutation({
    mutationFn: (body: { name: string; durationMinutes: number }) => api.post('/session-types', body),
    onSuccess: () => setRound((n) => n + 1),
  });
  const update = useMutation({ mutationFn: ({ id, ...body }: { id: string; active?: boolean }) => api.patch(`/session-types/${id}`, body) });
  return (
    <Card>
      <h2 className="mb-4 font-semibold text-stone-900">Tipos de sessão</h2>
      <ul className="divide-y divide-stone-100 text-sm">
        {types.data?.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 py-2">
            <span className={t.active ? '' : 'text-stone-400'}>
              {t.name} <span className="text-stone-500">· {t.durationMinutes} min</span>
            </span>
            <span className="flex items-center gap-2">
              {!t.active && <Badge>Inativo</Badge>}
              <Button variant="ghost" className="py-1 text-xs" onClick={() => update.mutate({ id: t.id, active: !t.active })}>
                {t.active ? 'Desativar' : 'Reativar'}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <form
        key={round}
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          add.mutate({ name: String(d.get('name')), durationMinutes: Number(d.get('durationMinutes')) });
        }}
      >
        <Input aria-label="Nome do tipo" name="name" placeholder="Ex.: Supervisão" required className="min-w-40 flex-1" />
        <Input aria-label="Duração em minutos" name="durationMinutes" type="number" min={15} max={240} step={5} defaultValue={50} required className="w-24" />
        <Button type="submit" busy={add.isPending}>
          Adicionar
        </Button>
      </form>
      {(add.error ?? update.error) && <div className="mt-3"><Alert>{(add.error ?? update.error)!.message}</Alert></div>}
    </Card>
  );
}
