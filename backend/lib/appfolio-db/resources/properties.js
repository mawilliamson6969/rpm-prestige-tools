/**
 * AppFolio Database API — properties.
 */

export function listProperties(client, params) {
  return client.get("/properties", params);
}

export function getProperty(client, id) {
  return client.get(`/properties/${encodeURIComponent(id)}`);
}

export function createProperty(client, body) {
  return client.post("/properties", body);
}

export function updateProperty(client, id, body) {
  return client.patch(`/properties/${encodeURIComponent(id)}`, body);
}

export function deleteProperty(client, id) {
  return client.delete(`/properties/${encodeURIComponent(id)}`);
}

export function addPropertyNote(client, id, body) {
  return client.post(`/properties/${encodeURIComponent(id)}/notes`, body);
}

export function addPropertyPhoto(client, id, body) {
  return client.post(`/properties/${encodeURIComponent(id)}/photos`, body);
}
