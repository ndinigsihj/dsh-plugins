/**
 * custom-bash 纯函数契约测试（darwin/CI 可跑，不依赖真实 Windows）。
 *
 * 覆盖文档 §2.5：windowsBashCandidates 排序/dedupe、WSL launcher 拒绝、
 * resolveShimTarget、bashCandidatesFromGit、resolveWindowsBash 跳过 WSL。
 *
 * 运行：node --test presets/minimal-plus/custom-bash.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

/** 待测自研插件；Phase 2.5 时文件尚不存在 → 本文件先红。 */
const {
  windowsBashCandidates,
  isWindowsSubsystemLauncher,
  resolveShimTarget,
  bashCandidatesFromGit,
  resolveWindowsBash,
} = await import("./custom-bash.mjs");

const WIN_ENV = {
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
  LOCALAPPDATA: "C:\\Users\\vito\\AppData\\Local",
  SCOOP: undefined,
  USERPROFILE: "C:\\Users\\vito",
};

test("windowsBashCandidates：显式配置/环境变量优先且唯一", () => {
  const env = { ...WIN_ENV };
  assert.deepEqual(windowsBashCandidates({ bashPath: "C:\\Git\\bin\\bash.exe" }, env), ["C:\\Git\\bin\\bash.exe"]);
  assert.deepEqual(windowsBashCandidates({}, { ...env, DSH_TUI_LIANGSHEN_BASH_PATH: "C:\\Explicit\\bash.exe" }), ["C:\\Explicit\\bash.exe"]);
  // config.bashPath 优先于环境变量
  assert.deepEqual(
    windowsBashCandidates({ bashPath: "C:\\Config\\bash.exe" }, { ...env, DSH_TUI_LIANGSHEN_BASH_PATH: "C:\\Env\\bash.exe" }),
    ["C:\\Config\\bash.exe"],
  );
});

test("windowsBashCandidates：常规根 + Scoop 根 + PATH 裸 bash，顺序固定且去重", () => {
  const candidates = windowsBashCandidates({}, WIN_ENV);
  assert.deepEqual(candidates, [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe",
    "C:\\Users\\vito\\AppData\\Local\\Programs\\Git\\bin\\bash.exe",
    "C:\\Users\\vito\\AppData\\Local\\Programs\\Git\\usr\\bin\\bash.exe",
    "C:\\Users\\vito\\scoop\\apps\\git\\current\\bin\\bash.exe",
    "C:\\Users\\vito\\scoop\\apps\\git\\current\\usr\\bin\\bash.exe",
    "bash",
  ]);
});

test("windowsBashCandidates：SCOOP 显式根 + 默认根都追加 + 大小写去重", () => {
  const env = {
    ...WIN_ENV,
    ProgramFiles: "C:\\PF",
    "ProgramFiles(x86)": "C:\\PF",
    SCOOP: "D:\\scoop",
  };
  const candidates = windowsBashCandidates({}, env);
  // C:\\PF 的 bin/usr 只出现一次；SCOOP 显式根与 USERPROFILE 默认根都追加
  assert.deepEqual(candidates, [
    "C:\\PF\\Git\\bin\\bash.exe",
    "C:\\PF\\Git\\usr\\bin\\bash.exe",
    "C:\\Users\\vito\\AppData\\Local\\Programs\\Git\\bin\\bash.exe",
    "C:\\Users\\vito\\AppData\\Local\\Programs\\Git\\usr\\bin\\bash.exe",
    "D:\\scoop\\apps\\git\\current\\bin\\bash.exe",
    "D:\\scoop\\apps\\git\\current\\usr\\bin\\bash.exe",
    "C:\\Users\\vito\\scoop\\apps\\git\\current\\bin\\bash.exe",
    "C:\\Users\\vito\\scoop\\apps\\git\\current\\usr\\bin\\bash.exe",
    "bash",
  ]);
});

