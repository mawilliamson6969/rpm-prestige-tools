"use client";

import { useEffect, useState } from "react";

const QUERY = "(max-width: 768px)";

/** True when viewport matches mobile sidebar breakpoint. */
export function useNarrowScreen() {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return narrow;
}
