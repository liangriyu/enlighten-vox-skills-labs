import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { CliUsageError } from "./errors.js";
import { checkInstallTarget, markerNameForAgent } from "./installer.js";
import {
  emptyLockfile,
  readLockfile,
  readTextIfExists,
  resolveLockfilePath,
  writeLockfile
} from "./lockfile.js";

export async function loadInstallState(options = {}, projectScope = null) {
  const scope = options.scope ?? "global";
  const agent = options.agent ?? "codex";
  const lockfilePath = resolveLockfilePath(
    {
      agent,
      scope,
      project: projectScope
    },
    options
  );

  const lockfileExists = await exists(lockfilePath);
  const lockfile = lockfileExists ? await readLockfile(lockfilePath) : emptyLockfile();
  lockfile.installed ??= {};

  return {
    schema: "install-state/v1",
    agent,
    scope,
    project: projectScope,
    lockfilePath,
    lockfileExists,
    lockfile
  };
}

export async function saveInstallState(state, lockfile) {
  await writeLockfile(state.lockfilePath, lockfile);
}

export function listInstalled(state) {
  return Object.entries(state.lockfile.installed ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => {
      const [type, id] = splitLockKey(key);
      return {
        key,
        id,
        type,
        version: entry.version,
        source: entry.source,
        skills: type === "suite" ? suiteSkillIds(entry) : undefined,
        requestedBy: type === "skill" ? entry.requestedBy ?? [] : undefined,
        agents: listAgentScopes(entry)
      };
    });
}

export function buildRemovePlan(state, target, options = {}) {
  if (!target) {
    throw new CliUsageError("Missing target. Usage: skills remove <domain>/<suite-or-skill>");
  }

  const agent = options.agent ?? "codex";
  const scope = options.scope ?? "global";
  const lockfile = cloneJson(state.lockfile);
  const installed = lockfile.installed ?? {};
  const key = resolveTargetKey(installed, target);
  const entry = installed[key];
  const [type, id] = splitLockKey(key);
  const removed = [];
  const kept = [];

  if (type === "suite") {
    const skillIds = suiteSkillIds(entry);
    const suiteRecordRemoved = removeAgentScope(entry, agent, scope);

    if (!hasAnyAgentScope(entry)) {
      delete installed[key];
    }

    for (const skillId of skillIds) {
      const skillKey = `skill:${skillId}`;
      const skillEntry = installed[skillKey];
      if (!skillEntry) {
        continue;
      }

      const storedRecord = mutableScopedRecord(skillEntry, agent, scope);
      const record = scopedRecord(skillEntry, skillId, agent, scope);

      if (!storedRecord) {
        kept.push({
          id: skillId,
          reason: `No ${agent}/${scope} install record`
        });
      } else {
        storedRecord.requestedBy = removeValue(scopedRequestedBy(skillEntry, agent, scope), key);

        if (storedRecord.requestedBy.length > 0) {
          kept.push({
            id: skillId,
            reason: `Still referenced by ${storedRecord.requestedBy.join(", ")}`
          });
        } else {
          removeAgentScope(skillEntry, agent, scope);
          removed.push(record);
        }
      }

      syncSkillRequestedByFromScopes(skillEntry);
      if (!hasAnyAgentScope(skillEntry) && (skillEntry.requestedBy ?? []).length === 0) {
        delete installed[skillKey];
      } else {
        installed[skillKey] = skillEntry;
      }
    }

    return {
      schema: "remove-plan/v1",
      target,
      type,
      id,
      agent,
      scope,
      lockfilePath: state.lockfilePath,
      removed,
      kept,
      updatedLockfile: lockfile,
      suiteRecordRemoved
    };
  }

  const scopedSuiteRefs = skillSuiteRefs(installed, id, agent, scope);
  const directRef = `skill:${id}`;
  const storedRecord = mutableScopedRecord(entry, agent, scope);
  const record = scopedRecord(entry, id, agent, scope);
  const requestedBy = scopedRequestedBy(entry, agent, scope);

  if (scopedSuiteRefs.length > 0 && !requestedBy.includes(directRef) && options.force !== true) {
    throw new CliUsageError(
      `Skill ${id} is still referenced by suite(s): ${scopedSuiteRefs.join(", ")}. Remove the suite first.`
    );
  }

  if (storedRecord) {
    storedRecord.requestedBy = removeValue(requestedBy, directRef);
  }

  if (storedRecord && storedRecord.requestedBy.length > 0 && options.force !== true) {
    kept.push({
      id,
      reason: `Still referenced by ${storedRecord.requestedBy.join(", ")}`
    });
  } else if (record) {
    removeAgentScope(entry, agent, scope);
    removed.push(record);
  } else {
    kept.push({
      id,
      reason: `No ${agent}/${scope} install record`
    });
  }

  syncSkillRequestedByFromScopes(entry);
  if (!hasAnyAgentScope(entry) && (entry.requestedBy ?? []).length === 0) {
    delete installed[key];
  } else {
    installed[key] = entry;
  }

  return {
    schema: "remove-plan/v1",
    target,
    type,
    id,
    agent,
    scope,
    lockfilePath: state.lockfilePath,
    removed,
    kept,
    updatedLockfile: lockfile
  };
}

