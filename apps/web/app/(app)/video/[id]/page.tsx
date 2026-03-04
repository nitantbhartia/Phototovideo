import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import { VideoPlayer } from "./video-player";
import { ShareButton } from "./share-button";
import { generatePresignedDownloadUrl } from "@/lib/r2";
import { currentUser } from "@clerk/nextjs/server";
import { Button } from "@/components/ui/button";
import { Download, Film, RefreshCw } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface Props {
  params: { id: string };
}

export async function generateMetadata({ params }: Props) {
  const video = await getVideo(params.id);
  if (!video) return {};
  return {
    title: `Listing Video — ${video.address}`,
    description: `Cinematic listing video for ${video.address}`,
  };
}

async function getVideo(id: string) {
  const db = getDb();
  return db.query.videos.findFirst({
    where: or(eq(videos.id, id), eq(videos.shareId, id)),
    with: { user: true },
  });
}

export default async function VideoPage({ params }: Props) {
  const video = await getVideo(params.id);
  if (!video) notFound();

  const clerkUser = await currentUser();
  const isOwner = clerkUser && video.user.clerkId === clerkUser.id;

  let videoUrl: string | null = null;
  if (video.r2Key && video.status === "done") {
    videoUrl = await generatePresignedDownloadUrl(video.r2Key, 3600);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";

  const showUnlockBanner = isOwner && video.status === "done" && !video.paid && videoUrl;

  return (
    <div className="min-h-screen bg-charcoal pb-24">
      {/* Branding bar */}
      <div className="bg-charcoal-900 px-6 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Film className="h-4 w-4 text-gold" />
          <span className="font-serif text-sm font-bold text-gold">ListingReel</span>
        </Link>
        {!clerkUser && (
          <Link
            href="/sign-up"
            className="text-xs text-cream-200/70 hover:text-gold transition-colors"
          >
            Create a video for your listing →
          </Link>
        )}
      </div>

      {/* Video player */}
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="rounded-2xl overflow-hidden bg-black aspect-video mb-6 relative">
          {videoUrl ? (
            <VideoPlayer url={videoUrl} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              {video.status === "processing" || video.status === "queued" ? (
                <div className="text-center">
                  <div className="h-12 w-12 rounded-full border-2 border-gold border-t-transparent animate-spin mx-auto mb-3" />
                  <p className="text-cream-200/70 text-sm">Generating your video...</p>
                  <p className="text-cream-200/50 text-xs mt-1">
                    {video.statusMessage || "This usually takes 5–7 minutes"}
                  </p>
                </div>
              ) : (
                <div className="text-center text-cream-200/50">
                  <Film className="h-12 w-12 mx-auto mb-2" />
                  <p className="text-sm">Video unavailable</p>
                </div>
              )}
            </div>
          )}

          {/* Watermark overlay */}
          {video.watermarked && videoUrl && (
            <div className="absolute bottom-4 right-4 bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-md pointer-events-none">
              <span className="text-xs font-serif font-bold text-gold/80 tracking-widest uppercase">
                ListingReel Preview
              </span>
            </div>
          )}
        </div>

        {/* Info + actions */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-xl md:text-2xl font-bold text-cream-50">
              {video.address}
            </h1>
            <p className="text-cream-200/60 text-sm mt-1">
              {new Date(video.createdAt).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
              {video.durationSeconds && (
                <> · {Math.floor(video.durationSeconds / 60)}:{String(video.durationSeconds % 60).padStart(2, "0")}</>
              )}
            </p>
          </div>

          <div className="flex gap-3 flex-wrap">
            {isOwner && video.status === "done" && (
              <>
                {video.paid ? (
                  <Button asChild>
                    <a href={`/api/videos/${video.id}/download`}>
                      <Download className="h-4 w-4 mr-2" />
                      Download MP4
                    </a>
                  </Button>
                ) : (
                  <Button asChild>
                    <a href={`/api/checkout?videoId=${video.id}&plan=PAY_PER_VIDEO`}>
                      <Download className="h-4 w-4 mr-2" />
                      Unlock for $49
                    </a>
                  </Button>
                )}
                <ShareButton shareId={video.shareId} appUrl={appUrl} />
                <Button asChild variant="outline" className="border-cream-200/30 text-cream-200 hover:bg-cream-100/10">
                  <Link href={`/generate?retry=${video.id}`}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Regenerate
                  </Link>
                </Button>
              </>
            )}
            {!isOwner && (
              <div className="text-center bg-charcoal-700 rounded-xl p-6 max-w-sm">
                <p className="text-cream-100 font-medium mb-2">
                  Want a video like this?
                </p>
                <p className="text-cream-200/60 text-sm mb-4">
                  ListingReel generates cinematic listing videos from your photos in 5 minutes.
                </p>
                <Button asChild className="w-full">
                  <Link href="/sign-up">Create My Video for $49</Link>
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sticky unlock banner */}
      {showUnlockBanner && (
        <div className="fixed bottom-0 inset-x-0 z-50 border-t border-gold/20 bg-charcoal-900/95 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div>
              <p className="text-cream-50 font-semibold text-sm">
                This is a watermarked preview
              </p>
              <p className="text-cream-200/60 text-xs">
                Unlock to remove the watermark and download the full HD version — yours to keep forever.
              </p>
            </div>
            <Button asChild className="shrink-0 bg-gold hover:bg-gold/90 text-charcoal font-bold px-6">
              <a href={`/api/checkout?videoId=${video.id}&plan=PAY_PER_VIDEO`}>
                Unlock for $49 →
              </a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
