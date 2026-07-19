#!/usr/bin/env python3
"""
TubeLens Local Server
Fetches transcripts (no key) and optionally comments + metadata via YouTube Data API.
Install:  pip install fastapi uvicorn youtube-transcript-api requests
Run:      python tubelens_server.py
"""
import argparse
import re
import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled
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


def get_api_meta(video_id: str, api_key: str) -> dict:
    try:
        r = requests.get(
            f"{YT_DATA_API}/videos",
            params={"part": "snippet", "id": video_id, "key": api_key},
            timeout=10,
        )
        items = r.json().get("items", [])
        if items:
            s = items[0]["snippet"]
            return {
                "title": s.get("title", ""),
                "description": s.get("description", ""),
                "channel": s.get("channelTitle", ""),
                "publishedAt": s.get("publishedAt", ""),
            }
    except Exception:
        pass
    return {}


def get_comments(video_id: str, api_key: str, max_results: int = 50) -> list[str]:
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
        out = []
        for item in r.json().get("items", []):
            text = item["snippet"]["topLevelComment"]["snippet"].get("textDisplay", "")
            # strip HTML tags lightly
            text = re.sub(r'<[^>]+>', '', text)
            if text.strip():
                out.append(text.strip())
        return out
    except Exception:
        return []


@app.get("/fetch")
def fetch_video(url: str, yt_api_key: str = None):
    vid = extract_video_id(url)
    if not vid:
        return {"error": "Invalid YouTube URL"}

    # Metadata
    meta = get_basic_meta(vid)
    if yt_api_key:
        meta.update(get_api_meta(vid, yt_api_key))

    # Transcript
    try:
        tdata = YouTubeTranscriptApi.get_transcript(vid)
        transcript = "\n".join(
            f"[{seconds_to_hms(d['start'])}] {d['text']}" for d in tdata
        )
    except TranscriptsDisabled:
        transcript = "Transcripts are disabled for this video."
    except Exception as e:
        transcript = f"Error fetching transcript: {e}"

    # Comments
    comments = get_comments(vid, yt_api_key) if yt_api_key else []

    return {
        "video_id": vid,
        "title": meta.get("title", ""),
        "channel": meta.get("channel", ""),
        "description": meta.get("description", ""),
        "transcript": transcript,
        "comments": comments,
    }


# ── CLI mode (no server) ────────────────────────────────────────────────────
def cli_mode(url: str, yt_api_key: str | None):
    vid = extract_video_id(url)
    meta = get_basic_meta(vid)
    if yt_api_key:
        meta.update(get_api_meta(vid, yt_api_key))

    try:
        tdata = YouTubeTranscriptApi.get_transcript(vid)
        transcript = "\n".join(
            f"[{seconds_to_hms(d['start'])}] {d['text']}" for d in tdata
        )
    except Exception as e:
        transcript = str(e)

    comments = get_comments(vid, yt_api_key) if yt_api_key else []
    c_block = "\n".join(f"- {c}" for c in comments[:20])

    md = f"""# {meta.get('title', 'Video Report')}

**Channel:** {meta.get('channel', 'Unknown')}  
**URL:** {url}

## Description
{meta.get('description', 'N/A')[:1500]}

## Transcript
{transcript[:3000]}...

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