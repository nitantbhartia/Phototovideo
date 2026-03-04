from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    llm_provider: str = "anthropic"
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-4-5"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash-lite"
    elevenlabs_api_key: str
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

    # Video settings
    video_width: int = 1920
    video_height: int = 1080
    video_fps: int = 24
    video_crf: int = 20
    clip_min_duration: float = 4.0
    clip_max_duration: float = 12.0
    xfade_duration: float = 0.45
    narration_lead_in: float = 0.5
    narration_lead_out: float = 1.3
    subtitle_font_size: int = 22
    subtitle_margin_v: int = 60
    background_music_volume: float = 0.14

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
