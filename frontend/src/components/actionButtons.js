export function mountActionButtons(container, { onAssemble, onGenerate }) {
  container.innerHTML = `
    <div class="flex flex-col gap-2">
      <button id="assembleBtn" class="w-full bg-white dark:bg-gray-800 border-2 border-indigo-600 dark:border-indigo-500 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-gray-700 font-semibold py-3 px-4 rounded-xl transition-all text-sm">
        📋 Assemble Prompt
      </button>
      <button id="generateBtn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-xl shadow-md transition-all text-sm flex items-center justify-center gap-2">
        <span id="btnText">✨ Generate Report</span>
        <div id="btnLoader" class="loader hidden"></div>
      </button>
    </div>
  `;

  const generateBtn = container.querySelector("#generateBtn");
  const btnText = container.querySelector("#btnText");
  const btnLoader = container.querySelector("#btnLoader");

  container.querySelector("#assembleBtn").addEventListener("click", onAssemble);
  generateBtn.addEventListener("click", onGenerate);

  return {
    setGenerating(isGenerating) {
      btnText.textContent = isGenerating ? "Generating..." : "✨ Generate Report";
      btnLoader.classList.toggle("hidden", !isGenerating);
      generateBtn.disabled = isGenerating;
      generateBtn.classList.toggle("opacity-50", isGenerating);
      generateBtn.classList.toggle("cursor-not-allowed", isGenerating);
    },
  };
}
