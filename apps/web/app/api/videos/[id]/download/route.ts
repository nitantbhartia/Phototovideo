import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generatePresignedDownloadUrl } from "@/lib/r2";
import { getClerkUserId, isGuestMode } from "@/lib/auth";

interface Params {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const db = getDb();
    const guestMode = isGuestMode();
    const clerkId = guestMode ? "guest-test-user" : await getClerkUserId();
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

    if (video.status !== "done" || !video.r2Key) {
      return NextResponse.json({ error: "Video not ready" }, { status: 400 });
    }

    if (!guestMode && !video.paid) {
      // Redirect to checkout
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/api/checkout?videoId=${video.id}&plan=PAY_PER_VIDEO`
      );
    }

    // Generate a download URL
    const url = await generatePresignedDownloadUrl(video.r2Key, 300);
    return NextResponse.redirect(url);
  } catch (err) {
    console.error("[download]", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
