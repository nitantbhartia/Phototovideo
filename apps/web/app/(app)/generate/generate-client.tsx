"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  X,
  CheckCircle,
  Loader2,
  Film,
  MapPin,
  Music,
  LayoutGrid,
  Mic,
  Monitor,
  ArrowUp,
  ArrowDown,
  Pencil,
} from "lucide-react";
import Image from "next/image";

type Step = "upload" | "details" | "review" | "generating" | "done";

interface SelectedFile {
  file: File;
  preview: string;
  id: string;
}

interface ReviewClip {
  imageIndex: number;
  imageKey: string;
  roomLabel: string;
  narration: string;
  preview: string; // blob URL from the original file
}

interface PipelineStep {
  label: string;
  status: "pending" | "active" | "done";
}

const PIPELINE_STEPS: PipelineStep[] = [
  { label: "Classifying & sorting rooms", status: "pending" },
  { label: "Writing narrations", status: "pending" },
  { label: "Recording voiceover", status: "pending" },
  { label: "Rendering video clips", status: "pending" },
  { label: "Assembling final video", status: "pending" },
];

const ESTIMATED_TIMES: Record<number, string> = {
  0: "About 7 minutes remaining",
  20: "About 6 minutes remaining",
  40: "About 4 minutes remaining",
  60: "About 2 minutes remaining",
  80: "About 1 minute remaining",
  95: "Almost done...",
};

const VOICE_OPTIONS = [
  { value: "rachel", label: "Rachel", description: "Warm, female" },
  { value: "josh", label: "Josh", description: "Deep, male" },
  { value: "bella", label: "Bella", description: "Soft, female" },
  { value: "antoni", label: "Antoni", description: "Warm, male" },
];

const MUSIC_OPTIONS = [
  { value: "ambient", label: "Ambient", description: "Soft & calming" },
  { value: "upbeat", label: "Upbeat", description: "Energetic & modern" },
  { value: "cinematic", label: "Cinematic", description: "Dramatic & luxurious" },
];

const ASPECT_RATIO_OPTIONS = [
  { value: "16:9", label: "16:9", description: "Landscape (YouTube, MLS)" },
  { value: "9:16", label: "9:16", description: "Vertical (Reels, TikTok)" },
  { value: "1:1", label: "1:1", description: "Square (Instagram)" },
];

