import { useQuery } from '@tanstack/react-query';
import { api, qs } from './api';
import type { Patient, Psychologist, Room, SessionType, StaffMember } from './types';

/** Reference data shared by several screens; cached for a minute. */
const ref = { staleTime: 60_000 };

export const usePsychologists = () => useQuery({ queryKey: ['psychologists'], queryFn: () => api.get<Psychologist[]>('/psychologists'), ...ref });
export const useRooms = (includeInactive = false) =>
  useQuery({ queryKey: ['rooms', { includeInactive }], queryFn: () => api.get<Room[]>(`/rooms${qs({ includeInactive: includeInactive ? 'true' : undefined })}`), ...ref });
export const useSessionTypes = (includeInactive = false) =>
  useQuery({
    queryKey: ['session-types', { includeInactive }],
    queryFn: () => api.get<SessionType[]>(`/session-types${qs({ includeInactive: includeInactive ? 'true' : undefined })}`),
    ...ref,
  });
export const usePatients = (q = '', includeArchived = false) =>
  useQuery({
    queryKey: ['patients', { q, includeArchived }],
    queryFn: () => api.get<Patient[]>(`/patients${qs({ q: q || undefined, includeArchived: includeArchived ? 'true' : undefined })}`),
  });
export const useStaff = (enabled = true) => useQuery({ queryKey: ['staff'], queryFn: () => api.get<StaffMember[]>('/staff'), enabled });
