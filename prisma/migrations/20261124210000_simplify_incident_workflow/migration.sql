BEGIN;

ALTER TYPE "IncidentStatus" RENAME VALUE 'IN_REVIEW' TO 'NEW';
UPDATE "users" SET "role" = 'OPERATOR', "sessionVersion" = "sessionVersion" + 1
WHERE "role" = 'SUPERVISOR';
ALTER TABLE "users" DROP CONSTRAINT "users_staff_profile_required";
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR', 'CITIZEN');
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole" USING ("role"::text::"UserRole");
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CITIZEN';
DROP TYPE "UserRole_old";
ALTER TABLE "users" ADD CONSTRAINT "users_staff_profile_required" CHECK (
  "role" = 'CITIZEN' OR ("firstName" IS NOT NULL AND "phone" IS NOT NULL)
);

ALTER TABLE "incidents"
  ADD COLUMN "responsibleId" UUID,
  ADD COLUMN "cancellationReason" TEXT;

WITH latest_assignment AS (
  SELECT DISTINCT ON (a."incidentId") a.*
  FROM "incident_assignments" a
  WHERE a."status" IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED')
    AND NOT EXISTS (
      SELECT 1 FROM "incident_assignments" replacement WHERE replacement."replacesId" = a."id"
    )
  ORDER BY a."incidentId", a."assignedAt" DESC, a."id" DESC
)
UPDATE "incidents" i
SET "responsibleId" = CASE
      WHEN i."status" IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS') AND
        (u."status" IS DISTINCT FROM 'ACTIVE' OR u."role" NOT IN ('ADMIN', 'OPERATOR'))
      THEN NULL ELSE a."operatorId" END,
    "acceptedAt" = COALESCE(a."acceptedAt", i."acceptedAt")
FROM latest_assignment a
LEFT JOIN "users" u ON u."id" = a."operatorId"
WHERE i."id" = a."incidentId";

UPDATE "incidents"
SET "status" = CASE
      WHEN "status" = 'ASSIGNED' AND "responsibleId" IS NOT NULL THEN 'ACCEPTED'::"IncidentStatus"
      ELSE 'NEW'::"IncidentStatus" END,
    "acceptedAt" = CASE WHEN "responsibleId" IS NULL THEN NULL ELSE "acceptedAt" END,
    "startedAt" = CASE WHEN "responsibleId" IS NULL THEN NULL ELSE "startedAt" END,
    "version" = "version" + 1
WHERE "status" IN ('AI_ANALYSIS', 'ASSIGNED')
   OR ("status" IN ('ACCEPTED', 'IN_PROGRESS') AND "responsibleId" IS NULL);

UPDATE "incidents" i
SET "cancellationReason" = (
  SELECT h."comment" FROM "incident_history" h
  WHERE h."incidentId" = i."id" AND h."newStatus" = 'CANCELLED'
  ORDER BY h."createdAt" DESC, h."id" DESC LIMIT 1
)
WHERE i."status" = 'CANCELLED';

-- Preserve the complete previous assignments without retaining the operational tables.
UPDATE "incident_history" h
SET "metadata" = COALESCE(h."metadata", '{}'::jsonb) ||
  jsonb_build_object('legacyAssignments', history.assignments)
FROM (
  SELECT i."id", (
    SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('areaName', m."name")
      ORDER BY a."assignedAt", a."id")
    FROM "incident_assignments" a
    JOIN "municipal_areas" m ON m."id" = a."areaId"
    WHERE a."incidentId" = i."incidentId"
  ) AS assignments
  FROM "incident_history" i
  WHERE i."id" = (
    SELECT first_event."id" FROM "incident_history" first_event
    WHERE first_event."incidentId" = i."incidentId"
    ORDER BY first_event."createdAt", first_event."id" LIMIT 1
  )
) history
WHERE h."id" = history."id" AND history.assignments IS NOT NULL;

ALTER TABLE "incidents" DROP COLUMN "assignedAt";
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_responsibleId_fkey"
  FOREIGN KEY ("responsibleId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "incidents_responsibleId_status_idx" ON "incidents"("responsibleId", "status");

DROP TABLE "incident_assignments";
DROP TABLE "municipal_area_members";
DROP TABLE "municipal_areas";
DROP TYPE "AssignmentStatus";
DROP TYPE "AreaMemberRole";
DROP TYPE "MunicipalAreaStatus";

COMMIT;
