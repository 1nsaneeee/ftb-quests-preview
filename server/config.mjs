import { lstat, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const LOCAL_CONFIG_NAME = "quest-preview.local.json";
export const USER_CONFIG_DIR = "ftb-quests-preview";

export function userConfigPath(env = process.env) {
  const home = homedir();
  const base = process.platform === "win32"
    ? env.APPDATA || join(home, "AppData", "Roaming")
    : process.platform === "darwin"
      ? join(home, "Library", "Application Support")
      : env.XDG_CONFIG_HOME || join(home, ".config");
  return join(base, USER_CONFIG_DIR, LOCAL_CONFIG_NAME);
}

export function userCacheDir(env = process.env) {
  const home = homedir();
  const base = process.platform === "win32"
    ? env.LOCALAPPDATA || join(home, "AppData", "Local")
    : process.platform === "darwin"
      ? join(home, "Library", "Caches")
      : env.XDG_CACHE_HOME || join(home, ".cache");
  return join(base, USER_CONFIG_DIR);
}

function parseArguments(argv) {
  const parsed = { demo: false, instanceRoot: undefined, dataDir: undefined, config: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--help" || name === "-h") continue;
    if (name === "--demo") {
      parsed.demo = true;
      continue;
    }
    if (name === "--config") {
      const value = argv[index + 1];
      if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
        throw new Error("--config requires a path");
      }
      if (parsed.config !== undefined) throw new Error("--config may only be specified once");
      parsed.config = value;
      index += 1;
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

async function fileExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

async function readLocalConfigAt(file) {
  let source;
  try {
    const fileInfo = await lstat(file);
    if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) {
      throw new Error(`${LOCAL_CONFIG_NAME} must be a regular file in the project directory`);
    }
    source = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { config: {}, exists: false };
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
  return { config, exists: true };
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
 * paths use cwd as their base; paths in the selected config file use that file's
 * directory. The config file is searched in cwd, then the project directory,
 * then the user config directory.
 */
export async function loadPreviewConfig({
  argv = [],
  env = process.env,
  cwd = process.cwd(),
  projectDir,
  fixtureQuestDir,
  configPath,
} = {}) {
  if (!projectDir || !fixtureQuestDir) throw new Error("projectDir and fixtureQuestDir are required");
  const workingDirectory = resolve(cwd);
  const projectDirectory = resolve(projectDir);
  const fixtureDirectory = resolve(fixtureQuestDir);
  const cli = parseArguments(argv);
  const explicitSource = cli.demo
    || cli.instanceRoot !== undefined
    || cli.dataDir !== undefined
    || env.QUEST_PREVIEW_INSTANCE_ROOT !== undefined
    || env.QUEST_PREVIEW_DATA_DIR !== undefined;

  const explicitConfig = configPath ?? cli.config ?? env.FTBQUEST_CONFIG;
  let selectedConfigPath;
  let local = {};
  let configExists = false;
  if (explicitSource) {
    selectedConfigPath = explicitConfig ? resolve(workingDirectory, explicitConfig) : userConfigPath(env);
  } else {
    const cwdConfig = join(workingDirectory, LOCAL_CONFIG_NAME);
    const projectConfig = join(projectDirectory, LOCAL_CONFIG_NAME);
    if (explicitConfig) selectedConfigPath = resolve(workingDirectory, explicitConfig);
    else if (await fileExists(cwdConfig)) selectedConfigPath = cwdConfig;
    else if (await fileExists(projectConfig)) selectedConfigPath = projectConfig;
    else selectedConfigPath = userConfigPath(env);
    ({ config: local, exists: configExists } = await readLocalConfigAt(selectedConfigPath));
  }
  const configDirectory = dirname(selectedConfigPath);

  const cliInstance = configuredPath(cli.instanceRoot, workingDirectory, "--instance-root");
  const cliData = configuredPath(cli.dataDir, workingDirectory, "--data-dir");
  const envInstance = configuredPath(env.QUEST_PREVIEW_INSTANCE_ROOT, workingDirectory, "QUEST_PREVIEW_INSTANCE_ROOT");
  const envData = configuredPath(env.QUEST_PREVIEW_DATA_DIR, workingDirectory, "QUEST_PREVIEW_DATA_DIR");
  const localInstance = configuredPath(local.instanceRoot, configDirectory, "instanceRoot");
  const localData = configuredPath(local.dataDir, configDirectory, "dataDir");

  const selectedInstance = cliInstance ?? envInstance ?? localInstance;
  const selectedData = cliData ?? envData ?? localData;
  const hasExplicitPath = selectedInstance !== undefined || selectedData !== undefined;
  const cliDemo = cli.demo;
  const configDemo = local.mode === "demo" && !hasExplicitPath;
  const base = { configPath: selectedConfigPath, configExists };

  if (cliDemo || configDemo) {
    await assertQuestDirectory(fixtureDirectory);
    return {
      ...base,
      instanceRoot: workingDirectory,
      questDir: fixtureDirectory,
      isDemo: true,
      needsSetup: false,
      source: cliDemo ? "cli" : "local-config",
    };
  }

  const instanceRoot = selectedInstance ?? workingDirectory;
  await assertDirectory(instanceRoot, "Minecraft instance directory");
  const defaultQuestDir = resolve(instanceRoot, "config", "ftbquests", "quests");
  if (!hasExplicitPath) {
    let defaultExists = false;
    try {
      defaultExists = (await stat(defaultQuestDir)).isDirectory();
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
    if (!defaultExists) {
      return {
        ...base,
        instanceRoot,
        questDir: null,
        isDemo: false,
        needsSetup: true,
        source: "unconfigured",
      };
    }
  }

  const questDir = selectedData ?? defaultQuestDir;
  await assertQuestDirectory(questDir);

  let source = configExists ? "local-config" : "default";
  if (cliInstance !== undefined || cliData !== undefined) source = "cli";
  else if (envInstance !== undefined || envData !== undefined) source = "env";
  return { ...base, instanceRoot, questDir, isDemo: false, needsSetup: false, source };
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
