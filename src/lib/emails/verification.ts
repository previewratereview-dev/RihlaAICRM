export function verificationEmailTemplate(otp: string, confirmUrl: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%); min-height: 100vh;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 40px; text-align: center;">
              <img src="https://res.cloudinary.com/demo/image/upload/w_120,h_40,c_fit/logo.png" alt="WanderBot AI" style="margin-bottom: 16px; filter: brightness(0) invert(1);">
              <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0;">Verify Your Email</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px;">
              <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
                Welcome aboard! You're just one step away from accessing your agency dashboard.
              </p>

              <!-- OTP Box -->
              <div style="background: #f1f5f9; border-radius: 16px; padding: 32px; text-align: center; margin-bottom: 32px; border: 2px dashed #cbd5e1;">
                <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600; margin: 0 0 12px 0;">
                  Your Verification Code
                </p>
                <p style="color: #1e293b; font-size: 36px; font-weight: 800; letter-spacing: 8px; margin: 0; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;">
                  ${otp}
                </p>
              </div>

              <p style="color: #94a3b8; font-size: 13px; text-align: center; margin: 0 0 32px 0;">
                This code expires in 15 minutes
              </p>

              <!-- Divider -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 32px;">
                <tr>
                  <td style="border-top: 1px solid #e2e8f0; height: 1px;"></td>
                </tr>
              </table>

              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom: 32px;">
                    <a href="${confirmUrl}" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; padding: 16px 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);">
                      Or Click to Verify Instantly
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color: #94a3b8; font-size: 12px; text-align: center; line-height: 1.5; margin: 0;">
                If you didn't create an account, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #f8fafc; padding: 24px 40px; border-top: 1px solid #e2e8f0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color: #94a3b8; font-size: 11px; text-align: center;">
                    <p style="margin: 0 0 8px 0;">© ${new Date().getFullYear()} WanderBot AI. All rights reserved.</p>
                    <p style="margin: 0;">Powered by WanderBot AI — Smart Agency Management</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}