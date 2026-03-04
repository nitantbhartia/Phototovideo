import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users, videos, videoClips } from "@/lib/db/schema";
import { dispatchVideoJob } from "@/lib/queue";
import { generateShareId } from "@/lib/utils";

interface EnsureUserInput {
  clerkId: string;
  email?: string;
  name?: string | null;
}

interface QueueVideoInput {
  videoId: string;
  userId: string;
  address: string;
  propertyType?: string;
  tone?: string;
  voiceId?: string;
  musicStyle?: string;
  aspectRatios?: string[];
  imageKeys: string[];
  autoSort?: boolean;
  addMusic?: boolean;
  editedClips?: { imageIndex: number; narration: string }[];
}

export async function getOrCreateUser(input: EnsureUserInput) {
  const db = getDb();
  const existingUser = await db.query.users.findFirst({
    where: eq(users.clerkId, input.clerkId),
  });
  if (existingUser) {
    return existingUser;
  }

  const [newUser] = await db
    .insert(users)
    .values({
      clerkId: input.clerkId,
      email: input.email || "",
      name: input.name || null,
      plan: "free",
      credits: 0,
    })
    .returning();

  return newUser;
}

export async function createDraftVideo(userId: string) {
  const db = getDb();
  const videoId = randomUUID();
  const shareId = generateShareId();

  await db.insert(videos).values({
    id: videoId,
    userId,
    address: "",
    status: "queued",
    shareId,
    watermarked: true,
  });

  return { videoId, shareId };
}

export async function queueVideoGeneration(input: QueueVideoInput) {
  const db = getDb();
  const propertyType = input.propertyType || "Single Family";
  const tone = input.tone || "Warm & Inviting";
  const voiceId = input.voiceId || "rachel";
  const musicStyle = input.musicStyle || "ambient";
  const aspectRatios = input.aspectRatios?.length ? input.aspectRatios : ["16:9"];
  const autoSort = input.autoSort ?? true;
  const addMusic = input.addMusic ?? true;
  const r2BaseUrl = process.env.R2_PUBLIC_URL;

  if (!r2BaseUrl) {
    throw new Error("R2_PUBLIC_URL is not configured");
  }

  await db
    .update(videos)
    .set({
      address: input.address,
      propertyType,
      tone,
      voiceId,
      musicStyle,
      aspectRatios: aspectRatios.join(","),
      status: "queued",
      statusMessage: "Job queued",
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(videos.id, input.videoId));

  await db.delete(videoClips).where(eq(videoClips.videoId, input.videoId));

  await db.insert(videoClips).values(
    input.imageKeys.map((key, index) => ({
      videoId: input.videoId,
      imageUrl: `${r2BaseUrl}/${key}`,
      r2Key: key,
      orderIndex: index,
    }))
  );

  await dispatchVideoJob({
    videoId: input.videoId,
    userId: input.userId,
    address: input.address,
    propertyType,
    tone,
    voiceId,
    musicStyle,
    aspectRatios,
    imageKeys: input.imageKeys,
    autoSort,
    addMusic,
    editedClips: input.editedClips,
  });
}
