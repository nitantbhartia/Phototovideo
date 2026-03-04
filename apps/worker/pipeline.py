"""
ListingReel Video Pipeline
Runs on Railway. Executes 5 sequential stages:
1. Image Classification & Sort (Claude Vision)
2. Narration Generation (Claude Vision)
3. Text-to-Speech (ElevenLabs)
4. Clip Rendering (ffmpeg Ken Burns + color grade)
5. Final Assembly (ffmpeg xfade + audio mix + subtitles)
"""

import os
import json
import base64
import logging
import subprocess
import tempfile
import shutil
from pathlib import Path
from typing import Optional

import httpx
import boto3
from anthropic import Anthropic
from elevenlabs.client import ElevenLabs
from elevenlabs import VoiceSettings
from google import genai
from google.genai import types as genai_types
from PIL import Image

from config import settings

logger = logging.getLogger(__name__)

# Room ordering for auto-sort
ROOM_ORDER = [
    "exterior",
    "entryway",
    "foyer",
    "living room",
    "family room",
    "dining room",
    "kitchen",
    "bedroom",
    "master bedroom",
    "bathroom",
    "office",
    "laundry",
    "garage",
    "backyard",
    "outdoor",
    "pool",
    "other",
]

TONE_PROMPTS = {
    "Warm & Inviting": "warm, welcoming, and homey. Use phrases that evoke comfort, family, and belonging.",
    "Luxury & Refined": "sophisticated, upscale, and refined. Use elevated language that conveys exclusivity and premium quality.",
    "Fast & Efficient": "direct, factual, and feature-focused. Highlight key features concisely without flowery language.",
}


class VideoJob:
    def __init__(self, data: dict):
        self.video_id = data["videoId"]
        self.user_id = data["userId"]
        self.address = data["address"]
        self.property_type = data.get("propertyType", "Single Family")
        self.tone = data.get("tone", "Warm & Inviting")
        self.image_keys = data["imageKeys"]
        self.auto_sort = data.get("autoSort", True)
        self.add_music = data.get("addMusic", True)


class PipelineResult:
    def __init__(self):
        self.output_r2_key: Optional[str] = None
        self.duration_seconds: Optional[int] = None
        self.error: Optional[str] = None


def report_status(video_id: str, status: str, message: str = "", **kwargs):
    """Report status back to Vercel app."""
    try:
        app_url = settings.next_app_url.strip().rstrip("/")
        payload = {
            "videoId": video_id,
            "status": status,
            "statusMessage": message,
            **kwargs,
        }
        response = httpx.post(
            f"{app_url}/api/worker/status",
            json=payload,
            headers={"x-worker-secret": settings.worker_secret},
            timeout=10,
        )
        response.raise_for_status()
    except Exception as e:
        logger.warning(f"Failed to report status: {e}")


def get_r2_client():
    account_id = settings.r2_account_id.strip()
    return boto3.client(
        "s3",
        region_name="auto",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id.strip(),
        aws_secret_access_key=settings.r2_secret_access_key.strip(),
    )


def download_image(r2_client, key: str, dest_path: str) -> bool:
    """Download image from R2 to local path."""
    try:
        r2_client.download_file(settings.r2_bucket_name, key, dest_path)
        return True
    except Exception as e:
        logger.error(f"Failed to download {key}: {e}")
        return False


def encode_image_base64(path: str) -> str:
    """Encode image to base64."""
    with open(path, "rb") as f:
        return base64.standard_b64encode(f.read()).decode("utf-8")


def get_image_media_type(path: str) -> str:
    ext = Path(path).suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".heic": "image/jpeg",  # Convert HEIC before sending
    }.get(ext, "image/jpeg")


def convert_to_jpeg(src: str, dest: str):
    """Convert any image to JPEG using PIL."""
    img = Image.open(src)
    if img.mode != "RGB":
        img = img.convert("RGB")
    img.save(dest, "JPEG", quality=92)


def extract_json_response(raw: str) -> str:
    raw = raw.strip()
    if "```" in raw:
        raw = raw.split("```")[1].replace("json", "").strip()
    return raw


