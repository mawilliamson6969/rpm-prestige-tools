/**
 * AppFolio Database API — showings.
 */

export function listShowings(client, params) {
  return client.get("/showings", params);
}

export function getShowing(client, id) {
  return client.get(`/showings/${encodeURIComponent(id)}`);
}

export function createShowing(client, body) {
  return client.post("/showings", body);
}

export function updateShowing(client, id, body) {
  return client.patch(`/showings/${encodeURIComponent(id)}`, body);
}

export function deleteShowing(client, id) {
  return client.delete(`/showings/${encodeURIComponent(id)}`);
}
