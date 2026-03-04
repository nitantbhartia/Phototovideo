import { NextRequest, NextResponse } from "next/server";
import { getStripe, PLANS } from "@/lib/stripe";
import { getDb } from "@/lib/db";
import { users, videos, transactions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("[stripe webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutCompleted(session);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[stripe webhook] handler error:", err);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const db = getDb();
  const { userId, videoId } = session.metadata || {};
  if (!userId) return;

  const user = await db.query.users.findFirst({
    where: eq(users.clerkId, userId),
  });
  if (!user) return;

  // Mark video as paid and remove watermark
  if (videoId) {
    await db
      .update(videos)
      .set({ paid: true, watermarked: false, updatedAt: new Date() })
      .where(eq(videos.id, videoId));
  }

  // Update user plan to pay_per_video if still on free
  if (user.plan === "free") {
    await db
      .update(users)
      .set({
        plan: "pay_per_video",
        stripeCustomerId:
          typeof session.customer === "string" ? session.customer : null,
        updatedAt: new Date(),
      })
      .where(eq(users.clerkId, userId));
  }

  // Record transaction
  await db.insert(transactions).values({
    userId: user.id,
    videoId: videoId || null,
    stripeSessionId: session.id,
    stripePaymentId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : null,
    amountCents: session.amount_total || PLANS.PAY_PER_VIDEO.amount,
    type: "pay_per_video",
  });
}
