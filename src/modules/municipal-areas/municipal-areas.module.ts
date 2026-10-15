import { Module } from '@nestjs/common';
import { MunicipalAreasController } from './municipal-areas.controller';
import { MunicipalAreasService } from './municipal-areas.service';
import { AuditService } from '../audit/audit.service';
import { MunicipalAreaMembersService } from './members/municipal-area-members.service';
import { MunicipalAreaMembersController } from './members/municipal-area-members.controller';

@Module({
  controllers: [MunicipalAreasController, MunicipalAreaMembersController],
  providers: [MunicipalAreasService, AuditService, MunicipalAreaMembersService],
})
export class MunicipalAreasModule {}
