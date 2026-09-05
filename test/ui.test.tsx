// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPLICATION_TRACKER_STORAGE_KEY, createApplicationRecord, createEmptyTrackerData } from "../web/applicationTracker";
import { useApplicationTracker } from "../web/hooks/useApplicationTracker";
import { useDdlData } from "../web/hooks/useDdlData";
import { persistApplicationData, readStoredApplicationData } from "../web/utils/applicationStorage";
import { DeadlineTrust, displayDeadline } from "../web/components/DeadlineTrust";
import { ApplicationCalendar } from "../web/components/applications/ApplicationCalendar";
import { ApplicationEditor } from "../web/components/applications/ApplicationEditor";
import { AgentDataPanel } from "../web/components/applications/AgentDataPanel";
import { App } from "../web/main";
import type { DdlItem, DdlResponse } from "../web/types";

vi.mock("../web/utils/analytics", () => ({ sendDailyVisitPing: () => undefined }));
vi.mock("../web/components/AnalyticsPanel", () => ({ AnalyticsPanel: () => null }));
vi.mock("../web/components/ApiHint", () => ({ ApiHint: () => null }));

const item: DdlItem = {
  key: "one", school: "第一测试大学", institute: "计算机与人工智能及交叉信息研究学院（长院系名测试）", description: "2027预推免",
  deadlineAt: "2099-09-10T15:59:59Z", deadlineText: "2099-09-10 23:59:59", remainingDays: 5, remainingText: "5天后", status: "future",
  tier: "985", relevance: "strong", relevanceReason: null, relevanceClassifier: "test", relevanceClassifiedAt: null,
  activityType: "pre_recommendation", activityTypeLabel: "预推免", activityTypeSource: "classification", activityTypeReason: null,
  activityTypeClassifier: "test", activityTypeClassifiedAt: null, sourceGroup: "xingkebaoyan", sourceLabel: "星刻保研", sourceGroups: ["xingkebaoyan"],
  sourceLabels: ["星刻保研"], sourceCount: 1, mergeReason: "single", deadlinePrecision: "date", deadlineConflict: false, deadlineSource: "xingkebaoyan",
  officialVerifiedAt: null, website: "https://example.test/notice", firstSeenAt: null, updatedAt: null, lastSeenAt: null, missingSince: null, sourceVisibility: "current"
};
const response: DdlResponse = { ok: true, generatedAt: new Date().toISOString(), lastSyncedAt: new Date().toISOString(), timezone: "Asia/Shanghai",
  total: 2, staleCount: 0, graceHours: 48, sourceStats: [], items: [item, { ...item, key: "two", school: "第二测试大学", activityType: "summer_camp", activityTypeLabel: "夏令营", relevance: "possible" }] };
