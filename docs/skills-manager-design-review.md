# Skills Manager V1 设计方案评审

评审日期：2026-09-29

评审对象：

- `docs/skills-manager-design-v1.md`
- `docs/vox-reputation-patrol-suite-design.md`
- 当前 `packages/cli` MVP 实现
- 本地参考源码包 `/Users/riyuliang/Downloads/skills-main.zip`

## 1. 评审结论

当前方案方向正确，建议继续推进，但进入下一阶段前需要把实现边界收紧。

建议结论：

```text
有条件通过。
可以继续从设计进入实现，但必须先完成 P0 修正项，再扩展外部 source 能力。
```

核心判断：

- `Git Monorepo + Manifest Registry + CLI + Lockfile + Agent Adapter` 是合理主架构。
- `Domain -> Suite -> Skill -> Resource` 的领域模型适合企业内部 Skill Suite 治理。
- npm 只发布 CLI、Skill 内容留在 Git 的判断正确，能避免 npm package 爆炸。
- Codex 与 Enlighten AI 的安装语义必须继续分开，不能被通用 `.agents/skills` 模型吞掉。
- `vercel-labs/skills` 的优秀设计可以吸收，但应定位为外部 source/discovery/safety 能力，不应替代本项目的 Suite 治理模型。

## 2. 当前设计状态

当前设计已经覆盖：

- 多 Domain 仓库结构。
- Suite 组合关系。
- Skill manifest 与 resource 安装边界。
- Codex global/project 安装。
- Enlighten AI device/space scoped 安装。
- read-only project scope 可以默认绑定当前 shell 目录；真实非交互 project mutation 要求显式 `projectDir`。
- `.skillsrc.yaml` 与 `skills.lock` 的项目落点。
- Vox 舆情巡检作为首个标准化 Suite。
- 对 `vercel-labs/skills` 的可吸收设计总结。

当前 MVP 代码已经具备：

- `add` dry-run 与实际安装主流程。
- Codex 与 Enlighten AI 的基础 install plan。
- read-only project scope 缺省时解析当前 shell 目录；非交互 install/update/remove 需要 `--project-dir`。
- manager marker 防止覆盖非托管目录。
- 基础 `skills.lock` / `.skillsrc.yaml` 写入。
- `list` 读取 lockfile 并输出已安装 Suite / Skill。
- 基础 `remove` 支持 manager-owned install target 删除与 Suite 引用清理。
- 基础 `update` 支持 workspace source 的顶层 Suite / 直接安装 Skill 重新安装与 lockfile 刷新。
- 静态 `doctor` 支持 project dir、project config、lockfile、install marker 和 Enlighten 占位 org/space 检查。
- Vox Suite 的基础 manifest 与安装验证测试。

当前还没有完整具备：

- 外部 source 的精确 `update`。
- 外部 source parser。
- `add <source> --list`。
- `use <source>`。
- 完整 schema 校验。
- installer adapter 抽象拆分。
- lockfile v2 的可更新字段。
- Enlighten AI 真实 runtime 可见性验证与 `doctor --runtime-check`。

## 3. 设计亮点

### 3.1 项目目标没有被 npm 模型绑架

方案明确 npm 只作为 CLI 分发渠道，Skill 内容保留在 Git。这个判断很关键，因为后续会有多个领域、多个 Suite、共享 Skill 和私有仓库需求。如果每个 Skill 或 Suite 都拆成 npm package，版本、权限、发布和复用都会迅速失控。

### 3.2 Suite 被定义为组合关系，而不是文件复制

Suite 只引用 Skill，不复制 Skill 目录。这保证了共享 Skill 可以被集中修复，也让 lockfile 能表达引用关系和卸载引用计数。

### 3.3 project scope 语义清楚

方案已经明确：`--scope project` 默认取当前 shell 目录，同时允许用户选择或通过 `--project-dir` 显式传入。这让 CLI 的日常使用更顺手，也保留了 Codex Desktop / Enlighten 这类多工作区环境需要的显式绑定能力。

