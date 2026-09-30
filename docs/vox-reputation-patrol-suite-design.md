# Vox 舆情巡检 Skill Suite 设计

## 1. 场景定位

当前首个标准化 Skill Suite 暂定以 Vox 舆情巡检为场景，目标是把已有项目型舆情维护仓库沉淀成可复用、可安装、可校验的 Skill Suite。

核心用户任务：

```bash
npx @enlighten-vox/skills add vox-reputation/vox-keyword-patrol --registry https://github.com/enlighten-vox/skills --agent codex
npx @enlighten-vox/skills add vox-reputation/vox-keyword-patrol --registry https://github.com/enlighten-vox/skills --agent enlighten-ai
npx @enlighten-vox/skills add vox-reputation/vox-keyword-patrol --registry https://github.com/enlighten-vox/skills --agent enlighten-ai --scope space --organization-id <org-id> --space-id <space-id> --enlighten-flavor local --yes
npx @enlighten-vox/skills add vox-reputation/vox-keyword-patrol --registry https://github.com/enlighten-vox/skills --agent enlighten-ai --scope project --project-dir /Users/example/workspace/vox-huawei-honor --yes
```

安装后，用户可以让 Agent 完成：

- 初始化舆情巡检所需依赖环境。
- 基于关键词、平台、时间窗和巡检规则执行搜索。
- 对结果按规则过滤、去重、保留证据。
- 将巡检结果写入指定飞书表格。
- 生成本地证据包，便于复核、重跑和审计。

当使用 `--agent enlighten-ai --scope space` 时，Skill 文件安装到 Enlighten Electron `codex-home/skills/by-space/organizations/<org-id>/spaces/<space-id>/<skill-id>/`，真实安装必须提供具体 `organizationId` 和 `spaceId`。

当使用 `--scope project` 时，真实安装、更新和卸载必须通过 `--project-dir` 显式指定项目工作目录；该目录保存 `.skillsrc.yaml`、`skills.lock`、`.vox-patrol/` 运行输出，Skill 文件安装到 `<projectDir>/.codex/skills/<skill-id>/`。

## 2. 参考仓库观察

参考仓库：

```text
https://git.datastory.com.cn/ds-reputation-maintain/ds_vox_huawei_honor
```

本次只读检查到：

- Git 远端可访问，存在 `main` 与 `dev` 分支。
- Web 页面需要登录。
- 当前 `main` 更像项目知识库/素材库，而不是完整可执行巡检程序。
- 关键内容包括：
  - `知识库/审核与字段填写规范.md`
  - `知识库/友商对比简报.md`
  - `材料/M9周期评论区维护策略/` 下的产品说明、PPT、Excel、截图等素材。

因此标准化 Skill Suite 不应直接假设参考仓库已有可复用脚本，而应把它抽象成：

- `references/`：业务规则、字段规范、事实边界、竞品资料。
- `assets/`：项目素材、模板、示例表格、截图样例。
- `scripts/`：由本 Suite 新增的可复用环境检查、采集、清洗和飞书写入脚本。

Skill 包内容原则：

- `SKILL.md` 只保留触发条件、执行流程、关键停损规则和资源索引。
- 长规则、字段说明、平台口径、案例样例放入一层 `references/` 文件，避免让主 Skill 过长。
- 环境检查、OpenCLI 调用、结果清洗、飞书写入和 readback 校验放入 `scripts/`，用于保证可重复执行。
- 示例表格、截图样例、模板放入 `assets/`，不在执行时默认加载进上下文。

## 3. Suite 总体结构

推荐 Domain：

```text
vox-reputation
```

推荐 Suite：

```text
vox-keyword-patrol
```

Suite 包含两个核心 Skill：

```text
vox-keyword-patrol suite
├── vox-patrol-env-init
└── vox-keyword-patrol
```

### 3.1 vox-patrol-env-init

定位：环境初始化与依赖检查 Skill。

职责：

