#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/args.js";
import { CliUsageError } from "./lib/errors.js";
import { buildInstallPlan } from "./lib/plan.js";
import {
  installResolvedSkills,
  removeInstalledSkill,
  preflightInstallTargets
} from "./lib/installer.js";
import {
  assertProjectConfigReady,
  writeInstallState,
  writeProjectConfig
} from "./lib/lockfile.js";
import { validateRegistryManifests } from "./lib/manifest.js";
import { resolveProjectScope } from "./lib/project-scope.js";
import {
  resolveRequest,
  withDiscoveredSource,
  withRegistryRoot,
  withResolvedInstallRequest
} from "./lib/resolver.js";
import {
  buildRemovePlan,
  buildUpdatePlan,
  listInstalled,
  loadInstallState,
  runStaticDoctor,
  saveInstallState
} from "./lib/state.js";

export async function run(argv, io = {}) {
  const cwd = io.cwd ?? process.cwd();
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;

  try {
    const parsed = parseArgs(argv);

    if (parsed.options.help || parsed.command === "help") {
      stdout.write(helpText());
      return 0;
    }

    if (parsed.command === "add") {
      if (parsed.options.list) {
        return await withDiscoveredSource(
          parsed.target,
          {
            ...parsed.options,
            rootDir: cwd
          },
          ({ discovered, source }) => {
            stdout.write(
              `${JSON.stringify(buildDiscoveryResult(parsed.target, source, discovered), null, 2)}\n`
            );
            return 0;
          }
        );
      }

      const projectScope = await resolveProjectScope(
        {
          ...parsed.options,
          requireExplicitProjectDir: parsed.options.yes === true && parsed.options.dryRun !== true
        },
        {
          cwd,
          stdin: io.stdin ?? process.stdin,
          stdout
        }
      );

      return await withResolvedInstallRequest(
        parsed.target,
        {
          ...parsed.options,
          rootDir: cwd
        },
        async (resolved) => {
          if (isDirectExternalSource(resolved) && parsed.options.dryRun !== true) {
            throw new CliUsageError(
              "External source installs currently support --list and --dry-run only. Run `skills add <source> --list` first, then `skills add <source> --skill <id> --dry-run` to inspect the plan."
            );
          }

          const plan = buildInstallPlan(resolved, parsed.options, projectScope);

          if (parsed.options.dryRun) {
            stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
            return 0;
          }

          if (!parsed.options.yes && !(io.stdin ?? process.stdin).isTTY) {
            throw new CliUsageError(
              "Actual installation requires `--yes` in non-interactive mode."
            );
          }

          await assertProjectConfigReady(projectScope, parsed.options);
          await preflightInstallTargets(plan, parsed.options);
          const sourceRoot = resolved.source?.sourceRoot ?? resolved.source?.localRoot ?? cwd;
          const installed = await installResolvedSkills(resolved, plan, {
            ...parsed.options,
            rootDir: sourceRoot,
            source: resolved.source?.type ?? "workspace"
          });
          const projectConfigPath = await writeProjectConfig(projectScope, plan, parsed.options);
          const lockfilePath = await writeInstallState(resolved, plan, {
            ...parsed.options,
            rootDir: sourceRoot
          });

          stdout.write(
            `${JSON.stringify(
              {
                schema: "install-result/v1",
                request: plan.request,
                agent: plan.agent,
                scope: plan.scope,
                projectConfigPath,
                lockfilePath,
                installed: installed.map(({ id, installPath, markerPath }) => ({
                  id,
                  installPath,
                  markerPath
                }))
              },
              null,
              2
            )}\n`
          );
          return 0;
        }
      );
    }

    if (parsed.command === "validate") {
      return await withRegistryRoot(
        {
          ...parsed.options,
          rootDir: cwd
        },
        ({ rootDir }) => {
          const counts = validateRegistryManifests(rootDir);
          stdout.write(
            `Manifest validation passed. domains=${counts.domains} suites=${counts.suites} skills=${counts.skills} resources=${counts.resources}\n`
          );
          return 0;
        }
      );
    }

    if (parsed.command === "list") {
      const projectScope = await resolveProjectScope(parsed.options, {
        cwd,
        stdin: io.stdin ?? process.stdin,
        stdout
      });
      const state = await loadInstallState(parsed.options, projectScope);
      stdout.write(
        `${JSON.stringify(
          {
            schema: "list-result/v1",
            agent: parsed.options.agent ?? "codex",
            scope: parsed.options.scope ?? "global",
            project: projectScope,
            lockfilePath: state.lockfilePath,
            installed: listInstalled(state)
          },
          null,
          2
        )}\n`
      );
      return 0;
    }

    if (parsed.command === "remove") {
      const projectScope = await resolveProjectScope(
        {
          ...parsed.options,
          requireExplicitProjectDir: parsed.options.yes === true && parsed.options.dryRun !== true
        },
        {
          cwd,
          stdin: io.stdin ?? process.stdin,
          stdout
        }
      );
      const state = await loadInstallState(parsed.options, projectScope);
      const removePlan = buildRemovePlan(state, parsed.target, parsed.options);

      if (parsed.options.dryRun) {
        const { updatedLockfile, ...publicPlan } = removePlan;
        stdout.write(`${JSON.stringify(publicPlan, null, 2)}\n`);
        return 0;
      }

      if (!parsed.options.yes && !(io.stdin ?? process.stdin).isTTY) {
        throw new CliUsageError(
          "Actual removal requires `--yes` in non-interactive mode."
        );
      }

      const removed = [];
      for (const record of removePlan.removed) {
        removed.push(await removeInstalledSkill(record, parsed.options));
      }
      await saveInstallState(state, removePlan.updatedLockfile);

      stdout.write(
        `${JSON.stringify(
          {
            schema: "remove-result/v1",
            target: parsed.target,
            agent: removePlan.agent,
            scope: removePlan.scope,
            lockfilePath: removePlan.lockfilePath,
            removed,
            kept: removePlan.kept
          },
          null,
          2
        )}\n`
      );
      return 0;
    }

    if (parsed.command === "update") {
      const projectScope = await resolveProjectScope(
        {
          ...parsed.options,
          requireExplicitProjectDir: parsed.options.yes === true && parsed.options.dryRun !== true
        },
        {
          cwd,
          stdin: io.stdin ?? process.stdin,
          stdout
        }
      );
      const state = await loadInstallState(parsed.options, projectScope);
      const updatePlan = buildUpdatePlan(state, parsed.target, parsed.options);

      if (parsed.options.dryRun) {
        stdout.write(`${JSON.stringify(updatePlan, null, 2)}\n`);
        return 0;
      }

      if (!parsed.options.yes && !(io.stdin ?? process.stdin).isTTY) {
        throw new CliUsageError(
          "Actual update requires `--yes` in non-interactive mode."
        );
      }

      await assertProjectConfigReady(projectScope, parsed.options);
      const updated = [];
      for (const target of updatePlan.targets) {
        await withRegistryRoot(
          {
            ...parsed.options,
            rootDir: cwd
          },
          async ({ rootDir }) => {
            const resolved = resolveRequest(target.request, { rootDir });
            const planOptions = updateOptionsFromExistingRecords(parsed.options, target.records);
            const plan = buildInstallPlan(resolved, planOptions, projectScope);
            preserveUpdateInstallBindings(plan, target.records);
            await preflightInstallTargets(plan, parsed.options);
            const installed = await installResolvedSkills(resolved, plan, {
              ...planOptions,
              rootDir
            });
            const lockfilePath = await writeInstallState(resolved, plan, {
              ...planOptions,
              rootDir
            });
            updated.push({
              request: target.request,
              type: target.type,
              lockfilePath,
              installed: installed.map(({ id, installPath, markerPath }) => ({
                id,
                installPath,
                markerPath
              }))
            });
          }
        );
      }

      stdout.write(
        `${JSON.stringify(
          {
            schema: "update-result/v1",
            agent: updatePlan.agent,
            scope: updatePlan.scope,
            lockfilePath: updatePlan.lockfilePath,
            updated
          },
          null,
          2
        )}\n`
      );
      return 0;
    }

    if (parsed.command === "doctor") {
      const projectScope = await resolveProjectScope(parsed.options, {
        cwd,
        stdin: io.stdin ?? process.stdin,
        stdout
      });
      const state = await loadInstallState(parsed.options, projectScope);
      const result = await runStaticDoctor(state, parsed.options);
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.checks.some((check) => check.status === "failed") ? 1 : 0;
    }

    throw new CliUsageError(`Unknown command: ${parsed.command}`);
  } catch (error) {
    if (error instanceof CliUsageError) {
      stderr.write(`Error: ${error.message}\n`);
      return error.exitCode;
    }
    stderr.write(`Error: ${error.message}\n`);
    return 1;
  }
}

