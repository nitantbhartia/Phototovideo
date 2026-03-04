"""
ListingReel Video Pipeline
Runs on Railway. Executes 5 sequential stages:
1. Image Classification & Sort (Claude Vision)
2. Narration Generation (Claude Vision)
3. Text-to-Speech (ElevenLabs or OpenAI)
4. Clip Rendering (ffmpeg Ken Burns + color grade)
5. Final Assembly (ffmpeg xfade + audio mix + subtitles)
"""

import os
import re
import json
import base64
import logging
import subprocess
import tempfile
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

import httpx
import boto3
from anthropic import Anthropic
from elevenlabs.client import ElevenLabs
from elevenlabs import VoiceSettings
from openai import OpenAI
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


# Voice presets — map friendly names to ElevenLabs voice IDs
VOICE_PRESETS = {
    "rachel": {"id": "21m00Tcm4TlvDq8ikWAM", "label": "Rachel (warm, female)"},
    "josh": {"id": "TxGEqnHWrfWFTfGW9XjX", "label": "Josh (deep, male)"},
    "bella": {"id": "EXAVITQu4vr4xnSDxMaL", "label": "Bella (soft, female)"},
    "antoni": {"id": "ErXwobaYiN019PkySvjV", "label": "Antoni (warm, male)"},
}

# OpenAI TTS voice mapping — map our preset names to OpenAI voices
OPENAI_VOICE_MAP = {
    "rachel": "coral",    # warm female
    "josh": "echo",       # deep male
    "bella": "shimmer",   # soft female
    "antoni": "onyx",     # warm male
}

# OpenAI TTS voice instructions per tone — tells the model *how* to speak
OPENAI_VOICE_INSTRUCTIONS = {
    "Warm & Inviting": (
        "Speak warmly and naturally, like a friendly real estate agent giving a private tour. "
        "Use a conversational pace with genuine enthusiasm. Pause briefly between sentences. "
        "Sound welcoming, as if inviting a friend into a home you love."
    ),
    "Luxury & Refined": (
        "Speak with polished sophistication, like a high-end real estate narrator for a luxury brand. "
        "Use a measured, elegant pace. Let each word land with precision. "
        "Sound confident and refined, evoking exclusivity and quality."
    ),
    "Fast & Efficient": (
        "Speak clearly and efficiently, like a professional real estate agent highlighting key features. "
        "Maintain a brisk but clear pace. Be direct and informative. "
        "Sound confident and knowledgeable without being rushed."
    ),
}

# Aspect ratio presets — dimensions and subtitle positioning
ASPECT_RATIOS = {
    "16:9": {"width": 1920, "height": 1080, "subtitle_margin_v": 60},
    "9:16": {"width": 1080, "height": 1920, "subtitle_margin_v": 140},
    "1:1": {"width": 1080, "height": 1080, "subtitle_margin_v": 80},
}


class VideoJob:
    def __init__(self, data: dict):
        self.video_id = data["videoId"]
        self.user_id = data["userId"]
        self.address = data["address"]
        self.property_type = data.get("propertyType", "Single Family")
        self.tone = data.get("tone", "Warm & Inviting")
        self.voice_id = data.get("voiceId", "rachel")
        self.music_style = data.get("musicStyle", "ambient")
        self.aspect_ratios = data.get("aspectRatios", ["16:9"])
        self.image_keys = data["imageKeys"]
        self.auto_sort = data.get("autoSort", True)
        self.add_music = data.get("addMusic", True)
        self.video_quality = data.get("videoQuality", "standard")  # "ai" or "standard"
        self.edited_clips = data.get("editedClips", None)


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
# Stages 1+2: Combined Classification & Narration
# ─────────────────────────────────────────────

def classify_and_narrate(
    provider: str,
    client,
    image_paths: list[str],
    address: str,
    property_type: str,
    tone: str,
    auto_sort: bool = True,
) -> list[dict]:
    """
    Single LLM call that classifies rooms AND writes narrations.
    Halves API cost and latency vs two separate calls.
    Returns ordered list: [{path, room_label, order_index, narration}]
    """
    n = len(image_paths)
    action = "classifying, sorting, and narrating" if auto_sort else "classifying and narrating"
    logger.info(f"{action.capitalize()} {n} images in a single LLM call...")

    tone_desc = TONE_PROMPTS.get(tone, TONE_PROMPTS["Warm & Inviting"])

    sort_instruction = (
        "Sort the results so they appear in optimal video order: exterior first, then "
        "interior rooms (living → dining → kitchen → bedrooms → bathrooms), then "
        "outdoor/backyard last."
        if auto_sort
        else "Keep the results in the exact same order as the input images."
    )

    prompt = f"""You are creating a real estate listing video for {address} ({property_type}).
Analyze these {n} photos and do TWO things for each:

1. **Classify** the room/area shown. Use one of: exterior, entryway, foyer, living room, family room, dining room, kitchen, bedroom, master bedroom, bathroom, office, laundry, garage, backyard, outdoor, pool, other.

2. **Write narration** for each scene as part of one continuous video walkthrough.

Narration tone: {tone_desc}

Narration rules:
- Scene 1 MUST open with: "Welcome to [address]" then describe what you see
- Last scene MUST close with a call to action like "Schedule your private showing today"
- Each scene is 1-2 sentences (max 30 words per scene)
- Use natural transitions: "Stepping inside...", "Just down the hall...", "Moving through to...", "Out back...", etc.
- Be specific — mention materials, colors, finishes, architectural details you see
- Never use generic filler like "beautiful home" or "stunning property"
- Sound like one person walking through and describing the home

{sort_instruction}

Return a JSON array with exactly {n} objects:
[{{"image_index": 1, "room_label": "exterior", "narration": "Welcome to {address}. ..."}}]

Return ONLY the JSON array, no other text."""

    results = generate_multimodal_json(
        provider=provider,
        client=client,
        prompt=prompt,
        image_paths=image_paths,
        max_tokens=2048,
    )

    # Sort by room order
    def room_sort_key(item):
        label = item["room_label"].lower()
        for i, room in enumerate(ROOM_ORDER):
            if room in label or label in room:
                return i
        return len(ROOM_ORDER)

    if auto_sort:
        results.sort(key=room_sort_key)
    else:
        results.sort(key=lambda item: item["image_index"])

    # Map back to file paths
    clips = []
    for item in results:
        idx = item["image_index"] - 1
        if 0 <= idx < len(image_paths):
            clips.append({
                "path": image_paths[idx],
                "room_label": item["room_label"],
                "order_index": len(clips),
                "narration": item.get("narration", f"Welcome to this {item['room_label']}."),
            })

    return clips


