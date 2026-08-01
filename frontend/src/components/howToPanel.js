export function mountHowToPanel(container) {
  container.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">How to use this tool</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-600 dark:text-gray-300">
        <div class="space-y-2">
          <p><span class="font-semibold text-gray-900 dark:text-white">1.</span> <strong>Start the backend:</strong> run <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">uv run python tubelens_server.py</code> in the project folder. Using the default "Local (Ollama via server)" provider? Also make sure Ollama is running (<code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">ollama serve</code>) — otherwise skip straight to step 4, no Ollama needed.</p>
          <p><span class="font-semibold text-gray-900 dark:text-white">2.</span> Open <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">http://localhost:8000</code> in your browser. Check <strong>"Use local server"</strong>, paste a YouTube URL, click <strong>Fetch Info</strong>. Transcript fills automatically; add a YouTube Data API key above to also auto-fetch the description and comments.</p>
          <p><span class="font-semibold text-gray-900 dark:text-white">3.</span> Click <strong>Generate Report</strong> — no AI key needed with the default "Local (Ollama via server)" provider. Reports are saved to <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">summaries/</code>. Very long videos are processed automatically in parts.</p>
        </div>
        <div class="space-y-2">
          <p><span class="font-semibold text-gray-900 dark:text-white">4.</span> <strong>No Ollama? No problem:</strong> switch provider to <strong>OpenAI</strong> or <strong>OpenRouter</strong> — the API Key field enables automatically — and paste your own key. Reports then generate via that cloud provider instead of a local model. Or click <strong>Assemble Prompt</strong> to copy the prompt into any chat LLM by hand. No server at all? Paste transcript and comments manually — everything still works.</p>
          <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-2 pt-2 border-t border-gray-200 dark:border-gray-700"><strong>Ollama Configuration:</strong></p>
          <p class="text-[10px] text-gray-500 dark:text-gray-500"><strong>Network access:</strong> By default Ollama listens on <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">127.0.0.1</code>. To access from another device, set <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">OLLAMA_HOST=0.0.0.0</code> and restart Ollama.</p>
          <p class="text-[10px] text-gray-500 dark:text-gray-500"><strong>CORS for direct browser access:</strong> Set <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">OLLAMA_ORIGINS=*</code> to allow web UIs to connect directly. Example: <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">export OLLAMA_ORIGINS='*'</code></p>
          <p class="text-[10px] text-gray-500 dark:text-gray-500"><strong>API endpoint:</strong> <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">http://localhost:11434</code> — works with Python Requests, LangChain, LlamaIndex, and JavaScript fetch.</p>
        </div>
      </div>
    </div>
  `;
}
