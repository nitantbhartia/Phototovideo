import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
  typescript: true,
});

export const PLANS = {
  PAY_PER_VIDEO: {
    priceId: process.env.STRIPE_PAY_PER_VIDEO_PRICE_ID!,
    amount: 4900,
    name: "Pay-per-video",
    credits: 1,
  },
  STARTER: {
    priceId: process.env.STRIPE_STARTER_PRICE_ID!,
    amount: 9900,
    name: "Starter",
    credits: 10,
  },
  PRO: {
    priceId: process.env.STRIPE_PRO_PRICE_ID!,
    amount: 24900,
    name: "Pro",
    credits: -1, // unlimited
  },
} as const;

export async function createCheckoutSession({
  userId,
  userEmail,
  videoId,
  plan,
  successUrl,
  cancelUrl,
}: {
  userId: string;
  userEmail: string;
  videoId?: string;
  plan: keyof typeof PLANS;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const planConfig = PLANS[plan];
  const isSubscription = plan === "STARTER" || plan === "PRO";

  const session = await stripe.checkout.sessions.create({
    customer_email: userEmail,
    mode: isSubscription ? "subscription" : "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price: planConfig.priceId,
        quantity: 1,
      },
    ],
    metadata: {
      userId,
      videoId: videoId || "",
      plan,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return session.url!;
}

export async function createCustomerPortalSession(
  stripeCustomerId: string,
  returnUrl: string
): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });
  return session.url;
}
