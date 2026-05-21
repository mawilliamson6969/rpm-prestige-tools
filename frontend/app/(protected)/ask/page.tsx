"use client";

import { useState } from "react";
import AiAssistant from "../../../components/ai-assistant/AiAssistant";
import askStyles from "../../../components/ai-assistant/ai-assistant.module.css";
import AskAiChat from "../../../components/ask-ai/AskAiChat";

type TabKey = "ask" | "assistant";

export default function AskPage() {
  const [tab, setTab] = useState<TabKey>("ask");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className={askStyles.tabBar} role="tablist" aria-label="AI tools">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "ask"}
          className={`${askStyles.tabBtn} ${tab === "ask" ? askStyles.tabBtnActive : ""}`}
          onClick={() => setTab("ask")}
        >
          Ask the Database
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "assistant"}
          className={`${askStyles.tabBtn} ${tab === "assistant" ? askStyles.tabBtnActive : ""}`}
          onClick={() => setTab("assistant")}
        >
          AI Assistant
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === "ask" ? <AskAiChat variant="page" /> : <AiAssistant />}
      </div>
    </div>
  );
}
