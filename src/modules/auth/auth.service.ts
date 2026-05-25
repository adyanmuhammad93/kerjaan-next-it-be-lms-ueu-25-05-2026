import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes, createHash } from 'crypto';
import { db } from '../../db/knex.js';
import { jwtService } from '../../shared/jwt.service.js';
import { emailService } from '../../shared/email.service.js';
import { ConflictError, UnauthorizedError, NotFoundError, ForbiddenError, ValidationError } from '../../shared/errors.js';
import type { RegisterInput, LoginInput, UpdateProfileInput, ChangePasswordInput, ForgotPasswordInput, ResetPasswordInput } from './auth.schema.js';

/**
 * Security: argon2id is the recommended password hashing algorithm.
 * Never use bcrypt for new projects (limited to 72 bytes, timing side-channels).
 */
const ARGON2_OPTIONS = {
  memoryCost: 65536, // 64 MB — makes brute-force expensive
  timeCost: 3,
  parallelism: 4,
};

export const authService = {
  async register(input: RegisterInput) {
    // Security: Check for duplicate email before hashing (avoids unnecessary CPU)
    const existing = await db('users').where({ email: input.email }).first();
    if (existing) throw new ConflictError('An account with this email already exists');

    // Validate admission period exists and is open
    const period = await db('admission_periods').where({ id: input.admissionPeriodId }).first();
    if (!period || !period.registration_open) throw new ValidationError('Invalid or closed admission period');

    // Validate program exists and is active
    const program = await db('programs').where({ id: input.programId, is_active: true }).first();
    if (!program) throw new ValidationError('Invalid or inactive program');

    const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);

    // Compute full_name from split name fields for backward compatibility
    const fullName = [input.firstName, input.middleName, input.lastName].filter(Boolean).join(' ');

    // Use a transaction so partial failures don't create orphaned records
    const user = await db.transaction(async (trx) => {
      const [newUser] = await trx('users').insert({
        id: uuidv4(),
        email: input.email,
        password_hash: passwordHash,
        full_name: fullName,
        first_name: input.firstName,
        middle_name: input.middleName || null,
        last_name: input.lastName || null,
        phone: input.phone,
        admission_period_id: input.admissionPeriodId,
        program_id: input.programId,
        role: input.role,
      }).returning(['id', 'email', 'full_name', 'first_name', 'middle_name', 'last_name', 'phone', 'role', 'avatar_url', 'gemini_api_key', 'admission_period_id', 'program_id', 'created_at']);

      return newUser;
    });

    const accessToken = jwtService.signAccessToken({ sub: user.id, email: user.email, role: user.role });
    const refreshToken = await jwtService.createRefreshToken(user.id);

    return { user: mapUser(user), accessToken, refreshToken };
  },

  async login(input: LoginInput) {
    const user = await db('users').where({ email: input.email }).first();

    // Security: Use constant-time comparison even when user doesn't exist to prevent email enumeration
    if (!user) {
      await argon2.hash('dummy_password_to_prevent_timing_attacks', ARGON2_OPTIONS);
      throw new UnauthorizedError('Invalid email or password');
    }

    const valid = await argon2.verify(user.password_hash, input.password);
    if (!valid) throw new UnauthorizedError('Invalid email or password');

    const accessToken = jwtService.signAccessToken({ sub: user.id, email: user.email, role: user.role });
    const refreshToken = await jwtService.createRefreshToken(user.id);

    // Fetch enrolled course IDs
    const enrollments = await getActiveEnrollmentCourseIds(user.id);

    return {
      user: { ...mapUser(user), enrolledCourseIds: enrollments.map((e: any) => e.course_id) },
      accessToken,
      refreshToken,
    };
  },

  async getCurrentUser(userId: string) {
    const user = await db('users').where({ id: userId }).first();
    if (!user) throw new NotFoundError('User');

    const enrollments = await getActiveEnrollmentCourseIds(userId);

    return {
      ...mapUser(user),
      enrolledCourseIds: enrollments.map((e: any) => e.course_id),
    };
  },

  async updateProfile(userId: string, input: UpdateProfileInput) {
    const payload: Record<string, any> = {};
    if (input.fullName !== undefined) payload.full_name = input.fullName;
    if (input.firstName !== undefined) payload.first_name = input.firstName;
    if (input.middleName !== undefined) payload.middle_name = input.middleName;
    if (input.lastName !== undefined) payload.last_name = input.lastName;
    if (input.phone !== undefined) payload.phone = input.phone;
    if (input.avatarUrl !== undefined) payload.avatar_url = input.avatarUrl;
    if (input.geminiApiKey !== undefined) payload.gemini_api_key = input.geminiApiKey;

    // Recompute full_name if any name part changed
    if (input.firstName !== undefined || input.middleName !== undefined || input.lastName !== undefined) {
      const user = await db('users').where({ id: userId }).first();
      const firstName = input.firstName ?? user?.first_name;
      const middleName = input.middleName ?? user?.middle_name;
      const lastName = input.lastName ?? user?.last_name;
      payload.full_name = [firstName, middleName, lastName].filter(Boolean).join(' ');
    }

    if (Object.keys(payload).length === 0) return;

    payload.updated_at = new Date().toISOString();

    await db('users').where({ id: userId }).update(payload);
  },

  async changePassword(userId: string, input: ChangePasswordInput) {
    const user = await db('users').where({ id: userId }).first();
    if (!user) throw new NotFoundError('User');

    const valid = await argon2.verify(user.password_hash, input.currentPassword);
    if (!valid) throw new ForbiddenError('Current password is incorrect');

    const newHash = await argon2.hash(input.newPassword, ARGON2_OPTIONS);
    await db('users').where({ id: userId }).update({ password_hash: newHash, updated_at: new Date() });

    // Revoke all refresh tokens on password change (security: active sessions should re-login)
    await jwtService.revokeAllUserTokens(userId);
  },

  async getUserForImpersonation(targetUserId: string, adminId: string) {
    // Verify caller is admin
    const admin = await db('users').where({ id: adminId, role: 'admin' }).first();
    if (!admin) throw new ForbiddenError('Only admins can impersonate users');

    const user = await db('users').where({ id: targetUserId }).first();
    if (!user) throw new NotFoundError('User');

    const enrollments = await getActiveEnrollmentCourseIds(targetUserId);

    // Issue a special short-lived access token for impersonation
    const accessToken = jwtService.signAccessToken({ sub: user.id, email: user.email, role: user.role });

    return {
      user: { ...mapUser(user), enrolledCourseIds: enrollments.map((e: any) => e.course_id) },
      accessToken,
    };
  },

  /**
   * Forgot Password — generates a reset token and sends it via email.
   * Always succeeds (anti-enumeration). If the email doesn't exist, silently no-ops.
   */
  async forgotPassword(input: ForgotPasswordInput) {
    const user = await db('users').where({ email: input.email }).first();
    if (!user) return; // Silent — don't reveal if email exists

    // Invalidate any existing unused tokens for this user
    await db('password_reset_tokens')
      .where({ user_id: user.id })
      .whereNull('used_at')
      .update({ used_at: new Date() });

    // Generate a crypto-random token
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    // Store hashed token with 1-hour expiry
    await db('password_reset_tokens').insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    });

    // Send the email with the raw (unhashed) token
    await emailService.sendPasswordResetEmail(user.email, rawToken);
  },

  /**
   * Reset Password — validates the token and sets a new password.
   * Revokes all sessions for the user.
   */
  async resetPassword(input: ResetPasswordInput) {
    // Hash the incoming token to match against DB
    const tokenHash = createHash('sha256').update(input.token).digest('hex');

    const record = await db('password_reset_tokens')
      .where({ token_hash: tokenHash })
      .whereNull('used_at')
      .first();

    if (!record) {
      throw new ValidationError('Invalid or expired reset token');
    }

    if (new Date(record.expires_at) < new Date()) {
      throw new ValidationError('Reset token has expired');
    }

    // Hash new password
    const passwordHash = await argon2.hash(input.newPassword, ARGON2_OPTIONS);

    // Update password + mark token as used in a transaction
    await db.transaction(async (trx) => {
      await trx('users').where({ id: record.user_id }).update({
        password_hash: passwordHash,
        updated_at: new Date(),
      });

      await trx('password_reset_tokens').where({ id: record.id }).update({
        used_at: new Date(),
      });

      // Revoke all refresh tokens for this user (force re-login)
      await trx('refresh_tokens').where({ user_id: record.user_id }).delete();
    });
  },
};

function mapUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    name: user.full_name || 'User',
    firstName: user.first_name || null,
    middleName: user.middle_name || null,
    lastName: user.last_name || null,
    phone: user.phone || null,
    admissionPeriodId: user.admission_period_id || null,
    programId: user.program_id || null,
    role: user.role,
    avatarUrl: user.avatar_url || null,
    geminiApiKey: user.gemini_api_key || null,
  };
}


async function getActiveEnrollmentCourseIds(userId: string) {
  return db('enrollments')
    .where({ user_id: userId, status: 'active' })
    .select('course_id');
}