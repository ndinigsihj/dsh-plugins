/**
 * 宿主代解析与 T1 宿主钉版 / 会话格式断言（票据 01 从 `gates/run.mjs` 拆出）。
 *
 * 宿主钉版（`host.pin`）与会话格式版本（`session.format-version`）两条断言均不可豁免：
 * 宿主或会话格式与清单不符时，闸门必须以环境前置失败（exit 2）退出，而不是拿旧数字当结论。
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { SESSION_FORMAT_VERSION } from "@deepseek-ai/dsh-session";

/** 宿主安装代：包路径、真实路径、版本（farm 代断言的证据面）。 */
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
 * T1 第 ⑧ 条：临时 farm 解析到的宿主代 + 运行时 `SESSION_FORMAT_VERSION` 与清单一致。
 * @param t 断言收集器（`createAssertions()`）。
 * @returns 报告里的 `host` 块。
 */
export function appendHostPinAssertions(t, { tempHome, host, manifestObj }) {
  const farmManifest = join(tempHome, "profiles", "node_modules", "@deepseek-ai", "dsh", "package.json");
  const farmVersion = existsSync(farmManifest) ? JSON.parse(readFileSync(farmManifest, "utf8")).version : undefined;
  const expectedHost = manifestObj.hostVersion;
  const farmOk = host.version === expectedHost && farmVersion === expectedHost;
  t[farmOk ? "pass" : "fail"](
    "host.pin",
    `anchor=${host.version} farm=${String(farmVersion)} expected=${expectedHost}`,
    { farmManifest },
  );
  t[String(SESSION_FORMAT_VERSION) === String(manifestObj.sessionFormatVersion) ? "pass" : "fail"](
    "session.format-version",
    `runtime=${String(SESSION_FORMAT_VERSION)} manifest=${String(manifestObj.sessionFormatVersion)}`,
  );
  return {
    expected: expectedHost,
    installAnchor: { path: host.realPath, version: host.version },
    farm: { path: farmManifest, version: farmVersion, healed: farmVersion !== undefined },
  };
}
