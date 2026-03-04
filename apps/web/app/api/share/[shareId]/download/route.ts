import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { generatePresignedDownloadUrl } from "@/lib/r2";

interface Params {
  params: { shareId: string };
}

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const db = getDb();
    const video = await db.query.videos.findFirst({
      where: eq(videos.shareId, params.shareId),
    });

    if (!video || video.status !== "done" || !video.r2Key) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    const url = await generatePresignedDownloadUrl(video.r2Key, 3600);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("[share download]", error);
    return NextResponse.json({ error: "Failed to get video" }, { status: 500 });
  }
}