### 3.4 Enlighten AI 边界处理正确

方案把 `projectDir` 与 Enlighten AI 的实际 `installPath` 分开：

- `projectDir` 保存 `.skillsrc.yaml`、`skills.lock` 和业务输出。
- Skill 文件安装到 Enlighten Electron `userData` 下的 scoped capability store。
- 不写入 per-session runtime home。
- 不把 `~/.codex/skills` 当成 Enlighten AI 安装目标。

这个边界符合 Enlighten 本地运行时的真实目录布局，后续不会和 session runtime materialization 混淆。

### 3.5 开源方案吸收方式比较克制

对 `vercel-labs/skills` 的吸收点聚焦在：

- source parser。
- bounded discovery。
- direct download/archive guard。
- frontmatter 校验。
- terminal 输出清洗。
- lockfile source 追踪。
- canonical symlink/copy fallback。

这些能力补强“从哪里来、怎么安全读入”，没有覆盖本项目自己的 Domain/Suite 治理模型，方向是对的。

## 4. 必须修正的问题

### P0-1：设计文档与当前 schema 仍不一致（已修复）

当前 schema 已补齐 registry/domain，并将 suite/skill 的 `name`、`description`、`resources`、`compatibility.agents` 等字段纳入 V1 校验；CLI `validate` 也会按同一口径检查当前 registry。

风险：

- 设计说已经声明的字段，CLI/CI 实际不校验。
- 后续 Skill 写错字段也可能通过。
- 安装器会在错误配置上生成看似成功的 plan。

建议：

- 先把 schema 提升到设计文档当前承诺的最小字段集合。
- 对 unknown fields 暂时可以允许，但 required fields 必须收紧。
- 增加 `validate:manifests`，覆盖所有 `domains/**/{domain,suite,skill}.yaml`。

验收：

```bash
npm test
npm run validate:manifests
```

### P0-2：真实 install 不应允许 Enlighten project 使用占位 org/space（已修复）

当前实现已调整为：dry-run 可以展示 `<org-id>` / `<space-id>` 占位符，真实安装必须提供 `--organization-id` / `--space-id` 或 `ENLIGHTEN_ORG_ID` / `ENLIGHTEN_SPACE_ID`。

风险：

- 真实 Skill 被安装到无效 scoped path。
- `.skillsrc.yaml` / `skills.lock` 记录无效组织与空间。
- 后续 runtime 查不到或误判已安装。

建议：

- `--agent enlighten-ai --scope project --dry-run` 可以保留占位展示。
- 非 dry-run 安装时，必须要求显式 `--organization-id` / `--space-id` 或可验证的环境变量。
- 如果仍为 `<org-id>` / `<space-id>`，直接失败。

验收：

```bash
npm test -- packages/cli/test/project-scope.test.js
```

并新增缺参真实安装失败用例。

### P0-3：lockfile 格式需要一次性定稿（已修复）

V1 已明确 `skills.lock` 使用 JSON，设计文档示例已同步为 JSON；`.skillsrc.yaml` 仍保留 YAML。

建议：

- V1 保持 JSON lockfile，因为当前实现已经落地且便于稳定排序。
- 文档中统一标注 `skills.lock` 是 JSON。
- `.skillsrc.yaml` 继续使用 YAML。

验收：

- 文档示例与实际文件格式一致。
- lockfile schema 覆盖 JSON 结构。

### P0-4：`validate` 命令不应硬编码 Vox Suite（已修复）

当前 `validate` 已改为从 registry 扫描 domain、suite、skill 和 declared resources，并输出覆盖计数。

风险：

- 新增 Domain/Suite 后无法被 validate 覆盖。
- 一个固定 Suite 通过会掩盖仓库其他 manifest 错误。

建议：