- 检查本机 Node/npm/npx。
- 检查 Python 版本与虚拟环境。
- 检查 OpenCLI 是否存在、版本、平台命令能力。
- 检查 Browser Bridge/profile 状态。
- 检查 `lark-cli` 是否存在。
- 检查飞书 Wiki/Spreadsheet 写入前置能力。
- 生成 `.vox-patrol/env-report.json`。
- 生成可读的环境诊断 Markdown。
- 不保存或输出任何 token、cookie、keychain 内容。

不负责：

- 不执行真实关键词巡检。
- 不写入飞书业务表。
- 不绕过登录、安全校验或账号风控。

### 3.2 vox-keyword-patrol

定位：关键词舆情巡检执行 Skill。

职责：

- 读取关键词列表。
- 读取巡检规则 Markdown/YAML。
- 调用 OpenCLI 或平台 adapter 搜索。
- 按平台能力执行详情补充。
- 统一归一化结果 JSON。
- 按规则过滤、去重、标注人工复核状态。
- 输出本地 CSV/JSON/Markdown 证据包。
- 通过 `lark-cli` 写入飞书表格。
- 写入后 readback，对比本地源数据与飞书实际数据。

不负责：

- 不发布评论。
- 不执行舆论引导动作。
- 不把自动过滤结果宣称为最终业务定性。
- 不在未授权情况下写入飞书或外部系统。

## 4. 推荐仓库落位

在 Skills Manager 仓库中的建议结构：

```text
domains/
└── vox-reputation/
    ├── domain.yaml
    │
    ├── suites/
    │   └── vox-keyword-patrol.yaml
    │
    └── skills/
        ├── vox-patrol-env-init/
        │   ├── skill.yaml
        │   ├── SKILL.md
        │   ├── scripts/
        │   │   ├── doctor.sh
        │   │   ├── check_opencli.py
        │   │   ├── check_lark_cli.py
        │   │   ├── check_python_env.py
        │   │   └── write_env_report.py
        │   └── references/
        │       └── environment-requirements.md
        │
        └── vox-keyword-patrol/
            ├── skill.yaml
            ├── SKILL.md
            ├── scripts/
            │   ├── load_patrol_config.py
            │   ├── normalize_opencli_results.py
            │   ├── filter_patrol_results.py
            │   ├── dedupe_results.py
            │   ├── export_feishu_csv.py
            │   ├── write_feishu_sheet.py
            │   └── verify_feishu_readback.py
            ├── references/
            │   ├── patrol-rule-format.md
            │   ├── feishu-write-contract.md
            │   ├── opencli-platform-capabilities.md
            │   └── review-and-field-rules.md
            └── assets/
                └── examples/
                    ├── patrol.config.yaml
                    ├── patrol.rules.md
                    └── feishu_posts.example.csv
```

参考仓库中的 `知识库/审核与字段填写规范.md` 适合进入：

```text
references/review-and-field-rules.md
```

参考仓库中的 `知识库/友商对比简报.md` 适合按项目进入：

```text
assets/project-knowledge/honor-magic9/友商对比简报.md
```

注意：大型 PDF、PPTX、XLSX 素材不建议无差别打入通用 Skill。V1 应优先支持项目配置引用外部资料目录，或只放小型示例素材。

## 5. Suite manifest 示例

```yaml
schema: suite/v1
id: vox-keyword-patrol
name: Vox Keyword Patrol Suite
domain: vox-reputation
version: 0.1.0
description: Standard Vox reputation patrol suite for environment setup, keyword search, rule filtering, evidence export and Feishu sheet writeback.

skills:
  - id: vox-patrol-env-init
    version: ^0.1.0
  - id: vox-keyword-patrol
    version: ^0.1.0

tags:
  - vox
  - reputation
  - patrol
  - opencli
  - feishu
```

## 6. Skill manifest 示例

### 6.1 vox-patrol-env-init

