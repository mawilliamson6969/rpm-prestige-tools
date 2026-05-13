/**
 * AppFolio Database API — owners.
 */

export function listOwners(client, params) {
  return client.get("/owners", params);
}

export function getOwner(client, id) {
  return client.get(`/owners/${encodeURIComponent(id)}`);
}

export function createOwner(client, body) {
  return client.post("/owners", body);
}

export function updateOwner(client, id, body) {
  return client.patch(`/owners/${encodeURIComponent(id)}`, body);
}

export function deleteOwner(client, id) {
  return client.delete(`/owners/${encodeURIComponent(id)}`);
}

export function addOwnerNote(client, id, body) {
  return client.post(`/owners/${encodeURIComponent(id)}/notes`, body);
}
