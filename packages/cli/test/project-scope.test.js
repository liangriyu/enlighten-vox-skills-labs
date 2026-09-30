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

test("top-level help option prints CLI usage", async () => {
  const stdout = createWriter();
  const stderr = createWriter();
  const exitCode = await run(["--help"], {
    cwd: repoRoot,
    stdin: { isTTY: false },
    stdout,
    stderr
  });

  assert.equal(exitCode, 0, stderr.output);
  assert.match(stdout.output, /@enlighten-vox\/skills MVP/);
  assert.match(stdout.output, /skills update/);
});

test("project scope defaults to cwd for read-only project commands", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-project-default-"));
  const projectScope = await resolveProjectScope(
    { scope: "project" },
    { cwd: projectDir, stdin: { isTTY: false } }
  );

  assert.equal(projectScope.projectDir, fsSync.realpathSync(projectDir));
  assert.match(projectScope.projectId, /^project-[a-f0-9]{12}$/);
});

test("non-interactive project mutations require explicit projectDir", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-project-default-"));

  await assert.rejects(
    () =>
      resolveProjectScope(
        { scope: "project", yes: true, requireExplicitProjectDir: true },
        { cwd: projectDir, stdin: { isTTY: false } }
      ),
    /Project mutations in non-interactive mode require --project-dir/
  );
});

test("managed targets outside a registry checkout require explicit registry", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "skills-not-registry-"));
  const stdout = createWriter();
  const stderr = createWriter();

  const exitCode = await run(
    ["add", "vox-reputation/vox-keyword-patrol", "--dry-run"],
    {
      cwd,
      stdin: { isTTY: false },
      stdout,
      stderr
    }
  );

  assert.equal(exitCode, 2);
  assert.match(stderr.output, /No Skill registry checkout found/);
});

test("managed targets can resolve from explicit registry outside cwd", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "skills-with-registry-"));
  const stdout = createWriter();
  const stderr = createWriter();

  const exitCode = await run(
    [
      "add",
      "vox-reputation/vox-keyword-patrol",
      "--registry",
      repoRoot,
      "--dry-run"
    ],
    {
      cwd,
      stdin: { isTTY: false },
      stdout,
      stderr
    }
  );

  assert.equal(exitCode, 0, stderr.output);
  const plan = JSON.parse(stdout.output);
  assert.equal(plan.request, "vox-reputation/vox-keyword-patrol");
  assert.equal(plan.skills.length, 2);
});

test("codex rejects space scope", async () => {
  const stdout = createWriter();
  const stderr = createWriter();
  const exitCode = await run(
    [
      "add",
      "vox-reputation/vox-keyword-patrol",
      "--agent",
      "codex",
      "--scope",
      "space",
      "--dry-run"
    ],
    {
      cwd: repoRoot,
      stdin: { isTTY: false },
      stdout,
      stderr
    }
  );

  assert.equal(exitCode, 2);
  assert.match(stderr.output, /Codex does not support --scope space/);
});

