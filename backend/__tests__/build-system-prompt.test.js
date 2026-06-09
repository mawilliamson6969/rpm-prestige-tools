import { test } from "node:test";
import assert from "node:assert/strict";
import { BRAND_VOICE, getBuiltInTool } from "../lib/ai-tools.js";
import { buildSystemPrompt } from "../lib/build-system-prompt.js";
import { __resetTexasPropertyCodeCache } from "../lib/texas-property-code.js";

const TPC_MARKER = "TEXAS PROPERTY CODE REFERENCE";
const COMPLIANCE_MARKER = "⚠️ Compliance Check";
const LAWYER_DISCLAIMER = "You are NOT a lawyer";

test("draft-notice: injects Texas Property Code reference", async () => {
  __resetTexasPropertyCodeCache();
  const tool = getBuiltInTool("draft-notice");
  assert.ok(tool, "draft-notice tool should exist in AI_TOOLS");
  const prompt = await buildSystemPrompt(tool);
  assert.ok(prompt.includes(TPC_MARKER), "system prompt should contain TPC reference header");
  // Sanity: a section header from quick_reference.md is present (statute citation)
  assert.match(prompt, /Sec\. 92\.\d+/, "should include at least one Sec. 92.xxx citation from the reference");
  // The tool's own Compliance-Check instruction stays intact
  assert.ok(prompt.includes(COMPLIANCE_MARKER), "Compliance Check section instruction should remain");
  assert.ok(prompt.includes(LAWYER_DISCLAIMER), "'review before sending' disclaimer should remain");
});

test("BRAND_VOICE is preserved at the top", async () => {
  __resetTexasPropertyCodeCache();
  const tool = getBuiltInTool("draft-notice");
  const prompt = await buildSystemPrompt(tool);
  const brandFirstLine = BRAND_VOICE.split("\n")[0];
  assert.ok(prompt.startsWith(brandFirstLine), "BRAND_VOICE should lead the system prompt");
  // BRAND_VOICE comes BEFORE the TPC reference
  assert.ok(prompt.indexOf(brandFirstLine) < prompt.indexOf(TPC_MARKER));
  // TPC reference comes BEFORE the tool's own instruction
  assert.ok(prompt.indexOf(TPC_MARKER) < prompt.indexOf(COMPLIANCE_MARKER));
});

test("non-draft-notice tools do NOT receive the TPC reference", async () => {
  for (const id of ["email-reply", "fix-polish", "summarize", "listing-social", "general-assistant"]) {
    const tool = getBuiltInTool(id);
    assert.ok(tool, `${id} should exist`);
    const prompt = await buildSystemPrompt(tool);
    assert.ok(!prompt.includes(TPC_MARKER), `${id} should NOT contain the TPC reference`);
    assert.ok(prompt.startsWith(BRAND_VOICE.split("\n")[0]), `${id} should still start with BRAND_VOICE`);
    assert.ok(prompt.endsWith(tool.systemPrompt), `${id} should end with the tool's own prompt`);
  }
});

test("saved-template variant of draft-notice does NOT trigger the injection", async () => {
  // A user template named with the same id substring but builtIn=false should
  // NOT receive the legal reference — TPC injection is reserved for the
  // sanctioned built-in tool whose prompt has the Compliance Check structure.
  const template = {
    id: "draft-notice",          // even an id collision
    builtIn: false,
    systemPrompt: "Draft something with [PLACEHOLDER].",
  };
  const prompt = await buildSystemPrompt(template);
  assert.ok(!prompt.includes(TPC_MARKER));
});

test("cached: second call returns the same content (covers cache branch)", async () => {
  __resetTexasPropertyCodeCache();
  const tool = getBuiltInTool("draft-notice");
  const a = await buildSystemPrompt(tool);
  const b = await buildSystemPrompt(tool);
  assert.equal(a, b);
});