# ─────────────────────────────────────────────
# Stage 1: Image Classification & Sort (standalone, used by plan-only flow)
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
    """Generate flowing narration script for the listing video."""
    logger.info(f"Generating narrations for {len(clips)} clips...")

    tone_desc = TONE_PROMPTS.get(tone, TONE_PROMPTS["Warm & Inviting"])

    prompt = f"""Write a flowing narration script for a real estate listing video of {address} ({property_type}).
The video has {len(clips)} scenes. Write the script as one continuous narrative — like a real narrator walking through the home.

Tone: {tone_desc}

Rules:
- Scene 1 MUST open with: "Welcome to [address]" then describe what you see
- Last scene MUST close with a call to action like "Schedule your private showing today"
- Each scene is 1-2 sentences (max 30 words per scene)
- Use natural transitions between scenes: "Stepping inside...", "Just down the hall...", "Moving through to...", "Out back...", etc.
- Be specific — mention materials, colors, finishes, architectural details you see in each photo
- Never use generic filler like "beautiful home" or "stunning property"
- The script should sound like one person naturally walking through and describing the home, not like reading a list of bullet points

Return a JSON array with exactly {len(clips)} objects:
[{{"image_index": 1, "narration": "Welcome to 123 Oak Street. ..."}}]

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

def generate_audio_elevenlabs(
    eleven: ElevenLabs,
    clips: list[dict],
    work_dir: str,
    voice_id: str = "rachel",
) -> list[dict]:
    """Generate voiceover audio per clip using ElevenLabs (parallel)."""
    logger.info(f"Generating voiceover audio via ElevenLabs ({len(clips)} clips, {settings.max_tts_workers} workers)...")

    voice_preset = VOICE_PRESETS.get(voice_id, VOICE_PRESETS["rachel"])
    eleven_voice_id = voice_preset["id"]

    def _generate_one(i: int, clip: dict) -> tuple[int, str]:
        audio_path = os.path.join(work_dir, f"audio_{i:03d}.mp3")
        audio_bytes = eleven.generate(
            text=clip["narration"],
            voice=eleven_voice_id,
            model=settings.elevenlabs_model,
            voice_settings=VoiceSettings(
                stability=0.50,
                similarity_boost=0.75,
                style=0.20,
                use_speaker_boost=True,
            ),
        )
        with open(audio_path, "wb") as f:
            for chunk in audio_bytes:
                f.write(chunk)
        return i, audio_path

    with ThreadPoolExecutor(max_workers=settings.max_tts_workers) as pool:
        futures = {pool.submit(_generate_one, i, clip): i for i, clip in enumerate(clips)}
        for future in as_completed(futures):
            i, audio_path = future.result()
            _set_clip_audio_timing(clips[i], audio_path, i)

    return clips


def generate_audio_openai(
    oai: OpenAI,
    clips: list[dict],
    work_dir: str,
    voice_id: str = "rachel",
    tone: str = "Warm & Inviting",
) -> list[dict]:
    """Generate voiceover audio per clip using OpenAI TTS (parallel)."""
    logger.info(f"Generating voiceover audio via OpenAI TTS ({len(clips)} clips, {settings.max_tts_workers} workers)...")

    voice = OPENAI_VOICE_MAP.get(voice_id, "coral")
    instructions = OPENAI_VOICE_INSTRUCTIONS.get(tone, OPENAI_VOICE_INSTRUCTIONS["Warm & Inviting"])

    def _generate_one(i: int, clip: dict) -> tuple[int, str]:
        audio_path = os.path.join(work_dir, f"audio_{i:03d}.mp3")
        response = oai.audio.speech.create(
            model=settings.openai_tts_model,
            voice=voice,
            input=clip["narration"],
            instructions=instructions,
            response_format="mp3",
        )
        response.stream_to_file(audio_path)
        return i, audio_path

    with ThreadPoolExecutor(max_workers=settings.max_tts_workers) as pool:
        futures = {pool.submit(_generate_one, i, clip): i for i, clip in enumerate(clips)}
        for future in as_completed(futures):
            i, audio_path = future.result()
            _set_clip_audio_timing(clips[i], audio_path, i)

    return clips


def _set_clip_audio_timing(clip: dict, audio_path: str, index: int):
    """Set audio timing metadata on a clip dict after TTS generation."""
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
# AI Video Generation (Luma / Runway)
# ─────────────────────────────────────────────

# Motion prompts per room type — tells the AI model how to animate the scene
AI_MOTION_PROMPTS = {
    "exterior": "Slow cinematic drone push-in toward the front entrance, gentle parallax on trees and landscaping",
    "entryway": "Smooth forward dolly through the entryway, subtle light shift as entering the home",
    "foyer": "Slow upward tilt revealing the ceiling height, gentle ambient light movement",
    "living room": "Slow cinematic pan across the living room, natural light streaming through windows",
    "family room": "Gentle pull-back revealing the full family room, subtle ambient movement",
    "dining room": "Slow lateral dolly past the dining table, soft light playing on surfaces",
    "kitchen": "Smooth forward push toward the kitchen island, subtle reflections on countertops",
    "bedroom": "Gentle cinematic pan across the bedroom, soft curtain movement from breeze",
    "master bedroom": "Slow reveal pan of the master suite, natural light shifting through windows",
    "bathroom": "Slow push-in toward the vanity, subtle reflections on tile and glass surfaces",
    "office": "Gentle dolly forward into the office space, soft ambient light movement",
    "laundry": "Brief smooth pan across the laundry area, clean and well-lit",
    "garage": "Slow pull-back revealing the full garage space, subtle shadow movement",
    "backyard": "Slow cinematic pan across the backyard, gentle movement in trees and grass",
    "outdoor": "Smooth outdoor dolly shot, natural breeze moving through vegetation",
    "pool": "Slow cinematic push toward the pool, gentle water ripples and reflections",
    "other": "Slow smooth cinematic camera movement, subtle ambient scene motion",
}


def _get_presigned_image_url(r2_client, image_path: str, video_id: str, clip_idx: int) -> str:
    """Upload image to R2 and return a presigned URL for AI video gen APIs."""
    temp_key = f"temp/{video_id}/clip_{clip_idx:03d}{Path(image_path).suffix}"
    r2_client.upload_file(
        image_path,
        settings.r2_bucket_name,
        temp_key,
        ExtraArgs={"ContentType": get_image_media_type(image_path)},
    )
    url = r2_client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.r2_bucket_name, "Key": temp_key},
        ExpiresIn=600,  # 10 minutes — enough for AI gen
    )
    return url


def generate_ai_video_luma(
    image_url: str,
    room_label: str,
    output_path: str,
) -> bool:
    """Generate a video clip from a still image using Luma Dream Machine API."""
    try:
        from lumaai import LumaAI
    except ImportError:
        logger.warning("lumaai package not installed, falling back to Ken Burns")
        return False

    if not settings.lumaai_api_key:
        return False

    client = LumaAI(auth_token=settings.lumaai_api_key)
    motion_prompt = AI_MOTION_PROMPTS.get(room_label.lower(), AI_MOTION_PROMPTS["other"])
    prompt = f"Real estate property interior photo. {motion_prompt}. Photorealistic, steady smooth camera, no distortion, no morphing."

    try:
        generation = client.generations.create(
            prompt=prompt,
            model=settings.lumaai_model,
            keyframes={
                "frame0": {
                    "type": "image",
                    "url": image_url,
                }
            },
            duration=settings.video_gen_duration,
            resolution=settings.lumaai_resolution,
        )

        # Poll for completion (max 3 minutes)
        import time
        for _ in range(90):
            time.sleep(2)
            generation = client.generations.get(id=generation.id)
            if generation.state == "completed":
                break
            if generation.state == "failed":
                logger.warning(f"Luma generation failed: {generation.failure_reason}")
                return False
        else:
            logger.warning("Luma generation timed out after 3 minutes")
            return False

        # Download the generated video
        video_url = generation.assets.video
        if not video_url:
            return False

        response = httpx.get(video_url, timeout=60, follow_redirects=True)
        response.raise_for_status()
        with open(output_path, "wb") as f:
            f.write(response.content)

        logger.info(f"Luma AI video generated: {output_path}")
        return True

    except Exception as e:
        logger.warning(f"Luma AI video generation failed: {e}")
        return False


def generate_ai_video_runway(
    image_url: str,
    room_label: str,
    output_path: str,
) -> bool:
    """Generate a video clip from a still image using Runway Gen-4 API."""
    try:
        from runwayml import RunwayML
    except ImportError:
        logger.warning("runwayml package not installed, falling back to Ken Burns")
        return False

    if not settings.runway_api_key:
        return False

    client = RunwayML(api_key=settings.runway_api_key)
    motion_prompt = AI_MOTION_PROMPTS.get(room_label.lower(), AI_MOTION_PROMPTS["other"])
    prompt = f"Real estate property photo. {motion_prompt}. Photorealistic, steady smooth camera, no distortion."

    try:
        task = client.image_to_video.create(
            model=settings.runway_model,
            prompt_image=image_url,
            prompt_text=prompt,
            duration=int(settings.video_gen_duration.replace("s", "")),
            ratio="16:9",
        )

        # Poll for completion (max 3 minutes)
        import time
        for _ in range(90):
            time.sleep(2)
            task = client.tasks.retrieve(task.id)
            if task.status == "SUCCEEDED":
                break
            if task.status == "FAILED":
                logger.warning(f"Runway generation failed: {task.failure}")
                return False
        else:
            logger.warning("Runway generation timed out after 3 minutes")
            return False

        # Download the generated video
        video_url = task.output[0] if task.output else None
        if not video_url:
            return False

        response = httpx.get(video_url, timeout=60, follow_redirects=True)
        response.raise_for_status()
        with open(output_path, "wb") as f:
            f.write(response.content)

        logger.info(f"Runway AI video generated: {output_path}")
        return True

    except Exception as e:
        logger.warning(f"Runway AI video generation failed: {e}")
        return False


def generate_ai_video_clip(
    r2_client,
    image_path: str,
    room_label: str,
    video_id: str,
    clip_idx: int,
    output_path: str,
) -> bool:
    """
    Generate an AI video clip from a still image.
    Returns True if AI generation succeeded, False to fall back to Ken Burns.
    """
    provider = settings.video_gen_provider.lower()
    if provider == "ken_burns":
        return False

    # Upload image to get a presigned URL for the API
    image_url = _get_presigned_image_url(r2_client, image_path, video_id, clip_idx)

    if provider == "luma":
        return generate_ai_video_luma(image_url, room_label, output_path)
    elif provider == "runway":
        return generate_ai_video_runway(image_url, room_label, output_path)
    else:
        logger.warning(f"Unknown video gen provider: {provider}")
        return False


def composite_audio_on_video(
    video_path: str,
    audio_path: str,
    clip_duration: float,
    output_path: str,
    width: int = 1920,
    height: int = 1080,
    fps: int = 24,
):
    """
    Composite narration audio onto an AI-generated video clip.
    Scales/crops to target resolution, adds audio with lead-in delay,
    and applies fade in/out.
    """
    audio_delay_ms = int(settings.narration_lead_in * 1000)
    fade_dur = 0.4
    fade_out_start = max(clip_duration - fade_dur, 0)

    video_filter = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos,"
        f"crop={width}:{height},setsar=1,fps={fps},"
        f"fade=t=in:st=0:d={fade_dur},"
        f"fade=t=out:st={fade_out_start:.3f}:d={fade_dur}"
    )
    audio_filter = (
        f"adelay={audio_delay_ms}|{audio_delay_ms},"
        f"apad=pad_dur={clip_duration:.3f},"
        f"atrim=duration={clip_duration:.3f}"
    )

    codec_args = get_video_codec_args(crf=8, preset="fast", intermediate=True)
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-i", audio_path,
        "-filter_complex",
        f"[0:v]{video_filter}[v];[1:a]{audio_filter}[a]",
        "-map", "[v]",
        "-map", "[a]",
        *codec_args,
        "-c:a", "aac",
        "-b:a", "192k",
        "-ar", "44100",
        "-t", f"{clip_duration:.3f}",
        output_path,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"ffmpeg composite timed out for {output_path}")
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg composite failed: {result.stderr[-500:]}")


# ─────────────────────────────────────────────
# Codec helpers
# ─────────────────────────────────────────────

def _check_h265_available() -> bool:
    """Check if libx265 encoder is available in the FFmpeg build."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=5,
        )
        return "libx265" in result.stdout
    except Exception:
        return False


