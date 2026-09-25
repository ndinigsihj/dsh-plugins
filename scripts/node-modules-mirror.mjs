/**
 * 隔离 profile 的 node_modules 镜像（票据 07 抽出；票 12 修 scope 链接回写）。
 *
 * render-real / 冒烟会把真实 profile 的 `node_modules` 以符号链接接进临时 profile；
 * 装载 preset bundle 前必须把它物化成临时目录，否则写入会穿过链接落回真实 profile。
 *
 * 关键：**scope 目录（`@scope`）必须建成真目录**、只链接其子条目。若把 `@scope`
 * 整目录链接回真实树，后续 `node_modules/@scope/pkg` 的移除/创建会穿过链接写到
 * 真实 profile——2026-09-25 票 12 实测到真实部署位链接被改写成临时路径并悬空。
 */
import { lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** node_modules 是符号链接时就地物化成真目录；已是真目录则不动。 */
export function materializeNodeModules(nodeModules) {
  // lstat：statSync 会跟随链接，isSymbolicLink() 永远为 false，会把 @scope 目录
  // 直接 mkdir 进链接目标（真实 profile 的 node_modules）——渲染副本必须零写入源。
  if (!lstatSync(nodeModules).isSymbolicLink()) return;
  const source = resolve(dirname(nodeModules), readlinkSync(nodeModules));
  const entries = readdirSync(source);
  rmSync(nodeModules, { recursive: true, force: true });
  mkdirSync(nodeModules, { recursive: true });
  for (const entry of entries) {
    const from = join(source, entry);
    if (statSync(from).isDirectory()) {
      mkdirSync(join(nodeModules, entry), { recursive: true });
      for (const child of readdirSync(from)) symlinkSync(join(from, child), join(nodeModules, entry, child));
    } else {
      symlinkSync(from, join(nodeModules, entry));
    }
  }
}
