import { Transform } from 'class-transformer';
import {
  IncidentCategory,
  IncidentStatus,
  IncidentType,
  UrgencyLevel,
} from '@/generated/prisma/enums';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IncidentPaginationQueryDto } from './incident-pagination-query.dto';

export class ListIncidentsQueryDto extends IncidentPaginationQueryDto {
  @IsOptional()
  @IsEnum(IncidentStatus)
  status?: IncidentStatus;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  requiresSupervision?: boolean;

  @IsOptional()
  @IsEnum(IncidentType)
  type?: IncidentType;

  @IsOptional()
  @IsEnum(IncidentCategory)
  category?: IncidentCategory;

  @IsOptional()
  @IsEnum(UrgencyLevel)
  urgency?: UrgencyLevel;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  trackingCode?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  createdFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  createdTo?: string;

  @IsOptional()
  @IsUUID()
  areaId?: string;

  @IsOptional()
  @IsUUID()
  operatorId?: string;
}