_h265_available: bool | None = None


def get_video_codec_args(crf: int | str, preset: str = "medium", intermediate: bool = False) -> list[str]:
    """
    Return FFmpeg codec arguments based on configured codec preference.

    H.265 (HEVC) gives ~40% better compression at the same visual quality,
    meaning smaller files or better quality at the same file size.
    Falls back to H.264 if libx265 is not available.

    For intermediate clips, we use near-lossless settings to avoid
    double-encoding quality loss.
    """
    global _h265_available
    if _h265_available is None:
        _h265_available = _check_h265_available()

    use_h265 = settings.video_codec.lower() == "h265" and _h265_available

    if use_h265:
        args = [
            "-c:v", "libx265",
            "-preset", preset,
            "-crf", str(crf),
            "-pix_fmt", "yuv420p",
            "-tag:v", "hvc1",  # Apple/browser compatibility tag
        ]
        if not intermediate:
            # x265 specific tuning for final output
            args.extend(["-x265-params", "log-level=error"])
    else:
        args = [
            "-c:v", "libx264",
            "-preset", preset,
            "-crf", str(crf),
            "-pix_fmt", "yuv420p",
        ]

    return args


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

    # Adaptive prescale — only upscale as much as needed for zoompan headroom.
    # For high-res sources (>= output), 2× gives smooth sub-pixel animation.
    # For low-res sources (Zillow ~1024px), we limit the upscale to avoid
    # turning a 1024px image into a blurry 3840px mess. Instead we go to
    # 1.2× output and add sharpening to recover clarity.
    try:
        src_img = Image.open(image_path)
        src_w, src_h = src_img.size
        src_img.close()
    except Exception:
        src_w, src_h = width, height  # fallback

    # If source is high-res (>= output), use 2× prescale for maximum quality.
    # If source is low-res, use a gentler multiplier to avoid excessive upscale.
    upscale_ratio = max(src_w, src_h) / max(width, height)
    if upscale_ratio >= 1.0:
        # Source is >= output resolution — 2× prescale is fine
        pre_multiplier = 2.0
        needs_sharpening = False
    else:
        # Source is smaller than output (e.g., 1024px Zillow for 1920px output).
        # Limit prescale to 1.2× output to reduce upscale blur, and sharpen.
        pre_multiplier = 1.2
        needs_sharpening = True

    pre_w = int(width * pre_multiplier)
    pre_h = int(height * pre_multiplier)
    prescale_filter = (
        f"scale={pre_w}:{pre_h}"
        f":force_original_aspect_ratio=increase:flags=lanczos,"
        f"crop={pre_w}:{pre_h},setsar=1"
    )
    # Adaptive sharpening for upscaled low-res sources — recovers edge
    # detail lost during Lanczos interpolation without over-sharpening.
    if needs_sharpening:
        prescale_filter += ",unsharp=5:5:0.8:5:5:0.4"

    # Reduce zoom range for low-res sources to avoid magnifying upscale artifacts.
    max_zoom = 0.15 if upscale_ratio >= 1.0 else 0.08
    steady_zoom = 1.10 if upscale_ratio >= 1.0 else 1.05

    # Build zoompan expressions based on motion style.
    if motion == "push_in":
        z_expr = f"1+{max_zoom}*(on/{fd})"
        x_expr = f"(iw-iw/zoom)/2"
        y_expr = f"(ih-ih/zoom)/2"
    elif motion == "pull_back":
        z_expr = f"{1+max_zoom}-{max_zoom}*(on/{fd})"
        x_expr = f"(iw-iw/zoom)/2"
        y_expr = f"(ih-ih/zoom)/2"
    elif motion == "pan_right":
        z_expr = f"{steady_zoom}"
        x_expr = f"(iw-iw/zoom)*(0.05+0.90*(on/{fd}))"
        y_expr = f"(ih-ih/zoom)/2"
    elif motion == "pan_left":
        z_expr = f"{steady_zoom}"
        x_expr = f"(iw-iw/zoom)*(0.95-0.90*(on/{fd}))"
        y_expr = f"(ih-ih/zoom)/2"
    elif motion == "tilt_up":
        z_expr = f"{steady_zoom}"
        x_expr = f"(iw-iw/zoom)/2"
        y_expr = f"(ih-ih/zoom)*(0.85-0.70*(on/{fd}))"
    else:
        # Fallback: push_in
        z_expr = f"1+{max_zoom}*(on/{fd})"
        x_expr = f"(iw-iw/zoom)/2"
        y_expr = f"(ih-ih/zoom)/2"

    zoompan_filter = (
        f"zoompan=z={z_expr}:x={x_expr}:y={y_expr}"
        f":d={total_frames}:s={width}x{height}:fps={fps}"
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

    # Use near-lossless CRF for intermediate clips — the final assembly
    # re-encodes at the target CRF so encoding twice at higher CRF was
    # causing visible quality loss compared to the source photos.
    # "fast" preset is fine here since CRF 8 at any preset is visually
    # identical, and these are intermediates that get re-encoded. ~3x faster.
    codec_args = get_video_codec_args(crf=8, preset="fast", intermediate=True)
    cmd = [
        "ffmpeg", "-y",
        "-i", image_path,
        "-i", audio_path,
        "-filter_complex", f"[0:v]{video_filter}[v];[1:a]{audio_filter}[a]",
        "-map", "[v]",
        "-map", "[a]",
        *codec_args,
        "-c:a", "aac",
        "-b:a", "192k",
        "-ar", "44100",
        "-t", f"{clip_duration:.3f}",
        output_path,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"ffmpeg clip render timed out after 120s for {output_path}")
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


def render_all_clips(
    clips: list[dict],
    work_dir: str,
    width: int = 1920,
    height: int = 1080,
    video_id: str | None = None,
    ar_label: str = "",
    r2_client=None,
) -> list[dict]:
    """Render all clips using AI video generation only."""
    n = len(clips)
    provider = settings.video_gen_provider.lower().strip()
    if r2_client is None:
        raise RuntimeError("R2 client is required for AI video generation")
    if provider not in {"luma", "runway"}:
        raise RuntimeError(
            f"AI-only mode requires VIDEO_GEN_PROVIDER=luma or runway, got '{settings.video_gen_provider}'"
        )
    workers = min(settings.max_video_gen_workers, n)
    method = f"AI ({provider})"
    logger.info(f"Rendering {n} video clips via {method} ({workers} parallel workers)...")
    completed_count = 0

    def _render_one(i: int, clip: dict) -> tuple[int, str]:
        clip_path = os.path.join(work_dir, f"clip_{i:03d}.mp4")
        room_label = clip.get("room_label", "other")
        ai_raw_path = os.path.join(work_dir, f"ai_raw_{i:03d}.mp4")
        ai_success = generate_ai_video_clip(
            r2_client=r2_client,
            image_path=clip["path"],
            room_label=room_label,
            video_id=video_id or "unknown",
            clip_idx=i,
            output_path=ai_raw_path,
        )
        if not ai_success:
            raise RuntimeError(
                f"AI video generation failed for clip {i + 1}/{n} using provider '{provider}'"
            )

        # Composite narration audio onto the AI-generated video
        composite_audio_on_video(
            video_path=ai_raw_path,
            audio_path=clip["audio_path"],
            clip_duration=clip["clip_duration"],
            output_path=clip_path,
            width=width,
            height=height,
            fps=settings.video_fps,
        )

        return i, clip_path

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_render_one, i, clip): i for i, clip in enumerate(clips)}
        for future in as_completed(futures):
            i, clip_path = future.result()
            clips[i]["clip_path"] = clip_path
            completed_count += 1
            if video_id:
                prefix = f"Rendering {ar_label} " if ar_label else "Rendering "
                report_status(
                    video_id, "processing",
                    f"{prefix}clip {completed_count}/{n}",
                )

    return clips


