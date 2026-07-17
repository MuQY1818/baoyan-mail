import {
  Bookmark,
  BookmarkCheck,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Plus
} from "lucide-react";
import React from "react";
import type { DdlItem } from "../types";
import { formatRelevance, getAreaClass, getItemAreas, truncate } from "../utils/ddl";

export const DdlCard = React.memo(function DdlCard({
  addedToApplications,
  favorite,
  highlighted,
  item,
  onAddApplication,
  onOpenApplication,
  onToggleFavorite,
  onToggleRead,
  read
}: {
  addedToApplications: boolean;
  favorite: boolean;
  highlighted: boolean;
  item: DdlItem;
  onAddApplication: (item: DdlItem) => void;
  onOpenApplication: (item: DdlItem) => void;
  onToggleFavorite: (key: string) => void;
  onToggleRead: (key: string) => void;
  read: boolean;
}): React.ReactElement {
  const classes = ["notice-card"];
  if (item.status === "today") {
    classes.push("notice-card-urgent");
  }
  if (highlighted) {
    classes.push("notice-card-flash");
  }
  if (read) {
    classes.push("notice-card-read");
  }
  return (
    <li className={classes.join(" ")} id={`ddl-${item.key}`}>
      <div className="date-block" aria-label={item.remainingText}>
        <strong>{item.status === "today" ? "今日" : item.remainingDays}</strong>
        <span>{item.status === "today" ? "截止" : "天后"}</span>
      </div>
      <article>
        <div className="card-head">
          <div>
            <h2>
              <a href={item.website} rel="noreferrer" target="_blank">{item.school}</a>
            </h2>
            <p>{item.institute || "未提供院系"}</p>
          </div>
          <div className="card-badges">
            <span className={`activity-badge activity-${item.activityType}`}>
              {item.activityTypeLabel}
            </span>
            <span className="tier-badge">{item.tier}</span>
          </div>
        </div>
        <AreaBadges item={item} />
        <div className="relevance-line">
          <span className={`relevance-badge relevance-${item.relevance}`}>
            {formatRelevance(item.relevance)}
          </span>
          {item.relevanceReason !== null && item.relevanceReason !== "" && (
            <span className="relevance-reason">{truncate(item.relevanceReason, 48)}</span>
          )}
        </div>
        <dl className="meta-grid">
          <div>
            <dt>截止时间</dt>
            <dd>{item.deadlineText}</dd>
          </div>
          <div>
            <dt>来源</dt>
            <dd>{item.sourceLabel}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{item.remainingText}</dd>
          </div>
        </dl>
        {item.description !== "" && <p className="description">{truncate(item.description, 96)}</p>}
        <div className="card-actions">
          <a className="source-link" href={item.website} rel="noreferrer" target="_blank">
            <ExternalLink aria-hidden="true" size={16} />
            官方通知
          </a>
          <button
            aria-label={favorite ? "取消收藏" : "收藏"}
            aria-pressed={favorite}
            className="icon-action compact-icon-action"
            onClick={() => onToggleFavorite(item.key)}
            title={favorite ? "取消收藏" : "收藏"}
            type="button"
          >
            {favorite ? <BookmarkCheck aria-hidden="true" size={17} /> : <Bookmark aria-hidden="true" size={17} />}
            <span>{favorite ? "已收藏" : "收藏"}</span>
          </button>
          <button
            aria-label={read ? "标记为未读" : "标记为已读"}
            aria-pressed={read}
            className="icon-action compact-icon-action"
            onClick={() => onToggleRead(item.key)}
            title={read ? "标记为未读" : "标记为已读"}
            type="button"
          >
            {read ? <EyeOff aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
            <span>{read ? "已读" : "标为已读"}</span>
          </button>
          <button
            className={addedToApplications ? "icon-action application-action application-action-added" : "icon-action application-action"}
            onClick={() => (addedToApplications ? onOpenApplication(item) : onAddApplication(item))}
            type="button"
          >
            {addedToApplications ? <Check aria-hidden="true" size={17} /> : <Plus aria-hidden="true" size={17} />}
            {addedToApplications ? "已加入申请" : "加入申请"}
          </button>
        </div>
      </article>
    </li>
  );
});

function AreaBadges({ item }: { item: DdlItem }): React.ReactElement {
  return (
    <div className="area-badges" aria-label="方向分类">
      {getItemAreas(item).map((area) => (
        <span className={`area-badge ${getAreaClass(area)}`} key={area}>{area}</span>
      ))}
    </div>
  );
}
