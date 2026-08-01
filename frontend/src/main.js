import "./style.css";

import { mountHeader } from "./components/header.js";
import { mountApiConfigPanel } from "./components/apiConfigPanel.js";
import { mountVideoSourcePanel } from "./components/videoSourcePanel.js";
import { mountTranscriptPanel } from "./components/transcriptPanel.js";
import { mountCommentsPanel } from "./components/commentsPanel.js";
import { mountActionButtons } from "./components/actionButtons.js";
import { mountOutputPanel } from "./components/outputPanel.js";
import { mountHowToPanel } from "./components/howToPanel.js";

const $ = (id) => document.getElementById(id);

mountHeader($("mount-header"));

const api = mountApiConfigPanel($("mount-api-config"));
const transcriptPanel = mountTranscriptPanel($("mount-transcript"));
const commentsPanel = mountCommentsPanel($("mount-comments"));

const videoSource = mountVideoSourcePanel($("mount-video-source"), {
  isUsingLocalServer: api.isUsingLocalServer,
  getYtApiKey: api.getYtApiKey,
  onLocalServerToggle: api.onLocalServerToggle,
  transcript: transcriptPanel,
  comments: commentsPanel,
});

const output = mountOutputPanel($("mount-output"), {
  api,
  videoSource,
  transcript: transcriptPanel,
  comments: commentsPanel,
});

const actions = mountActionButtons($("mount-actions"), {
  onAssemble: () => output.buildPrompt(),
  onGenerate: () => output.generateReport(actions),
});

mountHowToPanel($("mount-how-to"));
