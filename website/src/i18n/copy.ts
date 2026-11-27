export type Lang = 'zh' | 'en';
export type ThemeMode = 'dark' | 'light';
export type AccentKey = 'blue' | 'indigo' | 'teal' | 'graphite';

export const WEBSITE_URL = 'https://779235394.github.io/anchor/';
export const REPO_SLUG = '779235394/anchor';
export const REPO_URL = `https://github.com/${REPO_SLUG}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`;
export const FALLBACK_VERSION = '1.0.1';

export interface SiteCopy {
  nav: {
    showcase: string;
    principles: string;
    highlights: string;
    download: string;
    themeToLight: string;
    themeToDark: string;
    langLabel: string;
  };
  cta: {
    downloadMac: string;
    downloadWin: string;
    downloadDefault: string;
    viewGithub: string;
    allReleases: string;
  };
  hero: {
    titleLine1: string;
    titleLine2: string;
    subtext: string;
    stageTodoTitle: string;
    stageTodoItems: Array<{ id: string; text: string; prio: 'P1' | 'P2' | 'P3'; done: boolean }>;
    stageQuickLabel: string;
    stageQuickHint: string;
    stageSyncLabel: string;
    stageSyncValue: string;
    stageStickyTitle: string;
    stageStickyBody: string;
  };
  showcase: {
    heading: string;
    subtext: string;
    autoPlayOn: string;
    autoPlayPaused: string;
    interactiveTip: string;
    tabs: Array<{
      id: 'kanban' | 'schedule' | 'capture' | 'knowledge' | 'mobile' | 'review';
      label: string;
      shortLabel: string;
      summary: string;
    }>;
  };
  principles: {
    heading: string;
    subtext: string;
    cards: Array<{
      id: 'local' | 'git' | 'native' | 'glass';
      title: string;
      body: string;
      points: string[];
    }>;
    compareObsidian: string;
    comparePorcelain: string;
    compareDragHint: string;
    gitConflictBtn: string;
    gitResolvedLabel: string;
  };
  bento: {
    heading: string;
    subtext: string;
    spotlightTitle: string;
    spotlightDesc: string;
    spotlightPlaceholder: string;
    accentTitle: string;
    accentDesc: string;
    accentNames: Record<AccentKey, string>;
    pasteTitle: string;
    pasteDesc: string;
    pasteTrigger: string;
    pasteArchived: string;
    snapshotTitle: string;
    snapshotDesc: string;
    snapshotRestore: string;
    snapshotRestored: string;
    panelTitle: string;
    panelDesc: string;
    sovereigntyTitle: string;
    sovereigntyDesc: string;
  };
  downloads: {
    heading: string;
    subtext: string;
    recommended: string;
    macTitle: string;
    macDesc: string;
    macFileNote: string;
    winTitle: string;
    winDesc: string;
    winFileNote: string;
    msiAlt: string;
    latestLabel: string;
    loadingRelease: string;
    releaseNotesToggle: string;
    releaseNotesHide: string;
    fallbackNotice: string;
    stepsTitle: string;
    steps: Array<{ title: string; detail: string }>;
  };
  footer: {
    tagline: string;
    repo: string;
    releases: string;
    changelog: string;
    copyright: string;
    rights: string;
  };
}

