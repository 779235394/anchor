import { shiftDate, todayStr } from '@/domain/date';
import type { DocEntry, DocFileContent, DocSearchHit } from '@/domain/docs';
import { getBaseName, normalizeDocRelPath } from '@/domain/docs';
import type {
  AccentColor,
  AppConfig,
  Lang,
  MobileServerStatus,
  ThemeMode,
  ViewKey,
  WorkspaceData,
  WorkspaceLoadResult,
} from '@/domain/types';

export interface DemoDocsStore {
  folders: Record<string, number>;
  files: Record<string, { content: string; updatedAt: number }>;
}

/**
 * Strictly gated website interactive showcase mode.
 * NEVER active inside Tauri desktop runtime and NEVER touches localStorage.
 */
export function isWebsiteDemoMode(): boolean {
  if (typeof window === 'undefined' || '__TAURI_INTERNALS__' in window) return false;
  try {
    return new URLSearchParams(window.location.search).get('demo') === '1';
  } catch {
    return false;
  }
}

export function getDemoQueryParams(): {
  theme: ThemeMode;
  accent: AccentColor;
  lang: Lang;
  view: ViewKey | null;
} {
  if (typeof window === 'undefined') {
    return { theme: 'dark', accent: 'blue', lang: 'zh', view: null };
  }
  const params = new URLSearchParams(window.location.search);
  const rawTheme = params.get('theme');
  const theme: ThemeMode = rawTheme === 'light' || rawTheme === 'dark' ? rawTheme : 'dark';
  const rawAccent = params.get('accent');
  const accent: AccentColor =
    rawAccent === 'blue' || rawAccent === 'indigo' || rawAccent === 'teal' || rawAccent === 'graphite'
      ? rawAccent
      : 'blue';
  const lang: Lang = params.get('lang') === 'en' ? 'en' : 'zh';
  const rawView = params.get('view') as ViewKey | null;
  const validViews: ViewKey[] = [
    'tasks',
    'kanban',
    'schedule',
    'projects',
    'knowledge',
    'notes',
    'stickies',
    'review',
    'settings',
  ];
  const view = rawView && validViews.includes(rawView) ? rawView : null;
  return { theme, accent, lang, view };
}