- `validate` 扫描 `registry.yaml` 下所有 domain。
- 校验所有 suite 引用的 skill 存在。
- 校验所有 skill entry/resource 存在且不逃逸。

### P0-5：外部 source 能力不能直接并入主安装路径

外部 source parser 很诱人，但如果直接和 install 绑定，会把网络、认证、下载、archive、安全和 update 全部拉进关键路径。

建议：

- 第一阶段只做 `parseSource` 和 `discoverSkills` 的只读能力。
- 先交付 `add <source> --list`。
- `add <source> --skill ... --dry-run` 稳定后，再允许真实安装。
- direct download/archive 必须等下载限额、解压限额、path traversal tests 完成后再开放。

## 5. 重要设计取舍

### 5.1 外部 source 是输入层，不是治理层

推荐架构：

```text
External Source
  -> Source Parser
  -> Discovery
  -> Candidate Skill
  -> Domain/Suite Governance
  -> Install Plan
  -> Agent Adapter
  -> Lockfile
```

不要让外部 repo 直接绕过 Suite 关系、capabilities、Agent compatibility、project binding 和 lockfile。

### 5.2 Codex 可以走普通文件型 Adapter，Enlighten AI 不可以

Codex 的 global/project path 可以看作普通文件型 adapter：

```text
global:  ~/.codex/skills/<skill>
project: <projectDir>/.codex/skills/<skill>
```

Enlighten AI 的路径是 scoped capability store：

```text
device: <userData>/codex-home/skills/device/<skill>
space:  <userData>/codex-home/skills/by-space/organizations/<org-id>/spaces/<space-id>/<skill>
```

所以 canonical symlink/copy 方案只能先服务普通文件型 Agent，不应应用到 Enlighten AI。

### 5.3 M5 外部 source 可以设计，不能抢 M3/M4 的优先级

当前最重要的是把已有 Domain/Suite/Adapter/lockfile 路径打稳。外部 source 是扩展能力，不能影响首个 Vox Suite 的可安装、可审计、可验证。

## 6. 推荐实施路线

### R0：文档一致性收敛

目标：让设计文档、schema、当前 CLI 行为保持一致。

任务：

- 统一 `skills.lock` 格式说明为 JSON。
- 在设计文档中标注哪些命令是已实现，哪些是规划。
- 把 schema required 字段与当前 manifest 实际字段对齐。
- 给 Enlighten AI project 真实安装增加 org/space 必填规则。

通过标准：

- `git diff --check` 通过。
- 所有现有测试通过。
- manifest schema 校验能覆盖当前 `domains/vox-reputation`。

### R1：核心 MVP 加固

目标：让当前 `add` 能作为稳定 MVP 使用。

任务：

- 拆出 `adapters/codex.js` 与 `adapters/enlighten-ai.js`。
- 保持 `buildInstallPlan()` 只负责计划，不直接写入路径细节。
- 增加 `list`，先只读 lockfile。已完成基础实现。
- 增加基础 `remove`，先只支持 manager-owned install target。已完成基础实现。
- 强化 lockfile 稳定排序和 schema 校验。

通过标准：

```bash
npm test
npm run validate:manifests
node packages/cli/src/index.js add vox-reputation/vox-keyword-patrol --agent codex --dry-run
```

### R2：外部 source 只读发现

目标：吸收 `vercel-labs/skills` 的 parser/discovery，但暂不真实安装。

任务：

- 新增 `source-parser.js`。
- 新增 `discover-skills.js`。
- 支持 local path source。
- 支持 GitHub/GitLab/Azure/SSH URL 的结构解析。
- 支持 `add <source> --list`。
- 增加 terminal metadata sanitize。

通过标准：

```bash
node packages/cli/src/index.js add ./fixtures/external-skills --list
npm test -- source-parser
```

### R3：外部 source 安全下载与 dry-run

目标：开放 direct download/archive，但只到 dry-run。

任务：

