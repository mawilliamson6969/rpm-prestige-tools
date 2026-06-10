/**
 * Contacts sync — pure extractor/diff tests (no DB).
 *
 * Run:  cd backend && node --test __tests__/contacts-sync.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitPersonName,
  extractTenant,
  extractOwner,
  extractVendor,
  diffSyncedFields,
} from "../lib/contacts-sync.js";

test("splitPersonName handles 'First Last'", () => {
  assert.deepEqual(splitPersonName("Jane Smith"), {
    first: "Jane",
    last: "Smith",
    display: "Jane Smith",
  });
});

test("splitPersonName handles 'Last, First'", () => {
  assert.deepEqual(splitPersonName("Smith, Jane"), {
    first: "Jane",
    last: "Smith",
    display: "Jane Smith",
  });
});

test("splitPersonName handles single names and blanks", () => {
  assert.deepEqual(splitPersonName("Cher"), { first: "Cher", last: null, display: "Cher" });
  assert.deepEqual(splitPersonName(""), { first: null, last: null, display: null });
  assert.deepEqual(splitPersonName("Mary Jo Kline"), {
    first: "Mary Jo",
    last: "Kline",
    display: "Mary Jo Kline",
  });
});

test("extractTenant maps rent_roll fields and metadata", () => {
  const rec = extractTenant({
    tenant: "Smith, Jane",
    tenant_id: "T-991",
    primary_tenant_email: "jane@example.com",
    primary_tenant_phone_number: "(281) 555-0101",
    property_id: "P-42",
    property_name: "1234 Main St",
    unit: "B",
    lease_from: "2025-07-01",
    lease_to: "2026-06-30",
    status: "Current",
  });
  assert.equal(rec.source, "appfolio_tenant");
  assert.equal(rec.externalId, "T-991");
  assert.equal(rec.displayName, "Jane Smith");
  assert.equal(rec.firstName, "Jane");
  assert.equal(rec.lastName, "Smith");
  assert.equal(rec.email, "jane@example.com");
  assert.equal(rec.metadata.property_id, "P-42");
  assert.equal(rec.metadata.unit, "B");
});

test("extractTenant returns null for vacant-unit rows", () => {
  assert.equal(extractTenant({ property_name: "1234 Main St", unit: "A" }), null);
  assert.equal(extractTenant(null), null);
  assert.equal(extractTenant("garbage"), null);
});

test("extractOwner keeps company-style names unsplit", () => {
  const rec = extractOwner({
    owner_id: "O-7",
    owner_name: "Smith Family Trust LLC",
    email: "trust@example.com",
  });
  assert.equal(rec.source, "appfolio_owner");
  assert.equal(rec.displayName, "Smith Family Trust LLC");
  assert.equal(rec.firstName, null);
  assert.equal(rec.lastName, null);
});

test("extractVendor records company + trade", () => {
  const rec = extractVendor({
    vendor_id: "V-3",
    vendor_name: "ACME Plumbing",
    phone: "281-555-0102",
    vendor_type: "Plumber",
  });
  assert.equal(rec.source, "appfolio_vendor");
  assert.equal(rec.company, "ACME Plumbing");
  assert.equal(rec.metadata.vendor_type, "Plumber");
});

test("diffSyncedFields skips overridden, empty, and unchanged values", () => {
  const incoming = {
    displayName: "Jane Smith",
    firstName: "Jane",
    lastName: "Smith",
    company: null,
    email: "new@example.com",
    phone: "",
  };
  const existing = {
    display_name: "Jane Smith", // unchanged → skip
    first_name: "J.",           // changed → update
    last_name: "Smith",
    company: "Old Co",          // incoming null → skip (never clobber)
    email: "old@example.com",   // changed but overridden → skip
    phone: "281-555-0100",      // incoming empty → skip
    manual_overrides: { email: true },
  };
  assert.deepEqual(diffSyncedFields(incoming, existing), { first_name: "Jane" });
});

test("diffSyncedFields updates everything on a blank row", () => {
  const incoming = {
    displayName: "Bob Owner",
    firstName: null,
    lastName: null,
    company: null,
    email: "bob@example.com",
    phone: "555",
  };
  const existing = {
    display_name: "bob owner (typo)",
    first_name: null,
    last_name: null,
    company: null,
    email: null,
    phone: null,
    manual_overrides: {},
  };
  assert.deepEqual(diffSyncedFields(incoming, existing), {
    display_name: "Bob Owner",
    email: "bob@example.com",
    phone: "555",
  });
});
