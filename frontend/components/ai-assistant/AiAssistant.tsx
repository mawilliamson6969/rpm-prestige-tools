"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bookmark,
  Brain,
  Check,
  Copy,
  FileText,
  ListChecks,
  Mail,
  Megaphone,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import styles from "./ai-assistant.module.css";

/* ---- Types ---- */

type InputDef = {
  key: string;
  label: string;
  type?: "text" | "textarea" | "select";
  required?: boolean;
  placeholder?: string;
  options?: string[];
};

type ToolItem = {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  category?: string | null;
  builtIn: boolean;
  inputs: InputDef[];
};

type TemplateItem = ToolItem & {
  templateId: number;
  ownerId: number;
  isShared: boolean;
  systemPrompt: string;
};

const ICONS: Record<string, LucideIcon> = {
  Mail,
  Sparkles,
  ListChecks,
  FileText,
  Megaphone,
  Brain,
  Bookmark,
};

function IconFor({ name, size = 18 }: { name?: string; size?: number }) {
  const Cmp = (name && ICONS[name]) || Bookmark;
  return <Cmp size={size} />;
}

/* ---- Main component ---- */

export default function AiAssistant() {
  const { authHeaders, token } = useAuth();
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [errorList, setErrorList] = useState<string | null>(null);
  const [active, setActive] = useState<(ToolItem | TemplateItem) | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [result, setResult] = useState("");
  const [resultMeta, setResultMeta] = useState<{ provider?: string; model?: string } | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editTemplate, setEditTemplate] = useState<TemplateItem | null>(null);
  const [copied, setCopied] = useState(false);

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoadingList(true);
    setErrorList(null);
    try {
      const [toolsRes, tplRes] = await Promise.all([
        fetch(apiUrl("/ai-assistant/tools"), { headers: { ...authHeaders() } }),
        fetch(apiUrl("/ai-assistant/templates"), { headers: { ...authHeaders() } }),
      ]);
      const toolsJson = await toolsRes.json().catch(() => ({}));
      const tplJson = await tplRes.json().catch(() => ({}));
      if (!toolsRes.ok) throw new Error(toolsJson?.error || "Could not load tools.");
      if (!tplRes.ok) throw new Error(tplJson?.error || "Could not load templates.");
      setTools(toolsJson.tools || []);
      setTemplates(tplJson.templates || []);
    } catch (e: unknown) {
      setErrorList(e instanceof Error ? e.message : "Could not load AI Assistant.");
    } finally {
      setLoadingList(false);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const openTool = (t: ToolItem | TemplateItem) => {
    setActive(t);
    const blank: Record<string, string> = {};
    for (const i of t.inputs) blank[i.key] = "";
    setInputs(blank);
    setResult("");
    setResultMeta(null);
    setGenerateError(null);
  };

  const closeTool = () => {
    setActive(null);
    setInputs({});
    setResult("");
    setResultMeta(null);
    setGenerateError(null);
  };

  const generate = useCallback(async () => {
    if (!active) return;
    // Required-field check on the client too — UX, not security.
    for (const def of active.inputs) {
      if (def.required && !inputs[def.key]?.trim()) {
        setGenerateError(`Please fill in: ${def.label}`);
        return;
      }
    }
    setResult("");
    setResultMeta(null);
    setGenerateError(null);
    setStreaming(true);
    try {
      const res = await fetch(apiUrl("/ai-assistant/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ toolId: active.id, inputs }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setGenerateError(j.error || `Request failed (${res.status}).`);
        setStreaming(false);
        return;
      }
      await consumeSse(res.body, (evt) => {
        if (evt.event === "meta") {
          setResultMeta({ provider: evt.data?.provider, model: evt.data?.model });
        } else if (evt.event === "token") {
          setResult((cur) => cur + (evt.data?.text || ""));
        } else if (evt.event === "error") {
          setGenerateError(evt.data?.message || "AI request failed.");
        }
      });
    } catch (e: unknown) {
      setGenerateError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setStreaming(false);
    }
  }, [active, authHeaders, inputs]);

  const onCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  };

  const onSaveAsTemplate = () => {
    if (!active) return;
    // Pre-fill the builder with the current tool's shape so the user can tweak.
    setEditTemplate({
      id: "draft",
      templateId: -1,
      ownerId: -1,
      isShared: false,
      builtIn: false,
      name: `${active.name} (my version)`,
      icon: active.icon || "Bookmark",
      description: active.description || "",
      systemPrompt: "systemPrompt" in active ? active.systemPrompt : "",
      inputs: active.inputs.slice(),
    });
    setShowBuilder(true);
  };

  const onEditTemplate = (t: TemplateItem) => {
    setEditTemplate(t);
    setShowBuilder(true);
  };

  const onDeleteTemplate = async (t: TemplateItem) => {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    const res = await fetch(apiUrl(`/ai-assistant/templates/${t.templateId}`), {
      method: "DELETE",
      headers: { ...authHeaders() },
    });
    if (res.ok) {
      if (active && active.id === t.id) closeTool();
      void loadAll();
    } else {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "Could not delete template.");
    }
  };

  const builtIn = useMemo(() => tools.filter((t) => t.builtIn !== false), [tools]);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>AI Assistant</h1>
          <p className={styles.subtitle}>
            Task-specific tools for everyday work. Drafts come back through the Prestige voice
            — review before sending.
          </p>
        </div>
        <button type="button" className={styles.btnGhost} onClick={() => { setEditTemplate(null); setShowBuilder(true); }}>
          <Plus size={16} /> New template
        </button>
      </header>

      {errorList ? <div className={styles.resultError}>{errorList}</div> : null}

      {loadingList ? (
        <div className={styles.empty}>Loading tools…</div>
      ) : active ? (
        <RunPanel
          tool={active}
          inputs={inputs}
          setInputs={setInputs}
          onClose={closeTool}
          onGenerate={generate}
          streaming={streaming}
          result={result}
          resultMeta={resultMeta}
          error={generateError}
          onCopy={onCopy}
          copied={copied}
          onRegenerate={generate}
          onSaveAsTemplate={onSaveAsTemplate}
        />
      ) : (
        <>
          <div className={styles.sectionLabel}>Built-in tools</div>
          <div className={styles.grid}>
            {builtIn.map((t) => (
              <ToolCard key={t.id} tool={t} onOpen={openTool} />
            ))}
          </div>

          <div className={styles.sectionLabel}>My templates</div>
          {templates.length === 0 ? (
            <div className={styles.empty}>
              You haven&apos;t saved any templates yet. Run a tool, tweak it, and hit
              <strong> Save as Template</strong> — or use <em>New template</em> above to start from
              scratch.
            </div>
          ) : (
            <div className={styles.grid}>
              {templates.map((t) => (
                <TemplateCard
                  key={t.id}
                  tpl={t}
                  onOpen={openTool}
                  onEdit={onEditTemplate}
                  onDelete={onDeleteTemplate}
                />
              ))}
            </div>
          )}
        </>
      )}

      {showBuilder ? (
        <TemplateBuilder
          initial={editTemplate}
          onClose={() => { setShowBuilder(false); setEditTemplate(null); }}
          onSaved={() => { setShowBuilder(false); setEditTemplate(null); void loadAll(); }}
          authHeaders={authHeaders}
        />
      ) : null}
    </div>
  );
}