function buildDemoWorkspace(lang: Lang): WorkspaceData {
  const today = todayStr();
  const now = Date.now();
  const hour = 3600 * 1000;
  const day = 24 * hour;
  const zh = lang === 'zh';

  const projects = [
    { id: 'proj_core', name: zh ? '内核架构' : 'Core Engine', color: 'blue' as const, createdAt: now - 14 * day, updatedAt: now - day },
    { id: 'proj_docs', name: zh ? '知识沉淀' : 'Knowledge Docs', color: 'teal' as const, createdAt: now - 12 * day, updatedAt: now - day },
    { id: 'proj_release', name: zh ? '双端发版' : 'Release Pipeline', color: 'orange' as const, createdAt: now - 10 * day, updatedAt: now - day },
    { id: 'proj_design', name: zh ? '视觉美学' : 'Glass Craft', color: 'indigo' as const, createdAt: now - 8 * day, updatedAt: now - day },
  ];

  const tasks = [
    {
      id: 'demo_t1',
      title: zh ? '评审 Q4 同步协议边界与冲突自愈用例' : 'Audit Q4 Git LWW sync edge cases',
      note: zh
        ? '评审 Q4 同步协议边界与冲突自愈用例\n\n- [x] 验证 macOS 与 Windows 双端离线分片合并\n- [x] 核对 30 天软删除墓碑防复活规则\n- [ ] 补充断网重连提示文案与重试策略'
        : 'Audit Q4 Git LWW sync edge cases\n\n- [x] Verify macOS & Windows offline shard merge\n- [x] Confirm 30-day soft-delete tombstone rules\n- [ ] Polish reconnect retry copy',
      prio: 1 as const,
      status: 'doing' as const,
      startDate: today,
      due: shiftDate(today, 1),
      startTime: '10:00',
      endTime: '11:30',
      order: 100,
      done: false,
      doneAt: null,
      projectId: 'proj_core',
      rolls: 0,
      carriedDate: null,
      attachments: [
        {
          id: 'att_1',
          kind: 'link' as const,
          name: 'Anchor GitHub Repository',
          url: 'https://github.com/779235394/anchor',
          createdAt: now - 3 * hour,
        },
      ],
      createdAt: now - 2 * day,
      updatedAt: now - hour,
    },
    {
      id: 'demo_t2',
      title: zh ? '打磨知识库 A4 矢量 PDF 导出分页与代码块折行' : 'Refine A4 vector PDF pagination & code wrap',
      note: zh
        ? '打磨知识库 A4 矢量 PDF 导出分页与代码块折行\n\n- [x] 对齐 macOS NSPrintOperation 与 Windows WebView2 边距\n- [ ] 检查超长表格跨页表头重复显示'
        : 'Refine A4 vector PDF pagination & code wrap\n\n- [x] Align macOS NSPrintOperation & WebView2 margins\n- [ ] Check long table page break protection',
      prio: 2 as const,
      status: 'todo' as const,
      startDate: today,
      due: shiftDate(today, 2),
      startTime: '14:30',
      endTime: '16:00',
      order: 200,
      done: false,
      doneAt: null,
      projectId: 'proj_docs',
      rolls: 0,
      carriedDate: null,
      attachments: [],
      createdAt: now - 2 * day,
      updatedAt: now - 2 * hour,
    },
    {
      id: 'demo_t3',
      title: zh ? '校验 macOS Universal 与 Windows NSIS 签名包' : 'Verify signed macOS Universal & Windows NSIS builds',
      note: zh
        ? '校验 macOS Universal 与 Windows NSIS 签名包\n\n确认 `latest.json` 公钥验签通过，应用内进度条下载并原地重启无异常。'
        : 'Verify signed macOS Universal & Windows NSIS builds\n\nVerify `latest.json` Ed25519 signature check and seamless relaunch.',
      prio: 1 as const,
      status: 'confirm' as const,
      startDate: shiftDate(today, -1),
      due: today,
      order: 100,
      done: false,
      doneAt: null,
      projectId: 'proj_release',
      rolls: 1,
      carriedDate: today,
      attachments: [],
      createdAt: now - 3 * day,
      updatedAt: now - 30 * 60 * 1000,
    },
    {
      id: 'demo_t4',
      title: zh ? '整理用户访谈记录并沉淀至知识库专题' : 'Consolidate user notes into Knowledge Base guide',
      note: zh
        ? '整理用户访谈记录并沉淀至知识库专题\n\n多选本周灵感卡片一键合并，保留便携相对路径图片。'
        : 'Consolidate user notes into Knowledge Base guide\n\nBatch-merge weekly notes with portable relative image paths.',
      prio: 3 as const,
      status: 'todo' as const,
      due: shiftDate(today, 3),
      order: 300,
      done: false,
      doneAt: null,
      projectId: 'proj_docs',
      rolls: 0,
      carriedDate: null,
      attachments: [],
      createdAt: now - day,
      updatedAt: now - 4 * hour,
    },
    {
      id: 'demo_t5',
      title: zh ? '上线 Porcelain & Obsidian 五级玻璃视觉体系' : 'Ship Porcelain & Obsidian 5-layer glass tokens',
      note: zh
        ? '上线 Porcelain & Obsidian 五级玻璃视觉体系\n\n- [x] L0 极光冷雾画布与 4 档强调色联动\n- [x] 全部 9 视图吸顶毛玻璃与悬浮 L3 抽屉'
        : 'Ship Porcelain & Obsidian 5-layer glass tokens\n\n- [x] L0 Aurora canvas with 4 system accents\n- [x] Sticky frosted headers across all 9 views',
      prio: 2 as const,
      status: 'done' as const,
      startDate: shiftDate(today, -3),
      due: shiftDate(today, -1),
      order: 100,
      done: true,
      doneAt: now - 5 * hour,
      projectId: 'proj_design',
      rolls: 0,
      carriedDate: null,
      attachments: [],
      createdAt: now - 5 * day,
      updatedAt: now - 5 * hour,
    },
    {
      id: 'demo_t6',
      title: zh ? '完成移动端 5-Tab 扫码协作实时 SSE 联调' : 'Ship QR Mobile Companion 5-Tab live SSE sync',
      note: zh
        ? '完成移动端 5-Tab 扫码协作实时 SSE 联调\n\n手机 4G/5G 扫码一次性配对，待办勾选毫秒同步回桌面托盘。'
        : 'Ship QR Mobile Companion 5-Tab live SSE sync\n\nOne-time QR pairing over encrypted tunnel with live desktop tray updates.',
      prio: 1 as const,
      status: 'done' as const,
      due: today,
      order: 200,
      done: true,
      doneAt: now - 2 * hour,
      projectId: 'proj_core',
      rolls: 0,
      carriedDate: null,
      attachments: [],
      createdAt: now - 4 * day,
      updatedAt: now - 2 * hour,
    },
    {
      id: 'demo_t7',
      title: zh ? '设计下月复盘模板与年度里程碑排期' : 'Draft monthly review cadence & roadmap spans',
      note: zh
        ? '设计下月复盘模板与年度里程碑排期\n\n拖入日历格即可自动排期并生成跨天玻璃横条。'
        : 'Draft monthly review cadence & roadmap spans\n\nDrag directly onto the calendar to schedule.',
      prio: 3 as const,
      status: 'todo' as const,
      due: '',
      order: 400,
      done: false,
      doneAt: null,
      projectId: 'proj_design',
      rolls: 0,
      carriedDate: null,
      attachments: [],
      createdAt: now - 12 * hour,
      updatedAt: now - 12 * hour,
    },
  ];

  const notes = [
    {
      id: 'demo_n1',
      text: zh
        ? '核心体验打磨备忘：快捷悬浮小窗在 macOS 原生全屏下用 `NonactivatingPanel` 呼出后不切 Space，顺手度直接拉满。\n- [x] 已验证中文输入法候选窗层级\n- [x] 支持自定义快捷键录制热更新'
        : 'Quick capture polish: macOS `NonactivatingPanel` floats cleanly over native fullscreen spaces without jumping desktops.\n- [x] Verified IME candidate window level\n- [x] Hot-reloads custom shortcut recordings',
      tags: zh ? ['交互细节', 'macOS'] : ['UX', 'macOS'],
      attachments: [],
      createdAt: now - 3 * hour,
      updatedAt: now - 3 * hour,
    },
    {
      id: 'demo_n2',
      text: zh
        ? '关于本地明文主权：所有数据以标准 JSON 分片与 `.md` 文件躺在个人目录里，既能用 Git 做跨机版本历史，也能随时让本地 AI Agent 直接分析周报。'
        : 'Plain-text ownership: sharded JSON and real `.md` files make Git diffs clean and let local AI tools inspect your workspace directly.',
      tags: zh ? ['架构原则', 'Local-First'] : ['Architecture', 'Local-First'],
      attachments: [],
      createdAt: now - day,
      updatedAt: now - day,
    },
    {
      id: 'demo_n3',
      text: zh
        ? '移动端扫码打开后无需安装 App，地铁上随时补一条灵感或拍白板插图，回到工位电脑上已经静默同步完毕。'
        : 'Zero-install mobile web: capture whiteboard photos on the commute and see them synced straight into your desktop workspace.',
      tags: zh ? ['移动端', '场景灵感'] : ['Mobile', 'Workflow'],
      attachments: [],
      createdAt: now - 2 * day,
      updatedAt: now - 2 * day,
    },
  ];

  const stickies = [
    {
      id: 'demo_s1',
      title: '',
      content: zh
        ? '15:30 评审要点\n- [x] 核对白瓷/曜石高光边框\n- [ ] 确认 Windows 安装器图标清晰度'
        : '15:30 Review Points\n- [x] Verify Porcelain/Obsidian specular rim\n- [ ] Check Windows installer icon',
      color: 'yellow' as const,
      pinned: true,
      autoOpen: true,
      createdAt: now - 6 * hour,
      updatedAt: now - hour,
    },
    {
      id: 'demo_s2',
      title: '',
      content: zh
        ? '快捷键备忘\n⌥ Space 全局呼出速记\n⌥⇧N 随时新建置顶便签\n⌘K Spotlight 全局瞬搜'
        : 'Shortcuts\n⌥ Space Global Quick Capture\n⌥⇧N New Pinned Sticky\n⌘K Spotlight Search',
      color: 'blue' as const,
      pinned: true,
      autoOpen: false,
      createdAt: now - day,
      updatedAt: now - 4 * hour,
    },
    {
      id: 'demo_s3',
      title: '',
      content: zh
        ? '本周重点推进目标\n1. 官网 2.0 沉浸式真机演示上线\n2. 补齐 v1.0.1 双端发版回归验证'
        : 'Weekly Focus\n1. Launch Website 2.0 live desktop cinema\n2. Finish v1.0.1 dual-platform QA',
      color: 'green' as const,
      pinned: false,
      autoOpen: false,
      createdAt: now - 2 * day,
      updatedAt: now - day,
    },
    {
      id: 'demo_s4',
      title: '',
      content: zh
        ? '产品原则提醒\n克制通透、景深分层、发丝高光，不为花哨牺牲一毫秒输入手感。'
        : 'Design Principle\nRestrained translucency, crisp elevation layers, never trade input latency for ornament.',
      color: 'pink' as const,
      pinned: false,
      autoOpen: false,
      createdAt: now - 3 * day,
      updatedAt: now - 2 * day,
    },
  ];

  return {
    meta: {
      schemaVersion: 1,
      lastOpenDate: today,
      hasSample: false,
      lastExportAt: null,
    },
    tasks,
    projects,
    notes,
    stickies,
  };
}

