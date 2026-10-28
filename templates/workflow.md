# 业务仓库中的知识飞轮

本文件由独立方法仓库 A 管理。业务经验保留在当前项目 B，不跨项目自动复制。

## 日常使用

在本项目的新 Codex/Cursor Agent 会话中正常提出需求。根 AGENTS 与 Cursor Rule 会自动引导同一个项目 Skill；完成首次初始化并把受管文件提交到 B 后，日常需求不需要手动运行 A 的命令。首次验证可明确说：

> 使用 knowledge-flywheel 处理本需求：先加载相关项目经验，过程中记录可复用纠正，验证后整理结论。先只分析，不修改业务代码。

没有经验命中时正常开发，不创建空卡片。你纠正 AI、排查确认根因时，AI 先完成当前修正，再保存跨任务可复用的候选。临时颜色、单次需求范围和未证实猜测不会直接升级为团队规则。

任务收尾或交接时，AI 根据实际证据激活、修正或保留待验证知识，并给出简短记录。沿用已有 Spec、任务记录和授权，不另建审批流程。

## 本项目数据

- `docs/knowledge/cards/*.json`：本项目卡片，随项目代码共享。
- `docs/knowledge/README.md`：本项目自行维护的说明；方法升级不覆盖。
- `.knowledge-flywheel/state.json`：已安装的通用方法版本和受管文件指纹，应提交到项目。
- `.knowledge-flywheel/backups/`：初始化/升级的本地备份，由该目录的 .gitignore 排除。
- 通用 Skill 和 Cursor Rule 来自 A，项目约定写在 AGENTS 的受管标记区块之外，避免升级冲突。

## 工具命令

在 B 的根目录执行，只需 Node 16+：

```sh
node .cursor/skills/knowledge-flywheel/scripts/knowledge.cjs recall --task '当前需求描述'
node .cursor/skills/knowledge-flywheel/scripts/knowledge.cjs capture --input /absolute/path/to/candidate.json
node .cursor/skills/knowledge-flywheel/scripts/knowledge.cjs check
```

复核与格式示例见 [数据约定](../../.cursor/skills/knowledge-flywheel/references/data-contract.md)。脚本不执行卡片中保存的测试命令，不联网、不读取其他聊天。candidate 只作调查线索；来源变化、过期或被反馈冲突的经验应先复核。

## 方法升级

拉取或切换 A 到团队确定的版本后，从 A 执行：

```sh
node bin/knowledge-flywheel.cjs update --project /absolute/path/to/B --dry-run
node bin/knowledge-flywheel.cjs update --project /absolute/path/to/B
```

安装器保留 AGENTS 非受管文本和本项目知识，受管文件发生本地修改时报告冲突。不要用强制覆盖解决；将项目差异移入项目约定、与 A 合并方法改动后再升级。A 不需要常驻；安装后 B 的日常流程可离线独立运行。

文件写入成功不代表客户端已加载。旧会话需要显式读取新指令或新建会话；真正的 Codex/Cursor UI 自动加载需在实际客户端验收。
