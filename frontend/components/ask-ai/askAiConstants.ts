/** Example prompts shown in the empty state (click to fill input). */
export const EMPTY_STATE_EXAMPLE_PROMPTS = [
  "How many vacant units do we have?",
  "What's our total delinquency?",
  "Show me all open work orders",
  "List all leases expiring in the next 60 days",
];

/** Longer list for “more ideas” or secondary use. */
export const EXTENDED_SUGGESTIONS = [
  ...EMPTY_STATE_EXAMPLE_PROMPTS,
  "When does the lease expire at [property]?",
  "Who owns [property address]?",
  "What's our occupancy rate?",
  "How much revenue have we earned this year?",
  "Show me all properties managed by [owner name]",
  "Which vendors have the most work orders?",
];

/** Show character count in the input chrome past this length. */
export const CHAR_COUNT_THRESHOLD = 800;

/** Textarea grows up to this many lines, then scrolls. */
export const TEXTAREA_MAX_LINES = 8;
