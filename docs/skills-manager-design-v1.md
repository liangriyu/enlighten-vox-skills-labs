# Skills Manager V1 详细设计方案

## 1. 背景与目标

当前目标不是简单地把一批 `SKILL.md` 文件提交到 Git 仓库，而是建设一套可版本化、可组合、可发现、可验证、可按 Suite 安装的 Skills 分发与管理体系。

目标场景：

- 一个 Git 仓库可以承载多个领域 Domain。
- 每个 Domain 可以包含多个 Skill Suite。
- 每个 Suite 由多个可复用 Skill 组合而成。
- 用户可以通过 `npx` 一条命令安装、更新、卸载、检查 Skill。
- V1 暂定支持 Codex 和 Enlighten AI，后续再扩展到 Claude Code、Cursor 等 Agent。

核心判断：

- Git 是 Skill Source of Truth。
- npm 只作为 CLI 分发渠道。
- `npx` 只负责零安装运行 CLI，不直接承担 Skill 管理语义。
- 真正的管理器是 `@org/skills` CLI。
- Skill、Suite、CLI 三套版本体系必须相互独立。

## 2. 推荐方案

V1 推荐采用：

```text
Git Monorepo
  + Manifest Registry
  + Skill Manager CLI
  + npx Bootstrap
  + skills.lock
  + Agent Adapter
```

整体链路：

```text
                       npm Registry
                            |
                     @org/skills CLI
                            |
                npx @org/skills@latest
                            |
                            v
                  Skill Manager CLI
                            |
        +-------------------+-------------------+
        |                   |                   |
    Registry            Resolver            Lockfile
        |                   |                   |
        +-------------------+-------------------+
                            |
                            v
                      Git Monorepo
                            |
       +--------------------+--------------------+
       |                    |                    |
  development           ecommerce            research
       |                    |                    |
    suites               suites               suites
       |                    |                    |
    skills               skills               skills
       +--------------------+--------------------+
                            |
                            v
                    Normalized Skill
                            |
          +-----------------+-----------------+
          |                                   |
       Codex                           Enlighten AI
      Adapter                            Adapter

   Future: Claude Code / Cursor / other Agent adapters
```

推荐理由：

- Skill 不被 npm package 模型绑架。
- 一个仓库多领域、多 Suite 的结构天然适合 Git Monorepo。
- Suite 作为组合关系，不复制 Skill 目录。
- 用户体验仍然保持简单：`npx @org/skills add ecommerce/amazon-seller`。
- 后续支持私有 Git、多 registry、多 Agent、权限声明、lockfile、版本解析时，不需要推翻 V1。

## 3. V1 范围

V1 必须支持：

- Git Monorepo 目录规范。
- `registry.yaml`、`domain.yaml`、`suite.yaml`、`skill.yaml` 四类 manifest。
- `skills.lock` 锁定实际安装结果。
- `@org/skills` CLI。
- `npx @org/skills add <suite|skill>`。
- `npx @org/skills remove <suite|skill>`。
- `npx @org/skills update [suite|skill]`。
- `npx @org/skills list`。
- `npx @org/skills doctor`。
- Codex Adapter。
- Enlighten AI Adapter。
- 非交互模式优先，交互模式可后置；但 `--scope project` 必须支持由用户显式选择项目工作目录。

V1 暂不支持：

- Registry Server。
- Web marketplace。
- 每个 Skill 一个 npm package。
- 每个 Suite 一个 npm package。
- 复杂依赖求解器。
- 多 registry 联邦搜索。
- 用户账号系统。
- rating/review。
- 完整 Claude Code / Cursor Adapter。
- Enlighten AI 云端发布、团队空间同步、权限审批流。

## 4. 仓库目录规范

推荐仓库结构：