```yaml
schema: skill/v1
id: vox-patrol-env-init
name: Vox Patrol Environment Init
domain: vox-reputation
version: 0.1.0
description: Initialize and verify dependencies required by Vox reputation patrol workflows, including OpenCLI, Browser Bridge, lark-cli, Python and local workspace directories.
entry: SKILL.md

compatibility:
  agents:
    - codex
    - enlighten-ai

capabilities:
  filesystem:
    read: true
    write: true
  network:
    required: true
  shell:
    required: true
  tools:
    - shell

resources:
  - SKILL.md
  - scripts/**
  - references/**

tags:
  - environment
  - opencli
  - lark-cli
  - python
```

### 6.2 vox-keyword-patrol

```yaml
schema: skill/v1
id: vox-keyword-patrol
name: Vox Keyword Patrol
domain: vox-reputation
version: 0.1.0
description: Run keyword-based Vox reputation patrols, normalize OpenCLI results, apply Markdown/YAML patrol rules, export evidence files and write verified rows to Feishu spreadsheets.
entry: SKILL.md

compatibility:
  agents:
    - codex
    - enlighten-ai

dependencies:
  skills:
    - vox-patrol-env-init

capabilities:
  filesystem:
    read: true
    write: true
  network:
    required: true
  shell:
    required: true
  tools:
    - shell

resources:
  - SKILL.md
  - scripts/**
  - references/**
  - assets/examples/**

tags:
  - keyword-search
  - reputation
  - feishu
  - opencli
```

## 7. 输入设计

V1 支持三类输入。

### 7.1 巡检配置 YAML

推荐文件：

```text
patrol.config.yaml
```

示例：

```yaml
schema: vox-patrol-config/v1

project:
  id: honor-magic9
  name: 荣耀Magic9舆情巡检

keywords:
  - 荣耀Magic9
  - Magic9 Pro Max
  - 荣耀阿莱

platforms:
  - weibo
  - xiaohongshu
  - douyin

time_window:
  from: "2026-09-01"
  to: "2026-09-29"

limits:
  search_limit_per_keyword: 100
  detail_limit_per_keyword: 30

opencli:
  profile: auto
  output_format: json

feishu:
  wiki_url: "https://my.feishu.cn/wiki/..."
  sheet_name: "巡检结果"
  write_mode: append
  allow_overwrite: false

rules:
  file: patrol.rules.md

outputs:
  dir: outputs/vox-patrol
```

### 7.2 巡检规则 Markdown

推荐文件：

```text
patrol.rules.md
```

规则内容适合由业务人员维护，Skill 负责解析关键区块。

示例结构：

```markdown
# 舆情巡检规则

## 保留条件

- 发布时间在配置时间窗内。
- 主帖或评论与目标关键词有明确语义关联。
- 作者不属于排除名单。
- 链接可复核。

## 排除条件

- 明显广告、抽奖、无关转发。
- 无法确认发布时间。
- 链接重复。
- 内容与关键词仅机械同字但无业务关联。

## 人工复核

- 负面倾向但证据不足。
- 多品牌混合对比且主体不清。
- 涉及未证实参数、爆料或截图传闻。

## 飞书字段映射

| 输出字段 | 飞书列名 | 必填 |
| --- | --- | --- |
| collected_at | 采集时间 | 是 |
| keyword | 搜索关键词 | 是 |
| platform | 平台 | 是 |
| author_name | 作者昵称 | 是 |
| published_at | 发布时间 | 否 |
| comment_count | 评论数 | 否 |
| post_url | 主帖链接 | 是 |
| screenshot_path | 主帖截图 | 否 |
| review_status | 复核状态 | 是 |
| notes | 备注 | 否 |
```

### 7.3 项目知识库

项目知识库可以通过配置引用：

```yaml
knowledge:
  references:
    - 知识库/审核与字段填写规范.md
    - 知识库/友商对比简报.md
  materials:
    - 材料/M9周期评论区维护策略/
```

