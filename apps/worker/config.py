from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    llm_provider: str = "anthropic"
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-4-5"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash-lite"
    elevenlabs_api_key: str | None = None
    database_url: str
    upstash_redis_url: str
    upstash_redis_token: str
    r2_account_id: str
    r2_access_key_id: str
    r2_secret_access_key: str
    r2_bucket_name: str = "listingreel-videos"
    r2_public_url: str
    worker_secret: str
    next_app_url: str  # Vercel URL for status callbacks
    elevenlabs_voice_id: str = "21m00Tcm4TlvDq8ikWAM"  # Rachel
    elevenlabs_model: str = "eleven_multilingual_v2"

    # TTS provider: "elevenlabs" or "openai"
    tts_provider: str = "elevenlabs"
    openai_api_key: str | None = None
    openai_tts_model: str = "gpt-4o-mini-tts"
    openai_tts_voice: str = "coral"  # alloy, ash, ballad, coral, echo, fable, onyx, nova, sage, shimmer

    # AI video generation: "luma", "runway", or "ken_burns" (free, no API)
    video_gen_provider: str = "ken_burns"
    lumaai_api_key: str | None = None
    lumaai_model: str = "ray-flash-2"  # "ray-2" for higher quality, "ray-flash-2" for speed
    runway_api_key: str | None = None
    runway_model: str = "gen4_turbo"  # "gen3a_turbo" for cheaper
    video_gen_duration: str = "5s"  # AI video clip duration
    max_video_gen_workers: int = 3  # parallel AI video gen API calls

    # Video settings
    video_width: int = 1920
    video_height: int = 1080
    video_fps: int = 24
    video_crf: int = 16
    video_codec: str = "h265"  # "h264" or "h265"
    clip_min_duration: float = 4.0
    clip_max_duration: float = 12.0
    xfade_duration: float = 0.45
    narration_lead_in: float = 0.5
    narration_lead_out: float = 1.3
    subtitle_font_size: int = 22
    subtitle_margin_v: int = 60
    background_music_volume: float = 0.14

    # Parallelism — concurrent clip renders and TTS calls
    max_render_workers: int = 3  # parallel ffmpeg clip renders
    max_tts_workers: int = 4     # parallel TTS API calls

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
