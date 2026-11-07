-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "TxType" AS ENUM ('FUNDING', 'DATA', 'AIRTIME', 'CABLE', 'REFUND', 'ADMIN_CREDIT', 'ADMIN_DEBIT');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "Network" AS ENUM ('MTN', 'AIRTEL', 'GLO', 'NINE_MOBILE');

-- CreateEnum
CREATE TYPE "CableProvider" AS ENUM ('DSTV', 'GOTV', 'STARTIMES');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "pinVersion" INTEGER NOT NULL DEFAULT 1,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "vaNumber" TEXT,
    "vaBankName" TEXT,
    "vaAccountName" TEXT,
    "vaReference" TEXT,
    "vaCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "TxType" NOT NULL,
    "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(18,2) NOT NULL,
    "providerCost" DECIMAL(18,2) NOT NULL,
    "sellingPrice" DECIMAL(18,2) NOT NULL,
    "profit" DECIMAL(18,2) NOT NULL,
    "idempotencyKey" TEXT,
    "providerTried" TEXT,
    "providerRef" TEXT,
    "meta" JSONB,
    "providerResponse" JSONB,
    "refundedAt" TIMESTAMP(3),
    "refundedBy" TEXT,
    "refundReference" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataPlan" (
    "id" TEXT NOT NULL,
    "network" "Network" NOT NULL,
    "name" TEXT NOT NULL,
    "sizeMb" INTEGER NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "sellingPrice" DECIMAL(18,2) NOT NULL,
    "providerCost" DECIMAL(18,2) NOT NULL,
    "providerPlanA" TEXT,
    "providerPlanB" TEXT,
    "providerPlanC" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "marginPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "minAmount" DECIMAL(18,2),
    "maxAmount" DECIMAL(18,2),
    "announcement" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CableBouquet" (
    "id" TEXT NOT NULL,
    "provider" "CableProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "sellingPrice" DECIMAL(18,2) NOT NULL,
    "providerCost" DECIMAL(18,2) NOT NULL,
    "providerPlanA" TEXT,
    "providerPlanB" TEXT,
    "providerPlanC" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CableBouquet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventType" TEXT,
    "reference" TEXT,
    "signatureOk" BOOLEAN NOT NULL,
    "ipAddress" TEXT,
    "rawPayload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "meta" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_vaNumber_key" ON "User"("vaNumber");

-- CreateIndex
CREATE UNIQUE INDEX "User_vaReference_key" ON "User"("vaReference");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_reference_key" ON "Transaction"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_refundReference_key" ON "Transaction"("refundReference");

-- CreateIndex
CREATE INDEX "Transaction_userId_idx" ON "Transaction"("userId");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");

-- CreateIndex
CREATE INDEX "Transaction_reference_idx" ON "Transaction"("reference");

-- CreateIndex
CREATE INDEX "Transaction_userId_createdAt_idx" ON "Transaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_status_createdAt_idx" ON "Transaction"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

-- CreateIndex
CREATE INDEX "PasswordReset_expiresAt_idx" ON "PasswordReset"("expiresAt");

-- CreateIndex
CREATE INDEX "DataPlan_network_enabled_idx" ON "DataPlan"("network", "enabled");

-- CreateIndex
CREATE INDEX "DataPlan_enabled_idx" ON "DataPlan"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "DataPlan_network_name_key" ON "DataPlan"("network", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceConfig_key_key" ON "ServiceConfig"("key");

-- CreateIndex
CREATE INDEX "ServiceConfig_key_idx" ON "ServiceConfig"("key");

-- CreateIndex
CREATE INDEX "CableBouquet_provider_enabled_idx" ON "CableBouquet"("provider", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "CableBouquet_provider_name_key" ON "CableBouquet"("provider", "name");

-- CreateIndex
CREATE INDEX "WebhookLog_reference_idx" ON "WebhookLog"("reference");

-- CreateIndex
CREATE INDEX "WebhookLog_processed_idx" ON "WebhookLog"("processed");

-- CreateIndex
CREATE INDEX "WebhookLog_createdAt_idx" ON "WebhookLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
