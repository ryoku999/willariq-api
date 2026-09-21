import { UserRole } from '@/generated/prisma/enums';
import { IsEnum } from 'class-validator';

export class UpdateUserRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}
