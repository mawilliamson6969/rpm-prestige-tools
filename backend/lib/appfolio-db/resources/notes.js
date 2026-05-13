/**
 * AppFolio Database API — generic note creation.
 *
 * Most resources support POST /:resource/:id/notes. This helper centralizes
 * the URL construction so call sites don't repeat themselves and the path
 * shape can be adjusted in one place if the live spec differs.
 */

const RESOURCE_PATHS = {
  work_orders: "work_orders",
  tenants: "tenants",
  leases: "leases",
  properties: "properties",
  owners: "owners",
  vendors: "vendors",
  leads: "leads",
  showings: "showings",
  rental_applications: "rental_applications",
  inspections: "inspections",
};

/**
 * Create a note on any supported AppFolio resource.
 *
 * @param client    AppFolioDBClient
 * @param resource  Resource type key (e.g. "work_orders").
 * @param id        Resource id.
 * @param body      { body: string, note_type?: string, attached_to_user?: string }
 */
export function createNote(client, resource, id, body) {
  const path = RESOURCE_PATHS[resource];
  if (!path) {
    throw new Error(`Notes not supported for resource type: ${resource}`);
  }
  return client.post(`/${path}/${encodeURIComponent(id)}/notes`, body);
}
