# @enlighten-vox/skills

Git-backed Skill manager CLI for Codex and Enlighten AI.

The npm package publishes the CLI only. Skill content stays in Git sources and
is materialized into the selected agent's Skill directory during installation.

## Usage

```bash
npx @enlighten-vox/skills --help
```

Discover Skills and Suites from a Git repository:

```bash
npx @enlighten-vox/skills add https://github.com/enlighten-vox/skills --list
```

Inspect a direct external source install plan:

```bash
npx @enlighten-vox/skills add github:owner/repo --skill demo --agent codex --dry-run
```

Install a Suite by managed id from an explicit registry checkout or Git source:

```bash
npx @enlighten-vox/skills add \
  vox-reputation/vox-keyword-patrol \
  --registry https://github.com/enlighten-vox/skills \
  --agent codex \
  --scope project \
  --project-dir . \
  --yes
```

Install the same Suite for an Enlighten AI space:

```bash
npx @enlighten-vox/skills add \
  vox-reputation/vox-keyword-patrol \
  --registry https://github.com/enlighten-vox/skills \
  --agent enlighten-ai \
  --scope space \
  --organization-id <org-id> \
  --space-id <space-id> \
  --yes
```

Install it into a local project directory for Enlighten AI:

```bash
npx @enlighten-vox/skills add \
  vox-reputation/vox-keyword-patrol \
  --registry https://github.com/enlighten-vox/skills \
  --agent enlighten-ai \
  --scope project \
  --project-dir . \
  --yes
```

Inspect a Skill from a Gitee or GitLab repository:

```bash
npx @enlighten-vox/skills add gitee:owner/repo --skill demo --dry-run
npx @enlighten-vox/skills add gitlab:group/repo --skill demo --dry-run
```

The resolver also accepts GitHub/Gitee/GitLab HTTPS tree URLs, SSH Git URLs,
generic Git URLs, and local Git paths. Prefer `github:owner/repo` over bare
`owner/repo` in CLI installs so managed ids such as `domain/suite` are never
mistaken for public GitHub repositories.

Read-only project commands can default to the current shell directory. Actual
non-interactive project mutations require `--project-dir` so installs, updates,
and removals cannot silently target the wrong workspace.

Scope targets:

```text
codex global: ~/.codex/skills/<skill>
codex project: <projectDir>/.codex/skills/<skill>
enlighten-ai global: {userData}/codex-home/skills/device/<skill>
enlighten-ai space: {userData}/codex-home/skills/by-space/organizations/<org>/spaces/<space>/<skill>
enlighten-ai project: <projectDir>/.codex/skills/<skill>
```

For Enlighten AI space installs, pass concrete `--organization-id` and
`--space-id`, or set `ENLIGHTEN_ORG_ID` and `ENLIGHTEN_SPACE_ID`. Dry-runs may
show placeholder ids, but real installs reject them. Codex does not support
`--scope space`.

## Commands

```text
skills add <source> [--suite <id> | --skill <id>] [--agent codex|enlighten-ai] [--scope global|space|project]
skills add <source> --list
skills add <domain>/<suite-or-skill> --registry <source>
skills list [--agent codex|enlighten-ai] [--scope global|space|project]
skills remove <id> [--agent codex|enlighten-ai] [--scope global|space|project]
skills update [<id>] [--agent codex|enlighten-ai] [--scope global|space|project]
skills doctor [--agent codex|enlighten-ai] [--scope global|space|project]
skills validate [--registry <source>]
```

Use `--dry-run` to inspect an install plan and `--yes` for non-interactive
installation, update, or removal. Direct external sources currently support
`--list` and `--dry-run` only; use `--registry <source>` with a managed id for
real installs from a registry repository.