```text
skills/
├── package.json
├── package-lock.json
├── registry.yaml
├── README.md
│
├── packages/
│   └── cli/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── commands/
│           ├── registry/
│           ├── resolver/
│           ├── installer/
│           ├── lockfile/
│           └── adapters/
│               ├── codex.ts
│               ├── enlighten-ai.ts
│               ├── claude-code.ts
│               ├── cursor.ts
│               └── generic.ts
│
├── domains/
│   ├── development/
│   │   ├── domain.yaml
│   │   ├── suites/
│   │   │   ├── frontend.yaml
│   │   │   └── backend.yaml
│   │   └── skills/
│   │       ├── code-review/
│   │       │   ├── skill.yaml
│   │       │   ├── SKILL.md
│   │       │   ├── scripts/
│   │       │   └── references/
│   │       └── testing/
│   │
│   ├── ecommerce/
│   │   ├── domain.yaml
│   │   ├── suites/
│   │   │   ├── amazon-seller.yaml
│   │   │   └── product-research.yaml
│   │   └── skills/
│   │       ├── competitor-analysis/
│   │       ├── listing-copy/
│   │       └── image-prompt/
│   │
│   └── research/
│       ├── domain.yaml
│       ├── suites/
│       └── skills/
│
└── schemas/
    ├── registry.schema.json
    ├── domain.schema.json
    ├── suite.schema.json
    ├── skill.schema.json
    └── lockfile.schema.json
```

原则：

- `domains/<domain>/skills/<skill>/` 是 Skill 的源码位置。
- `domains/<domain>/suites/*.yaml` 只描述组合关系，不复制 Skill。
- `packages/cli` 只放 Skill Manager CLI，不放领域 Skill 内容。
- schema 文件放在根目录 `schemas/`，用于 CI 校验和 CLI 本地校验。

## 5. 领域模型

V1 明确定义五个概念：

```text
Registry
  -> Domain
  -> Suite
  -> Skill
  -> Resource
```

### 5.1 Registry

Registry 是仓库入口索引，负责声明有哪些 Domain 以及它们的位置。

示例：

```yaml
schema: registry/v1
name: official-skills
version: 0.1.0

domains:
  ecommerce:
    path: domains/ecommerce
  development:
    path: domains/development
  research:
    path: domains/research
```

V1 Registry 直接放在 Git 仓库根目录，不需要数据库和服务端 API。

### 5.2 Domain

Domain 只负责领域分类，不参与安装依赖，也不承担版本解析。

示例：

```yaml
schema: domain/v1
id: ecommerce
name: Ecommerce
description: Ecommerce workflow skills and suites.
```

### 5.3 Suite

Suite 是 Skill dependency graph，不是目录集合。

示例：

```yaml
schema: suite/v1
id: amazon-seller
name: Amazon Seller Suite
domain: ecommerce
version: 1.0.0
description: Skills for Amazon seller research, listing and creative work.

skills:
  - id: competitor-analysis
    version: ^1.0.0
  - id: keyword-research
    version: ^1.0.0
  - id: listing-copy
    version: ^1.0.0
  - id: image-prompt
    version: ^1.0.0

tags:
  - ecommerce
  - amazon
  - seller
```

后续可以扩展 `extends` 支持 Suite 依赖 Suite：

```yaml
extends:
  - ecommerce/core
  - research/web-research
```

V1 可以先保留字段，但不实现复杂解析。

### 5.4 Skill

Skill 是最小可安装单元。

示例：

```yaml
schema: skill/v1
id: competitor-analysis
name: Competitor Analysis
domain: ecommerce
version: 1.0.0
description: Analyze competitors and identify positioning opportunities.
entry: SKILL.md

compatibility:
  agents:
    - codex
    - enlighten-ai

resources:
  - SKILL.md
  - references/**
  - scripts/**

capabilities:
  filesystem:
    read: true
    write: false
  network:
    required: true
  shell:
    required: false
  tools:
    - web

tags:
  - ecommerce
  - research
  - amazon
```

V1 中 `entry` 必须指向 `SKILL.md`。

### 5.5 Resource

Resource 是随 Skill 一起安装的文件集合，例如：

- `SKILL.md`
- `references/**`
- `scripts/**`
- `templates/**`
- `assets/**`

CLI 必须限制安装范围，只复制 manifest 声明的 resource，避免把仓库中的无关文件带入用户环境。

## 6. skills.lock 设计

