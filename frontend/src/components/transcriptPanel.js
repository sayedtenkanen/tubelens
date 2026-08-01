function statsText(val) {
  return `${val.length} chars · ~${Math.round(val.length / 4)} tokens`;
}

export function mountTranscriptPanel(container) {
  container.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Transcript</h2>
        <span id="transcriptStats" class="text-[11px] text-gray-400 dark:text-gray-500">0 chars</span>
      </div>
      <textarea id="transcript" placeholder="Paste transcript here, or use the local server to auto-fetch..." class="w-full rounded-lg border-gray-300 dark:border-gray-600 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-3 border font-mono text-xs leading-relaxed bg-white dark:bg-gray-700 dark:text-white"></textarea>
      <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Supports raw text, .srt, or .vtt. Auto-fetched transcripts arrive pre-formatted.</p>
    </div>
  `;

  const textarea = container.querySelector("#transcript");
  const stats = container.querySelector("#transcriptStats");

  function updateStats() {
    stats.textContent = statsText(textarea.value);
  }

  textarea.addEventListener("input", updateStats);

  return {
    getValue: () => textarea.value,
    clear: () => {
      textarea.value = "";
      updateStats();
    },
    setValue: (text) => {
      textarea.value = text;
      updateStats();
    },
  };
}