function buildDemoDocs(lang: Lang): DemoDocsStore {
  const now = Date.now();
  const zh = lang === 'zh';

  if (!zh) {
    return {
      folders: {
        Design: now - 3600_000,
        Engineering: now - 7200_000,
        Review: now - 10_800_000,
      },
      files: {
        'Design/Porcelain-Obsidian-Spec.md': {
          updatedAt: now - 1800_000,
          content: `# Porcelain & Obsidian Glass Spec

Anchor uses a five-layer elevation grammar across macOS and Windows with 100% visual parity.

## Five Elevation Layers

- **L0 Aurora Mist Canvas**: Subtle accent-linked radial atmosphere behind the floating workspace shell.
- **L1 Frosted Structure**: Sidebar, Kanban columns, and docs tree with \`blur(22px)\`.
- **L2 Porcelain / Obsidian Cards**: High-contrast opaque surfaces with \`1px\` top specular highlights.
- **L3 Floating Drawers**: Non-disruptive task inspector overlays and bubble toolbars.
- **L4 System Islands**: Global Quick Capture (\`⌥ Space\`) and multi-window desktop stickies.

## Verification Checklist

- [x] Dual theme parity (Porcelain Light & Obsidian Dark)
- [x] Four live system accents (Blue, Indigo, Teal, Graphite)
- [x] Portable relative attachment paths inside \`docs/\`
- [ ] Export this document as crisp A4 vector PDF
`,
        },
        'Engineering/Local-First-Git-Sync.md': {
          updatedAt: now - 5400_000,
          content: `# Local-First Storage & Git LWW Sync

Every task, project, note, and sticky lives in plain UTF-8 JSON alongside real \`.md\` files.

\`\`\`json
{
  "storageMode": "git",
  "atomicWrite": "tmp -> sync_all -> rename",
  "conflictResolution": "record-level LWW + 30d tombstones"
}
\`\`\`

## Key Guarantees

- Zero cloud lock-in: bind any private Gitee, GitLab, GitHub, or self-hosted Git repo.
- Auto-push stays **off** by default so you keep full control.
`,
        },
        'Review/2026-W48-Summary.md': {
          updatedAt: now - 9000_000,
          content: `# Weekly Review · 2026-W48

## Highlights
- Completed 100% of Porcelain & Obsidian Glass UI tokens across 9 views.
- Shipped QR mobile companion with encrypted tunnel and live SSE updates.
`,
        },
      },
    };
  }

  return {
    folders: {
      '产品设计': now - 3600_000,
      '工程架构': now - 7200_000,
      '复盘归档': now - 10_800_000,
    },
    files: {
      '产品设计/白瓷与曜石视觉规范.md': {
        updatedAt: now - 1800_000,
        content: `# 白瓷与曜石玻璃视觉规范（v1.0）

Anchor 在 macOS 与 Windows 上采用完全一致的五级玻璃景深与 1px 顶部镜面高光体系，保证长时间深度专注下的高信噪比。

## 五级景深层级

- **L0 极光冷雾画布**：随 4 档强调色柔和呼吸的底板氛围。
- **L1 磨砂结构层**：侧边导航栏、看板列与知识库目录树，应用 \`blur(22px)\` 磨砂玻璃。
- **L2 瓷质 / 曜石卡片层**：高对比聚焦卡片，顶部 1px 镜面内高光，滚动 60fps 丝滑无负担。
- **L3 悬浮交互层**：任务详情悬浮抽屉、划词气泡工具条，点击即出、不挤压网格。
- **L4 系统悬浮岛**：\`⌥ Space\` 跨全屏快捷速记与多开 6 色置顶桌面便签。

## 阅读态交互验收（试试直接勾选）

- [x] 白瓷浅色与曜石深色双态一致
- [x] 4 档强调色全站实时联动（苹果蓝 / 静谧靛 / 深海青 / 冷石墨）
- [x] 图片采用便携相对路径归档，脱离 Anchor 用 VS Code 依然可读
- [ ] 一键导出标准 A4 矢量 PDF（支持文字选中与精准分页）
`,
      },
      '工程架构/本地明文与Git自愈同步.md': {
        updatedAt: now - 5400_000,
        content: `# 本地明文存储与通用 Git 同步

所有个人数据均以标准 UTF-8 JSON 分片与原生 \`.md\` 文件落盘，零私有二进制黑盒。

\`\`\`json
{
  "storageMode": "local | git",
  "atomicWrite": "tmp -> sync_all -> rename",
  "conflictHealing": "记录级 LWW 合并 + 30 天墓碑保护"
}
\`\`\`

## 同步策略

- 支持任意私有 Git 仓库（Gitee / GitLab / GitHub / 自建 GitLab）。
- 凭据仅通过临时 \`GIT_ASKPASS\` 注入，永不写入仓库配置。
- \`gitAutoPush\` 默认关闭，保持本地优先的掌控感。
`,
      },
      '复盘归档/2026-W48-周复盘.md': {
        updatedAt: now - 9000_000,
        content: `# 2026-W48 个人复盘报告

## 本周核心交付
- 落地 Porcelain & Obsidian Glass 全端 UI 换代（9 大视图 + 移动端 5 Tab）。
- 打通手机 4G/5G 扫码直连与知识库阅读态勾选清单回写。
`,
      },
    },
  };
}