`skills.lock` 用于记录实际安装结果，解决复现、升级、卸载和审计问题。

示例：

```yaml
lockfileVersion: 1
generatedBy: "@org/skills@0.1.0"

installed:
  "skill:ecommerce/competitor-analysis":
    type: skill
    version: 1.0.0
    domain: ecommerce
    source:
      type: git
      repo: https://github.com/org/skills.git
      commit: 8f29a71
      path: domains/ecommerce/skills/competitor-analysis
    integrity: sha256-xxx
    agents:
      codex:
        installPath: ~/.codex/skills/competitor-analysis
      enlighten-ai:
        global:
          scope: global
          scopeKind: device
          installPath: "<enlighten-user-data>/codex-home/skills/device/competitor-analysis"
          instanceKey: "device:competitor-analysis"
        project:
          scope: project
          projectDir: "/Users/example/workspace/acme-project"
          projectId: "project-sha256-12chars"
          scopeKind: space
          organizationId: "<org-id>"
          spaceId: "<space-id>"
          installPath: "<enlighten-user-data>/codex-home/skills/by-space/organizations/<org-id>/spaces/<space-id>/competitor-analysis"
          instanceKey: "space:<org-id>:<space-id>:competitor-analysis"
    requestedBy:
      - ecommerce/amazon-seller

  "suite:ecommerce/amazon-seller":
    type: suite
    version: 1.0.0
    source:
      type: git
      repo: https://github.com/org/skills.git
      commit: 8f29a71
      path: domains/ecommerce/suites/amazon-seller.yaml
```

关键字段：

- `source.commit` 锁定 Git commit。
- `integrity` 锁定内容摘要。
- `requestedBy` 支持卸载时判断共享 Skill 是否还能删除。
- `agents` 记录安装到哪些 Agent 以及安装位置。
- project scope 必须记录用户选择的 `projectDir`，并把该目录下的 `.skillsrc.yaml` / `skills.lock` 与 Agent 的实际安装路径绑定起来。
- lockfile 的 `installed` 使用 `skill:<id>` / `suite:<id>` 命名空间，避免 Suite 与 Skill 入口名称相同时互相覆盖。

## 7. CLI 命令设计

V1 命令：

```bash
npx @org/skills add ecommerce/amazon-seller
npx @org/skills add ecommerce/listing-copy
npx @org/skills add ecommerce/listing-copy@1.0.0
npx @org/skills remove ecommerce/amazon-seller
npx @org/skills update
npx @org/skills update ecommerce/amazon-seller
npx @org/skills list
npx @org/skills doctor
```

通用参数：

```bash
--agent codex
--agent enlighten-ai
--agent all
--scope global
--scope project
--project-dir <path>
--registry official
--enlighten-flavor local|test|prod
--enlighten-user-data <path>
--organization-id <id>
--space-id <id>
--state-dir <path>
--dry-run
--yes
--force
--verbose
```

Project scope 通用约束：

- `add`、`remove`、`update`、`list`、`doctor` 只要带 `--scope project`，都必须先确定 `projectDir`。
- 非交互执行时，`--project-dir` 是必填参数；交互执行时，可以由用户选择目录后继续。
- 所有 project scope 命令都从选定 `projectDir` 读取或写入 `.skillsrc.yaml` / `skills.lock`。
- 不能用 Enlighten AI 的 `by-space/...` 安装目录反推项目工作目录；二者只能通过 lockfile/配置建立显式绑定。

### 7.1 add

职责：

- 解析用户输入。
- 加载 registry。
- 判断目标是 Suite 还是 Skill。
- 解析 Suite 内部 Skill。
- 检查 Agent 兼容性。
- 检查 capabilities。
- 若 `--scope project`，解析用户选择的项目工作目录。
- 下载或读取 Git source。
- 校验 integrity。
- 调用 Agent Adapter 安装。
- 更新 lockfile。

`--scope project` 的项目目录规则：

