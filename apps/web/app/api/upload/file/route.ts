import { NextRequest, NextResponse } from "next/server";
import { uploadObject } from "@/lib/r2";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const key = req.nextUrl.searchParams.get("key");
    if (!key || !key.startsWith("uploads/")) {
      return NextResponse.json({ error: "Invalid upload key" }, { status: 400 });
    }

    const contentType = req.headers.get("content-type") || "application/octet-stream";
    const buffer = Buffer.from(await req.arrayBuffer());

    if (buffer.byteLength === 0) {
      return NextResponse.json({ error: "Empty upload body" }, { status: 400 });
    }

    await uploadObject(key, buffer, contentType);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[upload file]", err);
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }
}
