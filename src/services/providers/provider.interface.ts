export type NetworkType = 'MTN' | 'AIRTEL' | 'GLO' | 'NINE_MOBILE';
export type CableType = 'DSTV' | 'GOTV' | 'STARTIMES';

export type PlanCodes = {
  A: string | null;
  B: string | null;
  C: string | null;
};

export type BuyDataInput = {
  network: NetworkType;
  planCodes: PlanCodes;
  phone: string;
};

export type BuyAirtimeInput = {
  network: NetworkType;
  amount: number;
  phone: string;
};

export type BuyCableInput = {
  provider: CableType;
  planCodes: PlanCodes;
  smartcardNumber: string;
};

export type VerifyCableCustomerInput = {
  provider: CableType;
  smartcardNumber: string;
};

export type VerifyCableCustomerResult = {
  customerName: string;
  customerNumber: string;
};

export type PurchaseResult = {
  success: boolean;
  providerReference?: string;
  providerCost: number;
  message?: string;
  raw?: unknown;
};

export type ProviderAdapter = {
  readonly key: 'A' | 'B' | 'C';
  readonly enabled: boolean;

  buyData(input: BuyDataInput): Promise<PurchaseResult>;
  buyAirtime(input: BuyAirtimeInput): Promise<PurchaseResult>;
  buyCable(input: BuyCableInput): Promise<PurchaseResult>;
  verifyCableCustomer(input: VerifyCableCustomerInput): Promise<VerifyCableCustomerResult>;
};