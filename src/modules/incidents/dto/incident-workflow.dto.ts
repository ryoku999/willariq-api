import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  EntityType,
  IncidentCategory,
  IncidentType,
  Sentiment,
  UrgencyLevel,
} from '@/generated/prisma/enums';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class IncidentVersionDto {
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
}
export class WorkflowReasonDto extends IncidentVersionDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string;
}
export class ReviewEntityDto {
  @IsEnum(EntityType) type!: EntityType;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(300) value!: string;
  @IsNumber() @Min(0) @Max(1) confidence!: number;
}
export class ReviewIncidentDto extends WorkflowReasonDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  improvedDescription!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  recommendedAction!: string;
  @IsEnum(IncidentType) type!: IncidentType;
  @IsEnum(IncidentCategory) category!: IncidentCategory;
  @IsEnum(UrgencyLevel) urgency!: UrgencyLevel;
  @IsEnum(Sentiment) sentiment!: Sentiment;
  @IsBoolean() requiresSupervision!: boolean;
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  keywords!: string[];
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ReviewEntityDto)
  entities!: ReviewEntityDto[];
}
export class RejectIncidentDto extends WorkflowReasonDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  rejectionReason!: string;
}
export class CreateAssignmentDto extends IncidentVersionDto {
  @IsUUID() areaId!: string;
  @IsOptional() @IsUUID() operatorId?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note?: string;
}
export class AssignmentVersionDto extends IncidentVersionDto {
  @IsUUID() assignmentId!: string;
  @IsInt() @Min(1) @Max(2147483646) expectedAssignmentVersion!: number;
}
export class ReassignIncidentDto extends CreateAssignmentDto {
  @IsUUID() assignmentId!: string;
  @IsInt() @Min(1) @Max(2147483646) expectedAssignmentVersion!: number;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string;
}
export class CancelAssignmentDto extends AssignmentVersionDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string;
}
export class ResolveIncidentDto extends AssignmentVersionDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  resolutionSummary!: string;
}
