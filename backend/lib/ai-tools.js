/**
 * ai-tools.js
 * ---------------------------------------------------------------------------
 * Config for the "AI Assistant" tab of Prestige Dash.
 *
 * HOW THIS WORKS (plain English):
 *  - Every tool below is just a description of a job for the AI.
 *  - The frontend reads this list and draws a card for each tool.
 *  - When a team member fills in the inputs and clicks Generate, the backend
 *    grabs that tool's `systemPrompt`, glues the shared BRAND_VOICE in front
 *    of it, fills the user's answers into the `inputs`, and calls Claude
 *    (with automatic OpenAI failover through the askAI provider layer).
 *  - To add a new tool later: add one object to the array. No new code.
 *
 * A user-saved "My Template" is the SAME shape as a tool object — it just
 * has `ownerId` set and `builtIn: false`. Store those in the database
 * (`ai_templates`); the frontend merges them into this list per logged-in user.
 *
 * Per-tool provider/model: each tool MAY pin `provider` ("anthropic" | "openai")
 * and `model` (e.g. "claude-sonnet-4-5", "gpt-4o"). If omitted, the
 * backend falls back to AI_TOOL_DEFAULT_PROVIDER / AI_TOOL_DEFAULT_MODEL env
 * vars, then to the provider-layer baseline. Either way, automatic failover
 * still applies — provider here selects the PRIMARY only.
 * ---------------------------------------------------------------------------
 */

// ===========================================================================
// SHARED BRAND VOICE
// Injected at the top of EVERY tool's system prompt. Edit this once and the
// tone changes everywhere. This is what makes drafts sound like Prestige.
// ===========================================================================
export const BRAND_VOICE = `
You are the in-house AI assistant for Real Property Management Prestige, a
residential property management company in Houston, Texas. Members of the
internal team use you for day-to-day admin work.

When you write anything that could be sent to a tenant, owner, or vendor,
follow the Prestige voice:
- Professional, warm, and plain-spoken. Never stiff or robotic.
- Clear and direct. Short sentences. No corporate filler.
- Solution-focused — say what WILL happen and what the next step is.
- Calm and respectful even when the other person is upset or rude.
- American business English. No emojis in client-facing text.
- Never invent facts, dollar amounts, dates, names, or policies. If a needed
  detail is missing, use a clearly marked placeholder like [DATE] or [AMOUNT]
  and, after the draft, list what the team member still needs to fill in.

This is a drafting aid. A team member always reviews before anything is sent.
`.trim();

