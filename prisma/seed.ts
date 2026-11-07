import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

async function main(): Promise<void> {
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const adminName = process.env.SEED_ADMIN_NAME ?? 'System Admin';
  const adminPhone = process.env.SEED_ADMIN_PHONE ?? '08000000000';

  if (!adminEmail || !adminPassword) {
    // eslint-disable-next-line no-console
    console.error('❌ SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required in .env');
    process.exit(1);
  }

  // ── Admin user ───────────────────────────────────────
  const existing = await prisma.user.findUnique({
    where: { email: adminEmail.toLowerCase() },
  });

  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`ℹ️  Admin already exists: ${adminEmail}`);
  } else {
    const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_ROUNDS);
    // Admin PIN placeholder — hashed random bytes. Admin must set real PIN
    // before any admin-initiated purchase (not expected in normal flow).
    const { randomBytes } = await import('crypto');
    const pinHash = await bcrypt.hash(randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

    await prisma.$transaction(async (tx) => {
      const admin = await tx.user.create({
        data: {
          name: adminName,
          email: adminEmail.toLowerCase(),
          phone: adminPhone,
          passwordHash,
          pinHash,
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      await tx.wallet.create({ data: { userId: admin.id } });
    });

    // eslint-disable-next-line no-console
    console.log(`✅ Admin created: ${adminEmail}`);
  }

  // ── Default service configs for airtime (all networks) ──
  const airtimeConfigs = [
    { key: 'AIRTIME_MTN', marginPct: 3, minAmount: 50, maxAmount: 50_000 },
    { key: 'AIRTIME_AIRTEL', marginPct: 3, minAmount: 50, maxAmount: 50_000 },
    { key: 'AIRTIME_GLO', marginPct: 3, minAmount: 50, maxAmount: 50_000 },
    { key: 'AIRTIME_NINE_MOBILE', marginPct: 3, minAmount: 50, maxAmount: 50_000 },
  ];

  for (const c of airtimeConfigs) {
    const exists = await prisma.serviceConfig.findUnique({ where: { key: c.key } });
    if (!exists) {
      await prisma.serviceConfig.create({
        data: {
          key: c.key,
          enabled: true,
          marginPct: c.marginPct,
          minAmount: c.minAmount,
          maxAmount: c.maxAmount,
        },
      });
      // eslint-disable-next-line no-console
      console.log(`✅ ServiceConfig created: ${c.key}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log('✅ Seed complete');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });