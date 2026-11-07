import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { ApiError } from '../../utils/ApiError';
import { providerFetch } from '../provider.client';
import {
  ProviderAdapter, BuyDataInput, BuyAirtimeInput, BuyCableInput,
  PurchaseResult, VerifyCableCustomerInput, VerifyCableCustomerResult,
} from './provider.interface';

export const providerA: ProviderAdapter = {
  key: 'A',
  enabled: env.PROVIDER_A_ENABLED,

  async buyData(input: BuyDataInput): Promise<PurchaseResult> {
    const planCode = input.planCodes.A;
    if (!planCode) {
      return { success: false, providerCost: 0, message: 'Provider A has no plan code for this plan' };
    }

    const res = await providerFetch('A', '/api/data/purchase', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.PROVIDER_A_API_KEY}`,
      },
      body: JSON.stringify({
        network: input.network,
        plan: planCode,
        phone: input.phone,
        requestId: `${input.phone}-${Date.now()}`,
      }),
    });

    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }

    if (!res.ok || !json) {
      logger.warn({ provider: 'A', status: res.status, text }, '[providerA] buyData failed');
      return { success: false, providerCost: 0, message: json?.message ?? `HTTP ${res.status}`, raw: json ?? text };
    }

    const success = json.status === 'success' || json.status === 'SUCCESS';
    return {
      success,
      providerReference: json.reference ?? json.transactionId,
      providerCost: typeof json.cost === 'number' ? json.cost : 0,
      message: json.message,
      raw: json,
    };
  },

  async buyAirtime(input: BuyAirtimeInput): Promise<PurchaseResult> {
    const res = await providerFetch('A', '/api/airtime/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.PROVIDER_A_API_KEY}` },
      body: JSON.stringify({ network: input.network, amount: input.amount, phone: input.phone }),
    });

    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }

    if (!res.ok || !json) {
      logger.warn({ provider: 'A', status: res.status, text }, '[providerA] buyAirtime failed');
      return { success: false, providerCost: 0, message: json?.message ?? `HTTP ${res.status}`, raw: json ?? text };
    }

    const success = json.status === 'success' || json.status === 'SUCCESS';
    return {
      success,
      providerReference: json.reference ?? json.transactionId,
      providerCost: typeof json.cost === 'number' ? json.cost : input.amount * 0.97,
      message: json.message,
      raw: json,
    };
  },

  async buyCable(input: BuyCableInput): Promise<PurchaseResult> {
    const planCode = input.planCodes.A;
    if (!planCode) {
      return { success: false, providerCost: 0, message: 'Provider A has no plan code for this bouquet' };
    }

    const res = await providerFetch('A', '/api/cable/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.PROVIDER_A_API_KEY}` },
      body: JSON.stringify({ provider: input.provider, plan: planCode, smartcard: input.smartcardNumber }),
    });

    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }

    if (!res.ok || !json) {
      logger.warn({ provider: 'A', status: res.status, text }, '[providerA] buyCable failed');
      return { success: false, providerCost: 0, message: json?.message ?? `HTTP ${res.status}`, raw: json ?? text };
    }

    const success = json.status === 'success' || json.status === 'SUCCESS';
    return {
      success,
      providerReference: json.reference ?? json.transactionId,
      providerCost: typeof json.cost === 'number' ? json.cost : 0,
      message: json.message,
      raw: json,
    };
  },

  async verifyCableCustomer(input: VerifyCableCustomerInput): Promise<VerifyCableCustomerResult> {
    const res = await providerFetch('A', '/api/cable/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.PROVIDER_A_API_KEY}` },
      body: JSON.stringify({ provider: input.provider, smartcard: input.smartcardNumber }),
    });

    const json = await res.json().catch(() => null) as any;
    if (!res.ok || !json?.customerName) {
      throw ApiError.badRequest(json?.message ?? 'Could not verify smartcard number', 'CABLE_VERIFY_FAILED');
    }
    return { customerName: json.customerName, customerNumber: input.smartcardNumber };
  },
};