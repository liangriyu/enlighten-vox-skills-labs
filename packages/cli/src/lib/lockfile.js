import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CliUsageError } from "./errors.js";
import { calculateSkillIntegrity } from "./installer.js";
import { resolveEnlightenSpaceBinding } from "./plan.js";

export async function writeInstallState(resolved, plan, options = {}) {
  const lockfilePath = resolveLockfilePath(plan, options);
  await fs.mkdir(path.dirname(lockfilePath), { recursive: true });

  const lockfile = await readLockfile(lockfilePath);
  lockfile.lockfileVersion = 1;
  lockfile.generatedBy = "@enlighten-vox/skills@0.1.1";
  lockfile.installed ??= {};

  for (let index = 0; index < resolved.skills.length; index += 1) {
    const skill = resolved.skills[index];
    const record = plan.skills[index];
    const lockKey = `skill:${skill.id}`;
    const requester = resolved.suite ? `suite:${resolved.suite.id}` : `skill:${skill.id}`;
    const entry = lockfile.installed[lockKey] ?? {
      type: "skill",
      version: skill.version,
      domain: skill.id.split("/")[0],
      source: buildSourceRecord(resolved.source, skill.manifestPath, options),
      integrity: await calculateSkillIntegrity(skill),
      agents: {}
    };

    entry.type = "skill";
    entry.version = skill.version;
    entry.domain = skill.id.split("/")[0];
    entry.source = buildSourceRecord(resolved.source, skill.manifestPath, options);
    entry.integrity = await calculateSkillIntegrity(skill);
    entry.agents ??= {};
    entry.agents[plan.agent] ??= {};
    entry.agents[plan.agent][plan.scope] = {
      ...lockRecord(record),
      requestedBy: mergeUnique(
        entry.agents[plan.agent][plan.scope]?.requestedBy,
        requester
      )
    };
    entry.requestedBy = collectScopedRequestedBy(entry);
    lockfile.installed[lockKey] = entry;
  }

  if (resolved.suite) {
    const suiteKey = `suite:${resolved.suite.id}`;
    const suiteEntry = lockfile.installed[suiteKey] ?? {};
    suiteEntry.type = "suite";
    suiteEntry.version = resolved.suite.version;
    suiteEntry.source = buildSourceRecord(
      resolved.source,
      resolved.suite.manifestPath,
      options
    );
    suiteEntry.skills = resolved.skills.map((skill) => skill.id);
    suiteEntry.requestedBy = resolved.skills.map((skill) => skill.id);
    suiteEntry.agents ??= {};
    suiteEntry.agents[plan.agent] ??= {};
    suiteEntry.agents[plan.agent][plan.scope] = compactObject({
      scope: plan.scope,
      projectDir: plan.project?.projectDir,
      projectId: plan.project?.projectId
    });
    lockfile.installed[suiteKey] = suiteEntry;
  }

  await writeLockfile(lockfilePath, lockfile);
  return lockfilePath;
}

export function emptyLockfile() {
  return {
    lockfileVersion: 1,
    generatedBy: "@enlighten-vox/skills@0.1.1",
    installed: {}
  };
}

export function normalizeLockfile(lockfile) {
  return {
    lockfileVersion: lockfile.lockfileVersion ?? 1,
    generatedBy: lockfile.generatedBy ?? "@enlighten-vox/skills@0.1.1",
    installed: lockfile.installed ?? {}
  };
}