- 用户必须自己选择项目工作目录，不能由 CLI 默默使用当前 shell 目录作为最终项目。
- 非交互模式或带 `--yes` 时，必须传入 `--project-dir <path>`；缺失时直接失败，并提示补充参数。
- 交互模式下未传 `--project-dir` 时，CLI 可以展示当前目录、最近项目、手动输入路径等选项，由用户确认一个目录。
- 选定目录必须解析为绝对路径，并作为项目级 `.skillsrc.yaml` 与 `skills.lock` 的落点。
- 对 Enlighten AI 来说，项目目录不是 Skill 文件安装目录；Skill 文件仍安装到 Enlighten AI 的 project/space scoped capability store。

### 7.2 remove

职责：

- 从 lockfile 找到已安装对象。
- 如果删除 Suite，只移除该 Suite 的 `requestedBy` 关系。
- 对共享 Skill 做引用计数判断。
- 仅删除没有其他 Suite 引用的 Skill。
- 调用 Agent Adapter 删除文件。
- 更新 lockfile。

### 7.3 update

职责：

- 无参数时更新全部。
- 有参数时只更新指定 Suite 或 Skill。
- 根据 manifest 版本约束解析可升级版本。
- 展示升级 diff。
- 更新安装内容和 lockfile。

V1 可以先支持同一 Git 仓库最新 commit 更新，SemVer 解析后置。

### 7.4 list

职责：

- 读取 lockfile。
- 展示已安装 Suite / Skill。
- 展示 Agent、版本、source commit、安装路径。

### 7.5 doctor

职责：

- 检查 Node/npm/npx 环境。
- 检查 Git 可用性。
- 检查目标 Agent 是否可检测。
- 检查 Codex skills 目录是否可写。
- 检查 Enlighten AI 全局 `skills/device` 与项目级 scoped skill root 是否可解析、可写，并确认安装/物化协议可用。
- 检查 project scope 的 `projectDir` 是否存在、是否可写、是否包含当前项目的 `.skillsrc.yaml` / `skills.lock`。
- 检查 `projectDir` 与 Enlighten `organizationId/spaceId/instanceKey` 的绑定是否和 lockfile 一致。
- 检查 lockfile 是否可解析。
- 检查 installed path 是否与 lockfile 一致。
- 检查 manifest schema 是否通过。

## 8. Resolver 设计

Resolver 输入：

```text
ecommerce/amazon-seller
ecommerce/listing-copy
ecommerce/listing-copy@1.0.0
```

Resolver 输出：

```ts
interface ResolvedInstallPlan {
  request: string;
  targetType: "suite" | "skill";
  source: SourceRef;
  suite?: ResolvedSuite;
  skills: ResolvedSkill[];
  warnings: string[];
}
```

解析步骤：

1. 解析 `<domain>/<name>[@version]`。
2. 从 `registry.yaml` 找到 domain path。
3. 优先查找 suite：`domains/<domain>/suites/<name>.yaml`。
4. 如果不是 suite，再查找 skill：`domains/<domain>/skills/<name>/skill.yaml`。
5. 若是 suite，展开 `skills` 列表。
6. 校验每个 Skill manifest。
7. 检查重复 Skill。
8. 检查循环依赖。
9. 生成安装计划。

V1 禁止跨 Domain 隐式查找，所有引用必须明确 `<domain>/<skill>` 或处于同 Domain 内。

## 9. Agent Adapter 设计

V1 暂定支持 Codex Adapter 和 Enlighten AI Adapter。

接口：

```ts
interface AgentAdapter {
  id: string;
  detect(): Promise<AgentDetectionResult>;
  install(skill: ResolvedSkill, options: InstallOptions): Promise<InstalledSkill>;
  remove(skill: InstalledSkill): Promise<void>;
  list(): Promise<InstalledSkill[]>;
  doctor(): Promise<DoctorCheck[]>;
}
```

### 9.1 Codex Adapter

Codex global scope 默认安装到：

```text
~/.codex/skills/<skill-id>/
```

Project scope 安装到用户选择的项目工作目录：

```text
<projectDir>/.codex/skills/<skill-id>/
```

Codex project scope 与 Enlighten AI project scope 一样，必须先确定 `projectDir`；非交互模式下使用 `--project-dir <path>`，交互模式下由用户选择后继续。

