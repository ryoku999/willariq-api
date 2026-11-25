import { Prisma } from '@/generated/prisma/client';

export const INCIDENT_LIST_SELECT = {
  id: true,
  trackingCode: true,
  reporterId: true,
  version: true,
  source: true,
  status: true,
  type: true,
  category: true,
  urgency: true,
  requiresSupervision: true,
  latitude: true,
  longitude: true,
  address: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.IncidentSelect;

export const INCIDENT_DETAIL_FIELDS = {
  ...INCIDENT_LIST_SELECT,
  originalMessage: true,
  improvedDescription: true,
  recommendedAction: true,
  classificationSource: true,
  sentiment: true,
  keywords: true,
  aiConfidence: true,
  addressReference: true,
  submittedAt: true,
  reviewedAt: true,
  acceptedAt: true,
  responsibleId: true,
  cancellationReason: true,
  startedAt: true,
  resolvedAt: true,
  resolutionSummary: true,
  rejectedAt: true,
  rejectionReason: true,
  rejectionComment: true,
  closedAt: true,
  cancelledAt: true,
} as const satisfies Prisma.IncidentSelect;

export const INCIDENT_DETAIL_SELECT = {
  ...INCIDENT_DETAIL_FIELDS,
  entities: { select: { type: true, value: true, confidence: true } },
  responsible: { select: { id: true, firstName: true, lastName: true } },
  reporter: { select: { id: true, firstName: true, lastName: true } },
} as const satisfies Prisma.IncidentSelect;

export type IncidentDetailFields = Prisma.IncidentGetPayload<{
  select: typeof INCIDENT_DETAIL_FIELDS;
}>;

export type IncidentDetail = Prisma.IncidentGetPayload<{
  select: typeof INCIDENT_DETAIL_SELECT;
}>;
