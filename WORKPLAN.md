# TubeLens — Implementation Work Plan

> **Historical record.** The tasks below describe the project's original build-out and were completed against the single-file `tubelens-personal.html` frontend. That file was later split into a componentized `frontend/` (Vite + vanilla JS) project — see `frontend/src/components/` and `frontend/src/lib/`, and the "How it works" section of `README.md` for the current structure. Left as-is for history; don't use it as a guide to the current file layout.

Instructions for the implementing model: Execute the tasks below **in order**. Make only the changes specified. Do not refactor unrelated code, rename variables, reformat files, or add dependencies beyond those listed. After each task, run its acceptance check before moving on.

## Repo context

Three files in this folder:

- `tubelens-server.py` — FastAPI local server. Endpoint `GET /fetch` returns `{video_id, title, channel, description, transcript, comments}`. Also has a CLI mode (`--url`).
- `tubelens-personal.html` — single-file frontend. Builds a prompt from fetched data and either copies it to clipboard or calls an LLM API directly from the browser.
- `README.md` — setup instructions.

Target setup: the user runs a **local model via Ollama** (OpenAI-compatible API at `http://localhost:11434/v1`). All LLM calls should be routed through the Python server, not the browser.

Dependencies allowed: `fastapi`, `uvicorn`, `youtube-transcript-api` (>=1.0), `requests`. Nothing else.

---

## Task 1 — Fix filename mismatch

The file is `tubelens-server.py` but README, HTML help text, and the HTML error message all reference `tubelens_server.py`.

**Do:** Rename `tubelens-server.py` → `tubelens_server.py`. Verify all references now match: README lines mentioning the filename, the HTML "How to use" section, and the fetch-error message in `fetchFromLocalServer()`.

**Accept:** `grep -r "tubelens-server" .` returns nothing; `python tubelens_server.py --help` runs.

## Task 2 — Migrate to youtube-transcript-api v1.x

`YouTubeTranscriptApi.get_transcript(vid)` is the old pre-1.0 static API. v1.x uses an instance method that returns objects, not dicts.

**Do:** In both `fetch_video()` and `cli_mode()`, replace the transcript fetch with a call to one shared helper:

```python
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound

def fetch_transcript(video_id: str) -> tuple[str, str | None]:
    """Returns (transcript_text, error). One of the two is meaningful."""
    try:
        api = YouTubeTranscriptApi()
        fetched = api.fetch(video_id)  # tries English by default
        lines = [f"[{seconds_to_hms(s.start)}] {s.text}" for s in fetched.snippets]
        return "\n".join(lines), None
    except (TranscriptsDisabled, NoTranscriptFound):
        # fall back to any available language
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
```

Note: snippet objects expose `.start` and `.text` attributes (not `d['start']`). If the installed library version errors on `api.fetch`, check `pip show youtube-transcript-api`; require `>=1.0` in README's install line: `pip install "youtube-transcript-api>=1.0"`.

**Accept:** `python tubelens_server.py --url "https://www.youtube.com/watch?v=dQw4w9WgXcQ"` prints a transcript with `[M:SS]` prefixes.

## Task 3 — Include like counts and authors in comments

The prompt asks the LLM for "upvote weight" but the server discards `likeCount`, forcing hallucination.

**Do:** In `get_comments()`, extract `likeCount` and `authorDisplayName` from each item's `snippet.topLevelComment.snippet`. Return a list of strings formatted:

```
[{likeCount} likes] @{authorDisplayName}: {text}
```

Keep the existing HTML-tag stripping. Raise `max_results` default from 50 to 100 (API max per page; do not paginate).

**Accept:** With a valid `--yt-api-key`, CLI output shows comments prefixed with `[N likes] @author:`.

## Task 4 — Surface errors instead of swallowing them

Every fetcher currently does `except Exception: return {}/[]`, so a bad API key is indistinguishable from "no comments".

**Do:**

