# 知识卡片与脚本约定

所有命令在仓库根目录执行，或在命令末尾增加 `--repo /absolute/repo`。运行时仅需 Node 16+，无需安装包、联网或配置模型。下面路径是仓库相对路径。

## 数据格式

卡片为 `docs/knowledge/cards/<id>.json`。不维护第二份索引，检索时直接扫描卡片元数据。JSON 方便不同 Agent 使用相同 schema；人可以在普通代码 Review 中查看差异。

```json
{
  "schema_version": 1,
  "id": "example-project-lesson",
  "title": "示例：确认某个接口边界后的经验",
  "status": "candidate",
  "scope": {
    "paths": ["apps/example/src/**/*.ts"],
    "keywords": ["示例业务词", "example-api"]
  },
  "trigger": "什么任务或什么输入条件下需要这条经验",
  "lesson": "下次应该怎样判断或实现",
  "reason": "本次问题的已确认原因；不混入推测",
  "boundaries": "在哪些条件下不适用，以及仍需判断的事项",
  "evidence": [
    { "path": "docs/specs/example-task.md", "note": "本次需求已确认的事实和依据" }
  ],
  "validation": [],
  "supersedes": []
}
```

示例中的路径和结论需替换成当前任务的真实数据。字段约定：

- `scope.paths` 支持 `*`、`**`、`?`；路径或关键词任一命中就成为候选匹配。多个关键词可包括中文业务词和英文名称；不依赖自动分词或向量数据库。
- `trigger/lesson/reason/boundaries` 都必填。每条卡片最多 32KB，长过程引用既有 Spec，不复制整个任务记录。
- 文件证据使用仓库内真实文件路径，`capture/review` 自动计算 `sha256`；不得使用外部路径。直接用户纠正可写 `{"kind":"user-correction","note":"用户明确要求的最小摘要及适用范围"}`，无需伪造文件或测试。
- `validation` 没验证就用 `[]`。每条格式为 `{"kind":"source-review|test|manual","result":"passed|failed|not-run","detail":"实际做了什么、看到了什么","at":"实际执行的 ISO 时间"}`。test 另需 `command`。not-run 不需要 `at`；未运行不得填写 passed。
- 人明确说明业务边界，可记录 manual 验证；这不意味着自动化测试已通过。既定仓库规则可记录 source-review，精确说明仅核对了文档/代码。
- 可选 `valid_until` 为 ISO 到期时间；文件指纹变化或到期均提示待复核，不自动改变存储状态或宣告规则错误。
- 可选 `supersedes` 记录被替代卡片的 ID。只有关系提示，不决定冲突胜负、不自动退役旧记录。
- `snapshot.base_commit` 是记录时的 Git HEAD；源码可能有未提交改动，实际内容以文件指纹为准。每次 HEAD 变化不强制所有知识失效。
- `review/history/created_at/updated_at/snapshot` 由脚本维护；history 是复核依据记录，不是聊天日志。身份和语义正确性仍由当前工作流程负责，脚本不能认证真实批准。

## 任务前检索

```sh
node .cursor/skills/knowledge-flywheel/scripts/knowledge.cjs recall --task '修改 Zustand 的软件派生状态'
node .cursor/skills/knowledge-flywheel/scripts/knowledge.cjs recall --task '调整克隆参数' --path src/feature.ts --json
```

默认输出有限条 active 卡片全文。candidate、review_required、文件变化或到期的 active 只显示调查入口，不直接注入结论。大卡片和超出数量预算的匹配只提供路径，可按需读取；JSON 输出的 `etag` 用于更新。

未命中不会伪造推荐，不创建卡片或任务日志。匹配按路径和关键词计分，排序不能证明结论正确。内容冲突需读原始证据；文字表述矛盾不能由这个脚本可靠判定。

## 保存或合并候选

通过文件工具在临时文件写上述 JSON，再运行：

```sh
node .cursor/skills/knowledge-flywheel/scripts/knowledge.cjs capture --input /absolute/path/to/candidate.json
```

`--input -` 可从 stdin 接收 JSON。输入必须是 candidate；已存在 ID 不覆盖。更新候选时先读完整卡片和 etag，再把合并后的完整 JSON 传入 `capture --input <file> --expected <etag>`。不允许用 capture 静默重写 active 规则。

只有关键词相似不代表同一结论：适用条件和边界一致才合并。修改 active 经验时先 `review_required`，另建新候选并用 `supersedes` 关联，保留前后证据。

## 确认、反馈与退役

先按实际情况补充 validation。初次候选可以经 capture 合并；已激活卡片复核时先读取最新内容，用文件编辑工具更新验证记录，再重新读取 etag。计算单条 etag：

```sh
node -e 'const fs=require("fs"),c=require("crypto"); console.log(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' docs/knowledge/cards/example-project-lesson.json
```

```sh
node .cursor/skills/knowledge-flywheel/scripts/knowledge.cjs review --id example-project-lesson --status active --kind user-confirmed --basis '用户在本次需求中明确确认该业务边界；已核对适用范围' --expected <etag>
node .cursor/skills/knowledge-flywheel/scripts/knowledge.cjs review --id example-project-lesson --status review_required --basis '当前接口行为与旧经验不一致，待核对协议' --expected <etag>
node .cursor/skills/knowledge-flywheel/scripts/knowledge.cjs review --id example-project-lesson --status retired --basis '接口已删除，关联需求中确认该经验不再适用' --expected <etag>
```

`--kind` 可取 user-confirmed、repository-rule、verified-fix。用户已明确纠正、既定仓库规则或已验证修复都是复核依据，不要求新一轮批准。无依据就保留候选。review 不会运行 validation.command；刷新指纹前必须已核对当前证据。证据变化或状态为 review_required 时，必须补充晚于上次复核/状态反馈的新 passed 验证记录才能重新激活。旧验证记录可保留，但新复核不能冒充重跑旧测试。

每次更新必须提供最新 etag。检测到并发修改就停止该写入，重新读取合并，不覆盖其他任务。短期 `.lock` 文件只防同机写入冲突；进程异常留下锁时先确认无任务写入，再移除该锁。Git 跨分支冲突仍需正常合并。

```sh
node .cursor/skills/knowledge-flywheel/scripts/knowledge.cjs check
node .cursor/skills/knowledge-flywheel/scripts/knowledge.cjs check --strict
```

结构错误退出 1。默认 check 对内容变化/到期输出提醒但退出 0；strict 将这些提醒也置为非零。检查不执行业务测试，不要求每个普通需求运行全量 check。
