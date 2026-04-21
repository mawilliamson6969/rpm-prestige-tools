"use client";

import { useMemo, useState } from "react";
import styles from "./operations.module.css";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";
import type {
  AutoActionConfig,
  AutoActionType,
  Template,
  TeamUser,
  TemplateStep,
} from "./types";
import { AUTO_ACTION_LABELS, ROLES } from "./types";

type Props = {
  step: TemplateStep;
  users: TeamUser[];
  templates: Template[];
  onChange: (patch: { autoAction: AutoActionType | null; autoActionConfig: AutoActionConfig }) => void;
};

const TEMPLATE_VARS = [
  "{{contact_name}}",
  "{{contact_email}}",
  "{{property_name}}",
  "{{process_name}}",
  "{{started_at}}",
];

export default function AutomationConfigEditor({ step, users, templates, onChange }: Props) {
  const { authHeaders, isAdmin } = useAuth();
  const enabled = !!step.autoAction;
  const action = step.autoAction;
  const config = (step.autoActionConfig || {}) as Record<string, unknown>;
  const [testResult, setTestResult] = useState<null | { ok: boolean; text: string }>(null);
  const [testing, setTesting] = useState(false);

  const setAction = (next: AutoActionType | null) => {
    onChange({
      autoAction: next,
      autoActionConfig: next ? defaultConfigFor(next) : null,
    });
    setTestResult(null);
  };

  const updateConfig = (patch: Record<string, unknown>) => {
    onChange({ autoAction: action, autoActionConfig: { ...config, ...patch } });
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(
        apiUrl(`/processes/template-steps/${step.id}/test-automation`),
        { method: "POST", headers: { ...authHeaders() } }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        setTestResult({
          ok: false,
          text: typeof body.error === "string" ? body.error : "Test failed.",
        });
      } else {
        setTestResult({
          ok: true,
          text: `Dry run — ${body.action}\n\nResolved config:\n${JSON.stringify(
            body.resolvedConfig,
            null,
            2
          )}\n\nSample variables:\n${JSON.stringify(body.sampleVariables, null, 2)}`,
        });
      }
    } catch (e) {
      setTestResult({ ok: false, text: e instanceof Error ? e.message : "Test failed." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={styles.automationBlock}>
      <div className={styles.automationHead}>
        <span className={styles.automationLabel}>
          ⚡ Automation {enabled ? `— ${AUTO_ACTION_LABELS[action!]?.label ?? ""}` : ""}
        </span>
        <label className={styles.automationToggle}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setAction(e.target.checked ? "send_email" : null)}
          />
          Automate this step
        </label>
      </div>
      {enabled ? (
        <>
          <div className={styles.automationFields}>
            <label className={styles.automationFullWidth}>
              Action type
              <select value={action ?? ""} onChange={(e) => setAction(e.target.value as AutoActionType)}>
                {(Object.keys(AUTO_ACTION_LABELS) as AutoActionType[]).map((a) => (
                  <option key={a} value={a}>
                    {AUTO_ACTION_LABELS[a].icon} {AUTO_ACTION_LABELS[a].label}
                  </option>
                ))}
              </select>
            </label>
            {action === "send_email" ? <SendEmailFields config={config} update={updateConfig} /> : null}
            {action === "notify" ? (
              <NotifyFields config={config} update={updateConfig} users={users} />
            ) : null}
            {action === "create_folder" ? (
              <CreateFolderFields config={config} update={updateConfig} />
            ) : null}
            {action === "create_task" ? (
              <CreateTaskFields config={config} update={updateConfig} users={users} />
            ) : null}
            {action === "auto_complete_delay" ? (
              <DelayFields config={config} update={updateConfig} />
            ) : null}
            {action === "webhook" ? <WebhookFields config={config} update={updateConfig} /> : null}
            {action === "launch_process" ? (
              <LaunchProcessFields config={config} update={updateConfig} templates={templates} />
            ) : null}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span className={styles.templateVarHint}>
              Variables: {TEMPLATE_VARS.join("  ")}
            </span>
            {isAdmin ? (
              <button
                type="button"
                className={`${styles.smallBtn}`}
                onClick={runTest}
                disabled={testing}
              >
                {testing ? "Testing…" : "⚡ Test this automation"}
              </button>
            ) : null}
          </div>
          {testResult ? (
            <div
              className={`${styles.automationTestResult} ${
                testResult.ok ? styles.automationTestOk : styles.automationTestErr
              }`}
            >
              {testResult.text}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function defaultConfigFor(action: AutoActionType): AutoActionConfig {
  switch (action) {
    case "send_email":
      return { to: "{{contact_email}}", subject: "", body: "" };
    case "notify":
      return { message: "", notify_role: "" };
    case "create_folder":
      return { folder_type: "property", folder_name: "{{property_name}}" };
    case "create_task":
      return { title: "", priority: "normal", due_days_from_now: 3 };
    case "auto_complete_delay":
      return { delay_days: 7 };
    case "webhook":
      return { url: "", method: "POST", body: {} };
    case "launch_process":
      return { template_id: null, inherit_property: true, inherit_contact: true };
    default:
      return {};
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function SendEmailFields({
  config,
  update,
}: {
  config: Record<string, unknown>;
  update: (p: Record<string, unknown>) => void;
}) {
  return (
    <>
      <label>
        To
        <input value={str(config.to)} onChange={(e) => update({ to: e.target.value })} />
      </label>
      <label>
        CC
        <input value={str(config.cc)} onChange={(e) => update({ cc: e.target.value })} />
      </label>
      <label className={styles.automationFullWidth}>
        Subject
        <input value={str(config.subject)} onChange={(e) => update({ subject: e.target.value })} />
      </label>
      <label className={styles.automationFullWidth}>
        Body
        <textarea
          rows={5}
          value={str(config.body)}
          onChange={(e) => update({ body: e.target.value })}
          placeholder="Hi {{contact_name}},&#10;&#10;Your process has started..."
        />
      </label>
    </>
  );
}

function NotifyFields({
  config,
  update,
  users,
}: {
  config: Record<string, unknown>;
  update: (p: Record<string, unknown>) => void;
  users: TeamUser[];
}) {
  return (
    <>
      <label>
        Notify user
        <select
          value={str(config.notify_user_id)}
          onChange={(e) =>
            update({ notify_user_id: e.target.value ? Number(e.target.value) : null })
          }
        >
          <option value="">— None —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Or role
        <select
          value={str(config.notify_role)}
          onChange={(e) => update({ notify_role: e.target.value })}
        >
          <option value="">— None —</option>
          <option value="admin">Admin</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.automationFullWidth}>
        Message
        <input
          value={str(config.message)}
          onChange={(e) => update({ message: e.target.value })}
          placeholder="Step is ready on {{process_name}}"
        />
      </label>
    </>
  );
}

function CreateFolderFields({
  config,
  update,
}: {
  config: Record<string, unknown>;
  update: (p: Record<string, unknown>) => void;
}) {
  return (
    <>
      <label>
        Folder type
        <select
          value={str(config.folder_type) || "property"}
          onChange={(e) => update({ folder_type: e.target.value })}
        >
          <option value="property">Property</option>
          <option value="owner">Owner</option>
        </select>
      </label>
      <label className={styles.automationFullWidth}>
        Folder name
        <input
          value={str(config.folder_name)}
          onChange={(e) => update({ folder_name: e.target.value })}
        />
      </label>
    </>
  );
}

function CreateTaskFields({
  config,
  update,
  users,
}: {
  config: Record<string, unknown>;
  update: (p: Record<string, unknown>) => void;
  users: TeamUser[];
}) {
  return (
    <>
      <label className={styles.automationFullWidth}>
        Title
        <input value={str(config.title)} onChange={(e) => update({ title: e.target.value })} />
      </label>
      <label>
        Assign to
        <select
          value={str(config.assigned_user_id)}
          onChange={(e) =>
            update({ assigned_user_id: e.target.value ? Number(e.target.value) : null })
          }
        >
          <option value="">— Unassigned —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Priority
        <select
          value={str(config.priority) || "normal"}
          onChange={(e) => update({ priority: e.target.value })}
        >
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </label>
      <label>
        Due in (days)
        <input
          type="number"
          min={0}
          value={num(config.due_days_from_now, 3)}
          onChange={(e) => update({ due_days_from_now: Number(e.target.value) || 0 })}
        />
      </label>
    </>
  );
}

function DelayFields({
  config,
  update,
}: {
  config: Record<string, unknown>;
  update: (p: Record<string, unknown>) => void;
}) {
  return (
    <label className={styles.automationFullWidth}>
      Delay (days)
      <input
        type="number"
        min={0}
        value={num(config.delay_days, 7)}
        onChange={(e) => update({ delay_days: Number(e.target.value) || 0 })}
      />
    </label>
  );
}

function WebhookFields({
  config,
  update,
}: {
  config: Record<string, unknown>;
  update: (p: Record<string, unknown>) => void;
}) {
  const bodyText = useMemo(() => {
    const b = config.body;
    if (typeof b === "string") return b;
    try {
      return JSON.stringify(b ?? {}, null, 2);
    } catch {
      return "";
    }
  }, [config.body]);
  return (
    <>
      <label className={styles.automationFullWidth}>
        URL
        <input
          value={str(config.url)}
          onChange={(e) => update({ url: e.target.value })}
          placeholder="https://hooks.example.com/incoming"
        />
      </label>
      <label>
        Method
        <select
          value={str(config.method) || "POST"}
          onChange={(e) => update({ method: e.target.value })}
        >
          <option>POST</option>
          <option>GET</option>
          <option>PUT</option>
          <option>PATCH</option>
          <option>DELETE</option>
        </select>
      </label>
      <label className={styles.automationFullWidth}>
        Body (JSON)
        <textarea
          rows={4}
          value={bodyText}
          onChange={(e) => {
            const raw = e.target.value;
            try {
              update({ body: JSON.parse(raw) });
            } catch {
              update({ body: raw });
            }
          }}
          placeholder='{"process": "{{process_name}}"}'
        />
      </label>
    </>
  );
}

function LaunchProcessFields({
  config,
  update,
  templates,
}: {
  config: Record<string, unknown>;
  update: (p: Record<string, unknown>) => void;
  templates: Template[];
}) {
  return (
    <>
      <label className={styles.automationFullWidth}>
        Template to launch
        <select
          value={str(config.template_id)}
          onChange={(e) =>
            update({ template_id: e.target.value ? Number(e.target.value) : null })
          }
        >
          <option value="">— Select template —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.icon} {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={config.inherit_property !== false}
          onChange={(e) => update({ inherit_property: e.target.checked })}
        />{" "}
        Inherit property
      </label>
      <label>
        <input
          type="checkbox"
          checked={config.inherit_contact !== false}
          onChange={(e) => update({ inherit_contact: e.target.checked })}
        />{" "}
        Inherit contact
      </label>
    </>
  );
}
