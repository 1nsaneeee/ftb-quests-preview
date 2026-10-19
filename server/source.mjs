import { cp, lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

/**
 * Demo mode edits a local copy so the bundled fixtures stay pristine. Both the
 * browser server and the CLI use this helper to agree on which directory is
 * writable.
 */
export async function prepareDemoQuestDir({ appDir, fixtureQuestDir }) {
  const demoParent = join(appDir, ".local");
  const demoDirectory = join(demoParent, "demo-quests");
  try {
    await mkdir(demoParent, { recursive: true });
    const parentReal = await realpath(demoParent);
    const appReal = await realpath(appDir);
    const parentRelative = relative(appReal, parentReal);
    if (isAbsolute(parentRelative) || parentRelative === ".." || parentRelative.startsWith(`..${sep}`)) {
      throw new Error("Unsafe demo directory");
    }
    try {
      const info = await lstat(demoDirectory);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Unsafe demo directory");
      const demoReal = await realpath(demoDirectory);
      const demoRelative = relative(parentReal, demoReal);
      if (isAbsolute(demoRelative) || demoRelative === ".." || demoRelative.startsWith(`..${sep}`)) {
        throw new Error("Unsafe demo directory");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await cp(fixtureQuestDir, demoDirectory, { recursive: true, errorOnExist: true, force: false });
    }
    return demoDirectory;
  } catch (error) {
    throw new Error(`Could not initialize editable demo data: ${error.message}`);
  }
}
