import { Prisma } from '@prisma/client';

/**
 * Profit = sellingPrice - providerCost, floored at 0.
 * Uses Prisma.Decimal to keep Naira amounts exact (no float drift).
 */
export function calculateProfit(
  sellingPrice: Prisma.Decimal | number | string,
  providerCost: Prisma.Decimal | number | string
): Prisma.Decimal {
  const s = new Prisma.Decimal(sellingPrice);
  const c = new Prisma.Decimal(providerCost);
  const profit = s.minus(c);
  return profit.isNegative() ? new Prisma.Decimal(0) : profit;
}

/**
 * Apply a percentage margin on provider cost (used for airtime).
 * e.g. providerCost=100, marginPct=5 → sellingPrice=105.00
 */
export function applyMargin(
  providerCost: Prisma.Decimal | number | string,
  marginPct: Prisma.Decimal | number | string
): Prisma.Decimal {
  const cost = new Prisma.Decimal(providerCost);
  const pct = new Prisma.Decimal(marginPct);
  // cost * (1 + pct/100)
  return cost.mul(pct.div(100).plus(1)).toDecimalPlaces(2);
}