import { Client as QStashClient } from "@upstash/qstash";
import { Redis } from "@upstash/redis";

let redisInstance: Redis | null = null;
let qstashInstance: QStashClient | null = null;

function getRedis() {
  if (redisInstance) {
    return redisInstance;
  }

  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) {
    throw new Error("Upstash Redis is not configured");
  }

  redisInstance = new Redis({ url, token });
  return redisInstance;
}

function getQStash() {
  if (qstashInstance) {
    return qstashInstance;
  }

  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error("QSTASH_TOKEN is not configured");
  }

  qstashInstance = new QStashClient({ token });
  return qstashInstance;
}

export interface VideoJob {
  videoId: string;
  userId: string;
  address: string;
  propertyType: string;
  tone: string;
  imageKeys: string[];
  autoSort: boolean;
  addMusic: boolean;
}

function isGuestMode() {
  return process.env.GUEST_MODE === "true";
}

async function dispatchVideoJobDirect(job: VideoJob): Promise<string> {
  const workerUrl = process.env.WORKER_URL;
  const workerSecret = process.env.WORKER_SECRET;

  if (!workerUrl) {
    throw new Error("WORKER_URL is not configured");
  }

  if (!workerSecret) {
    throw new Error("WORKER_SECRET is not configured");
  }

  const response = await fetch(`${workerUrl}/process`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": workerSecret,
    },
    body: JSON.stringify(job),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Worker request failed with ${response.status}: ${errorText || "unknown error"}`
    );
  }

  return job.videoId;
}

export async function dispatchVideoJob(job: VideoJob): Promise<string> {
  if (isGuestMode()) {
    return dispatchVideoJobDirect(job);
  }

  const qstash = getQStash();
  const workerUrl = `${process.env.WORKER_URL}/process`;

  const response = await qstash.publishJSON({
    url: workerUrl,
    body: job,
    headers: {
      "x-worker-secret": process.env.WORKER_SECRET!,
    },
    retries: 3,
  });

  return response.messageId;
}

export async function setVideoStatus(
  videoId: string,
  status: string,
  message?: string
): Promise<void> {
  const redis = getRedis();
  await redis.hset(`video:${videoId}`, {
    status,
    message: message || "",
    updatedAt: Date.now(),
  });
}

export async function getVideoStatus(videoId: string): Promise<{
  status: string;
  message: string;
  updatedAt: number;
} | null> {
  const redis = getRedis();
  const data = await redis.hgetall(`video:${videoId}`);
  if (!data) return null;
  return data as { status: string; message: string; updatedAt: number };
}
