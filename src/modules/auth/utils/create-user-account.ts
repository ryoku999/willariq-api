import { ConflictException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { Prisma, UserRole } from '@/generated/prisma/client';
import type { RegisterDto } from '../dto/register.dto';
import type { RegisterResponse } from '../interfaces/auth.interface';

export async function createUserAccount(
  db: Pick<Prisma.TransactionClient, 'user'>,
  dto: RegisterDto,
  role: UserRole,
): Promise<RegisterResponse> {
  const uniqueFilters = [{ dni: dto.dni }, { phone: dto.phone }];
  const userFound = await db.user.findFirst({
    where: { OR: uniqueFilters },
    select: { id: true },
  });

  if (userFound) {
    throw new ConflictException('Algunos datos ya estan en uso');
  }

  const passwordHash = await bcrypt.hash(dto.password, 12);

  try {
    return await db.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        dni: dto.dni,
        phone: dto.phone,
        passwordHash,
        role,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        dni: true,
        email: true,
        emailVerifiedAt: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Algunos datos ya estan en uso');
    }

    throw error;
  }
}
