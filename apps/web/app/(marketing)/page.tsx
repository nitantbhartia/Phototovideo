import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Upload,
  Sparkles,
  Download,
  Check,
  Star,
  ChevronDown,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-cream-50 to-cream-100 py-20 md:py-32">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5" />
        <div className="container relative text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-gold/10 border border-gold/20 px-4 py-1.5 text-sm text-gold-dark mb-6">
            <Sparkles className="h-3.5 w-3.5" />
            AI-Powered · Ready in 5 Minutes
          </div>
          <h1 className="font-serif text-4xl md:text-6xl lg:text-7xl font-bold text-charcoal mb-6 leading-tight text-balance">
            Your listing photos.
            <br />
            <span className="text-gold">A cinematic video.</span>
            <br />
            In 5 minutes.
          </h1>
          <p className="text-lg md:text-xl text-charcoal-600 max-w-2xl mx-auto mb-10 text-balance">
            ListingReel uses AI to turn static listing photos into narrated
            property videos — for $49, no videographer needed.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Button asChild size="xl">
              <Link href="/generate">Generate a Free Preview</Link>
            </Button>
            <Button asChild variant="outline" size="xl">
              <Link href="#how-it-works">See How It Works</Link>
            </Button>
          </div>

          {/* Social proof */}
          <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-6 text-sm text-charcoal-600">
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-8 w-8 rounded-full bg-gradient-to-br from-gold to-gold-dark border-2 border-white"
                  />
                ))}
              </div>
              <span>Join 200+ agents</span>
            </div>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <Star
                  key={i}
                  className="h-4 w-4 fill-gold text-gold"
                />
              ))}
              <span className="ml-1">4.9/5 from agents</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span>1,200+ videos generated</span>
            </div>
          </div>
        </div>
      </section>

      {/* Video Demo placeholder */}
      <section className="bg-charcoal py-16">
        <div className="container">
          <div className="max-w-4xl mx-auto rounded-2xl overflow-hidden bg-charcoal-700 aspect-video flex items-center justify-center border border-gold/20">
            <div className="text-center p-8">
              <div className="h-16 w-16 rounded-full bg-gold/20 flex items-center justify-center mx-auto mb-4 cursor-pointer hover:bg-gold/30 transition-colors">
                <div className="w-0 h-0 border-t-[10px] border-t-transparent border-l-[18px] border-l-gold border-b-[10px] border-b-transparent ml-1" />
              </div>
              <p className="text-cream-200/70 text-sm">
                Watch a 90-second demo — listing photos → cinematic video
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 bg-cream-50">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="font-serif text-3xl md:text-4xl font-bold text-charcoal mb-4">
              From photos to video in three steps
            </h2>
            <p className="text-charcoal-600 max-w-xl mx-auto">
              No software to install, no videographer to schedule. Just upload
              your photos and let AI do the rest.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {steps.map((step, i) => (
              <div key={i} className="relative">
                <Card className="h-full border-0 shadow-md hover:shadow-lg transition-shadow">
                  <CardContent className="p-8 text-center">
                    <div className="h-14 w-14 rounded-2xl bg-gold/10 flex items-center justify-center mx-auto mb-5">
                      <step.icon className="h-6 w-6 text-gold" />
                    </div>
                    <div className="text-4xl font-serif font-bold text-gold/30 mb-2">
                      0{i + 1}
                    </div>
                    <h3 className="font-serif text-lg font-bold text-charcoal mb-2">
                      {step.title}
                    </h3>
                    <p className="text-sm text-charcoal-600 leading-relaxed">
                      {step.description}
                    </p>
                  </CardContent>
                </Card>
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-4 transform -translate-y-1/2 text-gold/30">
                    →
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Feature list */}
          <div className="mt-16 max-w-2xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-3">
            {features.map((feature, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="mt-0.5 h-5 w-5 rounded-full bg-gold/20 flex items-center justify-center flex-shrink-0">
                  <Check className="h-3 w-3 text-gold-dark" />
                </div>
                <span className="text-sm text-charcoal-600">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Preview */}
      <section className="py-20 bg-charcoal text-cream-50">
        <div className="container text-center">
          <h2 className="font-serif text-3xl md:text-4xl font-bold mb-4">
            Simple, transparent pricing
          </h2>
          <p className="text-cream-200/70 mb-10 max-w-lg mx-auto">
            Professional videography costs $200–$500 per shoot. ListingReel starts at $49 per video — narrated, cinematic, delivered in minutes.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg">
              <Link href="/pricing">See Pricing</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="border-cream-200/30 text-cream-100 hover:bg-cream-100/10">
              <Link href="/generate">Start for $49</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 bg-cream-50">
        <div className="container max-w-2xl">
          <h2 className="font-serif text-3xl font-bold text-charcoal text-center mb-12">
            Frequently asked questions
          </h2>
          <div className="space-y-1">
            {faqs.map((faq, i) => (
              <FaqItem key={i} question={faq.question} answer={faq.answer} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-gradient-to-br from-charcoal to-charcoal-900">
        <div className="container text-center">
          <h2 className="font-serif text-3xl md:text-4xl font-bold text-cream-50 mb-4">
            Ready to stand out?
          </h2>
          <p className="text-cream-200/70 mb-8 max-w-md mx-auto">
            Generate your first listing video today. Watermarked preview is
            free — pay only when you love it.
          </p>
          <Button asChild size="xl">
            <Link href="/generate">Generate My First Video</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="group border border-border rounded-lg overflow-hidden">
      <summary className="flex cursor-pointer items-center justify-between px-6 py-4 font-medium text-charcoal hover:bg-cream-100 transition-colors list-none">
        {question}
        <ChevronDown className="h-4 w-4 text-gold shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-6 pb-4 text-sm text-charcoal-600 leading-relaxed">
        {answer}
      </div>
    </details>
  );
}

const steps = [
  {
    icon: Upload,
    title: "Upload Your Photos",
    description:
      "Drag and drop up to 20 listing photos. We accept JPG, PNG, WEBP, and HEIC. AI automatically sorts them by room type.",
  },
  {
    icon: Sparkles,
    title: "We Generate Your Video",
    description:
      "Claude AI classifies rooms and writes professional narration. ElevenLabs records the voiceover. ffmpeg renders cinematic Ken Burns effects.",
  },
  {
    icon: Download,
    title: "Download & Share",
    description:
      "A polished MP4 is ready in ~5 minutes. Download, share the link, or post directly to social media and MLS.",
  },
];

const features = [
  "AI room classification & auto-sorting",
  "Professional narrated voiceover",
  "Cinematic Ken Burns zoom effects",
  "Warm color grading & vignette",
  "Cross-dissolve transitions",
  "Background music (optional)",
  "Subtitle burn-in",
  "Web-optimized MP4 output",
  "Shareable public link",
  "Download for social & MLS",
];

const faqs = [
  {
    question: "How long does it take?",
    answer:
      "Most videos with 8–12 photos are ready in 4–7 minutes. Larger sets of 15–20 photos may take up to 10 minutes. You'll get an email notification when it's done.",
  },
  {
    question: "Can I customize the voice or narration?",
    answer:
      "The current version uses our default professional voice (ElevenLabs Rachel). Custom voice selection and narration editing are coming in V1.5.",
  },
  {
    question: "What if I don't like the narration?",
    answer:
      "We include a feedback option on every video. Narration editing and regeneration is on our roadmap for V1.5. If the quality is significantly off, contact us and we'll make it right.",
  },
  {
    question: "What photo formats do you accept?",
    answer:
      "JPG, PNG, WEBP, and HEIC (iPhone). Maximum 20 photos per video. Photos are uploaded directly and securely to cloud storage.",
  },
  {
    question: "Is the preview watermarked?",
    answer:
      "Yes — the generated preview includes a ListingReel watermark. Pay $49 to unlock the clean, watermark-free MP4.",
  },
];
