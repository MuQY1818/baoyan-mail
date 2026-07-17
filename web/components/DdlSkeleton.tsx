import type React from "react";

export function DdlSkeleton(): React.ReactElement {
  // 卡片骨架屏:加载时给出版面预期,比纯文字提示更流畅
  return (
    <ol className="notice-list" aria-label="正在加载 DDL 数据" aria-busy="true">
      {[0, 1, 2, 3].map((index) => (
        <li className="skeleton-card" key={index}>
          <div className="skeleton-date sk-shimmer" />
          <div className="skeleton-body">
            <div className="skeleton-line sk-shimmer" style={{ width: "42%", height: 18 }} />
            <div className="skeleton-line sk-shimmer" style={{ width: "26%" }} />
            <div className="skeleton-chips">
              <span className="skeleton-pill sk-shimmer" />
              <span className="skeleton-pill sk-shimmer" />
              <span className="skeleton-pill sk-shimmer" />
            </div>
            <div className="skeleton-grid">
              <span className="skeleton-box sk-shimmer" />
              <span className="skeleton-box sk-shimmer" />
              <span className="skeleton-box sk-shimmer" />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
