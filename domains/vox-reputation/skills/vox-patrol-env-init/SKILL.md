---
name: vox-patrol-env-init
description: Initialize and diagnose the local environment required for Vox reputation patrols, including OpenCLI, lark-cli, Python, Browser Bridge profile state, and Feishu sheet write readiness.
---

# Vox Patrol Environment Init

Use this skill before running a Vox keyword patrol.

## Workflow

1. Inspect the local Python, Node, OpenCLI, Browser Bridge, and `lark-cli` availability.
2. Verify Feishu sheet access with the user's authorized identity.
3. Write a local `.vox-patrol/env-report.json` and a readable Markdown diagnosis.
4. Stop on account-risk prompts, missing credentials, or unsafe login states.

## Resources

- Read `references/env-requirements.md` for the expected tools and evidence boundaries.
- Run `scripts/check_env.py` once the script is implemented for deterministic checks.
