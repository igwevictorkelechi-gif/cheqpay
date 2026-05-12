import { z } from 'zod';

// Auth Schemas
export const SendOTPSchema = z.object({
  phone: z.string().regex(/^[0-9]{10,15}$/, 'Invalid phone number'),
});

export const VerifyOTPSchema = z.object({
  phone: z.string().regex(/^[0-9]{10,15}$/, 'Invalid phone number'),
  otp_code: z.string().length(6, 'OTP must be 6 digits'),
});

export const RegisterSchema = z.object({
  phone: z.string().regex(/^[0-9]{10,15}$/, 'Invalid phone number'),
  email: z.string().email('Invalid email'),
  full_name: z.string().min(2, 'Name must be at least 2 characters'),
  otp_code: z.string().length(6, 'OTP must be 6 digits'),
});

// Wallet Schemas
export const SendMoneySchema = z.object({
  recipient_phone: z.string().regex(/^[0-9]{10,15}$/, 'Invalid phone number'),
  amount: z.number().min(50, 'Minimum transfer is ₦50').max(5000000, 'Maximum transfer is ₦5,000,000'),
  narration: z.string().optional(),
});

export const WithdrawSchema = z.object({
  bank_account_number: z.string().regex(/^[0-9]{10}$/, 'Invalid account number'),
  bank_code: z.string().length(3, 'Invalid bank code'),
  amount: z.number().min(100, 'Minimum withdrawal is ₦100').max(5000000, 'Maximum withdrawal is ₦5,000,000'),
  narration: z.string().optional(),
});

// KYC Schemas
export const KYCSchema = z.object({
  bvn: z.string().regex(/^[0-9]{11}$/, 'Invalid BVN').optional(),
  nin: z.string().regex(/^[0-9]{11}$/, 'Invalid NIN').optional(),
  id_type: z.enum(['bvn', 'nin', 'drivers_license']).optional(),
});

// Profile Schemas
export const UpdateProfileSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  email: z.string().email('Invalid email').optional(),
});

// Payment Config Schemas
export const PaymentConfigSchema = z.object({
  provider: z.enum(['paystack', 'flutterwave']),
  public_key: z.string().min(1, 'Public key is required'),
  secret_key: z.string().min(1, 'Secret key is required'),
});

export type SendOTPType = z.infer<typeof SendOTPSchema>;
export type VerifyOTPType = z.infer<typeof VerifyOTPSchema>;
export type RegisterType = z.infer<typeof RegisterSchema>;
export type SendMoneyType = z.infer<typeof SendMoneySchema>;
export type WithdrawType = z.infer<typeof WithdrawSchema>;
export type KYCType = z.infer<typeof KYCSchema>;
export type UpdateProfileType = z.infer<typeof UpdateProfileSchema>;
export type PaymentConfigType = z.infer<typeof PaymentConfigSchema>;
