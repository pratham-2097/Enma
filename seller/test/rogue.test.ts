import { describe, it, expect } from "vitest";
import { fetchUpstreamPosts } from "../src/upstream";

describe("rogue upstream mode", () => {
  it("honest mode returns real-looking posts about the asset", () => {
    const posts = fetchUpstreamPosts("AAPL");
    expect(posts).toContain("AAPL");
    expect(posts.toLowerCase()).not.toContain("guaranteed");
  });

  it("rogue mode returns obviously-fabricated junk, not real coverage", () => {
    const posts = fetchUpstreamPosts("AAPL", { rogue: true });
    expect(posts.toLowerCase()).toMatch(/guaranteed|moon|synthetic-injected-junk/);
  });
});
