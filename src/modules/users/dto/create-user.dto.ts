import { IsEnum } from 'class-validator';
import { UserRole } from '@/generated/prisma/enums';
import { RegisterDto } from '@/modules/auth/dto/register.dto';

export class CreateUserDto extends RegisterDto {
  @IsEnum(UserRole)
  role!: UserRole;
}
