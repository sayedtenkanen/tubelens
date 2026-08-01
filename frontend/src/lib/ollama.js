export async function loadConfig() {
  try {
    const res = await fetch("http://localhost:8000/config");
    const data = await res.json();
    return data.yt_api_key || "";
  } catch (e) {
    console.error("Failed to load config:", e);
    return "";
  }
}

/**
 * Check whether Ollama (directly, or via the local server proxy) is
 * reachable and return its model list. Returns { ok, models, error }.
 */
export async function checkOllama() {
  // Try local server proxy first (avoids CORS), fall back to direct Ollama
  let data = null;
  try {
    const res = await fetch("http://localhost:8000/ollama/models", {
      signal: AbortSignal.timeout(3000),
    });
    data = await res.json();
  } catch (e) {
    try {
      const res = await fetch("http://localhost:11434/api/tags", {
        signal: AbortSignal.timeout(3000),
      });
      data = await res.json();
    } catch (e2) {
      data = null;
    }
  }

  if (!data || data.error) {
    return { ok: false, models: [], error: "unreachable" };
  }

  const models = (data.models || []).map((m) => m.name).sort();
  if (models.length === 0) {
    return { ok: false, models: [], error: "no-models" };
  }
  return { ok: true, models, error: null };
}
