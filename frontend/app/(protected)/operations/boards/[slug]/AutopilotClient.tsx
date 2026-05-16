"use client";

import { useCallback, useEffect, useState } from "react";
import { Zap, Plus, Trash2, FlaskConical, ScrollText, Info, X } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import styles from "./autopilot.module.css";

/**
 * Phase 7.4 — Autopilot Rules tab.
 *
 * Wired to the pre-existing autopilot system (process_autopilot_rules
 * + routes/autopilot.js + lib/autopilot-engine.js + the every-minute
 * cron). This is frontend-only.
 *
 * Dry-run-first / disabled-by-default is inherent to that system:
 *   - new rules have is_enabled = false; the cron skips disabled rules
 *   - "Test" calls /test → dryRunRule (matched count + preview, NO
 *     processes created, NO messages sent)
 *   - only an explicitly enabled rule is ever executed live
 * The UI makes that contract loud.
 */

interface Cond {
  field: string;
  op: string;
  value: string;
}

interface Rule {
  id: number;
  name: string;
  description: string | null;
  isEnabled: boolean;
  frequency: string; // day | week | month
  dayOfPeriod: number | null;
  timeOfDay: string | null;
  startingStageId: number | null;
  conditionEntity: string; // unit | property | owner | tenant | lease
  conditions: Cond[];
  lastRunAt: string | null;
  nextRunAt: string | null;
  totalRuns: number;
  totalProcessesCreated: number;
}

interface StageOpt {
  id: number;
  name: string;
}

interface TestResult {
  matched: number;
  preview?: Array<{ name?: string } & Record<string, unknown>>;
}

interface RunLog {
  id: number;
  runAt: string;
  status: string;
  entitiesMatched: number;
  processesCreated: number;
  duplicatesSkipped: number;
}

const FREQS = ["day", "week", "month"];
const ENTITIES = ["unit", "property", "owner", "tenant", "lease"];
const OPS = ["is", "is not", "contains", ">", ">=", "<", "<=", "older than"];

