import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Check } from "lucide-react";

export const metadata = {
  title: "Pricing",
  description: "Professional AI listing videos for $49 per listing.",
};

const features = [
  "AI room classification & smart sorting",
  "Professional narrated voiceover",
  "Cinematic Ken Burns or AI-generated motion",
  "Background music",
  "Watermark-free HD download",
  "Shareable public link",
  "Multiple aspect ratios (16:9, 9:16, 1:1)",
  "Email & SMS delivery",
];

export default function PricingPage() {
  return (
    <div className="py-20">
      <div className="container">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-charcoal mb-4">
            One price. One listing. Yours forever.
          </h1>
          <p className="text-charcoal-600 text-lg max-w-xl mx-auto">
            Professional videography costs $200–$500 per shoot. ListingReel
            delivers the same result in minutes — no crew, no scheduling.
          </p>
        </div>

        {/* Single pricing card */}
        <Card className="max-w-md mx-auto border-gold shadow-xl ring-2 ring-gold/20">
          <CardContent className="p-8">
            <div className="text-center mb-8">
              <div className="flex items-baseline justify-center gap-1">
                <span className="font-serif text-5xl font-bold text-charcoal">
                  $49
                </span>
                <span className="text-charcoal-600 text-sm">
                  /listing
                </span>
              </div>
              <p className="text-charcoal-600 text-sm mt-2">
                One-time payment — no subscription, no hidden fees.
              </p>
            </div>

            <ul className="space-y-3 mb-8">
              {features.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <div className="mt-0.5 h-5 w-5 rounded-full bg-gold/15 flex items-center justify-center flex-shrink-0">
                    <Check className="h-3 w-3 text-gold-dark" />
                  </div>
                  <span className="text-sm text-charcoal-600">{feature}</span>
                </li>
              ))}
            </ul>

            <Button asChild className="w-full" size="lg">
              <Link href="/generate">Generate Your Video</Link>
            </Button>

            <p className="text-xs text-charcoal-600/60 text-center mt-4">
              Preview with watermark for free. Pay only when you're happy.
            </p>
          </CardContent>
        </Card>

        {/* How it works */}
        <div className="mt-20 max-w-2xl mx-auto">
          <h2 className="font-serif text-2xl font-bold text-charcoal text-center mb-10">
            How it works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
            {[
              {
                step: "1",
                title: "Upload photos",
                desc: "Drag and drop your listing photos — we handle the rest.",
              },
              {
                step: "2",
                title: "Preview for free",
                desc: "Watch your cinematic video with a watermarked preview.",
              },
              {
                step: "3",
                title: "Unlock for $49",
                desc: "Remove the watermark and download the full HD video.",
              },
            ].map((item) => (
              <div key={item.step}>
                <div className="h-10 w-10 rounded-full bg-gold/15 flex items-center justify-center mx-auto mb-3">
                  <span className="font-serif font-bold text-gold-dark">{item.step}</span>
                </div>
                <h3 className="font-semibold text-charcoal mb-1">{item.title}</h3>
                <p className="text-sm text-charcoal-600">{item.desc}</p>
              </div>
            ))}
          </div>
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

        {/* Comparison note */}
        <div className="mt-12 text-center">
          <p className="text-sm text-charcoal-600">
            Questions?{" "}
            <a href="mailto:hello@listingreel.com" className="text-gold hover:underline">
              Contact us
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

const pricingFaqs = [
  {
    question: "Do I pay before or after seeing the video?",
    answer:
      "After. Every video generates a free watermarked preview. You only pay $49 when you want the clean, watermark-free download.",
  },
  {
    question: "What payment methods do you accept?",
    answer:
      "All major credit cards (Visa, Mastercard, Amex) via Stripe. Payments are processed securely — we never store card details.",
  },
  {
    question: "Can I regenerate if I don't like the result?",
    answer:
      "Yes. You can regenerate as many watermarked previews as you like at no cost. You only pay once you're satisfied.",
  },
  {
    question: "Do you offer bulk or team pricing?",
    answer:
      "We're working on volume pricing for brokerages and teams. Reach out to hello@listingreel.com and we'll set you up.",
  },
];
