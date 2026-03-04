import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

interface ClerkUserCreated {
  id: string;
  email_addresses: Array<{
    email_address: string;
    id: string;
  }>;
  first_name: string | null;
  last_name: string | null;
}

interface ClerkWebhookEvent {
  type: string;
  data: ClerkUserCreated;
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Clerk webhook secret not configured" },
      { status: 500 }
    );
  }

  const svix_id = req.headers.get("svix-id");
  const svix_timestamp = req.headers.get("svix-timestamp");
  const svix_signature = req.headers.get("svix-signature");

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return NextResponse.json({ error: "Missing svix headers" }, { status: 400 });
  }

  const body = await req.text();
  const wh = new Webhook(WEBHOOK_SECRET);

  let event: ClerkWebhookEvent;
  try {
    event = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as ClerkWebhookEvent;
  } catch (err) {
    console.error("[clerk webhook] verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    if (event.type === "user.created") {
      const { id, email_addresses, first_name, last_name } = event.data;
      const email = email_addresses[0]?.email_address || "";
      const name = [first_name, last_name].filter(Boolean).join(" ") || null;

      // Upsert user
      await db
        .insert(users)
        .values({
          clerkId: id,
          email,
          name,
          plan: "free",
          credits: 0,
        })
        .onConflictDoUpdate({
          target: users.clerkId,
          set: {
            email,
            name,
            updatedAt: new Date(),
          },
        });
    }

    if (event.type === "user.updated") {
      const { id, email_addresses, first_name, last_name } = event.data;
      const email = email_addresses[0]?.email_address || "";
      const name = [first_name, last_name].filter(Boolean).join(" ") || null;

      await db
        .update(users)
        .set({ email, name, updatedAt: new Date() })
        .where(eq(users.clerkId, id));
    }

    if (event.type === "user.deleted") {
      const { id } = event.data;
      await db.delete(users).where(eq(users.clerkId, id));
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[clerk webhook] handler error:", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}
