import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

test("setup surfaces the server path error and allows retry", async () => {
  const html = await readFile(new URL("../setup.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../setup.js", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "http://127.0.0.1:4173/setup.html", runScripts: "outside-only" });
  try {
    dom.window.fetch = async (_, options) => options?.method === "POST"
      ? { ok: false, status: 400, json: async () => ({ error: "setup_invalid", message: "chapters 目录不存在：/home/player/ftbquests/chapters" }) }
      : { ok: true, json: async () => ({ configPath: "/tmp/config.json" }) };
    dom.window.eval(script);
    await new Promise(resolve => setImmediate(resolve));
    const form = dom.window.document.querySelector("form");
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.match(dom.window.document.querySelector("#setupStatus").textContent, /chapters 目录不存在.*\/home\/player/);
    assert.equal(dom.window.document.querySelector("#setupSubmit").disabled, false);
  } finally { dom.window.close(); }
});
