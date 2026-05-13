/**
 * Row → API response mappers. Centralized so every endpoint returns the
 * same shape for a given entity. Same pattern as inboxSlaPolicies.js.
 */

export function mapBrokerage(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    address_1: r.address_1 ?? null,
    address_2: r.address_2 ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
    zip: r.zip ?? null,
    phone: r.phone ?? null,
    website: r.website ?? null,
    mls_office_id: r.mls_office_id ?? null,
    notes: r.notes ?? null,
    active: r.active !== false,
    agent_count: r.agent_count != null ? Number(r.agent_count) : undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function mapAgent(r, { includeStats = false } = {}) {
  if (!r) return null;
  const base = {
    id: r.id,
    full_name: r.full_name,
    first_name: r.first_name ?? null,
    last_name: r.last_name ?? null,
    preferred_name: r.preferred_name ?? null,
    pronouns: r.pronouns ?? null,
    photo_url: r.photo_url ?? null,
    license_number: r.license_number ?? null,
    license_state: r.license_state ?? "TX",
    license_status: r.license_status ?? null,
    license_expiration: r.license_expiration ?? null,
    mls_id: r.mls_id ?? null,
    years_licensed: r.years_licensed ?? null,
    brokerage_id: r.brokerage_id ?? null,
    brokerage_name: r.brokerage_name ?? null,
    title: r.title ?? null,
    team_name: r.team_name ?? null,
    niche: r.niche ?? null,
    target_zips: Array.isArray(r.target_zips) ? r.target_zips : [],
    average_price_point: r.average_price_point != null ? Number(r.average_price_point) : null,
    annual_volume: r.annual_volume != null ? Number(r.annual_volume) : null,
    referral_fee_split: r.referral_fee_split != null ? Number(r.referral_fee_split) : null,
    email: r.email ?? null,
    phone_mobile: r.phone_mobile ?? null,
    phone_office: r.phone_office ?? null,
    mailing_address_1: r.mailing_address_1 ?? null,
    mailing_address_2: r.mailing_address_2 ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
    zip: r.zip ?? null,
    preferred_channel: r.preferred_channel ?? null,
    preferred_contact_time: r.preferred_contact_time ?? null,
    do_not_contact: r.do_not_contact === true,
    linkedin_url: r.linkedin_url ?? null,
    facebook_url: r.facebook_url ?? null,
    instagram_handle: r.instagram_handle ?? null,
    personal_website: r.personal_website ?? null,
    har_profile_url: r.har_profile_url ?? null,
    tier: r.tier,
    source: r.source ?? null,
    source_detail: r.source_detail ?? null,
    first_contact_date: r.first_contact_date ?? null,
    last_interaction_date: r.last_interaction_date ?? null,
    relationship_owner_user_id: r.relationship_owner_user_id ?? null,
    status: r.status,
    notes: r.notes ?? null,
    consent_to_email: r.consent_to_email === true,
    consent_to_email_at: r.consent_to_email_at ?? null,
    consent_to_sms: r.consent_to_sms === true,
    consent_to_sms_at: r.consent_to_sms_at ?? null,
    unsubscribed_at: r.unsubscribed_at ?? null,
    merged_into_agent_id: r.merged_into_agent_id ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    created_by: r.created_by ?? null,
    updated_by: r.updated_by ?? null,
  };
  if (includeStats) {
    base.activity_count = r.activity_count != null ? Number(r.activity_count) : 0;
    base.tag_count = r.tag_count != null ? Number(r.tag_count) : 0;
  }
  return base;
}

export function mapPersonalDetails(r) {
  if (!r) return null;
  return {
    agent_id: r.agent_id,
    birthday_month: r.birthday_month ?? null,
    birthday_day: r.birthday_day ?? null,
    birthday_year: r.birthday_year ?? null,
    spouse_name: r.spouse_name ?? null,
    spouse_birthday_month: r.spouse_birthday_month ?? null,
    spouse_birthday_day: r.spouse_birthday_day ?? null,
    anniversary_date: r.anniversary_date ?? null,
    children: Array.isArray(r.children) ? r.children : [],
    pets: Array.isArray(r.pets) ? r.pets : [],
    alma_mater: r.alma_mater ?? null,
    graduation_year: r.graduation_year ?? null,
    hometown: r.hometown ?? null,
    hobbies: r.hobbies ?? null,
    food_preferences: r.food_preferences ?? null,
    gift_preferences: r.gift_preferences ?? null,
    religious_observances: r.religious_observances ?? null,
    important_dates: Array.isArray(r.important_dates) ? r.important_dates : [],
    personal_notes: r.personal_notes ?? null,
    last_updated_at: r.last_updated_at,
    updated_by: r.updated_by ?? null,
  };
}

export function mapActivity(r) {
  if (!r) return null;
  return {
    id: r.id,
    agent_id: r.agent_id,
    type: r.type,
    direction: r.direction,
    subject: r.subject ?? null,
    summary: r.summary ?? null,
    body: r.body ?? null,
    external_id: r.external_id ?? null,
    metadata: r.metadata ?? {},
    automation_id: r.automation_id ?? null,
    template_id: r.template_id ?? null,
    occurred_at: r.occurred_at,
    deleted_at: r.deleted_at ?? null,
    created_at: r.created_at,
    created_by: r.created_by ?? null,
    updated_at: r.updated_at,
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
  };
}

export function mapAttachment(r) {
  if (!r) return null;
  return {
    id: r.id,
    activity_id: r.activity_id,
    filename: r.filename,
    file_url: r.file_url,
    file_type: r.file_type ?? null,
    file_size_bytes: r.file_size_bytes != null ? Number(r.file_size_bytes) : null,
    uploaded_at: r.uploaded_at,
    uploaded_by: r.uploaded_by ?? null,
    // disk_basename is intentionally NEVER included — backend-only.
  };
}

export function mapTag(r) {
  if (!r) return null;
  return {
    id: r.id,
    agent_id: r.agent_id,
    tag: r.tag,
    created_at: r.created_at,
    created_by: r.created_by ?? null,
  };
}

export function mapRelationship(r) {
  if (!r) return null;
  return {
    id: r.id,
    agent_a_id: r.agent_a_id,
    agent_b_id: r.agent_b_id,
    relationship_type: r.relationship_type,
    notes: r.notes ?? null,
    created_at: r.created_at,
    created_by: r.created_by ?? null,
    // Optional joined fields
    agent_a_name: r.agent_a_name ?? null,
    agent_b_name: r.agent_b_name ?? null,
  };
}

export function mapHubPermissions(r) {
  if (!r) return null;
  return {
    user_id: r.user_id,
    role: r.role,
    can_view_personal_details: r.can_view_personal_details === true,
    can_change_tier: r.can_change_tier === true,
    can_mark_dnc: r.can_mark_dnc === true,
    can_export: r.can_export === true,
    can_merge: r.can_merge === true,
    assigned_agent_ids: Array.isArray(r.assigned_agent_ids) ? r.assigned_agent_ids : null,
    username: r.username ?? null,
    display_name: r.display_name ?? null,
  };
}

// ============================================================
// Phase 2 mappers
// ============================================================

export function mapOwner(r) {
  if (!r) return null;
  return {
    id: r.id,
    full_name: r.full_name,
    first_name: r.first_name ?? null,
    last_name: r.last_name ?? null,
    email: r.email ?? null,
    phone_mobile: r.phone_mobile ?? null,
    phone_office: r.phone_office ?? null,
    mailing_address_1: r.mailing_address_1 ?? null,
    mailing_address_2: r.mailing_address_2 ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
    zip: r.zip ?? null,
    is_company: r.is_company === true,
    company_name: r.company_name ?? null,
    source_agent_id: r.source_agent_id ?? null,
    source_agent_name: r.source_agent_name ?? null,
    first_referral_date: r.first_referral_date ?? null,
    notes: r.notes ?? null,
    status: r.status,
    external_appfolio_id: r.external_appfolio_id ?? null,
    property_count: r.property_count != null ? Number(r.property_count) : undefined,
    active_referral_count: r.active_referral_count != null ? Number(r.active_referral_count) : undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function mapProperty(r) {
  if (!r) return null;
  return {
    id: r.id,
    owner_id: r.owner_id,
    owner_name: r.owner_name ?? null,
    address_1: r.address_1,
    address_2: r.address_2 ?? null,
    city: r.city,
    state: r.state,
    zip: r.zip,
    property_type: r.property_type ?? null,
    bedrooms: r.bedrooms != null ? Number(r.bedrooms) : null,
    bathrooms: r.bathrooms != null ? Number(r.bathrooms) : null,
    square_feet: r.square_feet ?? null,
    year_built: r.year_built ?? null,
    notes: r.notes ?? null,
    status: r.status,
    external_appfolio_property_id: r.external_appfolio_property_id ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function mapReferral(r) {
  if (!r) return null;
  return {
    id: r.id,
    agent_id: r.agent_id,
    agent_name: r.agent_name ?? null,
    agent_brokerage_name: r.agent_brokerage_name ?? null,
    agent_tier: r.agent_tier ?? null,
    agent_photo_url: r.agent_photo_url ?? null,
    owner_id: r.owner_id,
    owner_name: r.owner_name ?? null,
    property_id: r.property_id ?? null,
    property_address: r.property_address ?? null,
    property_city: r.property_city ?? null,
    stage: r.stage,
    stage_changed_at: r.stage_changed_at,
    stage_changed_by: r.stage_changed_by ?? null,
    lost_reason: r.lost_reason ?? null,
    lost_at: r.lost_at ?? null,
    declined_reason: r.declined_reason ?? null,
    declined_at: r.declined_at ?? null,
    expected_monthly_rent: r.expected_monthly_rent != null ? Number(r.expected_monthly_rent) : null,
    expected_management_fee_pct: r.expected_management_fee_pct != null ? Number(r.expected_management_fee_pct) : null,
    expected_first_month_referral_fee: r.expected_first_month_referral_fee != null ? Number(r.expected_first_month_referral_fee) : null,
    actual_monthly_rent: r.actual_monthly_rent != null ? Number(r.actual_monthly_rent) : null,
    actual_management_fee_pct: r.actual_management_fee_pct != null ? Number(r.actual_management_fee_pct) : null,
    actual_referral_fee_paid: r.actual_referral_fee_paid != null ? Number(r.actual_referral_fee_paid) : 0,
    tenant_placed_at: r.tenant_placed_at ?? null,
    active_management_started_at: r.active_management_started_at ?? null,
    notes: r.notes ?? null,
    internal_priority: r.internal_priority,
    expected_close_date: r.expected_close_date ?? null,
    source_activity_id: r.source_activity_id ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    created_by: r.created_by ?? null,
    updated_by: r.updated_by ?? null,
  };
}

export function mapStageHistory(r) {
  if (!r) return null;
  return {
    id: r.id,
    referral_id: r.referral_id,
    from_stage: r.from_stage ?? null,
    to_stage: r.to_stage,
    changed_at: r.changed_at,
    changed_by: r.changed_by ?? null,
    changed_by_name: r.changed_by_name ?? null,
    notes: r.notes ?? null,
    duration_in_previous_stage: r.duration_in_previous_stage ?? null,
  };
}

export function mapPayment(r) {
  if (!r) return null;
  return {
    id: r.id,
    referral_id: r.referral_id,
    amount: Number(r.amount),
    payment_date: r.payment_date,
    payment_method: r.payment_method,
    check_number: r.check_number ?? null,
    paid_to_name: r.paid_to_name,
    notes: r.notes ?? null,
    created_at: r.created_at,
    created_by: r.created_by ?? null,
    updated_at: r.updated_at,
  };
}

export function mapRevenue(r) {
  if (!r) return null;
  return {
    id: r.id,
    referral_id: r.referral_id,
    month: r.month,
    rent_collected: Number(r.rent_collected),
    management_fee_earned: Number(r.management_fee_earned),
    notes: r.notes ?? null,
    created_at: r.created_at,
    created_by: r.created_by ?? null,
    updated_at: r.updated_at,
  };
}

export function mapTask(r) {
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    assigned_to: r.assigned_to ?? null,
    assigned_to_name: r.assigned_to_name ?? null,
    related_agent_id: r.related_agent_id ?? null,
    related_agent_name: r.related_agent_name ?? null,
    related_referral_id: r.related_referral_id ?? null,
    related_owner_id: r.related_owner_id ?? null,
    related_property_id: r.related_property_id ?? null,
    due_date: r.due_date ?? null,
    status: r.status,
    priority: r.priority,
    completed_at: r.completed_at ?? null,
    completed_by: r.completed_by ?? null,
    source: r.source,
    created_at: r.created_at,
    updated_at: r.updated_at,
    created_by: r.created_by ?? null,
  };
}

export function mapLifetimeValue(r) {
  if (!r) return null;
  return {
    agent_id: r.agent_id,
    total_referrals_received: Number(r.total_referrals_received),
    total_referrals_in_pipeline: Number(r.total_referrals_in_pipeline),
    total_referrals_converted: Number(r.total_referrals_converted),
    total_referrals_lost: Number(r.total_referrals_lost),
    total_referrals_declined: Number(r.total_referrals_declined),
    conversion_rate_pct: r.conversion_rate_pct != null ? Number(r.conversion_rate_pct) : 0,
    total_referral_fees_paid: Number(r.total_referral_fees_paid),
    total_revenue_generated: Number(r.total_revenue_generated),
    lifetime_relationship_value: Number(r.lifetime_relationship_value),
    first_referral_date: r.first_referral_date ?? null,
    last_referral_date: r.last_referral_date ?? null,
    avg_days_to_convert: r.avg_days_to_convert != null ? Number(r.avg_days_to_convert) : null,
    last_calculated_at: r.last_calculated_at,
  };
}

export function mapAuditEntry(r) {
  if (!r) return null;
  return {
    id: r.id,
    user_id: r.user_id,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    action: r.action,
    field_name: r.field_name ?? null,
    old_value: r.old_value ?? null,
    new_value: r.new_value ?? null,
    context: r.context ?? null,
    created_at: r.created_at,
    username: r.username ?? null,
    display_name: r.display_name ?? null,
  };
}
