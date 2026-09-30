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
  --project-dir .
```

Install a Skill from a Gitee or GitLab repository:

```bash
npx @enlighten-vox/skills add gitee:owner/repo --skill demo
npx @enlighten-vox/skills add gitlab:group/repo --skill demo
```

The resolver also accepts GitHub/Gitee/GitLab HTTPS tree URLs, SSH Git URLs,
generic Git URLs, local Git paths, and `owner/repo` GitHub shorthand.

Project scope defaults to the current shell directory. Use `--project-dir` to
select another project directory.

## Commands

```text
skills add <source> [--suite <id> | --skill <id>]
skills list
skills remove <id>
skills update [<id>]
skills doctor
skills validate
```

Use `--dry-run` to inspect an install plan and `--yes` for non-interactive
installation or removal.
