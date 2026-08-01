// ── Parsing & Cleaning ──────────────────────────────────────────

export function parseTimestamps(descriptionText) {
  const regex =
    /^(?:\s*)(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:[—–\-:]\s*)?(.+)$/gm;
  const matches = [...descriptionText.matchAll(regex)];
  if (matches.length > 0) {
    return matches.map((m) => ({ time: m[1], title: m[2].trim() }));
  }
  return [];
}

export function cleanComments(raw) {
  const comments = raw.split(/\n---\n/);
  const spamPatterns = [
    /^\d+:\d+$/i,
    /^(first|second|early|who'?s watching|subscribe|check out my|follow me|love from|greetings from)/i,
    /^[👍🔥❤️👏🙏😂🤣💯✅🤔😍😭🥰🎉👌😎]+$/,
    /^\(.*\)$/,
    /^https?:\/\/.+$/i,
  ];
  return comments
    .filter((comment) => {
      const firstLine = comment.split("\n")[0].trim();
      if (firstLine.length < 4) return false;
      if (firstLine.match(/^\[\d+ likes\]/)) return true;
      if (spamPatterns.some((p) => p.test(firstLine))) return false;
      const wordCount = (firstLine.match(/\b[a-zA-Z]{2,}\b/g) || []).length;
      if (wordCount < 2 && !firstLine.match(/\d{1,2}:\d{2}/)) return false;
      return true;
    })
    .join("\n---\n");
}

export function normalizeTranscript(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^\d+$/.test(line)) continue;
    if (/^\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(line)) continue;
    if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(line)) continue;
    if (line) out.push(line);
  }
  return out.join(" ");
}
