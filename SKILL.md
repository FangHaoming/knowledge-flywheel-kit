---
name: knowledge-flywheel-kit
description: 从独立方法仓库为当前业务项目首次接入或升级 AI 知识飞轮，自动合并 AGENTS.md、安装项目 Skill 和 Cursor Rule。用户要求将本工具用于另一个项目、首次使用时初始化，或同步方法版本时使用；已接入项目的日常需求由项目内 knowledge-flywheel Skill 处理。
---

# 将方法仓库 A 用于业务仓库 B

本 Skill 所在目录是 A。当前用户明确指定或正在操作的业务 Git 仓库是 B。A 保存通用方法与初始化程序，B 保存自己的知识、指令和需求记录。不要把 B 的经验上传、复制回 A 或其他项目。

1. 确定 A（本 SKILL.md 的目录）与 B（当前目标 Git 根目录）的绝对路径。若 B 已由当前会话明确，不重复询问；不得把 A 自身当成 B。
2. 执行 `node <A>/bin/knowledge-flywheel.cjs status --project <B>`。首次接入时运行 `init --project <B>`；也可用 `use --project <B> --task <本次需求>` 一次完成首次初始化与检索。这属于用户已经要求的接入工作，不新增审批。
3. 初始化会合并根 AGENTS 的受管区块，安装项目 Skill、Cursor 薄规则、通用操作说明和版本状态，并提供 Codex 的项目 Skill 入口。已有项目规则、知识和非受管文本必须保留。
4. 初始化后，在当前会话显式读取 B 的 AGENTS、`.cursor/skills/knowledge-flywheel/SKILL.md` 和本次检索结果，再继续用户的原需求。现有会话未必自动重载文件；不要声称写文件等于已加载。
5. 后续版本由 `update --project <B>` 显式同步，默认不联网、不自动拉取或追踪 A 的 HEAD；B 使用自己的已安装版本。升级前可 `--dry-run`。受管文件的本地改动冲突应报告具体路径，不能用强制覆盖解决。

对于无版本状态的旧版单项目安装，只有已知文件指纹和旧入口完全匹配时才支持 `init --adopt-legacy`；核对实际来源后再使用。普通首次接入不需要此选项。

命令、迁移和团队分发见 [README](README.md)。结构/文件检查只验证接入结果，真实 Codex、Cursor 客户端加载仍需新会话验收。