test("enlighten space dry-run binds org and space to scoped install path", async () => {
  const stdout = createWriter();
  const stderr = createWriter();

  const exitCode = await run(
    [
      "add",
      "vox-reputation/vox-keyword-patrol",
      "--agent",
      "enlighten-ai",
      "--scope",
      "space",
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
  assert.equal(plan.scope, "space");
  assert.equal(plan.project, null);
  assert.equal(plan.skills.length, 2);
  assert.match(plan.skills[0].installPath, /codex-home\/skills\/by-space\/organizations\/<org-id>\/spaces\/<space-id>/);
  assert.match(plan.skills[0].instanceKey, /^space:<org-id>:<space-id>:/);
});

test("enlighten space install writes skills, marker, and space lockfile", async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "enlighten-user-data-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-state-space-"));
  const stdout = createWriter();
  const stderr = createWriter();

  const exitCode = await run(
    [
      "add",
      "vox-reputation/vox-keyword-patrol",
      "--agent",
      "enlighten-ai",
      "--scope",
      "space",
      "--enlighten-user-data",
      userData,
      "--state-dir",
      stateDir,
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
  const lockfile = JSON.parse(
    await fs.readFile(
      path.join(stateDir, "enlighten-ai", "spaces", "org-test", "space-test", "skills.lock"),
      "utf8"
    )
  );

  assert.equal(marker.scope_kind, "space");
  assert.equal(marker.organization_id, "org-test");
  assert.equal(marker.space_id, "space-test");
  assert.equal(marker.project_dir, undefined);
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
  assert.equal(
    lockfile.installed["skill:vox-reputation/vox-keyword-patrol"].agents["enlighten-ai"].space
      .instanceKey,
    "space:org-test:space-test:vox-keyword-patrol"
  );
});

test("enlighten space install rejects placeholder organization and space", async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "enlighten-user-data-missing-space-"));
  const stdout = createWriter();
  const stderr = createWriter();

  const exitCode = await run(
    [
      "add",
      "vox-reputation/vox-keyword-patrol",
      "--agent",
      "enlighten-ai",
      "--scope",
      "space",
      "--enlighten-user-data",
      userData,
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
  assert.match(stderr.output, /Enlighten space scope requires --organization-id and --space-id/);
  assert.equal(
    fsSync.existsSync(path.join(userData, "codex-home", "skills", "by-space")),
    false
  );
});

test("unmanaged install target is protected without force", async () => {
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
      "space",
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

test("enlighten project install writes project-local codex skill and marker", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "enlighten-project-install-"));
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
  const realProjectDir = fsSync.realpathSync(projectDir);
  const skillRoot = path.join(realProjectDir, ".codex", "skills", "vox-keyword-patrol");
  const marker = JSON.parse(
    await fs.readFile(path.join(skillRoot, ".enlighten-install.json"), "utf8")
  );
  const lockfile = JSON.parse(await fs.readFile(path.join(realProjectDir, "skills.lock"), "utf8"));
  const config = await fs.readFile(path.join(realProjectDir, ".skillsrc.yaml"), "utf8");

  assert.equal(marker.agent, "enlighten-ai");
  assert.equal(marker.scope, "project");
  assert.equal(marker.scope_kind, "project");
  assert.equal(marker.project_dir, realProjectDir);
  assert.match(marker.instance_key, /^project:project-[a-f0-9]{12}:vox-keyword-patrol$/);
  assert.match(config, /managedBy: "@enlighten-vox\/skills"/);
  assert.match(config, /scopeKind: project/);
  assert.doesNotMatch(config, /organizationId/);
  assert.doesNotMatch(config, /spaceId/);
  assert.doesNotMatch(config, /undefined/);
  assert.equal(
    lockfile.installed["skill:vox-reputation/vox-keyword-patrol"].agents["enlighten-ai"].project
      .installPath,
    skillRoot
  );
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

test("list reads installed project skills from lockfile", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-project-list-"));
  const installStdout = createWriter();
  const installStderr = createWriter();
  const listStdout = createWriter();
  const listStderr = createWriter();

  assert.equal(
    await run(
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
        stdout: installStdout,
        stderr: installStderr
      }
    ),
    0,
    installStderr.output
  );

  assert.equal(
    await run(
      [
        "list",
        "--agent",
        "codex",
        "--scope",
        "project",
        "--project-dir",
        projectDir
      ],
      {
        cwd: repoRoot,
        stdin: { isTTY: false },
        stdout: listStdout,
        stderr: listStderr
      }
    ),
    0,
    listStderr.output
  );

  const result = JSON.parse(listStdout.output);
  assert.equal(result.schema, "list-result/v1");
  assert.deepEqual(
    result.installed.map((entry) => entry.key),
    [
      "skill:vox-reputation/vox-keyword-patrol",
      "skill:vox-reputation/vox-patrol-env-init",
      "suite:vox-reputation/vox-keyword-patrol"
    ]
  );
  assert.equal(
    result.installed.find((entry) => entry.key === "suite:vox-reputation/vox-keyword-patrol")
      .agents[0].agent,
    "codex"
  );
});

