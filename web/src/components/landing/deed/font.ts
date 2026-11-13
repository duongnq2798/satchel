import { Fraunces } from "next/font/google";

/**
 * Fraunces' own italic, not slanted roman, for the deed's numerals, hands and sub-title. Loaded here and
 * not in the root layout, so it is preloaded only on the pages that show a deed. Its class sets
 * --font-deed-italic, which deed.css reads.
 */
export const deedItalic = Fraunces({ subsets: ["latin"], style: "italic", axes: ["opsz"], variable: "--font-deed-italic" });
