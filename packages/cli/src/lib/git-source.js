import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { CliUsageError } from "./errors.js";
import { normalizeSourceSubpath } from "./source-parser.js";

const execFile = promisify(execFileCallback);

export async function withMaterializedSource(source, callback, options = {}) {
  if (source.type === "local") {
    const rootDir = await resolveSourceSubpath(source.localPath, source.subpath);
    return callback({
      rootDir,
      repositoryRoot: source.localPath,
      source: {
        ...source,
        commit: await readGitCommit(source.localPath)
      }
    });
  }

  const temporaryRoot = await fs.mkdtemp(
    path.join(options.tempDir ?? os.tmpdir(), "enlighten-vox-git-")
  );

  try {
    const repositoryRoot = path.join(temporaryRoot, "repo");
    await cloneRepository(source, repositoryRoot, options);
    const rootDir = await resolveSourceSubpath(repositoryRoot, source.subpath);
    const commit = await readGitCommit(repositoryRoot);

    return await callback({
      rootDir,
      repositoryRoot,
      source: {
        ...source,
        commit
      }
    });
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function cloneRepository(source, destination, options = {}) {
  const args = ["clone", "--depth", String(options.depth ?? 1), "--no-tags"];
  if (source.ref) {
    args.push("--branch", source.ref);
  }
  args.push("--", source.url, destination);

  try {
    await execFile("git", args, {
      cwd: options.cwd,
      maxBuffer: options.maxBuffer ?? 1024 * 1024
    });
  } catch (error) {
    const detail = sanitizeProcessOutput(error.stderr || error.stdout || error.message);
    const refDescription = source.ref ? ` at ref ${source.ref}` : "";
    throw new CliUsageError(
      `Unable to clone Git source ${source.url}${refDescription}.${detail ? ` ${detail}` : ""}`
    );
  }

  return destination;
}

export async function readGitCommit(repositoryRoot) {
  try {
    const { stdout } = await execFile("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], {
      maxBuffer: 64 * 1024
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function sanitizeProcessOutput(value) {
  return String(value ?? "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

async function resolveSourceSubpath(repositoryRoot, subpath) {
  const normalized = normalizeSourceSubpath(subpath);
  const root = path.resolve(repositoryRoot);
  const target = path.resolve(root, normalized ?? ".");
  const relative = path.relative(root, target);

  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new CliUsageError(`Git source subpath escapes repository root: ${subpath}`);
  }

  try {
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) {
      throw new CliUsageError(`Git source subpath is not a directory: ${subpath}`);
    }
  } catch (error) {
    if (error instanceof CliUsageError) {
      throw error;
    }
    if (error.code === "ENOENT") {
      throw new CliUsageError(`Git source subpath does not exist: ${subpath}`);
    }
    throw error;
  }

  return target;
}
