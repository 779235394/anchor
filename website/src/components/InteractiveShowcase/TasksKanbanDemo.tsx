import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Check, Plus, Sparkle } from '@phosphor-icons/react';
import type { Lang } from '@/i18n/copy';

type ColId = 'todo' | 'doing' | 'confirm' | 'done';

interface DemoTask {
  id: string;
  summary: string;
  project: string;
  projectColor: string;
  prio: 1 | 2 | 3;
  col: ColId;
  checklist?: string;
}

const COLS: Array<{ id: ColId; zh: string; en: string; dot: string }> = [
  { id: 'todo', zh: '待办', en: 'To Do', dot: 'var(--status-gray)' },
  { id: 'doing', zh: '进行中', en: 'In Progress', dot: 'var(--accent)' },
  { id: 'confirm', zh: '待确认', en: 'Review', dot: 'var(--status-orange)' },
  { id: 'done', zh: '已完成', en: 'Done', dot: 'var(--status-green)' },
];

const INITIAL_TASKS: Record<Lang, DemoTask[]> = {
  zh: [
    {
      id: 'k1',
      summary: '评审新版 Git 合并测试集并覆盖边界',
      project: '内核同步',
      projectColor: '#0A84FF',
      prio: 1,
      col: 'todo',
      checklist: '2/3',
    },
    {
      id: 'k2',
      summary: '优化知识库 PDF 导出分页与代码块折行',
      project: '知识库',
      projectColor: '#14B8A6',
      prio: 2,
      col: 'doing',
      checklist: '3/4',
    },
    {
      id: 'k3',
      summary: '校验 macOS Universal 签名包自动更新',
      project: '双端发布',
      projectColor: '#FF9F0A',
      prio: 1,
      col: 'confirm',
    },
    {
      id: 'k4',
      summary: '上线 Porcelain & Obsidian 双态玻璃令牌',
      project: '视觉体系',
      projectColor: '#30D158',
      prio: 3,
      col: 'done',
      checklist: '5/5',
    },
  ],
  en: [
    {
      id: 'k1',
      summary: 'Audit Git LWW merge edge cases',
      project: 'Sync Core',
      projectColor: '#0A84FF',
      prio: 1,
      col: 'todo',
      checklist: '2/3',
    },
    {
      id: 'k2',
      summary: 'Polish A4 vector PDF pagination & code wrap',
      project: 'Docs',
      projectColor: '#14B8A6',
      prio: 2,
      col: 'doing',
      checklist: '3/4',
    },
    {
      id: 'k3',
      summary: 'Verify Ed25519 signed macOS updater bundle',
      project: 'Release',
      projectColor: '#FF9F0A',
      prio: 1,
      col: 'confirm',
    },
    {
      id: 'k4',
      summary: 'Ship Porcelain & Obsidian glass token suite',
      project: 'Design',
      projectColor: '#30D158',
      prio: 3,
      col: 'done',
      checklist: '5/5',
    },
  ],
};

const NEXT_COL: Record<ColId, ColId> = {
  todo: 'doing',
  doing: 'confirm',
  confirm: 'done',
  done: 'todo',
};

const PRIO_COLOR: Record<1 | 2 | 3, string> = {
  1: 'var(--status-red)',
  2: 'var(--status-orange)',
  3: 'var(--status-sky)',
};

