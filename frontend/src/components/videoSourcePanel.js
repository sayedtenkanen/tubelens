import { extractVideoId } from "../lib/youtubeId.js";
import { fetchNoEmbed, fetchFromLocalServer } from "../lib/fetchVideo.js";
import { parseTimestamps } from "../lib/parsing.js";
import { state } from "../state.js";

/**
 * "Video Source" panel: URL input, fetch button, title, description +
 * chapter parsing.
 *
 * @param {Object} deps
 * @param {() => boolean} deps.isUsingLocalServer
 * @param {() => string} deps.getYtApiKey
 * @param {(fn: (checked: boolean) => void) => void} deps.onLocalServerToggle
 * @param {{clear(): void, setValue(text: string): void}} deps.transcript
 * @param {{clear(): void, setValue(text: string): void}} deps.comments
 */
export function mountVideoSourcePanel(container, deps) {
  const { isUsingLocalServer, getYtApiKey, onLocalServerToggle, transcript, comments } =
    deps;

  container.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">Video Source</h2>
      <div class="space-y-3">
        <div>
          <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">YouTube URL</label>
          <div class="flex gap-2">
            <input type="text" id="videoUrl" placeholder="https://www.youtube.com/watch?v=..." class="flex-1 rounded-lg border-gray-300 dark:border-gray-600 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 py-2 px-3 border bg-white dark:bg-gray-700 dark:text-white">
            <button id="fetchBtn" disabled class="bg-gray-900 dark:bg-gray-700 hover:bg-gray-800 dark:hover:bg-gray-600 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed">Fetch Info</button>
          </div>
          <p id="fetchStatus" class="text-[11px] text-gray-400 dark:text-gray-500 mt-1 h-4"></p>
        </div>

        <div>
          <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
          <input type="text" id="videoTitle" class="w-full rounded-lg border-gray-300 dark:border-gray-600 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 py-2 px-3 border bg-white dark:bg-gray-700 dark:text-white">
        </div>

        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">Description</label>
            <button id="parseChaptersBtn" class="text-[11px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium">Parse Chapters</button>
          </div>
          <textarea id="description" placeholder="Paste the video description (with timestamps)..." class="w-full rounded-lg border-gray-300 dark:border-gray-600 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-3 border font-mono text-xs leading-relaxed bg-white dark:bg-gray-700 dark:text-white"></textarea>
          <p id="chapterCount" class="text-[11px] text-indigo-600 dark:text-indigo-400 mt-1 h-4"></p>
        </div>
      </div>
    </div>
  `;

  const videoUrlInput = container.querySelector("#videoUrl");
  const fetchBtn = container.querySelector("#fetchBtn");
  const fetchStatus = container.querySelector("#fetchStatus");
  const videoTitleInput = container.querySelector("#videoTitle");
  const descriptionTextarea = container.querySelector("#description");
  const chapterCount = container.querySelector("#chapterCount");
  const parseChaptersBtn = container.querySelector("#parseChaptersBtn");

  function runParseTimestamps() {
    const chapters = parseTimestamps(descriptionTextarea.value);
    state.chapters = chapters;
    chapterCount.textContent = chapters.length
      ? `✓ Parsed ${chapters.length} chapters`
      : "No chapter timestamps detected.";
    return chapters;
  }

  function resetFieldsIfNewVideo(url) {
    // Clear stale data from the previous video so empty fields on the new
    // one don't silently keep old content. Same-video refetches keep
    // manually pasted data intact.
    const vid = extractVideoId(url);
    if (vid && vid !== state.lastFetchedVid) {
      videoTitleInput.value = "";
      descriptionTextarea.value = "";
      chapterCount.textContent = "";
      state.chapters = [];
      transcript.clear();
      comments.clear();
      state.lastFetchedVid = vid;
    }
  }

  async function handleFetch() {
    const url = videoUrlInput.value.trim();

    if (isUsingLocalServer()) {
      if (!url) {
        fetchStatus.textContent = "Please enter a YouTube URL.";
        fetchStatus.className =
          "text-[11px] text-amber-600 dark:text-amber-400 mt-1 h-4";
        return;
      }
      resetFieldsIfNewVideo(url);
      fetchStatus.textContent = "Contacting localhost:8000...";
      fetchStatus.className =
        "text-[11px] text-indigo-600 dark:text-indigo-400 mt-1 h-4";
      try {
        const data = await fetchFromLocalServer(url, getYtApiKey());
        if (data.title) videoTitleInput.value = data.title;
        if (data.description) descriptionTextarea.value = data.description;
        if (data.transcript) transcript.setValue(data.transcript);
        if (data.comments && data.comments.length) {
          comments.setValue(data.comments.join("\n---\n"));
        }
        runParseTimestamps();
        if (data.errors && data.errors.length) {
          fetchStatus.textContent = `⚠ ${data.errors.join("; ")}`;
          fetchStatus.className =
            "text-[11px] text-amber-600 dark:text-amber-400 mt-1 h-4";
        } else {
          fetchStatus.textContent = `✓ Server OK — ${data.transcript ? "transcript" : "no transcript"}, ${data.comments?.length || 0} comments`;
          fetchStatus.className =
            "text-[11px] text-green-600 dark:text-green-400 mt-1 h-4";
        }
      } catch (e) {
        let msg = `✗ Fetch failed: ${e.message || e}`;
        if (
          e instanceof TypeError &&
          (e.message.includes("fetch") ||
            e.message.includes("network") ||
            e.message.includes("Failed to fetch"))
        ) {
          msg =
            "✗ Local server unreachable at localhost:8000. Make sure it's running: uv run python tubelens_server.py";
        } else if (e.message && e.message.includes("Invalid")) {
          msg = `✗ ${e.message}. Check that the URL is a valid YouTube link.`;
        } else if (e.message && e.message.startsWith("HTTP")) {
          msg = `✗ Server returned an error (${e.message}). Check the server logs.`;
        }
        fetchStatus.textContent = msg;
        fetchStatus.className = "text-[11px] text-red-500 dark:text-red-400 mt-1 h-4";
      }
    } else {
      if (!url) return;
      resetFieldsIfNewVideo(url);
      fetchStatus.textContent = "Fetching metadata...";
      fetchStatus.className = "text-[11px] text-gray-500 mt-1 h-4";
      try {
        const { title, authorName } = await fetchNoEmbed(url);
        videoTitleInput.value = title;
        if (authorName) {
          descriptionTextarea.value = `Channel: ${authorName}\n\n`;
        }
        fetchStatus.textContent = "✓ Fetched from noEmbed";
        fetchStatus.className = "text-[11px] text-green-600 mt-1 h-4";
      } catch (e) {
        fetchStatus.textContent = "✗ Could not fetch. Paste a valid YouTube URL.";
        fetchStatus.className = "text-[11px] text-red-500 mt-1 h-4";
      }
    }
  }

  fetchBtn.addEventListener("click", handleFetch);
  parseChaptersBtn.addEventListener("click", runParseTimestamps);

  onLocalServerToggle((checked) => {
    fetchBtn.disabled = !checked;
    if (checked) {
      fetchStatus.textContent = "Ready to call localhost:8000";
      fetchStatus.className = "text-[11px] text-indigo-600 mt-1 h-4";
    } else {
      fetchStatus.textContent = "";
      fetchStatus.className = "text-[11px] text-gray-400 mt-1 h-4";
    }
  });

  return {
    getVideoUrl: () => videoUrlInput.value.trim(),
    getVideoTitle: () => videoTitleInput.value.trim(),
    getDescription: () => descriptionTextarea.value,
    getChapters: () => (state.chapters.length ? state.chapters : runParseTimestamps()),
  };
}
