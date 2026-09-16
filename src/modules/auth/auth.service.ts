import { DatabaseService } from '@/database/database.service';
import { ConflictException, Injectable } from '@nestjs/common';
import { RegisterDto } from './dto/register.dto';
import { RegisterResponse } from './interfaces/auth.interface';
import bcrypt from 'bcryptjs';
import { Prisma } from '@/generated/prisma/client';

@Injectable()
export class AuthService {
  constructor(private readonly db: DatabaseService) {}

  async register(dto: RegisterDto): Promise<RegisterResponse> {
    const uniqueFilters = [{ dni: dto.dni }, { phone: dto.phone }];
    const userFound = await this.db.user.findFirst({
      where: { OR: uniqueFilters },
      select: { id: true },
    });

    if (userFound) {
      throw new ConflictException('Algunos datos ya estan en uso');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    try {
      return await this.db.user.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          dni: dto.dni,
          phone: dto.phone,
          passwordHash,
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
}
