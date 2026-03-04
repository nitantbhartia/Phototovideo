"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
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
  GripVertical,
  MapPin,
  Music,
  LayoutGrid,
} from "lucide-react";
import Image from "next/image";

type Step = "upload" | "details" | "generating" | "done";

interface SelectedFile {
  file: File;
  preview: string;
  id: string;
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

export function GenerateClient() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [address, setAddress] = useState("");
  const [propertyType, setPropertyType] = useState("Single Family");
  const [tone, setTone] = useState("Warm & Inviting");
  const [autoSort, setAutoSort] = useState(true);
  const [addMusic, setAddMusic] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [progress, setProgress] = useState(0);
  const [pipelineSteps, setPipelineSteps] = useState(PIPELINE_STEPS);
  const [videoId, setVideoId] = useState<string | null>(null);
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

  const handleGenerate = async () => {
    if (!address.trim()) {
      setUploadError("Please enter the property address.");
      return;
    }
    if (files.length === 0) {
      setUploadError("Please add at least one photo.");
      return;
    }

    setIsUploading(true);
    setUploadError("");
    setStep("generating");
    setProgress(5);

    try {
      // Step 1: Get presigned URLs
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
      setVideoId(newVideoId);

      // Step 2: Upload through the app server to avoid browser->R2 CORS issues
      setProgress(10);
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

      if (uploadResults.some((ok) => !ok)) {
        throw new Error("Failed to upload one or more photos");
      }

      setProgress(20);

      // Step 3: Dispatch video generation job
      const videoRes = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: newVideoId,
          address,
          propertyType,
          tone,
          imageKeys: keys,
          autoSort,
          addMusic,
        }),
      });

      if (!videoRes.ok) throw new Error("Failed to start video generation");

      setProgress(25);

      // Step 4: Poll for status
      startPolling(newVideoId);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "An error occurred. Please try again."
      );
      setStep("details");
      setIsUploading(false);
    }
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

        // Update progress based on status message
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

        // Slowly advance progress
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

        {/* Pipeline steps */}
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
              }}
            >
              Generate Another
            </Button>
          </div>
        )}
      </div>
    );
  }

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
              <span className="text-charcoal-600 ml-1">(soft ambient, 8% volume)</span>
            </span>
          </label>
        </div>
      </section>

      {/* Generate button */}
      <Button
        size="xl"
        className="w-full"
        onClick={handleGenerate}
        disabled={isUploading || files.length === 0 || !address.trim()}
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

      <p className="mt-4 text-center text-xs text-charcoal-600">
        A watermarked preview will be generated — pay $49 to unlock the clean download.
      </p>
    </div>
  );
}
