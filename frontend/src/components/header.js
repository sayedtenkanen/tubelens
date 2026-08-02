export function mountHeader(container) {
  container.innerHTML = `
    <div class="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
      <div>
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">TubeLens</h1>
        <p class="text-gray-500 dark:text-gray-400 text-sm mt-1">Personal YouTube deep-summarizer. Runs entirely on your machine with Ollama — or switch to OpenAI/OpenRouter for cloud models.</p>
      </div>
      <div class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        <button id="darkModeToggle" class="text-gray-400 dark:text-gray-200 ml-3">🌙 Dark Mode</button>
      </div>
    </div>
  `;

  container.querySelector("#darkModeToggle").addEventListener("click", function () {
    // Toggle on <html>, not <body>: Tailwind compiles `dark:*` to
    // `.dark\:text-white:is(.dark *)`, which requires .dark on an ANCESTOR
    // of the element — an element is never its own descendant, so body's
    // own dark:bg-gray-900/dark:text-white classes would never match if
    // .dark were toggled on body itself. That's also why plain <p>/<li>
    // markdown text (which has no color of its own and just inherits from
    // body) stayed dark-on-dark: body's own "switch to white" never fired.
    document.documentElement.classList.toggle("dark");
    this.textContent = document.documentElement.classList.contains("dark")
      ? "☀️ Light Mode"
      : "🌙 Dark Mode";
  });
}
