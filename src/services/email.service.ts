import { Resend } from 'resend';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { ApiError } from '../utils/ApiError';

const resend = new Resend(env.RESEND_API_KEY);

function otpEmailHtml(name: string, otp: string, ttlMinutes: number): string {
  return `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:10px">
    <h2 style="color:#111827;margin:0 0 16px">Password reset code</h2>
    <p style="color:#374151">Hi ${name},</p>
    <p style="color:#374151">Use the 6-digit code below to reset your password. It expires in ${ttlMinutes} minutes.</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:20px;text-align:center;margin:16px 0">
      ${otp}
    </div>
    <p style="color:#6b7280;font-size:14px">If you didn't request this, ignore this email. Your password will not change.</p>
    <p style="color:#9ca3af;font-size:12px;margin-top:24px">${env.APP_NAME}</p>
  </div>`;
}

export async function sendPasswordResetOtp(
  to: string,
  name: string,
  otp: string
): Promise<void> {
  try {
    const result = await resend.emails.send({
      from: `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`,
      to,
      subject: `${env.APP_NAME} — Password Reset Code`,
      html: otpEmailHtml(name, otp, env.OTP_TTL_MINUTES),
    });

    if (result.error) {
      logger.error({ err: result.error, to }, '[email] Resend returned an error');
      throw ApiError.internal('Failed to send email', 'EMAIL_SEND_FAILED');
    }

    logger.info({ to, id: result.data?.id }, '[email] OTP sent');
  } catch (err) {
    if (err instanceof ApiError) throw err;
    logger.error({ err, to }, '[email] Exception while sending OTP');
    throw ApiError.internal('Failed to send email', 'EMAIL_SEND_FAILED');
  }
}