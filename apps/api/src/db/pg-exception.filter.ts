import { type ArgumentsHost, Catch, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { PgError, pgConstraint, pgErrorCode } from './errors.js';

/**
 * The database is the final judge of uniqueness, overlaps and cross-clinic references. This
 * filter turns those violations into clean HTTP answers, by constraint name, so services don't
 * repeat try/catch blocks. Anything else goes to Nest's default handling.
 */
const BY_CONSTRAINT: Record<string, [HttpStatus, string]> = {
  rooms_clinic_name_key: [HttpStatus.CONFLICT, 'Já existe uma sala com este nome.'],
  session_types_clinic_name_key: [HttpStatus.CONFLICT, 'Já existe um tipo de sessão com este nome.'],
  working_hours_no_overlap: [HttpStatus.CONFLICT, 'Os horários de trabalho se sobrepõem.'],
  time_off_no_overlap: [HttpStatus.CONFLICT, 'Já existe uma ausência cadastrada neste período.'],
  patients_psychologist_fk: [HttpStatus.UNPROCESSABLE_ENTITY, 'Psicólogo não encontrado nesta clínica.'],
  // Races the API's pre-check can't see: the database decides, the loser gets the same message.
  appointments_psychologist_no_overlap: [
    HttpStatus.CONFLICT,
    'O psicólogo já tem uma sessão neste horário (considerando o intervalo entre sessões).',
  ],
  appointments_room_no_overlap: [HttpStatus.CONFLICT, 'A sala já está ocupada neste horário.'],
  appointments_patient_no_overlap: [HttpStatus.CONFLICT, 'O paciente já tem uma sessão neste horário.'],
};

const BY_CODE: Record<string, [HttpStatus, string]> = {
  [PgError.uniqueViolation]: [HttpStatus.CONFLICT, 'Registro duplicado.'],
  [PgError.exclusionViolation]: [HttpStatus.CONFLICT, 'Conflito de horário.'],
  [PgError.foreignKeyViolation]: [HttpStatus.UNPROCESSABLE_ENTITY, 'Referência inválida.'],
  [PgError.checkViolation]: [HttpStatus.BAD_REQUEST, 'Valor fora do permitido.'],
};

@Catch()
export class PgExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    const code = pgErrorCode(exception);
    const mapped = (code && BY_CONSTRAINT[pgConstraint(exception) ?? '']) || (code && BY_CODE[code]);
    if (!mapped || host.getType() !== 'http') {
      return super.catch(exception, host);
    }
    const [statusCode, message] = mapped;
    host.switchToHttp().getResponse().status(statusCode).json({ statusCode, message });
  }
}
