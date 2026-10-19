import { cp, lstat, mkdir, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { userCacheDir } from "./config.mjs";

/**
 * Demo mode edits a local copy so the bundled fixtures stay pristine. A source
 * checkout uses `.local`; an installed package uses the user cache directory so
 * the package itself is never written to.
 */
export async function prepareDemoQuestDir({ appDir, fixtureQuestDir, demoParent }) {
  const parent = demoParent ?? (appDir.includes(`${sep}node_modules${sep}`) ? userCacheDir(process.env) : join(appDir, ".local"));
  const demoDirectory = join(parent, "demo-quests");
  try {
    await mkdir(parent, { recursive: true });
    const parentReal = await realpath(parent);
    if (!parentReal) throw new Error("Unsafe demo directory");
    try {
      const info = await lstat(demoDirectory);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Unsafe demo directory");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await cp(fixtureQuestDir, demoDirectory, { recursive: true, errorOnExist: true, force: false });
    }
    return demoDirectory;
  } catch (error) {
    throw new Error(`Could not initialize editable demo data: ${error.message}`);
  }
}
