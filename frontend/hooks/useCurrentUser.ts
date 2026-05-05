"use client";

import { useAuth } from "../context/AuthContext";

/**
 * Thin wrapper around AuthContext for the spec-named API.
 *
 *   const { user, can } = useCurrentUser();
 *   if (can('inbox.delete')) { ... }
 *
 * Prefer this in new code over reading `user.role` directly so future role
 * changes don't require touching every call site.
 */
export default function useCurrentUser() {
  const { user, loading, can } = useAuth();
  return { user, loading, can };
}
