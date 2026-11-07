import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { ApiError } from '../../utils/ApiError';
import { providerFetch } from '../provider.client';
import {
  ProviderAdapter, BuyDataInput, BuyAirtimeInput, BuyCableInput,
  PurchaseResult, VerifyCableCustomerInput, VerifyCableCustomerResult,
} from './provider.interface';

export const providerB: ProviderAdapter = {
  key: 'B',
  enabled: env.PROVIDER_B_ENABLED,

  async buyData(input: BuyDataInput): Promise<PurchaseResult> {
    const planCode = input.planCodes.B;
    if (!planCode) {
      return { success: false, providerCost: 0, message: 'Provider B has no plan code for this plan' };
    }

    const res = await providerFetch('B', '/v1/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.PROVIDER_B_API_KEY },
      body: JSON.stringify({ network: input.network, plan_id: planCode, phone: input.phone }),
    });

    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }

    if (!res.ok || !json) {
      logger.warn({ provider: 'B', status: res.status, text }, '[providerB] buyData failed');
      return { success: false, providerCost: 0, message: json?.error ?? `HTTP ${res.status}`, raw: json ?? text };
    }

    const success = json.code === '000' || json.success === true;
    return {
      success,
      providerReference: json.txn_ref ?? json.reference,
      providerCost: typeof json.amount === 'number' ? json.amount : 0,
      message: json.message,
      raw: json,
    };
  },

  async buyAirtime(input: BuyAirtimeInput): Promise<PurchaseResult> {
    const res = await providerFetch('B', '/v1/airtime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.PROVIDER_B_API_KEY },
      body: JSON.stringify({ network: input.network, amount: input.amount, phone: input.phone }),
    });

    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }

    if (!res.ok || !json) {
      logger.warn({ provider: 'B', status: res.status, text }, '[providerB] buyAirtime failed');
      return { success: false, providerCost: 0, message: json?.error ?? `HTTP ${res.status}`, raw: json ?? text };
    }

    const success = json.code === '000' || json.success === true;
    return {
      success,
      providerReference: json.txn_ref ?? json.reference,
      providerCost: typeof json.amount === 'number' ? json.amount : input.amount * 0.97,
      message: json.message,
      raw: json,
    };
  },

  async buyCable(input: BuyCableInput): Promise<PurchaseResult> {
    const planCode = input.planCodes.B;
    if (!planCode) {
      return { success: false, providerCost: 0, message: 'Provider B has no plan code for this bouquet' };
    }

    const res = await providerFetch('B', '/v1/cable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.PROVIDER_B_API_KEY },
      body: JSON.stringify({ provider: input.provider, plan_id: planCode, smartcard: input.smartcardNumber }),
    });

    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }

    if (!res.ok || !json) {
      logger.warn({ provider: 'B', status: res.status, text }, '[providerB] buyCable failed');
      return { success: false, providerCost: 0, message: json?.error ?? `HTTP ${res.status}`, raw: json ?? text };
    }

    const success = json.code === '000' || json.success === true;
    return {
      success,
      providerReference: json.txn_ref ?? json.reference,
      providerCost: typeof json.amount === 'number' ? json.amount : 0,
      message: json.message,
      raw: json,
    };
  },

  async verifyCableCustomer(input: VerifyCableCustomerInput): Promise<VerifyCableCustomerResult> {
    const res = await providerFetch('B', '/v1/cable/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.PROVIDER_B_API_KEY },
      body: JSON.stringify({ provider: input.provider, smartcard: input.smartcardNumber }),
    });

    const json = await res.json().catch(() => null) as any;
    if (!res.ok || !json?.customer_name) {
      throw ApiError.badRequest(json?.error ?? 'Could not verify smartcard number', 'CABLE_VERIFY_FAILED');
    }
    return { customerName: json.customer_name, customerNumber: input.smartcardNumber };
  },
};