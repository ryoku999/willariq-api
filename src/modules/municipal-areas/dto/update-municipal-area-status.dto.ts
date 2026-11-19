import { MunicipalAreaStatus } from '@/generated/prisma/enums';
import { IsEnum } from 'class-validator';

export class UpdateMunicipalAreaStatusDto {
  @IsEnum(MunicipalAreaStatus)
  status!: MunicipalAreaStatus;
}
