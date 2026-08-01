"""
TubeLens Local Server

Local FastAPI backend for the TubeLens personal YouTube summarizer
(frontend: frontend/ — a Vite project; run `npm run build` there before
starting this server so frontend/dist exists).

Endpoints:
    GET  /fetch     Fetch metadata, transcript, and comments for a video.
    POST /generate  Proxy an LLM call to a local Ollama instance and save the report.
    GET  /          Serves the built frontend (frontend/dist), if present.

Transcripts need no API key (youtube-transcript-api >= 1.0). Full descriptions
and comments require a free YouTube Data API v3 key. Fetches are cached in
cache/; generated reports are saved to summaries/.

Setup:  uv sync            (or: pip install fastapi uvicorn "youtube-transcript-api>=1.0" requests)
        cd frontend && npm install && npm run build && cd ..
Run:    uv run python tubelens_server.py
CLI:    uv run python tubelens_server.py --url "YOUTUBE_URL" [--yt-api-key KEY]
"""

import argparse
import datetime
import json
import logging
import os
import pathlib
import re
import time

import requests
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from youtube_transcript_api import (
    NoTranscriptFound,
    TranscriptsDisabled,
    YouTubeTranscriptApi,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("tubelens")

load_dotenv()

app = FastAPI(title="TubeLens Proxy")


@app.get("/config")
def get_config():
    """Return current configuration from environment variables."""
    import os
    return {
        "yt_api_key": os.environ.get("YT_API_KEY", "")
    }


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

YT_DATA_API = "https://www.googleapis.com/youtube/v3"


def slugify(text: str) -> str:
    """Create a filesystem-safe version of a string."""
    # Remove non-alphanumeric characters (except spaces/hyphens/underscores)
    text = re.sub(r'[^a-zA-Z0-9\s\-_]', '', text)
    # Replace spaces with hyphens and collapse multiple hyphens
    text = re.sub(r'\s+', '-', text).strip('_-')
    return text if text else "untitled"


def extract_video_id(url: str) -> str | None:
    """Extract the 11-character video ID from a YouTube URL (watch, youtu.be,
    embed, or shorts form) or return the input if it already is a bare ID.
    Returns None if no ID can be found."""
    patterns = [
        r"(?:v=|\/)([0-9A-Za-z_-]{11}).*",
        r"(?:embed\/)([0-9A-Za-z_-]{11})",
        r"(?:shorts\/)([0-9A-Za-z_-]{11})",
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    if re.match(r"^[0-9A-Za-z_-]{11}$", url):
        return url
    return None


def seconds_to_hms(seconds: float) -> str:
    """Format seconds as H:MM:SS, or M:SS when under an hour (e.g. 330 -> "5:30")."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def fetch_transcript(video_id: str) -> tuple[str, str | None]:
    """Fetch a transcript with timestamped lines ("[M:SS] text").

    Tries English first, then falls back to the first available language.
    Returns (transcript_text, None) on success or ("", error_message) on failure.
    """
    try:
        api = YouTubeTranscriptApi()
        fetched = api.fetch(video_id)
        lines = [f"[{seconds_to_hms(s.start)}] {s.text}" for s in fetched.snippets]
        return "\n".join(lines), None
    except (TranscriptsDisabled, NoTranscriptFound):
        try:
            api = YouTubeTranscriptApi()
            tlist = api.list(video_id)
            first = next(iter(tlist))
            fetched = first.fetch()
            lines = [f"[{seconds_to_hms(s.start)}] {s.text}" for s in fetched.snippets]
            return "\n".join(lines), None
        except Exception as e:    # noqa: BLE001 # catch all exceptions
            return "", f"No transcript available: {e}"
    except Exception as e:    # noqa: BLE001 # catch all exceptions
        return "", f"Transcript fetch failed: {e}"


def get_basic_meta(video_id: str) -> dict:
    """Get title and channel via YouTube's public oEmbed endpoint (no API key).
    Returns empty strings on failure — oEmbed is best-effort only."""
    try:
        r = requests.get(
            f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json",
            timeout=10,
        )
        if r.status_code == 200:
            d = r.json()
            return {"title": d.get("title", ""), "channel": d.get("author_name", "")}
    except Exception as e:    # noqa: BLE001 # catch all exceptions
        log.debug("get_basic_meta failed: %s", e)
    return {"title": "", "channel": ""}


def get_api_meta(video_id: str, api_key: str) -> tuple[dict, str | None]:
    """Get title, full description, channel, and publish date via the
    YouTube Data API v3 (requires key).
    Returns (meta_dict, None) on success or ({}, error_message) on failure."""
    try:
        r = requests.get(
            f"{YT_DATA_API}/videos",
            params={"part": "snippet", "id": video_id, "key": api_key},
            timeout=10,
        )
        data = r.json()
        if "error" in data:
            return {}, data["error"].get("message", "API error")
        items = data.get("items", [])
        if items:
            s = items[0]["snippet"]
            return {
                "title": s.get("title", ""),
                "description": s.get("description", ""),
                "channel": s.get("channelTitle", ""),
                "publishedAt": s.get("publishedAt", ""),
            }, None
    except Exception as e:  # noqa: BLE001 # catch all exceptions
        return {}, str(e)
    return {}, None


def get_comments(
    video_id: str, api_key: str, max_results: int = 100
) -> tuple[list[str], str | None]:
    """Get top comments (relevance order, single page, max 100) via the
    YouTube Data API v3. Each comment is formatted "[N likes] @author: text"
    so like counts survive into the LLM prompt.
    Returns (comments, None) on success or ([], error_message) on failure."""
    try:
        r = requests.get(
            f"{YT_DATA_API}/commentThreads",
            params={
                "part": "snippet",
                "videoId": video_id,
                "key": api_key,
                "maxResults": max_results,
                "order": "relevance",
            },
            timeout=10,
        )
        data = r.json()
        if "error" in data:
            return [], data["error"].get("message", "API error")
        out = []
        for item in data.get("items", []):
            snippet = item["snippet"]["topLevelComment"]["snippet"]
            text = snippet.get("textDisplay", "")
            author = snippet.get("authorDisplayName", "Unknown")
            likes = snippet.get("likeCount", 0)
            # strip HTML tags lightly
            text = re.sub(r"<[^>]+>", "", text)
            if text.strip():
                out.append(f"[{likes} likes] @{author}: {text.strip()}")
        return out, None
    except Exception as e:    # noqa: BLE001 # catch all exceptions
        return [], str(e)


@app.get("/fetch")
def fetch_video(url: str, yt_api_key: str | None = None, refresh: bool = False):
    """Fetch everything needed to summarize a video.

    Query params:
        url         YouTube URL (or bare video ID).
        yt_api_key  Optional YouTube Data API v3 key. Without it, only
                    title/channel (oEmbed) and transcript are returned.
        refresh     If true, bypass and overwrite the cache.

    Returns JSON: {video_id, title, channel, description, transcript,
    comments, errors}. Partial failures land in `errors` rather than
    failing the request. Successful results are cached in cache/<id>.json;
    a cached comment-less entry is ignored when a key is provided.
    """
    vid = extract_video_id(url)
    if not vid:
        return {"error": "Invalid YouTube URL"}

    # Check cache
    if not refresh:
        cache_file = CACHE_DIR / f"{vid}.json"
        if cache_file.exists():
            try:
                cached = json.loads(cache_file.read_text(encoding="utf-8"))
                # Don't serve a comment-less cached entry when a key is now provided
                if not (yt_api_key and not cached.get("comments")):
                    return cached
            except Exception as e:    # noqa: BLE001 # catch all exceptions
                log.warning("Failed to load cache for %s: %s", vid, e)

    errors = []

    # Metadata
    meta = get_basic_meta(vid)
    
    # Use provided key, or fallback to environment variable
    api_key = yt_api_key or os.environ.get("YT_API_KEY")
    
    if api_key:
        api_meta, meta_error = get_api_meta(vid, api_key)
        meta.update(api_meta)
        if meta_error:
            errors.append(f"Metadata: {meta_error}")

    # Transcript
    transcript, transcript_error = fetch_transcript(vid)
    if transcript_error:
        transcript = transcript_error
        errors.append(f"Transcript: {transcript_error}")

    # Comments
    comments, comments_error = (
        get_comments(vid, api_key) if api_key else ([], None)
    )
    if comments_error:
        errors.append(f"Comments: {comments_error}")

    result = {
        "video_id": vid,
        "title": meta.get("title", ""),
        "channel": meta.get("channel", ""),
        "description": meta.get("description", ""),
        "transcript": transcript,
        "comments": comments,
        "errors": errors,
    }

    # Cache the result (only if transcript succeeded)
    if not transcript_error:
        CACHE_DIR.mkdir(exist_ok=True)
        cache_file = CACHE_DIR / f"{vid}.json"
        cache_file.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")

    return result


OLLAMA_URL = "http://localhost:11434/v1/chat/completions"
OLLAMA_API = "http://localhost:11434"
SUMMARIES_DIR = pathlib.Path(__file__).parent / "summaries"
CACHE_DIR = pathlib.Path(__file__).parent / "cache"


@app.get("/ollama/models")
def ollama_models():
    """Proxy Ollama's /api/tags to avoid CORS issues in the browser."""
    try:
        r = requests.get(f"{OLLAMA_API}/api/tags", timeout=3)
        r.raise_for_status()
        return r.json()
    except Exception as e:    # noqa: BLE001 # catch all exceptions
        return {"error": str(e), "models": []}


@app.post("/generate")
def generate(payload: dict):
    """Proxy an LLM call to the local Ollama instance (localhost:11434).

    Request JSON:
        system    System prompt.
        prompt    User prompt (the assembled video data + instructions).
        model     Ollama model name (default "qwen2.5:14b").
        num_ctx   Context window to request (default 32768). Ollama silently
                  truncates prompts that exceed it, hence the warning below.
        video_id  Optional; when set, the report is saved to
                  summaries/<video_id>-<date>.md.

    Returns JSON: {report, saved_to, warning, stats} on success, or {error}
    if Ollama is unreachable or generation fails. `warning` is set when the
    prompt approaches or exceeds the requested context window. `stats`
    contains {prompt_tokens, completion_tokens, duration_s, tokens_per_s}
    when Ollama reports usage.
    """
    model = payload.get("model", "qwen2.5:14b")
    video_title = payload.get("video_title", "")
    num_ctx = int(payload.get("num_ctx", 32768))
    approx_tokens = (
        len(payload.get("system", "")) + len(payload.get("prompt", ""))
    ) // 4
    warning = None
    if approx_tokens > num_ctx * 0.9:
        warning = f"Prompt ~{approx_tokens} tokens may exceed context window ({num_ctx}). Output may miss content."

    log.info(
        "generate: model=%s num_ctx=%d prompt~%d tokens video_id=%s",
        model,
        num_ctx,
        approx_tokens,
        payload.get("video_id", "-"),
    )
    t0 = time.monotonic()
    try:
        r = requests.post(
            OLLAMA_URL,
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": payload.get("system", "")},
                    {"role": "user", "content": payload.get("prompt", "")},
                ],
                "temperature": 0.4,
                "max_tokens": 8192,
                "options": {"num_ctx": num_ctx},
            },
            timeout=600,
        )
        r.raise_for_status()
        body = r.json()
        text = body["choices"][0]["message"]["content"]
    except requests.ConnectionError:
        log.error("generate: cannot reach Ollama at %s", OLLAMA_URL)
        return {
            "error": "Cannot reach Ollama at localhost:11434. Is `ollama serve` running?"
        }
    except Exception as e:  # noqa: BLE001 # catch all exceptions
        log.error("generate: failed after %.1fs: %s", time.monotonic() - t0, e)
        return {"error": f"Generation failed: {e}"}

    duration = time.monotonic() - t0
    stats = None
    usage = body.get("usage") or {}
    if usage:
        prompt_tokens = usage.get("prompt_tokens", 0)
        completion_tokens = usage.get("completion_tokens", 0)
        stats = {
            "num_ctx": num_ctx,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "duration_s": round(duration, 1),
            "tokens_per_s": round(completion_tokens / duration, 1)
            if duration > 0
            else None,
        }
        log.info(
            "generate: done in %.1fs — prompt=%d completion=%d tokens (%.1f tok/s)",
            duration,
            prompt_tokens,
            completion_tokens,
            completion_tokens / duration if duration > 0 else 0,
        )
        # Real truncation check: Ollama reports post-truncation prompt size.
        # If it's near num_ctx, or far below our char-based estimate, input was cut.
        if prompt_tokens >= num_ctx * 0.95 or (
            approx_tokens > 0 and prompt_tokens < approx_tokens * 0.7
        ):
            warning = (
                f"Ollama processed {prompt_tokens} prompt tokens vs ~{approx_tokens} sent "
                f"(num_ctx={num_ctx}) — input was likely truncated. Raise num_ctx."
            )
            log.warning("generate: %s", warning)
    else:
        log.info("generate: done in %.1fs (no usage stats reported)", duration)

    saved_path = None
    vid = payload.get("video_id")
    if vid:
        SUMMARIES_DIR.mkdir(exist_ok=True)
        
        # Use slugified title if available, otherwise just use the ID
        safe_title = slugify(video_title) if video_title else ""
        filename_prefix = f"{safe_title}-{vid}" if safe_title else vid
        
        saved_path = str(
            SUMMARIES_DIR / f"{filename_prefix}-{datetime.datetime.now(datetime.UTC).date()}.md"
        )
        pathlib.Path(saved_path).write_text(text, encoding="utf-8")
        log.info("generate: report saved to %s", saved_path)

    return {"report": text, "saved_to": saved_path, "warning": warning, "stats": stats}


