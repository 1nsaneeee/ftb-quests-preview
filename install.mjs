import { copyFile, lstat, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { stdin, stdout } from "node:process";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LOCAL_CONFIG_NAME, toLocalConfigPath } from "./server/config.mjs";

const projectDir = resolve(fileURLToPath(new URL(".", import.meta.url)));

export function supportsNode(version = process.versions.node) {
  const major = Number.parseInt(String(version).split(".")[0], 10);
  return Number.isInteger(major) && major >= 20;
}

async function createPrompt(options) {
  const { createInterface } = await import("node:readline/promises");
  return createInterface(options);
}

function parseArguments(argv) {
  const options = { demo: false, replace: false, allowAbsolute: false };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--help" || name === "-h") {
      options.help = true;
      continue;
    }
    if (name === "--demo") {
      options.demo = true;
      continue;
    }
    if (name === "--replace") {
      options.replace = true;
      continue;
    }
    if (name === "--absolute-paths") {
      options.allowAbsolute = true;
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
    if (options[field] !== undefined) throw new Error(`${name} may only be specified once`);
    options[field] = value;
    index += 1;
  }
  if (options.demo && (options.instanceRoot !== undefined || options.dataDir !== undefined)) {
    throw new Error("--demo cannot be combined with --instance-root or --data-dir");
  }
  return options;
}

async function requireDirectory(path, label) {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new Error(`${label} does not exist`);
    throw error;
  }
  if (!details.isDirectory()) throw new Error(`${label} is not a directory`);
}

async function requireOptionalDirectory(path, label) {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return;
    throw error;
  }
  if (!details.isDirectory()) throw new Error(`${label} is not a directory`);
}

async function requireQuestDirectory(path) {
  await requireDirectory(path, "Quest data directory");
  await requireDirectory(join(path, "chapters"), "Quest chapters directory");
  await requireOptionalDirectory(join(path, "lang"), "Quest locale directory");
}

async function askForSelection(input, output) {
  const prompt = await createPrompt({ input, output });
  try {
    const choice = (await prompt.question(
      "Choose data source: [1] Minecraft instance, [2] separate quests folder, [3] bundled demo: ",
    )).trim();
    if (choice === "3") return { demo: true };
    if (choice === "1") {
      const instanceRoot = (await prompt.question("Minecraft instance root: ")).trim();
      return { instanceRoot };
    }
    if (choice === "2") {
      const dataDir = (await prompt.question("Quest data folder (with chapters/; lang/ is optional): ")).trim();
      const instanceRoot = (await prompt.question(
        "Optional Minecraft instance root for local assets (press Enter to skip): ",
      )).trim();
      return { dataDir, ...(instanceRoot ? { instanceRoot } : {}) };
    }
    throw new Error("Choose 1, 2, or 3");
  } finally {
    prompt.close();
  }
}

async function pathForConfig(targetPath, projectDirectory, options, confirmAbsolute) {
  const result = toLocalConfigPath(targetPath, projectDirectory, { allowAbsolute: options.allowAbsolute });
  if (!result.requiresConfirmation) return result.path;
  if (options.interactive && await confirmAbsolute(targetPath)) return resolve(targetPath);
  throw new Error(
    "This folder is on a different Windows drive, so a relative config path cannot be written. "
    + "Rerun with --absolute-paths to store a local absolute path (the local config is gitignored).",
  );
}

async function confirmAbsolutePath(output) {
  const prompt = await createPrompt({ input: stdin, output });
  try {
    const answer = (await prompt.question(
      `This folder is on another drive. Store its absolute path only in the ignored local config? [y/N] `,
    )).trim();
    return /^y(?:es)?$/i.test(answer);
  } finally {
    prompt.close();
  }
}

function backupName(configPath, now) {
  const stamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return `${configPath}.bak-${stamp}`;
}

async function backupExisting(configPath, now) {
  let candidate = backupName(configPath, now);
  let suffix = 1;
  while (true) {
    try {
      await copyFile(configPath, candidate, constants.COPYFILE_EXCL);
      return candidate;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      candidate = `${backupName(configPath, now)}-${suffix++}`;
    }
  }
}

