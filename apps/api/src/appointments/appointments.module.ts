import { Body, Controller, Get, HttpCode, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { Can } from '@nestjs/authorization';
import { uuidParam } from '../common/schemas.js';
import { AppointmentPolicy } from './appointment.policy.js';
import {
  type CancelDto,
  cancelSchema,
  type CreateAppointmentDto,
  createAppointmentSchema,
  type ListQuery,
  listQuerySchema,
  type RescheduleDto,
  rescheduleSchema,
} from './appointments.schemas.js';
import { AppointmentsService } from './appointments.service.js';

/** Authorization per record happens in the service (who owns the session); routes only require a user. */
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  @Can(AppointmentPolicy, 'access')
  list(@Query({ schema: listQuerySchema }) query: ListQuery) {
    return this.appointments.list(query);
  }

  @Get(':id')
  @Can(AppointmentPolicy, 'access')
  get(@Param('id', { schema: uuidParam }) id: string) {
    return this.appointments.get(id);
  }

  @Post()
  @Can(AppointmentPolicy, 'access')
  create(@Body({ schema: createAppointmentSchema }) body: CreateAppointmentDto) {
    return this.appointments.create(body);
  }

  @Patch(':id/schedule')
  @Can(AppointmentPolicy, 'access')
  reschedule(@Param('id', { schema: uuidParam }) id: string, @Body({ schema: rescheduleSchema }) body: RescheduleDto) {
    return this.appointments.reschedule(id, body);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @Can(AppointmentPolicy, 'access')
  confirm(@Param('id', { schema: uuidParam }) id: string) {
    return this.appointments.confirm(id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @Can(AppointmentPolicy, 'access')
  complete(@Param('id', { schema: uuidParam }) id: string) {
    return this.appointments.complete(id);
  }

  @Post(':id/no-show')
  @HttpCode(200)
  @Can(AppointmentPolicy, 'access')
  noShow(@Param('id', { schema: uuidParam }) id: string) {
    return this.appointments.noShow(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Can(AppointmentPolicy, 'access')
  cancel(@Param('id', { schema: uuidParam }) id: string, @Body({ schema: cancelSchema }) body: CancelDto) {
    return this.appointments.cancel(id, body);
  }
}

@Module({ controllers: [AppointmentsController], providers: [AppointmentsService, AppointmentPolicy], exports: [AppointmentsService] })
export class AppointmentsModule {}
