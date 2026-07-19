# TubeLens — Personal YouTube Deep-Summarizer

Turn a YouTube video into a structured markdown report: summary, key takeaways, chapter-by-chapter breakdown, resources mentioned, and the best of the comment section (corrections, added resources, unanswered questions). Runs entirely on your machine; report generation uses a local Ollama model, so there are no API costs.

## How it works

```
tubelens-personal.html  ──►  tubelens_server.py  ──►  YouTube (transcript, metadata, comments)
      (browser UI)               (localhost:8000)  ──►  Ollama (localhost:11434, report generation)
```

Two files do the work: `tubelens_server.py` (FastAPI backend) and `tubelens-personal.html` (single-file frontend — just open it in a browser).

## One-time setup

Requires Python 3.13+ and [uv](https://docs.astral.sh/uv/) (or plain pip).

1. Install Python dependencies:

   ```bash
   uv sync    # or: pip install fastapi uvicorn "youtube-transcript-api>=1.0" requests
   ```

2. Install [Ollama](https://ollama.com) and pull a model:

   ```bash
   ollama pull qwen2.5:14b
   ```

3. Optional but recommended: get a free [YouTube Data API v3 key](https://console.cloud.google.com/apis/library/youtube.googleapis.com). It enables auto-fetched comments and descriptions — the comment analysis is the best part of the tool. Without it you still get title, channel, and transcript; comments can be pasted manually.

## Using the tool

1. Start Ollama: `ollama serve` (skip if it already runs in the background — on most installs it does).
2. Start the backend from the project folder:

   ```bash
   uv run python tubelens_server.py    # serves at localhost:8000
   ```

3. Open `tubelens-personal.html` in your browser (double-click the file).
4. Check **"Use local server"** and paste your YouTube API key in the field that appears (if you have one).
5. Paste a video URL and click **Fetch Info** — title, transcript, and comments fill in automatically.
6. Click **Generate Report**. Provider defaults to "Local (Ollama via server)", so no AI API key is needed. OpenAI and OpenRouter are available as cloud alternatives (bring your own key).
7. Read the report in the page; a copy is saved to `summaries/<video_id>-<date>.md`.

Refetching the same video is instant (cached in `cache/`). If a video has no transcript or has comments disabled, an amber note explains what's missing instead of failing silently.

**CLI (data dump only):** prints raw markdown (metadata + transcript + comments) to stdout without calling an LLM:

```bash
uv run python tubelens_server.py --url "https://www.youtube.com/watch?v=..." [--yt-api-key AIza...]
```

## API

`GET /fetch?url=<url>[&yt_api_key=<key>][&refresh=true]`
Returns `{video_id, title, channel, description, transcript, comments, errors}`. Comments are formatted `[N likes] @author: text`. Partial failures (bad key, no transcript) are reported in `errors` instead of failing the request.

`POST /generate` with `{system, prompt, model, num_ctx?, video_id?}`
Proxies to Ollama and returns `{report, saved_to, warning, stats}` or `{error}`. `num_ctx` defaults to 32768 — Ollama silently truncates prompts beyond its context window, so a `warning` is returned when the prompt gets close, or when Ollama's reported token counts indicate truncation actually happened. `stats` carries prompt/completion token counts, duration, and tokens/sec (also shown in the report footer in the UI).

## Observability

The server logs every generation to the terminal it runs in: model, requested `num_ctx`, estimated prompt size at start; actual prompt/completion tokens, duration, and tok/s on completion; a WARNING line when truncation is detected; and the save path. Watch that terminal while a report generates — it's the only live view of the Ollama stage. For deeper debugging, Ollama's own logs (`ollama serve` output, or `OLLAMA_DEBUG=1 ollama serve`) show model loading, GPU/CPU layer split, and actual context allocation.

## Caching

Fetch results are cached in `cache/<video_id>.json`; repeat fetches are instant and free. `refresh=true` bypasses and rewrites the cache. A cached entry with no comments is automatically refetched when an API key is provided later. `cache/` and `summaries/` are gitignored.

## Development

```bash
uv sync --dev
uv run pytest        # mocked test suite, no network needed
```

CI (GitHub Actions, `.github/workflows/ci.yml`) runs the suite on every push and PR to `main`.

## Notes & limitations

- `youtube-transcript-api` is unofficial; it works reliably from residential IPs but YouTube blocks datacenter IPs. This tool is meant to run locally.
- Comments: one page of up to 100 top-level comments, relevance-ordered. No replies.
- Transcript language: English preferred, falls back to the first available language.
- Report quality depends on the model. 7–8B models follow the format but miss cross-references (e.g. linking a comment correction to the right video segment); 14B+ recommended.
