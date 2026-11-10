import type { AppointmentStatus } from './appointments.schema.js';

/**
 * The appointment lifecycle, as pure functions: no database, no framework, unit-tested.
 *
 *   scheduled ──confirm (only before start)──▶ confirmed
 *   scheduled | confirmed ──complete / noShow (only once started)──▶ completed | no_show
 *   scheduled | confirmed ──cancel (only before start)──▶ cancelled | late_cancelled
 *   scheduled | confirmed ──reschedule (only before start)──▶ scheduled (needs a new confirmation)
 */
export type AppointmentAction = 'confirm' | 'complete' | 'noShow' | 'cancel' | 'reschedule';

export class RuleViolation extends Error {}

const ACTIVE: readonly AppointmentStatus[] = ['scheduled', 'confirmed'];

const ALLOWED_FROM: Record<AppointmentAction, readonly AppointmentStatus[]> = {
  confirm: ['scheduled'],
  complete: ACTIVE,
  noShow: ACTIVE,
  cancel: ACTIVE,
  reschedule: ACTIVE,
};

const LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'agendada',
  confirmed: 'confirmada',
  completed: 'realizada',
  no_show: 'marcada como falta',
  cancelled: 'cancelada',
  late_cancelled: 'cancelada com menos antecedência que o prazo',
};

export interface Timing {
  now: Date;
  startsAt: Date;
}

/** The statuses an action may start from (used for race-safe conditional updates). */
export function allowedFrom(action: AppointmentAction): readonly AppointmentStatus[] {
  return ALLOWED_FROM[action];
}

/** Throws RuleViolation (in Portuguese, shown to staff) when the action isn't allowed now. */
export function assertCan(action: AppointmentAction, status: AppointmentStatus, { now, startsAt }: Timing): void {
  if (!ALLOWED_FROM[action].includes(status)) {
    throw new RuleViolation(`A sessão já está ${LABEL[status]}.`);
  }
  const started = now.getTime() >= startsAt.getTime();
  if ((action === 'complete' || action === 'noShow') && !started) {
    throw new RuleViolation('Só é possível registrar o atendimento ou a falta depois do início da sessão.');
  }
  if ((action === 'cancel' || action === 'reschedule' || action === 'confirm') && started) {
    throw new RuleViolation('A sessão já começou: registre o atendimento ou a falta.');
  }
}

/**
 * A patient cancelling closer to the start than the clinic's deadline is a late cancellation
 * (chargeable). A cancellation by the clinic never is.
 */
export function cancellationStatus(
  by: 'patient' | 'clinic',
  { now, startsAt }: Timing,
  lateCancelHours: number,
): Extract<AppointmentStatus, 'cancelled' | 'late_cancelled'> {
  const noticeMs = startsAt.getTime() - now.getTime();
  return by === 'patient' && noticeMs < lateCancelHours * 3_600_000 ? 'late_cancelled' : 'cancelled';
}
