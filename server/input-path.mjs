import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export function resolveInputPath(value, base, { home = homedir(), platform = process.platform } = {}) {
  let path = value.trim();
  if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'"))) path = path.slice(1, -1);
  if (!path.trim()) throw new Error("目录不能为空 / Path must not be empty");
  if (platform !== "win32" && (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\"))) {
    throw new Error("服务运行在 Linux/macOS，不能直接使用 Windows 路径。WSL 中请使用 /mnt/c/... 等实际挂载路径。");
  }
  const paths = platform === "win32" ? win32 : posix;
  if (path === "~") return home;
  if (/^~[\\/]/.test(path)) return paths.resolve(home, path.slice(2));
  return paths.resolve(base, path);
}
