import { Injectable } from '@nestjs/common';
import { html, type Mailable } from '@nestjs/mail';

export interface StaffInvitation {
  clinicName: string;
  inviteeName: string;
  inviterName: string;
  acceptUrl: string;
}

@Injectable()
export class StaffInvitationMail implements Mailable<StaffInvitation> {
  render({ clinicName, inviteeName, inviterName, acceptUrl }: StaffInvitation) {
    return {
      subject: `Convite para a equipe de ${clinicName}`,
      html: html`
        <p>Olá, ${inviteeName}!</p>
        <p>${inviterName} convidou você para a equipe de <strong>${clinicName}</strong> no Sessio.</p>
        <p><a href="${acceptUrl}">Aceitar o convite e criar minha senha</a></p>
        <p>O link é pessoal e expira em 7 dias. Se você não esperava este convite, ignore este e-mail.</p>
      `,
    };
  }
}
