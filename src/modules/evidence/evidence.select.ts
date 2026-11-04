import { Prisma } from '@/generated/prisma/client';

export const EVIDENCE_SELECT = {
  id: true,
  incidentId: true,
  type: true,
  status: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  checksum: true,
  checksumAlgorithm: true,
  capturedAt: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.IncidentEvidenceSelect;

export type EvidenceRecord = Prisma.IncidentEvidenceGetPayload<{
  select: typeof EVIDENCE_SELECT;
}>;

export function evidenceResponse(evidence: EvidenceRecord) {
  return { ...evidence, sizeBytes: evidence.sizeBytes?.toString() ?? null };
}
