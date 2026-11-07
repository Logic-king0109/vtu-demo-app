import { PrismaClient } from '@prisma/client';
import { env } from './env';

// Prevent multiple PrismaClient instances during ts-node-dev hot reload
// (each reload would open new DB connections and exhaust the pool).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isDev
      ? ['warn', 'error']
      : ['error'],
    errorFormat: 'minimal',
  });

if (env.isDev) {
  globalForPrisma.prisma = prisma;
}

// ─── Health check helper ────────────────────────────────
export async function checkDbConnection(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

// ─── Graceful shutdown ──────────────────────────────────
export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}