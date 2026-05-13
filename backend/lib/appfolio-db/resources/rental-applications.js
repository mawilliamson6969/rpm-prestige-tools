/**
 * AppFolio Database API — rental applications.
 */

export function listRentalApplications(client, params) {
  return client.get("/rental_applications", params);
}

export function getRentalApplication(client, id) {
  return client.get(`/rental_applications/${encodeURIComponent(id)}`);
}

export function createRentalApplication(client, body) {
  return client.post("/rental_applications", body);
}

export function updateRentalApplication(client, id, body) {
  return client.patch(`/rental_applications/${encodeURIComponent(id)}`, body);
}

export function deleteRentalApplication(client, id) {
  return client.delete(`/rental_applications/${encodeURIComponent(id)}`);
}
