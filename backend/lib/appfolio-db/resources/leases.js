/**
 * AppFolio Database API — leases.
 */

export function listLeases(client, params) {
  return client.get("/leases", params);
}

export function getLease(client, id) {
  return client.get(`/leases/${encodeURIComponent(id)}`);
}

export function createLease(client, body) {
  return client.post("/leases", body);
}

export function updateLease(client, id, body) {
  return client.patch(`/leases/${encodeURIComponent(id)}`, body);
}

export function addLeaseNote(client, id, body) {
  return client.post(`/leases/${encodeURIComponent(id)}/notes`, body);
}
