# Vox Patrol Environment Requirements

The environment initializer should check tool presence and versions without printing secrets.

Required capabilities:

- Node/npm/npx for Skill Manager execution.
- Python 3 for patrol helper scripts.
- OpenCLI with platform commands needed by the target patrol.
- Browser Bridge profile state when OpenCLI depends on an authenticated browser.
- `lark-cli` for Feishu sheet read/write and readback verification.

Secrets, cookies, tokens, and keychain values must never be copied into the output report.
