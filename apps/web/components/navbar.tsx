"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Film } from "lucide-react";

const hasClerkPublishableKey =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.GUEST_MODE !== "true";
const ClerkNavbar = dynamic(
  () => import("./clerk-navbar").then((module) => module.ClerkNavbar),
  { ssr: false }
);

export function NavbarShell({
  isSignedIn,
  authControls,
}: {
  isSignedIn: boolean;
  authControls: React.ReactNode;
}) {
  const pathname = usePathname();
  const isMarketing = pathname === "/" || pathname === "/pricing";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-cream-50/90 backdrop-blur supports-[backdrop-filter]:bg-cream-50/60">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-charcoal">
            <Film className="h-4 w-4 text-gold" />
          </div>
          <span className="font-serif text-xl font-bold text-charcoal tracking-wide">
            ListingReel
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-6">
          {isMarketing && (
            <>
              <Link
                href="/#how-it-works"
                className="text-sm text-charcoal-600 hover:text-charcoal transition-colors"
              >
                How It Works
              </Link>
              <Link
                href="/pricing"
                className="text-sm text-charcoal-600 hover:text-charcoal transition-colors"
              >
                Pricing
              </Link>
            </>
          )}
          {isSignedIn && (
            <Link
              href="/dashboard"
              className="text-sm text-charcoal-600 hover:text-charcoal transition-colors"
            >
              Dashboard
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3">
          {authControls}
        </div>
      </div>
    </header>
  );
}

function PublicNavbar() {
  return (
    <NavbarShell
      isSignedIn={false}
      authControls={
        <Button asChild size="sm">
          <Link href="/pricing">Get Started</Link>
        </Button>
      }
    />
  );
}

export function Navbar() {
  return hasClerkPublishableKey ? <ClerkNavbar /> : <PublicNavbar />;
}