# ─────────────────────────────────────────────
# Stage 5: Final Assembly
# ─────────────────────────────────────────────

def create_ass_file(clips: list[dict], ass_path: str, width: int = 1920, height: int = 1080, margin_v: int | None = None):
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
        mv = margin_v if margin_v is not None else settings.subtitle_margin_v
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


# Synthetic music definitions — richer generative music with chord progressions,
# arpeggios, and layered harmonics for a more polished sound.
#
# Each style has:
#   expr:     stereo aevalsrc expression (left|right channels)
#   lowpass:  low-pass cutoff frequency
#   highpass: high-pass cutoff frequency
#   reverb:   aecho params for room ambience (delay|decay pairs)
#
# Technique: We use multiple sine layers at different octaves, with slow LFO
# modulation for movement, and slight stereo offset for width. The aecho filter
# adds reverb-like ambience. Chord changes are simulated by modulating between
# frequency sets using floor(mod(t, period)) selectors.

MUSIC_SYNTHS = {
    "ambient": {
        # Warm A-minor → F-major → C-major → G-major pad cycle (8-bar, ~16s loop)
        # Layered pad with slow LFO tremolo + arpeggio shimmer on top
        "expr_left": (
            # Pad layer: A-min chord morphing via slow mod
            "0.12*sin(2*PI*110*t)+"
            "0.09*sin(2*PI*220*t)+"
            "0.07*sin(2*PI*261.63*t*(1+0.002*sin(2*PI*0.1*t)))+"
            "0.05*sin(2*PI*329.63*t)+"
            # Sub bass with gentle throb
            "0.10*sin(2*PI*55*t)*(0.7+0.3*sin(2*PI*0.25*t))+"
            # Shimmering arpeggio layer (cycling through chord tones)
            "0.03*sin(2*PI*440*t*(1+0.003*sin(2*PI*0.08*t)))*(0.5+0.5*sin(2*PI*1.5*t))+"
            "0.02*sin(2*PI*523.25*t)*(0.5+0.5*sin(2*PI*2*t+1.57))+"
            # Breathy high harmonic
            "0.015*sin(2*PI*880*t)*(0.3+0.3*sin(2*PI*0.15*t))"
        ),
        "expr_right": (
            "0.12*sin(2*PI*110*t+0.1)+"
            "0.09*sin(2*PI*220*t+0.15)+"
            "0.07*sin(2*PI*261.63*t*(1+0.002*sin(2*PI*0.1*t+0.5)))+"
            "0.05*sin(2*PI*329.63*t+0.2)+"
            "0.10*sin(2*PI*55*t)*(0.7+0.3*sin(2*PI*0.25*t+0.3))+"
            "0.03*sin(2*PI*440*t*(1+0.003*sin(2*PI*0.08*t+1)))*(0.5+0.5*sin(2*PI*1.5*t+0.8))+"
            "0.02*sin(2*PI*523.25*t+0.3)*(0.5+0.5*sin(2*PI*2*t+2.37))+"
            "0.015*sin(2*PI*880*t+0.1)*(0.3+0.3*sin(2*PI*0.15*t+0.7))"
        ),
        "lowpass": 1200,
        "highpass": 50,
        "reverb": "0.6:0.5:60|80:0.35|0.25",
    },
    "upbeat": {
        # C-major with rhythmic pulse — 4-on-the-floor feel with synth stabs
        # Driving bass + rhythmic chord stabs + bright arp
        "expr_left": (
            # Rhythmic bass (pulsing at 130 BPM ≈ 2.17 Hz)
            "0.14*sin(2*PI*130.81*t)*(0.4+0.6*max(0,sin(2*PI*2.17*t)))+"
            # Chord stab (C-E-G) with rhythmic gate
            "0.08*sin(2*PI*261.63*t)*(0.3+0.7*max(0,sin(2*PI*4.33*t)))+"
            "0.06*sin(2*PI*329.63*t)*(0.3+0.7*max(0,sin(2*PI*4.33*t+0.5)))+"
            "0.05*sin(2*PI*392*t)*(0.3+0.7*max(0,sin(2*PI*4.33*t+1)))+"
            # Bright arpeggio cycling C4→E4→G4→C5 at 8th notes
            "0.04*sin(2*PI*523.25*t)*(0.5+0.5*sin(2*PI*4.33*t))+"
            "0.03*sin(2*PI*659.25*t)*(0.5+0.5*sin(2*PI*4.33*t+1.57))+"
            # Sub bass foundation
            "0.10*sin(2*PI*65.41*t)*(0.6+0.4*max(0,sin(2*PI*2.17*t)))"
        ),
        "expr_right": (
            "0.14*sin(2*PI*130.81*t+0.1)*(0.4+0.6*max(0,sin(2*PI*2.17*t+0.1)))+"
            "0.08*sin(2*PI*261.63*t+0.15)*(0.3+0.7*max(0,sin(2*PI*4.33*t+0.1)))+"
            "0.06*sin(2*PI*329.63*t+0.1)*(0.3+0.7*max(0,sin(2*PI*4.33*t+0.6)))+"
            "0.05*sin(2*PI*392*t+0.12)*(0.3+0.7*max(0,sin(2*PI*4.33*t+1.1)))+"
            "0.04*sin(2*PI*523.25*t+0.2)*(0.5+0.5*sin(2*PI*4.33*t+0.2))+"
            "0.03*sin(2*PI*659.25*t+0.15)*(0.5+0.5*sin(2*PI*4.33*t+1.77))+"
            "0.10*sin(2*PI*65.41*t+0.05)*(0.6+0.4*max(0,sin(2*PI*2.17*t+0.15)))"
        ),
        "lowpass": 3000,
        "highpass": 60,
        "reverb": "0.4:0.3:40|50:0.2|0.15",
    },
    "cinematic": {
        # Deep D-minor with orchestral weight — dramatic swells and tension
        # Low strings + brass-like mid + high shimmer with slow crescendo LFO
        "expr_left": (
            # Deep strings (D2 + octave)
            "0.16*sin(2*PI*73.42*t)*(0.6+0.4*sin(2*PI*0.08*t))+"
            "0.12*sin(2*PI*146.83*t)*(0.6+0.4*sin(2*PI*0.08*t+0.5))+"
            # Brass-like harmonics (F3 + A3) with swell
            "0.08*sin(2*PI*174.61*t)*(0.4+0.6*sin(2*PI*0.12*t))+"
            "0.07*sin(2*PI*220*t)*(0.4+0.6*sin(2*PI*0.12*t+0.3))+"
            # Tension note (Bb3) fading in and out
            "0.04*sin(2*PI*233.08*t)*(0.3+0.3*sin(2*PI*0.05*t))+"
            # High shimmer
            "0.03*sin(2*PI*440*t)*(0.2+0.3*sin(2*PI*0.1*t))+"
            "0.02*sin(2*PI*587.33*t)*(0.2+0.2*sin(2*PI*0.07*t))+"
            # Sub rumble
            "0.12*sin(2*PI*36.71*t)*(0.5+0.5*sin(2*PI*0.06*t))"
        ),
        "expr_right": (
            "0.16*sin(2*PI*73.42*t+0.15)*(0.6+0.4*sin(2*PI*0.08*t+0.2))+"
            "0.12*sin(2*PI*146.83*t+0.1)*(0.6+0.4*sin(2*PI*0.08*t+0.7))+"
            "0.08*sin(2*PI*174.61*t+0.12)*(0.4+0.6*sin(2*PI*0.12*t+0.2))+"
            "0.07*sin(2*PI*220*t+0.08)*(0.4+0.6*sin(2*PI*0.12*t+0.5))+"
            "0.04*sin(2*PI*233.08*t+0.2)*(0.3+0.3*sin(2*PI*0.05*t+0.4))+"
            "0.03*sin(2*PI*440*t+0.1)*(0.2+0.3*sin(2*PI*0.1*t+0.3))+"
            "0.02*sin(2*PI*587.33*t+0.15)*(0.2+0.2*sin(2*PI*0.07*t+0.5))+"
            "0.12*sin(2*PI*36.71*t+0.1)*(0.5+0.5*sin(2*PI*0.06*t+0.3))"
        ),
        "lowpass": 800,
        "highpass": 35,
        "reverb": "0.7:0.6:80|120|160:0.4|0.3|0.2",
    },
    "lofi": {
        # Lo-fi chill beats — jazzy chords with vinyl warmth
        # Eb-major7 → Cm7 feel, with subtle wobble and warmth
        "expr_left": (
            # Warm jazz chord (Eb-G-Bb-D) with gentle wobble
            "0.10*sin(2*PI*155.56*t)*(0.7+0.3*sin(2*PI*0.3*t))+"
            "0.08*sin(2*PI*196*t*(1+0.004*sin(2*PI*0.2*t)))+"
            "0.07*sin(2*PI*233.08*t)*(0.6+0.4*sin(2*PI*0.25*t))+"
            "0.05*sin(2*PI*293.66*t*(1+0.003*sin(2*PI*0.15*t)))+"
            # Mellow bass with slow pulse
            "0.12*sin(2*PI*77.78*t)*(0.5+0.5*sin(2*PI*0.5*t))+"
            # Gentle high keys
            "0.03*sin(2*PI*466.16*t)*(0.3+0.4*sin(2*PI*1*t))+"
            "0.02*sin(2*PI*587.33*t)*(0.2+0.3*sin(2*PI*1.5*t+1))"
        ),
        "expr_right": (
            "0.10*sin(2*PI*155.56*t+0.2)*(0.7+0.3*sin(2*PI*0.3*t+0.4))+"
            "0.08*sin(2*PI*196*t*(1+0.004*sin(2*PI*0.2*t+0.3))+0.1)+"
            "0.07*sin(2*PI*233.08*t+0.15)*(0.6+0.4*sin(2*PI*0.25*t+0.5))+"
            "0.05*sin(2*PI*293.66*t*(1+0.003*sin(2*PI*0.15*t+0.2))+0.1)+"
            "0.12*sin(2*PI*77.78*t+0.1)*(0.5+0.5*sin(2*PI*0.5*t+0.2))+"
            "0.03*sin(2*PI*466.16*t+0.2)*(0.3+0.4*sin(2*PI*1*t+0.5))+"
            "0.02*sin(2*PI*587.33*t+0.25)*(0.2+0.3*sin(2*PI*1.5*t+1.5))"
        ),
        "lowpass": 1500,
        "highpass": 70,
        "reverb": "0.5:0.4:50|70:0.3|0.2",
    },
    "elegant": {
        # Classical piano-inspired — gentle arpeggiated C-major → Am → F → G
        # Clean, refined, minimal — perfect for luxury listings
        "expr_left": (
            # Piano-like clean tones with natural decay simulation
            "0.11*sin(2*PI*261.63*t)*(0.8+0.2*sin(2*PI*0.2*t))+"
            "0.08*sin(2*PI*329.63*t*(1+0.001*sin(2*PI*0.1*t)))+"
            "0.06*sin(2*PI*392*t)*(0.7+0.3*sin(2*PI*0.15*t))+"
            # Arpeggio pattern cycling slowly
            "0.04*sin(2*PI*523.25*t)*(0.4+0.4*sin(2*PI*0.8*t))+"
            "0.03*sin(2*PI*659.25*t)*(0.3+0.3*sin(2*PI*0.8*t+2.09))+"
            "0.02*sin(2*PI*783.99*t)*(0.3+0.3*sin(2*PI*0.8*t+4.19))+"
            # Warm bass note
            "0.09*sin(2*PI*130.81*t)*(0.6+0.4*sin(2*PI*0.1*t))"
        ),
        "expr_right": (
            "0.11*sin(2*PI*261.63*t+0.08)*(0.8+0.2*sin(2*PI*0.2*t+0.3))+"
            "0.08*sin(2*PI*329.63*t*(1+0.001*sin(2*PI*0.1*t+0.2))+0.1)+"
            "0.06*sin(2*PI*392*t+0.12)*(0.7+0.3*sin(2*PI*0.15*t+0.4))+"
            "0.04*sin(2*PI*523.25*t+0.15)*(0.4+0.4*sin(2*PI*0.8*t+0.3))+"
            "0.03*sin(2*PI*659.25*t+0.1)*(0.3+0.3*sin(2*PI*0.8*t+2.39))+"
            "0.02*sin(2*PI*783.99*t+0.12)*(0.3+0.3*sin(2*PI*0.8*t+4.49))+"
            "0.09*sin(2*PI*130.81*t+0.05)*(0.6+0.4*sin(2*PI*0.1*t+0.2))"
        ),
        "lowpass": 2500,
        "highpass": 80,
        "reverb": "0.6:0.5:70|100:0.35|0.25",
    },
}


