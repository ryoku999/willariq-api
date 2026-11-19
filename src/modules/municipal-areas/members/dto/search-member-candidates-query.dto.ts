import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class SearchMemberCandidatesQueryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 160)
  search!: string;
}
