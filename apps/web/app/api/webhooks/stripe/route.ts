import { NextRequest, NextResponse } from "next/server";
import { stripe, PLANS } from "@/lib/stripe";
import { db } from "@/lib/db";
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
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("[stripe webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdate(subscription);
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionCancelled(subscription);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[stripe webhook] handler error:", err);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const { userId, videoId, plan } = session.metadata || {};
  if (!userId || !plan) return;

  const user = await db.query.users.findFirst({
    where: eq(users.clerkId, userId),
  });
  if (!user) return;

  if (plan === "PAY_PER_VIDEO") {
    // Mark video as paid and remove watermark
    if (videoId) {
      await db
        .update(videos)
        .set({ paid: true, watermarked: false, updatedAt: new Date() })
        .where(eq(videos.id, videoId));
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
  } else if (plan === "STARTER" || plan === "PRO") {
    const planCredits =
      plan === "STARTER" ? PLANS.STARTER.credits : PLANS.PRO.credits;
    const planName = plan.toLowerCase() as "starter" | "pro";

    await db
      .update(users)
      .set({
        plan: planName,
        credits: planCredits,
        stripeCustomerId:
          typeof session.customer === "string" ? session.customer : null,
        updatedAt: new Date(),
      })
      .where(eq(users.clerkId, userId));

    await db.insert(transactions).values({
      userId: user.id,
      stripeSessionId: session.id,
      amountCents: session.amount_total || 0,
      type: "subscription",
    });
  }
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : null;
  if (!customerId) return;

  const user = await db.query.users.findFirst({
    where: eq(users.stripeCustomerId, customerId),
  });
  if (!user) return;

  const priceId = subscription.items.data[0]?.price.id;
  let plan: "starter" | "pro" | "free" = "free";
  let credits = 0;

  if (priceId === process.env.STRIPE_STARTER_PRICE_ID) {
    plan = "starter";
    credits = 10;
  } else if (priceId === process.env.STRIPE_PRO_PRICE_ID) {
    plan = "pro";
    credits = -1;
  }

  await db
    .update(users)
    .set({
      plan,
      credits,
      stripeSubscriptionId: subscription.id,
      updatedAt: new Date(),
    })
    .where(eq(users.stripeCustomerId, customerId));
}

async function handleSubscriptionCancelled(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : null;
  if (!customerId) return;

  await db
    .update(users)
    .set({ plan: "free", credits: 0, stripeSubscriptionId: null, updatedAt: new Date() })
    .where(eq(users.stripeCustomerId, customerId));
}
