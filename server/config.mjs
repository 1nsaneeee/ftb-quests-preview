import { lstat, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export const LOCAL_CONFIG_NAME = "quest-preview.local.json";

function parseArguments(argv) {
  const parsed = { demo: false, instanceRoot: undefined, dataDir: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--help" || name === "-h") continue;
    if (name === "--demo") {
      parsed.demo = true;
      continue;
    }
    if (name !== "--instance-root" && name !== "--data-dir") {
      throw new Error(`Unknown option: ${name}`);
    }
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw new Error(`${name} requires a path`);
    }
    const field = name === "--instance-root" ? "instanceRoot" : "dataDir";
    if (parsed[field] !== undefined) throw new Error(`${name} may only be specified once`);
    parsed[field] = value;
    index += 1;
  }
  if (parsed.demo && (parsed.instanceRoot !== undefined || parsed.dataDir !== undefined)) {
    throw new Error("--demo cannot be combined with --instance-root or --data-dir");
  }
  return parsed;
}

function configuredPath(value, baseDirectory, label) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty path`);
  }
  return resolve(baseDirectory, value);
}

async function readLocalConfig(projectDir) {
  const file = resolve(projectDir, LOCAL_CONFIG_NAME);
  let source;
  try {
    const fileInfo = await lstat(file);
    if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) {
      throw new Error(`${LOCAL_CONFIG_NAME} must be a regular file in the project directory`);
    }
    source = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  let config;
  try {
    config = JSON.parse(source);
  } catch {
    throw new Error(`${LOCAL_CONFIG_NAME} is not valid JSON`);
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${LOCAL_CONFIG_NAME} must contain a JSON object`);
  }
  if (config.version !== 1) throw new Error(`${LOCAL_CONFIG_NAME} must use config version 1`);
  if (config.mode !== undefined && config.mode !== "demo" && config.mode !== "instance") {
    throw new Error(`${LOCAL_CONFIG_NAME} has an unsupported mode`);
  }
  for (const key of Object.keys(config)) {
    if (!["version", "mode", "instanceRoot", "dataDir"].includes(key)) {
      throw new Error(`${LOCAL_CONFIG_NAME} contains unsupported field '${key}'`);
    }
  }
  return config;
}

async function assertDirectory(path, label) {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      throw new Error(`${label} does not exist`);
    }
    throw error;
  }
  if (!details.isDirectory()) throw new Error(`${label} is not a directory`);
}

async function assertOptionalDirectory(path, label) {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return;
    throw error;
  }
  if (!details.isDirectory()) throw new Error(`${label} is not a directory`);
}

async function assertQuestDirectory(path) {
  await assertDirectory(path, "Quest data directory");
  await assertDirectory(resolve(path, "chapters"), "Quest chapters directory");
  await assertOptionalDirectory(resolve(path, "lang"), "Quest locale directory");
}

function isWithin(parent, child) {
  const childRelative = relative(parent, child);
  return childRelative === "" || (!isAbsolute(childRelative)
    && childRelative !== ".."
    && !childRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
}

/**
 * Resolve all runtime paths without changing process state. CLI and environment
 * paths use cwd as their base; paths in quest-preview.local.json use projectDir.
 */
export async function loadPreviewConfig({
  argv = [],
  env = process.env,
  cwd = process.cwd(),
  projectDir,
  fixtureQuestDir,
} = {}) {
  if (!projectDir || !fixtureQuestDir) throw new Error("projectDir and fixtureQuestDir are required");
  const workingDirectory = resolve(cwd);
  const projectDirectory = resolve(projectDir);
  const fixtureDirectory = resolve(fixtureQuestDir);
  const cli = parseArguments(argv);
  const local = await readLocalConfig(projectDirectory);

  const cliInstance = configuredPath(cli.instanceRoot, workingDirectory, "--instance-root");
  const cliData = configuredPath(cli.dataDir, workingDirectory, "--data-dir");
  const envInstance = configuredPath(env.QUEST_PREVIEW_INSTANCE_ROOT, workingDirectory, "QUEST_PREVIEW_INSTANCE_ROOT");
  const envData = configuredPath(env.QUEST_PREVIEW_DATA_DIR, workingDirectory, "QUEST_PREVIEW_DATA_DIR");
  const localInstance = configuredPath(local.instanceRoot, projectDirectory, "instanceRoot");
  const localData = configuredPath(local.dataDir, projectDirectory, "dataDir");

  const selectedInstance = cliInstance ?? envInstance ?? localInstance;
  const selectedData = cliData ?? envData ?? localData;
  const hasExplicitPath = selectedInstance !== undefined || selectedData !== undefined;
  const cliDemo = cli.demo;
  const configDemo = local.mode === "demo" && !hasExplicitPath;

  if (cliDemo || configDemo) {
    await assertQuestDirectory(fixtureDirectory);
    return {
      instanceRoot: workingDirectory,
      questDir: fixtureDirectory,
      isDemo: true,
      source: cliDemo ? "cli" : configDemo ? "local-config" : "demo",
    };
  }

  const instanceRoot = selectedInstance ?? workingDirectory;
  await assertDirectory(instanceRoot, "Minecraft instance directory");
  const defaultQuestDir = resolve(instanceRoot, "config", "ftbquests", "quests");
  if (!hasExplicitPath && local.mode !== "instance") {
    try {
      await stat(defaultQuestDir);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") {
        await assertQuestDirectory(fixtureDirectory);
        return { instanceRoot, questDir: fixtureDirectory, isDemo: true, source: "demo" };
      }
      throw error;
    }
  }

  const questDir = selectedData ?? defaultQuestDir;
  await assertQuestDirectory(questDir);

  let source = "local-config";
  if (cliInstance !== undefined || cliData !== undefined) source = "cli";
  else if (envInstance !== undefined || envData !== undefined) source = "env";
  return { instanceRoot, questDir, isDemo: false, source };
}

export function toLocalConfigPath(targetPath, projectDir, { allowAbsolute = false } = {}) {
  const projectDirectory = resolve(projectDir);
  const absoluteTarget = resolve(targetPath);
  const relativePath = relative(projectDirectory, absoluteTarget);
  if (isAbsolute(relativePath)) {
    if (!allowAbsolute) return { path: null, requiresConfirmation: true };
    return { path: absoluteTarget, requiresConfirmation: false };
  }
  return {
    path: (relativePath || ".").replaceAll("\\", "/"),
    requiresConfirmation: false,
  };
}

export function isPathWithin(parent, child) {
  return isWithin(resolve(parent), resolve(child));
}
