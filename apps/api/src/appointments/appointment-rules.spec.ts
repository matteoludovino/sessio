import { assertCan, cancellationStatus, RuleViolation } from './appointment-rules.js';

const startsAt = new Date('2027-03-10T14:00:00Z');
const before = { now: new Date('2027-03-10T13:00:00Z'), startsAt };
const after = { now: new Date('2027-03-10T14:05:00Z'), startsAt };

describe('appointment lifecycle', () => {
  it('confirms only scheduled sessions', () => {
    expect(() => assertCan('confirm', 'scheduled', before)).not.toThrow();
    expect(() => assertCan('confirm', 'confirmed', before)).toThrow(RuleViolation);
    expect(() => assertCan('confirm', 'cancelled', before)).toThrow('A sessão já está cancelada.');
  });

  it('confirming a session that already started makes no sense', () => {
    expect(() => assertCan('confirm', 'scheduled', after)).toThrow(/já começou/);
  });

  it('completes or marks no-show only once the session has started', () => {
    expect(() => assertCan('complete', 'confirmed', before)).toThrow(/depois do início/);
    expect(() => assertCan('noShow', 'scheduled', before)).toThrow(/depois do início/);
    expect(() => assertCan('complete', 'confirmed', after)).not.toThrow();
    expect(() => assertCan('noShow', 'scheduled', after)).not.toThrow();
  });

  it('cancels and reschedules only before the start', () => {
    expect(() => assertCan('cancel', 'confirmed', before)).not.toThrow();
    expect(() => assertCan('reschedule', 'scheduled', before)).not.toThrow();
    expect(() => assertCan('cancel', 'confirmed', after)).toThrow(/já começou/);
    expect(() => assertCan('reschedule', 'confirmed', after)).toThrow(/já começou/);
  });

  it('a finished or cancelled session is final', () => {
    for (const status of ['completed', 'no_show', 'cancelled', 'late_cancelled'] as const) {
      for (const action of ['confirm', 'complete', 'noShow', 'cancel', 'reschedule'] as const) {
        expect(() => assertCan(action, status, after)).toThrow(RuleViolation);
      }
    }
  });
});

describe('cancellation policy', () => {
  const start = new Date('2027-03-10T14:00:00Z');
  const hoursBefore = (h: number) => ({ now: new Date(start.getTime() - h * 3_600_000), startsAt: start });

  it('a patient cancelling with less notice than the deadline is late', () => {
    expect(cancellationStatus('patient', hoursBefore(23.9), 24)).toBe('late_cancelled');
    expect(cancellationStatus('patient', hoursBefore(1), 24)).toBe('late_cancelled');
  });

  it('exactly at the deadline, or earlier, is a regular cancellation', () => {
    expect(cancellationStatus('patient', hoursBefore(24), 24)).toBe('cancelled');
    expect(cancellationStatus('patient', hoursBefore(72), 24)).toBe('cancelled');
  });

  it('the clinic cancelling is never late, and the deadline is per clinic', () => {
    expect(cancellationStatus('clinic', hoursBefore(1), 24)).toBe('cancelled');
    expect(cancellationStatus('patient', hoursBefore(10), 6)).toBe('cancelled');
    expect(cancellationStatus('patient', hoursBefore(5), 6)).toBe('late_cancelled');
  });
});
