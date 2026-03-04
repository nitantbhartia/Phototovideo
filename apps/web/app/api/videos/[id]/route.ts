import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { videos, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generatePresignedDownloadUrl } from "@/lib/r2";
import { getVideoStatus } from "@/lib/queue";

interface Params {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { userId: clerkId } = auth();

    const video = await db.query.videos.findFirst({
      where: eq(videos.id, params.id),
      with: { user: true },
    });

    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    // Allow unauthenticated access to status only (for polling during generation)
    // but only if the user owns it (clerkId must match)
    if (clerkId && video.user.clerkId !== clerkId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Try to get real-time status from Redis (more up-to-date than DB)
    const redisStatus = await getVideoStatus(params.id).catch(() => null);
    if (redisStatus && video.status !== "done" && video.status !== "error") {
      return NextResponse.json({
        id: video.id,
        status: redisStatus.status,
        statusMessage: redisStatus.message,
        address: video.address,
        shareId: video.shareId,
        paid: video.paid,
        watermarked: video.watermarked,
        durationSeconds: video.durationSeconds,
        createdAt: video.createdAt,
      });
    }

    const response: Record<string, unknown> = {
      id: video.id,
      status: video.status,
      statusMessage: video.statusMessage,
      address: video.address,
      shareId: video.shareId,
      paid: video.paid,
      watermarked: video.watermarked,
      durationSeconds: video.durationSeconds,
      errorMessage: video.errorMessage,
      createdAt: video.createdAt,
    };

    // Generate a short-lived download URL if video is done
    if (video.status === "done" && video.r2Key) {
      response.videoUrl = await generatePresignedDownloadUrl(video.r2Key, 3600);
    }

    return NextResponse.json(response);
  } catch (err) {
    console.error("[videos/[id] GET]", err);
    return NextResponse.json({ error: "Failed to fetch video" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { userId: clerkId } = auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const video = await db.query.videos.findFirst({
      where: eq(videos.id, params.id),
      with: { user: true },
    });

    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    if (video.user.clerkId !== clerkId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await db.delete(videos).where(eq(videos.id, params.id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[videos/[id] DELETE]", err);
    return NextResponse.json({ error: "Failed to delete video" }, { status: 500 });
  }
}
