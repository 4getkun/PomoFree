import { useMemo, useState } from "react";
import { loadSessions, loadTasks, loadProjects } from "../lib/storage";
import {
  buildDailySeries,
  aggregateWeekly,
  aggregateMonthly,
  buildHeatmapWeeks,
  computeStreaks,
  computeSummary,
  breakdownByProject,
} from "../lib/stats";
import { BarChart, CalendarHeatmap, StatTile, type BarDatum } from "../components/charts";

type RangeMode = "daily" | "weekly" | "monthly";

const RANGE_LABEL: Record<RangeMode, string> = { daily: "日別", weekly: "週別", monthly: "月別" };

function formatMinutes(rawTotal: number): string {
  // Session durations can now be fractional minutes (pause-time flushing —
  // see timer.ts — records down to the second, e.g. 2 seconds = 0.0333...
  // minutes), so this always rounds to a whole minute before splitting into
  // hours/minutes — otherwise a raw float like "0.0833...分" would leak
  // into the UI instead of a clean "5秒" — worthy of note but out of scope;
  // rounding to the nearest whole minute keeps this display simple.
  const total = Math.round(rawTotal);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

function dailyLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function weeklyLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function monthlyLabel(month: string): string {
  const [, m] = month.split("-");
  return `${Number(m)}月`;
}

/**
 * Full statistics dashboard, read entirely from loadSessions() with no
 * cutoff on history depth — competing apps' free tiers often cap analytics
 * to a couple of days; Pomofree's whole pitch is not doing that.
 */
export default function StatsView() {
  const [rangeMode, setRangeMode] = useState<RangeMode>("daily");

  // Views are remounted on tab switch (see PomofreeApp), so a plain
  // useState(() => load...()) initializer is enough to always reflect the
  // latest data without a manual refresh mechanism.
  const [sessions] = useState(() => loadSessions());
  const [tasks] = useState(() => loadTasks());
  const [projects] = useState(() => loadProjects());

  const summary = useMemo(() => computeSummary(sessions), [sessions]);
  const streaks = useMemo(() => computeStreaks(sessions), [sessions]);
  const heatmapWeeks = useMemo(() => buildHeatmapWeeks(sessions, 20), [sessions]);
  const projectBreakdown = useMemo(() => breakdownByProject(sessions, tasks, projects), [sessions, tasks, projects]);

  const dailySeries = useMemo(() => buildDailySeries(sessions, rangeMode === "daily" ? 14 : rangeMode === "weekly" ? 84 : 365), [sessions, rangeMode]);

  const chartData: BarDatum[] = useMemo(() => {
    if (rangeMode === "daily") {
      return dailySeries.map((d) => ({ key: d.date, label: dailyLabel(d.date), value: d.minutes }));
    }
    if (rangeMode === "weekly") {
      return aggregateWeekly(dailySeries)
        .slice(-12)
        .map((w) => ({ key: w.weekStart, label: weeklyLabel(w.weekStart), value: w.minutes }));
    }
    return aggregateMonthly(dailySeries)
      .slice(-12)
      .map((m) => ({ key: m.month, label: monthlyLabel(m.month), value: m.minutes }));
  }, [dailySeries, rangeMode]);

  const hasAnyData = sessions.length > 0;
  const maxProjectMinutes = Math.max(...projectBreakdown.map((p) => p.minutes), 1);

  return (
    <div className="flex flex-col gap-8 pb-16">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
          統計
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          全期間の履歴を無制限に表示します。他の多くのアプリでは有料プランが必要な機能です。
        </p>
      </div>

      {!hasAnyData ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          まだセッションの記録がありません。タイマーを開始すると、ここに統計が表示されます。
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="合計フォーカス時間" value={formatMinutes(summary.totalFocusMinutes)} />
            <StatTile label="完了セッション数" value={String(summary.totalCompletedSessions)} sub={`スキップ ${summary.skippedWorkSessions} 回`} />
            <StatTile label="完了率" value={`${Math.round(summary.completionRate * 100)}%`} />
            <StatTile label="現在のストリーク" value={`${streaks.current} 日`} sub={`最長 ${streaks.longest} 日`} />
          </div>

          <section>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              アクティビティ
            </h3>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              直近{heatmapWeeks.length}週間、完了した作業セッションのある日を濃淡で表示しています。
            </p>
            <div className="mt-3">
              <CalendarHeatmap weeks={heatmapWeeks} />
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                フォーカス時間の推移
              </h3>
              <div className="flex gap-1 rounded-lg border p-0.5" style={{ borderColor: "var(--border)" }}>
                {(Object.keys(RANGE_LABEL) as RangeMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setRangeMode(mode)}
                    className="rounded-md px-2.5 py-1 text-xs font-medium transition"
                    style={{
                      backgroundColor: rangeMode === mode ? "var(--ring)" : "transparent",
                      color: rangeMode === mode ? "var(--accent)" : "var(--text-muted)",
                    }}
                  >
                    {RANGE_LABEL[mode]}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3">
              <BarChart data={chartData} formatValue={(v) => formatMinutes(v)} />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              プロジェクト別の内訳
            </h3>
            <div className="mt-3 flex flex-col gap-2">
              {projectBreakdown.length === 0 && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  データがありません。
                </p>
              )}
              {projectBreakdown.map((p) => (
                <div key={p.projectId ?? "none"} className="flex items-center gap-3">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: p.color }}
                    aria-hidden
                  />
                  <span className="w-28 shrink-0 truncate text-xs" style={{ color: "var(--text)" }}>
                    {p.name}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: "var(--border)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(p.minutes / maxProjectMinutes) * 100}%`, backgroundColor: p.color }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {formatMinutes(p.minutes)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {summary.skippedWorkSessions > 0 && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              参考: これまでに {summary.skippedWorkSessions}{" "}
              回の作業セッションが最後まで完了せずスキップされています。一時停止した時点までの時間は上記の合計フォーカス時間に含まれていますが、スキップした残りの時間は含まれていません。
            </p>
          )}
        </>
      )}
    </div>
  );
}
