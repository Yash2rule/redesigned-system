"use client";

import { useEffect, useRef } from "react";
import { trackClient } from "../client.ts";

/**
 * Fires `page_view` once per mount. The ref guard is not optional: React
 * Strict Mode double-invokes effects in development and would otherwise
 * double-count every visitor.
 */
export function PageView({ path }: { path?: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackClient("page_view", {
      path: path ?? window.location.pathname,
      referrer: document.referrer || null,
    });
  }, [path]);
  return null;
}
