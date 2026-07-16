import { useMemo, useState } from "react";
import type { Project, RecurrenceFrequency, Task, TaskPriority } from "../lib/types";
import type { NewTaskInput } from "../lib/useTasks";
import { useProjects } from "../lib/useProjects";
import { compareTasks, todayLocalISODate } from "../lib/tasks";

// Task data/CRUD is owned by PomofreeApp.tsx (not this view) and passed in
// as props — see the hoisting note there. TimerView also needs the same
// task list (for its active-task dropdown), so a single shared useTasks()
// instance at the root avoids two independently-diverging in-memory copies
// of the same localStorage-backed array. useProjects() stays local here
// since TimerView never needs project data.
interface TasksViewProps {
  activeTaskId: string | null;
  setActiveTaskId: (id: string | null) => void;
  tasks: Task[];
  addTask: (input: NewTaskInput) => string;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  toggleComplete: (id: string) => void;
  addSubtask: (taskId: string, title: string) => void;
  removeSubtask: (taskId: string, subtaskId: string) => void;
  toggleSubtask: (taskId: string, subtaskId: string) => void;
  clearProjectReferences: (projectId: string) => void;
}

// Fixed-order categorical swatches (dataviz-skill-validated 8-hue set —
// same hues/order as references/palette.md in the dataviz skill) used for
// project color assignment. No cap on how many projects can be created;
// once past 8 a user just reuses/mixes swatches — this is a UI affordance,
// not a hard limit.
const PROJECT_COLOR_SWATCHES = [
  "#2a78d6", // blue
  "#008300", // green
  "#e87ba4", // magenta
  "#eda100", // yellow
  "#1baf7a", // aqua
  "#eb6834", // orange
  "#4a3aa7", // violet
  "#e34948", // red
];

const PRIORITY_LABEL: Record<TaskPriority, string> = { high: "高", medium: "中", low: "低" };
const PRIORITY_COLOR: Record<TaskPriority, string> = { high: "var(--danger)", medium: "var(--accent)", low: "var(--text-muted)" };
const RECURRENCE_LABEL: Record<RecurrenceFrequency, string> = { none: "繰り返さない", daily: "毎日", weekly: "毎週", monthly: "毎月" };

type ProjectFilter = "all" | "none" | string;

