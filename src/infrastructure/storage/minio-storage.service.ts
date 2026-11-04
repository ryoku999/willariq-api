import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';

@Injectable()
export class MinioStorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MinioStorageService.name);
  private readonly client?: Client;
  private readonly agent?: HttpAgent;
  readonly evidenceBucket?: string;
  readonly enabled: boolean;

  constructor(config: ConfigService) {
    this.enabled = config.getOrThrow<boolean>('MINIO_ENABLED');
    if (!this.enabled) return;
    this.evidenceBucket = config.getOrThrow<string>('MINIO_EVIDENCE_BUCKET');
    const useSSL = config.getOrThrow<boolean>('MINIO_USE_SSL');
    this.agent = useSSL
      ? new HttpsAgent({ keepAlive: true, timeout: 30_000 })
      : new HttpAgent({ keepAlive: true, timeout: 30_000 });
    this.client = new Client({
      endPoint: config.getOrThrow<string>('MINIO_ENDPOINT'),
      port: config.getOrThrow<number>('MINIO_PORT'),
      useSSL,
      transportAgent: this.agent,
      accessKey: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: config.getOrThrow<string>('MINIO_SECRET_KEY'),
      region: config.getOrThrow<string>('MINIO_REGION'),
    });
  }

  onModuleDestroy() {
    this.agent?.destroy();
  }

  async onModuleInit() {
    if (!this.enabled) return;
    try {
      if (!(await this.requireClient().bucketExists(this.evidenceBucket!))) {
        throw new Error('Missing bucket');
      }
    } catch {
      throw new Error(
        'No se pudo verificar el bucket privado de evidencias; revisa MinIO y sus permisos',
      );
    }
  }

  async put(bucket: string, key: string, buffer: Buffer, mimeType: string) {
    const client = this.requireClient();
    try {
      await client.putObject(bucket, key, buffer, buffer.length, {
        'Content-Type': mimeType,
      });
    } catch {
      this.logger.warn('Fallo de escritura en almacenamiento de evidencias');
      throw new ServiceUnavailableException(
        'No se pudo guardar la imagen en MinIO',
      );
    }
  }

  async get(bucket: string, key: string) {
    const client = this.requireClient();
    try {
      return await client.getObject(bucket, key);
    } catch (error: unknown) {
      if (
        this.errorCode(error) === 'NoSuchKey' ||
        this.errorCode(error) === 'NotFound'
      ) {
        throw new NotFoundException(
          'El archivo de evidencia no esta disponible',
        );
      }
      throw new ServiceUnavailableException(
        'No se pudo leer la imagen en MinIO',
      );
    }
  }

  async remove(bucket: string, key: string) {
    const client = this.requireClient();
    try {
      await client.removeObject(bucket, key);
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo eliminar el archivo en MinIO',
      );
    }
  }

  private requireClient(): Client {
    if (!this.client)
      throw new ServiceUnavailableException(
        'El almacenamiento de evidencias esta deshabilitado',
      );
    return this.client;
  }

  private errorCode(error: unknown): string | undefined {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string'
    )
      return error.code;
    return undefined;
  }
}