// Pure in-memory session state for ?demo=1 (never touches user localStorage)
let memLang: Lang | null = null;
let memConfig: AppConfig | null = null;
let memWorkspace: WorkspaceData | null = null;
let memDocs: DemoDocsStore | null = null;

function ensureDemoState(defaultConfig: AppConfig): void {
  const initial = getDemoQueryParams();
  if (!memLang) memLang = initial.lang;
  if (!memConfig) {
    memConfig = {
      ...defaultConfig,
      theme: initial.theme,
      accent: initial.accent,
      lang: initial.lang,
      localDataDir: '~/Documents/Anchor',
      dataDir: '~/Documents/Anchor',
    };
  }
  if (!memWorkspace) {
    memWorkspace = buildDemoWorkspace(memLang);
  }
  if (!memDocs) {
    memDocs = buildDemoDocs(memLang);
  }
}

export function resetDemoLanguage(lang: Lang, defaultConfig: AppConfig): WorkspaceData {
  ensureDemoState(defaultConfig);
  memLang = lang;
  memWorkspace = buildDemoWorkspace(lang);
  memDocs = buildDemoDocs(lang);
  if (memConfig) {
    memConfig = { ...memConfig, lang };
  }
  return memWorkspace;
}

export function getDemoConfig(defaultConfig: AppConfig): AppConfig {
  ensureDemoState(defaultConfig);
  return { ...memConfig! };
}

