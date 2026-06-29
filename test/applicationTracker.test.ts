import { describe, expect, it } from "vitest";
import {
  APPLICATION_PATCH_SCHEMA,
  addOrReplaceApplicationRecord,
  applyApplicationPatch,
  createAgentPatchFromOperation,
  createApplicationRecord,
  createEmptyTrackerData,
  getApplicationRecord,
  hydrateApplicationRecordLinks,
  parseApplicationPatch,
  previewApplicationPatch,
  updateApplicationRecord
} from "../web/applicationTracker";

const SOURCE_ITEM = {
  key: "ddl-1",
  school: "测试大学",
  institute: "计算机学院",
  website: "https://example.com/notice",
  deadlineAt: "2026-07-01T15:59:00.000Z",
  deadlineText: "2026/07/01 23:59",
  tier: "985",
  areas: ["计算机"],
  relevance: "strong"
};

describe("application tracker", () => {
  it("creates a local application record from a DDL item", () => {
    const record = createApplicationRecord(SOURCE_ITEM, "2026-06-27T00:00:00.000Z");

    expect(record.sourceDdlKey).toBe("ddl-1");
    expect(record.school).toBe("测试大学");
    expect(record.status).toBe("watching");
    expect(record.priority).toBe("target");
    expect(record.result).toBe("pending");
    expect(record.materials.map((material) => material.label)).toContain("成绩单");
    expect(record.events[0]?.type).toBe("deadline");
  });

  it("deduplicates records by id and source DDL key", () => {
    const record = createApplicationRecord(SOURCE_ITEM, "2026-06-27T00:00:00.000Z");
    const first = addOrReplaceApplicationRecord(createEmptyTrackerData(), record, "2026-06-27T00:00:00.000Z");
    const second = addOrReplaceApplicationRecord(first, record, "2026-06-27T01:00:00.000Z");

    expect(second.records).toHaveLength(1);
    expect(second.records[0]?.updatedAt).toBe("2026-06-27T01:00:00.000Z");
  });

  it("hydrates missing source links from archived DDL items", () => {
    const record = {
      ...createApplicationRecord({ ...SOURCE_ITEM, website: "" }, "2026-06-27T00:00:00.000Z"),
      sourceDdlKey: "missing-from-current-api"
    };
    const data = addOrReplaceApplicationRecord(createEmptyTrackerData(), record, "2026-06-27T00:00:00.000Z");

    const hydrated = hydrateApplicationRecordLinks(
      data,
      [
        {
          key: "different-key",
          school: "测试大学",
          institute: "计算机学院",
          website: "https://example.com/archived-notice",
          deadlineAt: "2026-07-01T15:59:00.000Z"
        }
      ],
      "2026-06-29T00:00:00.000Z"
    );

    expect(hydrated.records[0]?.website).toBe("https://example.com/archived-notice");
    expect(hydrated.updatedAt).toBe("2026-06-29T00:00:00.000Z");
  });

  it("hydrates source links when local institute names are shortened", () => {
    const source = {
      ...SOURCE_ITEM,
      key: "local-short-name",
      school: "西安交通大学",
      institute: "软件学院夏令营",
      website: "",
      deadlineAt: "2026-06-15T15:59:00.000Z",
      deadlineText: "2026/06/15 23:59"
    };
    const record = createApplicationRecord(source, "2026-06-27T00:00:00.000Z");
    const data = addOrReplaceApplicationRecord(createEmptyTrackerData(), record, "2026-06-27T00:00:00.000Z");

    const hydrated = hydrateApplicationRecordLinks(
      data,
      [
        {
          key: "archive-long-name",
          school: "西安交通大学",
          institute: "电信学部—软件学院",
          website: "https://example.com/xjtu-software",
          deadlineAt: "2026-06-15T15:59:00.000Z"
        }
      ],
      "2026-06-29T00:00:00.000Z"
    );

    expect(hydrated.records[0]?.website).toBe("https://example.com/xjtu-software");
  });

  it("does not overwrite existing source links while hydrating", () => {
    const record = createApplicationRecord(SOURCE_ITEM, "2026-06-27T00:00:00.000Z");
    const data = addOrReplaceApplicationRecord(createEmptyTrackerData(), record, "2026-06-27T00:00:00.000Z");

    const hydrated = hydrateApplicationRecordLinks(
      data,
      [
        {
          key: "ddl-1",
          school: "测试大学",
          institute: "计算机学院",
          website: "https://example.com/new-notice",
          deadlineAt: "2026-07-01T15:59:00.000Z"
        }
      ],
      "2026-06-29T00:00:00.000Z"
    );

    expect(hydrated.records[0]?.website).toBe("https://example.com/notice");
    expect(hydrated.updatedAt).toBe("2026-06-27T00:00:00.000Z");
  });

  it("previews a valid Agent patch without mutating original data", () => {
    const record = createApplicationRecord(SOURCE_ITEM, "2026-06-27T00:00:00.000Z");
    const data = addOrReplaceApplicationRecord(createEmptyTrackerData(), record, "2026-06-27T00:00:00.000Z");
    const patch = parseApplicationPatch({
      schema: APPLICATION_PATCH_SCHEMA,
      operations: [
        { op: "update", id: record.id, values: { status: "submitted" } },
        { op: "update_material", id: record.id, materialId: "resume", status: "done" },
        { op: "append_note", id: record.id, note: "已投递系统" }
      ]
    });

    const preview = previewApplicationPatch(data, patch, "2026-06-27T02:00:00.000Z");

    expect(preview.errors).toEqual([]);
    expect(preview.appliedCount).toBe(3);
    expect(preview.nextData.records[0]?.status).toBe("submitted");
    expect(preview.nextData.records[0]?.materials.find((material) => material.id === "resume")?.status).toBe("done");
    expect(preview.nextData.records[0]?.notes).toContain("已投递系统");
    expect(data.records[0]?.status).toBe("watching");
  });

  it("rejects invalid patch operations", () => {
    const record = createApplicationRecord(SOURCE_ITEM, "2026-06-27T00:00:00.000Z");
    const data = addOrReplaceApplicationRecord(createEmptyTrackerData(), record, "2026-06-27T00:00:00.000Z");
    const patch = parseApplicationPatch({
      schema: APPLICATION_PATCH_SCHEMA,
      operations: [{ op: "update", id: record.id, values: { status: "bad" } }]
    });

    const preview = previewApplicationPatch(data, patch, "2026-06-27T02:00:00.000Z");

    expect(preview.appliedCount).toBe(0);
    expect(preview.errors[0]).toContain("status");
  });

  it("updates editable application fields", () => {
    const record = createApplicationRecord(SOURCE_ITEM, "2026-06-27T00:00:00.000Z");
    const data = addOrReplaceApplicationRecord(createEmptyTrackerData(), record, "2026-06-27T00:00:00.000Z");
    const updated = updateApplicationRecord(
      data,
      record.id,
      { priority: "rush", result: "accepted" },
      "2026-06-27T03:00:00.000Z"
    );

    expect(updated.records[0]?.priority).toBe("rush");
    expect(updated.records[0]?.result).toBe("accepted");
    expect(updated.records[0]?.updatedAt).toBe("2026-06-27T03:00:00.000Z");
  });

  it("supports Agent-style get and single-operation patch helpers", () => {
    const record = createApplicationRecord(SOURCE_ITEM, "2026-06-27T00:00:00.000Z");
    const data = addOrReplaceApplicationRecord(createEmptyTrackerData(), record, "2026-06-27T00:00:00.000Z");
    const patch = createAgentPatchFromOperation({
      op: "append_note",
      id: record.id,
      note: "Agent 追加备注"
    });

    const result = applyApplicationPatch(data, patch, "2026-06-27T04:00:00.000Z");

    expect(getApplicationRecord(data, record.id)?.school).toBe("测试大学");
    expect(result.errors).toEqual([]);
    expect(result.data.records[0]?.notes).toContain("Agent 追加备注");
  });
});
