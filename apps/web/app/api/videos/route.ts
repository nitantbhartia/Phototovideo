import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { videos, users, videoClips } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { dispatchVideoJob } from "@/lib/queue";
import { z } from "zod";

const CreateVideoSchema = z.object({
  videoId: z.string().uuid(),
  address: z.string().min(5, "Address too short").max(200),
  propertyType: z.string().default("Single Family"),
  tone: z.string().default("Warm & Inviting"),
  imageKeys: z.array(z.string()).min(1).max(20),
  autoSort: z.boolean().default(true),
  addMusic: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth();
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

    const { videoId, address, propertyType, tone, imageKeys, autoSort, addMusic } =
      parsed.data;

    const user = await db.query.users.findFirst({
      where: eq(users.clerkId, clerkId),
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check credits (plan enforcement)
    if (user.plan !== "pro" && user.credits <= 0) {
      // Allow generation — user will pay before download
    }

    // Update video record with address and details
    await db
      .update(videos)
      .set({
        address,
        propertyType,
        tone,
        status: "queued",
        statusMessage: "Job queued",
        updatedAt: new Date(),
      })
      .where(eq(videos.id, videoId));

    // Insert clip records (one per image, order determined by AI later)
    const r2BaseUrl = process.env.R2_PUBLIC_URL;
    await db.insert(videoClips).values(
      imageKeys.map((key, i) => ({
        videoId,
        imageUrl: `${r2BaseUrl}/${key}`,
        r2Key: key,
        orderIndex: i,
      }))
    );

    // Dispatch job to Railway worker via QStash
    await dispatchVideoJob({
      videoId,
      userId: user.id,
      address,
      propertyType,
      tone,
      imageKeys,
      addMusic,
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
    const { userId: clerkId } = auth();
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
