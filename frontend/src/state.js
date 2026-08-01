// Small shared mutable store for state that crosses component boundaries.
// Kept intentionally simple (no framework) — components read/write the
// fields they need directly.
export const state = {
  currentTab: "report",
  currentPrompt: "",
  lastFetchedVid: null,
  chapters: [],
};