/* ---- Tool / template cards ---- */

function ToolCard({ tool, onOpen }: { tool: ToolItem; onOpen: (t: ToolItem) => void }) {
  return (
    <button type="button" className={styles.card} onClick={() => onOpen(tool)}>
      <span className={styles.cardIcon}><IconFor name={tool.icon} /></span>
      <h3 className={styles.cardName}>{tool.name}</h3>
      <p className={styles.cardDescription}>{tool.description}</p>
      {tool.category ? (
        <div className={styles.cardBadgeRow}>
          <span className={styles.cardBadge}>{tool.category}</span>
        </div>
      ) : null}
    </button>
  );
}

function TemplateCard({
  tpl,
  onOpen,
  onEdit,
  onDelete,
}: {
  tpl: TemplateItem;
  onOpen: (t: TemplateItem) => void;
  onEdit: (t: TemplateItem) => void;
  onDelete: (t: TemplateItem) => void;
}) {
  return (
    <div className={styles.card} role="group">
      <button
        type="button"
        onClick={() => onOpen(tpl)}
        style={{ background: "transparent", border: "none", padding: 0, textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 8 }}
      >
        <span className={styles.cardIcon}><IconFor name={tpl.icon} /></span>
        <h3 className={styles.cardName}>{tpl.name}</h3>
        <p className={styles.cardDescription}>{tpl.description || "Saved template"}</p>
      </button>
      <div className={styles.cardBadgeRow}>
        {tpl.isShared ? <span className={`${styles.cardBadge} ${styles.cardBadgeShared}`}>Shared</span> : <span className={styles.cardBadge}>Personal</span>}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button type="button" className={styles.btnGhost} onClick={() => onEdit(tpl)} style={{ padding: "5px 10px", fontSize: 12 }}>
          Edit
        </button>
        <button type="button" className={styles.btnDanger} onClick={() => onDelete(tpl)} style={{ padding: "5px 10px", fontSize: 12 }}>
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </div>
  );
}