安装规则：

- 目标目录不存在时创建。
- 目标目录存在且由当前 manager 管理时允许覆盖。
- 目标目录存在但没有 `.skills-manager.json` 时拒绝覆盖，除非用户显式 `--force`。
- 每个安装目录写入 `.skills-manager.json`。

### 9.2 Enlighten AI Adapter

Enlighten AI Adapter 使用 Enlighten AI Electron `userData` 下的 canonical capability home。正式安装目标分两类：

```text
Global / device scope:
<enlighten-user-data>/codex-home/skills/device/<skill-id>/

Project / space scope:
<enlighten-user-data>/codex-home/skills/by-space/organizations/<org-id>/spaces/<space-id>/<skill-id>/
```

其中：

- `--scope global` 对应 `scope_kind=device`，`instance_key=device:<skill-id>`。
- `--scope project` 对应项目/空间级隔离，沿用 Enlighten 本地 capability scope：`scope_kind=space`，`instance_key=space:<org-id>:<space-id>:<skill-id>`。
- project 级安装同时需要两类上下文：
  - 用户选择的本地项目工作目录 `projectDir`，用于写入该项目自己的 `.skillsrc.yaml` 与 `skills.lock`。
  - 当前 Enlighten AI 项目/空间上下文，至少包含 `organizationId` 和 `spaceId`，用于解析 scoped capability store。
- `projectDir` 由用户选择或通过 `--project-dir <path>` 传入；CLI 不应静默把当前 shell 目录当作最终项目目录。
- `projectDir` 与 `installPath` 是两个不同概念：前者是项目配置和 lockfile 所在目录，后者是 Enlighten AI Electron `userData` 下的 Skill 实际安装目录。

V1 lockfile 中建议记录：

```yaml
agent: enlighten-ai
scope: device | project
projectDir: /abs/path/to/project # scope=project 时必填
projectId: project-sha256-12chars # 由 projectDir 归一化后生成，用于审计和冲突提示
scopeKind: device | space
organizationId: <org-id> # scopeKind=space 时必填
spaceId: <space-id> # scopeKind=space 时必填
installPath: <resolved-path>
instanceKey: device:<skill-id> | space:<org-id>:<space-id>:<skill-id>
```

建议 V1 支持：

```bash
--agent enlighten-ai
--enlighten-flavor local
--scope global
--scope project
--project-dir /abs/path/to/project
```

Enlighten AI Adapter 的边界：

- 全局 Skill 安装到 `codex-home/skills/device/<skill-id>/`。
- 项目级 Skill 的配置归属用户选择的 `projectDir`，该目录保存 `.skillsrc.yaml` 和 `skills.lock`。
- 项目级 Skill 文件安装到 `codex-home/skills/by-space/organizations/<org-id>/spaces/<space-id>/<skill-id>/`。
- lockfile 必须同时记录 `projectDir`、`projectId`、`organizationId`、`spaceId`、`installPath` 和 `instanceKey`，用于证明该本地项目绑定到了哪个 Enlighten scoped install。
- 如果同一个 `projectDir` 检测到不同 `organizationId/spaceId` 的历史绑定，默认拒绝覆盖，除非用户显式执行重新绑定流程。
- 不直接写入 per-session runtime home；session runtime 仍由 Enlighten AI 投影/物化。
- 不把 `~/.codex/skills` 当作 Enlighten AI 的安装目标；它最多是导入来源或 Codex 兼容源。
- 优先复用 Enlighten AI 已有本地安装/导入/物化协议与 `.enlighten-install.json` marker，而不是绕开其 scope 规则裸拷贝。
- `skills.lock` 记录 `scope`、`projectDir`、`scopeKind`、`installPath`、`instanceKey`、source commit 和 integrity。
- 验证方式包括路径存在、`.enlighten-install.json` marker、Enlighten AI 本地 Skill 列表、runtime 可调用性或导入 API 回执。

路径型安装目标的 `.skills-manager.json` 示例：

