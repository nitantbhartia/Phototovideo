"""
ListingReel Worker — FastAPI server for Railway
Receives jobs from QStash (Vercel → QStash → Railway)
"""

import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException, Header, Request, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from config import settings
from pipeline import VideoJob, run_pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("ListingReel Worker starting up")
    yield
    logger.info("ListingReel Worker shutting down")


app = FastAPI(title="ListingReel Worker", version="1.0.0", lifespan=lifespan)


class ProcessRequest(BaseModel):
    videoId: str
    userId: str
    address: str
    propertyType: str = "Single Family"
    tone: str = "Warm & Inviting"
    imageKeys: list[str]
    autoSort: bool = True
    addMusic: bool = True


@app.get("/health")
async def health():
    return {"status": "ok", "worker": "listingreel"}


@app.post("/process")
async def process_video(
    request: Request,
    body: ProcessRequest,
    background_tasks: BackgroundTasks,
    x_worker_secret: str = Header(None, alias="x-worker-secret"),
):
    """
    Receive a video processing job.
    Supports both direct calls (x-worker-secret) and QStash calls (x-qstash-signature).
    """
    # Auth check — either worker secret or QStash signature
    qstash_sig = request.headers.get("upstash-signature")

    if not qstash_sig and x_worker_secret != settings.worker_secret:
        logger.warning("Unauthorized request to /process")
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Verify QStash signature if present
    if qstash_sig:
        try:
            from upstash_qstash import Receiver
            receiver = Receiver(
                current_signing_key=os.environ.get("QSTASH_CURRENT_SIGNING_KEY", ""),
                next_signing_key=os.environ.get("QSTASH_NEXT_SIGNING_KEY", ""),
            )
            body_bytes = await request.body()
            receiver.verify(
                signature=qstash_sig,
                body=body_bytes.decode(),
                url=str(request.url),
            )
        except Exception as e:
            logger.warning(f"QStash signature verification failed: {e}")
            raise HTTPException(status_code=401, detail="Invalid QStash signature")

    job_data = body.model_dump(by_alias=False)
    job_data["videoId"] = body.videoId
    job_data["userId"] = body.userId
    job_data["imageKeys"] = body.imageKeys

    job = VideoJob(job_data)
    logger.info(f"Received job for video {job.video_id} — {job.address}")

    # Run pipeline in background so we can return 200 immediately
    background_tasks.add_task(run_pipeline_task, job)

    return JSONResponse({"accepted": True, "videoId": job.video_id})


async def run_pipeline_task(job: VideoJob):
    """Background task wrapper for the pipeline."""
    logger.info(f"Starting pipeline for {job.video_id}")
    result = run_pipeline(job)
    if result.error:
        logger.error(f"Pipeline failed for {job.video_id}: {result.error}")
    else:
        logger.info(
            f"Pipeline complete for {job.video_id} — {result.duration_seconds}s, key={result.output_r2_key}"
        )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(
        "worker:app",
        host="0.0.0.0",
        port=port,
        reload=False,
        workers=1,  # Single worker — ffmpeg is CPU-bound, no benefit from multiple
    )