test("isWindowsSubsystemLauncher：System32/Sysnative bash.exe 恒拒绝", () => {
  assert.equal(isWindowsSubsystemLauncher("C:\\Windows\\System32\\bash.exe"), true);
  assert.equal(isWindowsSubsystemLauncher("C:\\Windows\\Sysnative\\bash.exe"), true);
  assert.equal(isWindowsSubsystemLauncher("c:\\windows\\system32\\bash.exe"), true);
  assert.equal(isWindowsSubsystemLauncher("/mnt/c/Windows/System32/bash.exe"), true);
  assert.equal(isWindowsSubsystemLauncher("C:\\Program Files\\Git\\bin\\bash.exe"), false);
  assert.equal(isWindowsSubsystemLauncher("C:\\Git\\usr\\bin\\bash.exe"), false);
  assert.equal(isWindowsSubsystemLauncher("bash"), false);
});

test("resolveShimTarget：跟随 .shim 侧车；无侧车原样返回", () => {
  const fakeReader = (path) => {
    if (path.endsWith(".shim")) return 'path = "C:\\Real\\git.exe"\n';
    throw new Error("ENOENT");
  };
  assert.equal(resolveShimTarget("D:\\scoop\\shims\\git.exe", fakeReader), "C:\\Real\\git.exe");
  assert.equal(resolveShimTarget("C:\\Program Files\\Git\\cmd\\git.exe", () => { throw new Error("ENOENT"); }), "C:\\Program Files\\Git\\cmd\\git.exe");
  // `git.exe.shim` 变体也跟随
  const reader2 = (path) => {
    if (path.endsWith("git.exe.shim")) return 'path = "C:\\Other\\git.exe"\n';
    throw new Error("ENOENT");
  };
  assert.equal(resolveShimTarget("C:\\bin\\git.exe", reader2), "C:\\Other\\git.exe");
});

test("bashCandidatesFromGit：cmd/bin/mingw 布局推导", () => {
  assert.deepEqual(bashCandidatesFromGit("C:\\Program Files\\Git\\cmd\\git.exe"), [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  ]);
  assert.deepEqual(bashCandidatesFromGit("C:\\Program Files\\Git\\bin\\git.exe"), [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  ]);
  // mingw64/bin/git.exe 先给 mingw64 根，再给真实根（逐字复刻 vendor 顺序）
  assert.deepEqual(bashCandidatesFromGit("C:\\Program Files\\Git\\mingw64\\bin\\git.exe"), [
    "C:\\Program Files\\Git\\mingw64\\bin\\bash.exe",
    "C:\\Program Files\\Git\\mingw64\\usr\\bin\\bash.exe",
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  ]);
  assert.deepEqual(bashCandidatesFromGit("C:\\tools\\git.exe"), [
    "C:\\bin\\bash.exe",
    "C:\\usr\\bin\\bash.exe",
  ]);
  assert.deepEqual(bashCandidatesFromGit(""), []);
});

test("resolveWindowsBash：显式路径按原样返回；WSL 候选被跳过", async () => {
  // 显式路径：即使 git 解析失败也只试显式
  const subprocess = {
    async resolveExecutable(path) {
      if (path === "C:\\Git\\bin\\bash.exe") return "C:\\Git\\bin\\bash.exe";
      throw new Error(`unknown ${path}`);
    },
  };
  const explicit = await resolveWindowsBash(subprocess, { bashPath: "C:\\Git\\bin\\bash.exe" }, {});
  assert.equal(explicit, "C:\\Git\\bin\\bash.exe");

  // 候选含 WSL 时跳过，返回后续真实 Git Bash
  const subprocess2 = {
    async resolveExecutable(path) {
      if (path === "git") return "C:\\Program Files\\Git\\cmd\\git.exe";
      if (isWindowsSubsystemLauncher(path)) return path;
      return path;
    },
  };
  const env = { ProgramFiles: "C:\\Program Files" };
  const resolved = await resolveWindowsBash(subprocess2, {}, env);
  assert.equal(resolved, "C:\\Program Files\\Git\\bin\\bash.exe");
});

test("resolveWindowsBash：全部候选不可用 → throw（fail-loud）", async () => {
  const subprocess = {
    async resolveExecutable(path) {
      if (path === "git") throw new Error("no git");
      throw new Error("no bash");
    },
  };
  await assert.rejects(
    () => resolveWindowsBash(subprocess, {}, { ProgramFiles: "C:\\Program Files" }),
    /Git Bash executable unavailable/,
  );
});