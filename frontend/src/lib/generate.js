import { buildReducePrompt } from "./promptBuilder.js";

// ── Local generation helpers (Ollama via server) ────────────────
export const NUM_CTX_CAP = 65536; // hard cap to protect VRAM
export const OUTPUT_HEADROOM = 8192; // tokens reserved for the model's output
export const MAP_CHUNK_TOKENS = 20000; // transcript tokens per map-stage call

export async function callGenerate(
  system,
  prompt,
  model,
  videoId = null,
  videoTitle = null,
) {
  // Auto-size the context window: estimated prompt tokens + output
  // headroom, rounded up to 8k steps. Min 32k; capped to protect VRAM.
  const approx = Math.round((system.length + prompt.length) / 4);
  const numCtx = Math.min(
    NUM_CTX_CAP,
    Math.max(32768, Math.ceil((approx + OUTPUT_HEADROOM + 1024) / 8192) * 8192),
  );
  const res = await fetch("http://localhost:8000/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system,
      prompt,
      model,
      num_ctx: numCtx,
      video_id: videoId,
      video_title: videoTitle,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export function chunkText(text, maxTokens) {
  // Split on the nearest space before the limit so words stay intact;
  // inline [M:SS] timestamps are preserved inside each chunk.
  const maxChars = maxTokens * 4;
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + maxChars, text.length);
    if (end < text.length) {
      const sp = text.lastIndexOf(" ", end);
      if (sp > i) end = sp;
    }
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}

export async function generateChunked(
  model,
  videoId,
  videoTitle,
  parts,
  systemPrompt,
  videoUrl,
  setStatus,
) {
  // Map stage: dense notes per transcript part.
  const chunks = chunkText(parts.transcript, MAP_CHUNK_TOKENS);
  const notes = [];
  for (let i = 0; i < chunks.length; i++) {
    setStatus(`Long video: summarizing part ${i + 1} of ${chunks.length}…`);
    const mapPrompt = `You are processing PART ${i + 1} of ${chunks.length} of the transcript of the video "${parts.title}". Produce dense, factual notes on THIS PART ONLY, in chronological order, citing the inline timestamps. Include: key points and claims (with specific numbers), instructions or steps, and every tool, person, paper, product, or link mentioned. Use Markdown bullets. No introduction, no conclusion, no speculation beyond the text.

## TRANSCRIPT PART ${i + 1}/${chunks.length}
${chunks[i]}`;
    const d = await callGenerate(systemPrompt, mapPrompt, model);
    notes.push(`### Notes from part ${i + 1}/${chunks.length}\n${d.report}`);
  }

  // Reduce stage: combine notes + chapters + comments into the final report.
  setStatus(`Combining ${chunks.length} parts into the final report…`);
  const reducePrompt = buildReducePrompt({
    parts: { ...parts, notes, notesCount: chunks.length },
    videoUrl,
  });
  const data = await callGenerate(
    systemPrompt,
    reducePrompt,
    model,
    videoId,
    videoTitle,
  );
  data.parts_processed = chunks.length;
  return data;
}
