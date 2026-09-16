-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SUPERVISOR', 'OPERATOR', 'CITIZEN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AreaMemberRole" AS ENUM ('MANAGER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "MunicipalAreaStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "IncidentSource" AS ENUM ('MOBILE_APP', 'WEB_APP', 'CHATBOT', 'PHONE', 'WHATSAPP', 'IN_PERSON', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('INFRASTRUCTURE', 'SECURITY', 'HEALTH', 'ENVIRONMENT', 'NOISE', 'TRAFFIC', 'PUBLIC_SERVICES', 'SOCIAL', 'EMERGENCY', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentCategory" AS ENUM ('FALLEN_UTILITY_POLE', 'WATER_OUTAGE', 'POWER_OUTAGE', 'STREET_FIGHT', 'THEFT', 'TRAFFIC_ACCIDENT', 'GARBAGE_ACCUMULATION', 'POTHOLE', 'FLOOD', 'FIRE', 'EXCESSIVE_NOISE', 'VANDALISM', 'LOOSE_ANIMALS', 'AMBULANCE_REQUIRED', 'POLICE_REQUIRED', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('RECEIVED', 'AI_ANALYSIS', 'IN_REVIEW', 'ACCEPTED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REASSIGNED');

-- CreateEnum
CREATE TYPE "UrgencyLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('NEUTRAL', 'WORRIED', 'PANIC', 'ANGRY', 'URGENT');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('QUARANTINED', 'AVAILABLE', 'REJECTED');

-- CreateEnum
CREATE TYPE "EvidenceUploadStatus" AS ENUM ('PENDING', 'VERIFYING', 'CONFIRMED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "HistoryActorType" AS ENUM ('USER', 'AI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('PERSON', 'LOCATION', 'ORGANIZATION', 'LANDMARK', 'VEHICLE', 'ANIMAL', 'DANGEROUS_OBJECT', 'OBJECT', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentClassificationSource" AS ENUM ('AI', 'HUMAN', 'MANUAL_WITHOUT_AI');

-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('CEREBRAS', 'GROQ', 'OPENROUTER');

-- CreateEnum
CREATE TYPE "AiCapability" AS ENUM ('INCIDENT_CLASSIFICATION', 'CHATBOT', 'EMBEDDING');

-- CreateEnum
CREATE TYPE "AiJobType" AS ENUM ('INCIDENT_ANALYSIS', 'CHAT_RESPONSE', 'EMBEDDING_DOCUMENT', 'EMBEDDING_QUERY');

-- CreateEnum
CREATE TYPE "AiJobTrigger" AS ENUM ('AUTOMATIC', 'MANUAL', 'RETRY');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiAttemptStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'RATE_LIMITED', 'INVALID_RESPONSE');

-- CreateEnum
CREATE TYPE "QueueOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'DEAD');

-- CreateEnum
CREATE TYPE "ChatStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('DRAFT', 'PROCESSING', 'READY', 'ERROR', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('MANUAL', 'PDF', 'WEB', 'MUNICIPAL_REGULATION', 'FAQ', 'PROCEDURE', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('INCIDENT_CREATED', 'INCIDENT_STATUS_CHANGED', 'INCIDENT_ASSIGNED', 'INCIDENT_RESOLVED', 'INCIDENT_REJECTED', 'AI_REVIEW_REQUIRED', 'GENERAL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS', 'WEB');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "firstName" VARCHAR(80) NOT NULL,
    "lastName" VARCHAR(120),
    "dni" VARCHAR(8) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(160),
    "passwordHash" VARCHAR(255) NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "role" "UserRole" NOT NULL DEFAULT 'CITIZEN',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_devices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "pushToken" TEXT NOT NULL,
    "deviceId" VARCHAR(200),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "municipal_areas" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "normalizedCode" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "normalizedName" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "phone" VARCHAR(30),
    "email" VARCHAR(160),
    "status" "MunicipalAreaStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "municipal_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "municipal_area_members" (
    "id" UUID NOT NULL,
    "areaId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "AreaMemberRole" NOT NULL DEFAULT 'OPERATOR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "municipal_area_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "trackingCode" VARCHAR(30) NOT NULL,
    "reporterId" UUID NOT NULL,
    "clientRequestId" VARCHAR(100) NOT NULL,
    "requestFingerprint" CHAR(64),
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3),
    "classificationSource" "IncidentClassificationSource",
    "source" "IncidentSource" NOT NULL DEFAULT 'MOBILE_APP',
    "originalMessage" TEXT NOT NULL,
    "improvedDescription" TEXT,
    "recommendedAction" TEXT,
    "type" "IncidentType",
    "category" "IncidentCategory",
    "urgency" "UrgencyLevel",
    "sentiment" "Sentiment",
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiConfidence" DECIMAL(5,4),
    "requiresSupervision" BOOLEAN NOT NULL DEFAULT false,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "address" VARCHAR(300),
    "addressReference" TEXT,
    "status" "IncidentStatus" NOT NULL DEFAULT 'RECEIVED',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "resolutionSummary" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" VARCHAR(80),
    "rejectionComment" TEXT,
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_tracking_counters" (
    "prefix" VARCHAR(10) NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incident_tracking_counters_pkey" PRIMARY KEY ("prefix","year")
);

-- CreateTable
CREATE TABLE "incident_entities" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "type" "EntityType" NOT NULL,
    "value" VARCHAR(300) NOT NULL,
    "normalizedValue" VARCHAR(300),
    "confidence" DECIMAL(5,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_evidence" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "uploadedById" UUID,
    "status" "EvidenceStatus" NOT NULL DEFAULT 'AVAILABLE',
    "type" "EvidenceType" NOT NULL,
    "bucket" VARCHAR(100) NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "fileName" VARCHAR(255),
    "sizeBytes" BIGINT,
    "checksum" VARCHAR(128),
    "checksumAlgorithm" VARCHAR(20),
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "capturedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incident_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_upload_intents" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "evidenceId" UUID,
    "bucket" VARCHAR(100) NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "declaredMimeType" VARCHAR(120) NOT NULL,
    "declaredSizeBytes" BIGINT NOT NULL,
    "capturedAt" TIMESTAMP(3),
    "status" "EvidenceUploadStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidence_upload_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_history" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "userId" UUID,
    "actorType" "HistoryActorType" NOT NULL DEFAULT 'USER',
    "previousStatus" "IncidentStatus",
    "newStatus" "IncidentStatus" NOT NULL,
    "comment" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_assignments" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "areaId" UUID NOT NULL,
    "operatorId" UUID,
    "assignedById" UUID,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "completionNote" TEXT,
    "reassignedAt" TIMESTAMP(3),
    "replacesId" UUID,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incident_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "incidentId" UUID,
    "status" "ChatStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" VARCHAR(180),
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "clientRequestId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_versions" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "version" INTEGER NOT NULL,
    "capability" "AiCapability" NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "responseSchema" JSONB,
    "promptHash" CHAR(64),
    "schemaHash" CHAR(64),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_routes" (
    "id" UUID NOT NULL,
    "capability" "AiCapability" NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" VARCHAR(180) NOT NULL,
    "priority" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_jobs" (
    "id" UUID NOT NULL,
    "type" "AiJobType" NOT NULL,
    "trigger" "AiJobTrigger" NOT NULL DEFAULT 'AUTOMATIC',
    "status" "AiJobStatus" NOT NULL DEFAULT 'PENDING',
    "incidentId" UUID,
    "chatMessageId" UUID,
    "promptVersionId" UUID,
    "requestedById" UUID,
    "retryOfJobId" UUID,
    "bullJobId" VARCHAR(120),
    "maxRounds" INTEGER NOT NULL DEFAULT 2,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "inputPayload" JSONB,
    "finalOutput" JSONB,
    "finalProvider" "AiProvider",
    "finalModel" VARCHAR(180),
    "errorSummary" TEXT,
    "routeSnapshot" JSONB,
    "promptHash" CHAR(64),
    "responseSchemaHash" CHAR(64),
    "inputFingerprint" CHAR(64),
    "resultApplied" BOOLEAN,
    "processingToken" UUID,
    "processingLeaseUntil" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "workerId" VARCHAR(120),
    "bullAttempts" INTEGER NOT NULL DEFAULT 0,
    "incidentVersion" INTEGER,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_outbox" (
    "id" UUID NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "aggregateType" VARCHAR(80) NOT NULL,
    "aggregateId" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "QueueOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" VARCHAR(120),
    "publishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_attempts" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" VARCHAR(180) NOT NULL,
    "status" "AiAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "requestPayload" JSONB,
    "rawResponse" JSONB,
    "parsedResponse" JSONB,
    "errorCode" VARCHAR(100),
    "errorMessage" TEXT,
    "providerRequestId" VARCHAR(200),
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "latencyMs" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL,
    "title" VARCHAR(250) NOT NULL,
    "sourceType" "KnowledgeSourceType" NOT NULL,
    "sourceUrl" TEXT,
    "storageBucket" VARCHAR(100),
    "storageKey" TEXT,
    "checksum" VARCHAR(128),
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB,
    "createdById" UUID,
    "publishedById" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_upload_intents" (
    "id" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "expectedSize" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "documentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_upload_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER,
    "metadata" JSONB,
    "embeddingProvider" "AiProvider" NOT NULL DEFAULT 'OPENROUTER',
    "embeddingModel" VARCHAR(180) NOT NULL,
    "embedding" vector,
    "embeddedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_job_knowledge_chunks" (
    "jobId" UUID NOT NULL,
    "chunkId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "similarity" DECIMAL(7,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_job_knowledge_chunks_pkey" PRIMARY KEY ("jobId","chunkId")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "title" VARCHAR(180) NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" VARCHAR(120) NOT NULL,
    "entityType" VARCHAR(80) NOT NULL,
    "entityId" VARCHAR(120),
    "oldValue" JSONB,
    "newValue" JSONB,
    "ipAddress" VARCHAR(64),
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_dni_key" ON "users"("dni");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "users_email_status_idx" ON "users"("email", "status");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_expiresAt_idx" ON "password_reset_tokens"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key" ON "email_verification_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_userId_createdAt_idx" ON "email_verification_tokens"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "email_verification_tokens_expiresAt_idx" ON "email_verification_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_pushToken_key" ON "user_devices"("pushToken");

-- CreateIndex
CREATE INDEX "user_devices_userId_active_idx" ON "user_devices"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "municipal_areas_code_key" ON "municipal_areas"("code");

-- CreateIndex
CREATE UNIQUE INDEX "municipal_areas_normalizedCode_key" ON "municipal_areas"("normalizedCode");

-- CreateIndex
CREATE UNIQUE INDEX "municipal_areas_name_key" ON "municipal_areas"("name");

-- CreateIndex
CREATE UNIQUE INDEX "municipal_areas_normalizedName_key" ON "municipal_areas"("normalizedName");

-- CreateIndex
CREATE INDEX "municipal_areas_status_idx" ON "municipal_areas"("status");

-- CreateIndex
CREATE INDEX "municipal_area_members_userId_active_idx" ON "municipal_area_members"("userId", "active");

-- CreateIndex
CREATE INDEX "municipal_area_members_areaId_active_idx" ON "municipal_area_members"("areaId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "municipal_area_members_areaId_userId_key" ON "municipal_area_members"("areaId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_trackingCode_key" ON "incidents"("trackingCode");

-- CreateIndex
CREATE INDEX "incidents_reporterId_createdAt_idx" ON "incidents"("reporterId", "createdAt");

-- CreateIndex
CREATE INDEX "incidents_status_createdAt_idx" ON "incidents"("status", "createdAt");

-- CreateIndex
CREATE INDEX "incidents_urgency_status_idx" ON "incidents"("urgency", "status");

-- CreateIndex
CREATE INDEX "incidents_category_status_idx" ON "incidents"("category", "status");

-- CreateIndex
CREATE INDEX "incidents_type_status_idx" ON "incidents"("type", "status");

-- CreateIndex
CREATE INDEX "incidents_requiresSupervision_status_idx" ON "incidents"("requiresSupervision", "status");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_reporterId_clientRequestId_key" ON "incidents"("reporterId", "clientRequestId");

-- CreateIndex
CREATE INDEX "incident_entities_incidentId_type_idx" ON "incident_entities"("incidentId", "type");

-- CreateIndex
CREATE INDEX "incident_evidence_incidentId_createdAt_idx" ON "incident_evidence"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "incident_evidence_status_createdAt_idx" ON "incident_evidence"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "incident_evidence_bucket_objectKey_key" ON "incident_evidence"("bucket", "objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_upload_intents_evidenceId_key" ON "evidence_upload_intents"("evidenceId");

-- CreateIndex
CREATE INDEX "evidence_upload_intents_incidentId_status_createdAt_idx" ON "evidence_upload_intents"("incidentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "evidence_upload_intents_requestedById_status_createdAt_idx" ON "evidence_upload_intents"("requestedById", "status", "createdAt");

-- CreateIndex
CREATE INDEX "evidence_upload_intents_status_expiresAt_idx" ON "evidence_upload_intents"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "incident_history_incidentId_createdAt_idx" ON "incident_history"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "incident_history_newStatus_createdAt_idx" ON "incident_history"("newStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "incident_assignments_replacesId_key" ON "incident_assignments"("replacesId");

-- CreateIndex
CREATE INDEX "incident_assignments_incidentId_assignedAt_idx" ON "incident_assignments"("incidentId", "assignedAt");

-- CreateIndex
CREATE INDEX "incident_assignments_areaId_status_idx" ON "incident_assignments"("areaId", "status");

-- CreateIndex
CREATE INDEX "incident_assignments_operatorId_status_idx" ON "incident_assignments"("operatorId", "status");

-- CreateIndex
CREATE INDEX "incident_assignments_assignedById_createdAt_idx" ON "incident_assignments"("assignedById", "createdAt");

-- CreateIndex
CREATE INDEX "chat_sessions_userId_createdAt_idx" ON "chat_sessions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_sessions_incidentId_idx" ON "chat_sessions"("incidentId");

-- CreateIndex
CREATE INDEX "chat_messages_sessionId_createdAt_idx" ON "chat_messages"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_sessionId_clientRequestId_key" ON "chat_messages"("sessionId", "clientRequestId");

-- CreateIndex
CREATE INDEX "prompt_versions_capability_active_idx" ON "prompt_versions"("capability", "active");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_versions_name_version_key" ON "prompt_versions"("name", "version");

-- CreateIndex
CREATE INDEX "ai_routes_capability_enabled_priority_idx" ON "ai_routes"("capability", "enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ai_routes_capability_priority_key" ON "ai_routes"("capability", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ai_jobs_bullJobId_key" ON "ai_jobs"("bullJobId");

-- CreateIndex
CREATE INDEX "ai_jobs_status_createdAt_idx" ON "ai_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ai_jobs_incidentId_createdAt_idx" ON "ai_jobs"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_jobs_retryOfJobId_idx" ON "ai_jobs"("retryOfJobId");

-- CreateIndex
CREATE INDEX "queue_outbox_status_availableAt_createdAt_idx" ON "queue_outbox"("status", "availableAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "queue_outbox_eventType_aggregateId_key" ON "queue_outbox"("eventType", "aggregateId");

-- CreateIndex
CREATE INDEX "ai_attempts_jobId_createdAt_idx" ON "ai_attempts"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_attempts_provider_status_createdAt_idx" ON "ai_attempts"("provider", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_attempts_jobId_round_sequence_key" ON "ai_attempts"("jobId", "round", "sequence");

-- CreateIndex
CREATE INDEX "knowledge_documents_status_sourceType_idx" ON "knowledge_documents"("status", "sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_upload_intents_objectKey_key" ON "knowledge_upload_intents"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_upload_intents_documentId_key" ON "knowledge_upload_intents"("documentId");

-- CreateIndex
CREATE INDEX "knowledge_upload_intents_createdById_createdAt_idx" ON "knowledge_upload_intents"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "knowledge_upload_intents_expiresAt_confirmedAt_idx" ON "knowledge_upload_intents"("expiresAt", "confirmedAt");

-- CreateIndex
CREATE INDEX "knowledge_chunks_documentId_idx" ON "knowledge_chunks"("documentId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_embeddingModel_idx" ON "knowledge_chunks"("embeddingModel");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_documentId_chunkIndex_key" ON "knowledge_chunks"("documentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "ai_job_knowledge_chunks_jobId_rank_idx" ON "ai_job_knowledge_chunks"("jobId", "rank");

-- CreateIndex
CREATE INDEX "notifications_userId_status_createdAt_idx" ON "notifications"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx" ON "audit_logs"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "municipal_area_members" ADD CONSTRAINT "municipal_area_members_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "municipal_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "municipal_area_members" ADD CONSTRAINT "municipal_area_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_entities" ADD CONSTRAINT "incident_entities_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_evidence" ADD CONSTRAINT "incident_evidence_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_evidence" ADD CONSTRAINT "incident_evidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_upload_intents" ADD CONSTRAINT "evidence_upload_intents_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_upload_intents" ADD CONSTRAINT "evidence_upload_intents_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_upload_intents" ADD CONSTRAINT "evidence_upload_intents_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "incident_evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_history" ADD CONSTRAINT "incident_history_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_history" ADD CONSTRAINT "incident_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_assignments" ADD CONSTRAINT "incident_assignments_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_assignments" ADD CONSTRAINT "incident_assignments_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "municipal_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_assignments" ADD CONSTRAINT "incident_assignments_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_assignments" ADD CONSTRAINT "incident_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_assignments" ADD CONSTRAINT "incident_assignments_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "incident_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_promptVersionId_fkey" FOREIGN KEY ("promptVersionId") REFERENCES "prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_retryOfJobId_fkey" FOREIGN KEY ("retryOfJobId") REFERENCES "ai_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_attempts" ADD CONSTRAINT "ai_attempts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ai_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_upload_intents" ADD CONSTRAINT "knowledge_upload_intents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_upload_intents" ADD CONSTRAINT "knowledge_upload_intents_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "knowledge_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_job_knowledge_chunks" ADD CONSTRAINT "ai_job_knowledge_chunks_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ai_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_job_knowledge_chunks" ADD CONSTRAINT "ai_job_knowledge_chunks_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
