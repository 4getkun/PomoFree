// Small hand-rolled SVG charts for StatsView. No charting library — the app
// only needs a handful of chart forms (bar + heatmap), so a dependency would
// cost more in bundle size than it saves in code. Colors are pulled from the
// existing CSS custom-property theme (var(--accent), var(--text-muted), ...)
// so charts stay correct in both light and dark mode automatically, per the
// dataviz skill's guidance to source color from the design system rather
// than hardcoding it.
//
// Chart form / mark specs follow the dataviz skill:
//  - Bars: sequential magnitude -> single hue (accent), thin (<=22px), 4px
//    rounded data-end, square baseline, hairline recessive gridlines,
//    value-on-hover tooltip rather than a label on every bar.
//  - Heatmap: sequential magnitude -> one hue ramped via color-mix() steps
//    from the surface color to the accent color (light -> dark = low -> high),
//    so it reuses the theme's own accent hue as the "sequential ramp" instead
//    of inventing new palette values.

import { useState } from "react";

export interface BarDatum {
  key: string;
  label: string;
  value: number;
}

interface TooltipState {
  x: number;
  y: number;
  title: string;
  value: string;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function BarChart({
  data,
  formatValue = (v) => String(v),
  height = 180,
  barColor = "var(--accent)",
}: {
  data: BarDatum[];
  formatValue?: (v: number) => string;
  height?: number;
  barColor?: string;
}) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const padding = { top: 12, right: 8, bottom: 24, left: 8 };
  const width = Math.max(data.length * 28, 280);
  const plotHeight = height - padding.top - padding.bottom;
  const barWidth = Math.min(22, (width - padding.left - padding.right) / data.length - 4);

  const gridLines = [0, 0.5, 1];

  return (
    <div className="relative w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label="日別フォーカス時間の棒グラフ"
      >
        {gridLines.map((fraction) => {
          const y = padding.top + plotHeight * (1 - fraction);
          return (
            <line
              key={fraction}
              x1={padding.left}
              x2={width - padding.right}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeWidth={1}
            />
          );
        })}

        {data.map((d, i) => {
          const slotWidth = (width - padding.left - padding.right) / data.length;
          const cx = padding.left + slotWidth * i + slotWidth / 2;
          const barHeight = max > 0 ? (d.value / max) * plotHeight : 0;
          const y = padding.top + plotHeight - barHeight;
          const isHovered = tooltip?.title === d.label;
          return (
            <g key={d.key}>
              {/* Wider invisible hit target for easier hover/tap than the thin bar itself. */}
              <rect
                x={cx - slotWidth / 2}
                y={padding.top}
                width={slotWidth}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() =>
                  setTooltip({ x: cx, y, title: d.label, value: formatValue(d.value) })
                }
                onMouseLeave={() => setTooltip(null)}
              />
              {barHeight > 0 && (
                <rect
                  x={cx - barWidth / 2}
                  y={y}
                  width={barWidth}
                  height={Math.max(barHeight, 1)}
                  rx={4}
                  fill={barColor}
                  opacity={isHovered ? 1 : 0.85}
                  style={{ pointerEvents: "none" }}
                />
              )}
              <text
                x={cx}
                y={height - 6}
                textAnchor="middle"
                fontSize={9}
                fill="var(--text-muted)"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md px-2 py-1 text-xs shadow-sm"
          style={{
            left: tooltip.x,
            top: Math.max(0, tooltip.y - 6),
            backgroundColor: "var(--surface-raised)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        >
          <div className="font-medium">{tooltip.title}</div>
          <div style={{ color: "var(--text-muted)" }}>{tooltip.value}</div>
        </div>
      )}
    </div>
  );
}

export interface HeatmapColumn {
  cells: { date: string; minutes: number; weekday: number }[];
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function levelForMinutes(minutes: number, max: number): number {
  if (minutes <= 0) return 0;
  if (max <= 0) return 1;
  const ratio = minutes / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

// Sequential ramp built from the theme's own accent hue via color-mix, so
// the heatmap automatically re-tints with the app's accent color and
// respects light/dark mode without a separately maintained palette.
const LEVEL_BACKGROUND = [
  "var(--border)",
  "color-mix(in srgb, var(--accent) 28%, var(--surface))",
  "color-mix(in srgb, var(--accent) 52%, var(--surface))",
  "color-mix(in srgb, var(--accent) 76%, var(--surface))",
  "var(--accent)",
];

export function CalendarHeatmap({ weeks }: { weeks: { date: string; minutes: number; weekday: number }[][] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; date: string; minutes: number } | null>(null);
  const max = Math.max(...weeks.flat().map((c) => c.minutes), 1);
  const cellSize = 12;
  const gap = 3;

  return (
    <div className="relative w-full overflow-x-auto">
      <div className="flex items-start gap-2" style={{ width: "max-content" }}>
        <div className="flex flex-col gap-[3px] pt-[18px]" style={{ fontSize: 9, color: "var(--text-muted)" }}>
          {WEEKDAY_LABELS.map((label, i) => (
            <div key={i} style={{ height: cellSize, lineHeight: `${cellSize}px` }}>
              {i % 2 === 1 ? label : ""}
            </div>
          ))}
        </div>
        <div className="flex gap-[3px]">
          {weeks.map((column, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {column.map((cell) => {
                const level = levelForMinutes(cell.minutes, max);
                return (
                  <div
                    key={cell.date}
                    role="img"
                    aria-label={`${cell.date}: ${cell.minutes}分`}
                    onMouseEnter={(e) => {
                      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                      const parentRect = (e.currentTarget.closest(".relative") as HTMLDivElement)?.getBoundingClientRect();
                      setTooltip({
                        x: rect.left - (parentRect?.left ?? 0) + rect.width / 2,
                        y: rect.top - (parentRect?.top ?? 0),
                        date: cell.date,
                        minutes: cell.minutes,
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      borderRadius: 3,
                      backgroundColor: LEVEL_BACKGROUND[level],
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md px-2 py-1 text-xs shadow-sm"
          style={{
            left: tooltip.x,
            top: Math.max(0, tooltip.y - 6),
            backgroundColor: "var(--surface-raised)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            whiteSpace: "nowrap",
          }}
        >
          <div className="font-medium">{tooltip.date}</div>
          <div style={{ color: "var(--text-muted)" }}>{tooltip.minutes} 分</div>
        </div>
      )}
    </div>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
      <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold" style={{ color: "var(--text)" }}>
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}
