import { describe, expect, it } from "vitest";
import { detectChanges } from "../src/checker";
import { normalizeSourceData } from "../src/source";
import { isValidEmail } from "../src/routes";

describe("source normalization", () => {
  it("flattens grouped CS-BAOYAN records", async () => {
    const items = await normalizeSourceData({
      camp2026: [
        {
          name: "北京大学",
          institute: "计算机学院",
          description: "夏令营",
          deadline: "2026-06-01T00:00:00+08:00",
          website: "https://example.com/a",
          tags: ["TOP2", "985"]
        }
      ]
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceGroup: "camp2026",
      name: "北京大学",
      institute: "计算机学院",
      tags: ["TOP2", "985"]
    });
    expect(items[0]?.key).toMatch(/^[a-f0-9]{64}$/);
    expect(items[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("detects added and changed records", async () => {
    const [original] = await normalizeSourceData({
      camp2026: [
        {
          name: "南京大学",
          institute: "计算机学院",
          description: "夏令营",
          deadline: "2026-06-01T00:00:00+08:00",
          website: "https://example.com/a",
          tags: ["C9"]
        }
      ]
    });
    const [changed] = await normalizeSourceData({
      camp2026: [
        {
          name: "南京大学",
          institute: "计算机学院",
          description: "夏令营",
          deadline: "2026-06-03T00:00:00+08:00",
          website: "https://example.com/a",
          tags: ["C9"]
        }
      ]
    });

    expect(original).toBeDefined();
    expect(changed).toBeDefined();
    const changes = detectChanges([changed!], new Map([[original!.key, { content_hash: original!.contentHash }]]));

    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe("changed");
  });
});

describe("email validation", () => {
  it("accepts ordinary email addresses", () => {
    expect(isValidEmail("student@example.com")).toBe(true);
  });

  it("rejects invalid email addresses", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });
});