```json
{
  "managedBy": "@org/skills",
  "schema": "installed-skill/v1",
  "id": "competitor-analysis",
  "domain": "ecommerce",
  "version": "1.0.0",
  "source": {
    "type": "git",
    "repo": "https://github.com/org/skills.git",
    "commit": "8f29a71",
    "path": "domains/ecommerce/skills/competitor-analysis"
  }
}
```

## 10. 安装生命周期

`npx @org/skills add ecommerce/amazon-seller --agent codex` 或 `--agent enlighten-ai` 生命周期：

```text
1. Parse command
2. Resolve scope and projectDir when scope=project
3. Load user/project config
4. Load registry
5. Resolve suite
6. Resolve skills
7. Validate schemas
8. Check dependency graph
9. Check agent compatibility
10. Check capabilities
11. Build install plan
12. Show plan, projectDir, install target and warnings
13. Download or read source
14. Verify integrity
15. Install through selected Agent Adapter
16. Write installed metadata
17. Update selected project's skills.lock
18. Run post-install doctor checks
```

不要把 V1 简化成：

```text
npx
 -> git clone
 -> cp folder
```

这个路径 demo 很快，但无法可靠支持升级、卸载、共享 Skill、审计和复现。

## 11. 安全与权限

Agent Skill 属于可执行行为供应链，不是普通 Markdown。

V1 安装前至少展示：

```text
Installing ecommerce/amazon-seller

Source:
  https://github.com/org/skills.git

Version:
  amazon-seller@1.0.0

Skills:
  competitor-analysis@1.0.0
  listing-copy@1.0.0

Capabilities:
  filesystem.read: required
  filesystem.write: not required
  network: required
  shell: not required

Install target:
  Codex global ~/.codex/skills
  Enlighten AI global <userData>/codex-home/skills/device
  Enlighten AI project <userData>/codex-home/skills/by-space/organizations/<org-id>/spaces/<space-id>

Project working directory:
  /Users/example/workspace/acme-project

Project config:
  /Users/example/workspace/acme-project/.skillsrc.yaml
  /Users/example/workspace/acme-project/skills.lock
```

V1 安全规则：

- 默认不覆盖非 manager 管理目录。
- 只安装 manifest 声明的 resources。
- 记录 source commit 和 integrity。
- `doctor` 可以复核 lockfile 与本地文件状态。
- 含 `shell.required: true` 的 Skill 需要明确警告。

## 12. 版本模型

不要把整个 repo 版本等同于 Skill/Suite 版本。

独立版本：

- CLI version：`@org/skills@0.1.0`
- Suite version：`ecommerce/amazon-seller@1.0.0`
- Skill version：`ecommerce/listing-copy@1.0.0`

推荐 scoped tag：

```text
cli@0.1.0
suite/ecommerce/amazon-seller@1.0.0
skill/ecommerce/listing-copy@1.0.0
skill/ecommerce/competitor-analysis@1.0.0
```

V1 可以先不自动从 tag 解析版本，但 manifest 必须保留 version 字段。

## 13. 配置文件

用户级配置：

```text
~/.skills/config.yaml
```

示例：

```yaml
schema: config/v1

registries:
  official:
    type: git
    url: https://github.com/org/skills.git

defaults:
  registry: official
  agent: codex # or enlighten-ai
  scope: global
```

项目级配置写在用户选择的项目工作目录下：

```text
<projectDir>/.skillsrc.yaml
<projectDir>/skills.lock
```

示例：

```yaml
schema: project-config/v1

agent: codex # or enlighten-ai
scope: project
projectDir: /Users/example/workspace/acme-project

suites:
  ecommerce/amazon-seller: ^1.0.0

skills:
  research/deep-research: ^1.0.0
```

Enlighten AI project scope 的 `.skillsrc.yaml` 可以额外记录当前项目绑定的空间信息：

```yaml
schema: project-config/v1

agent: enlighten-ai
scope: project
projectDir: /Users/example/workspace/acme-project

enlighten:
  flavor: local
  scopeKind: space
  organizationId: "<org-id>"
  spaceId: "<space-id>"

suites:
  vox-reputation/vox-keyword-patrol: ^1.0.0
```

规则：

