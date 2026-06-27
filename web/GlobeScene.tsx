// 3D 旋转地球场景:被 VisitGlobe 懒加载,three.js 仅在进入可视区后才下载。
import React, { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { COUNTRY_COORDS } from "./globe-data";

export interface GlobeCountry {
  countryCode: string;
  countryName: string;
  visitCount: number;
}

interface GlobePoint {
  lat: number;
  lng: number;
  countryName: string;
  visitCount: number;
  weight: number;
  color: string;
  altitude: number;
  radius: number;
}

// 访问量占比 → 光点颜色,沿用站点蓝→琥珀→橙的热度梯度
function colorForWeight(weight: number): string {
  if (weight >= 0.75) return "#fb923c";
  if (weight >= 0.45) return "#fbbf24";
  if (weight >= 0.2) return "#38bdf8";
  return "#7dd3fc";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&quot;"
  );
}

// 仅保留表中有经纬度的国家;其余照常计入排行榜,只是不落在地球上
function buildPoints(countries: GlobeCountry[], maxVisits: number): GlobePoint[] {
  const points: GlobePoint[] = [];
  for (const country of countries) {
    const coord = COUNTRY_COORDS[country.countryCode];
    if (coord === undefined) {
      continue;
    }
    const weight = country.visitCount / Math.max(1, maxVisits);
    points.push({
      lat: coord[0],
      lng: coord[1],
      countryName: country.countryName,
      visitCount: country.visitCount,
      weight,
      color: colorForWeight(weight),
      altitude: 0.012 + weight * 0.4,
      radius: 0.26 + weight * 0.45
    });
  }
  return points;
}

export default function GlobeScene({
  countries,
  maxVisits,
  theme
}: {
  countries: GlobeCountry[];
  maxVisits: number;
  theme: "light" | "dark";
}): React.ReactElement {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const points = useMemo(() => buildPoints(countries, maxVisits), [countries, maxVisits]);
  const rings = useMemo(() => points.slice(0, 4), [points]);
  const reduceMotion = useMemo(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    []
  );

  // react-globe.gl 需要明确的像素宽高,用 ResizeObserver 跟随舞台尺寸
  useEffect(() => {
    const el = wrapRef.current;
    if (el === null) {
      return;
    }
    const update = (): void => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 地球就绪:锁定缩放/平移、开启自动旋转、聚焦访问最多的国家
  function handleReady(): void {
    const globe = globeRef.current;
    if (globe === undefined) {
      return;
    }
    const controls = globe.controls();
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.5;
    const focus = points[0];
    globe.pointOfView(
      focus === undefined
        ? { lat: 22, lng: 105, altitude: 2.4 }
        : { lat: focus.lat, lng: focus.lng, altitude: 2.2 },
      0
    );
  }

  return (
    <div className="globe-canvas-wrap" ref={wrapRef}>
      {size.width > 0 && (
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          animateIn={!reduceMotion}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl="/assets/earth-blue-marble.jpg"
          bumpImageUrl="/assets/earth-topology.png"
          showAtmosphere
          atmosphereColor={theme === "dark" ? "#5aa2ff" : "#3b82f6"}
          atmosphereAltitude={0.2}
          pointsData={points}
          pointLat={(d) => (d as GlobePoint).lat}
          pointLng={(d) => (d as GlobePoint).lng}
          pointColor={(d) => (d as GlobePoint).color}
          pointAltitude={(d) => (d as GlobePoint).altitude}
          pointRadius={(d) => (d as GlobePoint).radius}
          pointResolution={6}
          pointsTransitionDuration={900}
          pointLabel={(d) => {
            const point = d as GlobePoint;
            return `<div class="globe-tip"><strong>${escapeHtml(point.countryName)}</strong><span>${point.visitCount} 次访问</span></div>`;
          }}
          ringsData={reduceMotion ? [] : rings}
          ringLat={(d) => (d as GlobePoint).lat}
          ringLng={(d) => (d as GlobePoint).lng}
          ringColor={() => (t: number) => `rgba(251, 146, 60, ${Math.sqrt(1 - t)})`}
          ringMaxRadius={(d) => 3 + (d as GlobePoint).weight * 3}
          ringPropagationSpeed={1.8}
          ringRepeatPeriod={900}
          onGlobeReady={handleReady}
        />
      )}
    </div>
  );
}
