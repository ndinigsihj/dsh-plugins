/**
 * plugin-teardown — 自研插件的注销纪律（票据 06）。
 *
 * 0.1.7 的 `ctx.tools.register()` 把注销句柄挂在 ToolRuntime 自己的 root ctx 上，
 * 不随注册插件的 fiber 释放：每个自研插件都必须把注销收进自己的 fiber
 * （`ctx.effect`），否则运行时卸载后会留下残留工具/影子注册。注销失败不得让插件
 * 卸载失败，也不得中断同一轮的其他注销——`disposeSafely()` 是三个插件共用的唯一
 * 失败姿态；phase-swap-bash 的 compaction 注销与卸载注销也共用它。
 */

/** Dispose one plugin-owned registration. Never throws: teardown must not fail unload. */
export function disposeSafely(dispose) {
  if (typeof dispose !== 'function') return
  try {
    dispose()
  } catch {
    // A failed disposal must not break plugin unload or the next cleanup step.
  }
}
