import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, Badge, Button, ConflictList, Dialog, Field, Input, Select, Textarea } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { MODE_LABEL, STATUS_COLOR, STATUS_LABEL, formatDateTime, formatTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { fromLocalInput, hoursUntil, isFuture, toLocalInput } from '../../lib/time';
import type { CalendarEntry } from '../../lib/types';

interface Props {
  entry: CalendarEntry | null;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function AppointmentDialog({ entry, onClose, onDone }: Props) {
  return (
    <Dialog open={!!entry} onClose={onClose} title="Sessão">
      {entry && <Panel entry={entry} onDone={(m) => (onDone(m), onClose())} />}
    </Dialog>
  );
}

type Scope = 'this' | 'following';
type Step = 'view' | 'reschedule' | 'cancel';

function Panel({ entry, onDone }: { entry: CalendarEntry; onDone: (message: string) => void }) {
  const { clinic } = useSession();
  const tz = clinic.timezone;
  const [step, setStep] = useState<Step>('view');
  const [scope, setScope] = useState<Scope>('this');
  const [start, setStart] = useState(toLocalInput(entry.startsAt, tz));
  const [by, setBy] = useState<'patient' | 'clinic'>('patient');
  const [reason, setReason] = useState('');

  const active = entry.status === 'scheduled' || entry.status === 'confirmed';
  const upcoming = isFuture(entry.startsAt);
  const late = by === 'patient' && hoursUntil(entry.startsAt) < clinic.lateCancelHours;

  const action = useMutation({
    mutationFn: async (kind: 'confirm' | 'complete' | 'no-show' | 'reschedule' | 'cancel') => {
      const base = `/appointments/${entry.id}`;
      if (kind === 'reschedule') return api.patch(`${base}/schedule`, { startsAt: fromLocalInput(start, tz), scope });
      if (kind === 'cancel') return api.post(`${base}/cancel`, { by, scope, reason: reason || undefined });
      return api.post(`${base}/${kind}`);
    },
    onSuccess: (_, kind) =>
      onDone(
        {
          confirm: 'Presença confirmada.',
          complete: 'Atendimento registrado.',
          'no-show': 'Falta registrada.',
          reschedule: 'Sessão remarcada. O paciente precisa confirmar o novo horário.',
          cancel: late ? 'Sessão cancelada fora do prazo (cobrável pela política da clínica).' : 'Sessão cancelada.',
        }[kind],
      ),
  });
  const error = action.error;

  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Link to={`/pacientes/${entry.patientId}`} className="text-base font-semibold text-stone-900 hover:underline">
              {entry.patientName}
            </Link>
            <p className="text-stone-500">{entry.sessionTypeName}</p>
          </div>
          <Badge color={STATUS_COLOR[entry.status]}>{STATUS_LABEL[entry.status]}</Badge>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-stone-700">
          <dt className="text-stone-500">Quando</dt>
          <dd>
            {formatDateTime(entry.startsAt, tz)} – {formatTime(entry.endsAt, tz)}
          </dd>
          <dt className="text-stone-500">Com</dt>
          <dd>{entry.psychologistName}</dd>
          <dt className="text-stone-500">Onde</dt>
          <dd>{entry.mode === 'online' ? MODE_LABEL.online : `${MODE_LABEL.in_person} · ${entry.roomName}`}</dd>
          {entry.seriesId && (
            <>
              <dt className="text-stone-500">Série</dt>
              <dd>Sessão recorrente</dd>
            </>
          )}
        </dl>
      </div>

      {error && (
        <Alert>
          {error.message}
          {error instanceof ApiError && <ConflictList conflicts={error.conflicts} timeZone={tz} />}
        </Alert>
      )}

      {step === 'view' && active && (
        <div className="flex flex-wrap gap-2 border-t border-stone-100 pt-4">
          {upcoming ? (
            <>
              {entry.status === 'scheduled' && (
                <Button busy={action.isPending} onClick={() => action.mutate('confirm')}>
                  Confirmar presença
                </Button>
              )}
              <Button variant="secondary" onClick={() => (action.reset(), setStep('reschedule'))}>
                Remarcar
              </Button>
              <Button variant="danger" onClick={() => (action.reset(), setStep('cancel'))}>
                Cancelar sessão
              </Button>
            </>
          ) : (
            <>
              <Button busy={action.isPending} onClick={() => action.mutate('complete')}>
                Registrar atendimento
              </Button>
              <Button variant="secondary" busy={action.isPending} onClick={() => action.mutate('no-show')}>
                Marcar falta
              </Button>
            </>
          )}
        </div>
      )}
      {step === 'view' && !active && <p className="border-t border-stone-100 pt-4 text-stone-500">Sessão encerrada: nada mais a fazer aqui.</p>}

      {step !== 'view' && (
        <form
          className="space-y-4 border-t border-stone-100 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            action.mutate(step);
          }}
        >
          {step === 'reschedule' && (
            <Field label="Novo início" hint="A sessão volta para &quot;agendada&quot; e o paciente recebe novo lembrete.">
              {(id) => <Input id={id} type="datetime-local" step={300} required value={start} onChange={(e) => setStart(e.target.value)} />}
            </Field>
          )}
          {step === 'cancel' && (
            <>
              <Field label="Quem cancelou">
                {(id) => (
                  <Select id={id} value={by} onChange={(e) => setBy(e.target.value as 'patient' | 'clinic')}>
                    <option value="patient">O paciente</option>
                    <option value="clinic">A clínica</option>
                  </Select>
                )}
              </Field>
              {late && (
                <Alert tone="warning">
                  Faltam menos de {clinic.lateCancelHours}h: pela política da clínica, este cancelamento fica registrado como fora do prazo (cobrável).
                </Alert>
              )}
              <Field label="Motivo (opcional)">{(id) => <Textarea id={id} className="min-h-16" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
            </>
          )}
          {entry.seriesId && (
            <fieldset className="flex gap-4">
              <legend className="mb-1 text-sm font-medium text-stone-700">Aplicar a</legend>
              {(['this', 'following'] as const).map((s) => (
                <label key={s} className="flex items-center gap-2">
                  <input type="radio" name="scope" className="accent-brand-600" checked={scope === s} onChange={() => setScope(s)} />
                  {s === 'this' ? 'Só esta sessão' : 'Esta e as seguintes'}
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => (action.reset(), setStep('view'))}>
              Voltar
            </Button>
            <Button type="submit" variant={step === 'cancel' ? 'danger' : 'primary'} busy={action.isPending}>
              {step === 'cancel' ? 'Cancelar sessão' : 'Remarcar'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