export function buildUpdatePlan(state, target, options = {}) {
  const agent = options.agent ?? "codex";
  const scope = options.scope ?? "global";
  const installed = state.lockfile.installed ?? {};
  const targets = target
    ? [buildSingleUpdateTarget(installed, target, agent, scope)]
    : buildAllUpdateTargets(installed, agent, scope);

  if (targets.length === 0) {
    throw new CliUsageError(`No installed ${agent}/${scope} workspace targets to update.`);
  }

  return {
    schema: "update-plan/v1",
    agent,
    scope,
    lockfilePath: state.lockfilePath,
    targets
  };
}

export async function runStaticDoctor(state, options = {}) {
  const checks = [];
  checks.push({
    id: "node",
    status: "passed",
    message: process.version
  });

  checks.push({
    id: "lockfile",
    status: state.lockfileExists ? "passed" : "skipped",
    path: state.lockfilePath,
    message: state.lockfileExists ? "Lockfile parsed." : "Lockfile does not exist yet."
  });

  if (state.scope === "project") {
    checks.push(await checkProjectDirectory(state.project));
    checks.push(await checkProjectConfig(state.project));
  }

  for (const item of listInstalled(state).filter((entry) => entry.type === "skill")) {
    for (const agentRecord of item.agents) {
      const record = {
        id: item.id,
        agent: agentRecord.agent,
        scope: agentRecord.scope,
        marker: markerNameForAgent(agentRecord.agent),
        ...agentRecord.record
      };
      const targetCheck = await checkInstallTarget(record);
      checks.push({
        id: `install:${agentRecord.agent}:${agentRecord.scope}:${item.id}`,
        status: targetCheck.status === "passed" ? "passed" : "failed",
        path: record.installPath,
        markerPath: targetCheck.markerPath,
        message: targetCheck.message ?? "Install target marker matches lockfile."
      });

      if (agentRecord.agent === "enlighten-ai" && agentRecord.scope === "space") {
        checks.push(checkEnlightenSpaceBinding(record));
      }
    }
  }

  return {
    schema: "doctor-result/v1",
    agent: options.agent ?? state.agent,
    scope: state.scope,
    project: state.project,
    lockfilePath: state.lockfilePath,
    checks
  };
}

function listAgentScopes(entry) {
  const agents = [];
  for (const [agent, scopes] of Object.entries(entry.agents ?? {})) {
    for (const [scope, record] of Object.entries(scopes ?? {})) {
      agents.push({
        agent,
        scope,
        record
      });
    }
  }
  return agents.sort((left, right) =>
    `${left.agent}:${left.scope}`.localeCompare(`${right.agent}:${right.scope}`)
  );
}