test("remove suite deletes manager-owned project skill dirs and updates lockfile", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-project-remove-"));
  const installStdout = createWriter();
  const installStderr = createWriter();
  const removeStdout = createWriter();
  const removeStderr = createWriter();

  assert.equal(
    await run(
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
        stdout: installStdout,
        stderr: installStderr
      }
    ),
    0,
    installStderr.output
  );

  assert.equal(
    await run(
      [
        "remove",
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
        stdout: removeStdout,
        stderr: removeStderr
      }
    ),
    0,
    removeStderr.output
  );

  const result = JSON.parse(removeStdout.output);
  assert.equal(result.schema, "remove-result/v1");
  assert.equal(result.removed.length, 2);
  assert.deepEqual(
    result.removed.map((entry) => entry.status),
    ["removed", "removed"]
  );
  assert.equal(
    fsSync.existsSync(path.join(projectDir, ".codex", "skills", "vox-keyword-patrol")),
    false
  );
  assert.equal(
    fsSync.existsSync(path.join(projectDir, ".codex", "skills", "vox-patrol-env-init")),
    false
  );
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(projectDir, "skills.lock"), "utf8")).installed,
    {}
  );
});

test("remove suite keeps directly requested shared skills", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-project-shared-remove-"));
  const installSkillStdout = createWriter();
  const installSkillStderr = createWriter();
  const installSuiteStdout = createWriter();
  const installSuiteStderr = createWriter();
  const removeStdout = createWriter();
  const removeStderr = createWriter();

  assert.equal(
    await run(
      [
        "add",
        "vox-reputation/vox-patrol-env-init",
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
        stdout: installSkillStdout,
        stderr: installSkillStderr
      }
    ),
    0,
    installSkillStderr.output
  );

  assert.equal(
    await run(
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
        stdout: installSuiteStdout,
        stderr: installSuiteStderr
      }
    ),
    0,
    installSuiteStderr.output
  );

  assert.equal(
    await run(
      [
        "remove",
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
        stdout: removeStdout,
        stderr: removeStderr
      }
    ),
    0,
    removeStderr.output
  );

  const result = JSON.parse(removeStdout.output);
  assert.deepEqual(result.removed.map((entry) => entry.marker.id), [
    "vox-reputation/vox-keyword-patrol"
  ]);
  assert.deepEqual(result.kept, [
    {
      id: "vox-reputation/vox-patrol-env-init",
      reason: "Still referenced by skill:vox-reputation/vox-patrol-env-init"
    }
  ]);
  assert.equal(
    fsSync.existsSync(path.join(projectDir, ".codex", "skills", "vox-keyword-patrol")),
    false
  );
  assert.equal(
    fsSync.existsSync(path.join(projectDir, ".codex", "skills", "vox-patrol-env-init")),
    true
  );

  const lockfile = JSON.parse(await fs.readFile(path.join(projectDir, "skills.lock"), "utf8"));
  assert.deepEqual(Object.keys(lockfile.installed), [
    "skill:vox-reputation/vox-patrol-env-init"
  ]);
  assert.deepEqual(
    lockfile.installed["skill:vox-reputation/vox-patrol-env-init"].requestedBy,
    ["skill:vox-reputation/vox-patrol-env-init"]
  );
});

