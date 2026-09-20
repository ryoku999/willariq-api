import { DatabaseService } from '@/database/database.service';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UpdateMeDto } from './dto/update-me.dto';
import { Prisma, UserStatus } from '@/generated/prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  async findMe(userId: string) {
    return this.findById(userId);
  }

  async findById(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dni: true,
        phone: true,
        email: true,
        emailVerifiedAt: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return user;
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    try {
      return await this.db.user.update({
        where: { id: userId },
        data: {
          ...(dto.firstName === undefined
            ? {}
            : { firstName: dto.firstName.trim() }),
          ...(dto.lastName === undefined
            ? {}
            : { lastName: dto.lastName.trim() }),
          ...(dto.phone === undefined ? {} : { phone: dto.phone }),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          dni: true,
          phone: true,
          email: true,
          emailVerifiedAt: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException('Algunos datos ya estan en uso');
      }

      throw error;
    }
  }

  private isUniqueConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private statusAuditAction(status: UserStatus): string {
    if (status === UserStatus.BLOCKED) {
      return 'USER_BLOCKED';
    }
    if (status === UserStatus.INACTIVE) {
      return 'USER_INACTIVATED';
    }
    return 'USER_ACTIVATED';
  }
}
