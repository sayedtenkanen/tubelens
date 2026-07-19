#!/usr/bin/env python3
"""
TubeLens Local Server
Fetches transcripts (no key) and optionally comments + metadata via YouTube Data API.
Install:  pip install fastapi uvicorn youtube-transcript-api requests
Run:      python tubelens_server.py
"""
import argparse
import json
import pathlib
import datetime
import re
import requests
from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound
import uvicorn

app = FastAPI(title="TubeLens Proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

YT_DATA_API = "https://www.googleapis.com/youtube/v3"


def extract_video_id(url: str) -> str | None:
    patterns = [
        r"(?:v=|\/)([0-9A-Za-z_-]{11}).*",
        r"(?:embed\/)([0-9A-Za-z_-]{11})",
        r"(?:shorts\/)([0-9A-Za-z_-]{11})",
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    if re.match(r'^[0-9A-Za-z_-]{11}$', url):
        return url
    return None


def seconds_to_hms(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def fetch_transcript(video_id: str) -> tuple[str, str | None]:
    """Returns (transcript_text, error). One of the two is meaningful."""
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
        except Exception as e:
            return "", f"No transcript available: {e}"
    except Exception as e:
        return "", f"Transcript fetch failed: {e}"


def get_basic_meta(video_id: str) -> dict:
    try:
        r = requests.get(
            f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json",
            timeout=10,
        )
        if r.status_code == 200:
            d = r.json()
            return {"title": d.get("title", ""), "channel": d.get("author_name", "")}
    except Exception:
        pass
    return {"title": "", "channel": ""}


def get_api_meta(video_id: str, api_key: str) -> tuple[dict, str | None]:
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
    except Exception as e:
        return {}, str(e)
    return {}, None


def get_comments(video_id: str, api_key: str, max_results: int = 100) -> tuple[list[str], str | None]:
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
            text = re.sub(r'<[^>]+>', '', text)
            if text.strip():
                out.append(f"[{likes} likes] @{author}: {text.strip()}")
        return out, None
    except Exception as e:
        return [], str(e)


@app.get("/fetch")
def fetch_video(url: str, yt_api_key: str = None, refresh: bool = False):
    vid = extract_video_id(url)
    if not vid:
        return {"error": "Invalid YouTube URL"}

    # Check cache
    if not refresh:
        cache_file = CACHE_DIR / f"{vid}.json"
        if cache_file.exists():
            try:
                return json.loads(cache_file.read_text(encoding="utf-8"))
            except Exception:
                pass

    errors = []

    # Metadata
    meta = get_basic_meta(vid)
    if yt_api_key:
        api_meta, meta_error = get_api_meta(vid, yt_api_key)
        meta.update(api_meta)
        if meta_error:
            errors.append(f"Metadata: {meta_error}")

    # Transcript
    transcript, transcript_error = fetch_transcript(vid)
    if transcript_error:
        transcript = transcript_error
        errors.append(f"Transcript: {transcript_error}")

    # Comments
    comments, comments_error = get_comments(vid, yt_api_key) if yt_api_key else ([], None)
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
SUMMARIES_DIR = pathlib.Path(__file__).parent / "summaries"
CACHE_DIR = pathlib.Path(__file__).parent / "cache"


@app.post("/generate")
def generate(payload: dict = Body(...)):
    """
    payload: { "system": str, "prompt": str, "model": str,
               "num_ctx": int (default 32768), "video_id": str (optional) }
    """
    model = payload.get("model", "qwen2.5:14b")
    num_ctx = int(payload.get("num_ctx", 32768))
    approx_tokens = (len(payload.get("system", "")) + len(payload.get("prompt", ""))) // 4
    warning = None
    if approx_tokens > num_ctx * 0.9:
        warning = f"Prompt ~{approx_tokens} tokens may exceed context window ({num_ctx}). Output may miss content."
    try:
        r = requests.post(OLLAMA_URL, json={
            "model": model,
            "messages": [
                {"role": "system", "content": payload.get("system", "")},
                {"role": "user", "content": payload.get("prompt", "")},
            ],
            "temperature": 0.4,
            "max_tokens": 8192,
            "options": {"num_ctx": num_ctx},
        }, timeout=600)
        r.raise_for_status()
        text = r.json()["choices"][0]["message"]["content"]
    except requests.ConnectionError:
        return {"error": "Cannot reach Ollama at localhost:11434. Is `ollama serve` running?"}
    except Exception as e:
        return {"error": f"Generation failed: {e}"}

    saved_path = None
    vid = payload.get("video_id")
    if vid:
        SUMMARIES_DIR.mkdir(exist_ok=True)
        saved_path = str(SUMMARIES_DIR / f"{vid}-{datetime.date.today()}.md")
        pathlib.Path(saved_path).write_text(text, encoding="utf-8")

    return {"report": text, "saved_to": saved_path, "warning": warning}


# ── CLI mode (no server) ────────────────────────────────────────────────────
def cli_mode(url: str, yt_api_key: str | None):
    vid = extract_video_id(url)
    meta = get_basic_meta(vid)
    if yt_api_key:
        meta.update(get_api_meta(vid, yt_api_key))

    transcript, _ = fetch_transcript(vid)

    comments, _ = get_comments(vid, yt_api_key) if yt_api_key else ([], None)
    c_block = "\n".join(f"- {c}" for c in comments)

    md = f"""# {meta.get('title', 'Video Report')}

**Channel:** {meta.get('channel', 'Unknown')}  
**URL:** {url}

## Description
{meta.get('description', 'N/A')}

## Transcript
{transcript}

## Comments{c_block if c_block else '_No comments fetched._'}
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
