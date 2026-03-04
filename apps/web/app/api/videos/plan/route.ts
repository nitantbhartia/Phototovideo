import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getClerkUserId, hasClerkEnv, isGuestMode } from "@/lib/auth";

const PlanRequestSchema = z.object({
  videoId: z.string().uuid(),
  address: z.string().min(5).max(200),
  propertyType: z.string().default("Single Family"),
  tone: z.string().default("Warm & Inviting"),
  imageKeys: z.array(z.string()).min(1).max(20),
  autoSort: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const guestMode = isGuestMode();
    const clerkId =
      guestMode || !hasClerkEnv() ? "guest-test-user" : await getClerkUserId();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = PlanRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid request" },
        { status: 400 }
      );
    }

    const user = await db.query.users.findFirst({
      where: eq(users.clerkId, clerkId),
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const workerUrl = process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_SECRET;

    if (!workerUrl || !workerSecret) {
      return NextResponse.json(
        { error: "Worker not configured" },
        { status: 500 }
      );
    }

    // Call worker /plan endpoint directly (synchronous, ~30s)
    const response = await fetch(`${workerUrl}/plan`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-worker-secret": workerSecret,
      },
      body: JSON.stringify({
        videoId: parsed.data.videoId,
        userId: user.id,
        address: parsed.data.address,
        propertyType: parsed.data.propertyType,
        tone: parsed.data.tone,
        imageKeys: parsed.data.imageKeys,
        autoSort: parsed.data.autoSort,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Plan generation failed: ${errorText}` },
        { status: 502 }
      );
    }

    const plan = await response.json();
    return NextResponse.json(plan);
  } catch (err) {
    console.error("[videos/plan POST]", err);
    return NextResponse.json(
      { error: "Failed to generate plan" },
      { status: 500 }
    );
  }
}
