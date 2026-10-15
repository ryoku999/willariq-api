import { AreaMemberRole } from '@/generated/prisma/enums';
import { IsEnum, IsUUID } from 'class-validator';

export class AddMunicipalAreaMemberDto {
  @IsUUID()
  userId!: string;

  @IsEnum(AreaMemberRole)
  role!: AreaMemberRole;
}
