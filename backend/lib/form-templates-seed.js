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
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, null, '{}', $10, $11, null, $12, $13)`,
        [
          formId, pageId, f.key, f.type, f.label,
          f.description || null, f.placeholder || null, f.helpText || null,
          !!f.required,
          f.fieldConfig || {}, f.conditionalLogic || null,
          f.layout || { width: "full" }, i,
        ]
      );
    }
  }
}
