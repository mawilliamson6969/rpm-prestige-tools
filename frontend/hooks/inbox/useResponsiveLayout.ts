"use client";

import { useCallback, useEffect, useState } from "react";

const MOBILE_QUERY = "(max-width: 900px)";

export type ResponsiveLayout = {
  isMobile: boolean;
  /** Mobile-only: sidebar drawer open. */
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  /** Mobile-only: detail panel open (covering the list). */
  detailOpen: boolean;
  setDetailOpen: (v: boolean) => void;
  /** Convenience: switches to detail view if on mobile. */
  showDetailIfMobile: () => void;
};

export default function useResponsiveLayout(): ResponsiveLayout {
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const fn = () => setIsMobile(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  const showDetailIfMobile = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches) {
      setDetailOpen(true);
    }
  }, []);

  return {
    isMobile,
    sidebarOpen,
    setSidebarOpen,
    detailOpen,
    setDetailOpen,
    showDetailIfMobile,
  };
}
