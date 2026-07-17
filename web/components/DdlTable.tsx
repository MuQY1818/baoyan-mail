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
import { formatRelevance, getAreaClass, getItemAreas } from "../utils/ddl";

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
    <div className="table-wrap">
      <table className="ddl-table">
        <thead>
          <tr>
            <th>截止时间</th>
            <th>学校</th>
            <th>院系</th>
            <th>类型</th>
            <th>层次</th>
            <th>方向</th>
            <th>相关度</th>
            <th>操作</th>
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
              <td>
                <strong>{item.remainingText}</strong>
                <span>{item.deadlineText}</span>
              </td>
              <td>
                <a className="table-primary-link" href={item.website} rel="noreferrer" target="_blank">
                  {item.school}
                </a>
              </td>
              <td>
                {item.institute || "未提供院系"}
                <span>{item.sourceLabel}</span>
              </td>
              <td>
                <span className={`table-activity activity-${item.activityType}`}>
                  {item.activityTypeLabel}
                </span>
              </td>
              <td>{item.tier}</td>
              <td>
                <div className="table-area-list">
                  {getItemAreas(item).map((area) => (
                    <span className={`table-area ${getAreaClass(area)}`} key={area}>{area}</span>
                  ))}
                </div>
              </td>
              <td>
                <span className={`table-relevance relevance-${item.relevance}`}>
                  {formatRelevance(item.relevance)}
                </span>
              </td>
              <td>
                <div className="table-actions">
                  <a aria-label="打开官方通知" href={item.website} rel="noreferrer" target="_blank" title="官方通知">
                    <ExternalLink aria-hidden="true" size={15} />
                  </a>
                  <button
                    aria-label={favorites.has(item.key) ? "取消收藏" : "收藏"}
                    onClick={() => onToggleFavorite(item.key)}
                    title={favorites.has(item.key) ? "取消收藏" : "收藏"}
                    type="button"
                  >
                    {favorites.has(item.key) ? <BookmarkCheck aria-hidden="true" size={15} /> : <Bookmark aria-hidden="true" size={15} />}
                  </button>
                  <button
                    aria-label={readItems.has(item.key) ? "标记为未读" : "标记为已读"}
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
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
