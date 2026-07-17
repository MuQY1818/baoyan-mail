import { Suspense, lazy, useState } from "react";
import type React from "react";
import { ChevronDown, Globe2 } from "lucide-react";
import type { GlobeCountry } from "../GlobeScene";
import type { AnalyticsSummary, ThemeMode } from "../types";

// three.js 较重，只有用户主动展开访问地图时才下载并挂载。
const GlobeScene = lazy(() => import("../GlobeScene"));

export function AnalyticsPanel({
  summary,
  theme
}: {
  summary: AnalyticsSummary | null;
  theme: ThemeMode;
}): React.ReactElement {
  const [mapOpen, setMapOpen] = useState(false);
  const countries = summary?.countries ?? [];
  const topCountries = countries.slice(0, 5);
  const topRegions = summary?.regions.slice(0, 5) ?? [];
  const maxVisits = Math.max(1, ...countries.map((country) => country.visitCount));
  return (
    <footer className="analytics-panel" aria-label="访问统计">
      <div className="analytics-summary-row">
        <div className="analytics-copy">
          <span className="analytics-eyebrow">VISIT ATLAS</span>
          <strong>匿名访问统计</strong>
          <p>每日一次匿名计数，不保存 IP、邮箱或浏览器指纹。</p>
        </div>
        <div className="analytics-metrics">
          <Metric label="近 30 天访问" value={summary?.totalVisits ?? 0} />
          <Metric label="今日访问" value={summary?.todayVisits ?? 0} />
          <Metric label="覆盖地区" value={summary?.regionCount ?? 0} />
        </div>
        <div className="analytics-region-summary" aria-label="主要访问地区">
          <span>主要地区</span>
          {topRegions.length === 0 ? (
            <em>等待数据积累</em>
          ) : (
            topRegions.slice(0, 3).map((region) => (
              <strong key={`${region.countryCode}-${region.regionCode}-${region.regionName}`}>
                {region.regionName} {region.visitCount}
              </strong>
            ))
          )}
        </div>
      </div>

      <details
        className="analytics-details"
        onToggle={(event) => setMapOpen(event.currentTarget.open)}
        open={mapOpen}
      >
        <summary>
          <Globe2 aria-hidden="true" size={17} />
          {mapOpen ? "收起访问地图" : "展开访问地图与地区排行"}
          <ChevronDown aria-hidden="true" className={mapOpen ? "chevron-open" : ""} size={16} />
        </summary>
        {mapOpen && (
          <div className="analytics-board">
            <VisitGlobe countries={countries} maxVisits={maxVisits} theme={theme} />
            <div className="analytics-rank-card" aria-label="访问地区排行">
              <div className="rank-section">
                <strong className="analytics-list-title">国家或地区</strong>
                {topCountries.length === 0 ? (
                  <p className="country-empty">等待访问数据积累。</p>
                ) : (
                  topCountries.map((country) => (
                    <div className="country-row" key={country.countryCode}>
                      <span className="country-name">{country.countryName}</span>
                      <span className="country-bar" aria-hidden="true">
                        <span style={{ width: `${Math.max(8, (country.visitCount / maxVisits) * 100)}%` }} />
                      </span>
                      <strong>{country.visitCount}</strong>
                    </div>
                  ))
                )}
              </div>
              <div className="rank-section">
                <strong className="analytics-list-title">细分地区</strong>
                {topRegions.length === 0 ? (
                  <p className="country-empty">暂无细分地区。</p>
                ) : (
                  topRegions.map((region) => (
                    <div className="region-row" key={`${region.countryCode}-${region.regionCode}-${region.regionName}`}>
                      <span>{region.regionName}</span>
                      <strong>{region.visitCount}</strong>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </details>
    </footer>
  );
}

function Metric({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="analytics-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function VisitGlobe({
  countries,
  maxVisits,
  theme
}: {
  countries: GlobeCountry[];
  maxVisits: number;
  theme: ThemeMode;
}): React.ReactElement {
  const leader = countries[0];

  return (
    <div className="visit-globe-card" aria-label="世界访问热度">
      <div className="visit-globe-stage">
        <Suspense fallback={<GlobeFallback />}>
          <GlobeScene countries={countries} maxVisits={maxVisits} theme={theme} />
        </Suspense>
        <div className="globe-legend" aria-hidden="true">
          <span className="globe-legend-dot globe-legend-hot" />
          <span>访问热度</span>
          <span className="globe-legend-dot globe-legend-cool" />
        </div>
      </div>
      <div className="visit-globe-caption">
        <strong>{leader?.countryName ?? "暂无地区"}</strong>
        <span>{leader === undefined ? "等待访问数据" : `${leader.visitCount} 次访问`}</span>
      </div>
    </div>
  );
}

function GlobeFallback(): React.ReactElement {
  return (
    <div className="globe-loading" role="status" aria-label="正在加载世界访问热度">
      <span className="globe-loading-orb" aria-hidden="true" />
    </div>
  );
}