export function TasksKanbanDemo({
  lang,
  autoPlay,
  onInteract,
}: {
  lang: Lang;
  autoPlay: boolean;
  onInteract: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [tasks, setTasks] = useState<DemoTask[]>(() => INITIAL_TASKS[lang]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setTasks(INITIAL_TASKS[lang]);
  }, [lang]);

  // Subtle autonomous demo motion when user is watching
  useEffect(() => {
    if (!autoPlay || reduceMotion) return;
    const timer = window.setInterval(() => {
      setTasks((prev) => {
        const candidate = prev.find((t) => t.col !== 'done') || prev[0];
        if (!candidate) return prev;
        return prev.map((t) =>
          t.id === candidate.id ? { ...t, col: NEXT_COL[t.col] } : t,
        );
      });
    }, 2200);
    return () => window.clearInterval(timer);
  }, [autoPlay, reduceMotion]);

  const advanceTask = (id: string) => {
    onInteract();
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, col: NEXT_COL[t.col] } : t)),
    );
  };

  const toggleDone = (id: string) => {
    onInteract();
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, col: t.col === 'done' ? 'todo' : 'done' } : t,
      ),
    );
  };

  const addDraftTask = () => {
    onInteract();
    const trimmed = draft.trim();
    const summary =
      trimmed ||
      (lang === 'zh'
        ? '整理 v1.0.1 官网交互细节与验收清单'
        : 'Finalize v1.0.1 website motion checklist');
    const newTask: DemoTask = {
      id: `k-${Date.now()}`,
      summary: summary.split('\n')[0].replace(/^[-*#\s]+/, ''),
      project: lang === 'zh' ? '个人推进' : 'Personal',
      projectColor: '#0A84FF',
      prio: 2,
      col: 'todo',
    };
    setTasks((prev) => [newTask, ...prev.slice(0, 5)]);
    setDraft('');
  };

  return (
    <div className="space-y-4">
      {/* Single-Box Composer bar */}
      <div
        className="site-card flex flex-col gap-2.5 rounded-[14px] p-3 sm:flex-row sm:items-center"
      >
        <div className="flex flex-1 items-center gap-2.5">
          <Sparkle size={16} weight="duotone" style={{ color: 'var(--accent)' }} />
          <input
            type="text"
            value={draft}
            onFocus={onInteract}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDraftTask();
              }
            }}
            placeholder={
              lang === 'zh'
                ? '单框直接输入待办正文，首行自动派生摘要…'
                : 'Type directly in one box, first line becomes summary…'
            }
            aria-label={lang === 'zh' ? '快速新建演示待办' : 'Quick add demo task'}
            className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-[var(--text-3)]"
            style={{ color: 'var(--text-1)' }}
          />
        </div>
        <button
          type="button"
          onClick={addDraftTask}
          className="site-btn-primary h-8 shrink-0 px-3.5 text-[12.5px]"
        >
          <Plus size={14} weight="bold" />
          <span>{lang === 'zh' ? '快速入列' : 'Add Task'}</span>
        </button>
      </div>

      {/* 4-Column Spring Kanban */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {COLS.map((col) => {
          const colTasks = tasks.filter((t) => t.col === col.id);
          return (
            <div
              key={col.id}
              className="flex min-h-[210px] flex-col rounded-[14px] border p-3"
              style={{
                background: 'var(--bg-column)',
                borderColor: 'var(--hairline-soft)',
              }}
            >
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: col.dot }}
                  />
                  <span className="text-[12.5px] font-semibold" style={{ color: 'var(--text-1)' }}>
                    {lang === 'zh' ? col.zh : col.en}
                  </span>
                </div>
                <span
                  className="tabular-nums rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{ background: 'var(--bg-subtle)', color: 'var(--text-2)' }}
                >
                  {colTasks.length}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-2">
                <AnimatePresence mode="popLayout">
                  {colTasks.map((task) => {
                    const isDone = task.col === 'done';
                    return (
                      <motion.div
                        key={task.id}
                        layout={!reduceMotion}
                        layoutId={reduceMotion ? undefined : task.id}
                        initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={reduceMotion ? undefined : { opacity: 0, scale: 0.92 }}
                        transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                        className="site-card group rounded-[11px] p-2.5"
                      >
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() => toggleDone(task.id)}
                            aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
                            className="mt-0.5 flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border-2 transition-colors"
                            style={{
                              borderColor: isDone
                                ? 'var(--status-green)'
                                : PRIO_COLOR[task.prio],
                              background: isDone ? 'var(--status-green)' : 'transparent',
                            }}
                          >
                            {isDone && <Check size={10} weight="bold" color="#ffffff" />}
                          </button>
                          <p
                            className={`flex-1 text-[12.5px] leading-[1.45] ${
                              isDone ? 'line-through opacity-55' : ''
                            }`}
                            style={{ color: 'var(--text-1)' }}
                          >
                            {task.summary}
                          </p>
                        </div>

                        <div className="mt-2.5 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                              style={{
                                background: `color-mix(in srgb, ${task.projectColor} 15%, transparent)`,
                                color: task.projectColor,
                              }}
                            >
                              {task.project}
                            </span>
                            {task.checklist && (
                              <span
                                className="tabular-nums text-[10.5px]"
                                style={{ color: 'var(--text-3)' }}
                              >
                                ✓ {task.checklist}
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => advanceTask(task.id)}
                            title={lang === 'zh' ? '推进至下一列' : 'Advance column'}
                            className="flex h-6 w-6 items-center justify-center rounded-[6px] transition-colors hover:bg-[var(--bg-subtle-hover)]"
                            style={{
                              background: 'var(--bg-subtle)',
                              color: 'var(--text-2)',
                            }}
                          >
                            <ArrowRight size={12} weight="bold" />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
