import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { setVideoStatus } from "@/lib/queue";
import { sendVideoReadyEmail, sendVideoErrorEmail } from "@/lib/email";
import { z } from "zod";

const StatusUpdateSchema = z.object({
  videoId: z.string().uuid(),
  status: z.enum(["queued", "processing", "done", "error"]),
  statusMessage: z.string().optional(),
  r2Key: z.string().optional(),
  thumbnailGifKey: z.string().nullable().optional(),
  durationSeconds: z.number().optional(),
  errorMessage: z.string().optional(),
});

export async function POST(req: NextRequest) {
  // Verify worker secret
  const workerSecret = req.headers.get("x-worker-secret");
  if (workerSecret !== process.env.WORKER_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const body = await req.json();
    const parsed = StatusUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { videoId, status, statusMessage, r2Key, thumbnailGifKey, durationSeconds, errorMessage } =
      parsed.data;

    // Update Redis for real-time polling
    await setVideoStatus(videoId, status, statusMessage);

    // Update DB
    const updateData: Partial<typeof videos.$inferInsert> = {
      status,
      statusMessage: statusMessage || null,
      updatedAt: new Date(),
    };

    if (r2Key) updateData.r2Key = r2Key;
    if (thumbnailGifKey) updateData.thumbnailGifKey = thumbnailGifKey;
    if (durationSeconds) updateData.durationSeconds = durationSeconds;
    if (errorMessage) updateData.errorMessage = errorMessage;

    await db.update(videos).set(updateData).where(eq(videos.id, videoId));

    // Send email notification on completion or error
    if (status === "done" || status === "error") {
      const video = await db.query.videos.findFirst({
        where: eq(videos.id, videoId),
        with: { user: true },
      });

      if (video?.user?.email) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL;
        if (status === "done") {
          const gifUrl = video.thumbnailGifKey
            ? `${process.env.R2_PUBLIC_URL}/${video.thumbnailGifKey}`
            : undefined;
          await sendVideoReadyEmail({
            to: video.user.email,
            name: video.user.name || "there",
            address: video.address,
            videoUrl: `${appUrl}/video/${video.id}`,
            unlockUrl: `${appUrl}/api/checkout?videoId=${video.id}&plan=PAY_PER_VIDEO`,
            thumbnailGifUrl: gifUrl,
          }).catch(console.error);
        } else {
          await sendVideoErrorEmail({
            to: video.user.email,
            name: video.user.name || "there",
            address: video.address,
          }).catch(console.error);
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[worker status]", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}
