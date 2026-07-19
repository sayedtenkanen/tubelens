# YouTube Lens: A simple tool to fetch YouTube video info, transcripts, and comments.

## The Server (tubelens_server.py)

A tiny FastAPI backend that runs locally:

- `/fetch` endpoint takes a YouTube URL and optionally a YouTube Data API key.
- `/generate` endpoint proxies LLM calls to Ollama (no API key needed).
- Transcripts: Pulled instantly via youtube-transcript-api (no key needed). It even auto-converts raw seconds into [HH:MM:SS] Timestamp Text format for the UI.
- Metadata: Uses YouTube's oEmbed endpoint for title + channel.
- Description & Comments: Only if you provide a YouTube Data API key (free from Google Cloud). Without the key, you still get transcripts automatically and can paste the description manually.
- Caching: Results are cached in `cache/` folder. Use `refresh=true` to bypass.

### One-time setup:

```bash
pip install fastapi uvicorn "youtube-transcript-api>=1.0" requests
python tubelens_server.py 
```

### Local Ollama Setup (Optional)

For free, local AI report generation:

```bash
# Install Ollama: https://ollama.com
ollama pull qwen2.5:14b
ollama serve  # in a separate terminal
python tubelens_server.py
```

Open the HTML, select "Local (Ollama via server)" as provider, and generate reports without any API key.

### The Frontend Updates

- Added a "Use local server" toggle and an optional YouTube Data API Key field.
- When local server is active, clicking Fetch Info auto-populates:
  - Title, Description (if key provided), Transcript (always), Comments (if key provided).
- Added a CLI mode to the Python script: python tubelens_server.py --url "YOUTUBE_URL" dumps a quick markdown report straight to terminal without even opening the browser.
- Kept the fully manual fallback: if the server isn't running, everything still works exactly as before with copy-paste.
- Added "Local (Ollama via server)" provider for free, local AI report generation.
- Reports are automatically saved to `summaries/` folder.

The frontend itself is still a single HTML file—just open it.
