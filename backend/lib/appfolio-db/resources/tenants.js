/**
 * AppFolio Database API — tenants.
 */

export function listTenants(client, params) {
  return client.get("/tenants", params);
}

export function getTenant(client, id) {
  return client.get(`/tenants/${encodeURIComponent(id)}`);
}

export function createTenant(client, body) {
  return client.post("/tenants", body);
}

export function updateTenant(client, id, body) {
  return client.patch(`/tenants/${encodeURIComponent(id)}`, body);
}

export function addTenantNote(client, id, body) {
  return client.post(`/tenants/${encodeURIComponent(id)}/notes`, body);
}

/**
 * Bulk creation. AppFolio's API accepts an array under `tenants`; if the
 * live spec differs once we have credentials, adjust here only.
 */
export function bulkCreateTenants(client, tenants) {
  return client.post("/tenants/bulk", { tenants });
}

export function bulkUpdateTenants(client, tenants) {
  return client.patch("/tenants/bulk", { tenants });
}
