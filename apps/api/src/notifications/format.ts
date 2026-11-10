/** "terça-feira, 7 de janeiro, às 08:00", in the clinic's zone. */
export function formatSessionTime(instant: Date, timeZone: string): string {
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(instant);
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);
  return `${date}, às ${time}`;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0];
