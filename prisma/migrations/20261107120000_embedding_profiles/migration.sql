CREATE TABLE "embedding_profiles" (
    "id" UUID NOT NULL,
    "provider" "AiProvider" NOT NULL DEFAULT 'OPENROUTER',
    "model" VARCHAR(180) NOT NULL,
    "dimensions" INTEGER NOT NULL CHECK ("dimensions" BETWEEN 1 AND 4096),
    "timeoutMs" INTEGER NOT NULL CHECK ("timeoutMs" BETWEEN 1000 AND 60000),
    "batchSize" INTEGER NOT NULL CHECK ("batchSize" BETWEEN 1 AND 16),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "embedding_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "embedding_profiles_provider_model_dimensions_key"
ON "embedding_profiles" ("provider", "model", "dimensions");
CREATE UNIQUE INDEX "embedding_profiles_one_active"
ON "embedding_profiles" ("active") WHERE "active";
