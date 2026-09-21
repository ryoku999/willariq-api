import { UserStatus } from '@/generated/prisma/enums';
import { IsEnum } from 'class-validator';

export class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;
}
