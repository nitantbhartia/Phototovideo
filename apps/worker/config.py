from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    anthropic_api_key: str
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
    clip_max_duration: float = 8.0
    background_music_volume: float = 0.08
    xfade_duration: float = 0.8

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
