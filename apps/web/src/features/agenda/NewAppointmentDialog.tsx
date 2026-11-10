import { useMutation } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { Alert, Button, ConflictList, Dialog, Field, Input, Select } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, timezoneLabel } from '../../lib/format';
import { usePatients, usePsychologists, useRooms, useSessionTypes } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { fromLocalInput, toLocalInput } from '../../lib/time';
import type { Appointment, Mode } from '../../lib/types';

interface Props {
  open: boolean;
  /** ISO start picked on the calendar; empty for "next full hour". */
  startsAt: string;
  psychologistId: string;
  roomId: string;
  onClose: () => void;
  onCreated: (message: string) => void;
}

export function NewAppointmentDialog({ open, onClose, ...props }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title="Nova sessão" wide>
      <NewAppointmentForm {...props} onClose={onClose} />
    </Dialog>
  );
}

type Repeat = 'none' | '1' | '2';

function NewAppointmentForm({ startsAt, psychologistId, roomId: roomFilter, onClose, onCreated }: Omit<Props, 'open'>) {
  const { user, clinic } = useSession();
  const tz = clinic.timezone;
  const patients = usePatients();
  const psychologists = usePsychologists();
  const types = useSessionTypes();
  const rooms = useRooms();

  const initialStart = startsAt ? toLocalInput(startsAt, tz) : DateTime.now().setZone(tz).plus({ hours: 1 }).startOf('hour').toFormat("yyyy-MM-dd'T'HH:mm");
  const [form, setForm] = useState({
    patientId: '',
    sessionTypeId: '',
    start: initialStart,
    mode: 'in_person' as Mode,
    roomId: roomFilter,
    repeat: 'none' as Repeat,
    untilDate: '',
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const options = (patients.data ?? []).filter((p) => p.active && (!psychologistId || p.psychologistId === psychologistId));
  const psychologistName = (id: string) => psychologists.data?.find((p) => p.id === id)?.name;
  const patient = patients.data?.find((p) => p.id === form.patientId);
  const sessionTypeId = form.sessionTypeId || (types.data?.find((t) => t.name.startsWith('Individual')) ?? types.data?.[0])?.id || '';

  const create = useMutation({
    mutationFn: async (skipConflicts: boolean) => {
      const body = {
        patientId: form.patientId,
        sessionTypeId,
        startsAt: fromLocalInput(form.start, tz),
        mode: form.mode,
        roomId: form.mode === 'in_person' ? form.roomId || undefined : undefined,
      };
      if (form.repeat === 'none') {
        const created = await api.post<Appointment>('/appointments', body);
        return `Sessão agendada: ${formatDateTime(created.startsAt, tz)}.`;
      }
      const result = await api.post<{ occurrences: Appointment[]; skipped?: unknown[] }>('/appointment-series', {
        ...body,
        intervalWeeks: Number(form.repeat),
        untilDate: form.untilDate || undefined,
        skipConflicts,
      });
      const skipped = result.skipped?.length ?? 0;
      return `Série criada com ${result.occurrences.length} sessões${skipped ? ` (${skipped} data(s) com conflito ficaram de fora)` : ''}.`;
    },
    onSuccess: onCreated,
  });
  const conflicts = create.error instanceof ApiError ? create.error.conflicts : [];
  const seriesConflict = form.repeat !== 'none' && create.error instanceof ApiError && create.error.status === 409;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate(false);
      }}
    >
      <Field label="Paciente">
        {(id) => (
          <Select id={id} required value={form.patientId} onChange={(e) => set('patientId', e.target.value)}>
            <option value="">Selecione…</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {user.role !== 'psychologist' && psychologistName(p.psychologistId) ? ` · ${psychologistName(p.psychologistId)}` : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {patient && user.role !== 'psychologist' && <p className="-mt-2 text-xs text-stone-500">Com {psychologistName(patient.psychologistId)}, psicóloga(o) responsável.</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo de sessão">
          {(id) => (
            <Select id={id} value={sessionTypeId} onChange={(e) => set('sessionTypeId', e.target.value)}>
              {types.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.durationMinutes} min)
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Início" hint={`Fuso: ${timezoneLabel(tz)}`}>
          {(id) => <Input id={id} type="datetime-local" required step={300} value={form.start} onChange={(e) => set('start', e.target.value)} />}
        </Field>
        <Field label="Modalidade">
          {(id) => (
            <Select id={id} value={form.mode} onChange={(e) => set('mode', e.target.value as Mode)}>
              <option value="in_person">Presencial</option>
              <option value="online">Online</option>
            </Select>
          )}
        </Field>
        <Field label="Sala">
          {(id) => (
            <Select id={id} value={form.mode === 'online' ? '' : form.roomId} disabled={form.mode === 'online'} required={form.mode === 'in_person'} onChange={(e) => set('roomId', e.target.value)}>
              <option value="">{form.mode === 'online' ? 'Não usa sala' : 'Selecione…'}</option>
              {rooms.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Repetir">
          {(id) => (
            <Select id={id} value={form.repeat} onChange={(e) => set('repeat', e.target.value as Repeat)}>
              <option value="none">Não repetir</option>
              <option value="1">Toda semana</option>
              <option value="2">A cada 2 semanas</option>
            </Select>
          )}
        </Field>
        {form.repeat !== 'none' && (
          <Field label="Até" hint="Em branco: sem data final (agenda as próximas 12 semanas e estende sozinha).">
            {(id) => <Input id={id} type="date" value={form.untilDate} onChange={(e) => set('untilDate', e.target.value)} />}
          </Field>
        )}
      </div>

      {create.error && (
        <Alert tone={seriesConflict ? 'warning' : 'error'}>
          {create.error.message}
          <ConflictList conflicts={conflicts} timeZone={tz} />
          {seriesConflict && (
            <div className="mt-3">
              <Button type="button" variant="secondary" busy={create.isPending} onClick={() => create.mutate(true)}>
                Criar sem as datas com conflito
              </Button>
            </div>
          )}
        </Alert>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" busy={create.isPending}>
          Agendar
        </Button>
      </div>
    </form>
  );
}