function updateOptionsFromExistingRecords(options, records = []) {
  const firstEnlightenBindingRecord = records.find(
    (record) =>
      record.agent === "enlighten-ai" &&
      (record.scope === "space" || record.scope === "project") &&
      record.organizationId &&
      record.spaceId
  );

  if (!firstEnlightenBindingRecord) {
    return options;
  }

  return {
    ...options,
    organizationId: options.organizationId ?? firstEnlightenBindingRecord.organizationId,
    spaceId: options.spaceId ?? firstEnlightenBindingRecord.spaceId
  };
}

function preserveUpdateInstallBindings(plan, records = []) {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  plan.skills = plan.skills.map((record) => {
    const existing = recordsById.get(record.id);
    if (!existing) {
      return record;
    }

    return {
      ...record,
      installPath: existing.installPath,
      scopeKind: existing.scopeKind,
      projectDir: existing.projectDir,
      projectId: existing.projectId,
      organizationId: existing.organizationId,
      spaceId: existing.spaceId,
      instanceKey: existing.instanceKey,
      marker: existing.marker ?? record.marker
    };
  });
}

function isDirectExternalSource(resolved) {
  return resolved.source?.sourceUsage === "direct";
}

function buildDiscoveryResult(target, source, discovered) {
  return {
    schema: "source-discovery/v1",
    request: target,
    source: publicSource(source),
    suites: discovered.suites.map((suite) => publicSuite(suite, discovered.sourceRoot)),
    skills: discovered.skills.map((skill) => publicSkill(skill, discovered.sourceRoot))
  };
}