export default function AutopilotClient({ slug }: { slug: string }) {
  const { authHeaders, token, isAdmin } = useAuth();
  const [tplId, setTplId] = useState<number | null>(null);
  const [tplName, setTplName] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [stages, setStages] = useState<StageOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testResults, setTestResults] = useState<Record<number, TestResult | string>>({});
  const [logs, setLogs] = useState<Record<number, RunLog[]>>({});
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const tRes = await fetch(apiUrl("/processes/templates"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!tRes.ok) throw new Error("Could not load templates.");
      const tBody = await tRes.json();
      const match = (tBody.templates || []).find(
        (t: Record<string, unknown>) => t.slug === slug
      );
      if (!match) throw new Error(`No process template matches "${slug}".`);
      const id = Number(match.id);
      setTplId(id);
      setTplName(String(match.name ?? ""));

      const [rRes, sRes] = await Promise.all([
        fetch(apiUrl(`/processes/templates/${id}/autopilot-rules`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
        fetch(apiUrl(`/processes/templates/${id}/stages`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }).catch(() => null),
      ]);
      if (!rRes.ok) throw new Error("Could not load autopilot rules.");
      const rBody = await rRes.json();
      setRules(
        (rBody.rules || []).map((r: Record<string, unknown>) => ({
          id: Number(r.id),
          name: String(r.name ?? ""),
          description: (r.description as string | null) ?? null,
          isEnabled: Boolean(r.isEnabled),
          frequency: String(r.frequency ?? "month"),
          dayOfPeriod: r.dayOfPeriod != null ? Number(r.dayOfPeriod) : null,
          timeOfDay: (r.timeOfDay as string | null) ?? null,
          startingStageId: r.startingStageId != null ? Number(r.startingStageId) : null,
          conditionEntity: String(r.conditionEntity ?? "unit"),
          conditions: Array.isArray(r.conditions) ? (r.conditions as Cond[]) : [],
          lastRunAt: (r.lastRunAt as string | null) ?? null,
          nextRunAt: (r.nextRunAt as string | null) ?? null,
          totalRuns: Number(r.totalRuns ?? 0),
          totalProcessesCreated: Number(r.totalProcessesCreated ?? 0),
        }))
      );
      const sBody = sRes && sRes.ok ? await sRes.json() : { stages: [] };
      setStages(
        (sBody.stages || []).map((s: Record<string, unknown>) => ({
          id: Number(s.id),
          name: String(s.name ?? ""),
        }))
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load autopilot.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, slug, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function api(path: string, method: string, body?: unknown) {
    const res = await fetch(apiUrl(path), {
      method,
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { error?: string }).error || `Request failed (${res.status}).`);
    }
    return res.json().catch(() => ({}));
  }

  async function createRule() {
    if (!tplId || busy || !newName.trim()) return;
    setBusy(true);
    try {
      await api(`/processes/templates/${tplId}/autopilot-rules`, "POST", {
        name: newName.trim(),
        frequency: "month",
        conditionEntity: "unit",
        conditions: [],
      });
      setNewName("");
      setAdding(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create rule.");
    } finally {
      setBusy(false);
    }
  }

  async function saveRule(id: number, patch: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/autopilot-rules/${id}`, "PUT", patch);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save rule.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(rule: Rule) {
    if (busy) return;
    if (
      !rule.isEnabled &&
      !window.confirm(
        `Enable "${rule.name}"?\n\nWhile enabled, the autopilot cron will run this rule on its schedule and CREATE REAL PROCESSES for matching records. Use "Test" first to preview matches with no side effects.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api(`/autopilot-rules/${rule.id}/${rule.isEnabled ? "disable" : "enable"}`, "PUT");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not change rule state.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRule(id: number) {
    if (busy || !window.confirm("Delete this autopilot rule?")) return;
    setBusy(true);
    try {
      await api(`/autopilot-rules/${id}`, "DELETE");
      setRules((cur) => cur.filter((r) => r.id !== id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete rule.");
    } finally {
      setBusy(false);
    }
  }

  async function testRule(id: number) {
    if (busy) return;
    setBusy(true);
    setTestResults((cur) => ({ ...cur, [id]: "Running dry run…" }));
    try {
      const r = (await api(`/autopilot-rules/${id}/test`, "POST")) as TestResult;
      setTestResults((cur) => ({ ...cur, [id]: r }));
    } catch (e) {
      setTestResults((cur) => ({
        ...cur,
        [id]: e instanceof Error ? e.message : "Dry run failed.",
      }));
    } finally {
      setBusy(false);
    }
  }

  async function loadLog(id: number) {
    if (logs[id]) {
      setLogs((cur) => {
        const next = { ...cur };
        delete next[id];
        return next;
      });
      return;
    }
    try {
      const b = (await api(`/autopilot-rules/${id}/log`, "GET")) as { runs?: RunLog[] };
      setLogs((cur) => ({ ...cur, [id]: b.runs || [] }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load run log.");
    }
  }

  function condPatch(rule: Rule, next: Cond[]) {
    saveRule(rule.id, { conditions: next });
  }

  if (loading) {
    return <div data-pms className={styles.loading}>Loading autopilot…</div>;
  }

  return (
    <div data-pms className={styles.root}>
      <div className={styles.header}>
        <div>
          <div className={`${styles.eyebrow} pms-cond`}>{tplName || slug}</div>
          <h1 className={`${styles.title} pms-cond`}>Autopilot Rules</h1>
          <p className={styles.sub}>
            Automatically start this process for every record that matches a rule&rsquo;s
            conditions, on a schedule.
          </p>
        </div>
        {isAdmin && !adding && (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setAdding(true)}
          >
            <Plus size={14} /> Add Rule
          </button>
        )}
      </div>

      <div className={styles.safety}>
        <Info size={15} />
        <span>
          <b>Safe by default.</b> New rules are <b>disabled</b> — the every-minute autopilot
          cron skips them. <b>Test</b> runs a dry run (shows matched records, creates
          nothing). Only an explicitly <b>enabled</b> rule ever creates real processes.
        </span>
      </div>

      {err && <div className={styles.err}>{err}</div>}

      {isAdmin && adding && (
        <div className={styles.addRow}>
          <input
            autoFocus
            className={styles.input}
            placeholder="Rule name… (e.g. Start inspections 125 days out)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createRule();
              if (e.key === "Escape") setAdding(false);
            }}
          />
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={createRule}
            disabled={busy || !newName.trim()}
          >
            Create
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnLight}`}
            onClick={() => setAdding(false)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {rules.length === 0 ? (
        <div className={styles.empty}>
          No autopilot rules yet.{isAdmin ? " Add one — it starts disabled." : ""}
        </div>
      ) : (
        <div className={styles.ruleList}>
          {rules.map((rule) => {
            const test = testResults[rule.id];
            const ruleLog = logs[rule.id];
            return (
              <div key={rule.id} className={styles.ruleCard}>
                <div
                  className={`${styles.ruleHead} ${rule.isEnabled ? styles.ruleOn : ""}`}
                >
                  <div
                    className={styles.ruleIcon}
                    style={{
                      background: rule.isEnabled ? "var(--pms-navy)" : "var(--pms-ink-5)",
                    }}
                  >
                    <Zap size={17} color="#fff" />
                  </div>
                  <div className={styles.ruleHeadText}>
                    {isAdmin ? (
                      <input
                        className={styles.nameInput}
                        defaultValue={rule.name}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== rule.name) saveRule(rule.id, { name: v });
                        }}
                      />
                    ) : (
                      <div className={styles.ruleName}>{rule.name}</div>
                    )}
                    <div className={styles.ruleSchedule}>
                      Every {rule.frequency}
                      {rule.dayOfPeriod != null ? ` · day ${rule.dayOfPeriod}` : ""}
                      {rule.timeOfDay ? ` · ${rule.timeOfDay}` : ""} · for each{" "}
                      {rule.conditionEntity}
                      {rule.lastRunAt
                        ? ` · last run ${new Date(rule.lastRunAt).toLocaleDateString()}`
                        : " · never run"}
                      {` · ${rule.totalProcessesCreated} created`}
                    </div>
                  </div>

                  {isAdmin && (
                    <button
                      type="button"
                      className={`${styles.toggle} ${rule.isEnabled ? styles.toggleOn : ""}`}
                      onClick={() => toggleEnabled(rule)}
                      disabled={busy}
                      title={rule.isEnabled ? "Enabled — click to disable" : "Disabled — click to enable"}
                    >
                      <span className={styles.toggleKnob} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => testRule(rule.id)}
                    disabled={busy}
                    title="Test (dry run — no processes created)"
                  >
                    <FlaskConical size={14} /> Test
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => loadLog(rule.id)}
                    title="Run log"
                  >
                    <ScrollText size={14} />
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      className={styles.iconDanger}
                      onClick={() => deleteRule(rule.id)}
                      disabled={busy}
                      title="Delete rule"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                {typeof test !== "undefined" && (
                  <div className={styles.testResult}>
                    {typeof test === "string" ? (
                      test
                    ) : (
                      <>
                        <b>Dry run:</b> {test.matched} record(s) matched · 0 created (test).
                        {test.preview && test.preview.length > 0 && (
                          <div className={styles.previewList}>
                            {test.preview.slice(0, 8).map((p, i) => (
                              <span key={i} className={styles.previewChip}>
                                {p.name || `record ${i + 1}`}
                              </span>
                            ))}
                            {test.preview.length > 8 && (
                              <span className={styles.previewChip}>
                                +{test.preview.length - 8} more
                              </span>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                <div className={styles.ruleBody}>
                  <div className={styles.block}>
                    <div className={styles.blockTitle}>FREQUENCY</div>
                    <div className={styles.fieldRow}>
                      <label>Runs every</label>
                      <select
                        className={styles.select}
                        value={rule.frequency}
                        disabled={!isAdmin || busy}
                        onChange={(e) => saveRule(rule.id, { frequency: e.target.value })}
                      >
                        {FREQS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.fieldRow}>
                      <label>On day</label>
                      <input
                        className={styles.inputSm}
                        type="number"
                        defaultValue={rule.dayOfPeriod ?? 1}
                        disabled={!isAdmin || busy}
                        onBlur={(e) =>
                          saveRule(rule.id, {
                            dayOfPeriod: Number.parseInt(e.target.value, 10) || 1,
                          })
                        }
                      />
                    </div>
                    <div className={styles.fieldRow}>
                      <label>Starting stage</label>
                      <select
                        className={styles.select}
                        value={rule.startingStageId ?? 0}
                        disabled={!isAdmin || busy}
                        onChange={(e) =>
                          saveRule(rule.id, {
                            startingStageId: Number(e.target.value) || null,
                          })
                        }
                      >
                        <option value={0}>— default —</option>
                        {stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className={styles.block}>
                    <div className={styles.blockTitle}>CONDITIONS</div>
                    <div className={styles.fieldRow}>
                      <label>For each</label>
                      <select
                        className={styles.select}
                        value={rule.conditionEntity}
                        disabled={!isAdmin || busy}
                        onChange={(e) =>
                          saveRule(rule.id, { conditionEntity: e.target.value })
                        }
                      >
                        {ENTITIES.map((en) => (
                          <option key={en} value={en}>
                            {en}
                          </option>
                        ))}
                      </select>
                      <span className={styles.matchesLabel}>that matches:</span>
                    </div>
                    {rule.conditions.map((c, i) => (
                      <div key={i} className={styles.condRow}>
                        <input
                          className={styles.condInput}
                          placeholder="field"
                          defaultValue={c.field}
                          disabled={!isAdmin || busy}
                          onBlur={(e) => {
                            const next = [...rule.conditions];
                            next[i] = { ...c, field: e.target.value };
                            condPatch(rule, next);
                          }}
                        />
                        <select
                          className={styles.condOp}
                          value={c.op}
                          disabled={!isAdmin || busy}
                          onChange={(e) => {
                            const next = [...rule.conditions];
                            next[i] = { ...c, op: e.target.value };
                            condPatch(rule, next);
                          }}
                        >
                          {OPS.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                        <input
                          className={styles.condInput}
                          placeholder="value"
                          defaultValue={c.value}
                          disabled={!isAdmin || busy}
                          onBlur={(e) => {
                            const next = [...rule.conditions];
                            next[i] = { ...c, value: e.target.value };
                            condPatch(rule, next);
                          }}
                        />
                        {isAdmin && (
                          <button
                            type="button"
                            className={styles.condDel}
                            onClick={() =>
                              condPatch(
                                rule,
                                rule.conditions.filter((_, j) => j !== i)
                              )
                            }
                            disabled={busy}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                    {isAdmin && (
                      <button
                        type="button"
                        className={styles.addCond}
                        onClick={() =>
                          condPatch(rule, [
                            ...rule.conditions,
                            { field: "", op: "is", value: "" },
                          ])
                        }
                        disabled={busy}
                      >
                        <Plus size={12} /> Add Condition
                      </button>
                    )}
                  </div>
                </div>

                {ruleLog && (
                  <div className={styles.logBox}>
                    <div className={styles.logTitle}>Recent runs</div>
                    {ruleLog.length === 0 ? (
                      <div className={styles.logEmpty}>No runs recorded.</div>
                    ) : (
                      ruleLog.slice(0, 10).map((l) => (
                        <div key={l.id} className={styles.logRow}>
                          <span>{new Date(l.runAt).toLocaleString()}</span>
                          <span className={styles.logStat}>{l.status}</span>
                          <span className={styles.logStat}>
                            {l.entitiesMatched} matched · {l.processesCreated} created ·{" "}
                            {l.duplicatesSkipped} dup
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