- 限制下载大小。
- 限制解压后大小与文件数。
- 阻止 archive path traversal。
- 校验 `SKILL.md` frontmatter。
- 支持 `add <source> --skill <name> --dry-run`。

通过标准：

- malicious archive 测试必须失败。
- oversized download 测试必须失败。
- 缺少 `name/description` 的 `SKILL.md` 不进入候选。

### R4：正式 update/remove 能力

目标：从“可安装”进入“可维护”。

任务：

- lockfile v2 增加 `sourceUrl/sourceType/ref/skillPath/integrity`。
- `update` 根据 lockfile 精确定位单个 Skill；workspace source 基础实现已完成，外部 source 仍待实现。
- lockfile 缺少 `skillPath` 时提示重装，不自动更新。
- `remove` 继续强化跨 agent/scope 的 Suite 引用计数和回归用例。

通过标准：

- 同一 Suite 共享 Skill 时，删除一个 Suite 不会误删仍被引用的 Skill。
- update 不会重装同 source 下未请求的其他 Skill。

### R5：Enlighten AI runtime 级验证

目标：证明安装不仅落盘成功，而且能被 Enlighten 本地运行时识别。

任务：

- 复用 Enlighten 本地 Skill install/import 协议。
- 验证 `.enlighten-install.json` marker。
- 验证本地 Skill 列表可见。
- 验证 session runtime materialization 或可调用 Skill 列表。

通过标准：

- 不能只用文件存在证明成功。
- 要有 Enlighten 本地侧读取或 runtime 可见性的证据。

## 7. 风险矩阵

| 风险 | 级别 | 影响 | 建议处理 |
| --- | --- | --- | --- |
| schema 与设计不一致 | P0 | 安装错误配置仍可能成功 | 已补 schema 与 manifest 校验 |
| Enlighten project 写入占位 org/space | P0 | 污染 userData，runtime 不可见 | 非 dry-run 强制真实 org/space |
| 外部 source 过早真实安装 | P0 | 安全边界和 update 语义不稳定 | 先 list/dry-run，再 install |
| lockfile 格式不统一 | P0 | 后续 update/remove 难维护 | 已固定 JSON lockfile |
| validate 硬编码 Vox | P1 | 校验覆盖不足 | 扫描全 registry |
| Adapter 未抽象 | P1 | Codex/Enlighten 逻辑继续耦合 | 拆 adapter interface |
| 缺少 runtime 验证 | P1 | 文件安装成功但 Agent 不加载 | doctor 增加 runtime 可见性检查 |
| Suite 引用计数未实现 | P1 | remove 可能误删共享 Skill | lockfile requestedBy 必须落地 |

## 8. 评审建议决策

建议在评审会上确认以下决策：

1. `skills.lock` V1 是否统一为 JSON。
2. `--agent enlighten-ai --scope project` 真实安装是否强制 org/space。
3. 外部 source 能力是否拆成 M5，不阻塞当前 Vox Suite MVP。
4. Codex 是否先保持直接 `.codex/skills`，canonical symlink 作为后续多 Agent 能力。
5. `validate` 是否作为 CI 门禁命令，而不是临时 smoke 命令。
6. Vox Suite 是否作为首个验收样板，先不引入 ecommerce 示例实现。

## 9. 最终评审意见

该方案具备继续推进的架构基础，但下一步不能继续扩大范围。最合理的动作是先把当前 MVP 从“能跑”收敛到“可验证、可维护、不会误写”，再吸收 `vercel-labs/skills` 的外部 source 能力。

推荐优先顺序：

```text
P0 文档/schema/真实安装边界
  -> M3 当前 add/install/lockfile 加固
  -> M4 doctor/list/remove/update
  -> M5 external source/list/use
```

评审通过条件：

- P0 项有明确 owner 和验收命令。
- `skills.lock` 格式定稿。
- Enlighten AI project 安装不再允许占位 org/space 真实落盘。
- 外部 source 先以只读 discovery 进入，不直接进入真实 install。