def create_llm_client():
    provider = settings.llm_provider.lower()

    if provider == "anthropic":
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not configured")
        return provider, Anthropic(api_key=settings.anthropic_api_key)

    if provider == "gemini":
        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY is not configured")
        return provider, genai.Client(api_key=settings.gemini_api_key)

    raise RuntimeError(f"Unsupported LLM_PROVIDER: {settings.llm_provider}")


def generate_multimodal_json(
    provider: str,
    client,
    prompt: str,
    image_paths: list[str],
    max_tokens: int,
) -> list[dict]:
    converted_paths = []

    try:
        if provider == "anthropic":
            content = []
            for i, path in enumerate(image_paths):
                jpeg_path = path.replace(Path(path).suffix, f"_{i:03d}_conv.jpg")
                convert_to_jpeg(path, jpeg_path)
                converted_paths.append(jpeg_path)

                content.append({"type": "text", "text": f"Image {i + 1}:"})
                content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": encode_image_base64(jpeg_path),
                    },
                })

            content.append({"type": "text", "text": prompt})

            response = client.messages.create(
                model=settings.anthropic_model,
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": content}],
            )
            raw = response.content[0].text
            return json.loads(extract_json_response(raw))

        if provider == "gemini":
            parts: list[object] = []
            for i, path in enumerate(image_paths):
                jpeg_path = path.replace(Path(path).suffix, f"_{i:03d}_conv.jpg")
                convert_to_jpeg(path, jpeg_path)
                converted_paths.append(jpeg_path)

                with open(jpeg_path, "rb") as f:
                    image_bytes = f.read()

                parts.append(f"Image {i + 1}:")
                parts.append(
                    genai_types.Part.from_bytes(
                        data=image_bytes,
                        mime_type="image/jpeg",
                    )
                )

            parts.append(prompt)

            response = client.models.generate_content(
                model=settings.gemini_model,
                contents=parts,
                config={
                    "response_mime_type": "application/json",
                    "temperature": 0.1,
                    "max_output_tokens": max_tokens,
                },
            )
            return json.loads(extract_json_response(response.text))

        raise RuntimeError(f"Unsupported LLM provider: {provider}")
    finally:
        for jpeg_path in converted_paths:
            if os.path.exists(jpeg_path):
                os.unlink(jpeg_path)


# ─────────────────────────────────────────────
# Stage 1: Image Classification & Sort
# ─────────────────────────────────────────────

def classify_and_sort_images(
    provider: str,
    client,
    image_paths: list[str],
    address: str,
    property_type: str,
    auto_sort: bool = True,
) -> list[dict]:
    """
    Use Claude Vision to classify each image by room type.
    Returns ordered list: [{path, room_label, order_index}]
    """
    action = "classifying and sorting" if auto_sort else "classifying"
    logger.info(f"{action.capitalize()} {len(image_paths)} images...")

    sort_instruction = (
        "Sort the results so they appear in optimal video order: exterior first, then "
        "interior rooms (living → dining → kitchen → bedrooms → bathrooms), then "
        "outdoor/backyard last."
        if auto_sort
        else "Keep the results in the exact same order as the input images."
    )

    prompt = f"""You are analyzing {len(image_paths)} photos from a real estate listing at {address} ({property_type}).

For each image (numbered 1-{len(image_paths)}), identify the room or area shown.
Use one of these labels: exterior, entryway, foyer, living room, family room, dining room, kitchen, bedroom, master bedroom, bathroom, office, laundry, garage, backyard, outdoor, pool, other.

Return a JSON array with exactly {len(image_paths)} objects in this format:
[{{"image_index": 1, "room_label": "exterior", "confidence": 0.95}}, ...]

{sort_instruction}
Return ONLY the JSON array, no other text."""

    classifications = generate_multimodal_json(
        provider=provider,
        client=client,
        prompt=prompt,
        image_paths=image_paths,
        max_tokens=1024,
    )

    # Sort by room order
    def room_sort_key(item):
        label = item["room_label"].lower()
        for i, room in enumerate(ROOM_ORDER):
            if room in label or label in room:
                return i
        return len(ROOM_ORDER)

    if auto_sort:
        classifications.sort(key=room_sort_key)
    else:
        classifications.sort(key=lambda item: item["image_index"])

    # Map back to file paths
    result = []
    for item in classifications:
        idx = item["image_index"] - 1
        if 0 <= idx < len(image_paths):
            result.append({
                "path": image_paths[idx],
                "room_label": item["room_label"],
                "order_index": len(result),
            })

    return result


