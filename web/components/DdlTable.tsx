import {
  Bookmark,
  BookmarkCheck,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Plus
} from "lucide-react";
import type React from "react";
import type { DdlItem } from "../types";
import { formatRelevance, getItemAreas } from "../utils/ddl";
import { DeadlineTrust, displayDeadline } from "./DeadlineTrust";

export function DdlTable({
  applicationSourceKeys,
  favorites,
  highlightedKey,
  items,
  onAddApplication,
  onOpenApplication,
  onToggleFavorite,
  onToggleRead,
  readItems
}: {
  applicationSourceKeys: Set<string>;
  favorites: Set<string>;
  highlightedKey: string | null;
  items: DdlItem[];
  onAddApplication: (item: DdlItem) => void;
  onOpenApplication: (item: DdlItem) => void;
  onToggleFavorite: (key: string) => void;
  onToggleRead: (key: string) => void;
  readItems: Set<string>;
}): React.ReactElement {
  return (
    <>
    <p className="table-scroll-hint">表格可左右滚动查看操作，也可切换为卡片视图。</p>
    <div className="table-wrap" tabIndex={0} role="region" aria-label="DDL 项目表格，可左右滚动">
      <table className="ddl-table">
        <thead>
          <tr>
            <th scope="col">项目</th>
            <th scope="col">截止（北京时间）</th>
            <th scope="col">类型</th>
            <th scope="col">可信度</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              className={[
                readItems.has(item.key) ? "table-row-read" : "",
                highlightedKey === item.key ? "table-row-flash" : ""
              ].filter(Boolean).join(" ")}
              id={`ddl-${item.key}`}
              key={item.key}
            >
              <td className="project-cell">
                <a className="table-primary-link" href={item.website} rel="noreferrer" target="_blank">
                  {item.school}
                </a>
                <p className="project-institute">{item.institute || "未提供院系"}</p>
                <span>{item.tier} · {getItemAreas(item).join(" / ") || "方向待确认"} · {formatRelevance(item.relevance)}</span>
              </td>
              <td className={`deadline-cell ${item.status === "today" ? "deadline-urgent" : ""}`}>
                <strong>{displayDeadline(item)}</strong>
                <span>{!item.deadlineAt || item.deadlinePrecision === "unknown" ? "请查看官方通知" : item.deadlinePrecision === "exact" ? item.remainingText : item.status === "today" ? "今日截止，时间待确认" : `${item.remainingDays} 天后（按日期）`}</span>
              </td>
              <td>
                <span className={`table-activity activity-${item.activityType}`}>
                  {item.activityTypeLabel}
                </span>
              </td>
              <td><DeadlineTrust item={item} /></td>
              <td>
                <div className="table-actions">
                  <a aria-label="打开官方通知" href={item.website} rel="noreferrer" target="_blank" title="官方通知">
                    <ExternalLink aria-hidden="true" size={15} />官方通知
                  </a>
                  <button
                    aria-label={favorites.has(item.key) ? "取消收藏" : "收藏"}
                    aria-pressed={favorites.has(item.key)}
                    onClick={() => onToggleFavorite(item.key)}
                    title={favorites.has(item.key) ? "取消收藏" : "收藏"}
                    type="button"
                  >
                    {favorites.has(item.key) ? <BookmarkCheck aria-hidden="true" size={15} /> : <Bookmark aria-hidden="true" size={15} />}
                  </button>
                  <button
                    aria-label={readItems.has(item.key) ? "标记为未读" : "标记为已读"}
                    aria-pressed={readItems.has(item.key)}
                    onClick={() => onToggleRead(item.key)}
                    title={readItems.has(item.key) ? "标记为未读" : "标记为已读"}
                    type="button"
                  >
                    {readItems.has(item.key) ? <EyeOff aria-hidden="true" size={15} /> : <Eye aria-hidden="true" size={15} />}
                  </button>
                  <button
                    aria-label={applicationSourceKeys.has(item.key) ? "打开申请" : "加入申请"}
                    onClick={() =>
                      applicationSourceKeys.has(item.key) ? onOpenApplication(item) : onAddApplication(item)
                    }
                    title={applicationSourceKeys.has(item.key) ? "打开申请" : "加入申请"}
                    type="button"
                  >
                    {applicationSourceKeys.has(item.key) ? <Check aria-hidden="true" size={15} /> : <Plus aria-hidden="true" size={15} />}
                    {applicationSourceKeys.has(item.key) ? "打开申请" : "加入申请"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
