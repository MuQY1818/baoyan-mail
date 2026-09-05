import { AlertTriangle, CircleHelp, ShieldCheck } from "lucide-react";
import type { DdlItem } from "../types";

export function displayDeadline(item: DdlItem): string {
  if (!item.deadlineAt || item.deadlinePrecision === "unknown") return "截止待确认";
  const date = new Date(item.deadlineAt);
  if (Number.isNaN(date.getTime())) return "截止待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit",
    ...(item.deadlinePrecision === "exact" ? { hour: "2-digit", minute: "2-digit", hour12: false } as const : {})
  }).format(date);
}

export function deadlineConfidence(item: DdlItem): string {
  if (item.deadlineConflict) return "来源冲突";
  if (item.deadlinePrecision === "unknown" || !item.deadlineAt) return "截止待确认";
  if (item.deadlinePrecision === "date") return "仅日期 · 时间待确认";
  if (item.deadlineSource === "official-verification" && item.officialVerifiedAt) return "官方已核验";
  return "待官方核验";
}

export function DeadlineTrust({ item }: { item: DdlItem }) {
  const label = deadlineConfidence(item);
  const verified = label === "官方已核验";
  const Icon = item.deadlineConflict ? AlertTriangle : verified ? ShieldCheck : CircleHelp;
  return <details className={`deadline-trust ${item.deadlineConflict ? "trust-conflict" : verified ? "trust-verified" : "trust-pending"}`}>
    <summary><Icon size={14} aria-hidden="true" />{label}</summary>
    <div className="trust-detail">
      <p>{item.deadlineConflict ? "不同来源的截止时间不一致，当前保留更早安全节点，请打开官方通知核对。" : verified ? "已根据官方内容核验当前截止节点。报名之前请再确认原通知。" : "聚合信息仅供查找项目；未确认的具体时分不会作为已核验时间展示。"}</p>
      <p>来源：{item.sourceLabels?.join("、") || item.sourceLabel}。多源合并不等于官方核验。</p>
    </div>
  </details>;
}
