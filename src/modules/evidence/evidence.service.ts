import {
  BadRequestException,
  ConflictException,
  FileTypeValidator,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import {
  EvidenceStatus,
  EvidenceType,
  EvidenceUploadStatus,
  HistoryActorType,
  IncidentStatus,
  UserRole,
} from '@/generated/prisma/enums';
import { RustfsStorageService } from '@/infrastructure/storage/rustfs-storage.service';
import { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { IncidentAccessService } from '../incidents/incident-access.service';
import { IncidentAuditContext } from '../incidents/incidents.service';
import { IncidentPaginationQueryDto } from '../incidents/dto/incident-pagination-query.dto';
import { EvidenceCleanupService } from './evidence-cleanup.service';
import { EVIDENCE_SELECT, evidenceResponse } from './evidence.select';
import { EVIDENCE_OBJECT_PREFIX } from './evidence.constants';

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);
  private readonly imageValidator = new FileTypeValidator({
    fileType: /^image\/(jpeg|png|webp)$/,
    overrideMimeType: true,
  });
  private readonly maxImageBytes: number;
  private readonly maxFiles: number;
  private readonly maxTotalBytes: bigint;

  constructor(
    private readonly db: DatabaseService,
    private readonly access: IncidentAccessService,
    private readonly storage: RustfsStorageService,
    private readonly cleanup: EvidenceCleanupService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.maxImageBytes = config.getOrThrow<number>('EVIDENCE_MAX_IMAGE_BYTES');
    this.maxFiles = config.getOrThrow<number>(
      'EVIDENCE_MAX_FILES_PER_INCIDENT',
    );
    this.maxTotalBytes = BigInt(
      config.getOrThrow<number>('EVIDENCE_MAX_TOTAL_BYTES_PER_INCIDENT'),
    );
  }

  async assertCanUpload(
    actor: AuthenticatedUser,
    id: string,
    client: Prisma.TransactionClient = this.db,
  ) {
    const incident = await this.access.assertReadable(client, actor, id);
    if (actor.role === UserRole.CITIZEN) {
      if (incident.status !== IncidentStatus.RECEIVED)
        throw new ConflictException(
          'Solo puedes modificar evidencias en RECEIVED',
        );
    } else {
      const assignment = await client.incidentAssignment.findFirst({
        where: {
          incidentId: id,
          operatorId: actor.id,
          status: 'IN_PROGRESS',
          replacedBy: { is: null },
          area: {
            status: 'ACTIVE',
            members: { some: { userId: actor.id, active: true } },
          },
        },
      });
      if (incident.status !== IncidentStatus.IN_PROGRESS || !assignment)
        throw new ForbiddenException(
          'Solo el responsable activo puede adjuntar evidencias durante la atencion',
        );
    }
    if (!this.storage.enabled || !this.storage.evidenceBucket)
      throw new ServiceUnavailableException(
        'El almacenamiento de evidencias esta deshabilitado',
      );
    return incident;
  }

  async upload(
    actor: AuthenticatedUser,
    id: string,
    file: Express.Multer.File | undefined,
    context: IncidentAuditContext,
  ) {
    await this.assertCanUpload(actor, id);
    if (!file || !file.buffer || file.buffer.length === 0)
      throw new BadRequestException(
        'Debes adjuntar una imagen en el campo file',
      );
    if (file.size > this.maxImageBytes || file.buffer.length !== file.size)
      throw new BadRequestException('La imagen supera el tamano permitido');
    if (!(await this.imageValidator.isValid(file)))
      throw new BadRequestException(
        'Solo se permiten imagenes JPEG, PNG o WebP con contenido valido',
      );
    const extensions: Record<string, string[]> = {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
    };
    if (
      !extensions[file.mimetype]?.includes(
        extname(file.originalname).toLowerCase(),
      )
    )
      throw new BadRequestException(
        'La extension del archivo no coincide con su contenido',
      );
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const previous = await this.db.$transaction(async (tx) => {
      await this.lockIncident(tx, id);
      const incident = await this.assertCanUpload(actor, id, tx);
      const evidence = await tx.incidentEvidence.findFirst({
        where: { incidentId: id, checksum, status: EvidenceStatus.AVAILABLE },
        select: EVIDENCE_SELECT,
      });
      return evidence
        ? {
            ...evidenceResponse(evidence),
            incidentVersion: incident.version,
            reused: true,
          }
        : null;
    });
    if (previous) return previous;
    const bucket = this.storage.evidenceBucket!;
    const objectKey = `${EVIDENCE_OBJECT_PREFIX}${id}/${randomUUID()}${extensions[file.mimetype][0]}`;
    const fileName = Array.from(
      file.originalname.split(/[\\/]/).pop() || 'imagen',
    )
      .filter(
        (character) =>
          character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      )
      .join('')
      .slice(0, 255);
    const intent = await this.db.evidenceUploadIntent.create({
      data: {
        incidentId: id,
        requestedById: actor.id,
        bucket,
        objectKey,
        fileName,
        declaredMimeType: file.mimetype,
        declaredSizeBytes: BigInt(file.size),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    try {
      // Solo RAM -> RustFS. Ninguna escritura local ni transaccion SQL durante el upload.
      await this.storage.put(bucket, objectKey, file.buffer, file.mimetype);
      const result = await this.db.$transaction(async (tx) => {
        await this.lockIncident(tx, id);
        const incident = await this.assertCanUpload(actor, id, tx);
        const duplicate = await tx.incidentEvidence.findFirst({
          where: { incidentId: id, checksum, status: EvidenceStatus.AVAILABLE },
          select: EVIDENCE_SELECT,
        });
        if (duplicate) {
          await tx.evidenceUploadIntent.update({
            where: { id: intent.id },
            data: { status: EvidenceUploadStatus.REJECTED },
          });
          return {
            evidence: duplicate,
            incidentVersion: incident.version,
            reused: true,
          };
        }
        const quota = await tx.incidentEvidence.aggregate({
          where: {
            incidentId: id,
            status: {
              in: [EvidenceStatus.AVAILABLE, EvidenceStatus.QUARANTINED],
            },
          },
          _count: { _all: true },
          _sum: { sizeBytes: true },
        });
        if (
          quota._count._all >= this.maxFiles ||
          (quota._sum.sizeBytes ?? 0n) + BigInt(file.size) > this.maxTotalBytes
        )
          throw new ConflictException(
            'La incidencia alcanzo el limite de archivos o bytes de evidencia',
          );
        const reserved = await tx.evidenceUploadIntent.updateMany({
          where: {
            id: intent.id,
            status: EvidenceUploadStatus.PENDING,
            expiresAt: { gt: new Date() },
          },
          data: {
            status: EvidenceUploadStatus.CONFIRMED,
            confirmedAt: new Date(),
          },
        });
        if (reserved.count !== 1)
          throw new ConflictException(
            'La carga expiro; vuelve a enviar la imagen',
          );
        const evidence = await tx.incidentEvidence.create({
          data: {
            incidentId: id,
            uploadedById: actor.id,
            type: EvidenceType.IMAGE,
            status: EvidenceStatus.AVAILABLE,
            bucket,
            objectKey,
            mimeType: file.mimetype,
            fileName,
            sizeBytes: BigInt(file.size),
            checksum,
            checksumAlgorithm: 'SHA256',
            verifiedAt: new Date(),
          },
          select: EVIDENCE_SELECT,
        });
        await tx.evidenceUploadIntent.update({
          where: { id: intent.id },
          data: { evidenceId: evidence.id },
        });
        const updated = await tx.incident.update({
          where: { id },
          data: { version: { increment: 1 } },
          select: { version: true },
        });
        await this.record(
          tx,
          actor,
          id,
          evidence.id,
          'INCIDENT_EVIDENCE_ADDED',
          incident.version,
          updated.version,
          context,
        );
        return { evidence, incidentVersion: updated.version, reused: false };
      });
      if (result.reused) await this.cleanup.discard(intent.id);
      return {
        ...evidenceResponse(result.evidence),
        incidentVersion: result.incidentVersion,
        reused: result.reused,
      };
    } catch (error) {
      await this.cleanup.discard(intent.id);
      throw error;
    }
  }

  async list(
    actor: AuthenticatedUser,
    id: string,
    query: IncidentPaginationQueryDto,
  ) {
    return this.db.$transaction(
      async (tx) => {
        const incident = await this.access.assertReadable(tx, actor, id);
        const where = { incidentId: id, status: EvidenceStatus.AVAILABLE };
        const items = await tx.incidentEvidence.findMany({
          where,
          select: EVIDENCE_SELECT,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        });
        const total = await tx.incidentEvidence.count({ where });
        return {
          items: items.map(evidenceResponse),
          incidentVersion: incident.version,
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            pages: Math.ceil(total / query.limit),
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async content(actor: AuthenticatedUser, id: string, evidenceId: string) {
    await this.access.assertReadable(this.db, actor, id);
    const evidence = await this.db.incidentEvidence.findFirst({
      where: {
        id: evidenceId,
        incidentId: id,
        status: EvidenceStatus.AVAILABLE,
      },
      select: {
        bucket: true,
        objectKey: true,
        mimeType: true,
        sizeBytes: true,
      },
    });
    if (!evidence) throw new NotFoundException('Evidencia no encontrada');
    const stream = await this.storage.get(evidence.bucket, evidence.objectKey);
    const extension =
      evidence.mimeType === 'image/jpeg'
        ? 'jpg'
        : evidence.mimeType === 'image/webp'
          ? 'webp'
          : 'png';
    return new StreamableFile(stream, {
      type: evidence.mimeType,
      disposition: `inline; filename="${evidenceId}.${extension}"`,
      ...(evidence.sizeBytes !== null
        ? { length: Number(evidence.sizeBytes) }
        : {}),
    }).setErrorLogger(() =>
      this.logger.warn(
        `Transferencia de evidencia interrumpida; evidenceId=${evidenceId}`,
      ),
    );
  }

  async remove(
    actor: AuthenticatedUser,
    id: string,
    evidenceId: string,
    context: IncidentAuditContext,
  ) {
    if (actor.role !== UserRole.CITIZEN)
      throw new ForbiddenException('El personal no puede eliminar evidencias');
    const result = await this.db.$transaction(async (tx) => {
      await this.lockIncident(tx, id);
      const incident = await this.assertCanUpload(actor, id, tx);
      const evidence = await tx.incidentEvidence.findFirst({
        where: { id: evidenceId, incidentId: id },
        select: { ...EVIDENCE_SELECT, bucket: true, objectKey: true },
      });
      if (!evidence) throw new NotFoundException('Evidencia no encontrada');
      if (evidence.status === EvidenceStatus.QUARANTINED)
        throw new ConflictException('Esta evidencia requiere revision');
      const intent = await tx.evidenceUploadIntent.upsert({
        where: { evidenceId },
        create: {
          incidentId: id,
          requestedById: actor.id,
          evidenceId,
          bucket: evidence.bucket,
          objectKey: evidence.objectKey,
          fileName: evidence.fileName ?? 'imagen',
          declaredMimeType: evidence.mimeType,
          declaredSizeBytes: evidence.sizeBytes ?? 0n,
          expiresAt: new Date(),
          status: EvidenceUploadStatus.REJECTED,
        },
        update: { status: EvidenceUploadStatus.REJECTED },
        select: { id: true },
      });
      if (evidence.status === EvidenceStatus.REJECTED)
        return { intentId: intent.id, incidentVersion: incident.version };
      await tx.incidentEvidence.update({
        where: { id: evidenceId },
        data: { status: EvidenceStatus.REJECTED },
      });
      const updated = await tx.incident.update({
        where: { id },
        data: { version: { increment: 1 } },
        select: { version: true },
      });
      await this.record(
        tx,
        actor,
        id,
        evidenceId,
        'INCIDENT_EVIDENCE_REMOVED',
        incident.version,
        updated.version,
        context,
      );
      return { intentId: intent.id, incidentVersion: updated.version };
    });
    const removed = await this.cleanup.discard(result.intentId);
    return {
      id: evidenceId,
      status: EvidenceStatus.REJECTED,
      incidentVersion: result.incidentVersion,
      storageCleanupPending: !removed,
    };
  }

  private async lockIncident(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM incidents WHERE id = ${id}::uuid FOR UPDATE`;
  }

  private async record(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    id: string,
    evidenceId: string,
    action: string,
    before: number,
    after: number,
    context: IncidentAuditContext,
  ) {
    const current = await tx.incident.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });
    await tx.incidentHistory.create({
      data: {
        incidentId: id,
        userId: actor.id,
        actorType: HistoryActorType.USER,
        previousStatus: current.status,
        newStatus: current.status,
        comment:
          action === 'INCIDENT_EVIDENCE_ADDED'
            ? 'Evidencia adjuntada'
            : 'Evidencia retirada',
        metadata: { action, evidenceId },
      },
    });
    await this.audit.record(
      {
        userId: actor.id,
        action,
        entityType: 'IncidentEvidence',
        entityId: evidenceId,
        oldValue: { incidentVersion: before },
        newValue: { incidentId: id, incidentVersion: after },
        ...context,
      },
      tx,
    );
  }
}