export default function TasksView({
  activeTaskId,
  setActiveTaskId,
  tasks,
  addTask,
  updateTask,
  deleteTask,
  toggleComplete,
  addSubtask,
  removeSubtask,
  toggleSubtask,
  clearProjectReferences,
}: TasksViewProps) {
  const { projects, addProject, updateProject, setArchived, deleteProject } = useProjects();

  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [showCompleted, setShowCompleted] = useState(true);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const visibleTasks = useMemo(() => {
    let list = tasks;
    if (projectFilter === "none") list = list.filter((t) => t.projectId == null);
    else if (projectFilter !== "all") list = list.filter((t) => t.projectId === projectFilter);
    if (!showCompleted) list = list.filter((t) => !t.completed);
    return [...list].sort(compareTasks);
  }, [tasks, projectFilter, showCompleted]);

  const handleDeleteProject = (id: string) => {
    clearProjectReferences(id);
    deleteProject(id);
    if (projectFilter === id) setProjectFilter("all");
  };

  return (
    <div className="flex flex-col gap-8 pb-16">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
          タスク
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          プロジェクトとタスクの数に制限はありません。全部無料です。
        </p>
      </div>

      <ProjectManager
        projects={projects}
        addProject={addProject}
        updateProject={updateProject}
        setArchived={setArchived}
        deleteProject={handleDeleteProject}
      />

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            タスク一覧
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="rounded-lg border px-2 py-1.5 text-xs"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
            >
              <option value="all">すべてのプロジェクト</option>
              <option value="none">プロジェクトなし</option>
              {projects
                .filter((p) => !p.archived)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
              <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
              完了済みを表示
            </label>
          </div>
        </div>

        <div className="mt-4">
          <AddTaskForm projects={projects} addTask={addTask} defaultProjectId={projectFilter !== "all" && projectFilter !== "none" ? projectFilter : null} />
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {visibleTasks.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-center text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
              タスクがありません。上のフォームから追加してください。
            </p>
          )}
          {visibleTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              project={task.projectId ? projectById.get(task.projectId) ?? null : null}
              projects={projects}
              isActive={activeTaskId === task.id}
              isEditing={editingTaskId === task.id}
              onToggleEdit={() => setEditingTaskId((cur) => (cur === task.id ? null : task.id))}
              onSetActive={() => setActiveTaskId(activeTaskId === task.id ? null : task.id)}
              onToggleComplete={() => toggleComplete(task.id)}
              onDelete={() => {
                deleteTask(task.id);
                if (activeTaskId === task.id) setActiveTaskId(null);
                if (editingTaskId === task.id) setEditingTaskId(null);
              }}
              onUpdate={(patch) => updateTask(task.id, patch)}
              onAddSubtask={(title) => addSubtask(task.id, title)}
              onRemoveSubtask={(subtaskId) => removeSubtask(task.id, subtaskId)}
              onToggleSubtask={(subtaskId) => toggleSubtask(task.id, subtaskId)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------
// Projects
// ------------------------------------------------------------------------

function ProjectManager({
  projects,
  addProject,
  updateProject,
  setArchived,
  deleteProject,
}: {
  projects: Project[];
  addProject: (name: string, color: string) => string;
  updateProject: (id: string, patch: Partial<Project>) => void;
  setArchived: (id: string, archived: boolean) => void;
  deleteProject: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PROJECT_COLOR_SWATCHES[0]);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addProject(trimmed, color);
    setName("");
    setColor(PROJECT_COLOR_SWATCHES[(projects.length + 1) % PROJECT_COLOR_SWATCHES.length]);
  };

  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);

  return (
    <section>
      <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
        プロジェクト
      </h3>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        作成できるプロジェクト数に上限はありません。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder="新しいプロジェクト名"
          className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
        />
        <ColorSwatchPicker value={color} onChange={setColor} />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!name.trim()}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-contrast)" }}
        >
          追加
        </button>
      </div>

      {(active.length > 0 || archived.length > 0) && (
        <div className="mt-3 flex flex-col gap-1.5">
          {[...active, ...archived].map((project) => (
            <div
              key={project.id}
              className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
              style={{ borderColor: "var(--border)", opacity: project.archived ? 0.55 : 1 }}
            >
              <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: project.color }} aria-hidden />
              {editingId === project.id ? (
                <input
                  autoFocus
                  type="text"
                  defaultValue={project.name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v) updateProject(project.id, { name: v });
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="min-w-0 flex-1 rounded border px-1.5 py-0.5 text-sm"
                  style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingId(project.id)}
                  className="flex-1 truncate text-left text-sm"
                  style={{ color: "var(--text)" }}
                  title="クリックして名前を編集"
                >
                  {project.name}
                  {project.archived && <span className="ml-1.5 text-xs" style={{ color: "var(--text-muted)" }}>(アーカイブ済み)</span>}
                </button>
              )}
              <ColorSwatchPicker value={project.color} onChange={(c) => updateProject(project.id, { color: c })} compact />
              <button
                type="button"
                onClick={() => setArchived(project.id, !project.archived)}
                className="rounded px-2 py-0.5 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                {project.archived ? "復元" : "アーカイブ"}
              </button>
              {confirmingDeleteId === project.id ? (
                <span className="flex items-center gap-1 text-xs">
                  <button type="button" onClick={() => deleteProject(project.id)} className="rounded px-1.5 py-0.5" style={{ color: "var(--danger)" }}>
                    削除する
                  </button>
                  <button type="button" onClick={() => setConfirmingDeleteId(null)} style={{ color: "var(--text-muted)" }}>
                    取消
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmingDeleteId(project.id)} className="rounded px-2 py-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  削除
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ColorSwatchPicker({ value, onChange, compact }: { value: string; onChange: (color: string) => void; compact?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {PROJECT_COLOR_SWATCHES.map((swatch) => (
        <button
          key={swatch}
          type="button"
          aria-label={`色 ${swatch}`}
          onClick={() => onChange(swatch)}
          className="rounded-full"
          style={{
            width: compact ? 14 : 18,
            height: compact ? 14 : 18,
            backgroundColor: swatch,
            outline: value === swatch ? "2px solid var(--text)" : "1px solid var(--border)",
            outlineOffset: 1,
          }}
        />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------
// Add task
// ------------------------------------------------------------------------

function AddTaskForm({
  projects,
  addTask,
  defaultProjectId,
}: {
  projects: Project[];
  addTask: (input: NewTaskInput) => string;
  defaultProjectId: string | null;
}) {
  const [title, setTitle] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId);
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [estimatedPomodoros, setEstimatedPomodoros] = useState(1);
  const [recurrence, setRecurrence] = useState<RecurrenceFrequency>("none");

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    addTask({
      title: trimmed,
      projectId,
      priority,
      dueDate: dueDate || null,
      notes,
      estimatedPomodoros,
      recurrence: { frequency: recurrence },
    });
    setTitle("");
    setNotes("");
    setDueDate("");
    setPriority("medium");
    setEstimatedPomodoros(1);
    setRecurrence("none");
  };

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
      <div className="flex gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !expanded) submit();
          }}
          placeholder="タスクを追加..."
          className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
        />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-lg border px-2.5 py-1.5 text-xs"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          {expanded ? "詳細を隠す" : "詳細"}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!title.trim()}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-contrast)" }}
        >
          追加
        </button>
      </div>

      {expanded && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <FieldSelect label="プロジェクト" value={projectId ?? ""} onChange={(v) => setProjectId(v || null)}>
            <option value="">なし</option>
            {projects
              .filter((p) => !p.archived)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </FieldSelect>
          <FieldSelect label="優先度" value={priority} onChange={(v) => setPriority(v as TaskPriority)}>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </FieldSelect>
          <FieldSelect label="繰り返し" value={recurrence} onChange={(v) => setRecurrence(v as RecurrenceFrequency)}>
            {(Object.keys(RECURRENCE_LABEL) as RecurrenceFrequency[]).map((f) => (
              <option key={f} value={f}>
                {RECURRENCE_LABEL[f]}
              </option>
            ))}
          </FieldSelect>
          <label className="flex flex-col gap-1 text-xs">
            <span style={{ color: "var(--text-muted)" }}>期限</span>
            <input
              type="date"
              value={dueDate}
              min={todayLocalISODate()}
              onChange={(e) => setDueDate(e.target.value)}
              className="rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span style={{ color: "var(--text-muted)" }}>見積もりポモドーロ数</span>
            <input
              type="number"
              min={0}
              max={99}
              value={estimatedPomodoros}
              onChange={(e) => setEstimatedPomodoros(Math.max(0, Number(e.target.value) || 0))}
              className="rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-xs sm:col-span-3">
            <span style={{ color: "var(--text-muted)" }}>メモ</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border px-2 py-1.5 text-sm"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
      >
        {children}
      </select>
    </label>
  );
}

// ------------------------------------------------------------------------
// Task row + inline editor
// ------------------------------------------------------------------------

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.completed) return false;
  return task.dueDate < todayLocalISODate();
}

function TaskRow({
  task,
  project,
  projects,
  isActive,
  isEditing,
  onToggleEdit,
  onSetActive,
  onToggleComplete,
  onDelete,
  onUpdate,
  onAddSubtask,
  onRemoveSubtask,
  onToggleSubtask,
}: {
  task: Task;
  project: Project | null;
  projects: Project[];
  isActive: boolean;
  isEditing: boolean;
  onToggleEdit: () => void;
  onSetActive: () => void;
  onToggleComplete: () => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<Task>) => void;
  onAddSubtask: (title: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const completedSubtasks = task.subtasks.filter((s) => s.completed).length;

  return (
    <div
      className="rounded-xl border p-3"
      style={{
        borderColor: isActive ? "var(--accent)" : "var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={task.completed}
          onClick={onToggleComplete}
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
          style={{ borderColor: task.completed ? "var(--accent)" : "var(--border)", backgroundColor: task.completed ? "var(--accent)" : "transparent" }}
        >
          {task.completed && (
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="var(--accent-contrast)" strokeWidth={3}>
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className="text-sm font-medium"
              style={{ color: task.completed ? "var(--text-muted)" : "var(--text)", textDecoration: task.completed ? "line-through" : "none" }}
            >
              {task.title}
            </span>
            {isActive && (
              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "var(--ring)", color: "var(--accent)" }}>
                作業中
              </span>
            )}
            {task.recurrence.frequency !== "none" && (
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }} title={RECURRENCE_LABEL[task.recurrence.frequency]}>
                ↻ {RECURRENCE_LABEL[task.recurrence.frequency]}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {project && (
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: project.color }} aria-hidden />
                {project.name}
              </span>
            )}
            <span style={{ color: PRIORITY_COLOR[task.priority] }}>優先度: {PRIORITY_LABEL[task.priority]}</span>
            {task.dueDate && <span style={{ color: isOverdue(task) ? "var(--danger)" : "var(--text-muted)" }}>期限: {task.dueDate}</span>}
            <span>🍅 {task.completedPomodoros}/{task.estimatedPomodoros}</span>
            {task.subtasks.length > 0 && (
              <span>
                サブタスク {completedSubtasks}/{task.subtasks.length}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onSetActive}
            title="タイマーの作業対象に設定"
            className="rounded-lg border px-2 py-1 text-xs"
            style={{
              borderColor: isActive ? "var(--accent)" : "var(--border)",
              color: isActive ? "var(--accent)" : "var(--text-muted)",
            }}
          >
            {isActive ? "作業中 ✓" : "選択"}
          </button>
          <button type="button" onClick={onToggleEdit} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
            {isEditing ? "閉じる" : "編集"}
          </button>
          {confirmingDelete ? (
            <span className="flex items-center gap-1 text-xs">
              <button type="button" onClick={onDelete} style={{ color: "var(--danger)" }}>
                削除する
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)} style={{ color: "var(--text-muted)" }}>
                取消
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
              削除
            </button>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <FieldSelect label="プロジェクト" value={task.projectId ?? ""} onChange={(v) => onUpdate({ projectId: v || null })}>
              <option value="">なし</option>
              {projects
                .filter((p) => !p.archived || p.id === task.projectId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </FieldSelect>
            <FieldSelect label="優先度" value={task.priority} onChange={(v) => onUpdate({ priority: v as TaskPriority })}>
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </FieldSelect>
            <FieldSelect
              label="繰り返し"
              value={task.recurrence.frequency}
              onChange={(v) => onUpdate({ recurrence: { ...task.recurrence, frequency: v as RecurrenceFrequency } })}
            >
              {(Object.keys(RECURRENCE_LABEL) as RecurrenceFrequency[]).map((f) => (
                <option key={f} value={f}>
                  {RECURRENCE_LABEL[f]}
                </option>
              ))}
            </FieldSelect>
            <label className="flex flex-col gap-1 text-xs">
              <span style={{ color: "var(--text-muted)" }}>期限</span>
              <input
                type="date"
                value={task.dueDate ?? ""}
                onChange={(e) => onUpdate({ dueDate: e.target.value || null })}
                className="rounded-lg border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span style={{ color: "var(--text-muted)" }}>見積もりポモドーロ数</span>
              <input
                type="number"
                min={0}
                max={99}
                value={task.estimatedPomodoros}
                onChange={(e) => onUpdate({ estimatedPomodoros: Math.max(0, Number(e.target.value) || 0) })}
                className="rounded-lg border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span style={{ color: "var(--text-muted)" }}>完了ポモドーロ数</span>
              <input
                type="number"
                min={0}
                max={999}
                value={task.completedPomodoros}
                onChange={(e) => onUpdate({ completedPomodoros: Math.max(0, Number(e.target.value) || 0) })}
                className="rounded-lg border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-xs sm:col-span-3">
              <span style={{ color: "var(--text-muted)" }}>メモ</span>
              <textarea
                value={task.notes}
                onChange={(e) => onUpdate({ notes: e.target.value })}
                rows={2}
                className="rounded-lg border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
              />
            </label>
          </div>

          <div className="mt-3">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              サブタスク
            </span>
            <div className="mt-1.5 flex flex-col gap-1">
              {task.subtasks.map((subtask) => (
                <div key={subtask.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={subtask.completed} onChange={() => onToggleSubtask(subtask.id)} />
                  <span
                    className="flex-1 text-sm"
                    style={{ color: subtask.completed ? "var(--text-muted)" : "var(--text)", textDecoration: subtask.completed ? "line-through" : "none" }}
                  >
                    {subtask.title}
                  </span>
                  <button type="button" onClick={() => onRemoveSubtask(subtask.id)} className="text-xs" style={{ color: "var(--text-muted)" }}>
                    削除
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={subtaskDraft}
                  onChange={(e) => setSubtaskDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && subtaskDraft.trim()) {
                      onAddSubtask(subtaskDraft);
                      setSubtaskDraft("");
                    }
                  }}
                  placeholder="サブタスクを追加..."
                  className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-xs"
                  style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (subtaskDraft.trim()) {
                      onAddSubtask(subtaskDraft);
                      setSubtaskDraft("");
                    }
                  }}
                  className="rounded-lg border px-2 py-1 text-xs"
                  style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                >
                  追加
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
