import type { DateSelectArg, EventClickArg, EventContentArg, EventDropArg, EventInput } from '@fullcalendar/core';
import ptBr from '@fullcalendar/core/locales/pt-br';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Alert, Button, ConflictList, Dialog, PageHeader, Select } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';
import { MODE_LABEL, STATUS_COLOR, STATUS_LABEL, formatDateTime } from '../../lib/format';
import { usePsychologists, useRooms } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { isFuture } from '../../lib/time';
import type { CalendarEntry, Status, WorkingRange } from '../../lib/types';
import { AppointmentDialog } from './AppointmentDialog';
import { NewAppointmentDialog } from './NewAppointmentDialog';

/** Phones get one day at a time: seven columns don't fit. */
const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

const ACTIVE: Status[] = ['scheduled', 'confirmed'];
const CANCELLED: Status[] = ['cancelled', 'late_cancelled'];

interface PendingMove {
  entry: CalendarEntry;
  startsAt: string;
  revert: () => void;
}

export function AgendaPage() {
  const { user, clinic } = useSession();
  const frontDesk = user.role !== 'psychologist';
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [psychologistId, setPsychologistId] = useState(frontDesk ? '' : user.id);
  const [roomId, setRoomId] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [newAt, setNewAt] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [move, setMove] = useState<PendingMove | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const psychologists = usePsychologists();
  const rooms = useRooms();
  const entries = useQuery({
    queryKey: ['appointments', range, psychologistId, roomId],
    queryFn: () => api.get<CalendarEntry[]>(`/appointments${qs({ ...range!, psychologistId: psychologistId || undefined, roomId: roomId || undefined })}`),
    enabled: !!range,
    placeholderData: (previous) => previous,
  });
  const workingHours = useQuery({
    queryKey: ['working-hours', psychologistId],
    queryFn: () => api.get<WorkingRange[]>(`/psychologists/${psychologistId}/working-hours`),
    enabled: !!psychologistId,
  });

  const events = useMemo<EventInput[]>(
    () =>
      (entries.data ?? [])
        .filter((e) => showCancelled || !CANCELLED.includes(e.status))
        .map((e) => ({
          id: e.id,
          start: e.startsAt,
          end: e.endsAt,
          title: e.restricted ? 'Ocupado' : (e.patientName ?? ''),
          backgroundColor: e.restricted ? '#e7e5e4' : STATUS_COLOR[e.status],
          borderColor: e.restricted ? '#d6d3d1' : STATUS_COLOR[e.status],
          textColor: e.restricted || CANCELLED.includes(e.status) ? '#44403c' : '#fff',
          // Only someone who may manage the session, before it starts, can drag it.
          editable: !e.restricted && ACTIVE.includes(e.status) && isFuture(e.startsAt),
          extendedProps: { entry: e },
        })),
    [entries.data, showCancelled],
  );

  const businessHours = useMemo(
    () => (workingHours.data ?? []).map((r) => ({ daysOfWeek: [r.weekday], startTime: r.start, endTime: r.end })),
    [workingHours.data],
  );

  const reschedule = useMutation({
    mutationFn: ({ entry, startsAt, scope }: { entry: CalendarEntry; startsAt: string; scope: 'this' | 'following' }) =>
      api.patch(`/appointments/${entry.id}/schedule`, { startsAt, scope }),
    onSuccess: () => {
      setMove(null);
      setNotice('Sessão remarcada. O paciente precisa confirmar o novo horário.');
    },
  });

  const onDrop = (info: EventDropArg) => {
    const entry = info.event.extendedProps.entry as CalendarEntry;
    reschedule.reset();
    setMove({ entry, startsAt: info.event.startStr, revert: info.revert });
  };

  const cancelMove = () => {
    move?.revert();
    setMove(null);
  };

  return (
    <>
      <PageHeader
        title="Agenda"
        description={frontDesk ? 'Sessões de toda a clínica' : 'Suas sessões; as dos colegas aparecem só como ocupadas'}
        actions={
          <Button onClick={() => setNewAt('')}>
            Nova sessão
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select aria-label="Psicólogo" className="w-auto" value={psychologistId} onChange={(e) => setPsychologistId(e.target.value)}>
          <option value="">Todos os psicólogos</option>
          {psychologists.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === user.id ? `${p.name} (você)` : p.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Sala" className="w-auto" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">Todas as salas</option>
          {rooms.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="accent-brand-600" />
          Mostrar canceladas
        </label>
        <Legend />
      </div>

      {notice && (
        <div className="mb-4">
          <Alert tone="success">
            <span className="flex justify-between gap-4">
              {notice}
              <button className="text-xs underline" onClick={() => setNotice(null)}>
                ok
              </button>
            </span>
          </Alert>
        </div>
      )}
      {entries.error && (
        <div className="mb-4">
          <Alert>{entries.error.message}</Alert>
        </div>
      )}

      <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-xs md:p-4">
        <FullCalendar
          plugins={[timeGridPlugin, interactionPlugin, luxonPlugin]}
          locale={ptBr}
          timeZone={clinic.timezone}
          initialView={narrow ? 'timeGridDay' : 'timeGridWeek'}
          firstDay={1}
          headerToolbar={narrow ? { left: 'prev,next', center: 'title', right: 'today' } : { left: 'prev,next today', center: 'title', right: 'timeGridWeek,timeGridDay' }}
          allDaySlot={false}
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
          slotDuration="00:30:00"
          scrollTime="08:00:00"
          nowIndicator
          height="auto"
          expandRows
          selectable
          selectMirror
          selectAllow={(span) => span.start.getTime() > Date.now()}
          eventDurationEditable={false}
          businessHours={businessHours.length ? businessHours : undefined}
          events={events}
          datesSet={(arg) => setRange({ from: arg.start.toISOString(), to: arg.end.toISOString() })}
          select={(info: DateSelectArg) => {
            info.view.calendar.unselect();
            setNewAt(info.startStr);
          }}
          eventClick={(info: EventClickArg) => {
            const entry = info.event.extendedProps.entry as CalendarEntry;
            if (!entry.restricted) setOpenId(entry.id);
          }}
          eventDrop={onDrop}
          eventContent={(arg: EventContentArg) => <EventBody arg={arg} />}
        />
      </div>

      <NewAppointmentDialog
        open={newAt !== null}
        startsAt={newAt ?? ''}
        psychologistId={psychologistId}
        roomId={roomId}
        onClose={() => setNewAt(null)}
        onCreated={(message) => {
          setNewAt(null);
          setNotice(message);
        }}
      />
      <AppointmentDialog entry={entries.data?.find((e) => e.id === openId) ?? null} onClose={() => setOpenId(null)} onDone={setNotice} />

      <Dialog open={!!move} onClose={cancelMove} title="Remarcar sessão">
        {move && (
          <div className="space-y-4 text-sm">
            <p>
              <strong>{move.entry.patientName}</strong> para <strong>{formatDateTime(move.startsAt, clinic.timezone)}</strong>. A sessão volta a
              &quot;agendada&quot; e o paciente recebe um novo lembrete.
            </p>
            {reschedule.error && (
              <Alert>
                {reschedule.error.message}
                {reschedule.error instanceof ApiError && <ConflictList conflicts={reschedule.error.conflicts} timeZone={clinic.timezone} />}
              </Alert>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={cancelMove}>
                Desfazer
              </Button>
              {move.entry.seriesId && (
                <Button variant="secondary" busy={reschedule.isPending} onClick={() => reschedule.mutate({ ...move, scope: 'following' })}>
                  Esta e as seguintes
                </Button>
              )}
              <Button busy={reschedule.isPending} onClick={() => reschedule.mutate({ ...move, scope: 'this' })}>
                {move.entry.seriesId ? 'Só esta' : 'Remarcar'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

function EventBody({ arg }: { arg: EventContentArg }) {
  const entry = arg.event.extendedProps.entry as CalendarEntry;
  const cancelled = CANCELLED.includes(entry.status);
  return (
    <div className={`overflow-hidden leading-tight ${cancelled ? 'line-through opacity-80' : ''}`}>
      <div className="text-[0.7rem] opacity-90">{arg.timeText}</div>
      <div className="truncate font-medium">{arg.event.title}</div>
      {!entry.restricted && (
        <div className="truncate text-[0.7rem] opacity-90">
          {entry.psychologistName} · {entry.mode === 'online' ? MODE_LABEL.online : (entry.roomName ?? '')}
        </div>
      )}
    </div>
  );
}

function Legend() {
  const items: Status[] = ['scheduled', 'confirmed', 'completed', 'no_show'];
  return (
    <div className="ml-auto hidden flex-wrap gap-3 text-xs text-stone-500 lg:flex">
      {items.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: STATUS_COLOR[s] }} />
          {STATUS_LABEL[s]}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-stone-200" />
        Ocupado (colega)
      </span>
    </div>
  );
}
