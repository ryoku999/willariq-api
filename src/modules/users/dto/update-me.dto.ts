import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  lastName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{9}$/)
  phone?: string;
}
