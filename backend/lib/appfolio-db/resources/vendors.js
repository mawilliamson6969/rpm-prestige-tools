/**
 * AppFolio Database API — vendors.
 */

export function listVendors(client, params) {
  return client.get("/vendors", params);
}

export function getVendor(client, id) {
  return client.get(`/vendors/${encodeURIComponent(id)}`);
}

export function createVendor(client, body) {
  return client.post("/vendors", body);
}

export function updateVendor(client, id, body) {
  return client.patch(`/vendors/${encodeURIComponent(id)}`, body);
}

export function deleteVendor(client, id) {
  return client.delete(`/vendors/${encodeURIComponent(id)}`);
}

export function addVendorNote(client, id, body) {
  return client.post(`/vendors/${encodeURIComponent(id)}/notes`, body);
}
