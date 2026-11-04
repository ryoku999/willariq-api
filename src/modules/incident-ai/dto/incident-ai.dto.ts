import { IsEnum, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { QueueOutboxStatus } from '@/generated/prisma/enums';
import { IncidentPaginationQueryDto } from '../../incidents/dto/incident-pagination-query.dto';

export class SubmitIncidentDto {
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion: number;
}

export class OutboxQueryDto extends IncidentPaginationQueryDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(QueueOutboxStatus)
  status?: QueueOutboxStatus;
}
