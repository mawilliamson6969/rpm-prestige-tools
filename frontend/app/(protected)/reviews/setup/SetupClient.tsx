"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import ReviewsNav from "../ReviewsNav";
import styles from "../reviews.module.css";

type SetupStatus = {
  google: {
    configured: boolean;
    connected: boolean;
    accountId: string | null;
    locationId: string | null;
    connectedAt: string | null;
  };
  openphone: { configured: boolean; fromNumber: string | null };
  reviewUrl: string;
  emailConfigured: boolean;
};

type GoogleAccount = { id: string; name: string; type: string | null; role: string | null };
type GoogleLocation = { id: string; title: string; address: string };

export default function SetupClient() {
  const { authHeaders, isAdmin } = useAuth();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [accounts, setAccounts] = useState<GoogleAccount[] | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsErr, setAccountsErr] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [locations, setLocations] = useState<GoogleLocation[] | null>(null);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [savingSelection, setSavingSelection] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(apiUrl("/reviews/setup"), { headers: { ...authHeaders() } });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setStatus(body);
      setUrlInput(body.reviewUrl || "");
    }
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setAccountsErr(null);
    try {
      const res = await fetch(apiUrl("/reviews/google/accounts"), {
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not list accounts.");
      setAccounts(body.accounts || []);
      if (body.accounts?.length === 1) setSelectedAccountId(body.accounts[0].id);
    } catch (e) {
      setAccountsErr(e instanceof Error ? e.message : "Failed.");
    } finally {
      setAccountsLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    if (status?.google.connected && !status.google.locationId) loadAccounts();
  }, [status?.google.connected, status?.google.locationId, loadAccounts]);

  useEffect(() => {
    if (!selectedAccountId) {
      setLocations(null);
      return;
    }
    setLocationsLoading(true);
    fetch(apiUrl(`/reviews/google/accounts/${encodeURIComponent(selectedAccountId)}/locations`), {
      headers: { ...authHeaders() },
    })
      .then((r) => r.json().then((b) => ({ ok: r.ok, b })))
      .then(({ ok, b }) => {
        if (ok && Array.isArray(b.locations)) {
          setLocations(b.locations);
          if (b.locations.length === 1) setSelectedLocationId(b.locations[0].id);
        } else {
          setAccountsErr(b.error || "Could not list locations.");
        }
      })
      .finally(() => setLocationsLoading(false));
  }, [selectedAccountId, authHeaders]);

  const retryDiscovery = async () => {
    setDiscovering(true);
    setMsg(null);
    setAccountsErr(null);
    try {
      const res = await fetch(apiUrl("/reviews/google/auto-discover"), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Discovery failed.");
      setMsg(
        `Discovered: ${body.accountName || body.accountId} · ${body.locationTitle || body.locationId}. Syncing reviews now…`
      );
      await load();
    } catch (e) {
      setAccountsErr(e instanceof Error ? e.message : "Discovery failed.");
    } finally {
      setDiscovering(false);
      setTimeout(() => setMsg(null), 5000);
    }
  };

  const saveSelection = async () => {
    if (!selectedAccountId || !selectedLocationId) return;
    setSavingSelection(true);
    try {
      const res = await fetch(apiUrl("/reviews/google/selection"), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ accountId: selectedAccountId, locationId: selectedLocationId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Save failed.");
      setMsg("Saved! Starting review sync…");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSavingSelection(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  const saveUrl = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(apiUrl("/reviews/setup/url"), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Save failed.");
      setMsg("Saved.");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  const connectGoogle = async () => {
    setConnecting(true);
    try {
      const res = await fetch(apiUrl("/reviews/google/authorize-url"), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.authorizeUrl) {
        alert(body.error || "Could not start Google OAuth. Make sure GOOGLE_BUSINESS_CLIENT_ID is set.");
        return;
      }
      window.location.href = body.authorizeUrl;
    } finally {
      setConnecting(false);
    }
  };

  const disconnectGoogle = async () => {
    if (!window.confirm("Disconnect Google Business Profile?")) return;
    await fetch(apiUrl("/reviews/google/connection"), {
      method: "DELETE",
      headers: { ...authHeaders() },
    });
    load();
  };

  return (
    <div className={styles.page}>
      <div className={styles.topRow}>
        <div>
          <h1 className={styles.title}>🔧 Reviews Setup</h1>
          <p className={styles.sub}>Connect Google Business Profile, configure SMS, and set your review URL.</p>
        </div>
      </div>

      <ReviewsNav />

      {msg ? <div className={styles.insightCallout}>{msg}</div> : null}

      <div className={styles.setupBox}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", display: "flex", alignItems: "center" }}>
          Step 1 — Google Business Profile
          <span
            className={`${styles.setupStatus} ${
              status?.google.connected
                ? styles.setupStatusOk
                : status?.google.configured
                ? styles.setupStatusWarn
                : styles.setupStatusErr
            }`}
          >
            {status?.google.connected
              ? "✓ Connected"
              : status?.google.configured
              ? "Not connected"
              : "Not configured"}
          </span>
        </h2>
        <p style={{ color: "#6a737b", fontSize: "0.88rem", margin: "0.5rem 0 0.85rem" }}>
          Connect so reviews sync every 30 minutes and replies can be posted from here.
        </p>
        {!status?.google.configured ? (
          <p style={{ fontSize: "0.85rem", color: "#6a737b" }}>
            Ask your administrator to set <code>GOOGLE_BUSINESS_CLIENT_ID</code>,{" "}
            <code>GOOGLE_BUSINESS_CLIENT_SECRET</code>, <code>GOOGLE_BUSINESS_ACCOUNT_ID</code>, and{" "}
            <code>GOOGLE_BUSINESS_LOCATION_ID</code> in the backend environment.
          </p>
        ) : status?.google.connected ? (
          <>
            {status.google.locationId ? (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ fontSize: "0.85rem", color: "#6a737b" }}>
                  Account: <code>{status.google.accountId}</code> · Location:{" "}
                  <code>{status.google.locationId}</code>
                </div>
                {isAdmin ? (
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => {
                      setSelectedAccountId("");
                      setSelectedLocationId("");
                      setLocations(null);
                      loadAccounts();
                    }}
                  >
                    Change location
                  </button>
                ) : null}
                {isAdmin ? (
                  <button type="button" className={styles.btnDanger} onClick={disconnectGoogle}>
                    Disconnect
                  </button>
                ) : null}
              </div>
            ) : (
              <div>
                <p style={{ fontSize: "0.88rem", color: "#1b2856", margin: "0 0 0.85rem" }}>
                  Pick the account and location to sync reviews from, or let us auto-select
                  the first one found.
                </p>
                {isAdmin ? (
                  <div style={{ marginBottom: "0.85rem" }}>
                    <button
                      type="button"
                      className={styles.btnPrimary}
                      onClick={retryDiscovery}
                      disabled={discovering}
                    >
                      {discovering ? "Discovering…" : "🔄 Retry Auto-Discovery"}
                    </button>
                    <p style={{ fontSize: "0.75rem", color: "#6a737b", margin: "0.35rem 0 0" }}>
                      Picks the first account + first location. Use the dropdowns below if you
                      have more than one location.
                    </p>
                  </div>
                ) : null}
                {accountsErr ? (
                  <div
                    className={styles.insightCallout}
                    style={{ color: "#b32317", marginBottom: "0.75rem" }}
                  >
                    {accountsErr}
                  </div>
                ) : null}
                <div style={{ display: "grid", gap: "0.65rem", maxWidth: "28rem" }}>
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        color: "#1b2856",
                        marginBottom: "0.25rem",
                      }}
                    >
                      Google Business account
                    </label>
                    <select
                      value={selectedAccountId}
                      onChange={(e) => {
                        setSelectedAccountId(e.target.value);
                        setSelectedLocationId("");
                      }}
                      disabled={accountsLoading || !accounts}
                      style={{
                        width: "100%",
                        borderRadius: 8,
                        border: "1px solid rgba(27,40,86,0.15)",
                        padding: "0.55rem 0.7rem",
                        fontSize: "0.9rem",
                      }}
                    >
                      <option value="">
                        {accountsLoading
                          ? "Loading accounts…"
                          : accounts?.length
                          ? "— Select —"
                          : "(no accounts found)"}
                      </option>
                      {(accounts || []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name || a.id}
                          {a.type ? ` (${a.type.toLowerCase()})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        color: "#1b2856",
                        marginBottom: "0.25rem",
                      }}
                    >
                      Location
                    </label>
                    <select
                      value={selectedLocationId}
                      onChange={(e) => setSelectedLocationId(e.target.value)}
                      disabled={!selectedAccountId || locationsLoading || !locations}
                      style={{
                        width: "100%",
                        borderRadius: 8,
                        border: "1px solid rgba(27,40,86,0.15)",
                        padding: "0.55rem 0.7rem",
                        fontSize: "0.9rem",
                      }}
                    >
                      <option value="">
                        {!selectedAccountId
                          ? "(pick an account first)"
                          : locationsLoading
                          ? "Loading locations…"
                          : locations?.length
                          ? "— Select —"
                          : "(no locations found)"}
                      </option>
                      {(locations || []).map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title}
                          {l.address ? ` — ${l.address}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={styles.btnPrimary}
                      onClick={saveSelection}
                      disabled={
                        !isAdmin ||
                        savingSelection ||
                        !selectedAccountId ||
                        !selectedLocationId
                      }
                    >
                      {savingSelection ? "Saving…" : "Save & Sync Reviews"}
                    </button>
                    {isAdmin ? (
                      <button
                        type="button"
                        className={styles.btnDanger}
                        onClick={disconnectGoogle}
                      >
                        Disconnect
                      </button>
                    ) : null}
                  </div>
                  {!isAdmin ? (
                    <p style={{ fontSize: "0.78rem", color: "#6a737b" }}>
                      Only admins can save the selection.
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </>
        ) : (
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={connectGoogle}
            disabled={connecting}
          >
            {connecting ? "Redirecting…" : "Connect Google →"}
          </button>
        )}
      </div>

      <div className={styles.setupBox}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", display: "flex", alignItems: "center" }}>
          Step 2 — OpenPhone (SMS)
          <span
            className={`${styles.setupStatus} ${
              status?.openphone.configured ? styles.setupStatusOk : styles.setupStatusWarn
            }`}
          >
            {status?.openphone.configured ? "✓ Configured" : "Not configured"}
          </span>
        </h2>
        <p style={{ color: "#6a737b", fontSize: "0.88rem", margin: "0.5rem 0 0.85rem" }}>
          {status?.openphone.configured
            ? `SMS will be sent from ${status.openphone.fromNumber}.`
            : "Set OPENPHONE_API_KEY and OPENPHONE_FROM_NUMBER to enable SMS review requests. Email still works without it."}
        </p>
      </div>

      <div className={styles.setupBox}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", display: "flex", alignItems: "center" }}>
          Step 3 — Microsoft Graph (Email)
          <span
            className={`${styles.setupStatus} ${
              status?.emailConfigured ? styles.setupStatusOk : styles.setupStatusWarn
            }`}
          >
            {status?.emailConfigured ? "✓ Ready" : "Connect inbox"}
          </span>
        </h2>
        <p style={{ color: "#6a737b", fontSize: "0.88rem", margin: "0.5rem 0" }}>
          Review emails use an existing Microsoft connection from the shared inbox. If none is connected,{" "}
          <a href="/inbox/settings" style={{ color: "#0098D0" }}>
            connect a mailbox here
          </a>
          .
        </p>
      </div>

      <div className={styles.setupBox}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", display: "flex", alignItems: "center" }}>
          Step 4 — Google Review Link
          <span
            className={`${styles.setupStatus} ${
              status?.reviewUrl ? styles.setupStatusOk : styles.setupStatusWarn
            }`}
          >
            {status?.reviewUrl ? "✓ Set" : "Not set"}
          </span>
        </h2>
        <p style={{ color: "#6a737b", fontSize: "0.88rem", margin: "0.5rem 0 0.85rem" }}>
          This is the link recipients click to leave you a review. Find it in Google Business Profile →
          Share → Copy review link. It usually starts with <code>https://g.page/r/</code>.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://g.page/r/..."
            style={{
              flex: 1,
              minWidth: "20rem",
              borderRadius: 8,
              border: "1px solid rgba(27,40,86,0.15)",
              padding: "0.55rem 0.7rem",
              fontSize: "0.88rem",
            }}
          />
          {urlInput ? (
            <a
              href={urlInput}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.btnSecondary}
              style={{ textDecoration: "none" }}
            >
              Test Link
            </a>
          ) : null}
          {isAdmin ? (
            <button type="button" className={styles.btnPrimary} onClick={saveUrl} disabled={saving}>
              {saving ? "Saving…" : "Save URL"}
            </button>
          ) : null}
        </div>
        {!isAdmin ? (
          <p style={{ fontSize: "0.78rem", color: "#6a737b", marginTop: "0.5rem" }}>
            Only admins can change the review URL.
          </p>
        ) : null}
      </div>
    </div>
  );
}