function suiteSkillIds(entry) {
  if (Array.isArray(entry.skills)) {
    return [...entry.skills].sort();
  }
  if (Array.isArray(entry.requestedBy)) {
    return [...entry.requestedBy].sort();
  }
  return [];
}

function resolveTargetKey(installed, target) {
  if (target.startsWith("suite:") || target.startsWith("skill:")) {
    if (!installed[target]) {
      throw new CliUsageError(`Target is not installed: ${target}`);
    }
    return target;
  }

  const suiteKey = `suite:${target}`;
  if (installed[suiteKey]) {
    return suiteKey;
  }

  const skillKey = `skill:${target}`;
  if (installed[skillKey]) {
    return skillKey;
  }

  throw new CliUsageError(`Target is not installed: ${target}`);
}

function buildSingleUpdateTarget(installed, target, agent, scope) {
  const key = resolveTargetKey(installed, target);
  const entry = installed[key];
  const [type, id] = splitLockKey(key);
  if (!hasAgentScope(entry, agent, scope)) {
    throw new CliUsageError(`Target is not installed for ${agent}/${scope}: ${target}`);
  }

  if (type === "skill") {
    const directRef = `skill:${id}`;
    if (!scopedRequestedBy(entry, agent, scope).includes(directRef)) {
      throw new CliUsageError(
        `Skill ${id} is managed by a suite. Update the suite instead.`
      );
    }
  }

  assertWorkspaceSource(entry, key);
  return {
    key,
    request: id,
    type,
    source: entry.source,
    records: updateRecordsForTarget(installed, type, id, agent, scope)
  };
}

function buildAllUpdateTargets(installed, agent, scope) {
  const targets = [];
  for (const [key, entry] of Object.entries(installed).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (!hasAgentScope(entry, agent, scope)) {
      continue;
    }

    const [type, id] = splitLockKey(key);
    if (type === "suite") {
      assertWorkspaceSource(entry, key);
      targets.push({
        key,
        request: id,
        type,
        source: entry.source,
        records: updateRecordsForTarget(installed, type, id, agent, scope)
      });
      continue;
    }

    const directRef = `skill:${id}`;
    const requestedBy = scopedRequestedBy(entry, agent, scope);
    const isDirectInstall = requestedBy.includes(directRef);
    const hasNoKnownRequester = requestedBy.length === 0 && skillSuiteRefs(installed, id).length === 0;
    if (isDirectInstall || hasNoKnownRequester) {
      assertWorkspaceSource(entry, key);
      targets.push({
        key,
        request: id,
        type,
        source: entry.source,
        records: updateRecordsForTarget(installed, type, id, agent, scope)
      });
    }
  }
  return targets;
}

function updateRecordsForTarget(installed, type, id, agent, scope) {
  if (type === "skill") {
    const entry = installed[`skill:${id}`];
    const record = scopedRecord(entry, id, agent, scope);
    return record ? [record] : [];
  }

  const suiteEntry = installed[`suite:${id}`];
  return suiteSkillIds(suiteEntry)
    .map((skillId) => {
      const skillEntry = installed[`skill:${skillId}`];
      return scopedRecord(skillEntry, skillId, agent, scope);
    })
    .filter(Boolean);
}

function assertWorkspaceSource(entry, key) {
  if (entry.source?.type !== "workspace") {
    throw new CliUsageError(
      `Target ${key} cannot be updated by workspace updater. Reinstall from its source.`
    );
  }
}

function scopedRecord(entry, id, agent, scope) {
  const record = mutableScopedRecord(entry, agent, scope);
  if (!record) {
    return null;
  }
  return {
    ...record,
    id,
    agent,
    scope,
    marker: markerNameForAgent(agent)
  };
}

function mutableScopedRecord(entry, agent, scope) {
  return entry.agents?.[agent]?.[scope] ?? null;
}

function removeAgentScope(entry, agent, scope) {
  if (!entry.agents?.[agent]?.[scope]) {
    return false;
  }
  delete entry.agents[agent][scope];
  if (Object.keys(entry.agents[agent]).length === 0) {
    delete entry.agents[agent];
  }
  if (Object.keys(entry.agents).length === 0) {
    delete entry.agents;
  }
  return true;
}

