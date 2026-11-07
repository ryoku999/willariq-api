import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { TRACKING_PATTERN } from './chat.types';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const optional = (_: unknown, value: unknown) => value !== undefined;

export class CreateChatSessionDto {
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  title?: string;
}

export class CreateChatMessageDto {
  @IsUUID()
  clientRequestId!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(12000)
  content!: string;

  @ValidateIf(optional)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(TRACKING_PATTERN)
  trackingCode?: string;
}
