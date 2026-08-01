import { marked } from "marked";
import { state } from "../state.js";
import { buildPromptPayload } from "../lib/promptBuilder.js";
import {
  callGenerate,
  generateChunked,
  NUM_CTX_CAP,
  OUTPUT_HEADROOM,
} from "../lib/generate.js";
import { extractVideoId } from "../lib/youtubeId.js";

const TAB_ACTIVE =
  "flex-1 py-3 text-sm font-medium text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-500 bg-indigo-50/50 dark:bg-gray-700/50";
const TAB_INACTIVE =
  "flex-1 py-3 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border-b-2 border-transparent hover:border-gray-300 dark:hover:border-gray-600 transition-colors";

/**
 * Tab switcher (Prompt Preview / Final Report) plus the prompt-assembly and
 * report-generation orchestration that ties every other panel together.
 *
 * @param {Object} deps
 * @param {{getProvider(): string, getApiKey(): string, getModel(): string}} deps.api
 * @param {{getVideoUrl(): string, getVideoTitle(): string, getDescription(): string, getChapters(): Array}} deps.videoSource
 * @param {{getValue(): string}} deps.transcript
 * @param {{getValue(): string, isFilterEnabled(): boolean}} deps.comments
 */
export function mountOutputPanel(container, deps) {
  const { api, videoSource, transcript, comments } = deps;

  container.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div class="flex border-b border-gray-200 dark:border-gray-700">
        <button id="tab-prompt" class="flex-1 py-3 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border-b-2 border-transparent hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
          Prompt Preview
        </button>
        <button id="tab-report" class="flex-1 py-3 text-sm font-medium text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-500 bg-indigo-50/50 dark:bg-gray-700/50">
          Final Report
        </button>
      </div>

      <div id="pane-prompt" class="hidden p-5">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Raw Prompt (<span id="promptTokens">~0</span> tokens)</h3>
          <button id="copyPromptBtn" class="text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-medium px-3 py-1.5 rounded-md transition-colors">
            Copy to Clipboard
          </button>
        </div>
        <pre id="promptOutput" class="bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-4 text-xs font-mono leading-relaxed text-gray-700 dark:text-gray-200 overflow-auto max-h-[600px] whitespace-pre-wrap"></pre>
      </div>

      <div id="pane-report" class="p-5 md:p-8 min-h-[400px]">
        <div id="emptyState" class="flex flex-col items-center justify-center h-64 text-center">
          <div class="w-16 h-16 bg-indigo-50 dark:bg-gray-700 rounded-full flex items-center justify-center mb-4 text-2xl">📝</div>
          <p class="text-gray-900 dark:text-white font-medium">No report generated yet</p>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-xs">Fill in the video data and click "Generate Report" or "Assemble Prompt" to see results here.</p>
        </div>
        <div id="reportOutput" class="markdown-body hidden"></div>
      </div>
    </div>
  `;

  const tabPrompt = container.querySelector("#tab-prompt");
  const tabReport = container.querySelector("#tab-report");
  const panePrompt = container.querySelector("#pane-prompt");
  const paneReport = container.querySelector("#pane-report");
  const promptOutput = container.querySelector("#promptOutput");
  const promptTokens = container.querySelector("#promptTokens");
  const emptyState = container.querySelector("#emptyState");
  const reportOutput = container.querySelector("#reportOutput");

  function switchTab(tab) {
    state.currentTab = tab;
    tabPrompt.className = tab === "prompt" ? TAB_ACTIVE : TAB_INACTIVE;
    tabReport.className = tab === "report" ? TAB_ACTIVE : TAB_INACTIVE;
    panePrompt.classList.toggle("hidden", tab !== "prompt");
    paneReport.classList.toggle("hidden", tab !== "report");
  }

  tabPrompt.addEventListener("click", () => switchTab("prompt"));
  tabReport.addEventListener("click", () => switchTab("report"));

  function currentInputs() {
    return {
      title: videoSource.getVideoTitle(),
      url: videoSource.getVideoUrl(),
      description: videoSource.getDescription(),
      rawTranscript: transcript.getValue(),
      rawComments: comments.getValue(),
      filterComments: comments.isFilterEnabled(),
      chapters: videoSource.getChapters(),
    };
  }

  function buildPrompt() {
    const payload = buildPromptPayload(currentInputs());
    state.currentPrompt = payload.userPrompt;
    promptOutput.textContent = state.currentPrompt;
    promptTokens.textContent = "~" + Math.round(payload.fullText.length / 4);
    if (state.currentTab !== "prompt") switchTab("prompt");
    emptyState.classList.add("hidden");
    reportOutput.classList.remove("hidden");
    reportOutput.innerHTML = `<div class="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm p-4 rounded-lg mb-4">Prompt assembled! Switch to the <strong>Prompt Preview</strong> tab to review or copy it, or click <strong>Generate Report</strong> to have it summarized now.</div>`;
    return payload;
  }

  function copyPrompt() {
    if (!state.currentPrompt) buildPrompt();
    navigator.clipboard.writeText(state.currentPrompt).then(() => {
      alert("Prompt copied to clipboard!");
    });
  }
  container.querySelector("#copyPromptBtn").addEventListener("click", copyPrompt);

  async function generateReport(actions) {
    const provider = api.getProvider();

    if (!state.currentPrompt) buildPrompt();
    switchTab("report");
    emptyState.classList.add("hidden");
    reportOutput.classList.remove("hidden");
    reportOutput.innerHTML = `<div class="flex items-center gap-3 text-gray-500"><div class="loader"></div><span>Building report...</span></div>`;

    const apiKey = api.getApiKey();
    const model = api.getModel();
    if (!apiKey && provider !== "local") {
      reportOutput.innerHTML = `<div class="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 p-4 rounded-lg text-sm">Please enter an AI API key for ${provider === "openai" ? "OpenAI" : "OpenRouter"} above, or switch provider to "Local (Ollama via server)". You can also click <strong>Assemble Prompt</strong> and paste it into any chat LLM manually.</div>`;
      return;
    }

    actions.setGenerating(true);
    try {
      let responseText = "";
      let warningHtml = "";
      const payload = buildPromptPayload(currentInputs());
      const systemPrompt = payload.systemPrompt;

      if (provider === "local") {
        const videoId = extractVideoId(videoSource.getVideoUrl());
        const videoTitle = videoSource.getVideoTitle() || "Untitled Video";
        const setStatus = (msg) => {
          reportOutput.innerHTML = `<div class="flex items-center gap-3 text-gray-500"><div class="loader"></div><span>${msg}</span></div>`;
        };

        // If the assembled prompt can't fit even the capped context window
        // (prompt + output headroom), fall back to map-reduce chunking.
        const approxTokens = Math.round(payload.fullText.length / 4);
        const singleShotLimit = NUM_CTX_CAP - OUTPUT_HEADROOM - 1024;
        let data;
        if (approxTokens > singleShotLimit && payload.parts.transcript) {
          data = await generateChunked(
            model,
            videoId,
            videoTitle,
            payload.parts,
            systemPrompt,
            videoSource.getVideoUrl(),
            setStatus,
          );
        } else {
          data = await callGenerate(
            systemPrompt,
            state.currentPrompt,
            model,
            videoId,
            videoTitle,
          );
        }
        responseText = data.report;
        if (data.warning) {
          warningHtml = `<div class="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg text-sm mb-4">${data.warning}</div>`;
        }
        if (data.stats) {
          const partsNote = data.parts_processed
            ? `, map-reduce over ${data.parts_processed} parts`
            : "";
          responseText += `\n\n---\n*Generated in ${data.stats.duration_s}s — ${data.stats.prompt_tokens} prompt + ${data.stats.completion_tokens} output tokens (${data.stats.tokens_per_s} tok/s, num_ctx ${data.stats.num_ctx}${partsNote})*`;
        } else if (data.parts_processed) {
          responseText += `\n\n---\n*Map-reduce over ${data.parts_processed} transcript parts*`;
        }
        if (data.saved_to) {
          responseText += `${data.stats || data.parts_processed ? "" : "\n\n---"}\n*Saved to ${data.saved_to}*`;
        }
      } else if (provider === "openai" || provider === "openrouter") {
        const endpoint =
          provider === "openrouter"
            ? "https://openrouter.ai/api/v1/chat/completions"
            : "https://api.openai.com/v1/chat/completions";
        const headers = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        };
        if (provider === "openrouter") {
          headers["HTTP-Referer"] = window.location.href;
          headers["X-Title"] = "TubeLens";
        }
        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: state.currentPrompt },
            ],
            temperature: 0.4,
            max_tokens: 4096,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data));
        responseText = data.choices[0].message.content;
      }

      reportOutput.innerHTML = warningHtml + marked.parse(responseText);
    } catch (err) {
      console.error(err);
      reportOutput.innerHTML = `
        <div class="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-400 p-4 rounded-lg text-sm mb-4">
          <p class="font-semibold">API Error</p>
          <p>${err.message}</p>
        </div>
        <div class="bg-gray-50 border border-gray-200 p-4 rounded-lg">
          <p class="text-gray-800 dark:text-gray-200">You can copy the assembled prompt and paste it into ChatGPT/Claude manually instead:</p>
          <button id="copyPromptBtn3" class="bg-gray-800 dark:bg-gray-600 hover:bg-gray-900 dark:hover:bg-gray-500 text-white text-xs font-medium px-3 py-2 rounded-md transition-colors">Copy Prompt</button>
        </div>`;
      reportOutput.querySelector("#copyPromptBtn3").addEventListener("click", copyPrompt);
    } finally {
      actions.setGenerating(false);
    }
  }

  return { buildPrompt, copyPrompt, generateReport };
}
