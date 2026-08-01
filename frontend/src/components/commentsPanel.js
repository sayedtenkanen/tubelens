function statsText(val) {
  return `${val.length} chars · ~${Math.round(val.length / 4)} tokens`;
}

export function mountCommentsPanel(container) {
  container.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Comments</h2>
        <label class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" id="filterComments" checked class="rounded text-indigo-600 focus:ring-indigo-500">
          <span>Smart Filter</span>
        </label>
      </div>
      <textarea id="comments" placeholder="Paste top comments, or auto-fetch via local server..." class="w-full rounded-lg border-gray-300 dark:border-gray-600 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-3 border font-mono text-xs leading-relaxed bg-white dark:bg-gray-700 dark:text-white"></textarea>
      <p id="commentStats" class="text-[11px] text-gray-400 dark:text-gray-500 mt-1">0 chars</p>
    </div>
  `;

  const textarea = container.querySelector("#comments");
  const stats = container.querySelector("#commentStats");
  const filterCheckbox = container.querySelector("#filterComments");

  function updateStats() {
    stats.textContent = statsText(textarea.value);
  }

  textarea.addEventListener("input", updateStats);

  return {
    getValue: () => textarea.value,
    isFilterEnabled: () => filterCheckbox.checked,
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
