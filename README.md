<div align="center">
  <img src="public/app-icon.png" width="96" height="96" alt="Anchor Icon" />
  <h1>Anchor · 锚点</h1>
  <p><strong>锚定每天最重要的一件事与核心卡点 — 跨平台本地办公与团队管理桌面工作台</strong></p>
  <p>Local-first Apple-inspired desktop workbench for personal focus, team daily tracking, project blockers, attachments, Git sync &amp; weekly reviews</p>
  <p>
    <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-007AFF?style=flat-square" alt="Platform" />
    <img src="https://img.shields.io/badge/Built%20with-Tauri%202%20%2B%20React%20%2B%20Rust-1D1D1F?style=flat-square" alt="Stack" />
    <img src="https://img.shields.io/badge/Sync-Local%20JSON%20%2B%20Git-34C759?style=flat-square" alt="Local First + Git Sync" />
  </p>
</div>

---

## 产品简介

**Anchor（锚点）** 是一款遵循苹果桌面美学规范打造的跨平台（macOS & Windows）本地办公与团队管理桌面应用。它摒弃云端平台锁定与臃肿表单，将个人效率闭环（四象限待办、顺延成本、灵感速记、项目卡点）与轻量研发团队管理（小组每日承接、任务分配、成员负荷、双维周复盘）融合在一个极简、克制、零延迟的原生桌面窗口中。

## 核心特性

- **100% 本地明文存储 + 内置通用 Git 云端同步**：
  - 所有业务数据以标准 UTF-8 LF JSON 分片与附件文件落盘在本地目录（`tasks.json`、`projects.json`、`notes.json`、`members.json`、`assignments.json`、`daily/YYYY-Www.json`、`attachments/`）。
  - **支持任意 Git 托管平台（Gitee / GitLab / GitHub / 自建 Git）**：支持本机 SSH / 系统凭据或 HTTPS + Personal Access Token（凭据仅存本机配置目录，绝不写入数据仓库）；自动维护 `.gitignore`（忽略 `.snapshots/` 与临时文件）；多端同时修改发生冲突时自动按记录级 LWW 无损合并；支持一键同步、启动自动拉取，以及默认关闭、可在设置中开启的修改后静默自动推送。
  - 同时也兼容 OneDrive / 坚果云 / iCloud 等任意网盘同步。
- **全局 Spotlight 快速检索（`Cmd / Ctrl + K`）**：毫秒级跨全工作台检索待办、项目、灵感、派活、成员、每日事项及附件名称/网址，上下键选择回车直达详情。
- **统一附件引擎（链接 · 图片 · 文档文件）**：在「今天待办」「任务分配」「灵感速记」中均支持挂载网页链接、图片（支持选图、在检视器任意位置 `Cmd/Ctrl+V` 直接粘贴截图、拖入文件、点击灯箱大图预览）及任意本地文档；内置大文件体积提醒与「一键清理孤儿附件」。
- **Rust 原子写盘与自动恢复快照**：写入采用 `临时文件 → sync_all → 原子替换`（含 Windows 网盘占锁自动重试）；每日自动滚动保留最近 7 天 `.snapshots/` 快照，异常损坏自动留底并回退恢复。
- **个人 + 团队统一闭环**：
  - **今天待办**：P1–P4 彩色圆形复选框、跨天自动结转、外显「顺延次数」、本周/本月按日期分组、一键顺延逾期与右侧 Inspector 检视抽屉。
  - **灵感速记**：卡片流记录、标签频次筛选、实时搜索、原地点击编辑与「一键转为今日待办」（连带附件一起带入）。
  - **项目跟进**：极简聚焦「现在 / 下一步 / 卡点」，卡住项目自动置顶预警，同一进度条聚合关联的个人待办与团队派活，支持在项目卡片一键「+ 待办」或「+ 派活」。
  - **小组每日**：周末自动休眠，工作日自动承接上个工作日未完成事项并记录连续承接天数；内置周一至周五「成员 × 日期」周矩阵。
  - **任务分配 & 组内成员**：支持快捷截止时间胶囊（今天/明天/本周五 18:00）、预设研发角色与自定义岗位、行内快速切状态、删除成员自动软解绑保留历史。
  - **双维每周复盘**：同时统计个人效能、团队交付与统一卡点汇总，支持一键复制或导出 Markdown 周报（`reports/YYYY-Www.md`）。
- **原生桌面体验**：首次打开即刻进入清爽空白工作台（零内置示例打扰，支持一键跳转绑定或克隆已有 Git 数据仓库）；浅色 / 深色 / 跟随系统三态主题、4 档系统强调色、中英双语菜单栏/托盘同步、支持开机自动启动与应用内一键检查新版本。

## 下载安装

前往本仓库右侧 **[Releases](https://github.com/779235394/anchor/releases)** 页面下载对应平台的最新直接安装器：

- **macOS（Apple Silicon + Intel 通用版）**：下载 `Anchor_*_universal.dmg`，打开后拖入「应用程序」即可。
- **Windows（64 位）**：下载 `Anchor_*_x64-setup.exe`（NSIS 安装器）或 `.msi` 安装包运行安装。

> **跨设备同步推荐用法**：在「设置与数据 → Git 云端存储与同步」中填入私有 Gitee / GitLab / GitHub 仓库地址，点击「绑定当前目录」并在另一台电脑上「克隆到空目录」即可无缝同步；也可以直接将本地目录指向 OneDrive / 坚果云文件夹。

## 常用快捷键

| 快捷键 | 功能 |
| :--- | :--- |
| `Cmd / Ctrl + K` | 打开全局 Spotlight 搜索，直达任意待办、项目、灵感、派活或附件 |
| `Cmd / Ctrl + N` | 聚焦当前视图快速录入框 |
| `Cmd / Ctrl + V` | 在右侧检视器任意位置或灵感卡片中直接粘贴截图附件 |
| `Esc` | 关闭搜索框、右侧 Inspector 检视抽屉或图片预览灯箱 |
| `Cmd / Ctrl + 1 ~ 8` | 快速切换 8 个主视图 |
| `Cmd / Ctrl + Enter` | 在灵感速记页直接保存当前灵感 |

## 本地开发与自动发布

```bash
# 安装依赖
pnpm install

# 运行前端单元测试 & 生产构建检查
pnpm test
pnpm build

# 运行 Rust 原子存储、附件与 Git 同步引擎单元测试
cargo test --manifest-path src-tauri/Cargo.toml

# 启动桌面开发模式
pnpm tauri dev

# 打包当前系统安装包
pnpm tauri build --bundles dmg
```

### GitHub Actions 双端自动打包发布

仓库内置 `.github/workflows/release.yml`：每次推送以 `v` 开头的版本标签（或在 Actions 页面手动点击 `Run workflow`），GitHub Actions 会自动执行前后端测试门禁，并在 `macos-latest` 与 `windows-latest` 上并行打包发布 **macOS Universal `.dmg`** 与 **Windows `.exe`/`.msi`** 安装器到 Releases：

```bash
git tag v0.3.1
git push origin v0.3.1
```
