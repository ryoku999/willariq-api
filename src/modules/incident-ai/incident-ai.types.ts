import type { Prisma } from '@/generated/prisma/client';
import type {
  AiProvider,
  EntityType,
  IncidentType,
  IncidentCategory,
  UrgencyLevel,
  Sentiment,
} from '@/generated/prisma/enums';

export interface ClassificationRoute {
  id: string;
  provider: AiProvider;
  model: string;
  priority: number;
  timeoutMs: number;
}
export interface ClassificationSnapshot {
  systemPrompt: string;
  responseSchema: Prisma.InputJsonObject;
  incident: {
    originalMessage: string;
    address: string | null;
    addressReference: string | null;
  };
}
export interface ClassificationResult {
  improvedDescription: string;
  recommendedAction: string;
  type: IncidentType;
  category: IncidentCategory;
  urgency: UrgencyLevel;
  sentiment: Sentiment;
  keywords: string[];
  aiConfidence: number;
  requiresSupervision: boolean;
  entities: { type: EntityType; value: string; confidence: number }[];
}
