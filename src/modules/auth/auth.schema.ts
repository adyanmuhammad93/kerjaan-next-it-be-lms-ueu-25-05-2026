import { z } from 'zod';

/**
 * Student registration (public admission form).
 * Uses split name fields + phone + admission context.
 */
export const registerSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
  firstName: z.string().min(1, 'First name is required').max(100).trim(),
  middleName: z.string().max(100).trim().optional(),
  lastName: z.string().max(100).trim().optional(),
  phone: z.string().min(8, 'Phone must be at least 8 digits').max(20).regex(/^[0-9]+$/, 'Phone must be numeric'),
  admissionPeriodId: z.string().uuid('Valid admission period is required'),
  programId: z.string().uuid('Valid program is required'),
  role: z.enum(['student', 'instructor', 'admin']).default('student'),
});

export const loginSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().uuid().optional(),
});

export const updateProfileSchema = z.object({
  fullName: z.string().min(2).max(100).trim().optional(),
  firstName: z.string().min(1).max(100).trim().optional(),
  middleName: z.string().max(100).trim().optional().nullable(),
  lastName: z.string().max(100).trim().optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  avatarUrl: z.string().url().max(2048).optional(),
  geminiApiKey: z.string().max(200).optional().nullable(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
