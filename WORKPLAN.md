# TubeLens — Implementation Work Plan

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