def ensure_background_music(track_duration: float, work_dir: str, music_style: str = "ambient") -> str | None:
    """Return a music track path. Checks for bundled MP3 first, falls back to synthetic generation."""
    # "none" means user explicitly wants no music
    if music_style == "none":
        return None

    # Check for bundled track matching the requested style
    assets_dir = os.path.join(os.path.dirname(__file__), "assets", "music")
    bundled_track = os.path.join(assets_dir, f"{music_style}.mp3")
    if os.path.exists(bundled_track):
        return bundled_track

    # Fallback: check for any bundled background.mp3
    bundled_fallback = os.path.join(os.path.dirname(__file__), "assets", "background.mp3")
    if os.path.exists(bundled_fallback):
        return bundled_fallback

    # Generate synthetic music bed with stereo width and reverb
    synth = MUSIC_SYNTHS.get(music_style, MUSIC_SYNTHS["ambient"])
    generated_music = os.path.join(work_dir, "background-bed.wav")
    fade_duration = min(3.0, max(track_duration / 4, 1.5))
    fade_out_start = max(track_duration - fade_duration, 0)

    # Use separate L/R channel expressions for stereo width
    expr_left = synth.get("expr_left", synth.get("expr", "0"))
    expr_right = synth.get("expr_right", synth.get("expr", "0"))

    synth_expr = (
        f"aevalsrc={expr_left}|{expr_right}"
        f":s=44100:d={track_duration:.3f}"
    )

    # Build audio filter chain: EQ → reverb (aecho) → fade in/out
    reverb_params = synth.get("reverb", "0.5:0.4:60:0.3")
    audio_filter = (
        f"lowpass=f={synth['lowpass']},highpass=f={synth['highpass']},"
        f"aecho={reverb_params},"
        f"afade=t=in:st=0:d={fade_duration:.3f},"
        f"afade=t=out:st={fade_out_start:.3f}:d={fade_duration:.3f}"
    )

    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", synth_expr,
        "-af", audio_filter,
        generated_music,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        logger.warning(f"Background music generation failed: {result.stderr[-500:]}")
        return None

    return generated_music


