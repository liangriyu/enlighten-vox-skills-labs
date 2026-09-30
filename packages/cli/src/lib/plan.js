import os from "node:os";
import path from "node:path";
import { CliUsageError } from "./errors.js";
import { skillDirectoryName } from "./resolver.js";

export function buildInstallPlan(resolved, options = {}, projectScope = null) {
  const agent = options.agent ?? "codex";
  const scope = options.scope ?? "global";

  if (!["codex", "enlighten-ai"].includes(agent)) {
    throw new CliUsageError(`Unsupported agent for V1: ${agent}`);
  }

  if (!["global", "project"].includes(scope)) {
    throw new CliUsageError(`Unsupported scope: ${scope}`);
  }

  if (scope === "project" && !projectScope) {
    throw new CliUsageError("Project scope requires a resolved projectDir.");
  }

  const installRecords = resolved.skills.map((skill) => {
    assertAgentCompatible(skill, agent);
    return buildSkillInstallRecord(skill, agent, scope, options, projectScope);
  });

  return {
    schema: "install-plan/v1",
    request: resolved.request,
    targetType: resolved.targetType,
    source: describeSource(resolved.source),
    suite: resolved.suite
      ? {
          id: resolved.suite.id,
          version: resolved.suite.version
        }
      : null,
    agent,
    scope,
    project: projectScope,
    skills: installRecords
  };
}

function describeSource(source) {
  if (!source) {
    return {
      type: "workspace"
    };
  }

  return compactObject({
    type: source.type,
    sourceType: source.type,
    sourceUrl: source.url,
    ref: source.ref,
    subpath: source.subpath,
    commit: source.commit,
    request: source.request
  });
}

function buildSkillInstallRecord(skill, agent, scope, options, projectScope) {
  const directoryName = skill.directoryName ?? skillDirectoryName(skill.id);

  if (agent === "codex") {
    const installPath =
      scope === "project"
        ? path.join(projectScope.projectDir, ".codex", "skills", directoryName)
        : path.join(os.homedir(), ".codex", "skills", directoryName);

    return {
      id: skill.id,
      version: skill.version,
      directoryName,
      entry: skill.entry,
      scope,
      ...(scope === "project"
        ? {
            projectDir: projectScope.projectDir,
            projectId: projectScope.projectId
          }
        : {}),
      installPath,
      marker: ".skills-manager.json"
    };
  }

  const userData = resolveEnlightenUserData(options);
  if (scope === "global") {
    return {
      id: skill.id,
      version: skill.version,
      directoryName,
      entry: skill.entry,
      scope,
      scopeKind: "device",
      installPath: path.join(userData, "codex-home", "skills", "device", directoryName),
      instanceKey: `device:${directoryName}`,
      marker: ".enlighten-install.json"
    };
  }

  const organizationId = options.organizationId ?? process.env.ENLIGHTEN_ORG_ID ?? "<org-id>";
  const spaceId = options.spaceId ?? process.env.ENLIGHTEN_SPACE_ID ?? "<space-id>";
  return {
    id: skill.id,
    version: skill.version,
    directoryName,
    entry: skill.entry,
    scope,
    scopeKind: "space",
    projectDir: projectScope.projectDir,
    projectId: projectScope.projectId,
    organizationId,
    spaceId,
    installPath: path.join(
      userData,
      "codex-home",
      "skills",
      "by-space",
      "organizations",
      organizationId,
      "spaces",
      spaceId,
      directoryName
    ),
    instanceKey: `space:${organizationId}:${spaceId}:${directoryName}`,
    marker: ".enlighten-install.json"
  };
}

export function resolveEnlightenUserData(options = {}) {
  if (options.enlightenUserData) {
    return path.resolve(options.enlightenUserData);
  }

  if (process.env.ENLIGHTEN_USER_DATA) {
    return path.resolve(process.env.ENLIGHTEN_USER_DATA);
  }

  const flavor = options.enlightenFlavor ?? "local";
  const applicationSupport = path.join(os.homedir(), "Library", "Application Support");
  const appDirectoryByFlavor = {
    local: "enlighten-desktop-local",
    test: "enlighten-desktop-test",
    prod: "enlighten-desktop"
  };

  const appDirectory = appDirectoryByFlavor[flavor];
  if (!appDirectory) {
    throw new CliUsageError(`Unsupported Enlighten flavor: ${flavor}`);
  }

  return path.join(applicationSupport, appDirectory);
}

function assertAgentCompatible(skill, agent) {
  const compatibleAgents = skill.compatibility?.agents;
  if (Array.isArray(compatibleAgents) && compatibleAgents.length > 0) {
    if (!compatibleAgents.includes(agent)) {
      throw new CliUsageError(`Skill ${skill.id} is not compatible with agent ${agent}.`);
    }
  }
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