export async function writeProjectConfig(projectScope, plan, options = {}) {
  if (!projectScope) {
    return null;
  }

  const configPath = path.join(projectScope.projectDir, ".skillsrc.yaml");
  const target = plan.request;
  const existing = await readTextIfExists(configPath);

  if (existing !== null) {
    if (!existing.includes('managedBy: "@enlighten-vox/skills"') && options.force !== true) {
      throw new CliUsageError(
        `Refusing to overwrite unmanaged project config: ${configPath}. Use --force to replace it.`
      );
    }

    if (!existing.includes('managedBy: "@enlighten-vox/skills"') && options.force === true) {
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
    !existing.includes('managedBy: "@enlighten-vox/skills"') &&
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
    'managedBy: "@enlighten-vox/skills"',
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
      `  scopeKind: ${firstSkill.scopeKind}`
    );

    if (firstSkill.organizationId !== undefined) {
      lines.push(`  organizationId: ${quote(firstSkill.organizationId)}`);
    }

    if (firstSkill.spaceId !== undefined) {
      lines.push(`  spaceId: ${quote(firstSkill.spaceId)}`);
    }

    lines.push("");
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

  const agent = plan.agent ?? options.agent ?? "codex";
  if (agent === "enlighten-ai" && plan.scope === "space") {
    const { organizationId, spaceId } = resolveEnlightenSpaceBinding(options);
    return path.join(
      stateDir,
      "enlighten-ai",
      "spaces",
      safeStatePathSegment(organizationId),
      safeStatePathSegment(spaceId),
      "skills.lock"
    );
  }

  return path.join(stateDir, "skills.lock");
}

export async function readLockfile(filePath) {
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

export async function writeLockfile(filePath, lockfile) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await atomicWrite(filePath, `${JSON.stringify(sortLockfile(lockfile), null, 2)}\n`);
}

function lockRecord(record) {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key]) => !["directoryName", "entry", "marker", "sourceRoot", "markerPath"].includes(key)
    )
  );
}

export async function readTextIfExists(filePath) {
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

function safeStatePathSegment(value) {
  return encodeURIComponent(String(value)).replace(/%/g, "_");
}

function mergeUnique(existing, value) {
  const values = Array.isArray(existing) ? existing : [];
  return [...new Set([...values, value])].sort();
}

function collectScopedRequestedBy(entry) {
  const values = new Set();
  for (const scopes of Object.values(entry.agents ?? {})) {
    for (const record of Object.values(scopes ?? {})) {
      for (const requester of record.requestedBy ?? []) {
        values.add(requester);
      }
    }
  }
  return [...values].sort();
}

function sortLockfile(lockfile) {
  const installed = lockfile.installed ?? {};
  return {
    ...lockfile,
    installed: Object.fromEntries(
      Object.keys(installed)
        .sort()
        .map((key) => [key, sortEntry(installed[key])])
    )
  };
}

function sortEntry(entry) {
  const sorted = { ...entry };
  if (Array.isArray(sorted.requestedBy)) {
    sorted.requestedBy = [...sorted.requestedBy].sort();
  }
  if (Array.isArray(sorted.skills)) {
    sorted.skills = [...sorted.skills].sort();
  }
  if (sorted.agents && typeof sorted.agents === "object") {
    sorted.agents = Object.fromEntries(
      Object.keys(sorted.agents)
        .sort()
        .map((agent) => [
          agent,
          Object.fromEntries(
            Object.keys(sorted.agents[agent])
              .sort()
              .map((scope) => [scope, sorted.agents[agent][scope]])
          )
        ])
    );
  }
  return sorted;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function buildSourceRecord(source, manifestPath, options = {}) {
  const effectiveSource = source ?? { type: "workspace" };
  if (effectiveSource.type === "workspace") {
    return {
      type: "workspace",
      path: path.relative(options.rootDir ?? process.cwd(), manifestPath)
    };
  }

  const localRoot = effectiveSource.localRoot ?? options.rootDir ?? process.cwd();
  const skillPath = toPosix(path.relative(localRoot, path.dirname(manifestPath))) || ".";
  return compactObject({
    type: effectiveSource.type,
    sourceType: effectiveSource.type,
    sourceUrl: effectiveSource.url,
    sourceRequest: effectiveSource.request,
    ref: effectiveSource.ref,
    commit: effectiveSource.commit,
    skillPath
  });
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}
