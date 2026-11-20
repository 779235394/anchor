<div align="center">
  <img src="public/app-icon.png" width="96" height="96" alt="Clarity Workbench Icon" />
  <h1>Clarity Workbench</h1>
  <p><strong>面向研发管理者与知识工作者的跨平台本地办公工作台</strong></p>
  <p>Local-first desktop workbench for personal productivity, team daily tracking, project blockers &amp; weekly reviews</p>
  <p>
    <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-007AFF?style=flat-square" alt="Platform" />
    <img src="https://img.shields.io/badge/Built%20with-Tauri%202%20%2B%20React%20%2B%20Rust-1D1D1F?style=flat-square" alt="Stack" />
    <img src="https://img.shields.io/badge/Storage-100%25%20Local%20JSON-34C759?style=flat-square" alt="Local First" />
  </p>
</div>

---

## 产品简介

**Clarity Workbench** 是一款遵循 **Apple Clarity** 桌面美学规范打造的跨平台（macOS & Windows）本地办公与团队管理桌面应用。它摒弃云端平台锁定与臃肿表单，将个人效率闭环（四象限待办、顺延成本、灵感速记、项目卡点）与轻量研发团队管理（小组每日承接、任务分配、成员负荷、双维周复盘）融合在一个极简、克制、零延迟的原生桌面窗口中。

## 核心特性

- **100% 本地明文存储 & 无缝跨端同步**：所有数据以标准 UTF-8 LF JSON 分片落盘在自定义本地文件夹（`tasks.json`、`projects.json`、`notes.json`、`members.json`、`assignments.json`、`daily/YYYY-Www.json`）。将该目录放入 **OneDrive / 坚果云 / iCloud / Git** 即可在 Mac 与 Windows 间自由同步，也便于本地 AI Agent 直接读取。
- **Rust 原子写盘与自动恢复快照**：写入采用 `临时文件 → sync_all → 原子替换`（含 Windows 网盘占锁自动重试）；每日自动滚动保留最近 7 天 `.snapshots/` 快照，异常损坏自动留底并回退恢复；支持监听外部目录变更并按记录级 LWW 自动热重载。
- **个人 + 团队统一闭环**：
  - **今天待办**：P1–P4 彩色圆形复选框、跨天自动结转、外显「顺延次数」、一键顺延逾期与右侧 Inspector 检视抽屉。
  - **灵感速记**：卡片流记录、标签频次筛选、实时搜索、原地点击编辑与「一键转为今日待办」。
  - **项目跟进**：极简聚焦「现在 / 下一步 / 卡点」，卡住项目自动置顶预警，同一进度条聚合关联的个人待办与团队派活。
  - **小组每日**：周末自动休眠，工作日自动承接上个工作日未完成事项并记录连续承接天数；内置周一至周五「成员 × 日期」周矩阵。
  - **任务分配 & 组内成员**：支持预设研发角色与自定义岗位、行内快速切状态、关联项目、删除成员自动软解绑保留历史。
  - **双维每周复盘**：同时统计个人效能（按真实完成时间统计）、团队交付与统一卡点汇总，支持一键复制或导出 Markdown 周报（`reports/YYYY-Www.md`）。
- **原生桌面体验**：浅色 / 深色 / 跟随系统三态主题、4 档系统强调色、中英双语无刷新切换；支持关闭窗口最小化到托盘，**macOS 顶部菜单栏实时显示今日剩余待办数**，Windows 系统托盘实时更新状态提示。

## 下载安装

前往本仓库右侧 **[Releases](../../releases)** 页面下载对应平台的最新安装包：

- **macOS（Apple Silicon + Intel 通用版）**：下载 `Clarity Workbench_*_universal.dmg`，打开后拖入「应用程序」即可。
- **Windows（64 位）**：下载 `Clarity Workbench_*_x64-setup.exe` 或 `.msi` 安装包运行安装。

> **跨设备同步推荐用法**：在「设置与数据 → 本地明文数据目录」中点击「切换目录」，将 Mac 和 Windows 都指向同一个 OneDrive / 坚果云 / Git 文件夹即可。

## 常用快捷键

| 快捷键 | 功能 |
| :--- | :--- |
| `Cmd / Ctrl + N` | 聚焦当前视图快速录入框 |
| `Esc` | 关闭右侧 Inspector 检视抽屉 |
| `Cmd / Ctrl + 1 ~ 8` | 快速切换 8 个主视图 |
| `Cmd / Ctrl + Enter` | 在灵感速记页直接保存当前灵感 |

## 本地开发与自动发布

```bash
# 安装依赖
pnpm install

# 运行前端领域单元测试 & 生产构建检查
pnpm test
pnpm build

# 运行 Rust 原子存储单元测试
cargo test --manifest-path src-tauri/Cargo.toml

# 启动桌面开发模式
pnpm tauri dev

# 打包当前系统安装包
pnpm tauri build
```

### GitHub Actions 双端自动打包发布

仓库已内置 `.github/workflows/release.yml`：每次推送以 `v` 开头的版本标签（或在 Actions 页面手动点击 `Run workflow`），GitHub Actions 会自动执行前端/Rust 测试门禁，并在 `macos-latest` 与 `windows-latest` 上并行打包发布 **macOS Universal `.dmg`** 与 **Windows `.exe`/`.msi`** 到 Releases：

```bash
git tag v0.1.0
git push origin v0.1.0
```
