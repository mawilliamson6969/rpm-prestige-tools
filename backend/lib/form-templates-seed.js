import { randomBytes } from "crypto";
import { getPool } from "./db.js";

/**
 * Starter form templates. Each one is inserted as a form row with is_template=true and
 * status='published' so it never appears in the normal /forms list but can be loaded
 * via GET /forms/templates and cloned via POST /forms/from-template.
 */
const STARTER_TEMPLATES = [
  {
    key: "new-owner-info",
    name: "New Owner Information",
    description: "Complete intake form for new property owners — contact, direct deposit, tax reporting.",
    category: "Onboarding",
    icon: "🏠",
    isMultiStep: true,
    pages: [
      { title: "Contact Info", description: "Tell us about the owner." },
      { title: "Direct Deposit", description: "How should we send your distributions?" },
      { title: "Tax Reporting", description: "We'll use this for your 1099." },
    ],
    fields: [
      // Page 0
      { page: 0, type: "fullname", key: "owner_name", label: "Owner Name", required: true },
      { page: 0, type: "email", key: "email", label: "Email", required: true },
      { page: 0, type: "phone", key: "phone", label: "Phone", required: true },
      { page: 0, type: "address", key: "mailing_address", label: "Mailing Address", required: true },

      // Page 1
      { page: 1, type: "text", key: "bank_name", label: "Bank Name", required: true },
      { page: 1, type: "text", key: "account_name", label: "Name on Account", required: true },
      { page: 1, type: "text", key: "routing_number", label: "Routing Number", required: true },
      { page: 1, type: "text", key: "account_number", label: "Account Number", required: true },
      {
        page: 1, type: "radio", key: "account_type", label: "Account Type", required: true,
        fieldConfig: { options: ["Checking", "Savings"], layout: "horizontal" },
      },

      // Page 2 — conditional tax ID
      {
        page: 2, type: "dropdown", key: "tax_id_type", label: "Tax ID Type", required: true,
        fieldConfig: { options: ["Social Security Number", "Employer Identification Number"] },
      },
      {
        page: 2, type: "text", key: "ssn", label: "Social Security Number", required: true,
        placeholder: "XXX-XX-XXXX",
        conditionalLogic: {
          enabled: true, action: "show", logic: "all",
          conditions: [{ fieldKey: "tax_id_type", operator: "equals", value: "Social Security Number" }],
        },
      },
      {
        page: 2, type: "text", key: "ein", label: "Employer Identification Number", required: true,
        placeholder: "XX-XXXXXXX",
        conditionalLogic: {
          enabled: true, action: "show", logic: "all",
          conditions: [{ fieldKey: "tax_id_type", operator: "equals", value: "Employer Identification Number" }],
        },
      },
      { page: 2, type: "signature", key: "signature", label: "Authorization Signature", required: true },
    ],
  },

  {
    key: "new-owner-intake-full",
    name: "New Owner Intake (Full)",
    description:
      "Comprehensive new-owner onboarding — owner info with joint/entity branching, primary contact, ACH/check payment, W-9 + nominee 1099 disclosure, optional home warranty, preferred vendors, service upgrades, acknowledgments, and signature.",
    category: "Onboarding",
    icon: "🏠",
    isMultiStep: true,
    pages: [
      { title: "Owner Information", description: "Who legally owns the property and where we send correspondence." },
      { title: "Primary Contact", description: "Who Lori and Amanda communicate with day-to-day." },
      { title: "Payment Information", description: "How we send your monthly rental distributions." },
      { title: "Tax Information & W-9", description: "IRS requires us to collect a W-9 since we'll be sending you 1099 income." },
      { title: "Home Warranty (Optional)", description: "If your property has an active home warranty, telling us upfront streamlines maintenance." },
      { title: "Preferred Vendors (Optional)", description: "If you have vendors you've worked with before, share them here." },
      { title: "Service Upgrades (Optional)", description: "Optional add-ons. Your PMA pricing is unchanged regardless of selections." },
      { title: "Acknowledgments", description: "Confirming you've reviewed what we agreed on pre-signing." },
      { title: "Signature & Submission", description: "Your typed signature legally binds the ACH authorization, W-9 certification, and form attestation." },
    ],
    fields: buildNewOwnerIntakeFields(),
  },

  {
    key: "maintenance-request",
    name: "Maintenance Request",
    description: "Tenant-submitted maintenance request with photos and urgency.",
    category: "Maintenance",
    icon: "🔧",
    fields: [
      { type: "fullname", key: "tenant_name", label: "Tenant Name", required: true },
      { type: "text", key: "property_address", label: "Property Address", required: true },
      { type: "phone", key: "phone", label: "Phone", required: true },
      { type: "email", key: "email", label: "Email", required: true },
      {
        type: "dropdown", key: "issue_type", label: "Issue Type", required: true,
        fieldConfig: {
          options: ["Plumbing", "Electrical", "HVAC", "Appliance", "Pest Control", "Roofing", "Other"],
        },
      },
      { type: "textarea", key: "description", label: "Describe the issue", required: true,
        placeholder: "Please include what's happening, where, and any details we should know." },
      {
        type: "radio", key: "urgency", label: "Urgency", required: true,
        fieldConfig: { options: ["Emergency", "Urgent", "Normal"], layout: "horizontal" },
      },
      {
        type: "yesno", key: "has_pet", label: "Is there a pet at the property?",
        fieldConfig: { trueLabel: "Yes", falseLabel: "No" },
      },
      {
        type: "radio", key: "permission_to_enter", label: "Permission to enter", required: true,
        fieldConfig: { options: ["Yes, anytime", "Yes, please contact me first", "No"], layout: "vertical" },
      },
      {
        type: "radio", key: "preferred_contact", label: "Preferred contact method", required: true,
        fieldConfig: { options: ["Phone", "Email", "Text"], layout: "horizontal" },
      },
      {
        type: "file", key: "photos", label: "Upload photos",
        fieldConfig: { maxFiles: 5, maxFileSize: 10485760, acceptTypes: ".jpg,.jpeg,.png,.heic" },
      },
    ],
  },

  {
    key: "move-in-condition",
    name: "Tenant Move-In Condition Report",
    description: "Multi-step move-in inspection with condition ratings for each room.",
    category: "Leasing",
    icon: "📦",
    isMultiStep: true,
    pages: [
      { title: "Tenant Info" },
      { title: "Living Areas" },
      { title: "Bedrooms & Bathrooms" },
      { title: "Exterior & Other" },
      { title: "Comments & Signature" },
    ],
    fields: [
      { page: 0, type: "fullname", key: "tenant_name", label: "Tenant Name", required: true },
      { page: 0, type: "text", key: "property_address", label: "Property Address", required: true },
      { page: 0, type: "date", key: "lease_start_date", label: "Lease Start Date", required: true },
      { page: 0, type: "email", key: "email", label: "Email", required: true },
      { page: 0, type: "phone", key: "phone", label: "Phone", required: true },

      ...ratingBlock(1, [
        { key: "living_room_walls", label: "Living Room Walls" },
        { key: "living_room_floors", label: "Living Room Floors" },
        { key: "living_room_windows", label: "Living Room Windows" },
        { key: "kitchen_counters", label: "Kitchen Counters" },
        { key: "kitchen_appliances", label: "Kitchen Appliances" },
        { key: "kitchen_floors", label: "Kitchen Floors" },
        { key: "dining_area", label: "Dining Area" },
      ]),
      ...ratingBlock(2, [
        { key: "bedroom_1", label: "Bedroom 1" },
        { key: "bedroom_2", label: "Bedroom 2" },
        { key: "bedroom_3", label: "Bedroom 3" },
        { key: "bathroom_1", label: "Bathroom 1" },
        { key: "bathroom_2", label: "Bathroom 2" },
      ]),
      ...ratingBlock(3, [
        { key: "garage", label: "Garage" },
        { key: "yard", label: "Yard / Landscaping" },
        { key: "fences", label: "Fences / Gates" },
        { key: "exterior_paint", label: "Exterior Paint" },
      ]),

      { page: 4, type: "textarea", key: "general_comments", label: "General comments",
        placeholder: "Anything else we should note?" },
      { page: 4, type: "file", key: "photos", label: "Photos",
        fieldConfig: { maxFiles: 20, maxFileSize: 10485760, acceptTypes: ".jpg,.jpeg,.png,.heic" } },
      { page: 4, type: "signature", key: "tenant_signature", label: "Tenant Signature", required: true },
    ],
  },

  {
    key: "owner-satisfaction",
    name: "Owner Satisfaction Survey",
    description: "Annual survey for owners — overall satisfaction and feedback.",
    category: "Owner Relations",
    icon: "📊",
    fields: [
      { type: "fullname", key: "owner_name", label: "Owner Name", required: true },
      { type: "text", key: "property_address", label: "Property Address" },
      { type: "rating", key: "overall_satisfaction", label: "Overall Satisfaction", required: true,
        fieldConfig: { max: 5 } },
      { type: "rating", key: "communication", label: "Communication", required: true, fieldConfig: { max: 5 } },
      { type: "rating", key: "maintenance", label: "Maintenance", required: true, fieldConfig: { max: 5 } },
      { type: "rating", key: "financial_reporting", label: "Financial Reporting", required: true, fieldConfig: { max: 5 } },
      { type: "yesno", key: "would_recommend", label: "Would you recommend us?", required: true,
        fieldConfig: { trueLabel: "Yes", falseLabel: "No" } },
      { type: "textarea", key: "doing_well", label: "What are we doing well?" },
      { type: "textarea", key: "can_improve", label: "What can we improve?" },
      { type: "textarea", key: "additional_comments", label: "Additional comments" },
    ],
  },

  {
    key: "vendor-application",
    name: "Vendor Application",
    description: "Intake form for new vendors — licensing, insurance, references.",
    category: "Operations",
    icon: "🛠️",
    fields: [
      { type: "text", key: "company_name", label: "Company Name", required: true },
      { type: "fullname", key: "contact_name", label: "Contact Name", required: true },
      { type: "phone", key: "phone", label: "Phone", required: true },
      { type: "email", key: "email", label: "Email", required: true },
      { type: "address", key: "business_address", label: "Business Address", required: true },
      {
        type: "dropdown", key: "trade", label: "Trade / Specialty", required: true,
        fieldConfig: {
          options: [
            "Plumbing", "Electrical", "HVAC", "Painting", "Flooring", "Roofing",
            "General Handyman", "Landscaping", "Pest Control", "Cleaning", "Other",
          ],
        },
      },
      { type: "text", key: "license_number", label: "License Number" },
      { type: "text", key: "insurance_provider", label: "Insurance Provider", required: true },
      { type: "date", key: "insurance_expiration", label: "Insurance Expiration", required: true },
      { type: "number", key: "years_in_business", label: "Years in Business" },
      { type: "currency", key: "hourly_rate", label: "Hourly Rate" },
      { type: "text", key: "service_area", label: "Service Area" },
      { type: "textarea", key: "references", label: "References (name, relationship, phone)" },
      { type: "file", key: "w9", label: "W-9",
        fieldConfig: { maxFiles: 1, acceptTypes: ".pdf,.jpg,.jpeg,.png" } },
      { type: "file", key: "coi", label: "Certificate of Insurance",
        fieldConfig: { maxFiles: 1, acceptTypes: ".pdf,.jpg,.jpeg,.png" } },
    ],
  },

  {
    key: "tenant-complaint",
    name: "Tenant Complaint",
    description: "Formal complaint intake with supporting documents.",
    category: "Operations",
    icon: "📢",
    fields: [
      { type: "fullname", key: "tenant_name", label: "Tenant Name", required: true },
      { type: "text", key: "property_address", label: "Property Address", required: true },
      { type: "phone", key: "phone", label: "Phone", required: true },
      { type: "email", key: "email", label: "Email", required: true },
      {
        type: "dropdown", key: "complaint_type", label: "Complaint Type", required: true,
        fieldConfig: { options: ["Noise", "Maintenance", "Neighbor", "Safety", "Other"] },
      },
      { type: "date", key: "incident_date", label: "Date of incident", required: true },
      { type: "textarea", key: "description", label: "Describe the incident", required: true },
      { type: "yesno", key: "spoken_to_party", label: "Have you spoken to the other party?",
        fieldConfig: { trueLabel: "Yes", falseLabel: "No" } },
      { type: "textarea", key: "desired_resolution", label: "Desired resolution" },
      { type: "file", key: "supporting_docs", label: "Supporting documents",
        fieldConfig: { maxFiles: 10, acceptTypes: ".pdf,.jpg,.jpeg,.png,.mp4,.mov" } },
    ],
  },
];

