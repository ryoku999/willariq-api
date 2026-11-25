import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';

@Injectable()
export class RustfsStorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RustfsStorageService.name);
  private readonly client?: S3Client;
  readonly evidenceBucket?: string;
  readonly enabled: boolean;

  constructor(config: ConfigService) {
    this.enabled = config.getOrThrow<boolean>('RUSTFS_ENABLED');
    if (!this.enabled) return;
    this.evidenceBucket = config.getOrThrow<string>('RUSTFS_EVIDENCE_BUCKET');
    this.client = new S3Client({
      endpoint: config.getOrThrow<string>('RUSTFS_ENDPOINT'),
      region: config.getOrThrow<string>('RUSTFS_REGION'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('RUSTFS_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('RUSTFS_SECRET_KEY'),
      },
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: { connectionTimeout: 5000, requestTimeout: 30000 },
    });
  }

  onModuleDestroy() {
    this.client?.destroy();
  }

  async onModuleInit() {
    if (!this.client || !this.evidenceBucket) return;
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: this.evidenceBucket }),
      );
    } catch {
      throw new Error(
        'No se pudo verificar el bucket privado de evidencias; revisa RustFS y sus permisos',
      );
    }
  }

  async put(bucket: string, key: string, buffer: Buffer, mimeType: string) {
    const client = this.requireClient();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentLength: buffer.length,
          ContentType: mimeType,
        }),
      );
    } catch {
      this.logger.warn('Fallo de escritura en almacenamiento de archivos');
      throw new ServiceUnavailableException(
        'No se pudo guardar el archivo en RustFS',
      );
    }
  }

  async get(bucket: string, key: string): Promise<Readable> {
    const client = this.requireClient();
    try {
      const { Body } = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!(Body instanceof Readable))
        throw new Error('Respuesta S3 sin stream');
      return Body;
    } catch (error: unknown) {
      if (
        error instanceof S3ServiceException &&
        (error.name === 'NoSuchKey' || error.name === 'NotFound')
      ) {
        throw new NotFoundException('El archivo no está disponible');
      }
      throw new ServiceUnavailableException(
        'No se pudo leer el archivo en RustFS',
      );
    }
  }

  async remove(bucket: string, key: string) {
    const client = this.requireClient();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo eliminar el archivo en RustFS',
      );
    }
  }

  private requireClient(): S3Client {
    if (!this.client)
      throw new ServiceUnavailableException(
        'El almacenamiento de archivos está deshabilitado',
      );
    return this.client;
  }
}
