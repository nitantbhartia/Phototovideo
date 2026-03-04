import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

export function getStripe() {
  if (stripeInstance) {
    return stripeInstance;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  stripeInstance = new Stripe(secretKey, {
    apiVersion: "2024-04-10",
    typescript: true,
  });
  return stripeInstance;
}

export const PLANS = {
  PAY_PER_VIDEO: {
    priceId: process.env.STRIPE_PAY_PER_VIDEO_PRICE_ID!,
    amount: 4900,
    name: "Per Listing",
    credits: 1,
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
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    customer_email: userEmail,
    mode: "payment",
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