- `--scope project` 时，`.skillsrc.yaml` 与 `skills.lock` 都写入用户选择的 `projectDir`。
- `projectDir` 必须保存绝对路径，展示时可以保留用户原始输入用于审计。
- `skills.lock` 记录每个 Skill 的 Enlighten `installPath` 与 `instanceKey`，但不把 Skill 文件复制到 `projectDir`。
- V1 可以先支持 `skills.lock`，`.skillsrc.yaml` 在 `init/install` 阶段实现；只要实现 project scope，就必须遵守上述落点。

## 14. CI 与质量门禁

V1 仓库应至少提供：

```bash
npm run lint
npm run typecheck
npm run test
npm run validate:schemas
npm run validate:manifests
```

门禁内容：

- 所有 YAML manifest 必须通过 schema。
- Suite 引用的 Skill 必须存在。
- Skill `entry` 文件必须存在。
- Resource glob 必须匹配到允许范围内的文件。
- 同一类型的 Suite/Skill id 不允许重复；lockfile 使用 `suite:<id>` / `skill:<id>` 命名空间，避免 Suite 与 Skill 入口名称相同时发生覆盖。
- 循环依赖必须失败。
- 示例安装 plan snapshot 必须稳定。

## 15. V1 交付拆分

建议分四个里程碑：

### M1: 仓库骨架与协议

- 初始化 npm workspace。
- 创建 `packages/cli`。
- 创建 `schemas/`。
- 创建示例 `domains/ecommerce`。
- 输出 `registry.yaml`、`domain.yaml`、`suite.yaml`、`skill.yaml`。
- 实现 manifest schema 校验。

### M2: Resolver 与安装计划

- 实现 registry loader。
- 实现 suite/skill resolver。
- 实现 dependency graph 展开。
- 实现 install plan 输出。
- 支持 `--dry-run`。

### M3: Codex / Enlighten AI Adapter 与 lockfile

- 实现 Codex global install。
- 实现 Enlighten AI global/device install。
- 实现 Enlighten AI project/space scoped install。
- 实现 `--scope project --project-dir <path>` 的项目目录解析；交互模式下支持用户选择目录，非交互模式缺失时失败。
- 实现 `.skills-manager.json`。
- 视 Enlighten AI 协议需要记录 `.enlighten-install.json` install marker。
- 实现 `skills.lock` 写入。
- 实现 `list`。
- 实现基础 `remove`。

### M4: Doctor 与发布准备

- 实现 `doctor`。
- 完善异常信息。
- 增加 fixture tests。
- 增加 README 中文使用说明。
- 配置 npm package `bin`。
- 准备 `npx @org/skills` 入口。

## 16. 验收标准

最小验收场景：

```bash
npx @org/skills add ecommerce/amazon-seller --agent codex --dry-run
npx @org/skills add ecommerce/amazon-seller --agent enlighten-ai --dry-run
```

必须输出稳定 install plan。

实际安装：

```bash
npx @org/skills add ecommerce/amazon-seller --agent codex --yes
npx @org/skills add ecommerce/amazon-seller --agent enlighten-ai --enlighten-flavor local --yes
npx @org/skills add ecommerce/amazon-seller --agent enlighten-ai --scope project --project-dir /Users/example/workspace/acme-project --enlighten-flavor local --yes
```

必须完成：

- `~/.codex/skills/competitor-analysis/SKILL.md` 存在。
- `~/.codex/skills/listing-copy/SKILL.md` 存在。
- Enlighten AI global 安装时，`<userData>/codex-home/skills/device/competitor-analysis/SKILL.md` 存在。
- Enlighten AI project 安装时，用户选择的 `<projectDir>/.skillsrc.yaml` 与 `<projectDir>/skills.lock` 存在。
- Enlighten AI project 安装时，`<userData>/codex-home/skills/by-space/organizations/<org-id>/spaces/<space-id>/competitor-analysis/SKILL.md` 存在。
- Enlighten AI 安装目录存在 `.enlighten-install.json`，且 scope marker 正确。
- Enlighten AI 本地 Skill 列表能看到对应 Skill，runtime 能在可调用 Skill 列表或后续物化检查中识别该 Skill。
- Codex 路径型安装目录有 `.skills-manager.json`。
- `skills.lock` 记录 suite、skill、source commit、integrity、Codex install path 或 Enlighten `scope/projectDir/projectId/scopeKind/organizationId/spaceId/installPath/instanceKey`。
- `--scope project --agent enlighten-ai --yes` 缺少 `--project-dir` 时必须失败，并给出可执行提示。

