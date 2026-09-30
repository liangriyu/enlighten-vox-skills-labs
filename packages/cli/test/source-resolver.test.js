import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { run } from "../src/index.js";
import { normalizeSourceSubpath, parseSource } from "../src/lib/source-parser.js";

const execFile = promisify(execFileCallback);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

test("parses GitHub, Gitee, GitLab, HTTPS tree, and SSH sources uniformly", () => {
  assert.deepEqual(parseSource("github:owner/repo"), {
    type: "github",
    input: "github:owner/repo",
    url: "https://github.com/owner/repo.git",
    ref: undefined,
    subpath: undefined
  });
  assert.deepEqual(parseSource("gitee:owner/repo"), {
    type: "gitee",
    input: "gitee:owner/repo",
    url: "https://gitee.com/owner/repo.git",
    ref: undefined,
    subpath: undefined
  });
  assert.deepEqual(parseSource("gitlab:group/subgroup/repo"), {
    type: "gitlab",
    input: "gitlab:group/subgroup/repo",
    url: "https://gitlab.com/group/subgroup/repo.git",
    ref: undefined,
    subpath: undefined
  });
  assert.deepEqual(parseSource("https://gitlab.com/group/subgroup/repo/-/tree/main/skills"), {
    type: "gitlab",
    input: "https://gitlab.com/group/subgroup/repo/-/tree/main/skills",
    url: "https://gitlab.com/group/subgroup/repo.git",
    ref: "main",
    subpath: "skills"
  });
  assert.deepEqual(parseSource("https://github.com/owner/repo/tree/release/skills"), {
    type: "github",
    input: "https://github.com/owner/repo/tree/release/skills",
    url: "https://github.com/owner/repo.git",
    ref: "release",
    subpath: "skills"
  });
  assert.equal(parseSource("git@github.com:owner/repo.git").type, "github");
  assert.equal(parseSource("ssh://git@gitee.com/owner/repo.git").type, "gitee");
});

test("rejects source subpath traversal", () => {
  assert.throws(
    () => normalizeSourceSubpath("../secrets"),
    /Git source subpath must stay inside the repository/
  );
});

test("lists discovered Markdown Skills from a Git source without installing", async () => {
  const { sourceRepo, sourceUrl, commit } = await createSourceRepo();

  const stdout = createWriter();
  const stderr = createWriter();
  const exitCode = await run(["add", sourceUrl, "--list"], {
    cwd: repoRoot,
    stdin: { isTTY: false },
    stdout,
    stderr
  });

  assert.equal(exitCode, 0, stderr.output);
  const result = JSON.parse(stdout.output);
  assert.equal(result.schema, "source-discovery/v1");
  assert.equal(result.source.sourceType, "git");
  assert.equal(result.source.sourceUrl, sourceUrl);
  assert.equal(result.source.commit, commit);
  assert.deepEqual(
    result.skills.map((skill) => skill.id),
    ["external/demo"]
  );
  assert.equal(result.skills[0].manifestPath, "skills/demo/SKILL.md");
  assert.equal(result.skills[0].description, "A Git sourced demo Skill.");
  assert.deepEqual(result.suites, []);
  await assert.rejects(
    fs.access(path.join(sourceRepo, ".codex", "skills", "demo")),
    /ENOENT/
  );
});

test("dry-runs direct external source installs and rejects real installs", async () => {
  const { sourceRepo, sourceUrl, commit } = await createSourceRepo();
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-source-project-"));

  const dryRunStdout = createWriter();
  const dryRunStderr = createWriter();
  const dryRunExitCode = await run(
    [
      "add",
      sourceUrl,
      "--skill",
      "demo",
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
      stdout: dryRunStdout,
      stderr: dryRunStderr
    }
  );

  assert.equal(dryRunExitCode, 0, dryRunStderr.output);
  const plan = JSON.parse(dryRunStdout.output);
  assert.equal(plan.schema, "install-plan/v1");
  assert.equal(plan.source.sourceUsage, "direct");
  assert.equal(plan.source.sourceUrl, sourceUrl);
  assert.equal(plan.source.commit, commit);
  assert.equal(plan.skills[0].id, "external/demo");

  const installStdout = createWriter();
  const installStderr = createWriter();
  const installExitCode = await run(
    [
      "add",
      sourceUrl,
      "--skill",
      "demo",
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
  );

  assert.equal(installExitCode, 2);
  assert.match(installStderr.output, /External source installs currently support --list and --dry-run only/);
  const installedRoot = path.join(projectDir, ".codex", "skills", "demo");
  await assert.rejects(fs.access(installedRoot), /ENOENT/);
});

async function createSourceRepo() {
  const sourceRepo = await fs.mkdtemp(path.join(os.tmpdir(), "skills-source-repo-"));
  const skillDir = path.join(sourceRepo, "skills", "demo");
  const invalidSkillDir = path.join(sourceRepo, "skills", "invalid");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.mkdir(invalidSkillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      "name: demo",
      "description: A Git sourced demo Skill.",
      "---",
      "",
      "# Demo",
      "",
      "Use the demo Skill.",
      ""
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(path.join(skillDir, "notes.txt"), "source resource\n", "utf8");
  await fs.writeFile(
    path.join(invalidSkillDir, "SKILL.md"),
    ["---", "name: invalid", "---", "", "# Invalid", ""].join("\n"),
    "utf8"
  );

  await execFile("git", ["-C", sourceRepo, "init", "-q"]);
  await execFile("git", ["-C", sourceRepo, "config", "user.email", "skills-test@example.com"]);
  await execFile("git", ["-C", sourceRepo, "config", "user.name", "Skills Test"]);
  await execFile("git", ["-C", sourceRepo, "add", "."]);
  await execFile("git", ["-C", sourceRepo, "commit", "-qm", "add demo skill"]);
  const { stdout } = await execFile("git", ["-C", sourceRepo, "rev-parse", "HEAD"]);

  return {
    sourceRepo,
    sourceUrl: pathToFileURL(sourceRepo).href,
    commit: stdout.trim()
  };
}

function createWriter() {
  const chunks = [];
  return {
    isTTY: false,
    get output() {
      return chunks.join("");
    },
    write(value) {
      chunks.push(String(value));
    }
  };
}
