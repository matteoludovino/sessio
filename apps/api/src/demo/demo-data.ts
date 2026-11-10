/**
 * The demo clinic: fictional people, relative dates. Content is in Portuguese because the product
 * is; every name, e-mail and note here is made up (.test addresses never deliver).
 */

/** Shared by every demo account; shown on the sign-in page of the demo deployment. */
export const DEMO_PASSWORD = 'sessio-demo-2026';

export const DEMO_CLINIC = { name: 'Clínica Equilíbrio', timezone: 'America/Sao_Paulo' };

export type DemoStaffKey = 'helena' | 'julia' | 'rafael' | 'marina';

export const DEMO_STAFF: Record<DemoStaffKey, { name: string; email: string; role: 'owner' | 'reception' | 'psychologist' }> = {
  helena: { name: 'Helena Prado', email: 'helena@equilibrio.test', role: 'owner' },
  julia: { name: 'Júlia Alves', email: 'julia@equilibrio.test', role: 'reception' },
  rafael: { name: 'Rafael Torres', email: 'rafael@equilibrio.test', role: 'psychologist' },
  marina: { name: 'Marina Costa', email: 'marina@equilibrio.test', role: 'psychologist' },
};

/** Visitors share these accounts: the API refuses to deactivate them or change their role. */
export const DEMO_ACCOUNT_EMAILS: ReadonlySet<string> = new Set(Object.values(DEMO_STAFF).map((s) => s.email));

export const DEMO_ROOMS = ['Sala 1', 'Sala 2'] as const;

/** weekday 0 = Sunday; minutes since local midnight. */
export const DEMO_WORKING_HOURS: Record<'rafael' | 'marina', { weekday: number; start: number; end: number }[]> = {
  rafael: [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, start: 8 * 60, end: 12 * 60 },
    { weekday, start: 13 * 60, end: 19 * 60 },
  ]),
  marina: [
    ...[1, 2, 3, 4].map((weekday) => ({ weekday, start: 9 * 60, end: 18 * 60 })),
    { weekday: 6, start: 8 * 60, end: 12 * 60 },
  ],
};

type SessionTypeName = 'Individual' | 'Casal' | 'Avaliação';
type PastOutcome = 'no_show' | 'late_cancelled' | 'cancelled';

export interface DemoPatient {
  name: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  psychologist: 'rafael' | 'marina';
  active?: boolean;
  /** Weekly (or biweekly) series that started a few weeks ago and keeps going. */
  series?: {
    weekday: number;
    minute: number;
    type: SessionTypeName;
    room: (typeof DEMO_ROOMS)[number] | null;
    intervalWeeks?: 1 | 2;
    /** Past occurrences that didn't happen as planned, counted back from the latest one (0). */
    exceptions?: Record<number, PastOutcome>;
  };
  /** One-off session a few days ahead (first appointments are evaluations). */
  oneOff?: { inDays: number; minute: number; type: SessionTypeName; room: (typeof DEMO_ROOMS)[number] | null };
  /** Clinical notes on the latest attended sessions, oldest first. */
  notes?: string[];
  /** Added later to the first note, as an amendment. */
  addendum?: string;
}

export const DEMO_PATIENTS: DemoPatient[] = [
  {
    name: 'Ana Beatriz Lima',
    email: 'ana.lima@exemplo.test',
    phone: '(11) 98888-1111',
    birthDate: '1991-04-12',
    psychologist: 'rafael',
    series: { weekday: 3, minute: 10 * 60, type: 'Individual', room: 'Sala 1' },
    notes: [
      'Sessão de acolhimento. Relata ansiedade ligada ao trabalho e dificuldade para dormir. Combinamos frequência semanal e registro de sono.',
      'Trouxe o registro de sono: melhora nos dias sem reunião à noite. Exploramos a cobrança interna por desempenho.',
      'Refere menos episódios de insônia. Começou a delegar tarefas; ainda sente culpa ao dizer não.',
    ],
    addendum: 'Correção: a dificuldade para dormir começou há cerca de três meses, não três semanas.',
  },
  {
    name: 'Carlos Menezes',
    email: 'carlos.menezes@exemplo.test',
    psychologist: 'rafael',
    series: { weekday: 2, minute: 16 * 60, type: 'Individual', room: null, exceptions: { 2: 'no_show' } },
    notes: ['Atendimento online. Luto recente pelo pai; tem conseguido falar sobre a perda com a família.', 'Retomou a rotina de exercícios. Datas comemorativas próximas trazem apreensão.'],
  },
  {
    name: 'Diego Souza',
    phone: '(11) 97777-2222',
    psychologist: 'rafael',
    series: { weekday: 5, minute: 9 * 60, type: 'Individual', room: 'Sala 2', exceptions: { 1: 'late_cancelled' } },
  },
  {
    name: 'Patrícia Nogueira',
    email: 'patricia.nogueira@exemplo.test',
    psychologist: 'rafael',
    series: { weekday: 1, minute: 18 * 60, type: 'Individual', room: 'Sala 1', intervalWeeks: 2 },
  },
  {
    name: 'Bruno Carvalho',
    email: 'bruno.carvalho@exemplo.test',
    psychologist: 'rafael',
    series: { weekday: 4, minute: 8 * 60, type: 'Individual', room: null },
  },
  {
    name: 'Tiago Ramos',
    email: 'tiago.ramos@exemplo.test',
    psychologist: 'rafael',
    oneOff: { inDays: 2, minute: 14 * 60, type: 'Avaliação', room: 'Sala 2' },
  },
  { name: 'Sérgio Almeida', email: 'sergio.almeida@exemplo.test', psychologist: 'rafael', active: false },
  {
    name: 'Fernanda Rocha',
    email: 'fernanda.rocha@exemplo.test',
    birthDate: '1985-09-30',
    psychologist: 'marina',
    series: { weekday: 4, minute: 14 * 60, type: 'Individual', room: 'Sala 1' },
    notes: ['Segue em adaptação à nova cidade. Rede de apoio ainda pequena; ligações com a irmã ajudam.', 'Inscreveu-se num grupo de corrida. Humor mais estável nas últimas duas semanas.'],
  },
  {
    name: 'Lucas e Paula Martins',
    email: 'lucas.martins@exemplo.test',
    psychologist: 'marina',
    series: { weekday: 3, minute: 10 * 60, type: 'Casal', room: 'Sala 2' },
    notes: ['Terapia de casal. Divergência sobre a divisão das tarefas com a chegada do bebê; ambos dispostos a negociar.'],
  },
  {
    name: 'Gabriel Teixeira',
    email: 'gabriel.teixeira@exemplo.test',
    psychologist: 'marina',
    series: { weekday: 1, minute: 11 * 60, type: 'Individual', room: 'Sala 2', exceptions: { 3: 'cancelled' } },
  },
  {
    name: 'Renata Duarte',
    email: 'renata.duarte@exemplo.test',
    psychologist: 'marina',
    series: { weekday: 2, minute: 15 * 60, type: 'Individual', room: null },
  },
  {
    name: 'Camila Freitas',
    email: 'camila.freitas@exemplo.test',
    psychologist: 'marina',
    oneOff: { inDays: 3, minute: 16 * 60 + 30, type: 'Avaliação', room: null },
  },
];

/** Marina's two days off, two weeks ahead: her series skip those dates. */
export const DEMO_TIME_OFF = { psychologist: 'marina' as const, inDays: 15, days: 2, reason: 'Congresso' };

/** How far back the series started. */
export const HISTORY_WEEKS = 6;