def render_intro_card(
    first_image: str,
    address: str,
    property_type: str,
    output_path: str,
    duration: float = 3.0,
    width: int = 1920,
    height: int = 1080,
    fps: int = 24,
):
    """Render an intro title card: blurred first photo with address overlay."""
    total_frames = int(duration * fps)

    # Escape special chars for FFmpeg drawtext
    safe_address = address.replace("'", "\u2019").replace(":", "\\:")
    safe_type = property_type.replace("'", "\u2019").replace(":", "\\:")

    # Compute font sizes relative to video width for aspect ratio support
    title_size = max(int(width / 28), 24)
    sub_size = max(int(width / 48), 16)

    video_filter = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos,"
        f"crop={width}:{height},setsar=1,"
        f"boxblur=20:5,"
        f"drawtext=text='{safe_address}':fontcolor=white:fontsize={title_size}"
        f":x=(w-text_w)/2:y=(h-text_h)/2-{int(height*0.03)}:font=Arial:shadowcolor=black@0.6:shadowx=2:shadowy=2,"
        f"drawtext=text='{safe_type}':fontcolor=white@0.8:fontsize={sub_size}"
        f":x=(w-text_w)/2:y=(h/2)+{int(height*0.05)}:font=Arial,"
        f"fade=t=in:st=0:d=0.8,"
        f"fade=t=out:st={duration - 0.5:.3f}:d=0.5"
    )

    codec_args = get_video_codec_args(crf=8, preset="fast", intermediate=True)
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1",
        "-i", first_image,
        "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo:d={duration}",
        "-filter_complex", f"[0:v]{video_filter}[v]",
        "-map", "[v]",
        "-map", "1:a",
        *codec_args,
        "-c:a", "aac", "-b:a", "192k",
        "-t", f"{duration:.3f}",
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        logger.warning(f"Intro card render failed: {result.stderr[-500:]}")
        return False
    return True