Skill 读取知识库时必须区分：

- 业务规则。
- 产品事实。
- 爆料或存疑资料。
- 示例素材。
- 飞书字段规范。

不得把 OCR、截图、爆料或旧材料自动升级为确认事实。

## 8. 输出设计

V1 产物目录：

```text
outputs/vox-patrol/<run-id>/
├── run.json
├── env-report.json
├── raw/
│   ├── weibo-search.jsonl
│   ├── xiaohongshu-search.jsonl
│   └── douyin-search.jsonl
├── normalized/
│   └── posts.jsonl
├── filtered/
│   ├── kept.jsonl
│   ├── rejected.jsonl
│   └── needs_review.jsonl
├── feishu_posts.csv
├── feishu_readback.csv
└── report.md
```

### 8.1 标准结果字段

推荐规范化字段：

```yaml
run_id: string
collected_at: datetime
platform: string
keyword: string
source_query: string
post_id: string
post_url: string
author_name: string
author_id: string
published_at: string
title: string
content: string
like_count: integer
comment_count: integer
share_count: integer
screenshot_path: string
raw_path: string
matched_rules: string[]
review_status: keep|reject|needs_review
reject_reason: string
notes: string
```

### 8.2 飞书 CSV 字段

V1 默认飞书窄表字段：

```text
采集时间
搜索关键词
平台
作者昵称
发布时间
评论数
主帖链接
主帖截图
复核状态
备注
```

如果项目需要沿用更窄字段，也可以兼容：

```text
采集时间
搜索关键词
作者昵称
发布时间
评论数
主帖链接
主帖截图
备注
```

字段变化必须由 `patrol.rules.md` 或 `patrol.config.yaml` 明确声明，不能在脚本里硬编码不同项目的列名。

## 9. 执行生命周期

### 9.1 环境初始化

```text
1. 检查 Node/npm/npx
2. 检查 Python
3. 创建或检查项目 venv
4. 检查 opencli 路径与版本
5. 运行 opencli doctor
6. 检查 Browser Bridge profile
7. 检查 lark-cli 路径
8. 检查飞书写入身份是否可用
9. 输出 env-report.json
10. 明确列出阻塞项、警告项、可继续项
```

环境初始化可以修复本地缺失目录、创建 venv、安装 Python 依赖，但安装 OpenCLI、登录平台、飞书授权等外部状态变更必须清楚提示用户并保留可审计日志。

### 9.2 巡检执行

```text
1. 读取 patrol.config.yaml
2. 读取 patrol.rules.md
3. 读取项目知识库 references
4. 执行 env preflight
5. 展开 keyword × platform 任务
6. 调用 OpenCLI 搜索
7. 保存 raw 结果
8. 按平台补详情
9. 标准化 posts.jsonl
10. 按规则过滤、去重、分类
11. 生成 feishu_posts.csv
12. dry-run 飞书写入范围
13. 写入飞书
14. 读回飞书行
15. 对比本地 CSV 与 readback
16. 输出 report.md
```

## 10. OpenCLI 能力边界

V1 不能假设所有平台都有同等能力。

设计原则：

- 先运行 `opencli --version` 和对应平台 `--help`。
- 搜索能力、详情能力、评论能力分开判断。
- 多 Browser Bridge profile 时必须显式选择 profile。
- 对 unsupported 或 partial 平台输出 `needs_manual_review` 或 `adapter_unverified`。
- 不用搜索结果近似替代详情接口。

平台能力应写入：

```text
references/opencli-platform-capabilities.md
```

并允许环境初始化 Skill 动态生成当前机器的能力报告。

## 11. 飞书写入契约

飞书写入必须遵循：

- 先解析 Wiki URL，确认真实资源类型。
- 确认目标是 Spreadsheet。
- 读取 workbook、sheet、表头、当前区域。
- 只写目标范围。
- 默认 `allow_overwrite=false`。
- 写入前 dry-run。
- 写入后 readback。
- readback 与本地 CSV 逐行比对。
- 保留本地 `feishu_readback.csv`。

