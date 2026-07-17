import { CalendarDays, ClipboardList, ListFilter } from "lucide-react";
import type React from "react";
import type { MainTab } from "../types";
import { formatGeneratedAt } from "../utils/datetime";

export function AppHeader({
  activeTab,
  applicationCount,
  ddlCount,
  lastSyncedAt,
  onSelect
}: {
  activeTab: MainTab;
  applicationCount: number;
  ddlCount: number;
  lastSyncedAt: string | undefined;
  onSelect: (tab: MainTab) => void;
}): React.ReactElement {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <button className="brand" onClick={() => onSelect("ddl")} type="button">
          <span className="brand-mark" aria-hidden="true">DDL</span>
          <span className="brand-copy">
            <strong>保研进度台</strong>
            <small>发现、规划、跟进</small>
          </span>
        </button>
        <MainTabs
          activeTab={activeTab}
          applicationCount={applicationCount}
          ddlCount={ddlCount}
          onSelect={onSelect}
        />
        <span className="updated header-updated">{formatGeneratedAt(lastSyncedAt)}</span>
      </div>
    </header>
  );
}

function MainTabs({
  activeTab,
  applicationCount,
  ddlCount,
  onSelect
}: {
  activeTab: MainTab;
  applicationCount: number;
  ddlCount: number;
  onSelect: (tab: MainTab) => void;
}): React.ReactElement {
  const tabs = buildMainTabs(ddlCount, applicationCount);
  return (
    <nav className="main-tabs desktop-tabs" aria-label="平台功能">
      {tabs.map((tab) => (
        <button
          className={activeTab === tab.value ? "main-tab main-tab-active" : "main-tab"}
          key={tab.value}
          onClick={() => onSelect(tab.value)}
          type="button"
        >
          <NavigationIcon tab={tab.value} />
          <span>{tab.label}</span>
          {tab.count > 0 && <strong>{tab.count}</strong>}
        </button>
      ))}
    </nav>
  );
}

export function MobileNavigation({
  activeTab,
  applicationCount,
  ddlCount,
  onSelect
}: {
  activeTab: MainTab;
  applicationCount: number;
  ddlCount: number;
  onSelect: (tab: MainTab) => void;
}): React.ReactElement {
  return (
    <nav className="mobile-navigation" aria-label="平台功能">
      {buildMainTabs(ddlCount, applicationCount).map((tab) => (
        <button
          aria-current={activeTab === tab.value ? "page" : undefined}
          className={activeTab === tab.value ? "mobile-nav-item mobile-nav-item-active" : "mobile-nav-item"}
          key={tab.value}
          onClick={() => onSelect(tab.value)}
          type="button"
        >
          <span className="mobile-nav-icon">
            <NavigationIcon tab={tab.value} />
            {tab.value === "applications" && tab.count > 0 && <em>{tab.count}</em>}
          </span>
          <span>{tab.mobileLabel}</span>
        </button>
      ))}
    </nav>
  );
}

function buildMainTabs(
  ddlCount: number,
  applicationCount: number
): Array<{ value: MainTab; label: string; mobileLabel: string; count: number }> {
  return [
    { value: "ddl", label: "DDL 列表", mobileLabel: "DDL", count: ddlCount },
    { value: "applications", label: "我的申请", mobileLabel: "申请", count: applicationCount },
    { value: "calendar", label: "申请日历", mobileLabel: "日历", count: applicationCount }
  ];
}

function NavigationIcon({ tab }: { tab: MainTab }): React.ReactElement {
  if (tab === "applications") {
    return <ClipboardList aria-hidden="true" size={18} strokeWidth={2} />;
  }
  if (tab === "calendar") {
    return <CalendarDays aria-hidden="true" size={18} strokeWidth={2} />;
  }
  return <ListFilter aria-hidden="true" size={18} strokeWidth={2} />;
}
