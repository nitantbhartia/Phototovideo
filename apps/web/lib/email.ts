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
  unlockUrl,
  thumbnailGifUrl,
}: {
  to: string;
  name: string;
  address: string;
  videoUrl: string;
  unlockUrl: string;
  thumbnailGifUrl?: string;
}): Promise<void> {
  const resend = getResend();

  const thumbnailBlock = thumbnailGifUrl
    ? `
      <div style="margin: 24px 0; text-align: center;">
        <a href="${videoUrl}" style="display: block; text-decoration: none; position: relative;">
          <img
            src="${thumbnailGifUrl}"
            alt="Preview of your listing video for ${address}"
            width="520"
            style="width: 100%; max-width: 520px; border-radius: 8px; display: block; margin: 0 auto;"
          />
        </a>
        <p style="color: #888; font-size: 12px; margin: 8px 0 0;">(watermarked preview — tap to watch)</p>
      </div>`
    : `
      <div style="text-align: center; margin: 24px 0;">
        <a href="${videoUrl}" style="background: #2C2C2C; color: #C9A84C; padding: 16px 32px; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 600; display: inline-block;">
          ▶ Watch Preview
        </a>
      </div>`;

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

            <div style="padding: 36px 40px 0;">
              <h2 style="color: #2C2C2C; font-size: 22px; margin-bottom: 8px;">Your video is ready, ${name}!</h2>
              <p style="color: #4A4A4A; line-height: 1.6; margin-bottom: 0;">
                Your cinematic listing video for <strong>${address}</strong> is done. Tap the preview below to watch it.
              </p>
            </div>

            <div style="padding: 0 40px;">
              ${thumbnailBlock}
            </div>

            <!-- Primary CTA -->
            <div style="padding: 0 40px 36px;">
              <div style="background: #F9F5EC; border: 1px solid #E8DFC0; border-radius: 10px; padding: 24px; text-align: center;">
                <p style="color: #2C2C2C; font-size: 15px; font-weight: 700; margin: 0 0 4px;">
                  Remove the watermark &amp; download in full HD
                </p>
                <p style="color: #777; font-size: 13px; margin: 0 0 18px;">
                  One-time payment — yours to keep, share, and post forever.
                </p>
                <a href="${unlockUrl}" style="background: #C9A84C; color: white; padding: 14px 36px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 700; display: inline-block; letter-spacing: 0.5px;">
                  Unlock for $49 &rarr;
                </a>
              </div>

              <p style="color: #888; font-size: 12px; line-height: 1.6; margin-top: 20px; text-align: center;">
                Or <a href="${videoUrl}" style="color: #C9A84C;">watch the preview</a> first — no purchase required.
              </p>

              <hr style="border: none; border-top: 1px solid #F5EDD0; margin: 24px 0 16px;">
              <p style="color: #888; font-size: 12px; text-align: center; margin: 0;">
                ListingReel — AI-powered real estate videos in minutes<br>
                <a href="${process.env.NEXT_PUBLIC_APP_URL}" style="color: #C9A84C;">listingreel.com</a>
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
