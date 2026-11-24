import { UserRole, UserStatus } from '@/generated/prisma/enums';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUserResponse {
  id: string;
  firstName: string | null;
  lastName: string | null;
  dni: string;
  phone: string | null;
  email: string | null;
  emailVerifiedAt: Date | null;
  role: UserRole;
  status: UserStatus;
}

export interface LoginResponseI {
  tokens: AuthTokens;
  user: AuthUserResponse;
}

export interface RegisterResponse {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  dni: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}
