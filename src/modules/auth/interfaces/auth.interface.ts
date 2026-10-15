import { UserRole, UserStatus } from '@/generated/prisma/enums';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUserResponse {
  id: string;
  firstName: string;
  lastName: string | null;
  dni: string;
  phone: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  role: UserRole;
  status: UserStatus;
}

export interface LoginResponseI {
  tokens: AuthTokens;
  user: AuthUserResponse;
}

export interface WebLoginRes {
  dni: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  firstName: string;
  id: string;
  lastName: string | null;
  phone: string;
  role: string;
  status: string;
}

export interface RegisterResponse {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  dni: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}
