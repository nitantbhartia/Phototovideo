import Link from "next/link";

export default async function SignInPage() {
  const hasClerkEnv =
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;
  const guestMode = process.env.GUEST_MODE === "true";

  if (guestMode || !hasClerkEnv) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-50 py-12 px-6">
        <div className="w-full max-w-md text-center">
          <h1 className="font-serif text-3xl font-bold text-charcoal">
            Sign in is disabled
          </h1>
          <p className="text-charcoal-600 mt-2">
            Guest test mode is enabled for this deployment.
          </p>
          <Link
            href="/generate"
            className="inline-flex mt-6 rounded-md bg-charcoal px-4 py-2 text-sm font-medium text-cream-50"
          >
            Go to Generate
          </Link>
        </div>
      </div>
    );
  }

  const { SignIn } = await import("@clerk/nextjs");
  return (
    <div className="min-h-screen flex items-center justify-center bg-cream-50 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-serif text-3xl font-bold text-charcoal">
            Welcome back
          </h1>
          <p className="text-charcoal-600 mt-2">Sign in to your ListingReel account</p>
        </div>
        <SignIn
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "shadow-lg border border-border rounded-xl",
              headerTitle: "hidden",
              headerSubtitle: "hidden",
            },
          }}
        />
      </div>
    </div>
  );
}