beforeEach(() => {
  localStorage.clear(); window.history.replaceState(null, "", "/");
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(response)));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("申请存储", () => {
  it("损坏内容在读取和Agent写入时都不被替换", () => {
    localStorage.setItem(APPLICATION_TRACKER_STORAGE_KEY, "broken-original");
    expect(() => readStoredApplicationData()).toThrow();
    expect(() => persistApplicationData(createEmptyTrackerData())).toThrow();
    expect(localStorage.getItem(APPLICATION_TRACKER_STORAGE_KEY)).toBe("broken-original");
  });
  it("存储失败返回false，内存也不伪装为已保存", () => {
    const { result } = renderHook(useApplicationTracker);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceeded"); });
    let saved = true;
    act(() => { saved = result.current[1]({ ...createEmptyTrackerData(), records: [createApplicationRecord(item)] }); });
    expect(saved).toBe(false); expect(result.current[0].records).toHaveLength(0); expect(result.current[2]?.message).toContain("QuotaExceeded");
  });
  it("同一渲染周期连续保存不丢记录", () => {
    const { result } = renderHook(useApplicationTracker);
    act(() => {
      result.current[1]((data) => ({ ...data, records: [...data.records, createApplicationRecord(item)] }));
      result.current[1]((data) => ({ ...data, records: [...data.records, { ...createApplicationRecord({ ...item, key: "two" }), id: "second" }] }));
    });
    expect(readStoredApplicationData().records).toHaveLength(2);
  });
  it("其他页面更新后拒绝覆盖", () => {
    const { result } = renderHook(useApplicationTracker);
    localStorage.setItem(APPLICATION_TRACKER_STORAGE_KEY, JSON.stringify({ ...createEmptyTrackerData(), updatedAt: "changed" }));
    act(() => { expect(result.current[1](createEmptyTrackerData())).toBe(false); });
    expect(result.current[2]?.message).toContain("其他页面");
  });
  it("编辑器保存失败仍保留草稿和未保存状态", async () => {
    render(<ApplicationEditor record={createApplicationRecord(item)} onClose={vi.fn()} onRemoveRecord={vi.fn()} onUpdateRecord={() => false} />);
    const notes = screen.getByPlaceholderText("记录导师、材料要求、面试准备和结果。");
    fireEvent.change(notes, { target: { value: "尚未保存的草稿" } });
    await userEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(screen.getByText(/保存失败，草稿已保留/)).toBeTruthy();
    expect((notes as HTMLTextAreaElement).value).toBe("尚未保存的草稿");
    expect((screen.getByRole("button", { name: "保存修改" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("删除写入失败不关闭编辑器", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true); const onClose = vi.fn();
    render(<ApplicationEditor record={createApplicationRecord(item)} onClose={onClose} onRemoveRecord={() => false} onUpdateRecord={() => true} />);
    await userEvent.click(screen.getByRole("button", { name: "删除申请记录" }));
    expect(onClose).not.toHaveBeenCalled(); expect(screen.getByText(/保存失败/)).toBeTruthy();
  });
  it("损坏的已存在状态不能被默认值覆盖", () => {
    const record = { ...createApplicationRecord(item), status: "corrupted" };
    localStorage.setItem(APPLICATION_TRACKER_STORAGE_KEY, JSON.stringify({ ...createEmptyTrackerData(), records: [record] }));
    expect(() => readStoredApplicationData()).toThrow("status");
  });
  it("日期原生 input 事件可以添加日程，未添加草稿不能假报已保存", async () => {
    const update = vi.fn().mockReturnValue(true);
    render(<ApplicationEditor record={createApplicationRecord(item)} onClose={vi.fn()} onRemoveRecord={() => true} onUpdateRecord={update} />);
    fireEvent.change(screen.getByRole("textbox", { name: "日程名称" }), { target: { value: "测试面试" } });
    await userEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(update).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("尚未添加");
    fireEvent.input(screen.getByLabelText("日程时间"), { target: { value: "2026-09-06T09:00" } });
    await userEvent.click(screen.getByRole("button", { name: "添加日程" }));
    expect(screen.getByText("测试面试")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(update).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ events: expect.arrayContaining([expect.objectContaining({ title: "测试面试" })]) }));
  });
  it("备份导入先预览，写入失败保留内容", async () => {
    const replace = vi.fn().mockReturnValue(false);
    render(<AgentDataPanel data={createEmptyTrackerData()} onReplaceData={replace} />);
    const backup = JSON.stringify({ ...createEmptyTrackerData(), records: [createApplicationRecord(item)] });
    fireEvent.change(screen.getByLabelText("待导入 JSON"), { target: { value: backup } });
    await userEvent.click(screen.getByRole("button", { name: "预览" }));
    expect(replace).not.toHaveBeenCalled(); expect(screen.getByText(/替换当前 0 条/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "确认导入" }));
    expect(screen.getByRole("alert").textContent).toContain("保存失败");
    expect((screen.getByLabelText("待导入 JSON") as HTMLTextAreaElement).value).toBe(backup);
  });
});

describe("截止可信度", () => {
  it("仅日期不展示23:59，历史核验不能冒充有效核验", () => {
    expect(displayDeadline(item)).not.toContain("23:59");
    render(<DeadlineTrust item={{ ...item, deadlinePrecision: "exact", officialVerifiedAt: "2026-01-01" }} />);
    expect(screen.getByText("待官方核验")).toBeTruthy();
  });
  it("来源冲突优先于官方标签", () => {
    render(<DeadlineTrust item={{ ...item, deadlineConflict: true, deadlineSource: "official-verification", officialVerifiedAt: "2026-01-01" }} />);
    expect(screen.getByText("来源冲突")).toBeTruthy();
  });
});

describe("日历", () => {
  function records() {
    const date = new Date(); date.setDate(Math.min(25, date.getDate() + 1));
    return Array.from({ length: 5 }, (_, index) => ({ ...createApplicationRecord(item), id: `record-${index}`, deadlineAt: "",
      events: [{ id: `event-${index}`, type: "interview" as const, title: `面试${index}`, date: date.toISOString(), note: "" }] }));
  }
  it("+N可以展开全部事件", async () => {
    render(<ApplicationCalendar records={records()} activeRecordId={null} onOpenRecord={vi.fn()} onSelectApplications={vi.fn()} />);
    const expand = screen.getByRole("button", { name: /展开全部日程/ });
    await userEvent.click(expand); expect(expand.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelectorAll(".day-event")).toHaveLength(5);
  });
  it("手机默认日程列表", () => {
    vi.stubGlobal("matchMedia", vi.fn((query) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<ApplicationCalendar records={records()} activeRecordId={null} onOpenRecord={vi.fn()} onSelectApplications={vi.fn()} />);
    expect(document.querySelector(".month-card")).toBeNull(); expect(screen.getByRole("button", { name: "月历视图" })).toBeTruthy();
  });
});

describe("项目工作台", () => {
  it("手机筛选面板支持键盘关闭和返回触发点", async () => {
    vi.stubGlobal("matchMedia", vi.fn((query) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<App />); await screen.findByRole("link", { name: "第一测试大学" });
    const trigger = screen.getByRole("button", { name: /^高级筛选$/ });
    await userEvent.click(trigger); expect(screen.getByRole("dialog", { name: "高级筛选条件" })).toBeTruthy();
    await userEvent.keyboard("{Escape}"); expect(screen.queryByRole("dialog")).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
  it("筛选后统计一致，时间线默认收起，切换视图保留", async () => {
    render(<App />); await screen.findByRole("link", { name: "第一测试大学" });
    expect(screen.queryByRole("link", { name: "第二测试大学" })).toBeNull();
    expect(screen.getByRole("button", { name: "展开截止概览" }).getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelectorAll(".ddl-table thead th")).toHaveLength(5);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "没有匹配结果" } });
    await screen.findByText("当前筛选没有结果"); expect(document.querySelector(".result-count")?.textContent).toBe("0");
    expect(screen.queryByText(/条强相关 DDL/)).toBeNull();
  });
  it("收藏按钮保留aria-pressed与本地状态", async () => {
    render(<App />); await screen.findByRole("link", { name: "第一测试大学" });
    await userEvent.click(screen.getByRole("button", { name: /^收藏$/ }));
    expect(screen.getByRole("button", { name: "取消收藏" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("Agent协议保留，损坏存储无法clearAll", async () => {
    localStorage.setItem(APPLICATION_TRACKER_STORAGE_KEY, "broken-data"); render(<App />);
    await waitFor(() => expect(window.BaoyanAgent).toBeDefined());
    act(() => { expect(() => window.BaoyanAgent?.clearAll()).toThrow("写入失败"); });
    expect(localStorage.getItem(APPLICATION_TRACKER_STORAGE_KEY)).toBe("broken-data");
    expect(window.BaoyanAgent?.getSchema().storageKey).toBe(APPLICATION_TRACKER_STORAGE_KEY);
  });
  it("刷新失败不清空已加载数据", async () => {
    const { result } = renderHook(useDdlData); await waitFor(() => expect(result.current.data).not.toBeNull());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failure")));
    await act(() => result.current.refresh()); expect(result.current.data?.items).toHaveLength(2); expect(result.current.error).toContain("network failure");
  });
});
