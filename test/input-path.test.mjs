import test from "node:test";
import assert from "node:assert/strict";
import { resolveInputPath } from "../server/input-path.mjs";

test("web and CLI paths accept quoted spaces and a home shorthand on Linux", () => {
  const options = { platform: "linux", home: "/home/player" };
  assert.equal(resolveInputPath(' "~/Mod Packs/quests" ', "/tmp", options), "/home/player/Mod Packs/quests");
  assert.equal(resolveInputPath("'relative path'", "/home/player", options), "/home/player/relative path");
  assert.equal(resolveInputPath("/mnt/e/pack/quests", "/tmp", options), "/mnt/e/pack/quests");
  assert.throws(() => resolveInputPath("E:\\pack\\quests", "/tmp", options), /WSL.*\/mnt\/c/);
  assert.throws(() => resolveInputPath('""', "/tmp", options), /empty/);
});

test("Windows native paths and UNC paths retain their native meaning", () => {
  const options = { platform: "win32", home: "C:\\Users\\Player" };
  assert.equal(resolveInputPath('"E:\\Mod Packs\\quests"', "C:\\tmp", options), "E:\\Mod Packs\\quests");
  assert.equal(resolveInputPath("~/quests", "C:\\tmp", options), "C:\\Users\\Player\\quests");
  assert.equal(resolveInputPath("\\\\server\\share\\quests", "C:\\tmp", options), "\\\\server\\share\\quests");
});
