# 03 — 组合分叉与 persona 字段迁移

**What to build:** 开发侧拥有自己的组合配置，其 persona 正文改用新宿主的前缀字段，因此新宿主的字段变化不再牵制稳定侧。稳定侧组合在字段与行为上保持完全不变。

**Blocked by:** 02 — 宿主升级与依赖方处置

**Status:** done — 2026-09-10

**Evidence:** `evidence/03-composition-fork-persona.md`

- [x] 开发侧组合以独立标识存在，可被 profile 引用
- [x] 组合内的 persona 正文改用前缀字段
- [x] 宿主级部署 persona 配置改用前缀与后缀两个字段（核实：宿主层由 base 自带迁移、我侧无覆盖）
- [x] 稳定侧组合文件未被修改
- [x] 稳定 profile 仍指向原组合标识
- [x] 开发侧 profile 的默认组合标识已切换