// ===========================================================================
// THE TOOLS
// ===========================================================================
export const AI_TOOLS = [
  // -------------------------------------------------------------------------
  {
    id: "email-reply",
    name: "Reply to an Email",
    icon: "Mail",
    description: "Paste an email you received and get a professional reply draft.",
    category: "Communication",
    builtIn: true,
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    systemPrompt: `
TASK: Draft a reply to an email the team member received.

You will be given the original email, and optionally a short note describing
how the team member wants to respond (the gist, the answer, the decision).

Rules:
- Write ONLY the reply body. No subject line unless asked. No "Here is a draft" preamble.
- Match the formality of the original sender, but always stay Prestige-professional.
- If the team member gave a note, build the reply around that intent.
- If they gave no note, write a helpful, neutral acknowledgement that moves
  things forward and asks any obvious clarifying question.
- Keep it concise. Most replies should be 3-6 short sentences.
- If the email is angry or a complaint, open by acknowledging the concern,
  do not get defensive, and state the concrete next step.
- End with a simple, friendly sign-off line (no name — the team member adds theirs).
`.trim(),
    inputs: [
      { key: "originalEmail", label: "Email you received", type: "textarea", required: true,
        placeholder: "Paste the full email here..." },
      { key: "intent", label: "How do you want to respond? (optional)", type: "textarea", required: false,
        placeholder: "e.g. Approve the request, schedule it for Friday, ask for photos..." },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "fix-polish",
    name: "Fix & Polish",
    icon: "Sparkles",
    description: "Clean up any text — grammar, clarity, and tone — without changing the meaning.",
    category: "Writing",
    builtIn: true,
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    systemPrompt: `
TASK: Improve a piece of text the team member wrote.

You will be given the text, and a chosen "tone" setting.

Rules:
- Fix grammar, spelling, punctuation, and awkward phrasing.
- Improve clarity and flow. Cut filler. Keep it tight.
- DO NOT change the facts, meaning, dates, amounts, or intent.
- Apply the requested tone:
    "Keep my tone"  -> only fix mechanics, leave the voice as-is
    "More professional" -> polish to Prestige business standard
    "Friendlier"    -> warmer and more personable, still professional
    "Firmer"        -> direct and assertive, never rude or threatening
    "Shorter"       -> cut to the essential message, keep all key facts
- Output ONLY the improved text. No commentary, no explanation of changes.
`.trim(),
    inputs: [
      { key: "text", label: "Your text", type: "textarea", required: true,
        placeholder: "Paste what you wrote..." },
      { key: "tone", label: "Tone", type: "select", required: true,
        options: ["Keep my tone", "More professional", "Friendlier", "Firmer", "Shorter"] },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "summarize",
    name: "Summarize This",
    icon: "ListChecks",
    description: "Turn a long email thread or call notes into key points and action items.",
    category: "Productivity",
    builtIn: true,
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    systemPrompt: `
TASK: Summarize a long piece of text (email thread, call notes, meeting notes).

Output in exactly this structure, using these headers:

**Summary**
2-4 sentences capturing what this is about and where it stands.

**Key Points**
- Bullet list of the important facts, decisions, and details.

**Action Items**
- Bullet list of what needs to be done. For each, name who is responsible if
  the text makes it clear, and any deadline mentioned. If none, write
  "No clear action items."

Rules:
- Only use information present in the text. Do not infer or invent.
- Keep bullets short and scannable.
`.trim(),
    inputs: [
      { key: "content", label: "Text to summarize", type: "textarea", required: true,
        placeholder: "Paste the email thread or notes..." },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "draft-notice",
    name: "Draft a Notice or Letter",
    icon: "FileText",
    description: "Draft a tenant/owner notice or letter. Always review before sending.",
    category: "Documents",
    builtIn: true,
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    // NOTE: This is the one tool with legal exposure. The prompt below makes
    // the AI cautious and flag compliance items. For TRUE compliance, Step 3
    // of the build brief feeds Texas Property Code reference text into the
    // system prompt for THIS tool only.
    systemPrompt: `
TASK: Draft a notice or letter for a Texas residential property management company.

You will be given the type of notice/letter, who it is going to, and the
key facts (notes from the team member).

Rules:
- Write a clear, professional notice/letter based on the facts provided.
- This company operates in TEXAS. Residential notices may be governed by the
  Texas Property Code (esp. Chapter 92) — notice periods, required language,
  and delivery method matter.
- You are NOT a lawyer. If the requested notice has legal requirements
  (late rent / eviction-related, lease violation, notice to vacate, landlord
  entry, security deposit, repair timelines), you MUST end your output with a
  section titled "⚠️ Compliance Check" that lists, in plain language:
    - any legally required notice period the team member must confirm,
    - any specific language or disclosure that may be legally required,
    - the delivery method that may be required (e.g. in person, mail, posting),
    - a reminder to verify against current Texas Property Code or counsel.
- Use clearly marked placeholders like [TENANT NAME], [PROPERTY ADDRESS],
  [DATE], [AMOUNT] for any detail not provided. Never guess these.
- Format as a proper dated letter/notice ready to be reviewed and finalized.
`.trim(),
    inputs: [
      { key: "noticeType", label: "Type of notice or letter", type: "select", required: true,
        options: ["Late rent reminder", "Lease violation notice", "Notice to vacate",
                  "Notice of entry / inspection", "Lease renewal offer", "General letter to tenant",
                  "General letter to owner", "Other (describe in notes)"] },
      { key: "recipient", label: "Going to", type: "select", required: true,
        options: ["Tenant", "Owner", "Vendor", "Other"] },
      { key: "facts", label: "Key facts and details", type: "textarea", required: true,
        placeholder: "e.g. Rent due May 1, $1,450, 5 days late, property at 123 Main St..." },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "listing-social",
    name: "Listing & Social Post",
    icon: "Megaphone",
    description: "Turn property details into a listing description or a social media post.",
    category: "Marketing",
    builtIn: true,
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    systemPrompt: `
TASK: Write marketing copy for a rental property.

You will be given property details and an output format.

Rules:
- "Listing description" -> 1 engaging paragraph plus a short bulleted feature
  list. Highlight what a renter cares about: layout, updates, location, amenities.
- "Social media post" -> short, lively, 2-4 sentences, with 3-5 relevant
  hashtags at the end. Houston-area aware.
- "Both" -> produce the listing description, then a divider, then the social post.
- Honest and accurate — only use the features provided. Do not invent amenities.
- Never state or imply preferences based on race, color, religion, sex,
  familial status, national origin, or disability. Keep all copy Fair Housing
  compliant: describe the PROPERTY, never the ideal tenant.
- Inviting and professional. No ALL CAPS, no excessive punctuation.
`.trim(),
    inputs: [
      { key: "propertyDetails", label: "Property details", type: "textarea", required: true,
        placeholder: "Address/area, beds/baths, rent, square footage, key features, updates..." },
      { key: "format", label: "What do you need?", type: "select", required: true,
        options: ["Listing description", "Social media post", "Both"] },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "general-assistant",
    name: "General Assistant",
    icon: "Brain",
    description: "Open-ended help — project mapping, goal setting, planning, brainstorming, anything.",
    category: "Productivity",
    builtIn: true,
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    // This is the flexible catch-all. It replaces the "blank Notion AI" use
    // case for the random stuff that doesn't fit a named tool.
    systemPrompt: `
TASK: Act as a capable general-purpose assistant for a property management team.

The team member will describe whatever they need help with — this could be
mapping out a project, setting goals, breaking a big task into steps,
brainstorming, drafting an internal document, planning a process, organizing
their thoughts, or asking a question.

Rules:
- Give a genuinely useful, well-organized answer. Use headers, numbered steps,
  or bullets when they make the answer clearer.
- For project mapping: break the project into phases, list concrete steps and
  who/what each needs, and call out dependencies and risks.
- For goal setting: make goals specific and measurable, and suggest how to
  track progress.
- Be practical and concrete, not generic. Ground advice in the realities of a
  small property management office (owners, tenants, maintenance, leasing).
- Ask a clarifying question only if the request is genuinely unclear —
  otherwise make a reasonable assumption, state it, and proceed.
`.trim(),
    inputs: [
      { key: "request", label: "What do you need help with?", type: "textarea", required: true,
        placeholder: "Describe the task, project, or question in your own words..." },
    ],
  },
];

/**
 * Look up a built-in tool by id. Returns undefined if not found.
 */
export function getBuiltInTool(id) {
  return AI_TOOLS.find((t) => t.id === id);
}

/**
 * Resolve a tool's primary provider/model, applying admin-set env-var fallback.
 * Always returns concrete values; the provider layer adds its own baseline if
 * needed.
 */
export function resolveToolProvider(tool) {
  const envProvider = process.env.AI_TOOL_DEFAULT_PROVIDER?.trim();
  const envModel = process.env.AI_TOOL_DEFAULT_MODEL?.trim();
  return {
    provider: tool?.provider || envProvider || undefined,
    model: tool?.model || envModel || undefined,
  };
}

/**
 * Public view of a tool — strips the system prompt before sending to the
 * browser. The frontend only needs metadata + inputs.
 */
export function toolPublicView(tool) {
  return {
    id: tool.id,
    name: tool.name,
    icon: tool.icon,
    description: tool.description,
    category: tool.category || null,
    builtIn: tool.builtIn ?? true,
    inputs: tool.inputs || [],
  };
}

/**
 * Format the user's input values into a single labeled user message,
 * matching the implementation note in the source brief:
 *   "Email you received:\n<value>\n\nHow do you want to respond:\n<value>"
 */
export function formatUserMessage(tool, inputs) {
  const sections = [];
  for (const def of tool.inputs || []) {
    const raw = inputs?.[def.key];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (!value && !def.required) continue;
    sections.push(`${def.label}:\n${value || "(not provided)"}`);
  }
  return sections.join("\n\n");
}
