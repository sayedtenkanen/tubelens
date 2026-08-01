import { normalizeTranscript, cleanComments } from "./parsing.js";

// ── Prompt Builder ──────────────────────────────────────────────
export const REPORT_INSTRUCTIONS = `## INSTRUCTIONS
Generate a report with the following sections. Use clear Markdown formatting.

Start the report with a metadata header:
# [Video Title]
**URL:** [Video URL]
**Date Prepared:** [Current Date]

### 1. Quick Brief
A 2-3 sentence synthesis of the video's core message and purpose. Mention the channel/author if known.

### 2. Key Takeaways
5-7 bullet points of the most actionable, surprising, or important information from the video. Cite timestamps where possible.

### 3. Detailed Breakdown
Go through the video in chronological order. If chapters exist, use them as headers. If not, infer 3-5 logical segments. For each segment:
- Summarize the key concepts.
- Note specific claims, numbers, tools, or references.
- Attach relevant **Community Context**: corrections, clarifications, resource links, or high-value comments tied to that timestamp/topic.
- Highlight any "high-density" moments where a lot of concrete information is delivered.

### 4. Resources Mentioned
Extract any books, papers, tools, links, or products referenced in the video or comments. Format as:
- **Name** — Description — [Timestamp]

### 5. Community Corrections & Notes
List comments that correct, expand upon, or challenge the video content. Include the comment's approximate timestamp/topic and its core point.

### 6. Unresolved / Top Questions
If comments contain recurring questions that the video does not clearly answer, list them here with approximate upvote weight if mentioned.

IMPORTANT RULES:
- Only use facts present in the provided data.
- Do not say "the video discusses" repeatedly; be direct.
- If the transcript quality is poor (many [music], [applause], or fragmented sentences), note this briefly but still extract meaning.
- If comments are sparse, omit the Community sections gracefully rather than inventing them.`;

export const SYSTEM_PROMPT = `You are TubeLens, an expert video analyst and technical editor. You produce structured, information-dense reports from YouTube video data. You synthesize transcripts, descriptions, timestamps, and community comments into a single coherent brief. You never hallucinate facts not present in the source material. You reference timestamps in HH:MM:SS format when citing specific claims.`;

/**
 * Build the system/user prompt pair from raw input data.
 *
 * @param {Object} input
 * @param {string} input.title
 * @param {string} input.url
 * @param {string} input.description
 * @param {string} input.rawTranscript
 * @param {string} input.rawComments
 * @param {boolean} input.filterComments
 * @param {{time: string, title: string}[]} input.chapters
 */
export function buildPromptPayload({
  title,
  url,
  description,
  rawTranscript,
  rawComments,
  filterComments,
  chapters,
}) {
  const finalTitle = title || "Untitled Video";
  const finalUrl = url || "(No URL)";
  const date = new Date().toLocaleDateString();
  const desc = (description || "").trim();
  const transcript = normalizeTranscript((rawTranscript || "").trim());
  const comments = filterComments
    ? cleanComments((rawComments || "").trim())
    : (rawComments || "").trim();

  const userPrompt = `Analyze the following YouTube video data and produce a structured report in Markdown.

## VIDEO METADATA
**Title:** ${finalTitle}
**URL:** ${finalUrl}
**Date Prepared:** ${date}
**Description:** ${desc || "(None provided)"}

${
  chapters.length
    ? `## VIDEO CHAPTERS / TIMESTAMPS
${chapters.map((c) => `- [${c.time}] ${c.title}`).join("\n")}`
    : ""
}

## TRANSCRIPT
${transcript || "(No transcript provided)"}

## COMMUNITY COMMENTS
${comments || "(No comments provided)"}

---
${REPORT_INSTRUCTIONS}`;

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    fullText: SYSTEM_PROMPT + "\n\n" + userPrompt,
    parts: { title: finalTitle, desc, chapters, transcript, comments },
  };
}

/** Build the reduce-stage prompt used by map-reduce chunked generation. */
export function buildReducePrompt({ parts, videoUrl }) {
  const date = new Date().toLocaleDateString();
  return `Analyze the following YouTube video data and produce a structured report in Markdown.

## VIDEO METADATA
**Title:** ${parts.title}
**URL:** ${videoUrl}
**Date Prepared:** ${date}
**Description:** ${parts.desc || "(None provided)"}

${
  parts.chapters.length
    ? `## VIDEO CHAPTERS / TIMESTAMPS
${parts.chapters.map((c) => `- [${c.time}] ${c.title}`).join("\n")}
`
    : ""
}## TRANSCRIPT NOTES
The transcript was too long to include directly. Below are detailed chronological notes extracted from ${parts.notesCount} consecutive parts of it. Treat them as the transcript evidence; timestamps in the notes refer to the video.

${parts.notes.join("\n\n")}

## COMMUNITY COMMENTS
${parts.comments || "(No comments provided)"}

---
${REPORT_INSTRUCTIONS}`;
}