/* ---- Run panel ---- */

function RunPanel(props: {
  tool: ToolItem;
  inputs: Record<string, string>;
  setInputs: (next: Record<string, string>) => void;
  onClose: () => void;
  onGenerate: () => void;
  streaming: boolean;
  result: string;
  resultMeta: { provider?: string; model?: string } | null;
  error: string | null;
  onCopy: () => void;
  copied: boolean;
  onRegenerate: () => void;
  onSaveAsTemplate: () => void;
}) {
  const { tool, inputs, setInputs, onClose, onGenerate, streaming, result, resultMeta, error, onCopy, copied, onRegenerate, onSaveAsTemplate } = props;

  const set = (k: string, v: string) => setInputs({ ...inputs, [k]: v });

  return (
    <div className={styles.runPanel}>
      <div className={styles.runHeader}>
        <div className={styles.runHeaderLeft}>
          <span className={styles.runIcon}><IconFor name={tool.icon} size={20} /></span>
          <div style={{ minWidth: 0 }}>
            <h2 className={styles.runTitle}>{tool.name}</h2>
            {tool.description ? <p className={styles.runDesc}>{tool.description}</p> : null}
          </div>
        </div>
        <button type="button" className={styles.btnGhost} onClick={onClose} aria-label="Back to tools">
          <X size={15} /> Close
        </button>
      </div>

      <div className={styles.formGrid}>
        {tool.inputs.map((def) => (
          <div key={def.key} className={styles.field}>
            <label className={styles.label} htmlFor={`fld-${def.key}`}>
              {def.label}
              {def.required ? <span className={styles.required}>*</span> : null}
            </label>
            {def.type === "select" ? (
              <select
                id={`fld-${def.key}`}
                className={styles.select}
                value={inputs[def.key] || ""}
                onChange={(e) => set(def.key, e.target.value)}
              >
                <option value="">Select…</option>
                {(def.options || []).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : def.type === "text" ? (
              <input
                id={`fld-${def.key}`}
                className={styles.input}
                type="text"
                placeholder={def.placeholder}
                value={inputs[def.key] || ""}
                onChange={(e) => set(def.key, e.target.value)}
              />
            ) : (
              <textarea
                id={`fld-${def.key}`}
                className={styles.textarea}
                rows={5}
                placeholder={def.placeholder}
                value={inputs[def.key] || ""}
                onChange={(e) => set(def.key, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      <div className={styles.btnRow}>
        <button type="button" className={styles.btnPrimary} onClick={onGenerate} disabled={streaming}>
          {streaming ? <span className={styles.spinner} aria-hidden /> : <Sparkles size={14} />}
          {streaming ? "Generating…" : "Generate"}
        </button>
      </div>

      {(result || streaming || error) ? (
        <div className={styles.resultPanel}>
          {resultMeta ? (
            <div className={styles.resultMeta}>
              {resultMeta.provider || "ai"} · {resultMeta.model || ""}
            </div>
          ) : null}
          {error ? <div className={styles.resultError}>{error}</div> : null}
          {result ? <div className={styles.resultText}>{result}</div> : null}
          {result && !streaming ? (
            <div className={styles.btnRow}>
              <button type="button" className={styles.btnGhost} onClick={onCopy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button type="button" className={styles.btnGhost} onClick={onRegenerate}>
                <RefreshCw size={14} /> Regenerate
              </button>
              <button type="button" className={styles.btnGhost} onClick={onSaveAsTemplate}>
                <Save size={14} /> Save as template
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---- Template builder modal ---- */

function TemplateBuilder({
  initial,
  onClose,
  onSaved,
  authHeaders,
}: {
  initial: TemplateItem | null;
  onClose: () => void;
  onSaved: () => void;
  authHeaders: () => Record<string, string>;
}) {
  const isEdit = !!initial && initial.templateId > 0;
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [icon, setIcon] = useState(initial?.icon || "Bookmark");
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt || "");
  const [inputs, setInputs] = useState<InputDef[]>(initial?.inputs?.length ? initial.inputs : [{ key: "request", label: "Your request", type: "textarea", required: true }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addInput = () => setInputs([...inputs, { key: `field${inputs.length + 1}`, label: "New field", type: "text" }]);
  const removeInput = (idx: number) => setInputs(inputs.filter((_, i) => i !== idx));
  const updateInput = (idx: number, patch: Partial<InputDef>) =>
    setInputs(inputs.map((i, j) => (j === idx ? { ...i, ...patch } : i)));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = { name, description, icon, systemPrompt, inputs };
      const url = isEdit
        ? apiUrl(`/ai-assistant/templates/${initial!.templateId}`)
        : apiUrl(`/ai-assistant/templates`);
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || "Could not save template.");
        return;
      }
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 className={styles.modalTitle}>{isEdit ? "Edit template" : "New template"}</h2>
          <button type="button" className={styles.btnGhost} onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <p className={styles.modalHint}>
          A template is your own AI tool. Give it a name, describe what it does, write the
          instruction in plain language, and list which input boxes the team should fill in.
        </p>

        <div className={styles.field}>
          <label className={styles.label}>Name<span className={styles.required}>*</span></label>
          <input className={styles.input} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Owner update — quarterly review" />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Short description</label>
          <input className={styles.input} type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One sentence so others know what this is for." />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Icon</label>
          <select className={styles.select} value={icon} onChange={(e) => setIcon(e.target.value)}>
            {Object.keys(ICONS).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Instruction (system prompt)<span className={styles.required}>*</span></label>
          <textarea
            className={styles.textarea}
            rows={8}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Tell the AI exactly what to do. e.g. 'Draft a friendly owner update for a quarterly check-in. Use the provided property and financial summary. Keep it to 4-6 short paragraphs.'"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Input fields</label>
          {inputs.map((inp, idx) => (
            <div key={idx} className={styles.inputListItem}>
              <div>
                <label className={styles.label} style={{ fontSize: 11 }}>Label</label>
                <input className={styles.input} type="text" value={inp.label} onChange={(e) => updateInput(idx, { label: e.target.value })} />
                <label className={styles.label} style={{ fontSize: 11, marginTop: 6 }}>Key</label>
                <input className={styles.input} type="text" value={inp.key} onChange={(e) => updateInput(idx, { key: e.target.value.replace(/[^a-z0-9_]/gi, "") })} />
              </div>
              <div>
                <label className={styles.label} style={{ fontSize: 11 }}>Type</label>
                <select className={styles.select} value={inp.type || "text"} onChange={(e) => updateInput(idx, { type: e.target.value as InputDef["type"] })}>
                  <option value="text">Short text</option>
                  <option value="textarea">Long text</option>
                  <option value="select">Dropdown</option>
                </select>
                <label className={styles.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 8 }}>
                  <input type="checkbox" checked={!!inp.required} onChange={(e) => updateInput(idx, { required: e.target.checked })} />
                  Required
                </label>
              </div>
              <button type="button" className={styles.removeBtn} onClick={() => removeInput(idx)} aria-label="Remove field">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button type="button" className={styles.btnGhost} onClick={addInput} style={{ alignSelf: "flex-start" }}>
            <Plus size={14} /> Add a field
          </button>
        </div>

        {error ? <div className={styles.resultError}>{error}</div> : null}

        <div className={styles.btnRow}>
          <button type="button" className={styles.btnPrimary} disabled={saving} onClick={save}>
            {saving ? <span className={styles.spinner} /> : <Save size={14} />} {isEdit ? "Save changes" : "Create template"}
          </button>
          <button type="button" className={styles.btnGhost} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ---- SSE parser ---- */

type SseEvent = { event: string; data: { provider?: string; model?: string; text?: string; message?: string; code?: string } | null };

async function consumeSse(body: ReadableStream<Uint8Array>, onEvent: (e: SseEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      let dataLine = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLine = (dataLine ? `${dataLine}\n` : "") + line.slice(5).trim();
      }
      if (!dataLine) continue;
      let data: SseEvent["data"] = null;
      try { data = JSON.parse(dataLine); } catch { data = null; }
      onEvent({ event, data });
    }
  }
}
