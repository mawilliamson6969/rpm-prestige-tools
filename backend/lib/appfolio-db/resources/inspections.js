/**
 * AppFolio Database API — inspections.
 */

export function listInspections(client, params) {
  return client.get("/inspections", params);
}

export function getInspection(client, id) {
  return client.get(`/inspections/${encodeURIComponent(id)}`);
}

export function createInspection(client, body) {
  return client.post("/inspections", body);
}

export function updateInspection(client, id, body) {
  return client.patch(`/inspections/${encodeURIComponent(id)}`, body);
}

export function deleteInspection(client, id) {
  return client.delete(`/inspections/${encodeURIComponent(id)}`);
}
