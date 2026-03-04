import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Film, LayoutDashboard, PlusCircle, Settings } from "lucide-react";
import { UserButton } from "@clerk/nextjs";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const guestMode = process.env.GUEST_MODE === "true";
  const hasClerkEnv =
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;

  if (guestMode || !hasClerkEnv) {
    return (
      <div className="min-h-screen flex">
        <aside className="hidden md:flex w-64 flex-col fixed inset-y-0 bg-charcoal text-cream-50">
          <div className="flex h-16 items-center px-6 border-b border-cream-100/10">
            <Link href="/" className="flex items-center gap-2">
              <div className="h-7 w-7 rounded bg-gold/20 flex items-center justify-center">
                <Film className="h-4 w-4 text-gold" />
              </div>
              <span className="font-serif text-lg font-bold text-cream-50 tracking-wide">
                ListingReel
              </span>
            </Link>
          </div>

          <nav className="flex-1 px-4 py-6 space-y-1">
            <NavLink href="/generate" icon={PlusCircle}>
              Create Video
            </NavLink>
          </nav>

          <div className="px-4 py-4 border-t border-cream-100/10">
            <p className="text-sm font-medium text-cream-100">Guest Test Mode</p>
            <p className="text-xs text-cream-200/60">
              Auth, email, and billing are bypassed.
            </p>
          </div>
        </aside>

        <div className="flex-1 md:ml-64 flex flex-col min-h-screen">
          <header className="md:hidden flex h-14 items-center justify-between px-4 border-b border-border bg-charcoal">
            <Link href="/" className="flex items-center gap-2">
              <Film className="h-5 w-5 text-gold" />
              <span className="font-serif font-bold text-cream-50">ListingReel</span>
            </Link>
            <span className="text-xs text-cream-200/70">Guest Test Mode</span>
          </header>

          <main className="flex-1 bg-cream-50">{children}</main>
        </div>
      </div>
    );
  }

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 flex-col fixed inset-y-0 bg-charcoal text-cream-50">
        <div className="flex h-16 items-center px-6 border-b border-cream-100/10">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-7 w-7 rounded bg-gold/20 flex items-center justify-center">
              <Film className="h-4 w-4 text-gold" />
            </div>
            <span className="font-serif text-lg font-bold text-cream-50 tracking-wide">
              ListingReel
            </span>
          </Link>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1">
          <NavLink href="/dashboard" icon={LayoutDashboard}>
            Dashboard
          </NavLink>
          <NavLink href="/generate" icon={PlusCircle}>
            Create Video
          </NavLink>
        </nav>

        <div className="px-4 py-4 border-t border-cream-100/10">
          <div className="flex items-center gap-3">
            <UserButton afterSignOutUrl="/" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-cream-100 truncate">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-xs text-cream-200/60 truncate">
                {user.emailAddresses[0]?.emailAddress}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 md:ml-64 flex flex-col min-h-screen">
        {/* Mobile header */}
        <header className="md:hidden flex h-14 items-center justify-between px-4 border-b border-border bg-charcoal">
          <Link href="/" className="flex items-center gap-2">
            <Film className="h-5 w-5 text-gold" />
            <span className="font-serif font-bold text-cream-50">ListingReel</span>
          </Link>
          <UserButton afterSignOutUrl="/" />
        </header>

        <main className="flex-1 bg-cream-50">{children}</main>
      </div>
    </div>
  );
}

function NavLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-cream-200/70 hover:text-cream-50 hover:bg-cream-100/10 transition-colors text-sm font-medium"
    >
      <Icon className="h-4 w-4" />
      {children}
    </Link>
  );
}