export function saveDemoConfig(config: AppConfig): AppConfig {
  memConfig = { ...config };
  return { ...memConfig };
}

export function loadDemoWorkspace(defaultConfig: AppConfig): WorkspaceLoadResult {
  ensureDemoState(defaultConfig);
  return {
    data: memWorkspace!,
    isNewWorkspace: false,
    warnings: [],
  };
}

export function saveDemoWorkspace(data: WorkspaceData): void {
  memWorkspace = data;
}

export function getDemoFlagshipDocPath(lang: Lang): string {
  return lang === 'en' ? 'Design/Porcelain-Obsidian-Spec.md' : '产品设计/白瓷与曜石视觉规范.md';
}

export function demoDocsList(defaultConfig: AppConfig): DocEntry[] {
  ensureDemoState(defaultConfig);
  const s = memDocs!;
  const entries: DocEntry[] = [];
  for (const [relPath, updatedAt] of Object.entries(s.folders)) {
    entries.push({ relPath, name: getBaseName(relPath), isDir: true, updatedAt, size: 0 });
  }
  for (const [relPath, file] of Object.entries(s.files)) {
    entries.push({
      relPath,
      name: getBaseName(relPath),
      isDir: false,
      updatedAt: file.updatedAt,
      size: file.content.length,
    });
  }
  return entries;
}

