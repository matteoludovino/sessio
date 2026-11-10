import type { Mode, Role, Status } from './types';

export const STATUS_LABEL: Record<Status, string> = {
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  completed: 'Realizada',
  no_show: 'Falta',
  cancelled: 'Cancelada',
  late_cancelled: 'Cancelada fora do prazo',
};

export const STATUS_COLOR: Record<Status, string> = {
  scheduled: '#64748b',
  confirmed: '#2f766c',
  completed: '#57534e',
  no_show: '#b45309',
  cancelled: '#d6d3d1',
  late_cancelled: '#e7c3b3',
};

export const ROLE_LABEL: Record<Role, string> = { owner: 'Proprietária(o)', reception: 'Recepção', psychologist: 'Psicóloga(o)' };
export const MODE_LABEL: Record<Mode, string> = { in_person: 'Presencial', online: 'Online' };
export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function formatDateTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function formatDate(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
}

/** Brazilian timezones, by the name people use for them. */
export const TIMEZONE_LABEL: Record<string, string> = {
  'America/Sao_Paulo': 'Brasília (São Paulo, Rio, Sul, Nordeste)',
  'America/Manaus': 'Amazonas (Manaus)',
  'America/Cuiaba': 'Mato Grosso (Cuiabá)',
  'America/Belem': 'Pará (Belém)',
  'America/Fortaleza': 'Ceará (Fortaleza)',
  'America/Recife': 'Pernambuco (Recife)',
  'America/Rio_Branco': 'Acre (Rio Branco)',
  'America/Noronha': 'Fernando de Noronha',
};
export const timezoneLabel = (tz: string) => TIMEZONE_LABEL[tz] ?? tz;
