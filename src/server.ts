import http from 'http';
import app from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { checkDbConnection, disconnectDb } from './config/db';
import { checkRedisConnection, disconnectRedis } from './config/redis';

const PORT = env.PORT;

async function bootstrap(): Promise<void> {
  // ─── Fail-fast dependency checks ─────────────────────
  try {
    await checkDbConnection();
    logger.info('[boot] PostgreSQL connected');
  } catch (err) {
    logger.error({ err }, '[boot] PostgreSQL unreachable — exiting');
    process.exit(1);
  }

  try {
    await checkRedisConnection();
    logger.info('[boot] Redis connected');
  } catch (err) {
    logger.error({ err }, '[boot] Redis unreachable — exiting');
    process.exit(1);
  }

  // ─── Start HTTP server ───────────────────────────────
  const server = http.createServer(app);

  // Long-running provider calls need headroom; 60s is safe.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.requestTimeout = 60_000;

  server.listen(PORT, () => {
    logger.info(
      { port: PORT, env: env.NODE_ENV },
      `[boot] VTU backend listening on :${PORT}`
    );
  });

  // ─── Graceful shutdown ───────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, '[shutdown] signal received');

    // Stop accepting new connections; finish in-flight requests
    server.close(async (err) => {
      if (err) {
        logger.error({ err }, '[shutdown] error closing HTTP server');
      }

      try {
        await disconnectDb();
        logger.info('[shutdown] PostgreSQL disconnected');
      } catch (err) {
        logger.error({ err }, '[shutdown] error disconnecting PostgreSQL');
      }

      try {
        await disconnectRedis();
        logger.info('[shutdown] Redis disconnected');
      } catch (err) {
        logger.error({ err }, '[shutdown] error disconnecting Redis');
      }

      logger.info('[shutdown] complete');
      process.exit(0);
    });

    // If shutdown hangs (bug in a request handler), force kill after 20s.
    // PM2 will restart us.
    setTimeout(() => {
      logger.error('[shutdown] forced exit after 20s timeout');
      process.exit(1);
    }, 20_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // ─── Crash safety ────────────────────────────────────
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, '[process] unhandledRejection');
    // Do NOT exit — a single bad promise shouldn't take down the server.
    // PM2 will restart if things get truly bad.
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, '[process] uncaughtException — exiting');
    // This IS fatal — state may be corrupted.
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  logger.fatal({ err }, '[boot] bootstrap failed');
  process.exit(1);
});