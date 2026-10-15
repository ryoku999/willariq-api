import { DatabaseService } from '@/database/database.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { CreateMunicipalAreaDto } from './dto/create-municipal-area.dto';
import {
  AssignmentStatus,
  MunicipalAreaStatus,
} from '@/generated/prisma/enums';
import { Prisma } from '@/generated/prisma/client';
import { ListMunicipalAreasQueryDto } from './dto/list-municipal-areas-query.dto';
import { UpdateMunicipalAreaDto } from './dto/update-municipal-area.dto';
import { UpdateMunicipalAreaStatusDto } from './dto/update-municipal-area-status.dto';
import { AreaAuditContext } from '@/shared/interfaces/audit-context.interface';

@Injectable()
export class MunicipalAreasService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    userId: string,
    dto: CreateMunicipalAreaDto,
    context: AreaAuditContext,
  ) {
    const code = this.normalizeCode(dto.code);
    const name = this.normalizeText(dto.name);

    try {
      return await this.db.$transaction(async (transaction) => {
        const area = await transaction.municipalArea.create({
          data: {
            code,
            normalizedCode: code,
            name,
            normalizedName: this.normalizeNameKey(name),
            description: this.normalizeNullable(dto.description),
            phone: this.normalizeNullable(dto.phone),
            email: this.normalizeEmail(dto.email),
          },
          select: {
            id: true,
            code: true,
            name: true,
            description: true,
            phone: true,
            email: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        await this.auditService.record(
          {
            userId: userId,
            action: 'AREA_CREATED',
            entityType: 'MunicipalArea',
            entityId: area.id,
            newValue: this.toAuditValue(area),
            ...context,
          },
          transaction,
        );

        return area;
      });
    } catch (error) {
      this.handleUniqueConflict(error);
      throw error;
    }
  }

  async list(query: ListMunicipalAreasQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.MunicipalAreaWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await this.db.$transaction([
      this.db.municipalArea.findMany({
        where,
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          phone: true,
          email: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take: query.limit,
      }),
      this.db.municipalArea.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async findById(id: string) {
    const area = await this.db.municipalArea.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        phone: true,
        email: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!area) {
      throw new NotFoundException('Area municipal no encontrada');
    }

    return area;
  }

  async update(
    actorId: string,
    id: string,
    dto: UpdateMunicipalAreaDto,
    context: AreaAuditContext,
  ) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Debes enviar al menos un campo');
    }

    const area = await this.findById(id);
    const data: Prisma.MunicipalAreaUpdateInput = {};
    const oldValue: Record<string, string | null> = {};
    const newValue: Record<string, string | null> = {};

    if (dto.name !== undefined) {
      const name = this.normalizeText(dto.name);
      if (name !== area.name) {
        data.name = name;
        data.normalizedName = this.normalizeNameKey(name);
        oldValue.name = area.name;
        newValue.name = name;
      }
    }
    this.addNullableChange(
      'description',
      dto.description,
      area.description,
      data,
      oldValue,
      newValue,
    );
    this.addNullableChange(
      'phone',
      dto.phone,
      area.phone,
      data,
      oldValue,
      newValue,
    );

    if (dto.email !== undefined) {
      const email = this.normalizeEmail(dto.email);
      if (email !== area.email) {
        data.email = email;
        oldValue.email = area.email;
        newValue.email = email;
      }
    }

    if (Object.keys(newValue).length === 0) {
      return area;
    }

    try {
      return await this.db.$transaction(async (transaction) => {
        const updated = await transaction.municipalArea.update({
          where: { id },
          data,
          select: {
            id: true,
            code: true,
            name: true,
            description: true,
            phone: true,
            email: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        await this.auditService.record(
          {
            userId: actorId,
            action: 'AREA_UPDATED',
            entityType: 'MunicipalArea',
            entityId: id,
            oldValue,
            newValue,
            ...context,
          },
          transaction,
        );

        return updated;
      });
    } catch (error) {
      this.handleUniqueConflict(error);
      throw error;
    }
  }

  async updateStatus(
    actorId: string,
    id: string,
    dto: UpdateMunicipalAreaStatusDto,
    context: AreaAuditContext,
  ) {
    const area = await this.findById(id);
    if (area.status === dto.status) {
      return area;
    }

    if (dto.status === MunicipalAreaStatus.INACTIVE) {
      const activeAssignments = await this.db.incidentAssignment.count({
        where: {
          areaId: id,
          status: {
            in: [
              AssignmentStatus.ASSIGNED,
              AssignmentStatus.ACCEPTED,
              AssignmentStatus.IN_PROGRESS,
            ],
          },
        },
      });
      if (activeAssignments > 0) {
        throw new ConflictException(
          'El area tiene asignaciones activas pendientes',
        );
      }
    }

    return this.db.$transaction(async (transaction) => {
      const updated = await transaction.municipalArea.update({
        where: { id },
        data: { status: dto.status },
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          phone: true,
          email: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      await this.auditService.record(
        {
          userId: actorId,
          action:
            dto.status === MunicipalAreaStatus.ACTIVE
              ? 'AREA_ACTIVATED'
              : 'AREA_INACTIVATED',
          entityType: 'MunicipalArea',
          entityId: id,
          oldValue: { status: area.status },
          newValue: { status: dto.status },
          ...context,
        },
        transaction,
      );

      return updated;
    });
  }

  private addNullableChange(
    field: 'description' | 'phone',
    input: string | null | undefined,
    current: string | null,
    data: Prisma.MunicipalAreaUpdateInput,
    oldValue: Record<string, string | null>,
    newValue: Record<string, string | null>,
  ): void {
    if (input === undefined) {
      return;
    }

    const value = this.normalizeNullable(input);
    if (value !== current) {
      data[field] = value;
      oldValue[field] = current;
      newValue[field] = value;
    }
  }

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
  }

  private normalizeText(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
  }

  private normalizeNameKey(value: string): string {
    return this.normalizeText(value).toLocaleLowerCase('es-PE');
  }

  private normalizeNullable(value: string | null | undefined): string | null {
    if (value == null) {
      return null;
    }
    return value.trim() || null;
  }

  private normalizeEmail(value: string | null | undefined): string | null {
    const email = this.normalizeNullable(value);
    return email?.toLowerCase() ?? null;
  }

  private handleUniqueConflict(error: unknown): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Ya existe un area municipal con ese codigo o nombre',
      );
    }
  }

  private toAuditValue(area: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    phone: string | null;
    email: string | null;
    status: MunicipalAreaStatus;
    createdAt: Date;
    updatedAt: Date;
  }): Prisma.InputJsonObject {
    return {
      ...area,
      createdAt: area.createdAt.toISOString(),
      updatedAt: area.updatedAt.toISOString(),
    };
  }
}
