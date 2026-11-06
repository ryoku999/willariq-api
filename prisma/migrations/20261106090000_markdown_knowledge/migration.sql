BEGIN;
ALTER TABLE "ai_jobs" ADD COLUMN "knowledgeDocumentId" UUID;
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_knowledgeDocumentId_fkey"
  FOREIGN KEY ("knowledgeDocumentId") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ai_jobs_knowledgeDocumentId_createdAt_idx" ON "ai_jobs"("knowledgeDocumentId", "createdAt");
CREATE UNIQUE INDEX "ai_jobs_one_active_embedding_document"
  ON "ai_jobs"("knowledgeDocumentId")
  WHERE "knowledgeDocumentId" IS NOT NULL AND "type" = 'EMBEDDING_DOCUMENT' AND "status" IN ('PENDING', 'QUEUED', 'PROCESSING');
ALTER TABLE "knowledge_chunks" ADD COLUMN "embeddingJobId" UUID, ADD COLUMN "embeddingDimensions" INTEGER;
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_embeddingJobId_fkey"
  FOREIGN KEY ("embeddingJobId") REFERENCES "ai_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_job_vector_check" CHECK (
  "embeddingJobId" IS NULL OR (
    "embedding" IS NOT NULL AND "embeddingDimensions" IS NOT NULL
    AND "embeddingDimensions" BETWEEN 1 AND 4096 AND vector_dims("embedding") = "embeddingDimensions"
  )
);
DROP INDEX "knowledge_chunks_documentId_chunkIndex_key";
CREATE UNIQUE INDEX "knowledge_chunks_legacy_document_chunk_key"
  ON "knowledge_chunks"("documentId", "chunkIndex") WHERE "embeddingJobId" IS NULL;
CREATE UNIQUE INDEX "knowledge_chunks_embeddingJobId_chunkIndex_key" ON "knowledge_chunks"("embeddingJobId", "chunkIndex");
CREATE TABLE "knowledge_publications" (
  "documentId" UUID NOT NULL REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "jobId" UUID NOT NULL REFERENCES "ai_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "model" VARCHAR(180) NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_publications_pkey" PRIMARY KEY ("documentId", "model", "dimensions")
);
CREATE INDEX "knowledge_publications_model_dimensions_idx" ON "knowledge_publications"("model", "dimensions");
COMMIT;
