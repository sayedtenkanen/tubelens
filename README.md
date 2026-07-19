# YouTube Lens: A simple tool to fetch YouTube video info, transcripts, and comments.

## The Server (tubelens_server.py)

A tiny FastAPI backend that runs locally:

- `/fetch` endpoint takes a YouTube URL and optionally a YouTube Data API key.
- Transcripts: Pulled instantly via youtube-transcript-api (no key needed). It even auto-converts raw seconds into [HH:MM:SS] Timestamp Text format for the UI.
- Metadata: Uses YouTube's oEmbed endpoint for title + channel.
- Description & Comments: Only if you provide a YouTube Data API key (free from Google Cloud). Without the key, you still get transcripts automatically and can paste the description manually.

### One-time setup:

```bash
pip install fastapi uvicorn youtube-transcript-api requests
python tubelens_server.py 
```

Start it and forget it. The HTML page now talks to localhost:8000 when you check "Use local server." 

### The Frontend Updates

- Added a "Use local server" toggle and an optional YouTube Data API Key field.
- When local server is active, clicking Fetch Info auto-populates:
  - Title, Description (if key provided), Transcript (always), Comments (if key provided).
- Added a CLI mode to the Python script: python tubelens_server.py --url "YOUTUBE_URL" dumps a quick markdown report straight to terminal without even opening the browser.
- Kept the fully manual fallback: if the server isn't running, everything still works exactly as before with copy-paste.

The frontend itself is still a single HTML file—just open it.