# ─────────────────────────────────────────────
# Stage 2: Narration Generation
# ─────────────────────────────────────────────

def generate_narrations(
    provider: str,
    client,
    clips: list[dict],
    address: str,
    property_type: str,
    tone: str,
) -> list[dict]:
    """Generate 1-3 sentence narration for each clip."""
    logger.info(f"Generating narrations for {len(clips)} clips...")

    tone_desc = TONE_PROMPTS.get(tone, TONE_PROMPTS["Warm & Inviting"])

    prompt = f"""Write professional real estate narration for a listing video of {address} ({property_type}).

Tone: {tone_desc}

Rules:
- Image 1 MUST open with: "Welcome to [address]" then describe the first room
- Last image MUST end with a call to action: "Schedule your showing today" or similar
- Each narration is 1-3 sentences (max 35 words)
- Be specific about what you see — mention materials, colors, architectural details
- Never use generic filler phrases like "beautiful home" or "must-see property"
- Keep total narration under 1,000 characters

Return a JSON array with exactly {len(clips)} objects:
[{{"image_index": 1, "narration": "Welcome to 123 Oak Street..."}}]

Return ONLY the JSON array."""

    narrations = generate_multimodal_json(
        provider=provider,
        client=client,
        prompt=prompt,
        image_paths=[clip["path"] for clip in clips],
        max_tokens=2048,
    )
    narration_map = {item["image_index"]: item["narration"] for item in narrations}

    for i, clip in enumerate(clips):
        clip["narration"] = narration_map.get(i + 1, f"Welcome to this {clip['room_label']}.")

    return clips


# ─────────────────────────────────────────────
# Stage 3: Text-to-Speech
# ─────────────────────────────────────────────

def generate_audio(
    eleven: ElevenLabs,
    clips: list[dict],
    work_dir: str,
) -> list[dict]:
    """Generate MP3 audio for each narration using ElevenLabs."""
    logger.info("Generating voiceover audio...")

    for i, clip in enumerate(clips):
        audio_path = os.path.join(work_dir, f"audio_{i:03d}.mp3")

        audio_bytes = eleven.generate(
            text=clip["narration"],
            voice=settings.elevenlabs_voice_id,
            model="eleven_turbo_v2_5",
            voice_settings=VoiceSettings(
                stability=0.5,
                similarity_boost=0.75,
                style=0.0,
                use_speaker_boost=True,
            ),
        )

        with open(audio_path, "wb") as f:
            for chunk in audio_bytes:
                f.write(chunk)

        # Get audio duration using ffprobe
        duration_ms = get_audio_duration_ms(audio_path)
        clip["audio_path"] = audio_path
        clip["audio_duration_ms"] = duration_ms
        clip["speech_start"] = settings.narration_lead_in
        clip["speech_end"] = settings.narration_lead_in + duration_ms / 1000
        clip["clip_duration"] = max(
            settings.clip_min_duration,
            min(
                settings.clip_max_duration,
                settings.narration_lead_in + duration_ms / 1000 + settings.narration_lead_out,
            ),
        )

    return clips