test("remove suite only removes the selected agent and scope", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-project-cross-scope-"));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "enlighten-user-data-cross-scope-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-state-cross-scope-"));
  const codexStdout = createWriter();
  const codexStderr = createWriter();
  const enlightenStdout = createWriter();
  const enlightenStderr = createWriter();
  const removeStdout = createWriter();
  const removeStderr = createWriter();

  assert.equal(
    await run(
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
        stdout: codexStdout,
        stderr: codexStderr
      }
    ),
    0,
    codexStderr.output
  );

  assert.equal(
    await run(
      [
        "add",
        "vox-reputation/vox-keyword-patrol",
        "--agent",
        "enlighten-ai",
        "--scope",
        "space",
        "--enlighten-user-data",
        userData,
        "--state-dir",
        stateDir,
        "--organization-id",
        "org-test",
        "--space-id",
        "space-test",
        "--yes"
      ],
      {
        cwd: repoRoot,
        stdin: { isTTY: false },
        stdout: enlightenStdout,
        stderr: enlightenStderr
      }
    ),
    0,
    enlightenStderr.output
  );

  assert.equal(
    await run(
      [
        "remove",
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
        stdout: removeStdout,
        stderr: removeStderr
      }
    ),
    0,
    removeStderr.output
  );

  const result = JSON.parse(removeStdout.output);
  const lockfile = JSON.parse(await fs.readFile(path.join(projectDir, "skills.lock"), "utf8"));
  const spaceLockfile = JSON.parse(
    await fs.readFile(
      path.join(stateDir, "enlighten-ai", "spaces", "org-test", "space-test", "skills.lock"),
      "utf8"
    )
  );
  assert.equal(result.removed.length, 2);
  assert.equal(
    fsSync.existsSync(path.join(projectDir, ".codex", "skills", "vox-keyword-patrol")),
    false
  );
  assert.equal(
    fsSync.existsSync(
      path.join(
        userData,
        "codex-home",
        "skills",
        "by-space",
        "organizations",
        "org-test",
        "spaces",
        "space-test",
        "vox-keyword-patrol"
      )
    ),
    true
  );
  assert.equal(
    Object.keys(lockfile.installed).length,
    0
  );
  assert.equal(
    Boolean(spaceLockfile.installed["skill:vox-reputation/vox-keyword-patrol"].agents["enlighten-ai"].space),
    true
  );
});

test("update refreshes a workspace suite install from source", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-project-update-"));
  const installStdout = createWriter();
  const installStderr = createWriter();
  const updateStdout = createWriter();
  const updateStderr = createWriter();

  assert.equal(
    await run(
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
        stdout: installStdout,
        stderr: installStderr
      }
    ),
    0,
    installStderr.output
  );

  const installedSkillPath = path.join(
    projectDir,
    ".codex",
    "skills",
    "vox-keyword-patrol",
    "SKILL.md"
  );
  const lockfilePath = path.join(projectDir, "skills.lock");
  await fs.writeFile(installedSkillPath, "stale installed skill\n", "utf8");
  const staleLockfile = JSON.parse(await fs.readFile(lockfilePath, "utf8"));
  staleLockfile.installed["skill:vox-reputation/vox-keyword-patrol"].integrity =
    "sha256-stale";
  await fs.writeFile(lockfilePath, `${JSON.stringify(staleLockfile, null, 2)}\n`, "utf8");

  assert.equal(
    await run(
      [
        "update",
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
        stdout: updateStdout,
        stderr: updateStderr
      }
    ),
    0,
    updateStderr.output
  );

  const result = JSON.parse(updateStdout.output);
  assert.equal(result.schema, "update-result/v1");
  assert.deepEqual(result.updated.map((entry) => entry.request), [
    "vox-reputation/vox-keyword-patrol"
  ]);
  assert.equal(
    await fs.readFile(installedSkillPath, "utf8"),
    await fs.readFile(
      path.join(repoRoot, "domains/vox-reputation/skills/vox-keyword-patrol/SKILL.md"),
      "utf8"
    )
  );
  assert.notEqual(
    JSON.parse(await fs.readFile(lockfilePath, "utf8")).installed[
      "skill:vox-reputation/vox-keyword-patrol"
    ].integrity,
    "sha256-stale"
  );
});