查看：

```bash
npx @org/skills list
```

必须能列出已安装 Suite/Skill。

检查：

```bash
npx @org/skills doctor
```

必须能检查 Codex 安装目录、Enlighten AI global/device 与 project/space scoped 安装状态、项目目录 lockfile、manifest、本地文件一致性，以及 `projectDir` 到 `organizationId/spaceId` 的绑定一致性。

卸载：

```bash
npx @org/skills remove ecommerce/amazon-seller --yes
```

必须能删除该 Suite 关联且不再被其他 Suite 引用的 Skill。

## 17. 主要风险与规避

### 风险一：把 Skill 做成 npm package

问题：

- package 数量爆炸。
- release 流程被 npm 绑架。
- Suite 共享 Skill 时依赖关系复杂。

规避：

- npm 只发布 CLI。
- Skill 内容保留在 Git。

### 风险二：Suite 复制 Skill

问题：

- 多 Suite 共享 Skill 时产生重复。
- 修复一个 Skill 需要改多份。

规避：

- Suite 只引用 Skill id 和 version。

### 风险三：安装器退化成复制脚本

问题：

- 无法可靠更新、卸载、复现。

规避：

- V1 必须实现 resolver、lockfile、adapter metadata。

### 风险四：Agent 路径写死在 Skill 中

问题：

- Codex、Enlighten AI、Claude Code、Cursor 目录规则变化会污染 Skill 内容。

规避：

- Skill 保持 normalized model。
- Agent 差异只放 Adapter。

### 风险五：供应链与权限不可见

问题：

- Skill 可能携带脚本、网络访问、文件操作能力。

规避：

- manifest 声明 capabilities。
- 安装前展示风险。
- lockfile 记录 source 和 integrity。

## 18. 推荐下一步

首个标准化 Suite 场景暂定为 Vox 舆情巡检，详见：

- [Vox 舆情巡检 Skill Suite 设计](vox-reputation-patrol-suite-design.md)

该 Suite 由两个 Skill 组成：

- `vox-patrol-env-init`：初始化与检查 OpenCLI、飞书 `lark-cli`、Python、Browser Bridge 等依赖环境。
- `vox-keyword-patrol`：根据关键词与巡检规则执行搜索、过滤、证据留存，并将巡检结果写入飞书表格。

下一步不要直接写完整 CLI，而是先完成以下文件：

- `package.json`
- `packages/cli/package.json`
- `registry.yaml`
- `schemas/registry.schema.json`
- `schemas/domain.schema.json`
- `schemas/suite.schema.json`
- `schemas/skill.schema.json`
- `schemas/lockfile.schema.json`
- `domains/ecommerce/domain.yaml`
- `domains/ecommerce/suites/amazon-seller.yaml`
- `domains/ecommerce/skills/competitor-analysis/skill.yaml`
- `domains/ecommerce/skills/competitor-analysis/SKILL.md`
- `domains/vox-reputation/domain.yaml`
- `domains/vox-reputation/suites/vox-keyword-patrol.yaml`
- `domains/vox-reputation/skills/vox-patrol-env-init/skill.yaml`
- `domains/vox-reputation/skills/vox-patrol-env-init/SKILL.md`
- `domains/vox-reputation/skills/vox-keyword-patrol/skill.yaml`
- `domains/vox-reputation/skills/vox-keyword-patrol/SKILL.md`

完成后再实现：

```bash
npx @org/skills add ecommerce/amazon-seller --dry-run
npx @org/skills add vox-reputation/vox-keyword-patrol --dry-run
```

只要 dry-run 的 resolver/install plan 稳定，后续 Codex / Enlighten AI Adapter 和真实安装就会顺很多。
