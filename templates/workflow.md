# 业务仓库中的知识飞轮

本文件由独立方法仓库 `knowledge-flywheel-kit` 管理。业务经验保留在当前项目 B，不跨项目自动复制。

## 日常使用

在本项目的新 Codex/Cursor Agent 会话中正常提出需求。根 AGENTS 与 Cursor Rule 会自动引导同一个项目 Skill；完成首次初始化并把受管文件提交到 B 后，日常需求不需要手动运行 `knowledge-flywheel-kit` 的命令。首次验证可明确说：

> 使用 knowledge-flywheel 处理本需求：先用仓库搜索主动寻找相关项目经验，由 AI 阅读候选卡片后判断是否适用；过程中识别可能值得复用的经验；未经我明确授权，不要写入或修改知识卡。先只分析，不修改业务代码。

没有经验命中时正常开发，不创建空卡片。AI 在对话中留意可复用的业务边界、已确认根因、项目约定和重复排查入口，但这只是候选草稿，不写入文件。临时颜色、单次需求范围和未证实猜测不作为团队经验建议。

AI 根据需求描述、改动路径和业务实体，使用仓库搜索在 `docs/knowledge/cards/` 中主动寻找经验；可逐步尝试同义词、旧称和代码入口。搜索工具只负责发现线索，AI 阅读候选全文后判断相关性、状态、证据和适用边界。没有搜全时说明范围，不要声称已穷尽。任务收尾时，AI 将所有符合标准且不重复的经验建议一次性列出，不设条数上限，并询问用户选择记录哪些；没有合格建议时无需询问。用户未明确选择的内容不落盘。用户直接要求“把上述处理记录下来”时，视为针对所指内容的记录授权，不重复询问。授权记录不等于验证通过；新卡先为 candidate，是否激活取决于实际证据。沿用已有 Spec 和需求流程，不另建审批流程。

## 本项目数据

- `docs/knowledge/cards/*.json`：本项目卡片，随项目代码共享。
- `docs/knowledge/README.md`：本项目自行维护的说明；方法升级不覆盖。
- `.knowledge-flywheel/state.json`：已安装的通用方法版本和受管文件指纹，应提交到项目。
- `.knowledge-flywheel/backups/`：初始化/升级的本地备份，由该目录的 .gitignore 排除。
- 通用 Skill 和 Cursor Rule 来自 `knowledge-flywheel-kit`，项目约定写在 AGENTS 的受管标记区块之外，避免升级冲突。

## 工具命令

在 B 的根目录执行，只需 Node 16+：

```sh
node .cursor/skills/knowledge-flywheel/scripts/knowledge.cjs capture --input /absolute/path/to/candidate.json
node .cursor/skills/knowledge-flywheel/scripts/knowledge.cjs check
```

格式示例见 [数据约定](../../.cursor/skills/knowledge-flywheel/references/data-contract.md)。经验搜索通过项目自带的仓库搜索和文件阅读能力完成；脚本用于保存、复核和结构检查，不负责枚举或筛选经验。脚本不执行卡片中保存的测试命令，不联网、不读取其他聊天。candidate 只作调查线索；来源变化、过期或被反馈冲突的经验应先复核。

## 方法升级

拉取或切换 `knowledge-flywheel-kit` 到团队确定的版本后，从该仓库执行：

```sh
PROJECT_B=/path/to/B
npm run update -- --project "$PROJECT_B" --dry-run
npm run update -- --project "$PROJECT_B"
```

安装器保留 AGENTS 非受管文本和本项目知识，受管文件发生本地修改时报告冲突。不要用强制覆盖解决；将项目差异移入项目约定、与 `knowledge-flywheel-kit` 合并方法改动后再升级。`knowledge-flywheel-kit` 不需要常驻；安装后 B 的日常流程可离线独立运行。

文件写入成功不代表客户端已加载。旧会话需要显式读取新指令或新建会话；真正的 Codex/Cursor UI 自动加载需在实际客户端验收。
