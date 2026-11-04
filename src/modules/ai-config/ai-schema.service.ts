import { BadRequestException, Injectable } from '@nestjs/common';
import Ajv from 'ajv';
import {
  AiCapability,
  EntityType,
  IncidentCategory,
  IncidentType,
  Sentiment,
  UrgencyLevel,
} from '@/generated/prisma/enums';
import { Prisma } from '@/generated/prisma/client';
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  const sort = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sort);
    if (entry !== null && typeof entry === 'object')
      return Object.fromEntries(
        Object.entries(entry)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, sort(child)]),
      );
    return entry;
  };
  return JSON.stringify(sort(value));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class AiSchemaService {
  classificationContract(): Prisma.InputJsonObject {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        improvedDescription: { type: 'string', minLength: 1, maxLength: 5000 },
        recommendedAction: { type: 'string', minLength: 1, maxLength: 2000 },
        type: { type: 'string', enum: Object.values(IncidentType) },
        category: { type: 'string', enum: Object.values(IncidentCategory) },
        urgency: { type: 'string', enum: Object.values(UrgencyLevel) },
        sentiment: { type: 'string', enum: Object.values(Sentiment) },
        keywords: {
          type: 'array',
          maxItems: 10,
          uniqueItems: true,
          items: { type: 'string', minLength: 1, maxLength: 80 },
        },
        aiConfidence: { type: 'number', minimum: 0, maximum: 1 },
        requiresSupervision: { type: 'boolean' },
        entities: {
          type: 'array',
          maxItems: 30,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string', enum: Object.values(EntityType) },
              value: { type: 'string', minLength: 1, maxLength: 300 },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['type', 'value', 'confidence'],
          },
        },
      },
      required: [
        'improvedDescription',
        'recommendedAction',
        'type',
        'category',
        'urgency',
        'sentiment',
        'keywords',
        'aiConfidence',
        'requiresSupervision',
        'entities',
      ],
    };
  }

  prepare(
    capability: AiCapability,
    candidate?: unknown,
  ): Prisma.InputJsonObject {
    const schema: unknown =
      candidate === undefined &&
      capability === AiCapability.INCIDENT_CLASSIFICATION
        ? this.classificationContract()
        : candidate;
    if (!schema || typeof schema !== 'object' || Array.isArray(schema))
      throw new BadRequestException(
        'responseSchema debe ser un objeto JSON Schema',
      );
    if (Buffer.byteLength(JSON.stringify(schema), 'utf8') > 32768)
      throw new BadRequestException('responseSchema supera 32 KiB');
    this.assertSafeSchema(schema);
    const jsonSchema = schema as Prisma.InputJsonObject;
    if (
      jsonSchema.type !== 'object' ||
      jsonSchema.additionalProperties !== false
    )
      throw new BadRequestException(
        'El esquema raiz debe ser object y additionalProperties=false',
      );
    try {
      // Instancia por validacion: no acumular esquemas administrables en una cache global.
      new Ajv({
        strict: true,
        ownProperties: true,
        validateFormats: false,
      }).compile(jsonSchema);
    } catch {
      throw new BadRequestException(
        'responseSchema no es un JSON Schema valido dentro del perfil admitido',
      );
    }
    if (
      capability === AiCapability.INCIDENT_CLASSIFICATION &&
      canonicalJson(jsonSchema) !== canonicalJson(this.classificationContract())
    ) {
      throw new BadRequestException(
        'El esquema de clasificacion debe coincidir con GET /admin/ai/contracts/incident-classification',
      );
    }
    return jsonSchema;
  }

  validateOutput(
    capability: AiCapability,
    schema: unknown,
    output: Record<string, unknown>,
  ) {
    if (Buffer.byteLength(JSON.stringify(output), 'utf8') > 65536)
      throw new BadRequestException('La muestra de salida supera 64 KiB');
    const prepared = this.prepare(capability, schema);
    const validate = new Ajv({
      strict: true,
      ownProperties: true,
      validateFormats: false,
    }).compile(prepared);
    const valid = validate(output) === true;
    const errors = (validate.errors ?? []).map((error) => ({
      path: error.instancePath,
      keyword: error.keyword,
      message: error.message,
    }));
    if (
      valid &&
      capability === AiCapability.INCIDENT_CLASSIFICATION &&
      (output.urgency === 'CRITICAL' ||
        (typeof output.aiConfidence === 'number' &&
          output.aiConfidence < 0.6)) &&
      output.requiresSupervision !== true
    ) {
      errors.push({
        path: '/requiresSupervision',
        keyword: 'supervisionRequired',
        message:
          'Una urgencia CRITICAL o confianza menor a 0.6 requiere supervision',
      });
    }
    return { valid: valid && errors.length === 0, errors };
  }

  private assertSafeSchema(schema: object) {
    const allowed = new Set([
      'type',
      'properties',
      'required',
      'additionalProperties',
      'items',
      'enum',
      'minimum',
      'maximum',
      'minLength',
      'maxLength',
      'minItems',
      'maxItems',
      'uniqueItems',
      'description',
      'title',
    ]);
    let nodes = 0;
    const visit = (value: unknown, depth: number) => {
      if (
        ++nodes > 128 ||
        depth > 8 ||
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value)
      )
        throw new BadRequestException(
          'Esquema demasiado complejo o con nodos no admitidos',
        );
      const entries: [string, unknown][] = Object.entries(value);
      for (const [key, child] of entries) {
        if (!allowed.has(key))
          throw new BadRequestException(
            `Keyword de esquema no admitida: ${key.slice(0, 40)}`,
          );
        if (key === 'properties') {
          if (!child || typeof child !== 'object' || Array.isArray(child))
            throw new BadRequestException('properties debe ser un objeto');
          for (const property of Object.values(child))
            visit(property, depth + 1);
        }
        if (key === 'items') visit(child, depth + 1);
      }
    };
    visit(schema, 0);
  }
}
