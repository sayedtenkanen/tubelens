// ── Fetch Logic ──────────────────────────────────────────────────

/** Best-effort metadata fetch via noEmbed (no API key, no local server needed). */
export async function fetchNoEmbed(url) {
  const res = await fetch(
    `https://noembed.com/embed?url=${encodeURIComponent(url)}&format=json`,
  );
  const data = await res.json();
  if (!data.title) throw new Error("No data");
  return { title: data.title, authorName: data.author_name || null };
}

/**
 * Fetch title/description/transcript/comments via the local FastAPI server
 * (tubelens_server.py), which talks to YouTube directly.
 */
export async function fetchFromLocalServer(url, ytApiKey) {
  const params = new URLSearchParams({ url });
  if (ytApiKey) params.set("yt_api_key", ytApiKey);
  const res = await fetch(`http://localhost:8000/fetch?${params.toString()}`, {
    method: "GET",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}
