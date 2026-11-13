"use client";

import { useEffect } from "react";

/**
 * Presses the deed's stamps and seals in as they scroll into view, and runs the foil's sheen once.
 * Only a mark still wholly below the window when this runs waits for it, hidden: one even partly on
 * screen stays as the server drew it, so nothing on screen blinks. Without JavaScript, under reduced
 * motion or without IntersectionObserver, nothing is hidden and every mark is simply there.
 */
export function StampPress() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const waiting: Element[] = [];
    // A waiting mark presses in once it is 12% above the window's bottom, well in view.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.remove("deed-wait");
          entry.target.classList.add("deed-inked");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    for (const mark of document.querySelectorAll("[data-ink]")) {
      if (mark.getBoundingClientRect().top < innerHeight) continue;
      mark.classList.add("deed-wait");
      waiting.push(mark);
      observer.observe(mark);
    }
    for (const foil of document.querySelectorAll("[data-sheen]")) observer.observe(foil);
    return () => {
      observer.disconnect();
      // A mark nothing watches any more must not stay hidden.
      for (const mark of waiting) mark.classList.remove("deed-wait");
    };
  }, []);
  return null;
}