# Serve the built frontend (frontend/dist) at "/", if it's been built.
# Registered last so it never shadows the API routes above — Starlette
# matches routes in declaration order and only falls through to this
# catch-all mount for paths none of them handled.
FRONTEND_DIST = pathlib.Path(__file__).parent / "frontend" / "dist"
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
else:
    log.warning(
        "frontend/dist not found — run `cd frontend && npm install && npm run build` "
        "to serve the UI from this server."
    )


# ── CLI mode (no server) ────────────────────────────────────────────────────
def cli_mode(url: str, yt_api_key: str | None):
    """Print a raw markdown dump (metadata, description, transcript, comments)
    to stdout without starting the server or calling an LLM. Useful for piping
    into other tools."""
    vid = extract_video_id(url)
    if not vid:
        print(
            "Video ID could not be extracted from the URL. Please provide a valid YouTube URL or video ID."
        )
        return

    # Use provided key, or fallback to environment variable
    api_key = yt_api_key or os.environ.get("YT_API_KEY")
    
    meta = get_basic_meta(vid)
    if api_key:
        api_meta, _ = get_api_meta(vid, api_key)
        meta.update(api_meta)

    transcript, _ = fetch_transcript(vid)

    comments, _ = get_comments(vid, api_key) if api_key else ([], None)
    c_block = "\n".join(f"- {c}" for c in comments)

    md = f"""# {meta.get("title", "Video Report")}

**Channel:** {meta.get("channel", "Unknown")}
**URL:** {url}

## Description
{meta.get("description", "N/A")}

## Transcript
{transcript}

## Comments{c_block if c_block else "_No comments fetched._"}
"""
    print(md)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TubeLens local fetch server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--url", help="CLI mode: print markdown and exit")
    parser.add_argument("--yt-api-key", dest="yt_api_key", default=None)
    args = parser.parse_args()

    if args.url:
        cli_mode(args.url, args.yt_api_key)
    else:
        print(f"Starting server at http://{args.host}:{args.port}")
        uvicorn.run(app, host=args.host, port=args.port)
