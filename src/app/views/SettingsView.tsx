import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AmbientSoundId, Settings, Theme } from "../lib/types";
import { AMBIENT_SOUND_OPTIONS } from "../lib/types";
import { createAmbientSoundEngine, type AmbientSoundEngine } from "../lib/ambientSound";
import { isSupabaseConfigured } from "../lib/supabase";
import type { SyncStatus } from "../lib/useSync";
import { exportAllAsJSON, exportSessionsAsCSV } from "../lib/export";

interface SettingsViewProps {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  email: string | null;
  syncStatus: SyncStatus;
  sendMagicLink: (email: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

const SYNC_STATUS_LABEL: Record<SyncStatus, string> = {
  disabled: "利用不可",
  "signed-out": "未サインイン",
  syncing: "同期中…",
  synced: "同期済み",
  error: "同期エラー",
};

type NotificationPermissionState = NotificationPermission | "unsupported";

function getCurrentPermission(): NotificationPermissionState {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export default function SettingsView({ settings, updateSettings, email, syncStatus, sendMagicLink, signOut }: SettingsViewProps) {
  const [permission, setPermission] = useState<NotificationPermissionState>("default");

  useEffect(() => {
    setPermission(getCurrentPermission());
  }, []);

  // A dedicated engine for auditioning sounds from this view, independent of
  // the one TimerView uses during an actual focus session. Torn down on
  // unmount so its AudioContext doesn't linger after leaving Settings.
  const previewEngineRef = useRef<AmbientSoundEngine | null>(null);
  const [previewingId, setPreviewingId] = useState<AmbientSoundId | null>(null);

  useEffect(() => {
    previewEngineRef.current = createAmbientSoundEngine();
    return () => {
      previewEngineRef.current?.dispose();
      previewEngineRef.current = null;
    };
  }, []);

  // Keep a live preview in sync if the volume slider moves while it's playing.
  useEffect(() => {
    if (previewingId) previewEngineRef.current?.setVolume(settings.soundVolume);
  }, [settings.soundVolume, previewingId]);

  const togglePreview = (id: AmbientSoundId) => {
    const engine = previewEngineRef.current;
    if (!engine) return;
    if (previewingId === id) {
      engine.stop();
      setPreviewingId(null);
    } else {
      engine.play(id, settings.soundVolume);
      setPreviewingId(id);
    }
  };

  const [loginEmail, setLoginEmail] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginMessage, setLoginMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const handleSendMagicLink = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = loginEmail.trim();
    if (!trimmed || loginSubmitting) return;
    setLoginSubmitting(true);
    setLoginMessage(null);
    const result = await sendMagicLink(trimmed);
    setLoginSubmitting(false);
    if (result.ok) {
      setLoginMessage({ kind: "success", text: `${trimmed} にログインリンクを送信しました。メール内のリンクをクリックしてください。` });
    } else {
      setLoginMessage({ kind: "error", text: result.error ?? "ログインリンクの送信に失敗しました。もう一度お試しください。" });
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
  };

  const handleNotificationsToggle = async (checked: boolean) => {
    if (!checked) {
      updateSettings({ notificationsEnabled: false });
      return;
    }
    if (typeof Notification === "undefined") {
      setPermission("unsupported");
      updateSettings({ notificationsEnabled: false });
      return;
    }
    if (Notification.permission === "granted") {
      updateSettings({ notificationsEnabled: true });
      return;
    }
    // Requesting permission must happen from this explicit user action
    // (the toggle click), never automatically on page load.
    const result = await Notification.requestPermission();
    setPermission(result);
    updateSettings({ notificationsEnabled: result === "granted" });
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-10 pb-16">
      <section>
        <SectionHeading
          title="タイマーの長さ"
          subtitle="作業・休憩の時間は完全に自由にカスタマイズできます。他の多くのアプリでは有料プランが必要な機能です。"
        />
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-2">
          <NumberField
            label="作業時間 (分)"
            value={settings.workMinutes}
            min={1}
            max={180}
            onChange={(v) => updateSettings({ workMinutes: v })}
          />
          <NumberField
            label="短い休憩 (分)"
            value={settings.shortBreakMinutes}
            min={1}
            max={60}
            onChange={(v) => updateSettings({ shortBreakMinutes: v })}
          />
          <NumberField
            label="長い休憩 (分)"
            value={settings.longBreakMinutes}
            min={1}
            max={120}
            onChange={(v) => updateSettings({ longBreakMinutes: v })}
          />
          <NumberField
            label="長い休憩までのセッション数"
            value={settings.sessionsBeforeLongBreak}
            min={1}
            max={12}
            onChange={(v) => updateSettings({ sessionsBeforeLongBreak: v })}
          />
        </div>
      </section>

      <section>
        <SectionHeading title="自動開始" subtitle="フェーズの切り替え時に自動でタイマーを開始するかどうかです。" />
        <div className="mt-4 flex flex-col gap-3">
          <ToggleRow
            label="休憩を自動開始"
            description="作業セッションが終わったら自動的に休憩を開始します。"
            checked={settings.autoStartBreaks}
            onChange={(checked) => updateSettings({ autoStartBreaks: checked })}
          />
          <ToggleRow
            label="作業を自動開始"
            description="休憩が終わったら自動的に次の作業セッションを開始します。"
            checked={settings.autoStartWork}
            onChange={(checked) => updateSettings({ autoStartWork: checked })}
          />
        </div>
      </section>

      <section>
        <SectionHeading title="通知" subtitle="タブを離れていてもフェーズの終了をブラウザ通知でお知らせします。" />
        <div className="mt-4 flex flex-col gap-2">
          <ToggleRow
            label="ブラウザ通知を有効にする"
            description="ページにフォーカスがない時のみ通知が届きます。チャイム音は常に鳴ります。"
            checked={settings.notificationsEnabled && permission === "granted"}
            onChange={(checked) => {
              void handleNotificationsToggle(checked);
            }}
          />
          {permission === "denied" && (
            <p className="text-xs" style={{ color: "var(--danger)" }}>
              ブラウザの通知がブロックされています。通知を受け取るには、ブラウザのサイト設定から通知を許可してください。
            </p>
          )}
          {permission === "unsupported" && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              このブラウザは通知に対応していません。チャイム音は引き続き利用できます。
            </p>
          )}
        </div>
      </section>

      <section>
        <SectionHeading title="テーマ" subtitle="ライト / ダークはいつでも切り替えられます。追加料金はありません。" />
        <div className="mt-4 flex gap-2">
          {(["light", "dark", "system"] as Theme[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => updateSettings({ theme: option })}
              className="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition"
              style={{
                borderColor: settings.theme === option ? "var(--accent)" : "var(--border)",
                backgroundColor: settings.theme === option ? "var(--ring)" : "transparent",
                color: "var(--text)",
              }}
            >
              {option === "light" ? "ライト" : option === "dark" ? "ダーク" : "システム設定に合わせる"}
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading
          title="アンビエントサウンド"
          subtitle="作業セッション中に流す環境音です。すべてWeb Audio APIでその場合成しており、外部音源は一切使用していません。試聴してから選べます。"
        />
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              サウンド
            </span>
            <button
              type="button"
              onClick={() => updateSettings({ soundId: null })}
              className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
              style={{
                borderColor: settings.soundId === null ? "var(--accent)" : "var(--border)",
                backgroundColor: settings.soundId === null ? "var(--ring)" : "transparent",
                color: "var(--text)",
              }}
            >
              なし（無音）
            </button>
            {AMBIENT_SOUND_OPTIONS.map((opt) => (
              <div
                key={opt.id}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor: settings.soundId === opt.id ? "var(--accent)" : "var(--border)",
                  backgroundColor: settings.soundId === opt.id ? "var(--ring)" : "transparent",
                }}
              >
                <button type="button" onClick={() => updateSettings({ soundId: opt.id })} className="flex-1 text-left" style={{ color: "var(--text)" }}>
                  {opt.label}
                </button>
                <button
                  type="button"
                  onClick={() => togglePreview(opt.id)}
                  className="shrink-0 rounded-md border px-2 py-1 text-xs font-medium"
                  style={{ borderColor: "var(--border)", color: previewingId === opt.id ? "var(--accent)" : "var(--text-muted)" }}
                >
                  {previewingId === opt.id ? "■ 停止" : "▶ 試聴"}
                </button>
              </div>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>音量 ({Math.round(settings.soundVolume * 100)}%)</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.soundVolume}
              onChange={(e) => updateSettings({ soundVolume: Number(e.target.value) })}
              className="accent-[var(--accent)]"
            />
          </label>
        </div>
      </section>

      <section>
        <SectionHeading title="アカウント同期" subtitle="端末をまたいだデータの同期です。ログインはメールのリンクのみで、パスワードは不要です。" />
        {!isSupabaseConfigured ? (
          <div
            className="mt-4 rounded-lg border border-dashed p-4 text-sm"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            アカウント同期は現在利用できません。この機能はオプションであり、このデプロイでは設定されていません。データはこの端末のブラウザ内にのみ保存されます。
          </div>
        ) : email ? (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border p-4 text-sm" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium" style={{ color: "var(--text)" }}>
                  {email}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  {SYNC_STATUS_LABEL[syncStatus]}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                disabled={signingOut}
                className="shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                サインアウト
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSendMagicLink(e)} className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: "var(--text-muted)" }}>メールアドレス</span>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="you@example.com"
                className="rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
              />
            </label>
            <button
              type="submit"
              disabled={loginSubmitting || !loginEmail.trim()}
              className="self-start rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ backgroundColor: "var(--accent)" }}
            >
              {loginSubmitting ? "送信中…" : "ログインリンクを送信"}
            </button>
            {loginMessage && (
              <p className="text-xs" style={{ color: loginMessage.kind === "error" ? "var(--danger)" : "var(--text-muted)" }}>
                {loginMessage.text}
              </p>
            )}
          </form>
        )}
      </section>

      <section>
        <SectionHeading
          title="データのエクスポート"
          subtitle="自分のデータはいつでも自由に持ち出せます。多くのアプリはこれを有料プランの機能にしていますが、Pomofreeでは無条件で利用できます。"
        />
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => exportAllAsJSON()}
            className="rounded-lg border px-4 py-2 text-sm font-medium transition hover:bg-[var(--surface-raised)]"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            全データをJSONでエクスポート
          </button>
          <button
            type="button"
            onClick={() => exportSessionsAsCSV()}
            className="rounded-lg border px-4 py-2 text-sm font-medium transition hover:bg-[var(--surface-raised)]"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            セッション履歴をCSVでエクスポート
          </button>
        </div>
      </section>

      <section>
        <SectionHeading title="キーボードショートカット" subtitle="マウスを使わなくても操作できます。" />
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            { keys: "Space", desc: "タイマー開始 / 一時停止" },
            { keys: "S", desc: "スキップ" },
            { keys: "R", desc: "リセット" },
            { keys: "1〜4", desc: "タブ切り替え（タイマー/タスク/統計/設定）" },
          ].map((row) => (
            <div
              key={row.keys}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)" }}
            >
              <span style={{ color: "var(--text-muted)" }}>{row.desc}</span>
              <kbd
                className="shrink-0 rounded border px-2 py-0.5 font-mono text-xs"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                {row.keys}
              </kbd>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          入力欄にフォーカスしている間はショートカットは無効になります。
        </p>
      </section>
    </div>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h3 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
        {title}
      </h3>
      <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
        {subtitle}
      </p>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`${label}を減らす`}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="flex h-9 w-9 items-center justify-center rounded-lg border text-lg"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          −
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const parsed = Number(e.target.value);
            if (!Number.isNaN(parsed)) {
              onChange(Math.min(max, Math.max(min, parsed)));
            }
          }}
          className="w-16 rounded-lg border px-2 py-1.5 text-center tabular-nums"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
        />
        <button
          type="button"
          aria-label={`${label}を増やす`}
          onClick={() => onChange(Math.min(max, value + 1))}
          className="flex h-9 w-9 items-center justify-center rounded-lg border text-lg"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          +
        </button>
      </div>
    </label>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
          {label}
        </p>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="relative h-6 w-11 shrink-0 rounded-full transition"
        style={{ backgroundColor: checked ? "var(--accent)" : "var(--border)" }}
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? "translateX(22px)" : "translateX(2px)" }}
        />
      </button>
    </div>
  );
}
