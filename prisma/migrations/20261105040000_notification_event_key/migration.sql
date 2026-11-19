BEGIN;

-- Legacy rows have no reliable event identifier and remain visible as before.
ALTER TABLE "notifications" ADD COLUMN "eventKey" VARCHAR(180);
CREATE UNIQUE INDEX "notifications_userId_eventKey_key"
ON "notifications" ("userId", "eventKey");

COMMIT;