export async function runSetup({
  argv = [],
  cwd = process.cwd(),
  projectDirectory = projectDir,
  input = stdin,
  output = stdout,
  interactive = Boolean(input.isTTY && output.isTTY),
  now = new Date(),
  confirmAbsolute,
} = {}) {
  let options = parseArguments(argv);
  if (options.help) {
    return { help: true };
  }
  options.interactive = interactive;
  if (options.demo && (options.instanceRoot !== undefined || options.dataDir !== undefined)) {
    throw new Error("--demo cannot be combined with --instance-root or --data-dir");
  }
  if (!options.demo && options.instanceRoot === undefined && options.dataDir === undefined) {
    if (!interactive) {
      throw new Error("Choose --instance-root PATH, --data-dir PATH, or --demo; run npm run setup for interactive setup.");
    }
    options = { ...options, ...await askForSelection(input, output), interactive, replace: options.replace, allowAbsolute: options.allowAbsolute };
  }
  if (!options.demo && options.instanceRoot === undefined && options.dataDir === undefined) {
    throw new Error("A Minecraft instance root, quests folder, or demo selection is required");
  }

  const workingDirectory = resolve(cwd);
  const targetProject = resolve(projectDirectory);
  const confirmAbsoluteValue = confirmAbsolute ?? (() => confirmAbsolutePath(output));
  const configPath = join(targetProject, LOCAL_CONFIG_NAME);
  const config = { version: 1 };
  if (options.demo) {
    config.mode = "demo";
  } else {
    config.mode = "instance";
    const instanceRoot = options.instanceRoot === undefined
      ? undefined
      : resolve(workingDirectory, options.instanceRoot);
    const dataDir = options.dataDir === undefined
      ? undefined
      : resolve(workingDirectory, options.dataDir);

    if (instanceRoot !== undefined) {
      await requireDirectory(instanceRoot, "Minecraft instance directory");
      config.instanceRoot = await pathForConfig(instanceRoot, targetProject, options, confirmAbsoluteValue);
    }
    if (dataDir !== undefined) {
      await requireQuestDirectory(dataDir);
      config.dataDir = await pathForConfig(dataDir, targetProject, options, confirmAbsoluteValue);
    } else if (instanceRoot !== undefined) {
      await requireQuestDirectory(join(instanceRoot, "config", "ftbquests", "quests"));
    }
  }

  await mkdir(targetProject, { recursive: true });
  let backup = null;
  try {
    const configInfo = await lstat(configPath);
    if (configInfo.isSymbolicLink() || !configInfo.isFile()) {
      throw new Error(`${LOCAL_CONFIG_NAME} must be a regular file in the project directory.`);
    }
    if (!options.replace) {
      throw new Error(`${LOCAL_CONFIG_NAME} already exists; rerun with --replace to back it up before changing it.`);
    }
    backup = await backupExisting(configPath, now);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const tempPath = join(targetProject, `.${LOCAL_CONFIG_NAME}.tmp-${process.pid}-${now.getTime()}`);
  try {
    await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, configPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
  return { configPath, backupPath: backup, config };
}

function printHelp(output) {
  output.write("Usage: npm run setup -- [--instance-root PATH] [--data-dir PATH] [--demo] [--replace] [--absolute-paths]\n");
  output.write("Paths are resolved from the current working directory and saved relative to the project when possible.\n");
}

async function main() {
  if (!supportsNode()) {
    console.error(`Node.js 20 or newer is required; detected ${process.versions.node}.`);
    process.exitCode = 1;
    return;
  }
  try {
    const result = await runSetup({ argv: process.argv.slice(2) });
    if (result.help) {
      printHelp(stdout);
      return;
    }
    if (result.backupPath) stdout.write(`Previous local config backed up to ${relative(projectDir, result.backupPath)}\n`);
    stdout.write(`Local setup saved to ${relative(projectDir, result.configPath)}\n`);
    stdout.write("Run `npm start` to open the preview. This config is local and ignored by Git.\n");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
