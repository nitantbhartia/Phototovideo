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

# Motion style per room type — matches camera movement to the space.
# push_in:   slow zoom toward a focal point (detail rooms, features)
# pull_back:  zoom out to reveal the full space (large rooms)
# pan_right:  horizontal sweep L→R (wide/exterior shots)
# pan_left:   horizontal sweep R→L (variety for dining/secondary rooms)
# tilt_up:    vertical sweep upward (tall ceilings, entryways)
ROOM_MOTION = {
    "exterior": "pan_right",
    "entryway": "tilt_up",
    "foyer": "tilt_up",
    "living room": "pull_back",
    "family room": "pull_back",
    "dining room": "pan_left",
    "kitchen": "push_in",
    "bedroom": "pull_back",
    "master bedroom": "pull_back",
    "bathroom": "push_in",
    "office": "push_in",
    "laundry": "push_in",
    "garage": "pan_right",
    "backyard": "pan_right",
    "outdoor": "pan_right",
    "pool": "pan_right",
    "other": "push_in",
}

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
            model=settings.elevenlabs_model,
            voice_settings=VoiceSettings(
                stability=0.65,
                similarity_boost=0.80,
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
    motion: str = "push_in",
    width: int = 1920,
    height: int = 1080,
    fps: int = 24,
):
    """
    Render a single clip with Ken Burns effect, color grade, and audio.
    Uses ffmpeg zoompan filter for smooth sub-pixel animation.

    motion styles:
      push_in   – zoom 1.00→1.15, centered (detail rooms)
      pull_back – zoom 1.15→1.00, centered (reveal large spaces)
      pan_right – steady z=1.10, horizontal sweep L→R (exteriors)
      pan_left  – steady z=1.10, horizontal sweep R→L (variety)
      tilt_up   – steady z=1.10, vertical sweep bottom→top (tall rooms)
    """
    total_frames = max(int(clip_duration * fps), 1)
    fd = max(total_frames - 1, 1)  # frame denominator for 0→1 progress

    # Pre-scale to 2× output so zoompan never upscales (important for
    # lower-res sources like Zillow ~1024 px).
    pre_w = width * 2
    pre_h = height * 2
    prescale_filter = (
        f"scale={pre_w}:{pre_h}"
        f":force_original_aspect_ratio=increase:flags=lanczos,"
        f"crop={pre_w}:{pre_h},setsar=1"
    )

    # Build zoompan expressions based on motion style.
    # pan range = iw - iw/z; at z=1.10 that's ~9% of iw (~346 px on 3840).
    # At z=1.15 it's ~13% (~500 px). Both give >1 px/frame = smooth.
    if motion == "push_in":
        z_expr = f"1+0.15*(on/{fd})"
        x_expr = f"(iw-iw/zoom)/2"
        y_expr = f"(ih-ih/zoom)/2"
    elif motion == "pull_back":
        z_expr = f"1.15-0.15*(on/{fd})"
        x_expr = f"(iw-iw/zoom)/2"
        y_expr = f"(ih-ih/zoom)/2"
    elif motion == "pan_right":
        z_expr = "1.10"
        x_expr = f"(iw-iw/zoom)*(0.05+0.90*(on/{fd}))"
        y_expr = f"(ih-ih/zoom)/2"
    elif motion == "pan_left":
        z_expr = "1.10"
        x_expr = f"(iw-iw/zoom)*(0.95-0.90*(on/{fd}))"
        y_expr = f"(ih-ih/zoom)/2"
    elif motion == "tilt_up":
        z_expr = "1.10"
        x_expr = f"(iw-iw/zoom)/2"
        y_expr = f"(ih-ih/zoom)*(0.85-0.70*(on/{fd}))"
    else:
        # Fallback: push_in
        z_expr = f"1+0.15*(on/{fd})"
        x_expr = f"(iw-iw/zoom)/2"
        y_expr = f"(ih-ih/zoom)/2"

    zoompan_filter = (
        f"zoompan=z='{z_expr}':x='{x_expr}':y='{y_expr}'"
        f":d={total_frames}:s={width}x{height}:fps={fps}"
        f":filter_algo=bicubic"
    )

    # Cinematic colour grade: warm highlights, lifted blacks, gentle saturation.
    # colorlevels lifts the black point to 5% and rolls off whites to 95%
    # for a filmic look. colorbalance pushes highlights warm (slight
    # red/yellow shift). eq adds saturation and a touch of contrast.
    color_filter = (
        "colorlevels=rimin=0.05:gimin=0.05:bimin=0.05"
        ":rimax=0.95:gimax=0.95:bimax=0.95,"
        "colorbalance=rh=0.03:gh=0.01:bh=-0.02,"
        "eq=saturation=1.08:contrast=1.02"
    )

    # Subtle vignette — darkens edges to draw the eye inward
    vignette_filter = "vignette=PI/5"

    # Fade in/out for smooth visual transitions between clips
    fade_dur = 0.5
    fade_out_start = max(clip_duration - fade_dur, 0)
    fade_filter = (
        f"fade=t=in:st=0:d={fade_dur},"
        f"fade=t=out:st={fade_out_start:.3f}:d={fade_dur}"
    )

    video_filter = f"{prescale_filter},{zoompan_filter},{color_filter},{vignette_filter},{fade_filter}"
    audio_delay_ms = int(settings.narration_lead_in * 1000)
    audio_filter = (
        f"adelay={audio_delay_ms}|{audio_delay_ms},"
        f"apad=pad_dur={clip_duration:.3f},"
        f"atrim=duration={clip_duration:.3f}"
    )

    # Use near-lossless CRF 8 for intermediate clips — the final assembly
    # re-encodes at the target CRF so encoding twice at CRF 18 was causing
    # visible quality loss compared to the source photos.
    cmd = [
        "ffmpeg", "-y",
        "-i", image_path,
        "-i", audio_path,
        "-filter_complex", f"[0:v]{video_filter}[v];[1:a]{audio_filter}[a]",
        "-map", "[v]",
        "-map", "[a]",
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "8",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-ar", "44100",
        "-t", f"{clip_duration:.3f}",
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg clip render failed: {result.stderr[-500:]}")


def motion_for_room(room_label: str, clip_index: int) -> str:
    """Pick a motion style based on room type, with variety for consecutive same-type rooms."""
    label = room_label.lower()
    # Try exact match first, then substring match
    motion = ROOM_MOTION.get(label)
    if not motion:
        for key, value in ROOM_MOTION.items():
            if key in label or label in key:
                motion = value
                break
    if not motion:
        motion = "push_in"
    # Avoid identical motion on consecutive clips — flip between two
    # complementary styles when the same motion would repeat.
    alternates = {
        "push_in": "pull_back",
        "pull_back": "push_in",
        "pan_right": "pan_left",
        "pan_left": "pan_right",
        "tilt_up": "push_in",
    }
    if clip_index % 2 == 1 and motion in alternates:
        motion = alternates[motion]
    return motion


def render_all_clips(clips: list[dict], work_dir: str) -> list[dict]:
    """Render all clips with room-aware motion styles."""
    logger.info(f"Rendering {len(clips)} video clips...")

    for i, clip in enumerate(clips):
        clip_path = os.path.join(work_dir, f"clip_{i:03d}.mp4")
        motion = motion_for_room(clip.get("room_label", "other"), i)

        render_clip(
            image_path=clip["path"],
            audio_path=clip["audio_path"],
            clip_duration=clip["clip_duration"],
            output_path=clip_path,
            motion=motion,
            width=settings.video_width,
            height=settings.video_height,
            fps=settings.video_fps,
        )

        clip["clip_path"] = clip_path

    return clips


# ─────────────────────────────────────────────
# Stage 5: Final Assembly
# ─────────────────────────────────────────────

def create_ass_file(clips: list[dict], ass_path: str, width: int = 1920, height: int = 1080):
    """Generate ASS subtitle file with PlayRes matching video so FontSize is literal pixels."""

    def fmt_ass(t: float) -> str:
        h = int(t // 3600)
        m = int((t % 3600) // 60)
        s = int(t % 60)
        cs = int((t % 1) * 100)
        return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(f"[Script Info]\nScriptType: v4.00+\nPlayResX: {width}\nPlayResY: {height}\n\n")
        f.write("[V4+ Styles]\n")
        f.write(
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
            "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
            "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
            "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        )
        # Alignment=2 = bottom-center; BorderStyle=1 = outline+shadow (not opaque box)
        fs = settings.subtitle_font_size
        mv = settings.subtitle_margin_v
        f.write(
            f"Style: Default,Arial,{fs},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
            f"0,0,0,0,100,100,0,0,1,3,1,2,30,30,{mv},1\n\n"
        )
        f.write("[Events]\n")
        f.write("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")

        current_time = 0.0
        for clip in clips:
            start = current_time + clip.get("speech_start", 0.0)
            end = current_time + min(clip["clip_duration"], clip.get("speech_end", clip["clip_duration"]))
            text = clip["narration"].replace("\n", "\\N")
            f.write(f"Dialogue: 0,{fmt_ass(start)},{fmt_ass(end)},Default,,0,0,0,,{text}\n")
            current_time += clip["clip_duration"]


def ensure_background_music(track_duration: float, work_dir: str) -> str | None:
    """Return a music track path, generating a soft ambient bed if no asset exists."""
    bundled_music = os.path.join(os.path.dirname(__file__), "assets", "background.mp3")
    if os.path.exists(bundled_music):
        return bundled_music

    generated_music = os.path.join(work_dir, "background-bed.wav")
    fade_duration = min(2.0, max(track_duration / 4, 1.0))
    fade_out_start = max(track_duration - fade_duration, 0)

    # Ambient pad: A-minor chord with harmonics at audible amplitude.
    # Previous amplitudes (0.020/0.012/0.010) were ~50 dB below speech
    # and completely inaudible after volume + amix reduction.
    synth_expr = (
        "aevalsrc="
        "0.18*sin(2*PI*110*t)+"
        "0.12*sin(2*PI*220*t)+"
        "0.10*sin(2*PI*261.63*t)+"
        "0.08*sin(2*PI*329.63*t)+"
        "0.04*sin(2*PI*440*t)|"
        "0.18*sin(2*PI*110*t)+"
        "0.12*sin(2*PI*220*t)+"
        "0.10*sin(2*PI*261.63*t)+"
        "0.08*sin(2*PI*329.63*t)+"
        f"0.04*sin(2*PI*440*t):s=44100:d={track_duration:.3f}"
    )

    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", synth_expr,
        "-af",
        f"lowpass=f=800,highpass=f=60,"
        f"afade=t=in:st=0:d={fade_duration:.3f},"
        f"afade=t=out:st={fade_out_start:.3f}:d={fade_duration:.3f}",
        generated_music,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.warning(f"Background music generation failed: {result.stderr[-500:]}")
        return None

    return generated_music


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
    ass_path = os.path.join(work_dir, "subtitles.ass")
    create_ass_file(clips, ass_path, settings.video_width, settings.video_height)
    subtitle_filter = f"subtitles={ass_path}"

    watermark_filter = (
        "drawtext=text='ListingReel Preview':fontcolor=white@0.4:"
        "fontsize=24:x=w-tw-20:y=h-th-20:font=Arial"
    )

    total_duration = sum(clip["clip_duration"] for clip in clips)
    music_file = ensure_background_music(total_duration, work_dir) if add_music else None
    has_music_file = bool(music_file)

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
                f"[0:a][music]amix=inputs=2:duration=first:normalize=0[afinal]"
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

    # Build hard-cut concat chain. This avoids overlapping captions and speech.
    n = len(clips)
    inputs = []
    for clip in clips:
        inputs.extend(["-i", clip["clip_path"]])

    filter_parts = []
    audio_inputs = "".join(f"[{i}:a]" for i in range(n))
    video_inputs = "".join(f"[{i}:v]" for i in range(n))
    filter_parts.append(f"{video_inputs}concat=n={n}:v=1:a=0[vcat]")
    filter_parts.append(f"[vcat]{subtitle_filter}[vsub]")
    final_v = "vsub"
    filter_parts.append(f"{audio_inputs}concat=n={n}:v=0:a=1[aout]")
    final_a = "aout"

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
                f";[{final_a}][music]amix=inputs=2:duration=first:normalize=0[afinal]"
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
