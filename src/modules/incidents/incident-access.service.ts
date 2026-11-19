import { Prisma } from '@/generated/prisma/client';
import {
  AreaMemberRole,
  AssignmentStatus,
  MunicipalAreaStatus,
  UserRole,
} from '@/generated/prisma/enums';
import { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

@Injectable()
export class IncidentAccessService {
  readableWhere(actor: AuthenticatedUser): Prisma.IncidentWhereInput {
    switch (actor.role) {
      case UserRole.ADMIN:
      case UserRole.SUPERVISOR:
        return {};
      case UserRole.CITIZEN:
        return { reporterId: actor.id };
      case UserRole.OPERATOR:
        return {
          assignments: {
            some: {
              replacedBy: { is: null },
              status: {
                notIn: [
                  AssignmentStatus.CANCELLED,
                  AssignmentStatus.REASSIGNED,
                ],
              },
              area: {
                status: MunicipalAreaStatus.ACTIVE,
                members: { some: { userId: actor.id, active: true } },
              },
              OR: [
                { operatorId: actor.id },
                {
                  area: {
                    members: {
                      some: {
                        userId: actor.id,
                        active: true,
                        role: AreaMemberRole.MANAGER,
                      },
                    },
                  },
                },
              ],
            },
          },
        };
      default:
        throw new ForbiddenException('No tienes permisos para esta accion');
    }
  }

  async assertReadable(
    client: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    incidentId: string,
  ) {
    const incident = await client.incident.findFirst({
      where: { AND: [{ id: incidentId }, this.readableWhere(actor)] },
      select: { id: true, reporterId: true, status: true, version: true },
    });
    if (!incident) {
      // No confirmar la existencia de un reporte fuera del alcance del usuario.
      throw new NotFoundException('Incidencia no encontrada');
    }
    return incident;
  }
}
