import { Client as QStashClient } from "@upstash/qstash";
import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

export const qstash = new QStashClient({
  token: process.env.QSTASH_TOKEN!,
});

export interface VideoJob {
  videoId: string;
  userId: string;
  address: string;
  propertyType: string;
  tone: string;
  imageKeys: string[];
  addMusic: boolean;
}

export async function dispatchVideoJob(job: VideoJob): Promise<string> {
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
  const data = await redis.hgetall(`video:${videoId}`);
  if (!data) return null;
  return data as { status: string; message: string; updatedAt: number };
}