/* eslint-disable max-lines-per-function */
function buildNewOwnerIntakeFields() {
  // Helpers ---------------------------------------------------------------
  const showIf = (conditions, logic = "all") => ({
    enabled: true, action: "show", logic, conditions,
  });
  const requireIf = (conditions, logic = "all") => ({
    enabled: true, action: "require", logic, conditions,
  });
  const para = (text, align = "left") => ({
    type: "paragraph", key: "_p_" + Math.random().toString(36).slice(2, 8),
    label: "", fieldConfig: { content: text, align },
  });
  const heading = (text, level = "h3") => ({
    type: "heading", key: "_h_" + Math.random().toString(36).slice(2, 8),
    label: text, fieldConfig: { level, align: "left" },
  });
  const divider = () => ({ type: "divider", key: "_d_" + Math.random().toString(36).slice(2, 8), label: "" });
  const ack = (page, key, statement, conditionalLogic = null) => ({
    page,
    type: "checkbox", key, label: statement, required: true,
    fieldConfig: { options: ["I agree"], layout: "vertical" },
    conditionalLogic,
    validation: { errorMessage: "Please acknowledge to continue." },
  });
  const optionalAck = (page, key, statement, conditionalLogic = null) => ({
    page,
    type: "checkbox", key, label: statement, required: false,
    fieldConfig: { options: ["I agree"], layout: "vertical" },
    conditionalLogic,
  });

  // Condition shortcuts
  const isIndividual = { fieldKey: "owner_type", operator: "equals", value: "Individual" };
  const isJoint = { fieldKey: "owner_type", operator: "equals", value: "Joint Owners" };
  const isEntity = (v) => ({ fieldKey: "owner_type", operator: "equals", value: v });
  const isMarried = { fieldKey: "joint_scenario", operator: "equals", value: "Married couple filing jointly" };
  const isUnmarried = { fieldKey: "joint_scenario", operator: "equals", value: "Unmarried co-owners (siblings, friends, business partners, parent-child)" };
  const isACH = { fieldKey: "pay_method", operator: "equals", value: "ACH Direct Deposit (no fee, 1–3 business days)" };
  const isCheck = { fieldKey: "pay_method", operator: "equals", value: "Paper Check by Mail (per-check processing fee)" };
  const isLLCClass = { fieldKey: "federal_tax_class", operator: "equals", value: "LLC" };
  const hasWarranty = { fieldKey: "has_warranty", operator: "equals", value: "Yes — I have a home warranty" };
  const hasVendors = { fieldKey: "has_vendors", operator: "equals", value: "Yes, I have preferred vendors" };
  const acquiredSeparate = (v) => ({ fieldKey: "property_acquisition", operator: "equals", value: v });

  const f = [];

  /* ======================================================================
   * PAGE 0 — OWNER INFORMATION
   * ====================================================================== */
  const P0 = 0;

  f.push({ page: P0, ...para(
    "Welcome aboard. This form collects the information we need to set up your owner account, banking, and tax reporting. Lori and Amanda will use this data to get everything in place over the next 3–5 business days. If anything is unclear or you'd rather complete it on a call, text Amanda."
  ) });

  f.push({
    page: P0, type: "dropdown", key: "owner_type", label: "Owner Type", required: true,
    helpText: "Used for tax classification and signature authority.",
    fieldConfig: {
      options: ["Individual", "Joint Owners", "LLC", "Corporation", "Trust", "Partnership", "Other"],
    },
  });

  /* ---- Individual block ---- */
  f.push({ page: P0, ...heading("Individual Owner Details", "h4"), conditionalLogic: showIf([isIndividual]) });
  f.push({
    page: P0, type: "text", key: "ind_first_name", label: "First Name", required: true,
    placeholder: "John", layout: { width: "third" }, conditionalLogic: showIf([isIndividual]),
  });
  f.push({
    page: P0, type: "text", key: "ind_middle_initial", label: "Middle Initial",
    placeholder: "A", layout: { width: "third" }, conditionalLogic: showIf([isIndividual]),
    validation: { maxLength: 1 },
  });
  f.push({
    page: P0, type: "text", key: "ind_last_name", label: "Last Name", required: true,
    placeholder: "Smith", layout: { width: "third" }, conditionalLogic: showIf([isIndividual]),
  });
  f.push({
    page: P0, type: "date", key: "ind_dob", label: "Date of Birth",
    helpText: "Some banks require DOB for ACH verification.",
    layout: { width: "half" }, conditionalLogic: showIf([isIndividual]),
  });
  f.push({
    page: P0, type: "dropdown", key: "ind_marital_status", label: "Marital Status", required: true,
    helpText: "Required in Texas community property cases.",
    fieldConfig: { options: ["Single", "Married", "Divorced / Separated", "Widowed", "Prefer not to say"] },
    layout: { width: "half" }, conditionalLogic: showIf([isIndividual]),
  });

  /* ---- Joint block ---- */
  f.push({ page: P0, ...para(
    "Joint ownership tax treatment varies. The IRS handles married joint filers differently from unmarried co-owners (siblings, friends, business partners). We need to know which applies so we collect the right tax information."
  ), conditionalLogic: showIf([isJoint]) });

  f.push({
    page: P0, type: "radio", key: "joint_scenario", label: "What's your joint owner relationship?", required: true,
    fieldConfig: {
      options: [
        "Married couple filing jointly",
        "Unmarried co-owners (siblings, friends, business partners, parent-child)",
      ],
      layout: "vertical",
    },
    helpText: "Married joint filers = one tax entity (one W-9). Unmarried co-owners default to IRS partnership treatment.",
    conditionalLogic: showIf([isJoint]),
  });

  /* Married path */
  f.push({ page: P0, ...heading("Spouse 1 Information", "h4"), conditionalLogic: showIf([isJoint, isMarried]) });
  f.push({ page: P0, type: "text", key: "spouse1_first_name", label: "Spouse 1 First Name", required: true, layout: { width: "third" }, conditionalLogic: showIf([isJoint, isMarried]) });
  f.push({ page: P0, type: "text", key: "spouse1_middle_initial", label: "Spouse 1 MI", layout: { width: "third" }, conditionalLogic: showIf([isJoint, isMarried]), validation: { maxLength: 1 } });
  f.push({ page: P0, type: "text", key: "spouse1_last_name", label: "Spouse 1 Last Name", required: true, layout: { width: "third" }, conditionalLogic: showIf([isJoint, isMarried]) });
  f.push({ page: P0, type: "date", key: "spouse1_dob", label: "Spouse 1 Date of Birth", layout: { width: "half" }, conditionalLogic: showIf([isJoint, isMarried]) });
  f.push({ page: P0, type: "email", key: "spouse1_email", label: "Spouse 1 Email", required: true, layout: { width: "half" }, conditionalLogic: showIf([isJoint, isMarried]) });

  f.push({ page: P0, ...heading("Spouse 2 Information", "h4"), conditionalLogic: showIf([isJoint, isMarried]) });
  f.push({ page: P0, type: "text", key: "spouse2_first_name", label: "Spouse 2 First Name", required: true, layout: { width: "third" }, conditionalLogic: showIf([isJoint, isMarried]) });
  f.push({ page: P0, type: "text", key: "spouse2_middle_initial", label: "Spouse 2 MI", layout: { width: "third" }, conditionalLogic: showIf([isJoint, isMarried]), validation: { maxLength: 1 } });
  f.push({ page: P0, type: "text", key: "spouse2_last_name", label: "Spouse 2 Last Name", required: true, layout: { width: "third" }, conditionalLogic: showIf([isJoint, isMarried]) });
  f.push({ page: P0, type: "date", key: "spouse2_dob", label: "Spouse 2 Date of Birth", layout: { width: "half" }, conditionalLogic: showIf([isJoint, isMarried]) });
  f.push({ page: P0, type: "email", key: "spouse2_email", label: "Spouse 2 Email", required: true, layout: { width: "half" }, conditionalLogic: showIf([isJoint, isMarried]) });

  f.push({ page: P0, ...heading("Tax Designation", "h4"), conditionalLogic: showIf([isJoint, isMarried]) });
  f.push({
    page: P0, type: "radio", key: "primary_taxpayer", label: "Primary Taxpayer",
    required: true,
    fieldConfig: { options: ["Spouse 1", "Spouse 2"], layout: "horizontal" },
    helpText: "Whose SSN goes on the W-9 and 1099. Typically the spouse listed first on your joint tax return.",
    conditionalLogic: showIf([isJoint, isMarried]),
  });
  f.push(ack(
    P0, "ack_joint_filing",
    "We confirm we file federal taxes jointly as a married couple.",
    showIf([isJoint, isMarried]),
  ));

  f.push({ page: P0, ...heading("Texas Community Property", "h4"), conditionalLogic: showIf([isJoint, isMarried]) });
  f.push({ page: P0, ...para(
    "Texas community property law: Property acquired during marriage is generally community property, owned equally by both spouses. Property acquired before marriage, or received as a gift or inheritance by one spouse, can be separate property. This affects who has authority to sign management agreements."
  ), conditionalLogic: showIf([isJoint, isMarried]) });
  f.push({
    page: P0, type: "radio", key: "property_acquisition", label: "How was this property acquired?",
    required: true,
    fieldConfig: {
      options: [
        "Acquired during marriage (community property — both spouses have ownership rights)",
        "Acquired before marriage by one spouse (separate property)",
        "Received as gift or inheritance by one spouse (separate property)",
      ],
      layout: "vertical",
    },
    conditionalLogic: showIf([isJoint, isMarried]),
  });
  f.push({
    page: P0, type: "radio", key: "separate_owner", label: "Which spouse owns the property separately?",
    required: true,
    fieldConfig: { options: ["Spouse 1", "Spouse 2"], layout: "horizontal" },
    conditionalLogic: showIf(
      [
        isJoint,
        isMarried,
        acquiredSeparate("Acquired before marriage by one spouse (separate property)"),
      ],
      "all",
    ),
  });
  f.push({
    page: P0, type: "radio", key: "separate_owner_gift", label: "Which spouse received the gift/inheritance?",
    required: true,
    fieldConfig: { options: ["Spouse 1", "Spouse 2"], layout: "horizontal" },
    conditionalLogic: showIf(
      [
        isJoint,
        isMarried,
        acquiredSeparate("Received as gift or inheritance by one spouse (separate property)"),
      ],
      "all",
    ),
  });

  /* Unmarried path */
  f.push({ page: P0, ...para(
    "IMPORTANT — We strongly recommend forming an LLC or partnership before proceeding. Unmarried co-ownership of rental property is treated by the IRS as a partnership by default, which adds significant tax and reporting complexity. Forming an LLC simplifies tax reporting (one EIN, one 1099), provides liability protection, and avoids the nominee 1099 obligations described below. Lori can refer you to a Texas business attorney if you'd like to discuss this option before proceeding. Estimated cost: $300–$800 in formation fees + filing."
  ), conditionalLogic: showIf([isJoint, isUnmarried]) });

  f.push({
    page: P0, type: "radio", key: "llc_decision", label: "How would you like to proceed?", required: true,
    fieldConfig: {
      options: [
        "Pause and discuss LLC formation with Lori",
        "I understand — proceed as individual co-owners",
      ],
      layout: "vertical",
    },
    helpText: "If you pause, the rest of this section will skip. We'll reach out to schedule a callback.",
    conditionalLogic: showIf([isJoint, isUnmarried]),
  });

  const isProceedingUnmarried = { fieldKey: "llc_decision", operator: "equals", value: "I understand — proceed as individual co-owners" };

  f.push({ page: P0, ...para(
    "Nominee 1099 obligation: By proceeding as individual co-owners, RPM will issue ONE Form 1099 to a designated Primary 1099 Recipient. That recipient is responsible for issuing nominee 1099s to all other co-owners. RPM does not file nominee 1099s on your behalf. Consult your CPA."
  ), conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });

  // Co-Owner 1
  f.push({ page: P0, ...heading("Co-Owner 1", "h4"), conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P0, type: "text", key: "co1_first_name", label: "First Name", required: true, layout: { width: "third" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P0, type: "text", key: "co1_middle_initial", label: "MI", layout: { width: "third" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]), validation: { maxLength: 1 } });
  f.push({ page: P0, type: "text", key: "co1_last_name", label: "Last Name", required: true, layout: { width: "third" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P0, type: "date", key: "co1_dob", label: "Date of Birth", layout: { width: "half" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P0, type: "phone", key: "co1_phone", label: "Mobile Phone", required: true, layout: { width: "half" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P0, type: "email", key: "co1_email", label: "Email", required: true, layout: { width: "half" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({
    page: P0, type: "dropdown", key: "co1_relationship", label: "Relationship to Other Owners", required: true,
    fieldConfig: { options: ["Sibling", "Friend", "Business Partner", "Parent-Child", "Other"] },
    layout: { width: "half" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]),
  });
  f.push({
    page: P0, type: "number", key: "co1_ownership_pct", label: "Ownership Percentage", required: true,
    placeholder: "50", helpText: "All co-owner percentages must sum to 100%.",
    layout: { width: "half" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]),
    validation: { min: 0, max: 100 },
  });
  f.push({ page: P0, type: "text", key: "co1_mailing_address", label: "Mailing Address", required: true, placeholder: "Each owner can have a different address for distributions", layout: { width: "half" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });

  // Co-Owner 2
  f.push({ page: P0, ...heading("Co-Owner 2", "h4"), conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P0, type: "text", key: "co2_first_name", label: "First Name", required: true, layout: { width: "third" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P0, type: "text", key: "co2_middle_initial", label: "MI", layout: { width: "third" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]), validation: { maxLength: 1 } });
  f.push({ page: P0, type: "text", key: "co2_last_name", label: "Last Name", required: true, layout: { width: "third" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P0, type: "date", key: "co2_dob", label: "Date of Birth", layout: { width: "half" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P0, type: "phone", key: "co2_phone", label: "Mobile Phone", required: true, layout: { width: "half" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P0, type: "email", key: "co2_email", label: "Email", required: true, layout: { width: "half" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({
    page: P0, type: "dropdown", key: "co2_relationship", label: "Relationship to Other Owners", required: true,
    fieldConfig: { options: ["Sibling", "Friend", "Business Partner", "Parent-Child", "Other"] },
    layout: { width: "half" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]),
  });
  f.push({
    page: P0, type: "number", key: "co2_ownership_pct", label: "Ownership Percentage", required: true,
    placeholder: "50", layout: { width: "half" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]),
    validation: { min: 0, max: 100 },
  });
  f.push({ page: P0, type: "text", key: "co2_mailing_address", label: "Mailing Address", required: true, layout: { width: "half" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });

  // Co-Owner 3 (optional)
  f.push({ page: P0, ...heading("Co-Owner 3 (optional)", "h4"), conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P0, type: "text", key: "co3_first_name", label: "First Name", layout: { width: "third" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P0, type: "text", key: "co3_middle_initial", label: "MI", layout: { width: "third" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]), validation: { maxLength: 1 } });
  f.push({ page: P0, type: "text", key: "co3_last_name", label: "Last Name", layout: { width: "third" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P0, type: "email", key: "co3_email", label: "Email", layout: { width: "half" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P0, type: "number", key: "co3_ownership_pct", label: "Ownership Percentage", placeholder: "0", layout: { width: "half" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]), validation: { min: 0, max: 100 } });

  // 1099 designation
  f.push({ page: P0, ...heading("Primary 1099 Recipient Designation", "h4"), conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({
    page: P0, type: "dropdown", key: "primary_1099_recipient",
    label: "Which co-owner receives the single 1099 from RPM each year?", required: true,
    fieldConfig: { options: ["Co-Owner 1", "Co-Owner 2", "Co-Owner 3"] },
    helpText: "This co-owner is responsible for issuing nominee 1099s to other co-owners. They should consult a CPA before March 1 each year.",
    conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]),
  });
  f.push(ack(
    P0, "ack_nominee_1099",
    "We acknowledge the nominee 1099 obligation. The designated Primary 1099 Recipient understands they are responsible for issuing nominee 1099s to all other co-owners and that RPM Prestige does not prepare, file, or assist with nominee 1099s.",
    showIf([isJoint, isUnmarried, isProceedingUnmarried]),
  ));

  /* ---- Entity block (LLC / Corporation / Partnership / Trust / Other) ---- */
  const entityConds = [
    { fieldKey: "owner_type", operator: "equals", value: "LLC" },
    { fieldKey: "owner_type", operator: "equals", value: "Corporation" },
    { fieldKey: "owner_type", operator: "equals", value: "Trust" },
    { fieldKey: "owner_type", operator: "equals", value: "Partnership" },
    { fieldKey: "owner_type", operator: "equals", value: "Other" },
  ];
  const showIfEntity = () => showIf(entityConds, "any");

  f.push({ page: P0, ...heading("Entity Details", "h4"), conditionalLogic: showIfEntity() });
  f.push({
    page: P0, type: "text", key: "entity_legal_name", label: "Entity Legal Name", required: true,
    placeholder: "Smith Family Holdings, LLC",
    helpText: "Exact name on formation documents.",
    conditionalLogic: showIfEntity(),
  });
  f.push({
    page: P0, type: "text", key: "entity_dba", label: "Trade Name (DBA)",
    placeholder: "Optional", layout: { width: "half" }, conditionalLogic: showIfEntity(),
  });
  f.push({
    page: P0, type: "dropdown", key: "entity_state_of_formation", label: "State of Formation", required: true,
    fieldConfig: { options: ["Texas", "Delaware", "Nevada", "California", "Florida", "New York", "Other"] },
    layout: { width: "half" }, conditionalLogic: showIfEntity(),
  });
  f.push({
    page: P0, type: "text", key: "entity_authorized_signer", label: "Authorized Signer Name", required: true,
    placeholder: "The person who signed the PMA",
    layout: { width: "half" }, conditionalLogic: showIfEntity(),
  });
  f.push({
    page: P0, type: "text", key: "entity_signer_title", label: "Signer Title", required: true,
    placeholder: "Manager / Member / President / Trustee",
    layout: { width: "half" }, conditionalLogic: showIfEntity(),
  });
  f.push({
    page: P0, type: "file", key: "entity_documents", label: "Upload Entity Documents",
    helpText: "Operating Agreement, Articles of Incorporation, or Trust documents (PDF preferred).",
    fieldConfig: { maxFiles: 5, maxFileSize: 10485760, acceptTypes: ".pdf,.jpg,.jpeg,.png" },
    conditionalLogic: showIfEntity(),
  });

  /* ---- Addresses (always shown) ---- */
  f.push({ page: P0, ...heading("Address Information", "h4") });
  f.push({
    page: P0, type: "text", key: "property_address", label: "Property Address",
    placeholder: "Pre-populated from your Property Management Agreement",
    helpText: "Pre-populated from your Property Management Agreement.",
  });
  f.push({
    page: P0, type: "address", key: "mailing_address", label: "Mailing Address", required: true,
    fieldConfig: { showStreet2: true, showCountry: false },
  });
  f.push({
    page: P0, type: "yesno", key: "mailing_same_as_property",
    label: "Is the mailing address the same as the property address?",
    fieldConfig: { trueLabel: "Yes", falseLabel: "No" },
  });

  /* ======================================================================
   * PAGE 1 — PRIMARY CONTACT
   * ====================================================================== */
  const P1 = 1;
  f.push({ page: P1, ...para("Who Lori and Amanda communicate with day-to-day. If someone else handles communication on your behalf, give us their info here.") });

  f.push({
    page: P1, type: "radio", key: "is_primary_contact_owner", label: "Are you the primary contact?",
    required: true,
    fieldConfig: {
      options: ["Yes — I am the primary contact", "No — someone else handles communication"],
      layout: "vertical",
    },
  });

  f.push({ page: P1, type: "text", key: "primary_contact_name", label: "Primary Contact Name", required: true, placeholder: "John Smith", layout: { width: "half" } });
  f.push({
    page: P1, type: "dropdown", key: "primary_contact_relationship", label: "Relationship to Owner",
    fieldConfig: { options: ["Owner", "Spouse", "Attorney", "Family Member", "Authorized Agent", "Other"] },
    layout: { width: "half" },
  });
  f.push({ page: P1, type: "phone", key: "primary_contact_phone", label: "Mobile Phone", required: true, layout: { width: "half" } });
  f.push({
    page: P1, type: "dropdown", key: "primary_contact_best_time", label: "Best Time to Reach (Central)",
    fieldConfig: { options: ["Anytime", "Morning (8am–12pm)", "Midday (12pm–3pm)", "Afternoon (3pm–6pm)", "Evening (after 6pm)"] },
    layout: { width: "half" },
  });
  f.push({ page: P1, type: "email", key: "primary_contact_email", label: "Email Address", required: true, layout: { width: "half" } });
  f.push({ page: P1, type: "email", key: "primary_contact_email_confirm", label: "Confirm Email Address", required: true, layout: { width: "half" } });
  f.push({
    page: P1, type: "radio", key: "preferred_comm_channel", label: "Preferred Communication Channel",
    required: true,
    fieldConfig: { options: ["Email", "Phone", "SMS", "Owner Portal"], layout: "horizontal" },
  });

  f.push({ page: P1, ...heading("Emergency Backup Contact (Optional)", "h4") });
  f.push({ page: P1, ...para("If we can't reach you in an urgent situation (e.g., flood at the property), who else can we contact?") });
  f.push({ page: P1, type: "text", key: "backup_contact_name", label: "Backup Contact Name", placeholder: "Optional", layout: { width: "third" } });
  f.push({ page: P1, type: "text", key: "backup_contact_relationship", label: "Relationship", placeholder: "Spouse, family, etc.", layout: { width: "third" } });
  f.push({ page: P1, type: "phone", key: "backup_contact_phone", label: "Phone", layout: { width: "third" } });

  /* ======================================================================
   * PAGE 2 — PAYMENT INFORMATION
   * ====================================================================== */
  const P2 = 2;
  f.push({ page: P2, ...para("Encrypted & secure. Your account information is stored encrypted and masked. Only Accounting and authorized staff can access it. We use bank-grade security.") });

  f.push({
    page: P2, type: "radio", key: "pay_method", label: "Distribution Method", required: true,
    fieldConfig: {
      options: [
        "ACH Direct Deposit (no fee, 1–3 business days)",
        "Paper Check by Mail (per-check processing fee)",
      ],
      layout: "vertical",
    },
    helpText: "ACH is recommended — fastest, no fees, secure.",
  });

  // ACH block
  f.push({ page: P2, ...heading("Bank Account Details", "h4"), conditionalLogic: showIf([isACH]) });
  f.push({ page: P2, type: "text", key: "ach_bank_name", label: "Bank Name", required: true, placeholder: "e.g., Bank of America", layout: { width: "half" }, conditionalLogic: showIf([isACH]) });
  f.push({
    page: P2, type: "radio", key: "ach_account_type", label: "Account Type", required: true,
    fieldConfig: { options: ["Checking", "Savings"], layout: "horizontal" },
    layout: { width: "half" }, conditionalLogic: showIf([isACH]),
  });
  f.push({
    page: P2, type: "text", key: "ach_routing_number", label: "Routing Number", required: true,
    placeholder: "9-digit ABA routing number",
    helpText: "9-digit ABA routing number from your check.",
    layout: { width: "half" }, conditionalLogic: showIf([isACH]),
    validation: { minLength: 9, maxLength: 9 },
  });
  f.push({
    page: P2, type: "text", key: "ach_name_on_account", label: "Name on Account", required: true,
    placeholder: "Must match owner name or have authorization",
    layout: { width: "half" }, conditionalLogic: showIf([isACH]),
  });
  f.push({
    page: P2, type: "text", key: "ach_account_number", label: "Account Number", required: true,
    placeholder: "Encrypted at rest",
    layout: { width: "half" }, conditionalLogic: showIf([isACH]),
  });
  f.push({
    page: P2, type: "text", key: "ach_account_number_confirm", label: "Confirm Account Number", required: true,
    placeholder: "Must match above",
    layout: { width: "half" }, conditionalLogic: showIf([isACH]),
  });
  f.push({
    page: P2, type: "file", key: "ach_voided_check", label: "Upload Voided Check (optional but recommended)",
    fieldConfig: { maxFiles: 1, maxFileSize: 10485760, acceptTypes: ".pdf,.jpg,.jpeg,.png" },
    conditionalLogic: showIf([isACH]),
  });
  f.push({
    page: P2, type: "dropdown", key: "distribution_day_preference", label: "Distribution Day Preference",
    required: true,
    fieldConfig: { options: ["10th of the month", "15th of the month", "20th of the month", "25th of the month"] },
    conditionalLogic: showIf([isACH]),
  });
  f.push({ page: P2, ...para(
    "ACH Authorization: I hereby authorize Real Property Management Prestige to initiate ACH electronic credit entries to the account identified above, and if necessary, ACH electronic debit entries and adjustments for any credit entries made in error. This authorization will remain in effect until I revoke it in writing with at least 10 business days' notice."
  ), conditionalLogic: showIf([isACH]) });
  f.push(ack(
    P2, "ach_authorization_ack",
    "I have read and agree to the ACH authorization above. I certify the account is in my name or I have proper authorization to direct deposits to this account.",
    showIf([isACH]),
  ));

  // Check block
  f.push({ page: P2, ...para(
    "Paper check fee: A processing fee will be deducted from each paper-check distribution. You can switch to ACH anytime to eliminate this fee."
  ), conditionalLogic: showIf([isCheck]) });
  f.push({
    page: P2, type: "text", key: "check_payee", label: "Make Checks Payable To", required: true,
    placeholder: "Your legal name or entity name",
    conditionalLogic: showIf([isCheck]),
  });
  f.push(ack(
    P2, "check_fee_ack",
    "I acknowledge the paper check fee will be deducted from each distribution.",
    showIf([isCheck]),
  ));

  /* ======================================================================
   * PAGE 3 — TAX INFORMATION & W-9
   * ====================================================================== */
  const P3 = 3;
  f.push({ page: P3, ...para("Why we need this: Federal regulations require RPM Prestige to collect a Form W-9 from anyone receiving rental income through us. We use this information to issue your year-end Form 1099, which reports your rental income to the IRS.") });

  f.push({ page: P3, ...heading("W-9 Information", "h4") });
  f.push({
    page: P3, type: "text", key: "tax_legal_name", label: "Legal Name for Tax Purposes", required: true,
    placeholder: "As shown on your tax return",
    helpText: "Must match your SSN or EIN records exactly.",
  });
  f.push({
    page: P3, type: "dropdown", key: "federal_tax_class", label: "Federal Tax Classification", required: true,
    fieldConfig: {
      options: [
        "Individual / Sole Proprietor",
        "C Corporation",
        "S Corporation",
        "Partnership",
        "Trust / Estate",
        "LLC",
        "Other",
      ],
    },
    layout: { width: "half" },
  });
  f.push({
    page: P3, type: "dropdown", key: "llc_sub_class", label: "LLC Tax Classification", required: true,
    fieldConfig: {
      options: ["Disregarded entity (sole prop)", "C Corporation", "S Corporation", "Partnership"],
    },
    layout: { width: "half" },
    conditionalLogic: showIf([isLLCClass]),
  });

  f.push({
    page: P3, type: "radio", key: "tin_type", label: "TIN Type", required: true,
    fieldConfig: { options: ["SSN (for individuals)", "EIN (for entities)"], layout: "horizontal" },
    layout: { width: "half" },
  });
  f.push({
    page: P3, type: "text", key: "tin", label: "Taxpayer Identification Number", required: true,
    placeholder: "XXX-XX-XXXX or XX-XXXXXXX",
    helpText: "Encrypted at rest. Masked after entry.",
    layout: { width: "half" },
  });
  f.push({
    page: P3, type: "address", key: "tax_mailing_address", label: "Tax Mailing Address (if different from Section 1)",
    helpText: "Leave blank to use mailing address from Section 1.",
    fieldConfig: { showStreet2: true },
  });

  f.push({ page: P3, ...para(
    "W-9 Certification — Under penalties of perjury, I certify that: (1) The number shown on this form is my correct taxpayer identification number; (2) I am not subject to backup withholding because I am exempt, or I have not been notified by the IRS that I am subject to backup withholding, or the IRS has notified me that I am no longer subject to backup withholding; (3) I am a U.S. citizen or other U.S. person; (4) The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct."
  ) });
  f.push(ack(P3, "ack_w9_certification", "I have read and certify the W-9 statements above are true and accurate."));

  // Conditional: additional W-9 for unmarried co-owners
  f.push({ page: P3, ...heading("Additional W-9s for Unmarried Co-Owners", "h4"), conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P3, ...para("Additional W-9s required for unmarried co-owners. Each co-owner must provide their own W-9 below."), conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });

  f.push({ page: P3, ...heading("W-9 for Co-Owner 2", "h4"), conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P3, type: "text", key: "co2_tax_legal_name", label: "Legal Name for Tax Purposes", required: true, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({
    page: P3, type: "dropdown", key: "co2_federal_tax_class", label: "Federal Tax Classification", required: true,
    fieldConfig: { options: ["Individual / Sole Proprietor", "C Corporation", "S Corporation", "Partnership", "Trust / Estate", "LLC"] },
    layout: { width: "half" },
    conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]),
  });
  f.push({ page: P3, type: "text", key: "co2_tin", label: "TIN (SSN or EIN)", required: true, placeholder: "Encrypted", layout: { width: "half" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push(ack(
    P3, "ack_co2_w9",
    "Co-Owner 2 certifies the W-9 statements are true and accurate.",
    showIf([isJoint, isUnmarried, isProceedingUnmarried]),
  ));

  f.push({ page: P3, ...heading("W-9 for Co-Owner 3 (if applicable)", "h4"), conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P3, type: "text", key: "co3_tax_legal_name", label: "Legal Name for Tax Purposes", conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({
    page: P3, type: "dropdown", key: "co3_federal_tax_class", label: "Federal Tax Classification",
    fieldConfig: { options: ["Individual / Sole Proprietor", "C Corporation", "S Corporation", "Partnership", "Trust / Estate", "LLC"] },
    layout: { width: "half" },
    conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]),
  });
  f.push({ page: P3, type: "text", key: "co3_tin", label: "TIN (SSN or EIN)", placeholder: "Encrypted", layout: { width: "half" }, conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });

  // Nominee 1099 disclosure (only for unmarried co-owners proceeding as individuals)
  f.push({ page: P3, ...heading("Nominee 1099 Disclosure", "h4"), conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push({ page: P3, ...para(
    "IMPORTANT — Nominee 1099 Notice for Unmarried Co-Owners: By selecting individual co-owner treatment (rather than forming an LLC or partnership), you acknowledge and agree that: (1) RPM Prestige will issue ONE Form 1099-MISC annually to the designated Primary 1099 Recipient. The 1099 will report the full gross rental income paid out by RPM during the tax year. (2) The Primary 1099 Recipient is responsible for issuing nominee 1099s to each co-owner reporting their proportional share of the rental income, per IRS guidance on nominee reporting. (3) RPM Prestige does not prepare, file, or assist with nominee 1099s. Consult a CPA before March 1 each year. (4) Each co-owner remains individually responsible for reporting their share of rental income on their own tax return. (5) RPM's recommendation: Forming an LLC or partnership eliminates this complexity."
  ), conditionalLogic: showIf([isJoint, isUnmarried, isProceedingUnmarried]) });
  f.push(ack(
    P3, "ack_nominee_1099_disclosure",
    "I (and each co-owner) acknowledge the nominee 1099 disclosure above.",
    showIf([isJoint, isUnmarried, isProceedingUnmarried]),
  ));

  // Electronic 1099 consent
  f.push({ page: P3, ...heading("Electronic 1099 Consent", "h4") });
  f.push({
    page: P3, type: "radio", key: "consent_e1099", label: "Electronic 1099 Delivery", required: true,
    fieldConfig: {
      options: [
        "Yes, send my 1099 electronically (faster, more secure, year-round portal access)",
        "No, mail me a paper 1099 by USPS",
      ],
      layout: "vertical",
    },
  });
  f.push({ page: P3, ...para(
    "Electronic Disclosure: By consenting to electronic delivery, you understand that: (1) you can request a paper copy at any time; (2) you can withdraw your consent in writing at any time; (3) you need an internet-connected device and email access to view your 1099; (4) you will notify RPM Prestige if your email address changes; (5) this consent applies to all future tax years until you withdraw it."
  ) });
  f.push(ack(P3, "ack_e1099_disclosure", "I acknowledge the electronic disclosure terms above."));

  /* ======================================================================
   * PAGE 4 — HOME WARRANTY (OPTIONAL)
   * ====================================================================== */
  const P4 = 4;
  f.push({ page: P4, ...para("This section is optional. If you don't have an active home warranty, select 'No' below and click Next to skip.") });
  f.push({
    page: P4, type: "radio", key: "has_warranty", label: "Do you have an active home warranty?",
    fieldConfig: {
      options: ["No active warranty", "Yes — I have a home warranty"],
      layout: "vertical",
    },
    defaultValue: "No active warranty",
  });

  f.push({ page: P4, type: "text", key: "warranty_provider", label: "Warranty Provider", placeholder: "e.g., American Home Shield, Choice, First American", layout: { width: "half" }, conditionalLogic: showIf([hasWarranty]) });
  f.push({ page: P4, type: "text", key: "warranty_policy_number", label: "Policy Number", layout: { width: "half" }, conditionalLogic: showIf([hasWarranty]) });
  f.push({ page: P4, type: "date", key: "warranty_effective_date", label: "Effective Date", layout: { width: "third" }, conditionalLogic: showIf([hasWarranty]) });
  f.push({ page: P4, type: "date", key: "warranty_expiration_date", label: "Expiration Date", layout: { width: "third" }, conditionalLogic: showIf([hasWarranty]) });
  f.push({ page: P4, type: "currency", key: "warranty_service_call_fee", label: "Service Call Fee", layout: { width: "third" }, conditionalLogic: showIf([hasWarranty]) });
  f.push({ page: P4, type: "phone", key: "warranty_claims_phone", label: "Claims Phone", layout: { width: "half" }, conditionalLogic: showIf([hasWarranty]) });
  f.push({ page: P4, type: "text", key: "warranty_portal_url", label: "Portal URL (if any)", placeholder: "https://", layout: { width: "half" }, conditionalLogic: showIf([hasWarranty]) });
  f.push({ page: P4, type: "text", key: "warranty_account_username", label: "Account Username (encrypted)", placeholder: "Optional — for claims access", layout: { width: "half" }, conditionalLogic: showIf([hasWarranty]) });
  f.push({ page: P4, type: "text", key: "warranty_account_password", label: "Account Password (encrypted)", placeholder: "Optional — restricted access", layout: { width: "half" }, conditionalLogic: showIf([hasWarranty]) });
  f.push({
    page: P4, type: "file", key: "warranty_policy_document", label: "Upload Policy Document",
    fieldConfig: { maxFiles: 1, maxFileSize: 10485760, acceptTypes: ".pdf,.jpg,.jpeg,.png" },
    conditionalLogic: showIf([hasWarranty]),
  });

  /* ======================================================================
   * PAGE 5 — PREFERRED VENDORS (OPTIONAL)
   * ====================================================================== */
  const P5 = 5;
  f.push({ page: P5, ...para(
    "This section is optional. RPM Prestige will attempt to use your preferred vendors when they are (1) licensed and insured, (2) responsive within 24 hours, (3) provide written invoices, and (4) are reasonably priced. We reserve the right to use alternates when these criteria aren't met, in emergencies, or when work isn't completed satisfactorily. We'll vet each vendor before first use."
  ) });
  f.push({
    page: P5, type: "radio", key: "has_vendors", label: "Do you have preferred vendors to share?",
    fieldConfig: {
      options: ["No preferred vendors (RPM uses its trusted vendor network)", "Yes, I have preferred vendors"],
      layout: "vertical",
    },
    defaultValue: "No preferred vendors (RPM uses its trusted vendor network)",
  });

  const vendorTrades = ["HVAC", "Plumbing", "Electrical", "Landscaping", "Pest Control", "Pool", "Cleaning", "Painting", "Handyman", "Roofing", "Other"];

  for (let n = 1; n <= 3; n++) {
    f.push({ page: P5, ...heading(`Vendor ${n}${n === 1 ? "" : " (optional)"}`, "h4"), conditionalLogic: showIf([hasVendors]) });
    f.push({ page: P5, type: "text", key: `vendor${n}_business_name`, label: "Business Name", placeholder: "ABC Plumbing", layout: { width: "half" }, conditionalLogic: showIf([hasVendors]) });
    f.push({
      page: P5, type: "dropdown", key: `vendor${n}_trade`, label: "Trade / Service",
      fieldConfig: { options: vendorTrades }, layout: { width: "half" }, conditionalLogic: showIf([hasVendors]),
    });
    f.push({ page: P5, type: "text", key: `vendor${n}_contact_name`, label: "Contact Name", placeholder: "Optional", layout: { width: "half" }, conditionalLogic: showIf([hasVendors]) });
    f.push({ page: P5, type: "phone", key: `vendor${n}_phone`, label: "Phone", layout: { width: "half" }, conditionalLogic: showIf([hasVendors]) });
    f.push({ page: P5, type: "email", key: `vendor${n}_email`, label: "Email", placeholder: "Optional", layout: { width: "half" }, conditionalLogic: showIf([hasVendors]) });
    f.push({ page: P5, type: "text", key: `vendor${n}_years_used`, label: "How long have you used them?", placeholder: "Optional", layout: { width: "half" }, conditionalLogic: showIf([hasVendors]) });
    f.push({
      page: P5, type: "dropdown", key: `vendor${n}_licensed`, label: "Licensed?",
      fieldConfig: { options: ["Yes", "No", "Unknown"] }, layout: { width: "third" }, conditionalLogic: showIf([hasVendors]),
    });
    f.push({
      page: P5, type: "dropdown", key: `vendor${n}_insured`, label: "Insured?",
      fieldConfig: { options: ["Yes", "No", "Unknown"] }, layout: { width: "third" }, conditionalLogic: showIf([hasVendors]),
    });
    f.push({ page: P5, type: "text", key: `vendor${n}_pricing_notes`, label: "Special pricing arrangement?", placeholder: "Optional", layout: { width: "third" }, conditionalLogic: showIf([hasVendors]) });
  }

  /* ======================================================================
   * PAGE 6 — SERVICE UPGRADES (OPTIONAL)
   * ====================================================================== */
  const P6 = 6;
  f.push({ page: P6, ...para("No pressure, no commitment. These are services many of our owners adopt over time as needs arise. We won't enable anything without your explicit confirmation. You can opt in or out at any time.") });
  f.push({
    page: P6, type: "checkbox", key: "service_upgrades", label: "Which service upgrades interest you?",
    fieldConfig: {
      options: [
        "Premium Owner Hotline — 24/7 priority phone access (monthly fee)",
        "Paper Statements — printed monthly statements in addition to portal (monthly fee)",
        "Owner Benefits Package — eviction protection, lost-rent coverage, malicious-damage coverage (monthly fee)",
        "Enhanced Inspection Cadence — quarterly exterior drive-by inspections (per-inspection fee)",
        "I'd prefer to discuss these on the Orientation Call",
        "Not interested in any upgrades right now",
      ],
      layout: "vertical",
    },
    helpText: "Select any that apply. Pricing reviewed on your Orientation Call.",
  });

  /* ======================================================================
   * PAGE 7 — ACKNOWLEDGMENTS
   * ====================================================================== */
  const P7 = 7;
  f.push({ page: P7, ...para("Your file at a glance — confirming you've reviewed what we agreed on pre-signing. Property address, PMA signed date, reserve amount, maintenance threshold, and expected first distribution will be pre-populated by Amanda from your file.") });

  f.push(ack(P7, "ack_pma", "I have reviewed the signed Property Management Agreement and understand its terms."));
  f.push(ack(P7, "ack_financial_expectations", "I have reviewed the signed Owner Financial Expectations Agreement and understand my first 60 days of cash flow."));
  f.push(ack(P7, "ack_maintenance_threshold", "I understand RPM will not authorize repairs above the maintenance approval threshold without my approval, and repairs below proceed without delay."));
  f.push(ack(P7, "ack_landlord_insurance", "I am responsible for maintaining landlord insurance with RPM Prestige listed as Additional Insured, HOA dues, property taxes, and utility payments during vacancy."));
  f.push(ack(P7, "ack_rpm_responsibilities", "I understand RPM Prestige handles tenant placement, rent collection, maintenance coordination, monthly accounting, Texas Property Code compliance, and year-end tax reporting."));
  f.push(ack(P7, "ack_communication_sla", "I understand communication SLAs: business-day email response within 1 business day; 24/7 emergency phone line for property emergencies."));

  /* ======================================================================
   * PAGE 8 — SIGNATURE
   * ====================================================================== */
  const P8 = 8;
  f.push({ page: P8, ...para("Your typed signature legally binds the ACH authorization, W-9 certification, and form attestation. Signature count depends on your owner type: Individual = 1, Joint Owners (married) = 2 (community property law), Joint Owners (unmarried) = one per co-owner.") });

  f.push({ page: P8, ...heading("Signer 1 — Primary Owner", "h4") });
  f.push({ page: P8, type: "text", key: "signer1_typed_name", label: "Type your full legal name to sign electronically", required: true });
  f.push({ page: P8, type: "signature", key: "signer1_signature", label: "Signature", required: true });
  f.push(ack(P8, "ack_signer1_truthful", "I certify the information on this form is true, accurate, and complete to the best of my knowledge."));

  // Signer 2 — required for married joint and unmarried co-owners
  const requireSigner2 = showIf([isJoint], "all");
  f.push({ page: P8, ...heading("Signer 2 — Co-Owner / Spouse 2", "h4"), conditionalLogic: requireSigner2 });
  f.push({ page: P8, ...para("Each owner with signatory authority must sign. If they're not available now, save the form and have them complete this section later."), conditionalLogic: requireSigner2 });
  f.push({ page: P8, type: "text", key: "signer2_typed_name", label: "Type Signer 2's full legal name", required: true, conditionalLogic: requireSigner2 });
  f.push({ page: P8, type: "signature", key: "signer2_signature", label: "Signature", required: true, conditionalLogic: requireSigner2 });
  f.push(ack(P8, "ack_signer2_truthful", "Signer 2 certifies the information on this form is true, accurate, and complete to the best of their knowledge.", requireSigner2));

  // Signer 3 — only if unmarried co-owners with a third co-owner filled out
  const requireSigner3 = showIf([
    isJoint, isUnmarried, isProceedingUnmarried,
    { fieldKey: "co3_first_name", operator: "is_not_empty", value: "" },
  ], "all");
  f.push({ page: P8, ...heading("Signer 3 — Additional Co-Owner", "h4"), conditionalLogic: requireSigner3 });
  f.push({ page: P8, type: "text", key: "signer3_typed_name", label: "Type Signer 3's full legal name", required: true, conditionalLogic: requireSigner3 });
  f.push({ page: P8, type: "signature", key: "signer3_signature", label: "Signature", required: true, conditionalLogic: requireSigner3 });
  f.push(ack(P8, "ack_signer3_truthful", "Signer 3 certifies the information on this form is true, accurate, and complete to the best of their knowledge.", requireSigner3));

  // suppress unused warnings on helpers
  void requireIf; void optionalAck; void divider;
  return f;
}

function ratingBlock(pageIndex, items) {
  return items.map((it) => ({
    page: pageIndex,
    type: "dropdown",
    key: it.key,
    label: it.label,
    fieldConfig: { options: ["Excellent", "Good", "Fair", "Poor", "N/A"] },
    layout: { width: "half" },
  }));
}

export async function ensureFormTemplates() {
  const pool = getPool();
  for (const t of STARTER_TEMPLATES) {
    const { rows: existing } = await pool.query(
      `SELECT id FROM forms WHERE is_template = true AND template_category = $1 AND name = $2`,
      [t.category, t.name]
    );
    if (existing.length) continue;

    const baseSlug = `template-${t.key}`;
    const token = randomBytes(24).toString("hex");
    const { rows: form } = await pool.query(
      `INSERT INTO forms (
        name, description, category, status, is_multi_step, access_type, access_token, slug,
        is_active, is_template, template_category, template_description, template_icon
       ) VALUES ($1, $2, $3, 'published', $4, 'public', $5, $6, true, true, $7, $8, $9)
       RETURNING id`,
      [t.name, t.description, t.category, !!t.isMultiStep, token, baseSlug, t.category, t.description, t.icon]
    );
    const formId = form[0].id;

    const pageMap = new Map();
    const pageDefs = t.pages?.length ? t.pages : [{ title: t.name }];
    for (let i = 0; i < pageDefs.length; i++) {
      const p = pageDefs[i];
      const { rows: pg } = await pool.query(
        `INSERT INTO form_pages (form_id, title, description, page_order) VALUES ($1, $2, $3, $4) RETURNING id`,
        [formId, p.title || `Page ${i + 1}`, p.description || null, i]
      );
      pageMap.set(i, pg[0].id);
    }

    for (let i = 0; i < t.fields.length; i++) {
      const f = t.fields[i];
      const pageIdx = typeof f.page === "number" ? f.page : 0;
      const pageId = pageMap.get(pageIdx) ?? pageMap.get(0);
      await pool.query(
        `INSERT INTO form_fields (
          form_id, page_id, field_key, field_type, label, description, placeholder, help_text,
          is_required, is_hidden, default_value, validation, field_config, conditional_logic,
          pre_fill_config, layout, sort_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10, $11, $12, $13, null, $14, $15)`,
        [
          formId, pageId, f.key, f.type, f.label,
          f.description || null, f.placeholder || null, f.helpText || null,
          !!f.required,
          f.defaultValue ?? null,
          f.validation && typeof f.validation === "object" ? f.validation : {},
          f.fieldConfig || {}, f.conditionalLogic || null,
          f.layout || { width: "full" }, i,
        ]
      );
    }
  }
}
