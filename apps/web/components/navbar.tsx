"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Film, Menu, X } from "lucide-react";

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
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-cream-50/90 backdrop-blur supports-[backdrop-filter]:bg-cream-50/60">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-charcoal">
            <Film className="h-4 w-4 text-gold" />
          </div>
          <span className="font-serif text-lg sm:text-xl font-bold text-charcoal tracking-wide">
            ListingReel
          </span>
        </Link>

        {/* Desktop nav */}
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
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 rounded-md hover:bg-cream-100 transition-colors"
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <X className="h-5 w-5 text-charcoal" />
            ) : (
              <Menu className="h-5 w-5 text-charcoal" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border/60 bg-cream-50 px-4 py-4 space-y-3">
          {isMarketing && (
            <>
              <Link
                href="/#how-it-works"
                onClick={() => setMobileOpen(false)}
                className="block text-sm font-medium text-charcoal-600 hover:text-charcoal py-2"
              >
                How It Works
              </Link>
              <Link
                href="/pricing"
                onClick={() => setMobileOpen(false)}
                className="block text-sm font-medium text-charcoal-600 hover:text-charcoal py-2"
              >
                Pricing
              </Link>
            </>
          )}
          {isSignedIn && (
            <Link
              href="/dashboard"
              onClick={() => setMobileOpen(false)}
              className="block text-sm font-medium text-charcoal-600 hover:text-charcoal py-2"
            >
              Dashboard
            </Link>
          )}
          <Link
            href="/generate"
            onClick={() => setMobileOpen(false)}
            className="block text-sm font-medium text-gold hover:text-gold-dark py-2"
          >
            Generate a Video
          </Link>
        </div>
      )}
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

export function Navbar({ clerkEnabled = false }: { clerkEnabled?: boolean }) {
  return clerkEnabled ? <ClerkNavbar /> : <PublicNavbar />;
}
