import { Module } from '@nestjs/common';
import { IncidentsModule } from '../incidents/incidents.module';
import { AssignmentsController } from './assignments.controller';

@Module({ imports: [IncidentsModule], controllers: [AssignmentsController] })
export class AssignmentsModule {}
