import { NextRequest, NextResponse } from "next/server";
import { generatePresignedUploadUrl, generateImageKey } from "@/lib/r2";
import { z } from "zod";
import { getClerkUserId, hasClerkEnv, isGuestMode } from "@/lib/auth";
import { createDraftVideo, getOrCreateUser } from "@/lib/video-jobs";

const PresignSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        size: z.number().max(20 * 1024 * 1024, "File too large (max 20MB)"),
      })
    )
    .min(1)
    .max(20),
});

export async function POST(req: NextRequest) {
  try {
    const guestMode = isGuestMode();
    const clerkId = guestMode || !hasClerkEnv() ? "guest-test-user" : await getClerkUserId();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = PresignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid request" },
        { status: 400 }
      );
    }

    const { files } = parsed.data;

    const user = await getOrCreateUser({ clerkId, email: "" });
    const { videoId } = await createDraftVideo(user.id);

    // Generate presigned URLs for each file
    const keys: string[] = [];
    const uploadUrls: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const ext = f.name.split(".").pop() || "jpg";
      const key = generateImageKey(user.id, videoId, `${i + 1}.${ext}`);
      keys.push(key);

      const url = await generatePresignedUploadUrl(key, f.type);
      uploadUrls.push(url);
    }

    return NextResponse.json({ uploadUrls, keys, videoId });
  } catch (err) {
    console.error("[presign]", err);
    return NextResponse.json(
      { error: "Failed to generate upload URLs" },
      { status: 500 }
    );
  }
}
