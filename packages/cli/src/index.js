#!/usr/bin/env node
import { parseArgs } from "./lib/args.js";
import { CliUsageError } from "./lib/errors.js";
import { buildInstallPlan } from "./lib/plan.js";
import {
  installResolvedSkills,
  preflightInstallTargets
} from "./lib/installer.js";
import {
  assertProjectConfigReady,
  writeInstallState,
  writeProjectConfig
} from "./lib/lockfile.js";
import { resolveProjectScope } from "./lib/project-scope.js";
import { resolveRequest } from "./lib/resolver.js";

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
      const resolved = resolveRequest(parsed.target, { rootDir: cwd });
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
        rootDir: cwd
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

    if (parsed.command === "validate") {
      resolveRequest("vox-reputation/vox-keyword-patrol", { rootDir: cwd });
      stdout.write("Manifest validation passed.\n");
      return 0;
    }

    if (parsed.command === "doctor") {
      const projectScope = await resolveProjectScope(parsed.options, {
        cwd,
        stdin: io.stdin ?? process.stdin,
        stdout
      });
      stdout.write(
        `${JSON.stringify(
          {
            schema: "doctor-result/v1",
            project: projectScope,
            checks: [
              {
                id: "project-dir",
                status: projectScope ? "passed" : "skipped"
              }
            ]
          },
          null,
          2
        )}\n`
      );
      return 0;
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
  return `@org/skills MVP

Usage:
  skills add <domain>/<suite-or-skill> [--agent codex|enlighten-ai] [--scope global|project] [--project-dir <path>] [--dry-run]
  skills doctor [--scope project --project-dir <path>]
  skills validate

Project scope:
  Non-interactive project scope requires --project-dir <path>.

Install:
  Use --yes for non-interactive installation.
  Use --force only to replace a manager-owned or explicitly replaceable target.
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await run(process.argv.slice(2));
  process.exit(exitCode);
}
