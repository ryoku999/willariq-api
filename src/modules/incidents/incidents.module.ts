import { IncidentWorkflowService } from './incident-workflow.service';
import { IncidentWorkflowController } from './incident-workflow.controller';
import { Module } from '@nestjs/common';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { AuditModule } from '../audit/audit.module';
import { IncidentAccessService } from './incident-access.service';
import { IncidentTrackingService } from './incident-tracking.service';

@Module({
  imports: [AuditModule],
  controllers: [IncidentsController, IncidentWorkflowController],
  providers: [
    IncidentWorkflowService,
    IncidentsService,
    IncidentAccessService,
    IncidentTrackingService,
  ],
  exports: [IncidentWorkflowService, IncidentsService, IncidentAccessService],
})
export class IncidentsModule {}
