"use client";

import type { CSSProperties, FormEvent } from "react";
import { useMemo, useState } from "react";
import { ownerTerminationBasePath } from "../../lib/api";
import { SignatureField } from "./SignatureField";

const NAVY = "#1B2856";
const LIGHT_BLUE = "#0098D0";
const RED = "#B32317";
const GREY = "#6A737B";
const WHITE = "#FFFFFF";
const OFF_WHITE = "#F5F5F5";
const GOLD = "#D4A017";

const REASON_OPTIONS = [
  { value: "selling_the_property", label: "Selling the property" },
  { value: "dissatisfied_with_rpm", label: "Dissatisfied with Real Property Management Prestige" },
  { value: "other_property_management", label: "Going with another property management company" },
  { value: "self_management", label: "Taking over management myself" },
  { value: "financial", label: "Financial reasons" },
  { value: "other", label: "Other" },
];

function tomorrowDateInputMin() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayDisplay() {
  return new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const sectionCard: CSSProperties = {
  background: WHITE,
  borderRadius: 12,
  padding: "1.25rem clamp(1rem, 3vw, 1.75rem)",
  marginBottom: "1.25rem",
  border: `1px solid rgba(27, 40, 86, 0.12)`,
  boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
};

const labelStyle: CSSProperties = {
  display: "block",
  fontWeight: 600,
  color: NAVY,
  marginBottom: 6,
  fontSize: "0.95rem",
};

const inputStyle: CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  padding: "0.55rem 0.65rem",
  borderRadius: 8,
  border: `1px solid ${GREY}`,
  fontSize: "1rem",
};

