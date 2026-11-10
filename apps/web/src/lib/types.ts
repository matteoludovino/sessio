export type Role = 'owner' | 'reception' | 'psychologist';
export type Status = 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled' | 'late_cancelled';
export type Mode = 'in_person' | 'online';

export interface User { id: string; clinicId: string; email: string; name: string; role: Role }
export interface StaffMember extends User { active: boolean; createdAt: string }
export interface Clinic { id: string; name: string; timezone: string; lateCancelHours: number; bufferMinutes: number; reminderLeadHours: number }
export interface Patient { id: string; name: string; email: string | null; phone: string | null; birthDate: string | null; psychologistId: string; active: boolean }
export interface Room { id: string; name: string; active: boolean }
export interface SessionType { id: string; name: string; durationMinutes: number; active: boolean }
export interface Psychologist { id: string; name: string; email: string }
export interface WorkingRange { weekday: number; start: string; end: string }
export interface TimeOff { id: string; startsAt: string; endsAt: string; reason: string | null }

/** Calendar entry: colleagues' sessions arrive restricted (no patient) for psychologists. */
export interface CalendarEntry {
  id: string;
  psychologistId: string;
  psychologistName: string;
  roomId: string | null;
  roomName: string | null;
  mode: Mode;
  startsAt: string;
  endsAt: string;
  status: Status;
  seriesId: string | null;
  restricted: boolean;
  patientId: string | null;
  patientName: string | null;
  sessionTypeName: string | null;
}

export interface Appointment {
  id: string;
  psychologistId: string;
  patientId: string;
  sessionTypeId: string;
  roomId: string | null;
  mode: Mode;
  seriesId: string | null;
  occurrenceDate: string | null;
  startsAt: string;
  endsAt: string;
  status: Status;
  cancelledBy: 'patient' | 'clinic' | null;
  reminderSentAt: string | null;
}

export interface Note { id: string; patientId: string; authorId: string; appointmentId: string | null; amendsNoteId: string | null; content: string; createdAt: string }
export interface SentNotification { id: string; kind: 'appointment_reminder' | 'staff_invitation'; recipient: string; subject: string; html: string | null; sentAt: string }
export interface AuditEvent { id: string; at: string; action: string; outcome: 'allowed' | 'denied'; resourceType: string; resourceId: string | null; patientId: string | null; actorName: string | null; actorRole: Role | null }
