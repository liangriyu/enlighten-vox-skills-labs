# @enlighten-vox/skills

Git-backed Skill manager CLI for Codex and Enlighten AI.

The npm package publishes the CLI only. Skill content stays in Git sources and
is materialized into the selected agent's Skill directory during installation.

## Usage

```bash
npx @enlighten-vox/skills --help
```

Install a Suite from a Git repository:

```bash
npx @enlighten-vox/skills add \
  https://github.com/enlighten-vox/skills \
  --suite vox-reputation/vox-keyword-patrol \
  --agent codex \
  --scope project \
  --project-dir . \
  --yes
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

Install a Skill from a Gitee or GitLab repository:

```bash
npx @enlighten-vox/skills add gitee:owner/repo --skill demo
npx @enlighten-vox/skills add gitlab:group/repo --skill demo
```

The resolver also accepts GitHub/Gitee/GitLab HTTPS tree URLs, SSH Git URLs,
generic Git URLs, and local Git paths. Prefer `github:owner/repo` over bare
`owner/repo` in CLI installs so managed ids such as `domain/suite` are never
mistaken for public GitHub repositories.

Read-only project commands can default to the current shell directory. Actual
non-interactive project mutations require `--project-dir` so installs, updates,
and removals cannot silently target the wrong workspace.

For Enlighten AI project installs, pass concrete `--organization-id` and
`--space-id`, or set `ENLIGHTEN_ORG_ID` and `ENLIGHTEN_SPACE_ID`. Dry-runs may
show placeholder ids, but real installs reject them.

## Commands

```text
skills add <source> [--suite <id> | --skill <id>]
skills add <domain>/<suite-or-skill> --registry <source>
skills list
skills remove <id>
skills update [<id>]
skills doctor
skills validate [--registry <source>]
```

Use `--dry-run` to inspect an install plan and `--yes` for non-interactive
installation, update, or removal.
