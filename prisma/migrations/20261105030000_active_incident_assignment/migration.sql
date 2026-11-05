-- Fail rather than silently changing historical assignments if duplicates exist.
CREATE UNIQUE INDEX "incident_assignments_one_active_per_incident"
ON "incident_assignments" ("incidentId")
WHERE "status" IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS');
