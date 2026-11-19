import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { IncidentPaginationQueryDto } from '../incidents/dto/incident-pagination-query.dto';

export class NotificationsQueryDto extends IncidentPaginationQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  unreadOnly?: boolean;
}
