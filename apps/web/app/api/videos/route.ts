import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { videos, users } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { getClerkUserId, hasClerkEnv, isGuestMode } from "@/lib/auth";
import { queueVideoGeneration } from "@/lib/video-jobs";

const CreateVideoSchema = z.object({
  videoId: z.string().uuid(),
  address: z.string().min(5, "Address too short").max(200),
  propertyType: z.string().default("Single Family"),
  tone: z.string().default("Warm & Inviting"),
  voiceId: z.string().default("rachel"),
  musicStyle: z.string().default("ambient"),
  aspectRatios: z.array(z.enum(["16:9", "9:16", "1:1"])).min(1).default(["16:9"]),
  imageKeys: z.array(z.string()).min(1).max(20),
  autoSort: z.boolean().default(true),
  addMusic: z.boolean().default(true),
  // Video quality: "ai" uses AI video generation (Luma/Runway), "standard" uses Ken Burns
  videoQuality: z.enum(["ai", "standard"]).default("standard"),
  // Edit-before-render: pre-defined clip order and narrations from review step
  editedClips: z.array(z.object({
    imageIndex: z.number(),
    narration: z.string(),
  })).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const guestMode = isGuestMode();
    const clerkId = guestMode || !hasClerkEnv() ? "guest-test-user" : await getClerkUserId();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = CreateVideoSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid request" },
        { status: 400 }
      );
    }

    const { videoId, address, propertyType, tone, voiceId, musicStyle, aspectRatios, imageKeys, autoSort, addMusic, videoQuality, editedClips } =
      parsed.data;

    const user = await db.query.users.findFirst({
      where: eq(users.clerkId, clerkId),
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Billing is intentionally bypassed in guest/test mode.

    await queueVideoGeneration({
      videoId,
      userId: user.id,
      address,
      propertyType,
      tone,
      voiceId,
      musicStyle,
      aspectRatios,
      imageKeys,
      autoSort,
      addMusic,
      videoQuality,
      editedClips,
    });

    return NextResponse.json({ videoId, status: "queued" });
  } catch (err) {
    console.error("[videos POST]", err);
    return NextResponse.json(
      { error: "Failed to create video job" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const guestMode = isGuestMode();
    const clerkId = guestMode || !hasClerkEnv() ? "guest-test-user" : await getClerkUserId();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.clerkId, clerkId),
    });
    if (!user) {
      return NextResponse.json({ videos: [] });
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") || 20), 100);
    const offset = Number(searchParams.get("offset") || 0);

    const userVideos = await db.query.videos.findMany({
      where: eq(videos.userId, user.id),
      orderBy: [desc(videos.createdAt)],
      limit,
      offset,
    });

    return NextResponse.json({ videos: userVideos });
  } catch (err) {
    console.error("[videos GET]", err);
    return NextResponse.json({ error: "Failed to fetch videos" }, { status: 500 });
  }
}
