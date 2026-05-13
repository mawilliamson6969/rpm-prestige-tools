/**
 * AppFolio Database API — work orders.
 *
 * Phase 1: endpoints are stubbed against the documented v0 paths. Adjust
 * paths once we have live credentials and the OpenAPI spec — the wrapper
 * abstraction means call sites won't change.
 */

export function listWorkOrders(client, params) {
  return client.get("/work_orders", params);
}

export function getWorkOrder(client, id) {
  return client.get(`/work_orders/${encodeURIComponent(id)}`);
}

export function createWorkOrder(client, body) {
  return client.post("/work_orders", body);
}

export function updateWorkOrder(client, id, body) {
  return client.patch(`/work_orders/${encodeURIComponent(id)}`, body);
}

export function addWorkOrderNote(client, id, body) {
  return client.post(`/work_orders/${encodeURIComponent(id)}/notes`, body);
}

export function addWorkOrderAttachment(client, id, body) {
  return client.post(`/work_orders/${encodeURIComponent(id)}/attachments`, body);
}