test("update reuses enlighten space install path from lockfile", async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "enlighten-user-data-update-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-state-update-enlighten-"));
  const installStdout = createWriter();
  const installStderr = createWriter();
  const updateStdout = createWriter();
  const updateStderr = createWriter();

  assert.equal(
    await run(
      [
        "add",
        "vox-reputation/vox-keyword-patrol",
        "--agent",
        "enlighten-ai",
        "--scope",
        "space",
        "--enlighten-user-data",
        userData,
        "--state-dir",
        stateDir,
        "--organization-id",
        "org-test",
        "--space-id",
        "space-test",
        "--yes"
      ],
      {
        cwd: repoRoot,
        stdin: { isTTY: false },
        stdout: installStdout,
        stderr: installStderr
      }
    ),
    0,
    installStderr.output
  );

  const installedSkillPath = path.join(
    userData,
    "codex-home",
    "skills",
    "by-space",
    "organizations",
    "org-test",
    "spaces",
    "space-test",
    "vox-keyword-patrol",
    "SKILL.md"
  );
  await fs.writeFile(installedSkillPath, "stale enlighten skill\n", "utf8");

  assert.equal(
    await run(
      [
        "update",
        "vox-reputation/vox-keyword-patrol",
        "--agent",
        "enlighten-ai",
        "--scope",
        "space",
        "--state-dir",
        stateDir,
        "--organization-id",
        "org-test",
        "--space-id",
        "space-test",
        "--yes"
      ],
      {
        cwd: repoRoot,
        stdin: { isTTY: false },
        stdout: updateStdout,
        stderr: updateStderr
      }
    ),
    0,
    updateStderr.output
  );

  const result = JSON.parse(updateStdout.output);
  assert.equal(result.updated[0].installed[1].installPath.includes(userData), true);
  assert.equal(
    await fs.readFile(installedSkillPath, "utf8"),
    await fs.readFile(
      path.join(repoRoot, "domains/vox-reputation/skills/vox-keyword-patrol/SKILL.md"),
      "utf8"
    )
  );
});

test("update rejects suite-managed skill targets unless directly installed", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-project-update-owned-"));
  const installStdout = createWriter();
  const installStderr = createWriter();
  const updateStdout = createWriter();
  const updateStderr = createWriter();

  assert.equal(
    await run(
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
        stdout: installStdout,
        stderr: installStderr
      }
    ),
    0,
    installStderr.output
  );

  assert.equal(
    await run(
      [
        "update",
        "vox-reputation/vox-patrol-env-init",
        "--agent",
        "codex",
        "--scope",
        "project",
        "--project-dir",
        projectDir,
        "--dry-run"
      ],
      {
        cwd: repoRoot,
        stdin: { isTTY: false },
        stdout: updateStdout,
        stderr: updateStderr
      }
    ),
    2
  );
  assert.match(updateStderr.output, /Update the suite instead/);
});

test("doctor validates project lockfile and manager markers", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-project-doctor-"));
  const installStdout = createWriter();
  const installStderr = createWriter();
  const doctorStdout = createWriter();
  const doctorStderr = createWriter();

  assert.equal(
    await run(
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
        stdout: installStdout,
        stderr: installStderr
      }
    ),
    0,
    installStderr.output
  );

  assert.equal(
    await run(
      [
        "doctor",
        "--agent",
        "codex",
        "--scope",
        "project",
        "--project-dir",
        projectDir
      ],
      {
        cwd: repoRoot,
        stdin: { isTTY: false },
        stdout: doctorStdout,
        stderr: doctorStderr
      }
    ),
    0,
    doctorStderr.output
  );

  const result = JSON.parse(doctorStdout.output);
  assert.equal(result.schema, "doctor-result/v1");
  assert.equal(result.checks.every((check) => check.status !== "failed"), true);
  assert.equal(
    result.checks.filter((check) => check.id.startsWith("install:")).length,
    2
  );
});

function createWriter() {
  return {
    output: "",
    write(chunk) {
      this.output += chunk;
    }
  };
}