def render_outro_card(
    last_image: str,
    output_path: str,
    duration: float = 4.0,
    width: int = 1920,
    height: int = 1080,
    fps: int = 24,
):
    """Render an outro CTA card: blurred last photo with call-to-action."""
    cta_size = max(int(width / 32), 22)
    brand_size = max(int(width / 54), 14)

    video_filter = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos,"
        f"crop={width}:{height},setsar=1,"
        f"boxblur=25:5,"
        f"colorbalance=rs=-0.1:gs=-0.1:bs=-0.05,"
        f"drawtext=text='Schedule Your Showing Today':fontcolor=white:fontsize={cta_size}"
        f":x=(w-text_w)/2:y=(h-text_h)/2-{int(height*0.02)}:font=Arial:shadowcolor=black@0.6:shadowx=2:shadowy=2,"
        f"drawtext=text='Made with ListingReel':fontcolor=white@0.5:fontsize={brand_size}"
        f":x=(w-text_w)/2:y=h-{int(height*0.08)}:font=Arial,"
        f"fade=t=in:st=0:d=0.5,"
        f"fade=t=out:st={duration - 1.0:.3f}:d=1.0"
    )

    codec_args = get_video_codec_args(crf=8, preset="fast", intermediate=True)
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1",
        "-i", last_image,
        "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo:d={duration}",
        "-filter_complex", f"[0:v]{video_filter}[v]",
        "-map", "[v]",
        "-map", "1:a",
        *codec_args,
        "-c:a", "aac", "-b:a", "192k",
        "-t", f"{duration:.3f}",
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        logger.warning(f"Outro card render failed: {result.stderr[-500:]}")
        return False
    return True


