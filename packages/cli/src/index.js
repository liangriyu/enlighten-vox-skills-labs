#!/usr/bin/env node
import fs from "node:fs";
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
import { resolveProjectScope } from "./lib/project-scope.js";
import { resolveRequest, withResolvedInstallRequest } from "./lib/resolver.js";
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
      const projectScope = await resolveProjectScope(parsed.options, {
        cwd,
        stdin: io.stdin ?? process.stdin,
        stdout
      });

      return await withResolvedInstallRequest(
        parsed.target,
        {
          ...parsed.options,
          rootDir: cwd
        },
        async (resolved) => {
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
          const installed = await installResolvedSkills(resolved, plan, {
            ...parsed.options,
            rootDir: cwd,
            source: resolved.source?.type ?? "workspace"
          });
          const projectConfigPath = await writeProjectConfig(projectScope, plan, parsed.options);
          const lockfilePath = await writeInstallState(resolved, plan, {
            ...parsed.options,
            rootDir: cwd
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
      resolveRequest("vox-reputation/vox-keyword-patrol", { rootDir: cwd });
      stdout.write("Manifest validation passed.\n");
      return 0;
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
      const projectScope = await resolveProjectScope(parsed.options, {
        cwd,
        stdin: io.stdin ?? process.stdin,
        stdout
      });
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
      const projectScope = await resolveProjectScope(parsed.options, {
        cwd,
        stdin: io.stdin ?? process.stdin,
        stdout
      });
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
        const resolved = resolveRequest(target.request, { rootDir: cwd });
        const plan = buildInstallPlan(resolved, parsed.options, projectScope);
        await preflightInstallTargets(plan, parsed.options);
        const installed = await installResolvedSkills(resolved, plan, {
          ...parsed.options,
          rootDir: cwd
        });
        const lockfilePath = await writeInstallState(resolved, plan, {
          ...parsed.options,
          rootDir: cwd
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

function helpText() {
  return `@enlighten-vox/skills MVP

Usage:
  skills add <domain>/<suite-or-skill|git-source> [--suite <id>|--skill <id>] [--agent codex|enlighten-ai] [--scope global|project] [--project-dir <path>] [--dry-run]
  skills list [--agent codex|enlighten-ai] [--scope global|project] [--project-dir <path>]
  skills remove <domain>/<suite-or-skill> [--agent codex|enlighten-ai] [--scope global|project] [--project-dir <path>] [--dry-run] [--yes]
  skills update [domain/suite-or-skill] [--agent codex|enlighten-ai] [--scope global|project] [--project-dir <path>] [--dry-run] [--yes]
  skills doctor [--scope project --project-dir <path>]
  skills validate

Project scope:
  Project scope defaults to the current working directory.
  Use --project-dir <path> to target a different project.

Install:
  Use --yes for non-interactive installation.
  Use --force only to replace a manager-owned or explicitly replaceable target.
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
