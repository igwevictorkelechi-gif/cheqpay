/**
 * Identity/KYC verification abstraction. A real provider (Dojah, Smile ID,
 * VerifyMe, or a PSP BVN check) slots in behind this interface; the
 * mock auto-verifies on a well-formed BVN so the flow works end-to-end in dev.
 */
export interface KycVerifyInput {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  bvn?: string;
  documentRefs?: string[];
  /**
   * The fields below are only needed by a provider that enrolls the user as it
   * verifies them — Maplerad wants a full customer record, not just a BVN and a
   * name. Providers that merely check an identity (Dojah, the mock) ignore them.
   */
  userId?: string;
  email?: string;
  phone?: string | null;
  address?: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
  };
}

export interface KycVerifyResult {
  /** True when the identity was confirmed automatically. */
  verified: boolean;
  /** Tier to grant when verified (typically 2). */
  tier: number;
  /** Human-readable reason (why it passed/failed) for the audit trail. */
  reason: string;
  /** Provider reference, if any. */
  providerRef?: string;
}

export interface KycProvider {
  readonly name: string;
  verify(input: KycVerifyInput): Promise<KycVerifyResult>;
}
