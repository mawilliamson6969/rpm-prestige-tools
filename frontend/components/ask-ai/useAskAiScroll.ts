import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

const BOTTOM_THRESHOLD_PX = 80;

/**
 * Scroll the thread to the bottom when new content arrives, unless the user
 * has scrolled up to read earlier messages.
 */
export function useAskAiScroll(messagesLength: number, loading: boolean, lastMessageId: string | undefined) {
  /** Writable ref (avoid RefObject readonly `current` in some React type versions). */
  const scrollRef = useRef<HTMLDivElement | null>(null) as MutableRefObject<HTMLDivElement | null>;
  const bottomRef = useRef<HTMLDivElement>(null);
  const userPinnedToBottomRef = useRef(true);

  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  const scrollRefCallback = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setScrollEl(node);
  }, []);

  const checkPinned = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userPinnedToBottomRef.current = distanceFromBottom <= BOTTOM_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    const el = scrollEl;
    if (!el) return;
    const onScroll = () => checkPinned();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollEl, checkPinned]);

  useEffect(() => {
    if (!userPinnedToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messagesLength, loading, lastMessageId]);

  return { scrollRef: scrollRefCallback, bottomRef, checkPinned };
}
