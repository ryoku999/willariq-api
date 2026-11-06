import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AccountEmailDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(160)
  email!: string;
}

export class SetAccountEmailDto extends AccountEmailDto {
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  currentPassword!: string;
}

export class AccountTokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}

export class ResetAccountPasswordDto extends AccountTokenDto {
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}

export class ChangeAccountPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}
