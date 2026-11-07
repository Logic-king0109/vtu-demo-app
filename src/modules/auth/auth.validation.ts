import { z } from 'zod';

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password too long')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[0-9]/, 'Password must include a number');

const pin4 = z
  .string()
  .regex(/^\d{4}$/, 'PIN must be exactly 4 digits');

const phoneNg = z
  .string()
  .regex(/^0[789][01]\d{8}$/, 'Enter a valid Nigerian phone number (e.g. 08012345678)');

const email = z.string().email().max(120).toLowerCase();

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(80),
  email,
  phone: phoneNg,
  password,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password required'),
});

export const setPinSchema = z.object({
  pin: pin4,
  confirmPin: pin4,
}).refine((d) => d.pin === d.confirmPin, {
  message: 'PINs do not match',
  path: ['confirmPin'],
});

export const changePinSchema = z.object({
  currentPin: pin4,
  newPin: pin4,
  confirmPin: pin4,
}).refine((d) => d.newPin === d.confirmPin, {
  message: 'PINs do not match',
  path: ['confirmPin'],
}).refine((d) => d.newPin !== d.currentPin, {
  message: 'New PIN must differ from current PIN',
  path: ['newPin'],
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password required'),
  newPassword: password,
});

export const forgotPasswordSchema = z.object({
  email,
});

export const resetPasswordSchema = z.object({
  email,
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
  newPassword: password,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type SetPinInput = z.infer<typeof setPinSchema>;
export type ChangePinInput = z.infer<typeof changePinSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;