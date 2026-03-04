import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { createCheckoutSession, PLANS } from "@/lib/stripe";
import { absoluteUrl } from "@/lib/utils";

export async function GET(req: NextRequest) {
  try {
    const { userId: clerkId } = auth();
    if (!clerkId) {
      return NextResponse.redirect(absoluteUrl("/sign-in"));
    }

    const user = await currentUser();
    if (!user) {
      return NextResponse.redirect(absoluteUrl("/sign-in"));
    }

    const { searchParams } = new URL(req.url);
    const plan = (searchParams.get("plan") || "PAY_PER_VIDEO").toUpperCase() as keyof typeof PLANS;
    const videoId = searchParams.get("videoId") || undefined;

    if (!PLANS[plan]) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const email = user.emailAddresses[0]?.emailAddress || "";
    const successUrl = videoId
      ? absoluteUrl(`/video/${videoId}?success=true`)
      : absoluteUrl("/dashboard?success=true");
    const cancelUrl = videoId
      ? absoluteUrl(`/video/${videoId}`)
      : absoluteUrl("/pricing");

    const checkoutUrl = await createCheckoutSession({
      userId: clerkId,
      userEmail: email,
      videoId,
      plan,
      successUrl,
      cancelUrl,
    });

    return NextResponse.redirect(checkoutUrl);
  } catch (err) {
    console.error("[checkout]", err);
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 });
  }
}
