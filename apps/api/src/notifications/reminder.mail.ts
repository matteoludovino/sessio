import { Injectable } from '@nestjs/common';
import { html, type Mailable } from '@nestjs/mail';

export interface Reminder {
  patientFirstName: string;
  psychologistName: string;
  clinicName: string;
  when: string;
  where: string;
  manageUrl: string;
}

/**
 * Deliberately neutral: no session type, no reason for the visit, nothing a shared inbox or a
 * phone's lock screen shouldn't show. The link opens a page; only its buttons act, so mail
 * scanners that open links can't confirm or cancel anything.
 */
@Injectable()
export class ReminderMail implements Mailable<Reminder> {
  render({ patientFirstName, psychologistName, clinicName, when, where, manageUrl }: Reminder) {
    return {
      subject: `Lembrete do seu horário: ${when}`,
      html: html`
        <p>Olá, ${patientFirstName}!</p>
        <p>Lembrete do seu horário com ${psychologistName}, ${when} (${where}).</p>
        <p><a href="${manageUrl}">Confirmar ou cancelar meu horário</a></p>
        <p>Cancelamentos com menos antecedência que o prazo da clínica podem ser cobrados.</p>
        <p>${clinicName}</p>
      `,
    };
  }
}
