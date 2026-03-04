import { Resend } from "resend";

let resendInstance: Resend | null = null;

function getResend() {
  if (resendInstance) {
    return resendInstance;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  resendInstance = new Resend(apiKey);
  return resendInstance;
}

export async function sendVideoReadyEmail({
  to,
  name,
  address,
  videoUrl,
}: {
  to: string;
  name: string;
  address: string;
  videoUrl: string;
}): Promise<void> {
  const resend = getResend();
  await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to,
    subject: `Your listing video for ${address} is ready!`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Your ListingReel video is ready</title>
        </head>
        <body style="font-family: Georgia, serif; background: #F5EDD0; margin: 0; padding: 40px 20px;">
          <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
            <div style="background: #2C2C2C; padding: 32px; text-align: center;">
              <h1 style="color: #C9A84C; font-family: Georgia, serif; margin: 0; font-size: 28px; letter-spacing: 2px;">ListingReel</h1>
            </div>
            <div style="padding: 40px;">
              <h2 style="color: #2C2C2C; font-size: 22px; margin-bottom: 8px;">Your video is ready, ${name}!</h2>
              <p style="color: #4A4A4A; line-height: 1.6; margin-bottom: 24px;">
                Your cinematic listing video for <strong>${address}</strong> has been generated and is ready to view, download, and share.
              </p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${videoUrl}" style="background: #C9A84C; color: white; padding: 16px 36px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block;">
                  Watch Your Video
                </a>
              </div>
              <p style="color: #4A4A4A; font-size: 14px; line-height: 1.6;">
                Share this link with clients, post it to social media, or attach it to your MLS listing. The video is optimized for all platforms.
              </p>
              <hr style="border: none; border-top: 1px solid #F5EDD0; margin: 32px 0;">
              <p style="color: #888; font-size: 12px; text-align: center;">
                ListingReel — AI-powered real estate videos in minutes<br>
                <a href="${process.env.NEXT_PUBLIC_APP_URL}" style="color: #C9A84C;">beforeafterpro.app</a>
              </p>
            </div>
          </div>
        </body>
      </html>
    `,
  });
}

export async function sendVideoErrorEmail({
  to,
  name,
  address,
}: {
  to: string;
  name: string;
  address: string;
}): Promise<void> {
  const resend = getResend();
  await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to,
    subject: `Issue generating your video for ${address}`,
    html: `
      <p>Hi ${name},</p>
      <p>We encountered an issue generating your video for <strong>${address}</strong>. Our team has been notified and will investigate.</p>
      <p>Please try generating the video again or contact support if the issue persists.</p>
      <p>— The ListingReel Team</p>
    `,
  });
}
