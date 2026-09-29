---
name: vox-keyword-patrol
description: Run keyword-based Vox reputation patrols from user-provided rules or Markdown rule files, preserve evidence, deduplicate results, write qualifying patrol rows to Feishu sheets, and read back writes for audit.
---

# Vox Keyword Patrol

Use this skill after the Vox patrol environment has passed initialization.

## Workflow

1. Read patrol rules from the user prompt or a Markdown file.
2. Search by keyword, platform, time window, and configured exclusions.
3. Keep only records that satisfy the patrol rules and evidence requirements.
4. Export local raw evidence, normalized rows, rejected-row logs, and screenshots when available.
5. Write accepted records to Feishu, then read back the written range and compare it with local rows.

## Resources

- Read `references/rule-contract.md` before interpreting business patrol rules.
- Run `scripts/run_patrol.py` once the script is implemented for deterministic patrol execution.
