import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { videos, users } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  PlusCircle,
  Play,
  Download,
  Share2,
  Trash2,
  Film,
  Clock,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { getPublicUrl } from "@/lib/r2";
import { formatDuration } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const clerkUser = await currentUser();
  if (!clerkUser) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.clerkId, clerkUser.id),
  });

  const userVideos = user
    ? await db.query.videos.findMany({
        where: eq(videos.userId, user.id),
        orderBy: [desc(videos.createdAt)],
        limit: 50,
      })
    : [];

  const completedCount = userVideos.filter((v) => v.status === "done").length;
  const processingCount = userVideos.filter(
    (v) => v.status === "queued" || v.status === "processing"
  ).length;

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-2xl md:text-3xl font-bold text-charcoal">
            Welcome back, {clerkUser.firstName}
          </h1>
          <p className="text-charcoal-600 mt-1">
            {user?.credits !== undefined && user.credits >= 0
              ? `${user.credits} video${user.credits !== 1 ? "s" : ""} remaining`
              : user?.plan === "pro"
              ? "Unlimited videos (Pro)"
              : "No credits — purchase to generate videos"}
          </p>
        </div>
        <Button asChild>
          <Link href="/generate">
            <PlusCircle className="h-4 w-4 mr-2" />
            New Video
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Total Videos"
          value={userVideos.length}
          icon={Film}
        />
        <StatCard
          label="Completed"
          value={completedCount}
          icon={CheckCircle}
          iconColor="text-green-600"
        />
        <StatCard
          label="Processing"
          value={processingCount}
          icon={Clock}
          iconColor="text-blue-600"
        />
        <StatCard
          label="Credits Left"
          value={user?.plan === "pro" ? "∞" : user?.credits ?? 0}
          icon={AlertCircle}
          iconColor="text-gold"
        />
      </div>

      {/* Video grid */}
      {userVideos.length === 0 ? (
        <div className="text-center py-20">
          <div className="h-16 w-16 rounded-2xl bg-gold/10 flex items-center justify-center mx-auto mb-4">
            <Film className="h-8 w-8 text-gold" />
          </div>
          <h3 className="font-serif text-xl font-bold text-charcoal mb-2">
            No videos yet
          </h3>
          <p className="text-charcoal-600 mb-6 max-w-sm mx-auto">
            Generate your first listing video in minutes with AI-powered narration and cinematic effects.
          </p>
          <Button asChild size="lg">
            <Link href="/generate">
              <PlusCircle className="h-4 w-4 mr-2" />
              Create Your First Video
            </Link>
          </Button>
        </div>
      ) : (
        <>
          {/* Filter tabs */}
          <div className="flex gap-2 mb-6 overflow-x-auto">
            {["All", "Processing", "Completed", "Error"].map((filter) => (
              <button
                key={filter}
                className="px-4 py-1.5 rounded-full text-sm font-medium border border-border bg-white hover:bg-cream-100 transition-colors whitespace-nowrap"
              >
                {filter}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {userVideos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  iconColor = "text-charcoal-600",
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-cream-100 flex items-center justify-center flex-shrink-0">
          <Icon className={`h-5 w-5 ${iconColor}`} />
        </div>
        <div>
          <div className="text-xl font-bold text-charcoal">{value}</div>
          <div className="text-xs text-charcoal-600">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function VideoCard({ video }: { video: typeof videos.$inferSelect }) {
  const statusBadgeVariant: Record<string, "warning" | "processing" | "success" | "error"> = {
    queued: "warning",
    processing: "processing",
    done: "success",
    error: "error",
  };

  const statusLabel: Record<string, string> = {
    queued: "Queued",
    processing: "Processing",
    done: "Ready",
    error: "Error",
  };

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow group">
      {/* Thumbnail */}
      <div className="aspect-video bg-charcoal-900 relative overflow-hidden">
        {video.status === "done" && video.r2Key ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm group-hover:bg-white/30 transition-colors">
              <Play className="h-5 w-5 text-white ml-0.5" fill="white" />
            </div>
          </div>
        ) : video.status === "processing" || video.status === "queued" ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-8 w-8 rounded-full border-2 border-gold border-t-transparent animate-spin" />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <AlertCircle className="h-8 w-8 text-red-400" />
          </div>
        )}
        <div className="absolute top-2 right-2">
          <Badge variant={statusBadgeVariant[video.status] || "secondary"}>
            {statusLabel[video.status] || video.status}
          </Badge>
        </div>
        {video.durationSeconds && (
          <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
            {formatDuration(video.durationSeconds)}
          </div>
        )}
      </div>

      <CardContent className="p-4">
        <h3 className="font-medium text-charcoal text-sm mb-1 truncate" title={video.address}>
          {video.address}
        </h3>
        <p className="text-xs text-charcoal-600 mb-3">
          {new Date(video.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>

        {video.status === "done" && (
          <div className="flex gap-2">
            <Button asChild size="sm" className="flex-1">
              <Link href={`/video/${video.id}`}>
                <Play className="h-3 w-3 mr-1" />
                Watch
              </Link>
            </Button>
            <Button
              asChild
              size="sm"
              variant="outline"
              className="flex-1"
            >
              <Link href={`/api/videos/${video.id}/download`}>
                <Download className="h-3 w-3 mr-1" />
                {video.paid ? "Download" : "$49"}
              </Link>
            </Button>
            <Button
              asChild
              size="sm"
              variant="ghost"
            >
              <Link href={`/video/${video.shareId}`} target="_blank">
                <Share2 className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        )}
        {video.status === "processing" && (
          <p className="text-xs text-blue-600 font-medium">
            {video.statusMessage || "Generating your video..."}
          </p>
        )}
        {video.status === "error" && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-red-600">Generation failed</p>
            <Button asChild size="sm" variant="outline">
              <Link href={`/generate?retry=${video.id}`}>Retry</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
