import { loadConfig, checkOllama } from "../lib/ollama.js";

const PROVIDER_DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  openrouter: "openai/gpt-4o-mini",
};

/**
 * "AI API Setup" panel: provider/model/API-key selection plus the local
 * server toggle. Other panels (Video Source) need to react to the local
 * server toggle and read the yt-api-key, so this exposes both getters and
 * a tiny subscribe method — see onLocalServerToggle.
 */
export function mountApiConfigPanel(container) {
  container.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">AI API Setup</h2>
      </div>
      <div class="space-y-3">
        <div>
          <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">AI Provider</label>
          <select id="provider" class="w-full rounded-lg border-gray-300 dark:border-gray-600 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 py-2 px-3 border bg-white dark:bg-gray-700 dark:text-white">
            <option value="local">Local (Ollama via server)</option>
            <option value="openai">OpenAI</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </div>
        <div id="apiKeyField" class="opacity-50 pointer-events-none transition-opacity">
          <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">AI API Key</label>
          <input type="password" id="apiKey" placeholder="sk-..." class="w-full rounded-lg border-gray-300 dark:border-gray-600 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 py-2 px-3 border bg-white dark:bg-gray-700 dark:text-white">
          <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Key is only stored in page memory. Never persisted. Not needed for — and disabled for — the Local provider; enables automatically for OpenAI/OpenRouter.</p>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Model</label>
          <input type="text" id="model" value="qwen2.5:14b" class="w-full rounded-lg border-gray-300 dark:border-gray-600 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 py-2 px-3 border bg-white dark:bg-gray-700 dark:text-white">
          <select id="modelSelect" class="hidden w-full rounded-lg border-gray-300 dark:border-gray-600 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 py-2 px-3 border bg-white dark:bg-gray-700 dark:text-white">
            <option value="">Loading models…</option>
          </select>
          <p id="ollamaStatus" class="text-[11px] mt-1 h-4"></p>
        </div>
      </div>

      <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <label class="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer font-medium">
          <input type="checkbox" id="useLocalServer" class="rounded text-indigo-600 focus:ring-indigo-500">
          <span>Use local server for transcript & comments</span>
        </label>
        <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-1 ml-5">
          Runs <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">python tubelens_server.py</code> on your machine to auto-pull data.
        </p>
        <div id="localServerConfig" class="mt-3">
          <label class="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">YouTube Data API Key (optional)</label>
          <input type="password" id="ytApiKey" placeholder="AIza..." class="w-full rounded-lg border-gray-300 dark:border-gray-600 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 py-2 px-3 border bg-white dark:bg-gray-700 dark:text-white">
          <p class="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Required for auto comments & full description. Transcripts work without it. Auto-filled from <code class="bg-gray-100 dark:bg-gray-700 px-0.5 rounded">.env</code>'s <code class="bg-gray-100 dark:bg-gray-700 px-0.5 rounded">YT_API_KEY</code> if set — override here for a one-off key.</p>
        </div>
        <div id="fetchInstructions" class="mt-3 p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg">
          <p class="text-[11px] font-semibold text-amber-800 dark:text-amber-300 mb-1">Local server required for auto-fetch</p>
          <p class="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">1. Run <code class="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">uv run python tubelens_server.py</code> in your terminal.<br>2. Make sure Ollama is running: <code class="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">ollama serve</code><br>3. Check the box above to enable the Fetch Info button.</p>
        </div>
      </div>
    </div>
  `;

  const apiKeyField = container.querySelector("#apiKeyField");
  const providerSelect = container.querySelector("#provider");
  const apiKeyInput = container.querySelector("#apiKey");
  const modelInput = container.querySelector("#model");
  const modelSelect = container.querySelector("#modelSelect");
  const ollamaStatus = container.querySelector("#ollamaStatus");
  const useLocalServerCheckbox = container.querySelector("#useLocalServer");
  const ytApiKeyInput = container.querySelector("#ytApiKey");

  const localServerListeners = [];
  function notifyLocalServerToggle(checked) {
    localServerListeners.forEach((fn) => fn(checked));
  }

  async function refreshOllamaModels() {
    ollamaStatus.textContent = "Checking Ollama...";
    ollamaStatus.className =
      "text-[11px] text-amber-600 dark:text-amber-400 mt-1 h-4";

    const { ok, models, error } = await checkOllama();

    if (!ok && error === "unreachable") {
      ollamaStatus.textContent =
        "✗ Ollama not reachable. Run `ollama serve` and ensure the local server is running.";
      ollamaStatus.className =
        "text-[11px] text-red-500 dark:text-red-400 mt-1 h-4";
      modelInput.classList.remove("hidden");
      modelSelect.classList.add("hidden");
      return;
    }
    if (!ok && error === "no-models") {
      ollamaStatus.textContent = "⚠ Ollama running but no models installed.";
      ollamaStatus.className =
        "text-[11px] text-amber-600 dark:text-amber-400 mt-1 h-4";
      modelInput.classList.remove("hidden");
      modelSelect.classList.add("hidden");
      return;
    }

    modelSelect.innerHTML = "";
    models.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      modelSelect.appendChild(opt);
    });
    const currentVal = modelInput.value;
    if (models.includes(currentVal)) {
      modelSelect.value = currentVal;
    }
    modelSelect.classList.remove("hidden");
    modelInput.classList.add("hidden");
    modelInput.value = modelSelect.value;
    // Avoid stacking duplicate listeners
    modelSelect.onchange = () => {
      modelInput.value = modelSelect.value;
    };
    ollamaStatus.textContent = `✓ Ollama connected · ${models.length} model${models.length > 1 ? "s" : ""} available`;
    ollamaStatus.className =
      "text-[11px] text-green-600 dark:text-green-400 mt-1 h-4";
  }

  // The API Key field is only relevant for cloud providers — Local/Ollama
  // never uses it, since generation there goes through tubelens_server.py
  // instead of straight from the browser. Rather than a separate "call API
  // directly" toggle, the field just tracks the provider directly: enabled
  // whenever a cloud provider is selected, disabled for Local.
  function syncApiKeyFieldState() {
    const needsKey = providerSelect.value !== "local";
    apiKeyField.classList.toggle("opacity-50", !needsKey);
    apiKeyField.classList.toggle("pointer-events-none", !needsKey);
  }

  providerSelect.addEventListener("change", (e) => {
    syncApiKeyFieldState();
    if (e.target.value === "local") {
      refreshOllamaModels();
    } else {
      modelInput.value = PROVIDER_DEFAULT_MODELS[e.target.value] || "";
      modelInput.classList.remove("hidden");
      modelSelect.classList.add("hidden");
      ollamaStatus.textContent = "";
    }
  });

  const fetchInstructions = container.querySelector("#fetchInstructions");

  useLocalServerCheckbox.addEventListener("change", (e) => {
    fetchInstructions.classList.toggle("hidden", e.target.checked);
    notifyLocalServerToggle(e.target.checked);
  });

  // Sync once on load: browsers restore <select> state on reload without
  // firing 'change', which otherwise leaves the API Key field's
  // enabled/disabled state out of sync with the restored provider.
  syncApiKeyFieldState();
  // Check Ollama on load whenever the default/selected provider is Local.
  if (providerSelect.value === "local") {
    refreshOllamaModels();
  }
  loadConfig().then((ytKey) => {
    if (ytKey) ytApiKeyInput.value = ytKey;
  });

  return {
    getProvider: () => providerSelect.value,
    getApiKey: () => apiKeyInput.value.trim(),
    getModel: () => modelInput.value.trim(),
    isUsingLocalServer: () => useLocalServerCheckbox.checked,
    getYtApiKey: () => ytApiKeyInput.value.trim(),
    onLocalServerToggle: (fn) => localServerListeners.push(fn),
  };
}
