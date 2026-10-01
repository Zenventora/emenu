import nodemailer from 'nodemailer'

// Render free tier blocks outbound SMTP on port 465/587 (Zoho, Gmail, etc.).
// Resend uses HTTPS under the hood — works on all cloud providers.
// Set RESEND_API_KEY in Render environment variables (resend.com → free tier).
// FROM_EMAIL should be a verified sender in your Resend account.
const useResend = !!process.env.RESEND_API_KEY

const transporter = nodemailer.createTransport(
  useResend
    ? {
        host: 'smtp.resend.com',
        port: 465,
        secure: true,
        auth: {
          user: 'resend',
          pass: process.env.RESEND_API_KEY,
        },
      }
    : {
        // Fallback: custom SMTP (local dev with SMTP_USER set)
        host: process.env.SMTP_HOST || 'smtp.zoho.in',
        port: parseInt(process.env.SMTP_PORT || '465'),
        secure: true,
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || '',
        },
      }
)

const FROM_EMAIL = process.env.FROM_EMAIL || process.env.SMTP_USER || 'noreply@example.com'

export async function sendOTPEmail(to: string, name: string, otp: string): Promise<void> {
  // Dev mode: no credentials configured → print OTP to server console
  if (!useResend && (!process.env.SMTP_USER || process.env.SMTP_USER === 'your-email@zohomail.in')) {
    console.log(`\n╔══════════════════════════════╗`)
    console.log(`║   OTP for ${to.padEnd(20)} ║`)
    console.log(`║   Code: ${otp.padEnd(23)} ║`)
    console.log(`╚══════════════════════════════╝\n`)
    return
  }

  await transporter.sendMail({
    from: `"E-Menu" <${FROM_EMAIL}>`,
    to,
    subject: 'Your E-Menu OTP Code',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:16px">
        <div style="background:linear-gradient(135deg,#0ea5a4,#0f3b68);padding:24px;border-radius:12px;text-align:center;margin-bottom:24px">
          <h1 style="color:#fff;font-size:1.5rem;margin:0;font-weight:900">E-Menu</h1>
        </div>
        <p style="color:#374151;font-size:1rem">Hi ${name},</p>
        <p style="color:#6b7280">Use this OTP to reset your password. It expires in 10 minutes.</p>
        <div style="background:#fff;border:2px dashed #0ea5a4;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
          <p style="font-size:2.5rem;font-weight:900;letter-spacing:0.3em;color:#0f3b68;margin:0">${otp}</p>
        </div>
        <p style="color:#9ca3af;font-size:.8rem">If you didn't request this, ignore this email.</p>
      </div>
    `,
  })
}
