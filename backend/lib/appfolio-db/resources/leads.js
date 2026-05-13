/**
 * AppFolio Database API — leads (guest cards).
 */

export function listLeads(client, params) {
  return client.get("/leads", params);
}

export function getLead(client, id) {
  return client.get(`/leads/${encodeURIComponent(id)}`);
}

export function createLead(client, body) {
  return client.post("/leads", body);
}

export function updateLead(client, id, body) {
  return client.patch(`/leads/${encodeURIComponent(id)}`, body);
}

export function deleteLead(client, id) {
  return client.delete(`/leads/${encodeURIComponent(id)}`);
}