export function demoDocsRead(relPath: string, defaultConfig: AppConfig): DocFileContent {
  ensureDemoState(defaultConfig);
  const norm = normalizeDocRelPath(relPath);
  const file = memDocs!.files[norm];
  if (!file) throw new Error(`Document not found: ${norm}`);
  return { relPath: norm, content: file.content, updatedAt: file.updatedAt };
}

export function demoDocsWrite(
  relPath: string,
  content: string,
  defaultConfig: AppConfig,
): DocFileContent {
  ensureDemoState(defaultConfig);
  const norm = normalizeDocRelPath(relPath);
  const now = Date.now();
  const parts = norm.split('/');
  for (let i = 1; i < parts.length; i += 1) {
    const dir = parts.slice(0, i).join('/');
    if (!memDocs!.folders[dir]) memDocs!.folders[dir] = now;
  }
  memDocs!.files[norm] = { content, updatedAt: now };
  return { relPath: norm, content, updatedAt: now };
}

export function demoDocsCreateFolder(relPath: string, defaultConfig: AppConfig): DocEntry {
  ensureDemoState(defaultConfig);
  const norm = normalizeDocRelPath(relPath);
  const now = Date.now();
  memDocs!.folders[norm] = now;
  return { relPath: norm, name: getBaseName(norm), isDir: true, updatedAt: now, size: 0 };
}

export function demoDocsSearch(query: string, defaultConfig: AppConfig): DocSearchHit[] {
  ensureDemoState(defaultConfig);
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: DocSearchHit[] = [];
  for (const [relPath, file] of Object.entries(memDocs!.files)) {
    const name = getBaseName(relPath);
    if (
      relPath.toLowerCase().includes(q) ||
      name.toLowerCase().includes(q) ||
      file.content.toLowerCase().includes(q)
    ) {
      const snippet =
        file.content
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l.toLowerCase().includes(q)) || '';
      hits.push({ relPath, name, snippet: snippet.slice(0, 100), updatedAt: file.updatedAt });
    }
  }
  return hits;
}

export function getDemoMobileServerStatus(): MobileServerStatus {
  const now = Date.now();
  return {
    running: true,
    port: 21890,
    baseUrl: 'https://anchor-demo.trycloudflare.com',
    pairUrl: 'https://779235394.github.io/anchor/',
    pairExpiresAt: now + 5 * 60 * 1000,
    pairConsumed: false,
    tunnel: {
      state: 'connected',
      publicUrl: 'https://anchor-demo.trycloudflare.com',
      error: null,
      binaryPath: 'embedded/cloudflared',
    },
    sessions: [
      {
        id: 'sess_demo_1',
        deviceName: 'iPhone 16 Pro · Safari',
        clientIp: '100.64.0.12',
        pairedAt: now - 14 * 60 * 1000,
        lastSeenAt: now - 8000,
      },
    ],
    autoStopMinutes: 120,
    lastActivityAt: now - 8000,
  };
}
