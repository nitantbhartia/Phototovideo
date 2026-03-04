import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

export interface IncomingSmsMedia {
  mediaSid: string;
  mediaUrl: string;
  contentType: string;
}

export interface IncomingSmsPayload {
  body: string;
  from: string;
  to: string;
  messageSid: string;
  media: IncomingSmsMedia[];
}

function getTwilioEnv() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !phoneNumber) {
    throw new Error("Twilio is not configured");
  }

  return { accountSid, authToken, phoneNumber };
}

export function isTwilioConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
}

export function normalizePhoneNumber(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) {
    return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  }
  return `+${trimmed.replace(/\D/g, "")}`;
}

export function buildSmsUserClerkId(phoneNumber: string) {
  return `sms:${normalizePhoneNumber(phoneNumber)}`;
}

export function buildSmsUserEmail(phoneNumber: string) {
  const digits = normalizePhoneNumber(phoneNumber).replace(/\D/g, "");
  return `sms.${digits}@listingreel.local`;
}

export function isCommand(body: string, command: string) {
  return body.trim().toUpperCase() === command.toUpperCase();
}

export function buildVideoPageUrl(shareId: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is not configured");
  }

  return `${appUrl}/video/${shareId}`;
}

export function buildPublicVideoDownloadUrl(shareId: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is not configured");
  }

  return `${appUrl}/api/share/${shareId}/download`;
}

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function twimlMessage(message: string) {
  const escaped = xmlEscape(message);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

export function twimlResponse(message: string) {
  return new NextResponse(twimlMessage(message), {
    status: 200,
    headers: {
      "content-type": "text/xml; charset=utf-8",
    },
  });
}

function getRequestUrl(req: NextRequest) {
  if (process.env.TWILIO_WEBHOOK_URL) {
    return process.env.TWILIO_WEBHOOK_URL;
  }

  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!host) {
    return req.url;
  }

  return `${proto}://${host}${req.nextUrl.pathname}`;
}

function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>
) {
  const payload = Object.keys(params)
    .sort()
    .reduce((result, key) => result + key + params[key], url);

  return createHmac("sha1", authToken).update(payload).digest("base64");
}

export function validateTwilioSignature(
  req: NextRequest,
  params: Record<string, string>
) {
  const signature = req.headers.get("x-twilio-signature");
  if (!signature) {
    return false;
  }

  const { authToken } = getTwilioEnv();
  const expected = computeTwilioSignature(authToken, getRequestUrl(req), params);

  const signatureBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (signatureBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(signatureBytes, expectedBytes);
}

export function parseIncomingSms(form: FormData): IncomingSmsPayload {
  const body = String(form.get("Body") || "").trim();
  const from = normalizePhoneNumber(String(form.get("From") || ""));
  const to = normalizePhoneNumber(String(form.get("To") || ""));
  const messageSid = String(form.get("MessageSid") || "");
  const numMedia = Number(form.get("NumMedia") || 0);
  const media: IncomingSmsMedia[] = [];

  for (let index = 0; index < numMedia; index += 1) {
    const mediaUrl = String(form.get(`MediaUrl${index}`) || "");
    const contentType = String(form.get(`MediaContentType${index}`) || "");
    const mediaSid = String(form.get(`MediaSid${index}`) || `${messageSid}:${index}`);

    if (!mediaUrl || !contentType) {
      continue;
    }

    media.push({ mediaSid, mediaUrl, contentType });
  }

  return { body, from, to, messageSid, media };
}

function getBasicAuthHeader() {
  const { accountSid, authToken } = getTwilioEnv();
  const value = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  return `Basic ${value}`;
}

export async function downloadTwilioMedia(mediaUrl: string) {
  const response = await fetch(mediaUrl, {
    headers: {
      Authorization: getBasicAuthHeader(),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download Twilio media: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType };
}

export async function sendSmsMessage(to: string, body: string) {
  const { accountSid, phoneNumber } = getTwilioEnv();
  const response = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: getBasicAuthHeader(),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: normalizePhoneNumber(to),
      From: phoneNumber,
      Body: body,
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twilio send failed with ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as { sid: string };
  return data.sid;
}

export function fileExtensionFromContentType(contentType: string) {
  const normalized = contentType.toLowerCase();
  const mapping: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/gif": "gif",
  };

  return mapping[normalized] || "jpg";
}
