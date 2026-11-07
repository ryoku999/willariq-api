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

export const INCIDENT_DETAIL_SELECT = {
  ...INCIDENT_LIST_SELECT,
  originalMessage: true,
  improvedDescription: true,
  recommendedAction: true,
  classificationSource: true,
  sentiment: true,
  keywords: true,
  entities: { select: { type: true, value: true, confidence: true } },
  aiConfidence: true,
  addressReference: true,
  submittedAt: true,
  reviewedAt: true,
  acceptedAt: true,
  assignedAt: true,
  startedAt: true,
  resolvedAt: true,
  resolutionSummary: true,
  rejectedAt: true,
  rejectionReason: true,
  rejectionComment: true,
  closedAt: true,
  cancelledAt: true,
  reporter: { select: { id: true, firstName: true, lastName: true } },
} as const satisfies Prisma.IncidentSelect;

export type IncidentDetail = Prisma.IncidentGetPayload<{
  select: typeof INCIDENT_DETAIL_SELECT;
}>;