export const SITE_COPY: Record<Lang, SiteCopy> = {
  zh: {
    nav: {
      showcase: '交互演示',
      principles: '核心内核',
      highlights: '细节亮点',
      download: '下载安装',
      themeToLight: '切至白瓷浅色',
      themeToDark: '切至曜石深色',
      langLabel: 'EN',
    },
    cta: {
      downloadMac: '下载 macOS 通用版',
      downloadWin: '下载 Windows 64 位',
      downloadDefault: '下载桌面版',
      viewGithub: '查看 GitHub',
      allReleases: '查看全部版本',
    },
    hero: {
      titleLine1: '锚定每天最重要的一件事',
      titleLine2: '本地优先的个人桌面工作台',
      subtext: '用白瓷与曜石玻璃重塑个人推进节奏。待办、看板、农历排期、知识库与手机扫码直连，数据 100% 留在本机。',
      stageTodoTitle: '今天推进',
      stageTodoItems: [
        { id: 'h1', text: '评审 Q4 核心接口方案并确认边界', prio: 'P1', done: false },
        { id: 'h2', text: '整理客户反馈沉淀至知识库文档', prio: 'P2', done: true },
        { id: 'h3', text: '发布 Anchor v1.0.1 双端更新包', prio: 'P1', done: false },
      ],
      stageQuickLabel: '全局悬浮速记',
      stageQuickHint: '跨全屏瞬时唤起',
      stageSyncLabel: 'Git 明文同步',
      stageSyncValue: '已同步 · 零冲突',
      stageStickyTitle: '桌面置顶便签',
      stageStickyBody: '15:30 站会确认导出 PDF 页边距与暗色高光对比度',
    },
    showcase: {
      heading: '每一项核心能力，现在就能动手体验',
      subtext: '这不是静态截图。点击切换六大高频工作流，直接勾选待办、推进看板、弹出快捷小窗或触发手机实时同步。',
      autoPlayOn: '自动演示中',
      autoPlayPaused: '互动接管中',
      interactiveTip: '点击任意控件即可接管操作',
      tabs: [
        {
          id: 'kanban',
          label: '待办与四列看板',
          shortLabel: '待办看板',
          summary: '单框正文自动派生摘要，卡片在待办、进行中、待确认与已完成间弹簧流转。',
        },
        {
          id: 'schedule',
          label: '农历日程排期',
          shortLabel: '日程排期',
          summary: '零依赖精准农历与跨天连续横条，未排期任务一键飞入日历，支持月与周时间轴切换。',
        },
        {
          id: 'capture',
          label: '快捷小窗与便签',
          shortLabel: '快捷与便签',
          summary: '全局快捷键跨原生全屏悬浮唤起速记，多开六色磨砂桌面便签逐张独立置顶。',
        },
        {
          id: 'knowledge',
          label: '知识库与灵感沉淀',
          shortLabel: '知识库',
          summary: '真实多级目录与原生 Markdown，多条碎片灵感一键合并成篇并直出 A4 矢量 PDF。',
        },
        {
          id: 'mobile',
          label: '手机扫码跨网协作',
          shortLabel: '手机扫码',
          summary: '电脑作为本地主机，内置安全加密通道，手机免装 App 跨 4G/5G 扫码实时双向同步。',
        },
        {
          id: 'review',
          label: '多维复盘报告',
          shortLabel: '多维复盘',
          summary: '按日、周、月、年与自定义范围聚合推进数据，一键复制纯净 Markdown 报告。',
        },
      ],
    },
    principles: {
      heading: '四条不可妥协的工程底线',
      subtext: '软件应该长期服务你的专注与数据主权，而不是把个人积累锁进封闭云端。',
      cards: [
        {
          id: 'local',
          title: '100% 本地明文文件夹',
          body: '所有任务、项目、灵感、便签与知识库文档以标准 UTF-8 JSON 和真实 .md 文件躺在你的磁盘里。随时用 VS Code、Git 或本地 AI 直接读写。',
          points: ['无专有数据库黑盒', 'Rust 原子写盘防损坏', '附件便携相对路径归档'],
        },
        {
          id: 'git',
          title: '任意 Git 同步与无损合并',
          body: '不绑定任何云厂商。支持 Gitee、GitLab、GitHub 与自建私有 Git，多端离线修改冲突时按记录级 LWW 自动合并，绝不丢一条数据。',
          points: ['自动推送默认关闭，掌控感在线', '临时 ASKPASS 本机凭据隔离', '30 天软删除墓碑防误复活'],
        },
        {
          id: 'native',
          title: 'Rust + Tauri 2 原生内核',
          body: '告别臃肿网页套壳。启动秒开、低内存常驻系统托盘，macOS 端通过原生 NSPanel 突破全屏空间遮挡，支持 Ed25519 数字签名应用内原地直更。',
          points: ['macOS Universal + Windows x64', '每小时静默检测与签名校验', '外部文件变动 500ms 热重载'],
        },
        {
          id: 'glass',
          title: '白瓷与曜石双态玻璃美学',
          body: '五级景深与 1px 镜面发丝高光，在 macOS 与 Windows 上呈现 100% 一致的通透层次。拖动下方滑杆，现场对比深浅双态质感。',
          points: ['双端 60fps 分层毛玻璃性能边界', '自动适配减弱透明度与动态效果', '桌面 9 视图与移动端令牌同源'],
        },
      ],
      compareObsidian: '曜石玻璃 Obsidian',
      comparePorcelain: '白瓷玻璃 Porcelain',
      compareDragHint: '左右拖动对比材质',
      gitConflictBtn: '模拟双端冲突并自动合并',
      gitResolvedLabel: '已按记录级 LWW 无损合流，零手工解冲突',
    },
    bento: {
      heading: '把顺手藏进每一次高频操作',
      subtext: '没有花哨打扰，每一处微交互都围绕高密度个人工作反复打磨。',
      spotlightTitle: 'Spotlight 跨模块瞬搜',
      spotlightDesc: '按下 ⌘K，毫秒直达任意待办、项目、知识库文档、灵感与附件。试试输入关键词：',
      spotlightPlaceholder: '试试输入「排期」「知识库」「PDF」…',
      accentTitle: '四档系统强调色联动',
      accentDesc: '点击下方色点，立即预览整页极光氛围与高光微调效果。',
      accentNames: {
        blue: '苹果蓝',
        indigo: '静谧靛',
        teal: '深海青',
        graphite: '冷石墨',
      },
      pasteTitle: '智能粘贴截图与本地路径',
      pasteDesc: '在正文或检视器任意位置直接粘贴截图、访达或微信路径，自动归档至工作区附件目录。',
      pasteTrigger: '模拟粘贴截图',
      pasteArchived: '已归档至 attachments/shot-04.png',
      snapshotTitle: '7 天自动滚动快照',
      snapshotDesc: '每日首次写入自动留存恢复点，配合损坏文件自动备份自愈，安心推进不怕误操作。',
      snapshotRestore: '一键演练回溯',
      snapshotRestored: '已校验 7 份快照完整可用',
      panelTitle: '全局双热键与托盘计数',
      panelDesc: 'macOS 与 Windows 双端统一正式图标，托盘实时显示今日未完成数，快捷键随时录制热更新。',
      sovereigntyTitle: '纯净独立，保留所有权利',
      sovereigntyDesc: '无强制登录、无广告推荐、无示例数据污染。开箱即是一张干净的个人深度工作台。',
    },
    downloads: {
      heading: '立即下载 Anchor 桌面版',
      subtext: '免费下载安装器，支持 macOS（Apple Silicon 与 Intel 通用）及 Windows 64 位。',
      recommended: '推荐你的系统',
      macTitle: 'macOS 通用版',
      macDesc: '原生支持 Apple Silicon（M 系列）与 Intel 芯片',
      macFileNote: 'Universal .dmg 直接拖入应用程序',
      winTitle: 'Windows 64 位',
      winDesc: '支持 Windows 10 / 11，提供 NSIS 与 MSI 双安装器',
      winFileNote: 'x64-setup.exe 一键静默安装',
      msiAlt: '下载 .msi 企业安装包',
      latestLabel: '当前最新版本',
      loadingRelease: '正在同步 GitHub Releases 最新版本…',
      releaseNotesToggle: '查看本版更新日志',
      releaseNotesHide: '收起更新日志',
      fallbackNotice: '已切换至 GitHub Releases 官方下载通道',
      stepsTitle: '三步开始今天的工作',
      steps: [
        { title: '安装打开即用', detail: '无需注册任何云端账号，首次打开自动创建干净本地工作区。' },
        { title: '按需开启同步', detail: '单机直接本地明文落盘；多设备办公时在设置页一键绑定私有 Git。' },
        { title: '随时跨端衔接', detail: '用 ⌥ Space 随时捕捉灵感，离开电脑时手机扫码无缝续写。' },
      ],
    },
    footer: {
      tagline: '本地优先的跨平台个人深度工作台',
      repo: 'GitHub 仓库',
      releases: '全部版本',
      changelog: '更新日志',
      copyright: '© 2026 Anchor（锚点）',
      rights: 'All Rights Reserved',
    },
  },
  en: {
    nav: {
      showcase: 'Live Demos',
      principles: 'Core Engine',
      highlights: 'Craft',
      download: 'Download',
      themeToLight: 'Switch to Porcelain Light',
      themeToDark: 'Switch to Obsidian Dark',
      langLabel: '中文',
    },
    cta: {
      downloadMac: 'Download for macOS',
      downloadWin: 'Download for Windows',
      downloadDefault: 'Download Anchor',
      viewGithub: 'GitHub',
      allReleases: 'All Releases',
    },
    hero: {
      titleLine1: 'Anchor what matters most',
      titleLine2: 'Your local-first desktop workbench',
      subtext:
        'Tasks, Kanban flow, lunar calendar, Markdown knowledge base, floating stickies, and QR mobile sync. Everything stays plain text on your disk.',
      stageTodoTitle: 'Today Focus',
      stageTodoItems: [
        { id: 'h1', text: 'Finalize Q4 API schema boundaries', prio: 'P1', done: false },
        { id: 'h2', text: 'Consolidate field notes into knowledge doc', prio: 'P2', done: true },
        { id: 'h3', text: 'Ship Anchor v1.0.1 signed installers', prio: 'P1', done: false },
      ],
      stageQuickLabel: 'Global Quick Capture',
      stageQuickHint: 'Floats over fullscreen',
      stageSyncLabel: 'Git Plain-Text Sync',
      stageSyncValue: 'Synced, zero conflicts',
      stageStickyTitle: 'Pinned Sticky',
      stageStickyBody: '15:30 review: verify A4 PDF margins and specular highlights',
    },
    showcase: {
      heading: 'Try every workflow right here',
      subtext:
        'No static mockups. Switch across six live mini workspaces to check tasks, drag cards, trigger quick capture, or watch mobile sync fire.',
      autoPlayOn: 'Auto touring',
      autoPlayPaused: 'Interactive mode',
      interactiveTip: 'Click any control to take over',
      tabs: [
        {
          id: 'kanban',
          label: 'Tasks & Kanban',
          shortLabel: 'Kanban',
          summary: 'Single-box rich composer auto-derives summaries while cards glide across four workflow states.',
        },
        {
          id: 'schedule',
          label: 'Calendar & Lunar',
          shortLabel: 'Schedule',
          summary: 'Zero-dependency lunar calendar with multi-day glass spans and instant month/week timeline switching.',
        },
        {
          id: 'capture',
          label: 'Quick Entry & Stickies',
          shortLabel: 'Capture',
          summary: 'Summon an L4 floating island over fullscreen spaces and pin six-tone frosted desktop stickies.',
        },
        {
          id: 'knowledge',
          label: 'Knowledge Base & PDF',
          shortLabel: 'Docs',
          summary: 'Real folders and native .md files, batch-consolidate loose notes, and export crisp A4 vector PDFs.',
        },
        {
          id: 'mobile',
          label: 'QR Mobile Companion',
          shortLabel: 'Mobile',
          summary: 'Your desktop serves as a private host through an encrypted tunnel. Scan once to edit from any network.',
        },
        {
          id: 'review',
          label: 'Multi-Range Review',
          shortLabel: 'Review',
          summary: 'Switch day, week, month, or year ranges with live KPI counters and one-click Markdown reports.',
        },
      ],
    },
    principles: {
      heading: 'Four non-negotiable engineering choices',
      subtext: 'Built for longevity, readability, and calm focus without vendor lock-in.',
      cards: [
        {
          id: 'local',
          title: '100% Plain-Text Local Ownership',
          body: 'Tasks, projects, notes, stickies, and Markdown docs live as clean UTF-8 files inside your chosen folder. Open them anytime with VS Code, Git, or local AI tools.',
          points: ['Zero opaque binary database', 'Rust atomic write (tmp -> fsync -> rename)', 'Portable relative attachment paths'],
        },
        {
          id: 'git',
          title: 'Bring-Your-Own Git with LWW Healing',
          body: 'Connect Gitee, GitLab, GitHub, or self-hosted Git. When offline edits collide across macOS and Windows, record-level LWW merges safely without losing a line.',
          points: ['Auto-push stays off by default', 'Ephemeral ASKPASS credential isolation', '30-day soft-delete tombstones'],
        },
        {
          id: 'native',
          title: 'Rust + Tauri 2 Native Core',
          body: 'Instant startup with tiny memory footprint. Native macOS NSPanel floats over fullscreen spaces, backed by Ed25519-signed in-app auto-updates.',
          points: ['macOS Universal + Windows x64', 'Hourly quiet update checks & signature verification', '500ms external file hot-reload'],
        },
        {
          id: 'glass',
          title: 'Porcelain & Obsidian Dual Aesthetics',
          body: 'Five elevation layers and 1px specular hairlines crafted for 100% visual parity across macOS and Windows. Drag the divider below to compare both themes.',
          points: ['60fps layered blur performance budget', 'Honors reduced transparency & motion', 'Shared design tokens across desktop & mobile'],
        },
      ],
      compareObsidian: 'Obsidian Glass',
      comparePorcelain: 'Porcelain Glass',
      compareDragHint: 'Drag to compare surfaces',
      gitConflictBtn: 'Simulate conflict & auto-merge',
      gitResolvedLabel: 'Merged cleanly via record-level LWW',
    },
    bento: {
      heading: 'Details built for daily speed',
      subtext: 'Every shortcut and safeguard works quietly in the background.',
      spotlightTitle: 'Instant Spotlight Search',
      spotlightDesc: 'Press ⌘K to jump across tasks, projects, Markdown docs, and attachments. Try typing below:',
      spotlightPlaceholder: 'Try "Calendar", "Docs", "PDF"…',
      accentTitle: 'Live Accent Atmosphere',
      accentDesc: 'Click any preset to shift the entire page aura and highlights right now.',
      accentNames: {
        blue: 'Apple Blue',
        indigo: 'Indigo',
        teal: 'Teal',
        graphite: 'Graphite',
      },
      pasteTitle: 'Smart Screenshot & File Paste',
      pasteDesc: 'Paste screenshots or local file paths anywhere to archive cleanly into your attachments folder.',
      pasteTrigger: 'Simulate paste',
      pasteArchived: 'Saved to attachments/shot-04.png',
      snapshotTitle: '7-Day Rolling Snapshots',
      snapshotDesc: 'Automatic daily recovery points with corruption self-healing keep your workspace safe.',
      snapshotRestore: 'Verify snapshots',
      snapshotRestored: '7 daily snapshots verified healthy',
      panelTitle: 'Dual Global Hotkeys & Tray Badge',
      panelDesc: 'Unified native icons on macOS and Windows with live remaining-task counters and custom shortcut recording.',
      sovereigntyTitle: 'Zero Accounts, Zero Ads',
      sovereigntyDesc: 'No mandatory sign-in, no telemetry clutter, no sample-data pollution. Just a clean personal workbench.',
    },
    downloads: {
      heading: 'Download Anchor for Desktop',
      subtext: 'Signed native installers for macOS (Apple Silicon & Intel Universal) and Windows 64-bit.',
      recommended: 'Detected for your OS',
      macTitle: 'macOS Universal',
      macDesc: 'Native binary for both Apple Silicon and Intel Macs',
      macFileNote: 'Universal .dmg installer',
      winTitle: 'Windows 64-bit',
      winDesc: 'Windows 10 / 11 with NSIS setup and MSI options',
      winFileNote: 'x64-setup.exe installer',
      msiAlt: 'Download .msi package',
      latestLabel: 'Latest release',
      loadingRelease: 'Checking GitHub Releases for latest version…',
      releaseNotesToggle: 'View release notes',
      releaseNotesHide: 'Hide release notes',
      fallbackNotice: 'Using direct GitHub Releases channel',
      stepsTitle: 'Up and running in three steps',
      steps: [
        { title: 'Open and work immediately', detail: 'Zero login gates. Anchor creates a clean local folder on first launch.' },
        { title: 'Sync on your terms', detail: 'Stay 100% offline or bind your private Git repository in Settings.' },
        { title: 'Capture anywhere', detail: 'Hit ⌥ Space on desktop or scan the QR code from your phone.' },
      ],
    },
    footer: {
      tagline: 'Local-first personal desktop workbench',
      repo: 'GitHub Repository',
      releases: 'Releases',
      changelog: 'Changelog',
      copyright: '© 2026 Anchor',
      rights: 'All Rights Reserved',
    },
  },
};
