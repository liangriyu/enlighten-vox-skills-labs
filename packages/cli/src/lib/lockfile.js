import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CliUsageError } from "./errors.js";
import { calculateSkillIntegrity } from "./installer.js";

export async function writeInstallState(resolved, plan, options = {}) {
  const lockfilePath = resolveLockfilePath(plan, options);
  await fs.mkdir(path.dirname(lockfilePath), { recursive: true });

  const lockfile = await readLockfile(lockfilePath);
  lockfile.lockfileVersion = 1;
  lockfile.generatedBy = "@org/skills@0.1.0";
  lockfile.installed ??= {};

  for (let index = 0; index < resolved.skills.length; index += 1) {
    const skill = resolved.skills[index];
    const record = plan.skills[index];
    const lockKey = `skill:${skill.id}`;
    const entry = lockfile.installed[lockKey] ?? {
      type: "skill",
      version: skill.version,
      domain: skill.id.split("/")[0],
      source: {
        type: "workspace",
        path: path.relative(options.rootDir ?? process.cwd(), skill.manifestPath)
      },
      integrity: await calculateSkillIntegrity(skill),
      agents: {}
    };

    entry.type = "skill";
    entry.version = skill.version;
    entry.agents ??= {};
    entry.agents[plan.agent] ??= {};
    entry.agents[plan.agent][plan.scope] = lockRecord(record);
    lockfile.installed[lockKey] = entry;
  }

  if (resolved.suite) {
    lockfile.installed[`suite:${resolved.suite.id}`] = {
      type: "suite",
      version: resolved.suite.version,
      source: {
        type: "workspace",
        path: path.relative(options.rootDir ?? process.cwd(), resolved.suite.manifestPath)
      },
      requestedBy: resolved.skills.map((skill) => skill.id)
    };
  }

  await atomicWrite(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`);
  return lockfilePath;
}

export async function writeProjectConfig(projectScope, plan, options = {}) {
  if (!projectScope) {
    return null;
  }

  const configPath = path.join(projectScope.projectDir, ".skillsrc.yaml");
  const target = plan.request;
  const existing = await readTextIfExists(configPath);

  if (existing !== null) {
    if (!existing.includes('managedBy: "@org/skills"') && options.force !== true) {
      throw new CliUsageError(
        `Refusing to overwrite unmanaged project config: ${configPath}. Use --force to replace it.`
      );
    }

    if (!existing.includes('managedBy: "@org/skills"') && options.force === true) {
      await fs.writeFile(
        configPath,
        renderProjectConfig(projectScope, plan, options, target),
        "utf8"
      );
      return configPath;
    }

    if (!existing.includes(`  - "${target}"`)) {
      const separator = existing.endsWith("\n") ? "" : "\n";
      const addition = existing.includes("suites:")
        ? `  - "${target}"\n`
        : `suites:\n  - "${target}"\n`;
      await fs.writeFile(configPath, `${existing}${separator}${addition}`, "utf8");
    }
    return configPath;
  }

  await fs.writeFile(
    configPath,
    renderProjectConfig(projectScope, plan, options, target),
    "utf8"
  );
  return configPath;
}

export async function assertProjectConfigReady(projectScope, options = {}) {
  if (!projectScope) {
    return;
  }

  const configPath = path.join(projectScope.projectDir, ".skillsrc.yaml");
  const existing = await readTextIfExists(configPath);
  if (
    existing !== null &&
    !existing.includes('managedBy: "@org/skills"') &&
    options.force !== true
  ) {
    throw new CliUsageError(
      `Refusing to overwrite unmanaged project config: ${configPath}. Use --force to replace it.`
    );
  }
}

function renderProjectConfig(projectScope, plan, options, target) {
  const lines = [
    "schema: project-config/v1",
    'managedBy: "@org/skills"',
    `agent: ${plan.agent}`,
    "scope: project",
    `projectDir: ${quote(projectScope.projectDir)}`,
    ""
  ];

  if (plan.agent === "enlighten-ai") {
    const firstSkill = plan.skills[0];
    lines.push(
      "enlighten:",
      `  flavor: ${options.enlightenFlavor ?? "local"}`,
      `  scopeKind: ${firstSkill.scopeKind}`,
      `  organizationId: ${quote(firstSkill.organizationId)}`,
      `  spaceId: ${quote(firstSkill.spaceId)}`,
      ""
    );
  }

  lines.push("suites:", `  - "${target}"`, "");
  return lines.join("\n");
}

export function resolveLockfilePath(plan, options = {}) {
  if (plan.scope === "project") {
    if (!plan.project?.projectDir) {
      throw new CliUsageError("Project lockfile requires projectDir.");
    }
    return path.join(plan.project.projectDir, "skills.lock");
  }

  const stateDir = options.stateDir
    ? path.resolve(options.stateDir)
    : path.join(os.homedir(), ".skills-manager");
  return path.join(stateDir, "skills.lock");
}

async function readLockfile(filePath) {
  const content = await readTextIfExists(filePath);
  if (content === null || !content.trim()) {
    return { lockfileVersion: 1, installed: {} };
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new CliUsageError(`Unsupported or invalid lockfile format: ${filePath}`);
  }
}

function lockRecord(record) {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key]) => !["directoryName", "entry", "marker", "sourceRoot", "markerPath"].includes(key)
    )
  );
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function atomicWrite(filePath, content) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, content, "utf8");
  await fs.rename(temporaryPath, filePath);
}

function quote(value) {
  return JSON.stringify(String(value));
}