1. `get_comments()`: return `tuple[list[str], str | None]` — `(comments, error)`. On HTTP error or exception, put a short reason in `error` (include the API's error message from `r.json()["error"]["message"]` when present).
2. `get_api_meta()`: same pattern — `(meta_dict, error)`.
3. `fetch_video()`: collect errors into a list and add `"errors": [...]` to the JSON response. Use `fetch_transcript()`'s error from Task 2 the same way.
4. In the HTML `fetchFromLocalServer()`: after a successful fetch, if `data.errors && data.errors.length`, show them in the `fetchStatus` element in amber (`text-amber-600`) instead of the green success message.

**Accept:** Calling `/fetch` with `yt_api_key=INVALID` returns HTTP 200 with populated `errors` array; the UI displays the message.

## Task 5 — Fix comment-boundary destruction in Smart Filter

Comments are joined with `\n---\n` in the textarea, but `cleanComments()` filters line-by-line and drops `---` (length < 4), merging all comments into one blob.

**Do:** In `cleanComments()` in the HTML: split the raw text on `/\n---\n/` into whole comments first. Apply the existing spam filters **per comment** (test the comment's first line against `spamPatterns`; keep multi-line comments intact). Re-join surviving comments with `\n---\n`. Also: do not filter out comments matching `^\[\d+ likes\]` — the new Task 3 prefix must survive filtering.

**Accept:** Paste two multi-line comments separated by `---`, enable Smart Filter, click Assemble Prompt — the prompt preview shows both comments still separated by `---`.

## Task 6 — Add `/generate` endpoint (Ollama proxy) + report saving

Route LLM calls through the server to avoid browser CORS and control context size.

**Do:** Add to `tubelens_server.py`:

```python
import json, pathlib, datetime
from fastapi import Body

OLLAMA_URL = "http://localhost:11434/v1/chat/completions"
SUMMARIES_DIR = pathlib.Path(__file__).parent / "summaries"

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
```

Note: Ollama accepts `options.num_ctx` on its OpenAI-compatible route; if the installed Ollama version ignores it there, that's acceptable — leave the field in place and mention in README that users can alternatively set context via a Modelfile.

**Accept:** With Ollama running, `curl -X POST localhost:8000/generate -H 'Content-Type: application/json' -d '{"system":"You are terse.","prompt":"Say OK.","model":"<any pulled model>"}'` returns `{"report": "..."}`. With Ollama stopped, it returns the friendly error.

## Task 7 — Frontend: add "Local (Ollama)" provider routed via server

**Do:** In `tubelens-personal.html`:

1. Add `<option value="local">Local (Ollama via server)</option>` as the **first/default** option in the `#provider` select.
2. In the provider-change model map, add `local: 'qwen2.5:14b'`.
3. Set the initial `#model` input value to `qwen2.5:14b`.
4. In `generateReport()`, add a branch: when provider is `local`, POST to `http://localhost:8000/generate` with `{system, prompt, model, video_id}` (extract `video_id` from the URL field using a copy of the server's regex, or send the raw URL and let existing code stand — simplest: add a tiny JS `extractVideoId()` mirroring the Python one). No API key required — skip the key check for this provider.
5. On success: render `data.report` via `marked.parse`; if `data.saved_to`, append a small gray line "Saved to {path}"; if `data.warning`, show it in an amber banner above the report.
6. On `data.error`, show it in the existing red error box (keep the copy-prompt fallback).
7. Keep the OpenAI/OpenRouter direct-browser paths unchanged. **Remove the Anthropic option** (user doesn't use it and the path is broken by CORS).
8. Update the API-key helper text to note the key is unused for Local provider.

**Accept:** With server + Ollama running: paste URL → Fetch Info → Generate Report produces a rendered report with no API key entered, and a file appears in `summaries/`.

## Task 8 — Cache raw fetches

**Do:** In `fetch_video()`: before fetching, check `cache/{video_id}.json` (create `cache/` next to the script). If present, return it. After a successful fetch, write the response dict there. Add query param `refresh: bool = False` that bypasses and overwrites the cache. Do not cache responses where the transcript failed.

**Accept:** Second `/fetch` call for the same video returns instantly; `cache/<id>.json` exists; `/fetch?...&refresh=true` re-downloads.

## Task 9 — Small fixes

1. **Chapter regex:** in `parseTimestamps()`, make the dash separator optional so `0:00 Intro` parses. Replace the regex with: `/^(?:\s*)(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:[—–\-:]\s*)?(.+)$/gm`
2. **CLI truncation:** in `cli_mode()`, remove the `[:3000]` and `[:1500]` slices — print full transcript and description.
3. **README:** update install line to `pip install fastapi uvicorn "youtube-transcript-api>=1.0" requests`; document the Local (Ollama) flow: `ollama pull qwen2.5:14b`, start `ollama serve`, start `python tubelens_server.py`, open the HTML, provider "Local". Mention `summaries/` and `cache/` folders and the `refresh=true` param.

**Accept:** A description line `0:00 Intro` yields a parsed chapter; CLI prints untruncated output; README matches reality.

## Task 10 — Final verification pass

Run through this checklist and report results:

1. `python tubelens_server.py` starts clean (no import errors).
2. `/fetch` on a real video: transcript has timestamps, comments have `[N likes] @author:` prefixes, `errors` is empty.
3. `/fetch` with bad YT key: `errors` populated, transcript still present.
4. Full UI flow with Ollama: Fetch Info → Generate Report → report rendered + saved to `summaries/`.
5. Smart Filter preserves `---` boundaries and like-count prefixes.
6. `grep -rn "tubelens-server\|get_transcript\|claude-3-5\|anthropic" *.py *.html README.md` → only acceptable hits (none expected).

Do not mark the work complete until every item passes.

---

## Task 11 — Frontend refactor: single-file HTML → componentized Vite project (2026-08-01)

`tubelens-personal.html` (1,374 lines: markup + a `<style>` block + one flat
`<script>` with ~30 top-level functions) was split into `frontend/`, a Vite +
vanilla-JS project with a real Tailwind build (PostCSS, not the CDN script)
and one module/component per concern. `tubelens-personal.html` was deleted;
`tubelens_server.py` now mounts `frontend/dist` at `/` via
`StaticFiles(html=True)`, registered after all API routes so it never shadows
them.

**Layout:** see `frontend/README.md` for the full breakdown
(`src/components/*.js` — one per UI panel, each owns its markup + listeners;
`src/lib/*.js` — pure logic, no DOM access; `src/main.js` — wires components
together via dependency injection, no framework/event bus).

**Behavior parity:** this was a structural port, not a rewrite — no feature
changes intended. Verified via:
- A full build (`npm run build`) with zero warnings.
- An end-to-end functional smoke test (jsdom + mocked `fetch`) covering
  mounting, dark mode, provider switching, the local-server toggle, video
  fetch → transcript/comments/chapter population, prompt assembly, report
  generation (including the map-reduce chunked path), and copy-to-clipboard.
- The live FastAPI static mount, curl-verified against a real build.
- The existing `test_tubelens.py` suite (unaffected — it only exercises
  `tubelens_server.py`, which only gained an import, a docstring update, and
  the static-mount block).

**Two pre-existing bugs surfaced during the port, deliberately left
unfixed** at the time (out of scope for a structural refactor — see root
`README.md` "Known issues"):
1. ~~`loadConfig()` (now in `frontend/src/components/apiConfigPanel.js`)
   wrote the server's `yt_api_key` into the AI-provider API-key field instead
   of the YouTube Data API key field.~~ **Fixed 2026-08-01** (see Task 12
   below) — it was purely cosmetic in effect (`/fetch` already falls back to
   `.env`'s `YT_API_KEY` server-side regardless of what the UI sends), but
   it meant the UI never showed that the key was already active.
2. `switchTab()` (now in `frontend/src/components/outputPanel.js`)'s active/
   inactive class strings lack `dark:` variants, so tab styling loses its
   dark-mode look after the first tab switch. Still open.

**New dev workflow:** `cd frontend && npm install && npm run build`, then
`uv run python tubelens_server.py` and open `http://localhost:8000` (was:
double-click `tubelens-personal.html`). `cd frontend && npm run dev` gives a
hot-reload dev server at `localhost:5173` against the same backend.

**CI** (`.github/workflows/ci.yml`) now also sets up Node and runs
`npm ci && npm run build` in `frontend/`, so a broken frontend build fails
the pipeline the same way a broken Python import would.

## Task 12 — Fix `loadConfig()` yt-api-key mix-up (2026-08-01)

User asked why the "YouTube Data API Key (optional)" field exists at all
given `.env` already feeds `YT_API_KEY` server-side. Answer: `/fetch` already
falls back to `.env` when the field is blank, so the field is genuinely
optional whenever `.env` is set — it exists for people without a `.env`, or
to override the key for a single request. The confusion was caused by Task
11's bug 1: `loadConfig()` wrote the `.env` key into the wrong input, so the
field never visibly reflected that a key was already active.

**Do (done):** In `frontend/src/components/apiConfigPanel.js`, changed
`loadConfig().then((ytKey) => { if (ytKey) apiKeyInput.value = ytKey; })` to
set `ytApiKeyInput.value` instead. Updated the field's help text to say it's
auto-filled from `.env`'s `YT_API_KEY` and can be overridden per-request.

**Accept:** Verified via the jsdom smoke-test harness (see Task 11) with a
mocked `/config` response — `#ytApiKey` receives the key, `#apiKey` stays
empty. Rebuilt (`npm run build`) clean.

**Not done as part of this task** (flagged, not silently fixed): Task 11's
bug 2 (dark-mode tab classes) is still open.

## Task 13 — Fix dark-mode text color regression in Final Report (2026-08-01)

User reported: report text stays black in dark mode. Root cause was a
**regression introduced by the Task 11 refactor**, not a pre-existing bug.

`header.js`'s dark mode toggle does
`document.body.classList.toggle("dark")` — same as the original single-file
HTML. With Tailwind's `darkMode: 'class'`, `dark:*` utilities compile to
`.dark\:text-white:is(.dark *)`: the element must be a *descendant* of
`.dark`, and an element is never its own descendant. So `<body
class="... dark:bg-gray-900 dark:text-white">` never actually applies its
own `dark:` utilities to itself — only elements nested inside body correctly
inherit the ancestor-descendant relationship. Confirmed directly in the
compiled CSS: `.dark\:text-white:is(.dark *){color:rgb(255 255
255/var(--tw-text-opacity,1))}`.

This didn't matter for the card panels (`bg-white dark:bg-gray-800`, etc.) —
they're descendants of body and their own `dark:` classes apply fine. It did
matter for `.markdown-body p`/`li` in the AI-generated report: those have no
color of their own (see `frontend/src/style.css`) and just inherit from
body, which itself silently never switched to white.

The **original** single-file HTML masked this exact same root-cause bug with
a hand-written non-Tailwind fallback rule: `.dark body, .dark #app {
background-color: #111827; color: #ffffff; }`. The `.dark body` half never
matched either (same self-reference problem) — but `.dark #app` did, because
`#app` is a genuine descendant div of body, and its explicit
`color: #ffffff` cascaded down to the report text via normal CSS
inheritance. Task 11 removed that fallback block on the reasoning that "real
Tailwind doesn't need a CDN workaround" — true for every *other* dark:
utility, but wrong here: the bug was never about CDN vs. build-time Tailwind,
it was the self-referential `.dark`-on-body toggle. Removing the fallback
took away the thing that happened to compensate for it.

**Do (done):** In `frontend/src/components/header.js`, toggle
`document.documentElement.classList` (i.e. `<html>`) instead of
`document.body.classList`. This is also Tailwind's own recommended
convention. With `.dark` on `<html>`, `<body>` becomes a real descendant and
its own `dark:bg-gray-900`/`dark:text-white` classes apply correctly, which
fixes the report text color via normal inheritance — no markdown-specific
CSS or `#app`-targeted rule needed.

**Accept:** Rebuilt (`npm run build`) clean. Verified via the jsdom
smoke-test harness that the `dark` class lands on `document.documentElement`
after toggling and the rest of the flow (fetch → assemble → generate →
copy) is unaffected. (jsdom's CSS cascade engine isn't reliable enough to
assert computed color directly — the fix is verified by matching Tailwind's
documented/compiled selector semantics, not by pixel-checking in this
harness. Visual confirmation of white report text in dark mode is still
worth a manual look in a real browser.)

## Task 14 — Decouple "Call AI API directly" from Local/Ollama fields (2026-08-01)

User asked whether it's a mistake that "Call AI API directly" seemed
necessary to check even when using the Local (Ollama) provider. It was: a
genuine inconsistency between `outputPanel.js`'s stated intent and
`apiConfigPanel.js`'s actual behavior.

`outputPanel.js`'s `generateReport()` has always had an explicit comment and
guard for this: `if (!useApi && provider !== "local") { ...; return; }` —
i.e. Local is never gated behind the checkbox, by design. But
`apiConfigPanel.js` wrapped the **entire** `#apiFields` block — AI Provider
select, Model input/select, and the Ollama status line — in
`opacity-50 pointer-events-none` whenever the checkbox was unchecked. So in
practice: with the checkbox off (its default state), the user couldn't
change the Model field if their installed Ollama model didn't match the
hardcoded default (`qwen2.5:14b`), couldn't see Ollama connection status,
and the whole card looked disabled — even though the backend code path for
Local never actually depended on the checkbox. The panel just didn't honor
its own documented intent.

**Do (done):** In `frontend/src/components/apiConfigPanel.js`:
- Split the old single `#apiFields` wrapper into two: the AI Provider select
  and Model field are now always interactive; only the new `#apiKeyField`
  (just the API Key input) is gated by the checkbox, since that's the only
  field that's actually about sending a key straight from the browser to a
  cloud provider.
- `refreshOllamaModels()` (the live Ollama status + installed-model list
  check) now also runs unconditionally on initial mount whenever the
  provider is `"local"`, instead of only when the checkbox was checked.
  Switching the provider dropdown to `"local"` already triggered this; now
  the initial page load does too.
- Updated the API Key field's help text to clarify it "only applies when
  'Call AI API directly' is checked."

**Accept:** Rebuilt (`npm run build`) clean. Re-ran the jsdom smoke-test
harness: confirmed `/ollama/models` (and its direct-Ollama fallback) now
fire on initial mount before any checkbox interaction, and the full flow —
fetch → assemble → **generate via Local provider** → copy — completes
successfully with the "Call AI API directly" checkbox never checked at any
point in the run.

## Task 15 — Remove "Call AI API directly" checkbox entirely (2026-08-01)

Follow-up to Task 14. User asked: instead of a checkbox that only gated the
API Key field (and even then, imperfectly — see Task 14), why not just
enable that field automatically based on which provider is selected? Simpler
mental model: Local never needs a key, cloud providers always do, so the
field's state should just follow the provider directly.

**Do (done):**
- `frontend/src/components/apiConfigPanel.js`: removed the `#useApi`
  checkbox and its label from the markup entirely. `syncApiKeyFieldState()`
  now reads `providerSelect.value !== "local"` instead of a checkbox, and
  runs on the provider `<select>`'s `change` event (previously only ran on
  the checkbox's `change` event). Removed `isUsingApi` from the panel's
  returned API — nothing needs it anymore.
- `frontend/src/components/outputPanel.js`: `generateReport()` no longer
  reads `isUsingApi()`. Deleted the "Prompt Ready — you chose not to use a
  key" fallback branch entirely: it was existing only to serve people who
  wanted a copy-the-prompt-manually flow via an unchecked checkbox +
  Generate Report, which was always redundant with the separate **Assemble
  Prompt** button that already does exactly that for any provider. The
  remaining "no API key" error message for cloud providers now names the
  specific provider and points at both alternatives (switch to Local, or
  use Assemble Prompt).
- Updated the API Key field's help text, `frontend/src/components/
  howToPanel.js`, and `README.md` to describe the field as auto-enabling
  with provider selection instead of referencing a checkbox.

**Accept:** Rebuilt (`npm run build`) clean. Extended the jsdom smoke-test
harness to confirm: `#apiKeyField` is disabled at load (default provider
Local), enables when switching to `openai`, disables again when switching
back to `local`, and `#useApi` no longer exists in the DOM at all.
Generating a report with provider `openai` and no key set produces the new
named-provider error message without throwing.
