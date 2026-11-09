import { describe, expect, it } from "vitest";
import { limiter } from "./limit.js";

describe("limiter", () => {
  it("runs at most n tasks at once and all of them in the end", async () => {
    const limit = limiter(2);
    let running = 0;
    let most = 0;
    const task = (i: number) =>
      limit(async () => {
        running++;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return i;
      });
    expect(await Promise.all([1, 2, 3, 4, 5].map(task))).toEqual([1, 2, 3, 4, 5]);
    expect(most).toBe(2);
  });

  it("frees the slot when a task fails", async () => {
    const limit = limiter(1);
    await expect(limit(async () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(await limit(async () => "next")).toBe("next");
  });
});