def assemble_final_video(
    clips: list[dict],
    work_dir: str,
    output_path: str,
    add_music: bool = True,
    watermark: bool = True,
    music_style: str = "ambient",
    width: int = 1920,
    height: int = 1080,
    subtitle_margin_v: int | None = None,
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
    create_ass_file(clips, ass_path, width, height, margin_v=subtitle_margin_v)
    subtitle_filter = f"subtitles={ass_path}"

    watermark_filter = (
        "drawtext=text='ListingReel Preview':fontcolor=white@0.4:"
        "fontsize=24:x=w-tw-20:y=h-th-20:font=Arial"
    )

    total_duration = sum(clip["clip_duration"] for clip in clips)
    music_file = ensure_background_music(total_duration, work_dir, music_style) if add_music else None
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

        final_codec_args = get_video_codec_args(crf=settings.video_crf, preset="medium")
        cmd = (
            ["ffmpeg", "-y"]
            + inputs
            + [
                "-filter_complex", ";".join(filter_parts),
                "-map", f"[{final_v}]",
                "-map", final_a,
                *final_codec_args,
                "-c:a", "aac",
                "-b:a", "192k",
                "-ar", "44100",
                "-movflags", "+faststart",
                output_path,
            ]
        )

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        except subprocess.TimeoutExpired:
            raise RuntimeError("ffmpeg assembly timed out after 300s")
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
        final_codec_args = get_video_codec_args(crf=settings.video_crf, preset="medium")
        cmd = (
            ["ffmpeg", "-y"]
            + inputs
            + music_args
            + [
                "-filter_complex", filter_complex,
                "-map", f"[{final_v}]",
                "-map", f"[{final_a}]",
                *final_codec_args,
                "-c:a", "aac",
                "-b:a", "192k",
                "-ar", "44100",
                "-movflags", "+faststart",
                output_path,
            ]
        )
    else:
        final_codec_args = get_video_codec_args(crf=settings.video_crf, preset="medium")
        cmd = (
            ["ffmpeg", "-y"]
            + inputs
            + [
                "-filter_complex", filter_complex,
                "-map", f"[{final_v}]",
                "-map", f"[{final_a}]",
                *final_codec_args,
                "-c:a", "aac",
                "-b:a", "192k",
                "-ar", "44100",
                "-movflags", "+faststart",
                output_path,
            ]
        )

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        raise RuntimeError("ffmpeg assembly timed out after 300s")
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

def run_plan_only(job: VideoJob) -> dict:
    """
    Run stages 1-2 only (classify + narrate) and return the plan as JSON.
    Used for the edit-before-render flow.
    """
    work_dir = tempfile.mkdtemp(prefix=f"listingreel_plan_{job.video_id}_")

    try:
        llm_provider, llm_client = create_llm_client()
        r2 = get_r2_client()

        # Download images (parallel)
        def _dl(args: tuple[int, str]) -> str | None:
            i, key = args
            ext = Path(key).suffix or ".jpg"
            local_path = os.path.join(work_dir, f"img_{i:03d}{ext}")
            return local_path if download_image(r2, key, local_path) else None

        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(_dl, enumerate(job.image_keys)))
        image_paths = [p for p in results if p is not None]

        if not image_paths:
            return {"error": "No images could be downloaded", "clips": []}

        # Stages 1+2: Classify and narrate in a single LLM call
        clips = classify_and_narrate(
            llm_provider, llm_client, image_paths,
            job.address, job.property_type, job.tone, job.auto_sort,
        )

        # Return the plan for user review
        plan_clips = []
        for clip in clips:
            # Map back to the original image key index
            filename = os.path.basename(clip["path"])
            # img_000.jpg → 0
            idx = int(filename.split("_")[1].split(".")[0])
            plan_clips.append({
                "imageIndex": idx,
                "imageKey": job.image_keys[idx] if idx < len(job.image_keys) else "",
                "roomLabel": clip.get("room_label", "other"),
                "narration": clip.get("narration", ""),
            })

        return {"clips": plan_clips}

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def run_pipeline(job: VideoJob) -> PipelineResult:
    result = PipelineResult()
    work_dir = tempfile.mkdtemp(prefix=f"listingreel_{job.video_id}_")

    try:
        llm_provider, llm_client = create_llm_client()
        r2 = get_r2_client()

        # ── Stage 1: Download images (parallel)
        report_status(job.video_id, "processing", "Downloading images")
        logger.info(f"Downloading {len(job.image_keys)} images...")

        def _download_one(args: tuple[int, str]) -> str | None:
            i, key = args
            ext = Path(key).suffix or ".jpg"
            local_path = os.path.join(work_dir, f"img_{i:03d}{ext}")
            return local_path if download_image(r2, key, local_path) else None

        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(_download_one, enumerate(job.image_keys)))
        image_paths = [p for p in results if p is not None]

        if not image_paths:
            raise RuntimeError("No images could be downloaded")

        # ── Stages 1-2: Classification + Narration (single LLM call, shared across all aspect ratios)
        if job.edited_clips:
            logger.info("Using user-edited clip plan (skipping AI classification + narration)")
            clips = []
            for ec in job.edited_clips:
                idx = ec["imageIndex"]
                if 0 <= idx < len(image_paths):
                    clips.append({
                        "path": image_paths[idx],
                        "room_label": "other",
                        "order_index": len(clips),
                        "narration": ec["narration"],
                    })
        else:
            report_status(job.video_id, "processing", "Analyzing photos & writing narrations")
            clips = classify_and_narrate(
                llm_provider, llm_client, image_paths,
                job.address, job.property_type, job.tone, job.auto_sort,
            )

        # ── Stage 3: TTS (run once, audio is reused across aspect ratios)
        report_status(job.video_id, "processing", "Recording voiceover")
        tts_provider = settings.tts_provider.lower()
        if tts_provider == "openai" and settings.openai_api_key:
            oai = OpenAI(api_key=settings.openai_api_key)
            clips = generate_audio_openai(oai, clips, work_dir, voice_id=job.voice_id, tone=job.tone)
        else:
            eleven = ElevenLabs(api_key=settings.elevenlabs_api_key)
            clips = generate_audio_elevenlabs(eleven, clips, work_dir, voice_id=job.voice_id)

        # ── Stages 4-5: Render + Assemble (once per aspect ratio)
        # AI-only mode: no Ken Burns fallback.
        if job.video_quality != "ai":
            raise RuntimeError("Only videoQuality='ai' is supported")

        provider = settings.video_gen_provider.lower().strip()
        if provider not in {"luma", "runway"}:
            if settings.lumaai_api_key:
                settings.video_gen_provider = "luma"
            elif settings.runway_api_key:
                settings.video_gen_provider = "runway"
            else:
                raise RuntimeError(
                    "AI-only mode requires LUMAAI_API_KEY or RUNWAY_API_KEY"
                )

        aspect_ratios = job.aspect_ratios or ["16:9"]
        r2_keys = {}  # aspect_ratio -> r2_key
        primary_output = None
        primary_duration = None
        gif_r2_key = None

        def _render_aspect_ratio(ar_idx: int, ar_name: str) -> tuple[str, str, str]:
            """Render one aspect ratio: clips + intro/outro in parallel, then assemble."""
            ar = ASPECT_RATIOS.get(ar_name, ASPECT_RATIOS["16:9"])
            vid_width = ar["width"]
            vid_height = ar["height"]
            subtitle_mv = ar["subtitle_margin_v"]

            ar_suffix = ar_name.replace(":", "x")
            ar_dir = os.path.join(work_dir, f"ar_{ar_suffix}")
            os.makedirs(ar_dir, exist_ok=True)

            # Render clips, intro, and outro in parallel — they're independent
            intro_path = os.path.join(ar_dir, "intro_card.mp4")
            outro_path = os.path.join(ar_dir, "outro_card.mp4")

            with ThreadPoolExecutor(max_workers=3) as card_pool:
                clips_future = card_pool.submit(
                    render_all_clips, clips, ar_dir, vid_width, vid_height,
                    video_id=job.video_id, ar_label=ar_name, r2_client=r2,
                )
                intro_future = card_pool.submit(
                    render_intro_card,
                    first_image=clips[0]["path"],
                    address=job.address,
                    property_type=job.property_type,
                    output_path=intro_path,
                    width=vid_width,
                    height=vid_height,
                    fps=settings.video_fps,
                )
                outro_future = card_pool.submit(
                    render_outro_card,
                    last_image=clips[-1]["path"],
                    output_path=outro_path,
                    width=vid_width,
                    height=vid_height,
                    fps=settings.video_fps,
                )

                ar_clips = clips_future.result()
                has_intro = intro_future.result()
                has_outro = outro_future.result()

            # Build full clip list
            all_clips = []
            if has_intro:
                all_clips.append({
                    "clip_path": intro_path,
                    "clip_duration": 3.0,
                    "narration": "",
                    "speech_start": 0,
                    "speech_end": 0,
                })
            all_clips.extend(ar_clips)
            if has_outro:
                all_clips.append({
                    "clip_path": outro_path,
                    "clip_duration": 4.0,
                    "narration": "",
                    "speech_start": 0,
                    "speech_end": 0,
                })

            # Stage 5: Assemble
            ar_output = os.path.join(ar_dir, "output.mp4")
            assemble_final_video(
                clips=all_clips,
                work_dir=ar_dir,
                output_path=ar_output,
                add_music=job.add_music,
                watermark=True,
                music_style=job.music_style,
                width=vid_width,
                height=vid_height,
                subtitle_margin_v=subtitle_mv,
            )

            # Determine R2 key
            if ar_idx == 0:
                r2_key = f"videos/{job.user_id}/{job.video_id}/output.mp4"
            else:
                r2_key = f"videos/{job.user_id}/{job.video_id}/output_{ar_suffix}.mp4"

            logger.info(f"Uploading {ar_name} output to R2: {r2_key}")
            r2.upload_file(
                ar_output,
                settings.r2_bucket_name,
                r2_key,
                ExtraArgs={"ContentType": "video/mp4"},
            )
            return ar_name, r2_key, ar_output

        # Render all aspect ratios — parallel when multiple, sequential when one
        if len(aspect_ratios) == 1:
            report_status(job.video_id, "processing", f"Rendering {aspect_ratios[0]}")
            ar_name, r2_key, ar_output = _render_aspect_ratio(0, aspect_ratios[0])
            r2_keys[ar_name] = r2_key
            primary_output = ar_output
            primary_duration = get_video_duration(ar_output)
        else:
            report_status(
                job.video_id, "processing",
                f"Rendering {len(aspect_ratios)} aspect ratios in parallel",
            )
            with ThreadPoolExecutor(max_workers=len(aspect_ratios)) as ar_pool:
                ar_futures = {
                    ar_pool.submit(_render_aspect_ratio, i, name): (i, name)
                    for i, name in enumerate(aspect_ratios)
                }
                for future in as_completed(ar_futures):
                    i, name = ar_futures[future]
                    ar_name, r2_key, ar_output = future.result()
                    r2_keys[ar_name] = r2_key
                    if i == 0:
                        primary_output = ar_output
                        primary_duration = get_video_duration(ar_output)

        # Use primary output for result and thumbnail
        result.output_r2_key = r2_keys.get(aspect_ratios[0])
        result.duration_seconds = primary_duration

        # Generate thumbnail GIF from the first source image (Ken Burns effect).
        # Much faster than re-decoding the full assembled video.
        try:
            gif_path = os.path.join(work_dir, "thumbnail.gif")
            gif_result = subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-loop", "1",
                    "-i", clips[0]["path"],
                    "-t", "3",
                    "-filter_complex",
                    "scale=640:-1:force_original_aspect_ratio=decrease:flags=lanczos,"
                    "zoompan=z='1+0.04*on/72':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'"
                    ":d=30:s=640x360:fps=10,"
                    "split[v1][v2];[v1]palettegen[p];[v2][p]paletteuse",
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
            r2Key=result.output_r2_key,
            durationSeconds=primary_duration,
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
