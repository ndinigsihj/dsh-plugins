/**
 * 宿主代解析与 T1 宿主钉版 / 会话格式断言（票据 01 从 `gates/run.mjs` 拆出）。
 *
 * 宿主钉版（`host.pin`）与会话格式版本（`session.format-version`）两条断言均不可豁免：
 * 宿主或会话格式与清单不符时，闸门必须以环境前置失败（exit 2）退出，而不是拿旧数字当结论。
 */
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { createRuntimeResolution, loadProfile } from "@deepseek-ai/dsh-app-boot";
import { SESSION_FORMAT_VERSION } from "@deepseek-ai/dsh-session";

/** 宿主安装代：包路径、真实路径、版本（resolution 代断言的证据面）。 */
export function hostInfo() {
  const appBoot = createRequire(import.meta.url).resolve("@deepseek-ai/dsh-app-boot/package.json");
  const app = createRequire(appBoot);
  const manifestPath = app.resolve("@deepseek-ai/dsh/package.json");
  return {
    manifestPath,
    realPath: realpathSync(manifestPath),
    version: JSON.parse(readFileSync(manifestPath, "utf8")).version,
  };
}

/** `loadProfile` 的 installAnchor 参数：宿主包自身的位置。 */
export function installAnchor(host) {
  return host.manifestPath;
}

/**
 * T1 第 ⑧ 条：宿主代 + 运行时 `SESSION_FORMAT_VERSION` 与清单一致。
 *
 * 0.1.7 起宿主不再生成 `profiles/node_modules` farm（旧断言没有对应物了）。
 * 这里改为在临时 home 上跑一次 `createRuntimeResolution()`（与 profile boot 同一
 * 解析机制，显式 `home: tempHome` 保持 hermetic），核对解析到的 `@deepseek-ai/dsh`
 * **目录身份**就是安装锚点、版本与清单一致。注意解析表按构造会把安装锚点自己放在
 * 首位，所以这个检查只能证明「闸门组合绑定到锚点这一代 + 解析机制可用」；宿主代的
 * 独立证据面是 PRE 的 `host.cli`（真实 CLI `--version`）与 `host.pin.hostVersion`。
 * @param t 断言收集器（`createAssertions()`）。
 * @returns 报告里的 `host` 块。
 */
export async function appendHostPinAssertions(t, { tempHome, host, manifestObj }) {
  const expectedHost = manifestObj.hostVersion;
  let resolvedVersion;
  let resolvedDir;
  let resolutionError;
  try {
    const profile = loadProfile("dsh", "headless", installAnchor(host), tempHome);
    const resolution = await createRuntimeResolution({
      installAnchor: installAnchor(host),
      profile,
      home: tempHome,
    });
    const entry = resolution.entries.find((candidate) => candidate.name === "@deepseek-ai/dsh");
    resolvedVersion = entry === undefined ? undefined : entry.version;
    resolvedDir = entry === undefined ? undefined : realpathSync(entry.packageDir);
  } catch (error) {
    resolutionError = String(error?.message ?? error);
  }
  const anchorDir = realpathSync(dirname(host.manifestPath));
  const resolutionOk =
    host.version === expectedHost && resolvedVersion === expectedHost && resolvedDir === anchorDir;
  t[resolutionOk ? "pass" : "fail"](
    "host.pin",
    `anchor=${host.version} resolution=${String(resolvedVersion)} expected=${expectedHost}`,
    { resolvedDir, anchorDir, ...(resolutionError === undefined ? {} : { resolutionError }) },
  );
  t[String(SESSION_FORMAT_VERSION) === String(manifestObj.sessionFormatVersion) ? "pass" : "fail"](
    "session.format-version",
    `runtime=${String(SESSION_FORMAT_VERSION)} manifest=${String(manifestObj.sessionFormatVersion)}`,
  );
  return {
    expected: expectedHost,
    installAnchor: { path: host.realPath, version: host.version },
    resolution: { packageDir: resolvedDir, version: resolvedVersion },
  };
}
