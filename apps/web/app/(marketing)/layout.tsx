import { Navbar } from "@/components/navbar";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border bg-charcoal text-cream-100 py-12">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="col-span-1 md:col-span-2">
              <h3 className="font-serif text-xl font-bold text-gold mb-2">
                ListingReel
              </h3>
              <p className="text-sm text-cream-200/70 max-w-xs">
                AI-powered cinematic listing videos for real estate agents. Professional results in 5 minutes.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-cream-100 mb-3 text-sm uppercase tracking-wider">
                Product
              </h4>
              <ul className="space-y-2 text-sm text-cream-200/70">
                <li><a href="/#how-it-works" className="hover:text-gold transition-colors">How It Works</a></li>
                <li><a href="/pricing" className="hover:text-gold transition-colors">Pricing</a></li>
                <li><a href="/dashboard" className="hover:text-gold transition-colors">Dashboard</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-cream-100 mb-3 text-sm uppercase tracking-wider">
                Legal
              </h4>
              <ul className="space-y-2 text-sm text-cream-200/70">
                <li><a href="/privacy" className="hover:text-gold transition-colors">Privacy Policy</a></li>
                <li><a href="/terms" className="hover:text-gold transition-colors">Terms of Service</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-cream-100/10 text-center text-xs text-cream-200/50">
            © {new Date().getFullYear()} ListingReel. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
