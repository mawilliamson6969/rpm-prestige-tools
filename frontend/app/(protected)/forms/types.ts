export type FormStatus = "draft" | "published" | "archived";
export type FormAccessType = "public" | "private" | "internal";

export type FormSummary = {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  status: FormStatus;
  isMultiStep: boolean;
  accessType: FormAccessType;
  accessToken: string | null;
  slug: string | null;
  submitButtonText: string;
  successMessage: string;
  successRedirectUrl: string | null;
  submissionsCount: number;
  viewsCount: number;
  settings: Record<string, unknown>;
  branding: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type FormPage = {
  id: number;
  formId: number;
  title: string | null;
  description: string | null;
  pageOrder: number;
  isVisible: boolean;
  visibilityConditions: unknown;
};

export type FieldWidth = "full" | "half" | "third";

export type ConditionalLogic = {
  enabled: boolean;
  action: "show" | "hide" | "require" | "unrequire";
  logic: "all" | "any";
  conditions: Array<{
    fieldKey: string;
    operator: string;
    value: string;
  }>;
};

export type PreFillConfig = {
  source: "url_param" | "appfolio_property" | "appfolio_owner" | "appfolio_tenant" | "process" | "static" | "user";
  config: Record<string, unknown>;
};

export type FormField = {
  id: number;
  formId: number;
  pageId: number | null;
  fieldKey: string;
  fieldType: string;
  label: string;
  description: string | null;
  placeholder: string | null;
  helpText: string | null;
  isRequired: boolean;
  isHidden: boolean;
  defaultValue: string | null;
  validation: Record<string, unknown>;
  fieldConfig: Record<string, unknown>;
  conditionalLogic: ConditionalLogic | null;
  preFillConfig: PreFillConfig | null;
  layout: { width: FieldWidth };
  sortOrder: number;
};

export type FormAutomation = {
  id: number;
  formId: number;
  name: string;
  triggerType: string;
  actionType: string;
  actionConfig: Record<string, unknown>;
  isActive: boolean;
  sortOrder: number;
};

export type FieldTypeDef = {
  type: string;
  label: string;
  icon: string;
  category: string;
  defaultConfig: Record<string, unknown>;
  isLayout?: boolean;
};

export const FIELD_TYPES: FieldTypeDef[] = [
  { type: "text", label: "Short Text", icon: "📝", category: "Basic", defaultConfig: { maxLength: 255 } },
  { type: "textarea", label: "Long Text", icon: "📄", category: "Basic", defaultConfig: { rows: 4, maxLength: 5000 } },
  { type: "number", label: "Number", icon: "🔢", category: "Basic", defaultConfig: { step: 1 } },
  { type: "currency", label: "Currency", icon: "💰", category: "Basic", defaultConfig: { min: 0, currency: "USD" } },

  { type: "email", label: "Email", icon: "📧", category: "Contact", defaultConfig: {} },
  { type: "phone", label: "Phone", icon: "📞", category: "Contact", defaultConfig: { format: "(###) ###-####" } },
  { type: "address", label: "Address", icon: "📍", category: "Contact", defaultConfig: { showStreet2: true, showCountry: false } },
  { type: "fullname", label: "Full Name", icon: "👤", category: "Contact", defaultConfig: { showMiddle: false, showPrefix: false, showSuffix: false } },

  { type: "dropdown", label: "Dropdown", icon: "📋", category: "Selection", defaultConfig: { options: ["Option 1", "Option 2"] } },
  { type: "multiselect", label: "Multi-Select", icon: "🏷️", category: "Selection", defaultConfig: { options: ["Option 1", "Option 2"] } },
  { type: "radio", label: "Radio", icon: "🔘", category: "Selection", defaultConfig: { options: ["Option 1", "Option 2"], layout: "vertical" } },
  { type: "checkbox", label: "Checkboxes", icon: "☑️", category: "Selection", defaultConfig: { options: ["Option 1", "Option 2"], layout: "vertical" } },
  { type: "yesno", label: "Yes / No", icon: "✅", category: "Selection", defaultConfig: { trueLabel: "Yes", falseLabel: "No" } },

  { type: "date", label: "Date", icon: "📅", category: "Date & Time", defaultConfig: {} },
  { type: "time", label: "Time", icon: "🕐", category: "Date & Time", defaultConfig: {} },
  { type: "datetime", label: "Date & Time", icon: "📆", category: "Date & Time", defaultConfig: {} },

  { type: "file", label: "File Upload", icon: "📎", category: "Media", defaultConfig: { maxFiles: 5, maxFileSize: 10485760, acceptTypes: ".pdf,.jpg,.jpeg,.png,.doc,.docx,.xlsx,.csv" } },
  { type: "signature", label: "Signature", icon: "✍️", category: "Media", defaultConfig: { width: 400, height: 150, penColor: "#000000" } },
  { type: "image", label: "Photo Capture", icon: "📸", category: "Media", defaultConfig: { maxPhotos: 5 } },

  { type: "rating", label: "Rating", icon: "⭐", category: "Advanced", defaultConfig: { max: 5 } },
  { type: "scale", label: "Scale", icon: "📊", category: "Advanced", defaultConfig: { min: 1, max: 10, minLabel: "Low", maxLabel: "High" } },

  { type: "heading", label: "Heading", icon: "📌", category: "Layout", defaultConfig: { level: "h2", align: "left" }, isLayout: true },
  { type: "paragraph", label: "Paragraph", icon: "📰", category: "Layout", defaultConfig: { content: "", align: "left" }, isLayout: true },
  { type: "divider", label: "Divider", icon: "➖", category: "Layout", defaultConfig: {}, isLayout: true },
  { type: "spacer", label: "Spacer", icon: "↕️", category: "Layout", defaultConfig: { height: 24 }, isLayout: true },

  { type: "hidden", label: "Hidden", icon: "👁️", category: "System", defaultConfig: { value: "" }, isLayout: true },
];

export const CATEGORIES = [
  "Onboarding", "Leasing", "Maintenance", "Operations",
  "Marketing", "Owner Relations", "Tenant", "Compliance", "Other",
];

export const CONDITION_OPERATORS = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "does not equal" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];