不允许：

- 只凭写入 API 成功就宣称完成。
- 将 Wiki 节点 ID 当 Spreadsheet token。
- 未核对表头就按固定列号写入。
- 覆盖已有行而不做冲突检测。

## 12. 安全与授权边界

环境初始化和巡检执行都必须遵守：

- 不保存飞书 token、平台 cookie、OpenCLI session secret。
- 不输出 keychain 内容。
- 不绕过平台安全登录、CAPTCHA 或账号风控。
- 不把本地模拟写入说成真实飞书写入。
- 不把自动分类说成最终业务认定。
- 对负面、竞品、风险项保留人工复核边界。

## 13. 标准化 Skill 编写原则

### 13.1 SKILL.md 保持短流程

`SKILL.md` 只保留核心流程和资源路由：

- 什么时候运行 env init。
- 什么时候读取规则文件。
- 哪些脚本负责 deterministic 操作。
- 哪些 references 需要按场景读取。
- 哪些外部写入必须 readback。

详细平台能力、飞书写入协议、字段规范放入 `references/`。

### 13.2 scripts 负责易错操作

以下逻辑应脚本化：

- OpenCLI 能力探测。
- 结果 JSON 标准化。
- 去重。
- 规则过滤。
- CSV 导出。
- 飞书写入与 readback 对比。

### 13.3 references 负责业务知识

以下内容放 references：

- 审核与字段填写规范。
- 项目事实边界。
- 友商对比资料。
- 规则解释。
- 平台能力说明。

## 14. 验收标准

### 14.1 env init 验收

```bash
vox-patrol-env-init doctor --output outputs/env-report.json
```

必须证明：

- opencli 路径、版本、doctor 结果。
- Browser Bridge profile 状态。
- lark-cli 路径。
- Python 版本。
- venv 状态。
- 飞书写入能力是可用、缺授权或未验证，不混淆。

### 14.2 keyword patrol dry-run 验收

```bash
vox-keyword-patrol run --config patrol.config.yaml --dry-run
```

必须输出：

- 任务展开表。
- 预期飞书写入字段。
- OpenCLI 平台能力矩阵。
- 不触发真实飞书写入。

### 14.3 小样本真实巡检验收

```bash
vox-keyword-patrol run --config patrol.config.yaml --limit 3 --write-feishu
```

必须产出：

- raw JSON。
- normalized JSONL。
- filtered JSONL。
- `feishu_posts.csv`。
- `feishu_readback.csv`。
- `report.md`。
- 飞书 readback 与本地 CSV 一致性结论。

## 15. 下一步落地清单

建议下一步先创建这些文件：

```text
domains/vox-reputation/domain.yaml
domains/vox-reputation/suites/vox-keyword-patrol.yaml
domains/vox-reputation/skills/vox-patrol-env-init/skill.yaml
domains/vox-reputation/skills/vox-patrol-env-init/SKILL.md
domains/vox-reputation/skills/vox-keyword-patrol/skill.yaml
domains/vox-reputation/skills/vox-keyword-patrol/SKILL.md
domains/vox-reputation/skills/vox-keyword-patrol/assets/examples/patrol.config.yaml
domains/vox-reputation/skills/vox-keyword-patrol/assets/examples/patrol.rules.md
domains/vox-reputation/skills/vox-keyword-patrol/references/feishu-write-contract.md
domains/vox-reputation/skills/vox-keyword-patrol/references/opencli-platform-capabilities.md
```

脚本实现顺序：

1. `check_opencli.py`
2. `check_lark_cli.py`
3. `load_patrol_config.py`
4. `normalize_opencli_results.py`
5. `export_feishu_csv.py`
6. `verify_feishu_readback.py`

第一阶段先实现 dry-run 和本地 CSV，不急于真实写飞书；第二阶段再接入 `lark-cli` 写入和 readback。