export function GenerateClient() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [address, setAddress] = useState("");
  const [propertyType, setPropertyType] = useState("Single Family");
  const [tone, setTone] = useState("Warm & Inviting");
  const [voiceId, setVoiceId] = useState("rachel");
  const [musicStyle, setMusicStyle] = useState("ambient");
  const [aspectRatios, setAspectRatios] = useState<string[]>(["16:9"]);
  const [autoSort, setAutoSort] = useState(true);
  const [addMusic, setAddMusic] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [progress, setProgress] = useState(0);
  const [pipelineSteps, setPipelineSteps] = useState(PIPELINE_STEPS);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [uploadedKeys, setUploadedKeys] = useState<string[]>([]);
  const [reviewClips, setReviewClips] = useState<ReviewClip[]>([]);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const newFiles = acceptedFiles.slice(0, 20 - files.length).map((f) => ({
        file: f,
        preview: URL.createObjectURL(f),
        id: Math.random().toString(36).slice(2),
      }));
      setFiles((prev) => [...prev, ...newFiles].slice(0, 20));
    },
    [files.length]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
      "image/heic": [".heic"],
    },
    maxFiles: 20,
    multiple: true,
  });

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const f = prev.find((f) => f.id === id);
      if (f) URL.revokeObjectURL(f.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  // Upload photos and return keys + videoId
  const uploadPhotos = async (): Promise<{ keys: string[]; videoId: string }> => {
    const presignRes = await fetch("/api/upload/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: files.map((f) => ({
          name: f.file.name,
          type: f.file.type,
          size: f.file.size,
        })),
      }),
    });

    if (!presignRes.ok) throw new Error("Failed to get upload URLs");
    const { keys, videoId: newVideoId } = await presignRes.json();

    const uploadResults = await Promise.all(
      keys.map(async (key: string, i: number) => {
        const res = await fetch(`/api/upload/file?key=${encodeURIComponent(key)}`, {
          method: "POST",
          body: files[i].file,
          headers: { "Content-Type": files[i].file.type },
        });
        return res.ok;
      })
    );

    if (uploadResults.some((ok: boolean) => !ok)) {
      throw new Error("Failed to upload one or more photos");
    }

    return { keys, videoId: newVideoId };
  };

  // Edit-before-render: upload → get AI plan → show review step
  const handlePreviewEdit = async () => {
    if (!address.trim()) {
      setUploadError("Please enter the property address.");
      return;
    }
    if (files.length === 0) {
      setUploadError("Please add at least one photo.");
      return;
    }

    setIsPlanning(true);
    setUploadError("");

    try {
      const { keys, videoId: newVideoId } = await uploadPhotos();
      setVideoId(newVideoId);
      setUploadedKeys(keys);

      // Call the plan endpoint to get AI classifications + narrations
      const planRes = await fetch("/api/videos/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: newVideoId,
          address,
          propertyType,
          tone,
          imageKeys: keys,
          autoSort,
        }),
      });

      if (!planRes.ok) throw new Error("Failed to generate video plan");
      const plan = await planRes.json();

      if (plan.error) throw new Error(plan.error);

      // Map plan clips to review clips with preview URLs
      const clips: ReviewClip[] = plan.clips.map((clip: { imageIndex: number; imageKey: string; roomLabel: string; narration: string }) => ({
        imageIndex: clip.imageIndex,
        imageKey: clip.imageKey,
        roomLabel: clip.roomLabel,
        narration: clip.narration,
        preview: clip.imageIndex < files.length ? files[clip.imageIndex].preview : "",
      }));

      setReviewClips(clips);
      setStep("review");
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Failed to generate plan. Please try again."
      );
    } finally {
      setIsPlanning(false);
    }
  };

  // Direct generate (skip review)
  const handleGenerate = async (editedClips?: { imageIndex: number; narration: string }[]) => {
    if (!address.trim()) {
      setUploadError("Please enter the property address.");
      return;
    }
    if (files.length === 0 && !editedClips) {
      setUploadError("Please add at least one photo.");
      return;
    }

    setIsUploading(true);
    setUploadError("");
    setStep("generating");
    setProgress(5);

    try {
      let keys = uploadedKeys;
      let newVideoId = videoId;

      // If coming from review step, photos are already uploaded
      if (!keys.length) {
        setProgress(10);
        const uploaded = await uploadPhotos();
        keys = uploaded.keys;
        newVideoId = uploaded.videoId;
        setVideoId(newVideoId);
        setUploadedKeys(keys);
      }

      setProgress(20);

      // Dispatch video generation job
      const videoRes = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: newVideoId,
          address,
          propertyType,
          tone,
          voiceId,
          musicStyle,
          aspectRatios,
          imageKeys: keys,
          autoSort,
          addMusic,
          editedClips: editedClips || undefined,
        }),
      });

      if (!videoRes.ok) throw new Error("Failed to start video generation");

      setProgress(25);
      startPolling(newVideoId!);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "An error occurred. Please try again."
      );
      setStep("details");
      setIsUploading(false);
    }
  };

  // Generate from review step with edited clips
  const handleGenerateFromReview = () => {
    const edited = reviewClips.map((clip) => ({
      imageIndex: clip.imageIndex,
      narration: clip.narration,
    }));
    handleGenerate(edited);
  };

  const moveClip = (index: number, direction: "up" | "down") => {
    const newClips = [...reviewClips];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newClips.length) return;
    [newClips[index], newClips[targetIndex]] = [newClips[targetIndex], newClips[index]];
    setReviewClips(newClips);
  };

  const updateNarration = (index: number, narration: string) => {
    setReviewClips((prev) =>
      prev.map((clip, i) => (i === index ? { ...clip, narration } : clip))
    );
  };

  const startPolling = (id: string) => {
    let currentProgress = 25;

    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/videos/${id}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === "done") {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setProgress(100);
          setPipelineSteps((prev) => prev.map((s) => ({ ...s, status: "done" })));
          setStep("done");
          setIsUploading(false);
          return;
        }

        if (data.status === "error") {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setUploadError(data.errorMessage || "Video generation failed.");
          setStep("details");
          setIsUploading(false);
          return;
        }

        if (data.statusMessage) {
          const stepMap: Record<string, number> = {
            classifying: 0,
            narration: 1,
            voiceover: 2,
            rendering: 3,
            assembling: 4,
          };

          for (const [keyword, stepIdx] of Object.entries(stepMap)) {
            if (data.statusMessage.toLowerCase().includes(keyword)) {
              setPipelineSteps((prev) =>
                prev.map((s, i) => ({
                  ...s,
                  status:
                    i < stepIdx ? "done" : i === stepIdx ? "active" : "pending",
                }))
              );
              currentProgress = Math.max(currentProgress, 25 + stepIdx * 15);
              break;
            }
          }
        }

        currentProgress = Math.min(currentProgress + 1, 95);
        setProgress(currentProgress);
      } catch {
        // Ignore polling errors
      }
    }, 2000);
  };

  const getEstimatedTime = (): string => {
    const thresholds = [95, 80, 60, 40, 20, 0];
    for (const t of thresholds) {
      if (progress >= t) return ESTIMATED_TIMES[t];
    }
    return "Calculating...";
  };

  const videoUrl = videoId ? `/video/${videoId}` : null;

  useEffect(() => {
    if (step !== "done" || !videoUrl) {
      return;
    }

    const timeout = window.setTimeout(() => {
      router.push(videoUrl);
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [router, step, videoUrl]);

  // ── Generating / Done screen ──
  if (step === "generating" || step === "done") {
    return (
      <div className="p-6 md:p-12 max-w-2xl mx-auto">
        <div className="text-center mb-10">
          <div className="h-16 w-16 rounded-2xl bg-gold/10 flex items-center justify-center mx-auto mb-4">
            {step === "done" ? (
              <CheckCircle className="h-8 w-8 text-green-600" />
            ) : (
              <Film className="h-8 w-8 text-gold animate-pulse" />
            )}
          </div>
          <h1 className="font-serif text-3xl font-bold text-charcoal mb-2">
            {step === "done" ? "Your video is ready!" : "Generating your video"}
          </h1>
          <p className="text-charcoal-600">
            {step === "done"
              ? "Your listing video has been generated successfully."
              : getEstimatedTime()}
          </p>
        </div>

        {step === "generating" && (
          <>
            <Progress value={progress} className="mb-2" />
            <p className="text-right text-sm text-charcoal-600 mb-8">
              {progress}%
            </p>
          </>
        )}

        <div className="space-y-3 mb-8">
          {pipelineSteps.map((s, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 p-3 rounded-lg transition-all ${
                s.status === "active"
                  ? "bg-gold/10 border border-gold/30"
                  : s.status === "done"
                  ? "opacity-60"
                  : "opacity-40"
              }`}
            >
              <div className="flex-shrink-0">
                {s.status === "done" ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : s.status === "active" ? (
                  <Loader2 className="h-5 w-5 text-gold animate-spin" />
                ) : (
                  <div className="h-5 w-5 rounded-full border-2 border-charcoal-600/30" />
                )}
              </div>
              <span
                className={`text-sm font-medium ${
                  s.status === "active" ? "text-charcoal" : "text-charcoal-600"
                }`}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>

        {step === "generating" && (
          <p className="text-center text-sm text-charcoal-600 bg-cream-100 rounded-lg p-3">
            You can safely close this tab. Your video will keep processing in the background.
          </p>
        )}

        {step === "done" && videoId && (
          <div className="flex flex-col gap-3">
            <p className="text-center text-sm text-charcoal-600 bg-cream-100 rounded-lg p-3">
              Redirecting to your finished video...
            </p>
            <Button
              size="lg"
              className="w-full"
              onClick={() => router.push(videoUrl!)}
            >
              Watch Your Video
            </Button>
            <a
              href={videoUrl!}
              className="text-center text-sm text-charcoal-600 hover:text-charcoal underline underline-offset-4"
            >
              Open direct video link
            </a>
            <Button
              size="lg"
              variant="outline"
              className="w-full"
              onClick={() => {
                setStep("upload");
                setFiles([]);
                setAddress("");
                setProgress(0);
                setPipelineSteps(PIPELINE_STEPS);
                setVideoId(null);
                setUploadedKeys([]);
                setReviewClips([]);
              }}
            >
              Generate Another
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── Review / Edit step ──
  if (step === "review") {
    return (
      <div className="p-6 md:p-8 max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="font-serif text-2xl md:text-3xl font-bold text-charcoal mb-1">
            Review & edit your video
          </h1>
          <p className="text-charcoal-600">
            Reorder photos and edit the AI-generated narrations before rendering.
          </p>
        </div>

        <div className="space-y-4 mb-8">
          {reviewClips.map((clip, idx) => (
            <div
              key={`${clip.imageIndex}-${idx}`}
              className="flex gap-4 p-4 border border-border rounded-xl bg-white"
            >
              {/* Reorder buttons */}
              <div className="flex flex-col gap-1 justify-center">
                <button
                  onClick={() => moveClip(idx, "up")}
                  disabled={idx === 0}
                  className="p-1 rounded hover:bg-cream-100 disabled:opacity-20"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <span className="text-xs text-center text-charcoal-600 font-medium">
                  {idx + 1}
                </span>
                <button
                  onClick={() => moveClip(idx, "down")}
                  disabled={idx === reviewClips.length - 1}
                  className="p-1 rounded hover:bg-cream-100 disabled:opacity-20"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>

              {/* Photo thumbnail */}
              <div className="relative w-24 h-24 flex-shrink-0">
                {clip.preview && (
                  <Image
                    src={clip.preview}
                    alt={`Photo ${idx + 1}`}
                    fill
                    className="object-cover rounded-lg"
                  />
                )}
                <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px]">
                  {clip.roomLabel}
                </div>
              </div>

              {/* Narration editor */}
              <div className="flex-1 min-w-0">
                <Textarea
                  value={clip.narration}
                  onChange={(e) => updateNarration(idx, e.target.value)}
                  rows={3}
                  className="text-sm resize-none"
                  placeholder="Enter narration for this photo..."
                />
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            size="lg"
            onClick={() => setStep("upload")}
            className="flex-1"
          >
            Back to Edit
          </Button>
          <Button
            size="lg"
            onClick={handleGenerateFromReview}
            className="flex-[2]"
          >
            <Film className="h-5 w-5 mr-2" />
            Generate Video
          </Button>
        </div>
      </div>
    );
  }

  // ── Main form ──
  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="font-serif text-2xl md:text-3xl font-bold text-charcoal mb-1">
          Create a listing video
        </h1>
        <p className="text-charcoal-600">
          Upload your photos, enter the address, and we&apos;ll generate a professional video in minutes.
        </p>
      </div>

      {uploadError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {uploadError}
        </div>
      )}

      {/* Photo upload */}
      <section className="mb-8">
        <h2 className="font-semibold text-charcoal mb-3 flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-gold" />
          Photos
          <span className="text-charcoal-600 font-normal text-sm">
            ({files.length}/20)
          </span>
        </h2>

        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
            isDragActive
              ? "border-gold bg-gold/5"
              : "border-border hover:border-gold/50 hover:bg-cream-100"
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="h-10 w-10 text-gold/60 mx-auto mb-3" />
          <p className="font-medium text-charcoal mb-1">
            {isDragActive ? "Drop photos here" : "Drag & drop your listing photos"}
          </p>
          <p className="text-sm text-charcoal-600">
            or click to select files · JPG, PNG, WEBP, HEIC · Up to 20 photos
          </p>
        </div>

        {files.length > 0 && (
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {files.map((f, idx) => (
              <div key={f.id} className="relative group aspect-square">
                <Image
                  src={f.preview}
                  alt={`Photo ${idx + 1}`}
                  fill
                  className="object-cover rounded-lg"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors rounded-lg" />
                <button
                  onClick={() => removeFile(f.id)}
                  className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                >
                  <X className="h-3 w-3" />
                </button>
                <div className="absolute bottom-1 left-1 h-5 w-5 rounded bg-black/60 text-white text-xs flex items-center justify-center">
                  {idx + 1}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Property details */}
      <section className="mb-8">
        <h2 className="font-semibold text-charcoal mb-3 flex items-center gap-2">
          <MapPin className="h-4 w-4 text-gold" />
          Property Details
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-charcoal mb-1.5">
              Property Address <span className="text-red-500">*</span>
            </label>
            <Input
              placeholder="123 Oak Street, Austin, TX 78701"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="text-base"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-charcoal mb-1.5">
                Property Type
              </label>
              <Select value={propertyType} onValueChange={setPropertyType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Single Family", "Condo", "Townhome", "Multi-family"].map(
                    (t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-charcoal mb-1.5">
                Tone
              </label>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "Warm & Inviting",
                    "Luxury & Refined",
                    "Fast & Efficient",
                  ].map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </section>

      {/* Voice & Style */}
      <section className="mb-8">
        <h2 className="font-semibold text-charcoal mb-3 flex items-center gap-2">
          <Mic className="h-4 w-4 text-gold" />
          Voice & Style
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-charcoal mb-1.5">
              Narrator Voice
            </label>
            <Select value={voiceId} onValueChange={setVoiceId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOICE_OPTIONS.map((v) => (
                  <SelectItem key={v.value} value={v.value}>
                    {v.label}
                    <span className="text-charcoal-600 ml-1 text-xs">
                      ({v.description})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-charcoal mb-1.5">
              Music Style
            </label>
            <Select value={musicStyle} onValueChange={setMusicStyle}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MUSIC_OPTIONS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                    <span className="text-charcoal-600 ml-1 text-xs">
                      ({m.description})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {/* Aspect Ratio */}
      <section className="mb-8">
        <h2 className="font-semibold text-charcoal mb-3 flex items-center gap-2">
          <Monitor className="h-4 w-4 text-gold" />
          Aspect Ratios
          <span className="text-charcoal-600 font-normal text-sm">
            (select one or more)
          </span>
        </h2>

        <div className="grid grid-cols-3 gap-3">
          {ASPECT_RATIO_OPTIONS.map((ar) => {
            const isSelected = aspectRatios.includes(ar.value);
            return (
            <button
              key={ar.value}
              onClick={() => {
                setAspectRatios((prev) => {
                  if (prev.includes(ar.value)) {
                    // Don't allow deselecting the last one
                    if (prev.length <= 1) return prev;
                    return prev.filter((v) => v !== ar.value);
                  }
                  return [...prev, ar.value];
                });
              }}
              className={`p-3 rounded-xl border-2 text-center transition-all ${
                isSelected
                  ? "border-gold bg-gold/5"
                  : "border-border hover:border-gold/30"
              }`}
            >
              <div className="flex justify-center mb-2">
                <div
                  className={`border-2 rounded-sm ${
                    isSelected
                      ? "border-gold bg-gold/20"
                      : "border-charcoal-600/30"
                  }`}
                  style={{
                    width:
                      ar.value === "16:9"
                        ? 48
                        : ar.value === "9:16"
                        ? 27
                        : 36,
                    height:
                      ar.value === "16:9"
                        ? 27
                        : ar.value === "9:16"
                        ? 48
                        : 36,
                  }}
                />
              </div>
              <p className="text-sm font-semibold text-charcoal">{ar.label}</p>
              <p className="text-[11px] text-charcoal-600">{ar.description}</p>
            </button>
            );
          })}
        </div>
      </section>

      {/* Options */}
      <section className="mb-8">
        <h2 className="font-semibold text-charcoal mb-3 flex items-center gap-2">
          <Music className="h-4 w-4 text-gold" />
          Options
        </h2>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={autoSort}
              onChange={(e) => setAutoSort(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-gold focus:ring-gold"
            />
            <span className="text-sm text-charcoal">
              Auto-sort by room type
              <span className="text-charcoal-600 ml-1">
                (exterior → living → kitchen → beds → baths)
              </span>
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={addMusic}
              onChange={(e) => setAddMusic(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-gold focus:ring-gold"
            />
            <span className="text-sm text-charcoal">
              Add background music
            </span>
          </label>
        </div>
      </section>

      {/* Action buttons */}
      <div className="flex gap-3">
        <Button
          size="xl"
          variant="outline"
          className="flex-1"
          onClick={handlePreviewEdit}
          disabled={isUploading || isPlanning || files.length === 0 || !address.trim()}
        >
          {isPlanning ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Planning...
            </>
          ) : (
            <>
              <Pencil className="h-5 w-5 mr-2" />
              Preview & Edit
            </>
          )}
        </Button>
        <Button
          size="xl"
          className="flex-[2]"
          onClick={() => handleGenerate()}
          disabled={isUploading || isPlanning || files.length === 0 || !address.trim()}
        >
          {isUploading ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Uploading photos...
            </>
          ) : (
            <>
              <Film className="h-5 w-5 mr-2" />
              Generate Video
            </>
          )}
        </Button>
      </div>

      <p className="mt-4 text-center text-xs text-charcoal-600">
        A watermarked preview will be generated — pay $49 to unlock the clean download.
      </p>
    </div>
  );
}
