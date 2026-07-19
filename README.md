# TubeLens — Personal YouTube Deep-Summarizer

Turn a YouTube video into a structured markdown report: summary, key takeaways, chapter-by-chapter breakdown, resources mentioned, and the best of the comment section (corrections, added resources, unanswered questions). Runs entirely on your machine; report generation uses a local Ollama model, so there are no API costs.

## How it works

```
tubelens-personal.html  ──►  tubelens_server.py  ──►  YouTube (transcript, metadata, comments)
      (browser UI)               (localhost:8000)  ──►  Ollama (localhost:11434, report generation)
```

Two files do the work: `tubelens_server.py` (FastAPI backend) and `tubelens-personal.html` (single-file frontend — just open it in a browser).

## Setup

Requires Python 3.13+ and [uv](https://docs.astral.sh/uv/) (or plain pip).

```bash
uv sync                                  # or: pip install fastapi uvicorn "youtube-transcript-api>=1.0" requests
uv run python tubelens_server.py         # starts the server at localhost:8000
```

For report generation, install [Ollama](https://ollama.com) and pull a model:

```bash
ollama pull qwen2.5:14b
ollama serve
```

Optional: a free [YouTube Data API v3 key](https://console.cloud.google.com/apis/library/youtube.googleapis.com) enables auto-fetched descriptions and comments. Without it you still get title, channel, and transcript; comments can be pasted manually.

## Usage

**Browser (main flow):** open `tubelens-personal.html`, enable "Use local server", paste a YouTube URL, click **Fetch Info**, then **Generate Report**. With provider "Local (Ollama via server)" — the default — no AI API key is needed. Reports are rendered in the page and saved to `summaries/<video_id>-<date>.md`. OpenAI and OpenRouter are available as cloud alternatives (bring your own key).

**CLI (data dump only):** prints raw markdown (metadata + transcript + comments) to stdout without calling an LLM:

```bash
uv run python tubelens_server.py --url "https://www.youtube.com/watch?v=..." [--yt-api-key AIza...]
```

## API

`GET /fetch?url=<url>[&yt_api_key=<key>][&refresh=true]`
Returns `{video_id, title, channel, description, transcript, comments, errors}`. Comments are formatted `[N likes] @author: text`. Partial failures (bad key, no transcript) are reported in `errors` instead of failing the request.

`POST /generate` with `{system, prompt, model, num_ctx?, video_id?}`
Proxies to Ollama and returns `{report, saved_to, warning}` or `{error}`. `num_ctx` defaults to 32768 — Ollama silently truncates prompts beyond its context window, so a `warning` is returned when the prompt gets close.

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
