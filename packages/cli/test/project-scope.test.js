import assert from "node:assert/strict";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { run } from "../src/index.js";
import { resolveProjectScope } from "../src/lib/project-scope.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

test("project scope fails in non-interactive mode without projectDir", async () => {
  await assert.rejects(
    () =>
      resolveProjectScope(
        { scope: "project", yes: true },
        { cwd: repoRoot, stdin: { isTTY: false } }
      ),
    /--project-dir <path>/
  );
});

test("enlighten project dry-run binds selected projectDir to scoped install path", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-project-"));
  const stdout = createWriter();
  const stderr = createWriter();

  const exitCode = await run(
    [
      "add",
      "vox-reputation/vox-keyword-patrol",
      "--agent",
      "enlighten-ai",
      "--scope",
      "project",
      "--project-dir",
      projectDir,
      "--enlighten-flavor",
      "local",
      "--dry-run"
    ],
    {
      cwd: repoRoot,
      stdin: { isTTY: false },
      stdout,
      stderr
    }
  );

  assert.equal(exitCode, 0, stderr.output);
  const plan = JSON.parse(stdout.output);
  assert.equal(plan.scope, "project");
  assert.equal(plan.project.projectDir, fsSync.realpathSync(projectDir));
  assert.equal(plan.skills.length, 2);
  assert.match(plan.skills[0].installPath, /codex-home\/skills\/by-space\/organizations\/<org-id>\/spaces\/<space-id>/);
  assert.equal(plan.skills[0].projectDir, fsSync.realpathSync(projectDir));
  assert.match(plan.skills[0].instanceKey, /^space:<org-id>:<space-id>:/);
});

test("enlighten project install writes skills, marker, project config, and lockfile", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-project-install-"));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "enlighten-user-data-"));
  const stdout = createWriter();
  const stderr = createWriter();

  const exitCode = await run(
    [
      "add",
      "vox-reputation/vox-keyword-patrol",
      "--agent",
      "enlighten-ai",
      "--scope",
      "project",
      "--project-dir",
      projectDir,
      "--enlighten-user-data",
      userData,
      "--organization-id",
      "org-test",
      "--space-id",
      "space-test",
      "--yes"
    ],
    {
      cwd: repoRoot,
      stdin: { isTTY: false },
      stdout,
      stderr
    }
  );

  assert.equal(exitCode, 0, stderr.output);
  const result = JSON.parse(stdout.output);
  assert.equal(result.installed.length, 2);

  const installRoot = path.join(
    userData,
    "codex-home",
    "skills",
    "by-space",
    "organizations",
    "org-test",
    "spaces",
    "space-test"
  );
  const skillRoot = path.join(installRoot, "vox-keyword-patrol");
  const marker = JSON.parse(
    await fs.readFile(path.join(skillRoot, ".enlighten-install.json"), "utf8")
  );
  const lockfile = JSON.parse(await fs.readFile(path.join(projectDir, "skills.lock"), "utf8"));
  const config = await fs.readFile(path.join(projectDir, ".skillsrc.yaml"), "utf8");

  assert.equal(marker.scope_kind, "space");
  assert.equal(marker.organization_id, "org-test");
  assert.equal(marker.space_id, "space-test");
  assert.equal(marker.project_dir, fsSync.realpathSync(projectDir));
  assert.equal(
    await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8"),
    await fs.readFile(
      path.join(
        repoRoot,
        "domains/vox-reputation/skills/vox-keyword-patrol/SKILL.md"
      ),
      "utf8"
    )
  );
  assert.match(config, /managedBy: "@org\/skills"/);
  assert.match(config, /vox-reputation\/vox-keyword-patrol/);
  assert.equal(
    lockfile.installed["skill:vox-reputation/vox-keyword-patrol"].agents["enlighten-ai"].project
      .instanceKey,
    "space:org-test:space-test:vox-keyword-patrol"
  );
});

test("unmanaged install target is protected without force", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-project-protected-"));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "enlighten-user-data-protected-"));
  const target = path.join(
    userData,
    "codex-home",
    "skills",
    "by-space",
    "organizations",
    "org-test",
    "spaces",
    "space-test",
    "vox-patrol-env-init"
  );
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "user-file.txt"), "keep me\n", "utf8");

  const stdout = createWriter();
  const stderr = createWriter();
  const exitCode = await run(
    [
      "add",
      "vox-reputation/vox-keyword-patrol",
      "--agent",
      "enlighten-ai",
      "--scope",
      "project",
      "--project-dir",
      projectDir,
      "--enlighten-user-data",
      userData,
      "--organization-id",
      "org-test",
      "--space-id",
      "space-test",
      "--yes"
    ],
    {
      cwd: repoRoot,
      stdin: { isTTY: false },
      stdout,
      stderr
    }
  );

  assert.equal(exitCode, 2);
  assert.match(stderr.output, /Refusing to overwrite unmanaged install target/);
  assert.equal(await fs.readFile(path.join(target, "user-file.txt"), "utf8"), "keep me\n");
});

test("codex project install writes the local skill and manager marker", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-project-install-"));
  const stdout = createWriter();
  const stderr = createWriter();

  const exitCode = await run(
    [
      "add",
      "vox-reputation/vox-keyword-patrol",
      "--agent",
      "codex",
      "--scope",
      "project",
      "--project-dir",
      projectDir,
      "--yes"
    ],
    {
      cwd: repoRoot,
      stdin: { isTTY: false },
      stdout,
      stderr
    }
  );

  assert.equal(exitCode, 0, stderr.output);
  const skillRoot = path.join(projectDir, ".codex", "skills", "vox-keyword-patrol");
  const marker = JSON.parse(
    await fs.readFile(path.join(skillRoot, ".skills-manager.json"), "utf8")
  );
  assert.equal(marker.agent, "codex");
  assert.equal(marker.scope, "project");
  assert.equal(await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8").then(Boolean), true);
});

function createWriter() {
  return {
    output: "",
    write(chunk) {
      this.output += chunk;
    }
  };
}
