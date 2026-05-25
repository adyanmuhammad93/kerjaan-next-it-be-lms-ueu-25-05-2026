import nodemailer from 'nodemailer';
import { config } from '../config/env.js';

/**
 * Email Service
 * 
 * If SMTP_HOST is configured, sends real emails via SMTP.
 * Otherwise, logs the email content to the console (dev mode).
 */

let transporter: nodemailer.Transporter | null = null;

if (config.smtp.host) {
  const transportOpts: any = {
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
  };

  // Only add auth when credentials are provided (MailHog doesn't need auth)
  if (config.smtp.user) {
    transportOpts.auth = {
      user: config.smtp.user,
      pass: config.smtp.pass,
    };
  }

  transporter = nodemailer.createTransport(transportOpts);

  // Verify connection on startup
  transporter.verify().then(() => {
    console.log('✅ SMTP connection verified');
  }).catch((err) => {
    console.error('❌ SMTP connection failed:', err.message);
  });
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export const emailService = {
  async send(options: EmailOptions): Promise<void> {
    if (transporter) {
      await transporter.sendMail({
        from: config.smtp.from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      console.log(`📧 Email sent to ${options.to}: "${options.subject}"`);
    } else {
      // Dev fallback — log to console
      console.log('\n' + '='.repeat(60));
      console.log('📧 EMAIL (console mode — no SMTP configured)');
      console.log('='.repeat(60));
      console.log(`To:      ${options.to}`);
      console.log(`Subject: ${options.subject}`);
      console.log(`Body:\n${options.text || options.html}`);
      console.log('='.repeat(60) + '\n');
    }
  },

  /** Sends the password reset email with a tokenized link */
  async sendPasswordResetEmail(email: string, resetToken: string): Promise<void> {
    const resetUrl = `${config.frontendUrl}/reset-password?token=${resetToken}`;

    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #191C19; font-size: 24px; margin: 0;">MOOC Esa Unggul</h1>
          <p style="color: #414941; font-size: 14px; margin-top: 4px;">Universitas Esa Unggul</p>
        </div>
        <div style="background: #ffffff; border: 1px solid #E0E0E0; border-radius: 16px; padding: 32px;">
          <h2 style="color: #191C19; font-size: 20px; margin-top: 0;">Reset Kata Sandi</h2>
          <p style="color: #414941; line-height: 1.6;">
            Kami menerima permintaan untuk mereset kata sandi akun Anda. 
            Klik tombol di bawah untuk membuat kata sandi baru:
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${resetUrl}" 
               style="background: #386A1F; color: white; padding: 14px 32px; border-radius: 999px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
              Reset Kata Sandi
            </a>
          </div>
          <p style="color: #717971; font-size: 13px; line-height: 1.5;">
            Link ini akan kedaluwarsa dalam <strong>1 jam</strong>. 
            Jika Anda tidak meminta reset kata sandi, abaikan email ini.
          </p>
          <hr style="border: none; border-top: 1px solid #E0E0E0; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px;">
            Jika tombol tidak berfungsi, salin link berikut ke browser:<br/>
            <a href="${resetUrl}" style="color: #386A1F; word-break: break-all;">${resetUrl}</a>
          </p>
        </div>
      </div>
    `;

    const text = `Reset Kata Sandi\n\nKlik link berikut untuk mereset kata sandi Anda:\n${resetUrl}\n\nLink ini berlaku selama 1 jam.`;

    await this.send({
      to: email,
      subject: 'Reset Kata Sandi — MOOC Esa Unggul',
      html,
      text,
    });
  },
};
