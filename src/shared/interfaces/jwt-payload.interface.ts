import { UserRole } from '@/generated/prisma/enums';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  sessionVersion?: number;
  iat?: number;
  exp?: number;
}