export default function OwnerTerminationForm() {
  const [submitterType, setSubmitterType] = useState<"property_owner" | "staff" | "">("");
  const [staffMemberName, setStaffMemberName] = useState("");
  const [email, setEmail] = useState("");
  const [ownerFirst, setOwnerFirst] = useState("");
  const [ownerLast, setOwnerLast] = useState("");
  const [street, setStreet] = useState("");
  const [street2, setStreet2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [dateReceived, setDateReceived] = useState("");
  const [dateEffective, setDateEffective] = useState("");
  const [reason, setReason] = useState("");
  const [reasonDetails, setReasonDetails] = useState("");
  const [retention, setRetention] = useState<"yes" | "no" | "">("");
  const [improvementFeedback, setImprovementFeedback] = useState("");
  const [ack1, setAck1] = useState(false);
  const [ack2, setAck2] = useState(false);
  const [ack3, setAck3] = useState(false);
  const [ack4, setAck4] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const minEffective = useMemo(() => tomorrowDateInputMin(), []);

  const showStaffField = submitterType === "staff";
  const showRetentionNoSections = retention === "no";
  const showRetentionYesMessage = retention === "yes";

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!submitterType) e.submitterType = "Please select who is submitting this form.";
    if (submitterType === "staff" && !staffMemberName.trim()) e.staffMemberName = "Staff member name is required.";
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = "Valid email is required.";
    if (!ownerFirst.trim()) e.ownerFirst = "First name is required.";
    if (!ownerLast.trim()) e.ownerLast = "Last name is required.";
    if (!street.trim()) e.street = "Street address is required.";
    if (!city.trim()) e.city = "City is required.";
    if (!state.trim()) e.state = "State is required.";
    if (!zip.trim()) e.zip = "Postal / ZIP code is required.";
    if (!dateReceived) e.dateReceived = "This date is required.";
    if (!dateEffective) e.dateEffective = "This date is required.";
    else if (dateEffective < minEffective) e.dateEffective = "Termination date must be in the future.";
    if (!reason) e.reason = "Please select a reason.";
    if (!retention) e.retention = "Please answer the retention question.";

    if (retention === "no") {
      if (!improvementFeedback.trim()) e.improvementFeedback = "This field is required.";
      if (!ack1) e.ack1 = "Required.";
      if (!ack2) e.ack2 = "Required.";
      if (!ack3) e.ack3 = "Required.";
      if (!ack4) e.ack4 = "Required.";
      if (!signatureData || signatureData.length < 50) e.signature = "Please sign above.";
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(ev: FormEvent) {
    ev.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    const payload: Record<string, unknown> = {
      submitter_type: submitterType,
      staff_member_name: submitterType === "staff" ? staffMemberName.trim() : null,
      email: email.trim(),
      owner_first_name: ownerFirst.trim(),
      owner_last_name: ownerLast.trim(),
      street_address: street.trim(),
      street_address_2: street2.trim() || null,
      city: city.trim(),
      state: state.trim(),
      zip_code: zip.trim(),
      date_received_in_writing: dateReceived,
      requested_termination_date: dateEffective,
      termination_reason: reason,
      reason_details: reasonDetails.trim() || null,
      retention_offer_accepted: retention,
    };

    if (retention === "no") {
      payload.improvement_feedback = improvementFeedback.trim();
      payload.guarantees_acknowledged = true;
      payload.deposit_waiver_acknowledged = true;
      payload.deposit_return_acknowledged = true;
      payload.keys_balance_acknowledged = true;
      payload.signature_data = signatureData;
    } else {
      payload.improvement_feedback = null;
      payload.guarantees_acknowledged = null;
      payload.deposit_waiver_acknowledged = null;
      payload.deposit_return_acknowledged = null;
      payload.keys_balance_acknowledged = null;
      payload.signature_data = null;
    }

    setSubmitting(true);
    try {
      const res = await fetch(ownerTerminationBasePath(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          Array.isArray(body.details) && body.details.length
            ? body.details.join(" ")
            : typeof body.error === "string"
              ? body.error
              : `Request failed (${res.status}).`;
        throw new Error(msg);
      }
      setSuccess(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: OFF_WHITE,
          padding: "2rem clamp(1rem, 4vw, 2.5rem)",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        }}
      >
        <div style={{ maxWidth: 640, margin: "0 auto", ...sectionCard, textAlign: "center" as const }}>
          <h1 style={{ color: NAVY, fontSize: "1.35rem", marginTop: 0 }}>Request received</h1>
          <p style={{ color: GREY, lineHeight: 1.6, fontSize: "1.05rem" }}>
            Your termination request has been received. Our Client Success Manager will contact you within 24 hours to
            discuss next steps and the termination timeline.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: OFF_WHITE,
        padding: "1.5rem clamp(1rem, 4vw, 2.5rem) 3rem",
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        color: NAVY,
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <header style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div
            style={{
              fontSize: "clamp(1.15rem, 3.5vw, 1.5rem)",
              fontWeight: 800,
              letterSpacing: "0.02em",
              color: NAVY,
              lineHeight: 1.25,
            }}
          >
            Real Property Management Prestige
          </div>
          <div style={{ fontSize: "0.85rem", color: LIGHT_BLUE, fontWeight: 600, marginTop: 6 }}>
            Owner Request to Terminate Management
          </div>
        </header>

        <form onSubmit={handleSubmit} noValidate>
          {/* Section 1 */}
          <section style={sectionCard}>
            <h2 style={{ margin: "0 0 1rem", fontSize: "1.1rem", color: LIGHT_BLUE }}>1. Submitter identification</h2>
            <p style={{ margin: "0 0 0.75rem", fontWeight: 600 }}>Who is submitting this form?</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="submitter"
                  checked={submitterType === "property_owner"}
                  onChange={() => setSubmitterType("property_owner")}
                />
                Property Owner
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="submitter"
                  checked={submitterType === "staff"}
                  onChange={() => setSubmitterType("staff")}
                />
                Real Property Management Prestige Staff Member
              </label>
            </div>
            {errors.submitterType && (
              <p style={{ color: RED, fontSize: "0.9rem", margin: "0.5rem 0 0" }}>{errors.submitterType}</p>
            )}
            {showStaffField && (
              <div style={{ marginTop: 14 }}>
                <label style={labelStyle}>Staff member name</label>
                <input
                  style={{ ...inputStyle, borderColor: errors.staffMemberName ? RED : GREY }}
                  value={staffMemberName}
                  onChange={(ev) => setStaffMemberName(ev.target.value)}
                  autoComplete="name"
                />
                {errors.staffMemberName && (
                  <p style={{ color: RED, fontSize: "0.85rem", margin: "0.35rem 0 0" }}>{errors.staffMemberName}</p>
                )}
              </div>
            )}
            <div style={{ marginTop: 14 }}>
              <label style={labelStyle}>Email address *</label>
              <input
                type="email"
                required
                style={{ ...inputStyle, borderColor: errors.email ? RED : GREY }}
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                autoComplete="email"
              />
              {errors.email && <p style={{ color: RED, fontSize: "0.85rem", margin: "0.35rem 0 0" }}>{errors.email}</p>}
            </div>
          </section>

          {/* Section 2 */}
          <section style={sectionCard}>
            <h2 style={{ margin: "0 0 1rem", fontSize: "1.1rem", color: LIGHT_BLUE }}>2. Owner information</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
              <div>
                <label style={labelStyle}>Owner first name *</label>
                <input
                  style={{ ...inputStyle, borderColor: errors.ownerFirst ? RED : GREY }}
                  value={ownerFirst}
                  onChange={(ev) => setOwnerFirst(ev.target.value)}
                  autoComplete="given-name"
                />
                {errors.ownerFirst && (
                  <p style={{ color: RED, fontSize: "0.85rem", margin: "0.35rem 0 0" }}>{errors.ownerFirst}</p>
                )}
              </div>
              <div>
                <label style={labelStyle}>Owner last name *</label>
                <input
                  style={{ ...inputStyle, borderColor: errors.ownerLast ? RED : GREY }}
                  value={ownerLast}
                  onChange={(ev) => setOwnerLast(ev.target.value)}
                  autoComplete="family-name"
                />
                {errors.ownerLast && (
                  <p style={{ color: RED, fontSize: "0.85rem", margin: "0.35rem 0 0" }}>{errors.ownerLast}</p>
                )}
              </div>
            </div>
          </section>

          {/* Section 3 */}
          <section style={sectionCard}>
            <h2 style={{ margin: "0 0 1rem", fontSize: "1.1rem", color: LIGHT_BLUE }}>3. Property information</h2>
            <label style={labelStyle}>Street address *</label>
            <input
              style={{ ...inputStyle, marginBottom: 12, borderColor: errors.street ? RED : GREY }}
              value={street}
              onChange={(ev) => setStreet(ev.target.value)}
            />
            {errors.street && (
              <p style={{ color: RED, fontSize: "0.85rem", margin: "-8px 0 12px" }}>{errors.street}</p>
            )}
            <label style={labelStyle}>Street address line 2</label>
            <input style={{ ...inputStyle, marginBottom: 12 }} value={street2} onChange={(ev) => setStreet2(ev.target.value)} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
              <div>
                <label style={labelStyle}>City *</label>
                <input
                  style={{ ...inputStyle, borderColor: errors.city ? RED : GREY }}
                  value={city}
                  onChange={(ev) => setCity(ev.target.value)}
                />
                {errors.city && <p style={{ color: RED, fontSize: "0.85rem", margin: "0.35rem 0 0" }}>{errors.city}</p>}
              </div>
              <div>
                <label style={labelStyle}>State *</label>
                <input
                  style={{ ...inputStyle, borderColor: errors.state ? RED : GREY }}
                  value={state}
                  onChange={(ev) => setState(ev.target.value)}
                  maxLength={64}
                />
                {errors.state && (
                  <p style={{ color: RED, fontSize: "0.85rem", margin: "0.35rem 0 0" }}>{errors.state}</p>
                )}
              </div>
              <div>
                <label style={labelStyle}>Postal / ZIP code *</label>
                <input
                  style={{ ...inputStyle, borderColor: errors.zip ? RED : GREY }}
                  value={zip}
                  onChange={(ev) => setZip(ev.target.value)}
                />
                {errors.zip && <p style={{ color: RED, fontSize: "0.85rem", margin: "0.35rem 0 0" }}>{errors.zip}</p>}
              </div>
            </div>
            <p style={{ margin: "1rem 0 0", fontSize: "0.9rem", color: GREY, lineHeight: 1.5 }}>
              If terminating more than one property, enter just one property address here and submit a separate form for
              each property.
            </p>
          </section>

          {/* Section 4 */}
          <section style={sectionCard}>
            <h2 style={{ margin: "0 0 1rem", fontSize: "1.1rem", color: LIGHT_BLUE }}>4. Important notice — Steady Rent Advance</h2>
            <div
              style={{
                background: `linear-gradient(135deg, #FFF8E1 0%, #FFECB3 100%)`,
                border: `2px solid ${GOLD}`,
                borderRadius: 10,
                padding: "1rem 1.15rem",
                color: "#4a3b00",
                lineHeight: 1.55,
                fontSize: "0.95rem",
              }}
            >
              <strong style={{ display: "block", marginBottom: 8, color: "#5c4700" }}>NOTE</strong>
              If you have received a Steady Rent Advance (payment of your full lease term&apos;s rent up front), then you are
              not permitted to terminate management until the end of the lease. Your contract with Steady (the company
              providing the rent advance) prohibits termination of our management for the entire duration of the
              tenant&apos;s lease. If you took part in this program, make sure you don&apos;t select a termination date prior
              to the end of the lease.
            </div>
          </section>

          {/* Section 5 */}
          <section style={sectionCard}>
            <h2 style={{ margin: "0 0 1rem", fontSize: "1.1rem", color: LIGHT_BLUE }}>5. Dates</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div>
                <label style={labelStyle}>Date termination request received in writing *</label>
                <input
                  type="date"
                  style={{ ...inputStyle, borderColor: errors.dateReceived ? RED : GREY }}
                  value={dateReceived}
                  onChange={(ev) => setDateReceived(ev.target.value)}
                />
                {errors.dateReceived && (
                  <p style={{ color: RED, fontSize: "0.85rem", margin: "0.35rem 0 0" }}>{errors.dateReceived}</p>
                )}
              </div>
              <div>
                <label style={labelStyle}>Date owner wants termination to be effective *</label>
                <input
                  type="date"
                  min={minEffective}
                  style={{ ...inputStyle, borderColor: errors.dateEffective ? RED : GREY }}
                  value={dateEffective}
                  onChange={(ev) => setDateEffective(ev.target.value)}
                />
                {errors.dateEffective && (
                  <p style={{ color: RED, fontSize: "0.85rem", margin: "0.35rem 0 0" }}>{errors.dateEffective}</p>
                )}
              </div>
            </div>
          </section>

          {/* Section 6 */}
          <section style={sectionCard}>
            <h2 style={{ margin: "0 0 1rem", fontSize: "1.1rem", color: LIGHT_BLUE }}>6. Reason for termination</h2>
            <label style={labelStyle}>Reason *</label>
            <select
              style={{ ...inputStyle, borderColor: errors.reason ? RED : GREY }}
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
            >
              <option value="">Select…</option>
              {REASON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {errors.reason && (
              <p style={{ color: RED, fontSize: "0.85rem", margin: "0.35rem 0 0" }}>{errors.reason}</p>
            )}
            <div style={{ marginTop: 14 }}>
              <label style={labelStyle}>Additional details (optional)</label>
              <textarea
                style={{ ...inputStyle, minHeight: 100, resize: "vertical" }}
                value={reasonDetails}
                onChange={(ev) => setReasonDetails(ev.target.value)}
                placeholder="Enter any additional details about reason for termination if available"
              />
            </div>
          </section>

          {/* Section 7 */}
          <section style={sectionCard}>
            <div
              style={{
                background: `linear-gradient(145deg, ${NAVY} 0%, #121a38 100%)`,
                color: WHITE,
                borderRadius: 10,
                padding: "1.15rem 1.25rem",
                marginBottom: "1rem",
              }}
            >
              <h2 style={{ margin: 0, fontSize: "1.15rem", color: LIGHT_BLUE }}>Special Offer</h2>
              <p style={{ margin: "0.75rem 0 0", lineHeight: 1.55, opacity: 0.95, fontSize: "0.95rem" }}>
                Real Property Management Prestige would very much like to keep your business. We are sorry to hear that
                you&apos;ve been disappointed, and we want a chance to make it up to you. With that in mind, we would like to
                offer you three (3) free months of property management services to keep your business. If you accept, we
                will immediately credit your account for the cost of the three months.
              </p>
            </div>
            <p style={{ margin: "0 0 0.75rem", fontWeight: 600 }}>Are you willing to stay in exchange for 3 free months of management fees? *</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <input type="radio" name="retention" checked={retention === "yes"} onChange={() => setRetention("yes")} />
                Yes
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <input type="radio" name="retention" checked={retention === "no"} onChange={() => setRetention("no")} />
                No thank you
              </label>
            </div>
            {errors.retention && (
              <p style={{ color: RED, fontSize: "0.9rem", margin: "0.5rem 0 0" }}>{errors.retention}</p>
            )}
            {showRetentionYesMessage && (
              <div
                role="status"
                style={{
                  marginTop: "1rem",
                  padding: "1rem 1.15rem",
                  background: "#e8f7ee",
                  border: "1px solid #2e7d4a",
                  borderRadius: 10,
                  color: "#1b4332",
                  lineHeight: 1.5,
                }}
              >
                Thank you! We will credit your account shortly. A member of our team will follow up with you.
              </div>
            )}
            {showRetentionNoSections && (
              <div style={{ marginTop: "1rem" }}>
                <label style={labelStyle}>Please let us know what we can improve upon *</label>
                <textarea
                  style={{
                    ...inputStyle,
                    minHeight: 100,
                    borderColor: errors.improvementFeedback ? RED : GREY,
                    resize: "vertical",
                  }}
                  value={improvementFeedback}
                  onChange={(ev) => setImprovementFeedback(ev.target.value)}
                />
                {errors.improvementFeedback && (
                  <p style={{ color: RED, fontSize: "0.85rem", margin: "0.35rem 0 0" }}>{errors.improvementFeedback}</p>
                )}
              </div>
            )}
          </section>

          {/* Section 8 */}
          {showRetentionNoSections && (
            <section style={sectionCard}>
              <h2 style={{ margin: "0 0 1rem", fontSize: "1.1rem", color: LIGHT_BLUE }}>
                8. Security deposits &amp; guarantees
              </h2>
              <p style={{ margin: "0 0 1rem", fontSize: "0.92rem", color: GREY, lineHeight: 1.5 }}>
                Please confirm each statement below (required).
              </p>
              <AckCheckbox
                checked={ack1}
                onChange={setAck1}
                error={errors.ack1}
                text="I understand and agree that all guarantees that Real Property Management Prestige offers (Pet Damage Guarantee, Property Damage Guarantee, etc.) will be null and void when I submit a termination, as these guarantees only apply when Real Property Management Prestige is continuing to manage the property."
              />
              <AckCheckbox
                checked={ack2}
                onChange={setAck2}
                error={errors.ack2}
                text="I understand and agree that if there is no security deposit held for my property and the tenant is on the Security Deposit Waiver Program, I will not receive any payout for the non-refundable fees that Real Property Management Prestige has already collected from the tenant, and I will receive no protection from Real Property Management Prestige when the tenant vacates; protection for the property owner of one (1) month's rent is only available when Real Property Management Prestige is continuing to manage the property."
              />
              <AckCheckbox
                checked={ack3}
                onChange={setAck3}
                error={errors.ack3}
                text="I understand and agree that if a security deposit is held for my property and if I'm terminating management before the tenant has vacated, the security deposit will be returned to the tenant upon management terminating, and I will have no right to the deposit."
              />
              <AckCheckbox
                checked={ack4}
                onChange={setAck4}
                error={errors.ack4}
                text="I understand and agree that Real Property Management Prestige will not be able to turn over keys to me until my balance is paid in full and all close-out steps have been completed first."
              />
            </section>
          )}

          {/* Section 9 */}
          {showRetentionNoSections && (
            <section style={sectionCard}>
              <h2 style={{ margin: "0 0 1rem", fontSize: "1.1rem", color: LIGHT_BLUE }}>9. Digital signature</h2>
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.95rem" }}>
                Sign below (mouse or touch). Date: <strong>{todayDisplay()}</strong>
              </p>
              <SignatureField onChange={setSignatureData} error={errors.signature} />
            </section>
          )}

          {submitError && (
            <div
              role="alert"
              style={{
                padding: "1rem",
                background: "#fdecea",
                border: `1px solid ${RED}`,
                borderRadius: 10,
                color: RED,
                marginBottom: "1rem",
              }}
            >
              {submitError}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "center", marginTop: "0.5rem" }}>
            <button
              type="submit"
              disabled={submitting}
              style={{
                background: LIGHT_BLUE,
                color: WHITE,
                border: "none",
                borderRadius: 10,
                padding: "0.85rem 2.25rem",
                fontSize: "1.05rem",
                fontWeight: 700,
                cursor: submitting ? "wait" : "pointer",
                opacity: submitting ? 0.85 : 1,
                boxShadow: "0 4px 14px rgba(0, 152, 208, 0.35)",
              }}
            >
              {submitting ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

function AckCheckbox({
  checked,
  onChange,
  error,
  text,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  error?: string;
  text: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        marginBottom: 14,
        cursor: "pointer",
        fontSize: "0.92rem",
        lineHeight: 1.5,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(ev) => onChange(ev.target.checked)}
        style={{ marginTop: 4, flexShrink: 0 }}
      />
      <span>
        {text}
        {error && (
          <span style={{ color: RED, display: "block", marginTop: 4, fontWeight: 600 }}>
            Please check this box to continue.
          </span>
        )}
      </span>
    </label>
  );
}
