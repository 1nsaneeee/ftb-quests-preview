const form = document.querySelector("#setupForm");
const submit = document.querySelector("#setupSubmit");
const status = document.querySelector("#setupStatus");
const configPath = document.querySelector("#configPath");
const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
const fields = [...document.querySelectorAll("[data-mode]")];

function currentMode() {
  return form.elements.mode.value;
}

function refreshFields() {
  const mode = currentMode();
  for (const field of fields) field.classList.toggle("hidden", field.dataset.mode !== mode);
}

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

for (const input of modeInputs) input.addEventListener("change", refreshFields);
refreshFields();

async function loadSetup() {
  try {
    const response = await fetch("/api/setup", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
    configPath.textContent = payload.configPath ?? "(unknown)";
    if (payload.current?.source && payload.current.source !== "unconfigured") {
      setStatus(`当前数据源：${payload.current.source}${payload.current.isDemo ? "（demo）" : ""}`);
    }
  } catch (error) {
    setStatus(`无法读取配置：${error.message}`, true);
  }
}

async function waitForRestart() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const response = await fetch("/api/setup", { cache: "no-store" });
      if (!response.ok) continue;
      const payload = await response.json();
      if (payload.needsSetup === false) {
        setStatus("配置已生效，正在打开预览…");
        location.href = "/";
        return;
      }
    } catch {
      // Server is restarting; try again.
    }
  }
  setStatus("配置已保存，但自动重启超时。请关闭终端后重新运行 ftbquest。", true);
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  submit.disabled = true;
  setStatus("正在校验目录并保存配置…");
  const mode = currentMode();
  const body = { mode };
  if (mode === "instance") body.instanceRoot = document.querySelector("#instanceRoot").value.trim();
  if (mode === "data") {
    body.dataDir = document.querySelector("#dataDir").value.trim();
    const instanceRoot = document.querySelector("#dataInstanceRoot").value.trim();
    if (instanceRoot) body.instanceRoot = instanceRoot;
  }
  try {
    const response = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
    setStatus("配置已保存，正在重启预览…");
    await waitForRestart();
  } catch (error) {
    submit.disabled = false;
    setStatus(error.message, true);
  }
});

loadSetup();
