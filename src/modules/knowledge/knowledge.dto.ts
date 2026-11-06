import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

const sources = [
  'MANUAL',
  'MUNICIPAL_REGULATION',
  'FAQ',
  'PROCEDURE',
  'OTHER',
] as const;

export class UploadKnowledgeDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  title!: string;

  @IsIn(sources)
  sourceType!: (typeof sources)[number];
}
