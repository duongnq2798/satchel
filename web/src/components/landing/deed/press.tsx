"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

/** A waiting mark presses in once it is 12% above the window's bottom, well in view. */
const IN_VIEW = { rootMargin: "0px 0px -12% 0px" };

/**
 * Presses in the stamp inside it (press="mount"), one that mounts after the page has loaded, such as
 * a verdict that arrives with its report: at once if its top is above the window's bottom, else once
 * it scrolls into view, as StampPress does. It runs before the browser paints, so the stamp never
 * shows unpressed first. Under reduced motion or without IntersectionObserver it is simply there.
 */
export function PressIn({ children }: { children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const mark = box.current?.querySelector('[data-ink="mount"]');
    if (!mark || matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const press = () => {
      mark.classList.remove("deed-wait");
      mark.classList.add("deed-inked");
    };
    if (mark.getBoundingClientRect().top < innerHeight) {
      press();
      return;
    }
    mark.classList.add("deed-wait");
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      press();
    }, IN_VIEW);
    observer.observe(mark);
    return () => {
      observer.disconnect();
      mark.classList.remove("deed-wait");
    };
  }, []);
  return (
    <span ref={box} className="contents">
      {children}
    </span>
  );
}

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
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove("deed-wait");
        entry.target.classList.add("deed-inked");
        observer.unobserve(entry.target);
      }
    }, IN_VIEW);
    for (const mark of document.querySelectorAll('[data-ink="scroll"]')) {
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
