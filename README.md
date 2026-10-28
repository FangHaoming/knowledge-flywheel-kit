# knowledge-flywheel-kit

独立 Git 仓库 A，为业务 Git 仓库 B 首次初始化 AI 知识飞轮。

A 保存通用方法、安装/升级程序和模板。B 保存自己的业务经验。一次接入后，Codex、Cursor 在 B 做需求时加载已有经验、记录纠正、验证后沉淀；B 的日常工作不依赖 A 常驻或联网。

## 最快开始：只在 B 首次接入时执行一次

将 A 克隆到本机。在 B 的根目录运行一次（将 A 的路径换成实际克隆目录）：

```sh
cd /absolute/path/to/A
npm run init -- --project /absolute/path/to/B
```

初始化完成后，请将 B 中生成或修改的 `AGENTS.md`、`.cursor/skills/knowledge-flywheel/`、`.cursor/rules/knowledge-flywheel.mdc`、`.agents/skills/knowledge-flywheel`、`docs/knowledge/` 和 `.knowledge-flywheel/state.json` 按项目约定提交到 B。团队成员拉取 B 后，Codex/Cursor 会通过项目指令自动读取知识飞轮；日常需求不需要再手动执行 A 的命令。

如果希望首次初始化并立即检索当前需求，也可以从任何位置显式指定 B：

```sh
cd /absolute/path/to/A
npm run use -- --project /absolute/path/to/B --task '调整参数提交逻辑'
```

运行时仅需 Node 16+ 和 Git，无第三方运行依赖、不需要 npm install。B 必须是 Git 仓库；A 和 B 不能是同一仓库。

## 让 AI 负责第一次初始化（可选）

直接在 Codex/Cursor 中告诉 AI：

> 读取 `/absolute/path/to/A/SKILL.md`，将当前项目接入知识飞轮，然后继续下面的需求：……

也可以把 A 作为用户级 Skill 安装一次。下面是本地目录链接示例，由使用者在自己的环境中执行；目标已存在时先检查，不强制覆盖：

```sh
mkdir -p ~/.agents/skills
ln -s /absolute/path/to/A ~/.agents/skills/knowledge-flywheel-kit
```

新会话中显式使用 `knowledge-flywheel-kit`，例如在 Codex 输入：

> 使用 $knowledge-flywheel-kit 处理当前项目的这个需求：……

这个入口 Skill 只负责第一次接入 A：确定 B、执行 init、确认文件并提交到 B。接入完成后，B 自己的 `AGENTS.md`、项目 Skill 和 Cursor Rule 负责日常自动触发，无需每次调用 A 或手动运行 `use`。

第一次调用 A 需要一个入口：命令、显式读取 SKILL.md，或已经安装的入口 Skill。项目尚未知道 A 的存在时，不能凭空自行发现和执行。上述步骤只需选择一种。

项目级与用户级 Skill 目录的依据见 [OpenAI Build skills](https://learn.chatgpt.com/docs/build-skills) 和 [Cursor Agent Skills](https://cursor.com/docs/skills)。本地目录接入与真实客户端的 Skill 选择仍需在实际会话确认；没有把文件写入等同于 UI 已加载。

## 首次初始化自动处理什么

- **AGENTS.md**：保留已有内容，添加唯一受管标记区块；更新时仅替换该区块。没有文件时创建项目入口。
- **项目 Skill**：安装到 `.cursor/skills/knowledge-flywheel/`，保持通用运行脚本和数据约定一致。
- **Codex 发现入口**：已有 `.agents/skills` 指向 `.cursor/skills` 时直接复用；独立目录则创建指向同一份 Skill 的相对目录链接，不覆盖同名自定义 Skill。
- **Cursor Rule**：创建 `.cursor/rules/knowledge-flywheel.mdc`，指向同一项目 Skill。
- **本项目知识目录**：创建 `docs/knowledge/cards/`，从空库开始，不导入其他项目业务数据。
- **说明文档**：通用说明为 `docs/knowledge/WORKFLOW.md`；项目自己的 README 只在不存在时创建，后续不覆盖。
- **版本状态**：在 `.knowledge-flywheel/state.json` 记录已安装版本、受管文件指纹和发现入口；使用相对路径，B 移动或被他人克隆后仍可用。

过程不修改 B 的 package.json、CI、全局配置或 Git remote，不自动 commit/push。冲突在写入前检查；事务中途失败会回滚已经写入且未被并发修改的文件。本地备份保存在 `.knowledge-flywheel/backups/`，由局部 .gitignore 排除。

## 检查、预览和升级（维护操作，不是日常需求步骤）

以下命令只用于首次接入、排查或升级方法版本，不需要在每次 B 需求前执行：

```sh
npm run init -- --project /absolute/path/to/B --dry-run
npm run init -- --project /absolute/path/to/B
npm run status -- --project /absolute/path/to/B --check

# 团队先把 A 切换/拉取到确定的方法版本，再显式同步 B
npm run update -- --project /absolute/path/to/B --dry-run
npm run update -- --project /absolute/path/to/B
```

重复 init 不插入重复区块、不生成无意义备份、不更新无变化的时间戳。`--dry-run` 和 status 不写文件。B 的日常任务沿用已提交的方法版本，不在普通需求中自动跟随 A 最新 HEAD；需要升级时再由维护者执行 update。

升级会核对文件指纹。B 在受管文件或 AGENTS 受管区块中的本地改动会得到冲突报告，不被覆盖。项目独有约定写在 AGENTS 标记之外，业务经验写在 B 的 cards 中；通用方法变更到 A 修改后再同步。没有 force 覆盖选项。

目录链接方案面向 macOS/Linux，本次在 macOS 实际测试。Windows 的符号链接权限和 Git 链接检出行为未验证；无法建立链接时会报告错误并回滚，不会悄悄改成另一种安装。

## A 与 B 的边界

```text
A：knowledge-flywheel-kit（独立 Git 仓库）
  SKILL.md                    首次接入/升级的 AI 入口
  bin/knowledge-flywheel.cjs   use / init / update / status
  lib/bootstrap.cjs           合并、版本、冲突与事务
  templates/                  通用 Skill、Rule、文档和入口片段
  test/                       隔离业务仓库集成测试

B：任意业务 Git 仓库
  AGENTS.md                   原项目指令 + 方法受管区块
  .cursor/skills/...          从 A 安装的方法副本
  .cursor/rules/...           从 A 安装的 Cursor 入口
  .agents/skills/...          复用或链接同一方法
  docs/knowledge/cards/       只属于 B 的项目经验
  .knowledge-flywheel/        方法版本与本地备份
```

代码复制到 B 是为了让团队拉取 B 后可直接工作，不要求每台机器上有同一位置的 A。通用副本由 state 跟踪升级；知识与方法版本分开管理。A 只在首次接入和方法升级时使用。

## 测试与维护

```sh
npm test
```

初始化/升级测试使用独立临时 Git 仓库；运行时知识工具测试也在临时仓库中验证候选隔离、来源变化和并发保护。不会用真实项目做破坏性测试。

真实 Codex/Cursor 会话的自动加载需要客户端验收。一次简单的验收是：在 B 中要求 AI 按知识飞轮分析需求，并确认它读取项目 Skill、运行 recall；再保存一次真实纠正，换工具检索同一经验。
