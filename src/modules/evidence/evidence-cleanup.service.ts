import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DatabaseService } from '@/database/database.service';
import { EvidenceUploadStatus } from '@/generated/prisma/enums';
import { MinioStorageService } from '@/infrastructure/storage/minio-storage.service';
import { EVIDENCE_OBJECT_PREFIX } from './evidence.constants';

@Injectable()
export class EvidenceCleanupService {
  private readonly logger = new Logger(EvidenceCleanupService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: MinioStorageService,
  ) {}

  // El intent interno conserva el trabajo incluso si el proceso se interrumpe.
  async discard(intentId: string): Promise<boolean> {
    try {
      await this.db.evidenceUploadIntent.updateMany({
        where: {
          id: intentId,
          status: {
            in: [EvidenceUploadStatus.PENDING, EvidenceUploadStatus.REJECTED],
          },
        },
        data: { status: EvidenceUploadStatus.REJECTED },
      });
      const intent = await this.db.evidenceUploadIntent.findUnique({
        where: { id: intentId },
      });
      if (!intent) return true;
      // Nunca eliminar el objeto de un upload cuyo commit pudo haber sido exitoso.
      if (
        intent.status !== EvidenceUploadStatus.REJECTED &&
        intent.status !== EvidenceUploadStatus.EXPIRED
      )
        return false;
      await this.storage.remove(intent.bucket, intent.objectKey);
      await this.db.evidenceUploadIntent.updateMany({
        where: { id: intent.id, status: EvidenceUploadStatus.REJECTED },
        data: { status: EvidenceUploadStatus.EXPIRED },
      });
      return true;
    } catch {
      this.logger.warn(`Limpieza de evidencia pendiente; intentId=${intentId}`);
      return false;
    }
  }

  @Interval(60_000)
  async reconcile() {
    if (!this.storage.enabled || this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const intents = await this.db.evidenceUploadIntent.findMany({
        where: {
          OR: [
            { status: EvidenceUploadStatus.REJECTED },
            { status: EvidenceUploadStatus.PENDING, expiresAt: { lt: now } },
          ],
          // No procesar intents heredados de otra estrategia de almacenamiento.
          objectKey: { startsWith: EVIDENCE_OBJECT_PREFIX },
        },
        select: { id: true },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 25,
      });
      for (const intent of intents) await this.discard(intent.id);
    } catch {
      this.logger.warn('No se pudo ejecutar la reconciliacion de evidencias');
    } finally {
      this.running = false;
    }
  }
}
