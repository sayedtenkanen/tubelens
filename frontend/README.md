# TubeLens frontend

Vite + vanilla JS (no framework). Built with `npm run build` and served by
`../tubelens_server.py` at `http://localhost:8000`.

## Commands

```bash
npm install       # once
npm run dev       # hot-reload dev server at localhost:5173
npm run build     # writes dist/ — tubelens_server.py serves this at "/"
npm run preview   # serve the production build locally, for a quick sanity check
```

`npm run dev` still talks to the real backend on `localhost:8000` for
`/config`, `/fetch`, `/generate`, and `/ollama/models` — start
`uv run python tubelens_server.py` in the project root alongside it.

## Layout

```
index.html            skeleton only: one <div id="mount-..."> per component
src/main.js            wires every component together (the only file that
                        knows about all of them)
src/state.js            small shared store (currentTab, currentPrompt,
                        lastFetchedVid, chapters) for cross-component state
src/dom.js              `$(id)` shorthand for document.getElementById

src/components/         each file renders its own markup into a mount div
                        and owns its own event listeners
  header.js              title + dark mode toggle
  apiConfigPanel.js       provider/model/API-key selection, local-server
                          toggle + YouTube Data API key, Ollama status
  videoSourcePanel.js     URL input, fetch button, title, description,
                          chapter parsing
  transcriptPanel.js      transcript textarea + char/token stats
  commentsPanel.js        comments textarea, Smart Filter toggle, stats
  actionButtons.js        Assemble Prompt / Generate Report buttons
  outputPanel.js          tab switching + prompt assembly + report
                          generation orchestration (the biggest one —
                          it's what ties the other panels' data together)
  howToPanel.js           static "How to use this tool" card

src/lib/                 pure logic, no DOM access — safe to unit test
  youtubeId.js            extractVideoId()
  parsing.js              parseTimestamps(), cleanComments(),
                          normalizeTranscript()
  promptBuilder.js         REPORT_INSTRUCTIONS, SYSTEM_PROMPT,
                          buildPromptPayload(), buildReducePrompt()
  ollama.js               loadConfig(), checkOllama()
  fetchVideo.js            fetchNoEmbed(), fetchFromLocalServer()
  generate.js              callGenerate(), chunkText(), generateChunked()
                          (map-reduce for long transcripts)
```

## How components talk to each other

There's no framework and no global event bus — components are wired together
explicitly in `main.js` via dependency injection. Two patterns cover
everything:

- **Getters, passed down.** `outputPanel` needs data from `videoSourcePanel`,
  `transcriptPanel`, and `commentsPanel` to assemble a prompt, so `main.js`
  passes those panels' objects in as `deps` and `outputPanel` calls
  `videoSource.getVideoTitle()`, `transcript.getValue()`, etc. on demand.
- **Subscribe callbacks, passed up.** `apiConfigPanel` owns the "use local
  server" checkbox, but `videoSourcePanel` (a sibling, not a parent) needs to
  react when it changes. `apiConfigPanel` exposes
  `onLocalServerToggle(fn)`; `main.js` doesn't even need to wire this one
  manually — `videoSourcePanel` registers directly against the `api` object
  it's handed.

If you add a ninth component that needs data from an existing one, follow the
same shape: the panel that owns a piece of state exposes a getter (or a
`clear()`/`setValue()` pair, like `transcriptPanel`/`commentsPanel` do for
`videoSourcePanel`'s "new video detected" reset), and whoever needs it takes
it as a constructor-style `deps` argument. Avoid reaching for
`document.getElementById` from outside the component that owns that element.

## Known issues (carried over from before the refactor, not fixed here)

- `outputPanel.js`'s `TAB_ACTIVE`/`TAB_INACTIVE` class strings don't carry
  `dark:` variants, so switching tabs in dark mode loses the tab's dark
  styling (the initial HTML has the right classes; the JS swap doesn't).

`apiConfigPanel.js`'s `loadConfig()` used to write the server's YouTube Data
API key into the AI-provider **API Key** field (`#apiKey`) instead of the
**YouTube Data API Key** field (`#ytApiKey`) — fixed: it now populates
`ytApiKeyInput`, and the field's help text notes it's auto-filled from
`.env`'s `YT_API_KEY`.

See the root `README.md` "Known issues" section and `WORKPLAN.md` for the
fuller history.