def get_audio_duration_ms(audio_path: str) -> int:
    """Get audio duration in milliseconds using ffprobe."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            audio_path,
        ],
        capture_output=True,
        text=True,
    )
    data = json.loads(result.stdout)
    duration = float(data["format"]["duration"])
    return int(duration * 1000)


# ─────────────────────────────────────────────
# Stage 4: Clip Rendering
# ─────────────────────────────────────────────

def render_clip(
    image_path: str,
    audio_path: str,
    clip_duration: float,
    output_path: str,
    zoom_direction: str = "in",
    width: int = 1920,
    height: int = 1080,
    fps: int = 24,
):
    """
    Render a single clip with Ken Burns effect, color grade, and audio.
    zoom_direction: "in" (slow zoom in) or "out" (slow zoom out)
    """
    # Stable overscan pan. Avoid zoompan because it creates visible jitter.
    travel_x = "40"
    travel_y = "18"
    overscan = "1.12"

    if zoom_direction == "in":
        x_expr = f"-(t/{clip_duration:.3f})*{travel_x}"
        y_expr = f"-(t/{clip_duration:.3f})*{travel_y}"
    else:
        x_expr = f"-{travel_x}+((t/{clip_duration:.3f})*{travel_x})"
        y_expr = f"-{travel_y}+((t/{clip_duration:.3f})*{travel_y})"

    motion_filter = (
        f"scale={width}*{overscan}:{height}*{overscan},"
        f"crop={width}:{height}:x='{x_expr}':y='{y_expr}',"
        f"fps={fps},trim=duration={clip_duration:.3f}"
    )

    # Color grading: warm curves + slight brightness + vignette
    color_filter = (
        "curves=r='0/0 0.5/0.56 1/1':g='0/0 0.5/0.5 1/1':b='0/0 0.5/0.44 1/0.95',"
        "eq=brightness=0.02:contrast=1.05:saturation=1.1,"
        "vignette=PI/4"
    )

    # Full video filter chain
    video_filter = f"{motion_filter},{color_filter}"

    cmd = [
        "ffmpeg", "-y",
        "-loop", "1",
        "-i", image_path,
        "-i", audio_path,
        "-filter_complex", video_filter,
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", str(settings.video_crf),
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-ar", "44100",
        "-shortest",
        "-movflags", "+faststart",
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg clip render failed: {result.stderr[-500:]}")


def render_all_clips(clips: list[dict], work_dir: str) -> list[dict]:
    """Render all clips with alternating zoom direction."""
    logger.info(f"Rendering {len(clips)} video clips...")

    for i, clip in enumerate(clips):
        clip_path = os.path.join(work_dir, f"clip_{i:03d}.mp4")
        zoom_dir = "in" if i % 2 == 0 else "out"

        render_clip(
            image_path=clip["path"],
            audio_path=clip["audio_path"],
            clip_duration=clip["clip_duration"],
            output_path=clip_path,
            zoom_direction=zoom_dir,
            width=settings.video_width,
            height=settings.video_height,
            fps=settings.video_fps,
        )

        clip["clip_path"] = clip_path

    return clips


# ─────────────────────────────────────────────
# Stage 5: Final Assembly
# ─────────────────────────────────────────────

def create_srt_file(clips: list[dict], srt_path: str):
    """Generate SRT subtitle file from narrations."""
    with open(srt_path, "w", encoding="utf-8") as f:
        current_time = 0.0
        for i, clip in enumerate(clips):
            start = current_time + clip.get("speech_start", 0.0)
            end = current_time + min(clip["clip_duration"], clip.get("speech_end", clip["clip_duration"]))

            def fmt_time(t):
                h = int(t // 3600)
                m = int((t % 3600) // 60)
                s = int(t % 60)
                ms = int((t % 1) * 1000)
                return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

            f.write(f"{i + 1}\n")
            f.write(f"{fmt_time(start)} --> {fmt_time(end)}\n")
            f.write(f"{clip['narration']}\n\n")

            current_time = current_time + clip["clip_duration"] - settings.xfade_duration


def assemble_final_video(
    clips: list[dict],
    work_dir: str,
    output_path: str,
    add_music: bool = True,
    watermark: bool = True,
):
    """
    Assemble all clips into final MP4 with:
    - xfade cross-dissolve transitions
    - Background music mix
    - Subtitle burn-in
    - Watermark (if enabled)
    - Web-optimized with faststart
    """
    logger.info("Assembling final video...")

    # Add subtitles for every final output, including single-image jobs.
    srt_path = os.path.join(work_dir, "subtitles.srt")
    create_srt_file(clips, srt_path)

    subtitle_filter = (
        f"subtitles={srt_path}:force_style="
        f"'FontName=Arial,FontSize={settings.subtitle_font_size},PrimaryColour=&H00FFFFFF,"
        f"OutlineColour=&H26000000,BackColour=&H40000000,"
        f"BorderStyle=3,Outline=1,Shadow=0,MarginV={settings.subtitle_margin_v},Alignment=2'"
    )

    watermark_filter = (
        "drawtext=text='ListingReel Preview':fontcolor=white@0.4:"
        "fontsize=24:x=w-tw-20:y=h-th-20:font=Arial"
    )

    music_file = os.path.join(os.path.dirname(__file__), "assets", "background.mp3")
    has_music_file = add_music and os.path.exists(music_file)

    if len(clips) == 1:
        filter_parts = [f"[0:v]{subtitle_filter}[vsub]"]
        final_v = "vsub"
        final_a = "0:a"

        if watermark:
            filter_parts.append(f"[{final_v}]{watermark_filter}[vfinal]")
            final_v = "vfinal"

        inputs = ["-i", clips[0]["clip_path"]]
        if has_music_file:
            inputs.extend(["-i", music_file])
            filter_parts.append(
                f"[1:a]volume={settings.background_music_volume}[music]"
            )
            filter_parts.append(
                f"[0:a][music]amix=inputs=2:duration=first[afinal]"
            )
            final_a = "[afinal]"

        cmd = (
            ["ffmpeg", "-y"]
            + inputs
            + [
                "-filter_complex", ";".join(filter_parts),
                "-map", f"[{final_v}]",
                "-map", final_a,
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", str(settings.video_crf),
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "192k",
                "-ar", "44100",
                "-movflags", "+faststart",
                output_path,
            ]
        )

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg assembly failed: {result.stderr[-1000:]}")
        return

    # Build xfade filter chain
    # For N clips: N-1 xfade transitions
    n = len(clips)
    inputs = []
    for clip in clips:
        inputs.extend(["-i", clip["clip_path"]])

    # Calculate offsets for xfade
    offsets = []
    cumulative = 0.0
    for i in range(n - 1):
        cumulative += clips[i]["clip_duration"] - settings.xfade_duration
        offsets.append(cumulative)

    # Build filter_complex for xfade chain
    filter_parts = []

    # First xfade
    filter_parts.append(
        f"[0:v][1:v]xfade=transition=fade:duration={settings.xfade_duration}:offset={offsets[0]:.3f}[v01]"
    )
    filter_parts.append(
        f"[0:a][1:a]acrossfade=d={settings.xfade_duration}[a01]"
    )

    for i in range(2, n):
        prev_v = f"v{(i-1):02d}{i:d}" if i == 2 else f"v{i-1}"
        prev_a = f"a{(i-1):02d}{i:d}" if i == 2 else f"a{i-1}"
        curr_v = f"v{i}" if i < n - 1 else "vout"
        curr_a = f"a{i}" if i < n - 1 else "aout"

        if i == 2:
            prev_v = "v01"
            prev_a = "a01"

        filter_parts.append(
            f"[{prev_v}][{i}:v]xfade=transition=fade:duration={settings.xfade_duration}:offset={offsets[i-1]:.3f}[{curr_v}]"
        )
        filter_parts.append(
            f"[{prev_a}][{i}:a]acrossfade=d={settings.xfade_duration}[{curr_a}]"
        )

    if n == 2:
        final_v = "v01"
        final_a = "a01"
    else:
        final_v = "vout"
        final_a = "aout"

    filter_parts.append(f"[{final_v}]{subtitle_filter}[vsub]")
    final_v = "vsub"

    # Watermark filter
    if watermark:
        filter_parts.append(f"[{final_v}]{watermark_filter}[vfinal]")
        final_v = "vfinal"

    filter_complex = ";".join(filter_parts)

    # Music mix
    if add_music:
        music_args = []
        if has_music_file:
            music_args = ["-i", music_file]
            music_idx = n
            filter_complex += (
                f";[{music_idx}:a]volume={settings.background_music_volume}[music]"
                f";[{final_a}][music]amix=inputs=2:duration=first[afinal]"
            )
            final_a = "afinal"
        cmd = (
            ["ffmpeg", "-y"]
            + inputs
            + music_args
            + [
                "-filter_complex", filter_complex,
                "-map", f"[{final_v}]",
                "-map", f"[{final_a}]",
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", str(settings.video_crf),
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "192k",
                "-ar", "44100",
                "-movflags", "+faststart",
                output_path,
            ]
        )
    else:
        cmd = (
            ["ffmpeg", "-y"]
            + inputs
            + [
                "-filter_complex", filter_complex,
                "-map", f"[{final_v}]",
                "-map", f"[{final_a}]",
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", str(settings.video_crf),
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "192k",
                "-ar", "44100",
                "-movflags", "+faststart",
                output_path,
            ]
        )

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg assembly failed: {result.stderr[-1000:]}")


def get_video_duration(video_path: str) -> int:
    """Get video duration in seconds."""
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", video_path],
        capture_output=True,
        text=True,
    )
    data = json.loads(result.stdout)
    return int(float(data["format"]["duration"]))


# ─────────────────────────────────────────────
# Main Pipeline Orchestrator
# ─────────────────────────────────────────────

def run_pipeline(job: VideoJob) -> PipelineResult:
    result = PipelineResult()
    work_dir = tempfile.mkdtemp(prefix=f"listingreel_{job.video_id}_")

    try:
        llm_provider, llm_client = create_llm_client()
        eleven = ElevenLabs(api_key=settings.elevenlabs_api_key)
        r2 = get_r2_client()

        # ── Stage 1: Download images
        stage_message = (
            "Classifying & sorting rooms" if job.auto_sort else "Classifying rooms"
        )
        report_status(job.video_id, "processing", stage_message)
        logger.info(f"Downloading {len(job.image_keys)} images...")

        image_paths = []
        for i, key in enumerate(job.image_keys):
            ext = Path(key).suffix or ".jpg"
            local_path = os.path.join(work_dir, f"img_{i:03d}{ext}")
            if download_image(r2, key, local_path):
                image_paths.append(local_path)

        if not image_paths:
            raise RuntimeError("No images could be downloaded")

        # ── Stage 1: Classify and sort
        clips = classify_and_sort_images(
            llm_provider, llm_client, image_paths, job.address, job.property_type, job.auto_sort
        )

        # ── Stage 2: Generate narrations
        report_status(job.video_id, "processing", "Writing narrations")
        clips = generate_narrations(
            llm_provider, llm_client, clips, job.address, job.property_type, job.tone
        )

        # ── Stage 3: TTS
        report_status(job.video_id, "processing", "Recording voiceover")
        clips = generate_audio(eleven, clips, work_dir)

        # ── Stage 4: Render clips
        report_status(job.video_id, "processing", "Rendering video clips")
        clips = render_all_clips(clips, work_dir)

        # ── Stage 5: Assemble
        report_status(job.video_id, "processing", "Assembling final video")
        output_path = os.path.join(work_dir, "output.mp4")
        assemble_final_video(
            clips=clips,
            work_dir=work_dir,
            output_path=output_path,
            add_music=job.add_music,
            watermark=True,  # Always watermark — remove on payment
        )

        # Upload to R2
        r2_key = f"videos/{job.user_id}/{job.video_id}/output.mp4"
        logger.info(f"Uploading output to R2: {r2_key}")
        r2.upload_file(
            output_path,
            settings.r2_bucket_name,
            r2_key,
            ExtraArgs={"ContentType": "video/mp4"},
        )

        duration = get_video_duration(output_path)
        result.output_r2_key = r2_key
        result.duration_seconds = duration

        # Generate 3-second animated GIF thumbnail for email
        gif_r2_key = None
        try:
            gif_path = os.path.join(work_dir, "thumbnail.gif")
            gif_result = subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-t", "3",
                    "-i", output_path,
                    "-filter_complex",
                    "fps=10,scale=640:-1:flags=lanczos,split[v1][v2];[v1]palettegen[p];[v2][p]paletteuse",
                    gif_path,
                ],
                capture_output=True,
                text=True,
            )
            if gif_result.returncode == 0 and os.path.exists(gif_path):
                gif_r2_key = f"videos/{job.user_id}/{job.video_id}/thumbnail.gif"
                r2.upload_file(
                    gif_path,
                    settings.r2_bucket_name,
                    gif_r2_key,
                    ExtraArgs={"ContentType": "image/gif"},
                )
                logger.info(f"Thumbnail GIF uploaded: {gif_r2_key}")
        except Exception as e:
            logger.warning(f"GIF thumbnail generation failed (non-fatal): {e}")

        report_status(
            job.video_id,
            "done",
            "Video ready",
            r2Key=r2_key,
            durationSeconds=duration,
            thumbnailGifKey=gif_r2_key,
        )

        return result

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Pipeline failed for {job.video_id}: {error_msg}", exc_info=True)
        result.error = error_msg
        report_status(job.video_id, "error", "Generation failed", errorMessage=error_msg)
        return result

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
