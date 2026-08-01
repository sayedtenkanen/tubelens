# TubeLens — Personal YouTube Deep-Summarizer

Turn a YouTube video into a structured markdown report: summary, key takeaways, chapter-by-chapter breakdown, resources mentioned, and the best of the comment section (corrections, added resources, unanswered questions). Runs entirely on your machine; report generation defaults to a local Ollama model, so there are no API costs. If you don't have Ollama installed or running, switch the provider to OpenAI or OpenRouter in the UI and bring your own API key instead.

## How it works

```
frontend/ (Vite build)  ──►  tubelens_server.py  ──►  YouTube (transcript, metadata, comments)
   (browser UI)                (localhost:8000)  ──►  Ollama (localhost:11434, report generation)
```

Two parts do the work: `tubelens_server.py` (FastAPI backend) and `frontend/` (a small Vite + vanilla-JS project, organized into one module/component per concern — see `frontend/src/components/` and `frontend/src/lib/`). The backend serves the built frontend directly, so once it's built there's nothing else to open by hand.

## One-time setup

Requires Python 3.13+ and [uv](https://docs.astral.sh/uv/) (or plain pip), plus Node.js 18+ for the frontend build.

1. Install Python dependencies:

   ```bash
   uv sync    # or: pip install fastapi uvicorn "youtube-transcript-api>=1.0" requests
   ```

2. Build the frontend:

   ```bash
   cd frontend && npm install && npm run build && cd ..
   ```

3. Install [Ollama](https://ollama.com) and pull a model — only needed for the default "Local (Ollama via server)" provider:

   ```bash
   ollama pull qwen2.5:14b
   ```

   No Ollama, no GPU, or just don't want to run a local model? Skip this step — in the UI, set provider to **OpenAI** or **OpenRouter** (the API Key field enables automatically) and paste your own API key instead. Report generation then goes straight from your browser to that provider; everything else (fetching transcript/comments) still runs through the local server.

4. Optional but recommended: get a free [YouTube Data API v3 key](https://console.cloud.google.com/apis/library/youtube.googleapis.com). It enables auto-fetched comments and descriptions — the comment analysis is the best part of the tool. Without it you still get title, channel, and transcript; comments can be pasted manually.

## Using the tool

1. Start Ollama: `ollama serve` (skip if it already runs in the background — on most installs it does, and skip entirely if you're using OpenAI/OpenRouter instead — see step 6).
2. Start the backend from the project folder:

   ```bash
   uv run python tubelens_server.py    # serves the built UI + API at localhost:8000
   ```

3. Open `http://localhost:8000` in your browser.
4. Check **"Use local server"** and paste your YouTube API key in the field that appears (if you have one).
5. Paste a video URL and click **Fetch Info** — title, transcript, and comments fill in automatically.
6. Click **Generate Report**. Provider defaults to "Local (Ollama via server)", so no AI API key is needed. **If Ollama isn't installed or isn't running**, switch provider to **OpenAI** or **OpenRouter** — the API Key field enables automatically — and paste your own API key. No Ollama required for this path.
7. Read the report in the page; a copy is saved to `summaries/<video_id>-<date>.md`.

**Frontend development:** `cd frontend && npm run dev` starts a Vite dev server with hot reload at `http://localhost:5173` (point it at a running `tubelens_server.py` on port 8000, same as production). Run `npm run build` again whenever you're done editing so `tubelens_server.py` serves the updated build.

Refetching the same video is instant (cached in `cache/`). If a video has no transcript or has comments disabled, an amber note explains what's missing instead of failing silently.

**CLI (data dump only):** prints raw markdown (metadata + transcript + comments) to stdout without calling an LLM:

```bash
uv run python tubelens_server.py --url "https://www.youtube.com/watch?v=..." [--yt-api-key AIza...]
```

## API

`GET /fetch?url=<url>[&yt_api_key=<key>][&refresh=true]`
Returns `{video_id, title, channel, description, transcript, comments, errors}`. Comments are formatted `[N likes] @author: text`. Partial failures (bad key, no transcript) are reported in `errors` instead of failing the request.

`POST /generate` with `{system, prompt, model, num_ctx?, video_id?}`
Proxies to Ollama and returns `{report, saved_to, warning, stats}` or `{error}`. `num_ctx` defaults to 32768; the UI auto-sizes it per request (estimated prompt + 8k output headroom, rounded up to 8k steps, capped at 65536 to protect VRAM). Ollama silently truncates prompts beyond its context window, so a `warning` is returned when the prompt gets close, or when Ollama's reported token counts indicate truncation actually happened. Note: models with a 32k native context (e.g. qwen2.5) may degrade beyond it even when `num_ctx` is raised; for long videos prefer a native long-context model such as llama3.1.

**Long videos (map-reduce):** when the assembled prompt won't fit even the capped context window, the UI automatically switches to chunked generation: the transcript is split into ~20k-token parts, each part is summarized into dense notes (map), and a final call combines the notes with chapters and comments into the normal report (reduce). Progress is shown per part, and the report footer notes how many parts were processed. Only the final report is saved to `summaries/`. Tip: to keep a 32k-native model (qwen2.5) inside its comfort zone, lower `NUM_CTX_CAP` to 32768 in `frontend/src/lib/generate.js` (then `npm run build` again) — chunking will then kick in for anything over ~23k tokens. `stats` carries prompt/completion token counts, duration, and tokens/sec (also shown in the report footer in the UI).

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

## Known issues (pre-existing, not yet fixed)

Surfaced during the frontend/ refactor (Aug 2026), carried over unchanged from the old single-file HTML since fixing them wasn't in scope of that pass:

- **`outputPanel.js` `switchTab()`** class strings (`TAB_ACTIVE`/`TAB_INACTIVE`) don't include `dark:` variants, so the tab buttons lose their dark-mode styling the first time you switch tabs (the initial markup has the right dark classes; the JS-driven class swap doesn't).

~~Final Report text stayed black in dark mode~~ — fixed: the dark mode toggle now sets `.dark` on `<html>` instead of `<body>`. This was a regression introduced by the refactor, not a pre-existing issue — see `WORKPLAN.md` Task 13 for the root cause (a self-referential Tailwind `dark:` selector) and why the old single-file HTML didn't have it (a fallback rule that happened to compensate, removed during the refactor on a mistaken assumption).

~~"Call AI API directly" felt mandatory even for the Local (Ollama) provider~~ — the checkbox itself has since been removed (see below); Provider, Model, and the live Ollama status check are always available. See `WORKPLAN.md` Tasks 14–15.

~~"Call AI API directly" checkbox~~ — removed entirely. The API Key field now enables automatically based on the selected provider: disabled for Local (Ollama via server), enabled for OpenAI/OpenRouter. One less toggle to think about. See `WORKPLAN.md` Task 15.

## License

[MIT](LICENSE)

~~`apiConfigPanel.js` `loadConfig()` wrote the server's `yt_api_key` into the wrong field~~ — fixed: it now populates `ytApiKey`, and the field's help text notes it's auto-filled from `.env`'s `YT_API_KEY` (editable to override per-request).
