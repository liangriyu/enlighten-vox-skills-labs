import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
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

test("clones a Git source, discovers a Markdown Skill, installs it, and records source metadata", async () => {
  const sourceRepo = await fs.mkdtemp(path.join(os.tmpdir(), "skills-source-repo-"));
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-source-project-"));
  const skillDir = path.join(sourceRepo, "skills", "demo");
  await fs.mkdir(skillDir, { recursive: true });
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

  await execFile("git", ["-C", sourceRepo, "init", "-q"]);
  await execFile("git", ["-C", sourceRepo, "config", "user.email", "skills-test@example.com"]);
  await execFile("git", ["-C", sourceRepo, "config", "user.name", "Skills Test"]);
  await execFile("git", ["-C", sourceRepo, "add", "."]);
  await execFile("git", ["-C", sourceRepo, "commit", "-qm", "add demo skill"]);
  const { stdout: commitOutput } = await execFile("git", [
    "-C",
    sourceRepo,
    "rev-parse",
    "HEAD"
  ]);

  const stdout = createWriter();
  const stderr = createWriter();
  const exitCode = await run(
    [
      "add",
      pathToFileURL(sourceRepo).href,
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
      stdout,
      stderr
    }
  );

  assert.equal(exitCode, 0, stderr.output);
  const result = JSON.parse(stdout.output);
  assert.equal(result.installed.length, 1);

  const installedRoot = path.join(projectDir, ".codex", "skills", "demo");
  assert.equal(await fs.readFile(path.join(installedRoot, "SKILL.md"), "utf8").then(Boolean), true);
  assert.equal(await fs.readFile(path.join(installedRoot, "notes.txt"), "utf8"), "source resource\n");

  const lockfile = JSON.parse(await fs.readFile(path.join(projectDir, "skills.lock"), "utf8"));
  const source = lockfile.installed["skill:external/demo"].source;
  assert.equal(source.type, "git");
  assert.equal(source.sourceType, "git");
  assert.equal(source.sourceUrl, pathToFileURL(sourceRepo).href);
  assert.equal(source.skillPath, "skills/demo");
  assert.equal(source.commit, commitOutput.trim());
  assert.equal(fsSync.existsSync(sourceRepo), true);
});

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
