import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { ApiError } from '../../utils/ApiError';
import { providerFetch } from '../provider.client';
import {
  ProviderAdapter, BuyDataInput, BuyAirtimeInput, BuyCableInput,
  PurchaseResult, VerifyCableCustomerInput, VerifyCableCustomerResult,
} from './provider.interface';

export const providerC: ProviderAdapter = {
  key: 'C',
  enabled: env.PROVIDER_C_ENABLED,

  async buyData(input: BuyDataInput): Promise<PurchaseResult> {
    const planCode = input.planCodes.C;
    if (!planCode) {
      return { success: false, providerCost: 0, message: 'Provider C has no plan code for this plan' };
    }

    const res = await providerFetch('C', '/api/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': env.PROVIDER_C_API_KEY,
        'secret-key': env.PROVIDER_C_API_SECRET,
      },
      body: JSON.stringify({
        request_id: `data-${input.phone}-${Date.now()}`,
        serviceID: `${input.network.toLowerCase()}-data`,
        billersCode: input.phone,
        variation_code: planCode,
        phone: input.phone,
      }),
    });

    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }

    if (!res.ok || !json) {
      logger.warn({ provider: 'C', status: res.status, text }, '[providerC] buyData failed');
      return { success: false, providerCost: 0, message: json?.response_description ?? `HTTP ${res.status}`, raw: json ?? text };
    }

    const success = json.code === '000';
    return {
      success,
      providerReference: json.content?.transactions?.transactionId,
      providerCost: typeof json.amount === 'number' ? json.amount : 0,
      message: json.response_description,
      raw: json,
    };
  },

  async buyAirtime(input: BuyAirtimeInput): Promise<PurchaseResult> {
    const res = await providerFetch('C', '/api/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': env.PROVIDER_C_API_KEY,
        'secret-key': env.PROVIDER_C_API_SECRET,
      },
      body: JSON.stringify({
        request_id: `air-${input.phone}-${Date.now()}`,
        serviceID: input.network.toLowerCase(),
        amount: input.amount,
        phone: input.phone,
      }),
    });

    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }

    if (!res.ok || !json) {
      logger.warn({ provider: 'C', status: res.status, text }, '[providerC] buyAirtime failed');
      return { success: false, providerCost: 0, message: json?.response_description ?? `HTTP ${res.status}`, raw: json ?? text };
    }

    const success = json.code === '000';
    return {
      success,
      providerReference: json.content?.transactions?.transactionId,
      providerCost: typeof json.amount === 'number' ? json.amount : input.amount * 0.97,
      message: json.response_description,
      raw: json,
    };
  },

  async buyCable(input: BuyCableInput): Promise<PurchaseResult> {
    const planCode = input.planCodes.C;
    if (!planCode) {
      return { success: false, providerCost: 0, message: 'Provider C has no plan code for this bouquet' };
    }

    const res = await providerFetch('C', '/api/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': env.PROVIDER_C_API_KEY,
        'secret-key': env.PROVIDER_C_API_SECRET,
      },
      body: JSON.stringify({
        request_id: `cable-${input.smartcardNumber}-${Date.now()}`,
        serviceID: input.provider.toLowerCase(),
        billersCode: input.smartcardNumber,
        variation_code: planCode,
      }),
    });

    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }

    if (!res.ok || !json) {
      logger.warn({ provider: 'C', status: res.status, text }, '[providerC] buyCable failed');
      return { success: false, providerCost: 0, message: json?.response_description ?? `HTTP ${res.status}`, raw: json ?? text };
    }

    const success = json.code === '000';
    return {
      success,
      providerReference: json.content?.transactions?.transactionId,
      providerCost: typeof json.amount === 'number' ? json.amount : 0,
      message: json.response_description,
      raw: json,
    };
  },

  async verifyCableCustomer(input: VerifyCableCustomerInput): Promise<VerifyCableCustomerResult> {
    const res = await providerFetch('C', '/api/merchant-verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': env.PROVIDER_C_API_KEY,
        'secret-key': env.PROVIDER_C_API_SECRET,
      },
      body: JSON.stringify({ billersCode: input.smartcardNumber, serviceID: input.provider.toLowerCase() }),
    });

    const json = await res.json().catch(() => null) as any;
    if (!res.ok || json?.code !== '000' || !json?.content?.Customer_Name) {
      throw ApiError.badRequest(json?.response_description ?? 'Could not verify smartcard number', 'CABLE_VERIFY_FAILED');
    }
    return { customerName: json.content.Customer_Name, customerNumber: input.smartcardNumber };
  },
};