function publicSource(source) {
  return compactObject({
    type: source.type,
    sourceType: source.type,
    sourceUsage: source.sourceUsage,
    sourceUrl: source.url,
    sourceRequest: source.request,
    localPath: source.type === "local" ? source.localPath : undefined,
    ref: source.ref,
    subpath: source.subpath,
    commit: source.commit
  });
}

function publicSuite(suite, sourceRoot) {
  return compactObject({
    id: suite.id,
    version: suite.version,
    name: suite.name,
    description: suite.description,
    skills: suite.skills,
    manifestPath: relativeManifestPath(sourceRoot, suite.manifestPath),
    selectors: suite.selectorNames
  });
}

function publicSkill(skill, sourceRoot) {
  return compactObject({
    id: skill.id,
    version: skill.version,
    name: skill.name,
    description: skill.description,
    entry: skill.entry,
    resources: skill.resources,
    manifestPath: relativeManifestPath(sourceRoot, skill.manifestPath),
    selectors: skill.selectorNames
  });
}

function relativeManifestPath(sourceRoot, manifestPath) {
  return path.relative(sourceRoot, manifestPath).split(path.sep).join("/");
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function helpText() {
  return `@enlighten-vox/skills MVP

Usage:
  skills add <source> --list
  skills add <source> [--suite <id>|--skill <id>] [--agent codex|enlighten-ai] [--scope global|space|project] [--project-dir <path>] --dry-run
  skills add <domain>/<suite-or-skill> [--registry <path-or-git-source>] [--agent codex|enlighten-ai] [--scope global|space|project] [--project-dir <path>] [--dry-run]
  skills list [--agent codex|enlighten-ai] [--scope global|space|project] [--project-dir <path>]
  skills remove <domain>/<suite-or-skill> [--agent codex|enlighten-ai] [--scope global|space|project] [--project-dir <path>] [--dry-run] [--yes]
  skills update [domain/suite-or-skill] [--registry <path-or-git-source>] [--agent codex|enlighten-ai] [--scope global|space|project] [--project-dir <path>] [--dry-run] [--yes]
  skills doctor [--agent codex|enlighten-ai] [--scope global|space|project] [--project-dir <path>]
  skills validate [--registry <path-or-git-source>]

Scopes:
  codex global: ~/.codex/skills/<skill>
  codex project: <projectDir>/.codex/skills/<skill>
  enlighten-ai global: {userData}/codex-home/skills/device/<skill>
  enlighten-ai space: {userData}/codex-home/skills/by-space/organizations/<org>/spaces/<space>/<skill>
  enlighten-ai project: <projectDir>/.codex/skills/<skill>
  Read-only project commands default to the current working directory.
  Non-interactive project mutations require --project-dir <path>.
  Enlighten AI space scope requires --organization-id and --space-id.

Install:
  Use --yes for non-interactive installation.
  Use --force only to replace a manager-owned or explicitly replaceable target.
  External direct sources are limited to --list and --dry-run in this release.
`;
}

if (isMainModule()) {
  const exitCode = await run(process.argv.slice(2));
  process.exit(exitCode);
}

function isMainModule() {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return import.meta.url === `file://${process.argv[1]}`;
  }
}
