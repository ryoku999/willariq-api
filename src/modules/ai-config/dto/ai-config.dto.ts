import { AiCapability, AiProvider } from '@/generated/prisma/enums';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IncidentPaginationQueryDto } from '../../incidents/dto/incident-pagination-query.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const optional = (_object: unknown, value: unknown) => value !== undefined;
const booleanQuery = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class CreatePromptDto {
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,119}$/)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  version!: number;

  @IsEnum(AiCapability)
  capability!: AiCapability;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  systemPrompt!: string;

  @ValidateIf(optional)
  @IsObject()
  responseSchema?: Record<string, unknown>;
}

export class ListPromptsQueryDto extends IncidentPaginationQueryDto {
  @ValidateIf(optional)
  @IsEnum(AiCapability)
  capability?: AiCapability;

  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  name?: string;

  @ValidateIf(optional)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  version?: number;

  @ValidateIf(optional)
  @Transform(booleanQuery)
  @IsBoolean()
  active?: boolean;
}

export class CreateAiRouteDto {
  @IsEnum(AiCapability)
  capability!: AiCapability;

  @IsEnum(AiProvider)
  provider!: AiProvider;

  @Transform(trim)
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,179}$/)
  model!: string;

  @IsInt()
  @Min(1)
  @Max(1000000)
  priority!: number;

  @IsBoolean()
  enabled = false;

  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs = 30000;
}

export class UpdateAiRouteDto {
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,179}$/)
  model?: string;

  @ValidateIf(optional)
  @IsBoolean()
  enabled?: boolean;

  @ValidateIf(optional)
  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;
}

export class ListAiRoutesQueryDto extends IncidentPaginationQueryDto {
  @ValidateIf(optional)
  @IsEnum(AiCapability)
  capability?: AiCapability;

  @ValidateIf(optional)
  @IsEnum(AiProvider)
  provider?: AiProvider;

  @ValidateIf(optional)
  @Transform(booleanQuery)
  @IsBoolean()
  enabled?: boolean;
}

export class ReorderAiRoutesDto {
  @IsEnum(AiCapability)
  capability!: AiCapability;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  routeIds!: string[];
}

export class CheckAiConfigDto {
  @ValidateIf(optional)
  @IsEnum(AiCapability)
  capability?: AiCapability;
}

export class ValidatePromptOutputDto {
  @IsObject()
  output!: Record<string, unknown>;
}
