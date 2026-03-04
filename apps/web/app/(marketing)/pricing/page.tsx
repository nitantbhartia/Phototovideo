import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Zap } from "lucide-react";

export const metadata = {
  title: "Pricing",
  description: "Simple, transparent pricing for AI real estate listing videos.",
};

const plans = [
  {
    name: "Pay-per-video",
    price: "$49",
    period: "per video",
    description: "Perfect for agents testing the platform or occasional use.",
    features: [
      "1 professional listing video",
      "AI room classification & sorting",
      "Professional narrated voiceover",
      "Cinematic Ken Burns effects",
      "Background music",
      "Watermark-free download",
      "Shareable public link",
      "Email delivery",
    ],
    cta: "Generate a Video",
    href: "/generate",
    highlighted: false,
  },
  {
    name: "Starter",
    price: "$99",
    period: "per month",
    description: "For independent agents with regular listings.",
    badge: "Most Popular",
    features: [
      "10 videos per month",
      "Everything in Pay-per-video",
      "Priority rendering queue",
      "Dashboard with video history",
      "Bulk download",
      "Cancel anytime",
    ],
    cta: "Start Starter Plan",
    href: "/api/checkout?plan=starter",
    highlighted: true,
  },
  {
    name: "Pro",
    price: "$249",
    period: "per month",
    description: "For teams and high-volume agents who need unlimited output.",
    features: [
      "Unlimited videos",
      "Everything in Starter",
      "Custom voice selection",
      "Logo overlay / branding",
      "Priority support",
      "Team access (coming soon)",
    ],
    cta: "Start Pro Plan",
    href: "/api/checkout?plan=pro",
    highlighted: false,
  },
];

export default function PricingPage() {
  return (
    <div className="py-20">
      <div className="container">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-charcoal mb-4">
            Transparent pricing
          </h1>
          <p className="text-charcoal-600 text-lg max-w-xl mx-auto">
            Professional videography costs $200–$500 per shoot. ListingReel
            delivers the same result for a fraction of the price.
          </p>
        </div>

        {/* Plans */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {plans.map((plan) => (
            <Card
              key={plan.name}
              className={`relative flex flex-col ${
                plan.highlighted
                  ? "border-gold shadow-xl ring-2 ring-gold/20"
                  : ""
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1 bg-gold text-white text-xs font-semibold px-3 py-1 rounded-full">
                    <Zap className="h-3 w-3" />
                    {plan.badge}
                  </span>
                </div>
              )}
              <CardHeader className="pb-2">
                <p className="text-sm font-medium text-charcoal-600 uppercase tracking-wider">
                  {plan.name}
                </p>
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="font-serif text-4xl font-bold text-charcoal">
                    {plan.price}
                  </span>
                  <span className="text-charcoal-600 text-sm">
                    /{plan.period}
                  </span>
                </div>
                <p className="text-sm text-charcoal-600 mt-2">
                  {plan.description}
                </p>
              </CardHeader>
              <CardContent className="flex flex-col flex-1 pt-4">
                <ul className="space-y-3 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <div className="mt-0.5 h-5 w-5 rounded-full bg-gold/15 flex items-center justify-center flex-shrink-0">
                        <Check className="h-3 w-3 text-gold-dark" />
                      </div>
                      <span className="text-sm text-charcoal-600">
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  <Button
                    asChild
                    className="w-full"
                    variant={plan.highlighted ? "default" : "outline"}
                    size="lg"
                  >
                    <Link href={plan.href}>{plan.cta}</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Comparison note */}
        <div className="mt-12 text-center">
          <p className="text-sm text-charcoal-600">
            All plans include AI narration, professional voiceover, and cinematic effects.
            <br />
            No contracts. Cancel anytime. Questions?{" "}
            <a href="mailto:hello@listingreel.com" className="text-gold hover:underline">
              Contact us
            </a>
          </p>
        </div>

        {/* FAQ */}
        <div className="mt-20 max-w-2xl mx-auto">
          <h2 className="font-serif text-2xl font-bold text-charcoal text-center mb-8">
            Pricing FAQ
          </h2>
          <div className="space-y-4">
            {pricingFaqs.map((faq, i) => (
              <div key={i} className="border border-border rounded-lg p-5">
                <h3 className="font-semibold text-charcoal mb-2">
                  {faq.question}
                </h3>
                <p className="text-sm text-charcoal-600 leading-relaxed">
                  {faq.answer}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const pricingFaqs = [
  {
    question: "Do unused credits roll over?",
    answer:
      "Starter plan credits (10/month) reset each billing cycle. Unused credits do not roll over. Pay-per-video credits never expire.",
  },
  {
    question: "Can I switch plans?",
    answer:
      "Yes, you can upgrade or downgrade at any time. Upgrades take effect immediately; downgrades take effect at the next billing cycle.",
  },
  {
    question: "What payment methods do you accept?",
    answer:
      "We accept all major credit cards (Visa, Mastercard, Amex) via Stripe. Payments are processed securely — we never store card details.",
  },
  {
    question: "Is there a free trial?",
    answer:
      "We don't offer a free trial, but every generated video includes a watermarked preview you can review before paying. You only pay if you want the clean, watermark-free download.",
  },
];