function hasAnyAgentScope(entry) {
  return Object.values(entry.agents ?? {}).some((scopes) => Object.keys(scopes ?? {}).length > 0);
}

function hasAgentScope(entry, agent, scope) {
  return Boolean(entry.agents?.[agent]?.[scope]);
}

function skillSuiteRefs(installed, skillId, agent = null, scope = null) {
  const refs = [];
  for (const [key, entry] of Object.entries(installed)) {
    if (!key.startsWith("suite:")) {
      continue;
    }
    const installedForScope = agent && scope ? hasAgentScope(entry, agent, scope) : hasAnyAgentScope(entry);
    if (suiteSkillIds(entry).includes(skillId) && installedForScope) {
      refs.push(key);
    }
  }
  return refs.sort();
}

function scopedRequestedBy(entry, agent, scope) {
  const record = mutableScopedRecord(entry, agent, scope);
  if (!record) {
    return [];
  }
  if (Array.isArray(record.requestedBy)) {
    return [...record.requestedBy].sort();
  }
  return (Array.isArray(entry.requestedBy) ? entry.requestedBy : []).sort();
}

function syncSkillRequestedByFromScopes(entry) {
  const values = new Set();
  for (const scopes of Object.values(entry.agents ?? {})) {
    for (const record of Object.values(scopes ?? {})) {
      for (const requester of record.requestedBy ?? []) {
        values.add(requester);
      }
    }
  }

  if (values.size > 0) {
    entry.requestedBy = [...values].sort();
  } else {
    delete entry.requestedBy;
  }
}

async function checkProjectDirectory(project) {
  if (!project?.projectDir) {
    return {
      id: "project-dir",
      status: "failed",
      message: "Project scope requires projectDir."
    };
  }

  try {
    const stat = await fs.stat(project.projectDir);
    if (!stat.isDirectory()) {
      return {
        id: "project-dir",
        status: "failed",
        path: project.projectDir,
        message: "Project path is not a directory."
      };
    }
    await fs.access(project.projectDir, fsConstants.R_OK | fsConstants.W_OK);
    return {
      id: "project-dir",
      status: "passed",
      path: project.projectDir,
      message: "Project directory exists and is writable."
    };
  } catch (error) {
    return {
      id: "project-dir",
      status: "failed",
      path: project.projectDir,
      message: error.message
    };
  }
}

async function checkProjectConfig(project) {
  const configPath = path.join(project.projectDir, ".skillsrc.yaml");
  const content = await readTextIfExists(configPath);
  if (content === null) {
    return {
      id: "project-config",
      status: "skipped",
      path: configPath,
      message: "Project config does not exist yet."
    };
  }
  if (!content.includes('managedBy: "@enlighten-vox/skills"')) {
    return {
      id: "project-config",
      status: "failed",
      path: configPath,
      message: "Project config is not manager-owned."
    };
  }
  return {
    id: "project-config",
    status: "passed",
    path: configPath,
    message: "Project config is manager-owned."
  };
}

function checkEnlightenSpaceBinding(record) {
  const placeholderValues = new Set(["<org-id>", "<space-id>"]);
  const invalid = [record.organizationId, record.spaceId].filter((value) =>
    placeholderValues.has(value)
  );
  return {
    id: `enlighten-binding:${record.id}`,
    status: invalid.length === 0 ? "passed" : "failed",
    path: record.installPath,
    message:
      invalid.length === 0
        ? "Enlighten space binding has concrete organizationId and spaceId."
        : "Enlighten space install uses placeholder organizationId/spaceId."
  };
}

function splitLockKey(key) {
  const separator = key.indexOf(":");
  return [key.slice(0, separator), key.slice(separator + 1)];
}

function removeValue(values, value) {
  return (Array.isArray(values) ? values : []).filter((item) => item !== value).sort();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
