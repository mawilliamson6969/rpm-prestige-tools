"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Small HTML5-drag-based reorder helper. We deliberately do not pull in
 * @dnd-kit — for a column/group list of typically < 30 rows, native
 * draggable + onDragOver works fine. Keyboard accessibility is provided
 * separately by the up/down arrow buttons in the parent component
 * (see EditBoardDrawer.tsx).
 */
export function useReorder<T extends { id: number }>(
  items: T[],
  onCommit: (orderedIds: number[]) => Promise<void> | void
) {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const orderRef = useRef<T[]>(items);
  orderRef.current = items;

  const startDrag = useCallback((id: number) => {
    setDraggingId(id);
  }, []);

  const enterTarget = useCallback((id: number) => {
    setDropTargetId(id);
  }, []);

  const endDrag = useCallback(async () => {
    const fromId = draggingId;
    const toId = dropTargetId;
    setDraggingId(null);
    setDropTargetId(null);
    if (fromId == null || toId == null || fromId === toId) return;
    const current = orderRef.current;
    const fromIdx = current.findIndex((x) => x.id === fromId);
    const toIdx = current.findIndex((x) => x.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...current];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    await onCommit(next.map((x) => x.id));
  }, [draggingId, dropTargetId, onCommit]);

  const cancelDrag = useCallback(() => {
    setDraggingId(null);
    setDropTargetId(null);
  }, []);

  const moveBy = useCallback(
    async (id: number, delta: number) => {
      const current = orderRef.current;
      const idx = current.findIndex((x) => x.id === id);
      if (idx < 0) return;
      const target = idx + delta;
      if (target < 0 || target >= current.length) return;
      const next = [...current];
      const [moved] = next.splice(idx, 1);
      next.splice(target, 0, moved);
      await onCommit(next.map((x) => x.id));
    },
    [onCommit]
  );

  return {
    draggingId,
    dropTargetId,
    startDrag,
    enterTarget,
    endDrag,
    cancelDrag,
    moveBy,
  };
}
