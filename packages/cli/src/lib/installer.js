import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CliUsageError } from "./errors.js";

export async function installResolvedSkills(resolved, plan, options = {}) {
  const installed = [];

  for (let index = 0; index < resolved.skills.length; index += 1) {
    const skill = resolved.skills[index];
    const record = plan.skills[index];
    installed.push(await installSkill(skill, record, plan, options));
  }

  return installed;
}

export async function preflightInstallTargets(plan, options = {}) {
  for (const record of plan.skills) {
    await assertInstallTargetAvailable(record, options);
  }
}

export async function removeInstalledSkill(record, options = {}) {
  const check = await checkInstallTarget(record);
  if (check.status === "missing") {
    return check;
  }

  if (check.status !== "passed" && options.force !== true) {
    throw new CliUsageError(check.message);
  }

  await fs.rm(record.installPath, { recursive: true, force: true });
  return {
    ...check,
    status: check.status === "passed" ? "removed" : "force-removed"
  };
}

export async function checkInstallTarget(record) {
  const marker = record.marker ?? markerNameForAgent(record.agent);
  const markerPath = path.join(record.installPath, marker);

  try {
    const stat = await fs.stat(record.installPath);
    if (!stat.isDirectory()) {
      return {
        status: "failed",
        markerPath,
        message: `Install target is not a directory: ${record.installPath}`
      };
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        status: "missing",
        markerPath,
        message: `Install target is missing: ${record.installPath}`
      };
    }
    throw error;
  }

  let markerValue;
  try {
    markerValue = JSON.parse(await fs.readFile(markerPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        status: "failed",
        markerPath,
        message: `Install target is not managed by @enlighten-vox/skills: ${record.installPath}`
      };
    }
    return {
      status: "failed",
      markerPath,
      message: `Install target marker is invalid: ${markerPath}`
    };
  }

  if (markerValue.managedBy !== "@enlighten-vox/skills") {
    return {
      status: "failed",
      markerPath,
      message: `Install target marker is not owned by @enlighten-vox/skills: ${markerPath}`
    };
  }

  if (markerValue.id !== record.id) {
    return {
      status: "failed",
      markerPath,
      message: `Install target belongs to another skill (${markerValue.id}): ${record.installPath}`
    };
  }

  if (record.agent && markerValue.agent && markerValue.agent !== record.agent) {
    return {
      status: "failed",
      markerPath,
      message: `Install target agent mismatch (${markerValue.agent}): ${record.installPath}`
    };
  }

  if (record.scope && markerValue.scope && markerValue.scope !== record.scope) {
    return {
      status: "failed",
      markerPath,
      message: `Install target scope mismatch (${markerValue.scope}): ${record.installPath}`
    };
  }

  if (
    record.instanceKey &&
    markerValue.instance_key &&
    markerValue.instance_key !== record.instanceKey
  ) {
    return {
      status: "failed",
      markerPath,
      message: `Install target instance key mismatch (${markerValue.instance_key}): ${record.installPath}`
    };
  }

  return {
    status: "passed",
    markerPath,
    marker: markerValue
  };
}

export async function installSkill(skill, record, plan, options = {}) {
  const sourceRoot = path.dirname(skill.manifestPath);
  await prepareInstallDirectory(record.installPath, record.marker, record.id, options);

  for (const resourcePattern of skill.resources ?? [skill.entry]) {
    await copyResource(sourceRoot, record.installPath, resourcePattern);
  }

  const markerPath = path.join(record.installPath, record.marker);
  await writeJson(markerPath, buildInstallMarker(record, plan, options));

  return {
    ...record,
    sourceRoot,
    markerPath
  };
}

export async function prepareInstallDirectory(installPath, markerName, skillId, options = {}) {
  await assertInstallTargetAvailable(
    {
      installPath,
      marker: markerName,
      id: skillId
    },
    options
  );

  if (await exists(installPath)) {
    await fs.rm(installPath, { recursive: true, force: true });
  }
  await fs.mkdir(installPath, { recursive: true });
}

async function assertInstallTargetAvailable(record, options = {}) {
  const force = options.force === true;
  const installPath = record.installPath;
  const markerPath = path.join(installPath, record.marker);

  try {
    const stat = await fs.stat(installPath);
    if (!stat.isDirectory()) {
      throw new CliUsageError(`Install target is not a directory: ${installPath}`);
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    if (error instanceof CliUsageError) {
      throw error;
    }
    throw error;
  }

  if (!(await exists(installPath))) {
    return;
  }

  let marker;
  try {
    marker = JSON.parse(await fs.readFile(markerPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT" && !force) {
      throw new CliUsageError(`Install target marker is invalid: ${markerPath}`);
    }
  }

  if (!marker && !force) {
    throw new CliUsageError(
      `Refusing to overwrite unmanaged install target: ${installPath}. Use --force to replace it.`
    );
  }

  if (marker && marker.id !== record.id && !force) {
    throw new CliUsageError(
      `Install target belongs to another skill (${marker.id}): ${installPath}`
    );
  }
}

async function copyResource(sourceRoot, installRoot, pattern) {
  const normalizedPattern = normalizeResourcePattern(pattern);
  const sourcePath = path.join(sourceRoot, normalizedPattern.source);
  const targetPath = path.join(installRoot, normalizedPattern.target);

  if (!(await exists(sourcePath))) {
    throw new CliUsageError(`Declared Skill resource does not exist: ${normalizedPattern.source}`);
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.cp(sourcePath, targetPath, { recursive: normalizedPattern.directory, force: true });
}

function normalizeResourcePattern(pattern) {
  if (typeof pattern !== "string" || !pattern.trim()) {
    throw new CliUsageError("Skill resource must be a non-empty relative path.");
  }

  const trimmed = pattern.trim();
  if (path.isAbsolute(trimmed) || trimmed.split("/").includes("..")) {
    throw new CliUsageError(`Skill resource must stay inside its package: ${pattern}`);
  }

  if (trimmed.endsWith("/**")) {
    const directory = trimmed.slice(0, -3).replace(/\/$/, "");
    return {
      source: directory,
      target: directory,
      directory: true
    };
  }

  return {
    source: trimmed,
    target: trimmed,
    directory: false
  };
}

function buildInstallMarker(record, plan, options) {
  const managerSource = options.source ?? "workspace";
  const common = {
    managedBy: "@enlighten-vox/skills",
    schema: "installed-skill/v1",
    agent: plan.agent,
    id: record.id,
    version: record.version,
    scope: record.scope,
    scope_kind: record.scopeKind,
    project_dir: record.projectDir,
    project_id: record.projectId,
    organization_id: record.organizationId,
    space_id: record.spaceId,
    instance_key: record.instanceKey,
    source: managerSource
  };

  if (plan.agent !== "enlighten-ai") {
    return compactObject(common);
  }

  return compactObject({
    ...common,
    installed_by: "enlighten",
    source: record.scopeKind === "space" ? "cloud-owned" : "local-created",
    source_id: record.id,
    installed_at: new Date().toISOString(),
    enabled: true,
    manager_source: managerSource
  });
}

export function markerNameForAgent(agent) {
  return agent === "enlighten-ai" ? ".enlighten-install.json" : ".skills-manager.json";
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

export async function calculateSkillIntegrity(skill) {
  const root = path.dirname(skill.manifestPath);
  const files = await listFiles(root);
  const hash = crypto.createHash("sha256");

  for (const file of files) {
    const relativePath = path.relative(root, file);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await fs.readFile(file));
    hash.update("\0");
  }

  return `sha256-${hash.digest("hex")}`;
}

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}
