import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateShareId(): string {
  // Generate a 10-char alphanumeric share ID
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function getVideoStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "Queued",
    processing: "Processing",
    done: "Ready",
    error: "Error",
  };
  return labels[status] || status;
}

export function getVideoStatusColor(status: string): string {
  const colors: Record<string, string> = {
    queued: "text-amber-600 bg-amber-50",
    processing: "text-blue-600 bg-blue-50",
    done: "text-green-600 bg-green-50",
    error: "text-red-600 bg-red-50",
  };
  return colors[status] || "text-gray-600 bg-gray-50";
}

export function absoluteUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL}${path}`;
}
