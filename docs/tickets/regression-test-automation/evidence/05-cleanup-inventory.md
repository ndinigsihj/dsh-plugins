# 05 — 清理清单（待确认，尚未执行任何删除）

- 生成时间：2026-09-11 19:31
- 生成方式：对本机真实路径只读盘点（`ls`/`du -sk`/`stat`），未执行任何 `rm`/`mv`
- 依据：`docs/regression-test-automation-plan.md` Q4/Q11、票据 05 第 4 条

## 结论概览

| 范围 | 条数 | 占用 | 处置 |
| --- | --- | --- | --- |
| A. 真实会话根（Q11 明确 50+7） | 57（m4 50 + trajectory 7） | 1952 KB | **建议删除** |
| B1. worker store 镜像 | 29（m4 23 + trajectory 6） | 1012 KB | 待你定（ID 全部 ⊂ A） |
| B2. projection cache 镜像 | 28（m4 27 + trajectory 1） | 224 KB | 待你定（ID 全部 ⊂ A） |
| C. /tmp 本轮临时项 | 22 | 544 KB | **建议删除**（Q11 已定，见备注） |
| D. 不碰：其它 /tmp `dsh-*` 项 | 54 | — | 一律不动 |
| E. 不碰：其它会话目录 | 221（dsh-plugins 项目目录内非探针会话）+ 其它 19 个项目目录 | — | 一律不动 |

## A. 真实会话根 —— 建议删除（57 项）

根：`/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--`

| 会话 ID | 归属前缀 | 大小 | 最后修改 | 路径 |
| --- | --- | --- | --- | --- |
| `session-m4-C1-406c4db5-9913-4877-b47b-76e623317ed4` | m4/C组 | 28 KB | 2026-09-03 20:42 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C1-406c4db5-9913-4877-b47b-76e623317ed4` |
| `session-m4-C2-959990b8-ee7f-46c5-bcf8-ba6ad756baf9` | m4/C组 | 40 KB | 2026-09-03 20:43 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C2-959990b8-ee7f-46c5-bcf8-ba6ad756baf9` |
| `session-m4-C3-3ec784ad-8f6b-4090-bf2e-a6c7da192639` | m4/C组 | 28 KB | 2026-09-03 20:43 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C3-3ec784ad-8f6b-4090-bf2e-a6c7da192639` |
| `session-m4-C4-ba656594-49ba-4224-9de9-6367c789eb40` | m4/C组 | 32 KB | 2026-09-03 20:43 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C4-ba656594-49ba-4224-9de9-6367c789eb40` |
| `session-m4-C5-e6702c23-abda-4991-bc34-53d2e2a19b30` | m4/C组 | 44 KB | 2026-09-03 20:44 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C5-e6702c23-abda-4991-bc34-53d2e2a19b30` |
| `session-m4-C6-6970d998-b355-4e8c-92d9-05b4511c8890` | m4/C组 | 40 KB | 2026-09-03 20:44 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C6-6970d998-b355-4e8c-92d9-05b4511c8890` |
| `session-m4-C7-0e6b35dd-67bb-45bb-bf0f-dc89612b49bb` | m4/C组 | 28 KB | 2026-09-03 20:45 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C7-0e6b35dd-67bb-45bb-bf0f-dc89612b49bb` |
| `session-m4-C8-9785b85f-1e03-41d2-84bf-711f9d6adce3` | m4/C组 | 32 KB | 2026-09-03 20:45 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C8-9785b85f-1e03-41d2-84bf-711f9d6adce3` |
| `session-m4-C9-fae0d4de-e658-4b8c-a025-f3df7b20c33c` | m4/C组 | 32 KB | 2026-09-03 20:45 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C9-fae0d4de-e658-4b8c-a025-f3df7b20c33c` |
| `session-m4-E1-234d187c-04ed-4c6f-b08b-39b206ee0324` | m4/E组 | 48 KB | 2026-09-03 20:24 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E1-234d187c-04ed-4c6f-b08b-39b206ee0324` |
| `session-m4-E1-3086ef93-c703-4d47-9f13-468a5efa7e92` | m4/E组 | 32 KB | 2026-09-10 20:12 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E1-3086ef93-c703-4d47-9f13-468a5efa7e92` |
| `session-m4-E1-4478e2ed-ca11-47e8-a86f-53dc9876547f` | m4/E组 | 32 KB | 2026-09-10 22:38 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E1-4478e2ed-ca11-47e8-a86f-53dc9876547f` |
| `session-m4-E1-92bf66a6-86fb-4ce6-a24a-a1d178828e46` | m4/E组 | 32 KB | 2026-09-10 22:25 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E1-92bf66a6-86fb-4ce6-a24a-a1d178828e46` |
| `session-m4-E1-a60909bc-6e9a-4383-a10b-62b2df3df4b9` | m4/E组 | 36 KB | 2026-09-03 20:25 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E1-a60909bc-6e9a-4383-a10b-62b2df3df4b9` |
| `session-m4-E1-a945758c-f09c-4584-a2da-ce631099ff9d` | m4/E组 | 32 KB | 2026-09-03 22:11 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E1-a945758c-f09c-4584-a2da-ce631099ff9d` |
| `session-m4-E1-e68727a1-79d7-48bb-9a31-43d7bc65e8b8` | m4/E组 | 48 KB | 2026-09-03 20:36 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E1-e68727a1-79d7-48bb-9a31-43d7bc65e8b8` |
| `session-m4-E2-04e2c487-aeb7-47e5-a0b0-af7c117ee55d` | m4/E组 | 28 KB | 2026-09-10 20:12 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E2-04e2c487-aeb7-47e5-a0b0-af7c117ee55d` |
| `session-m4-E2-6c77b86a-d608-4b00-9c5b-71470a4b95b5` | m4/E组 | 32 KB | 2026-09-10 22:39 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E2-6c77b86a-d608-4b00-9c5b-71470a4b95b5` |
| `session-m4-E2-a7537117-c14b-4d91-9117-df31d063511f` | m4/E组 | 40 KB | 2026-09-03 22:11 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E2-a7537117-c14b-4d91-9117-df31d063511f` |
| `session-m4-E2-cdd54f31-1c65-4a79-ab74-e3a93a47f6ad` | m4/E组 | 36 KB | 2026-09-03 20:37 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E2-cdd54f31-1c65-4a79-ab74-e3a93a47f6ad` |
| `session-m4-E2-e7d13435-2121-481b-a65b-8606fc8512b6` | m4/E组 | 36 KB | 2026-09-10 22:25 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E2-e7d13435-2121-481b-a65b-8606fc8512b6` |
| `session-m4-E3-26e79bb8-9037-48de-8f42-8cd23a6e8307` | m4/E组 | 36 KB | 2026-09-10 22:26 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E3-26e79bb8-9037-48de-8f42-8cd23a6e8307` |
| `session-m4-E3-7fb70cb3-0038-4f05-8eda-df1add8bf85f` | m4/E组 | 32 KB | 2026-09-10 20:12 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E3-7fb70cb3-0038-4f05-8eda-df1add8bf85f` |
| `session-m4-E3-ae3f890b-0353-49a9-b3dd-087e3a3357e1` | m4/E组 | 32 KB | 2026-09-03 20:37 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E3-ae3f890b-0353-49a9-b3dd-087e3a3357e1` |
| `session-m4-E3-dd2ed91d-7707-4416-a667-fecef774354a` | m4/E组 | 32 KB | 2026-09-10 22:39 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E3-dd2ed91d-7707-4416-a667-fecef774354a` |
| `session-m4-E3-eb35462b-455e-45db-8b6e-1161b9f2e4ec` | m4/E组 | 28 KB | 2026-09-03 22:11 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E3-eb35462b-455e-45db-8b6e-1161b9f2e4ec` |
| `session-m4-E4-032a75cb-09d3-43d6-bf78-eecbe94378da` | m4/E组 | 32 KB | 2026-09-10 22:40 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E4-032a75cb-09d3-43d6-bf78-eecbe94378da` |
| `session-m4-E4-480ec6b3-1df3-4d92-8cf5-df2d0b3dafbf` | m4/E组 | 32 KB | 2026-09-10 22:26 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E4-480ec6b3-1df3-4d92-8cf5-df2d0b3dafbf` |
| `session-m4-E4-7796ebf1-ee0c-461d-ac29-ca45d9d7139a` | m4/E组 | 40 KB | 2026-09-03 20:37 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E4-7796ebf1-ee0c-461d-ac29-ca45d9d7139a` |
| `session-m4-E4-bef8f1be-2e04-451e-8246-ca9c2cd17b90` | m4/E组 | 36 KB | 2026-09-10 20:13 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E4-bef8f1be-2e04-451e-8246-ca9c2cd17b90` |
| `session-m4-E5-4c40b386-97e9-4bce-ad0f-05970edfbad6` | m4/E组 | 36 KB | 2026-09-10 20:13 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E5-4c40b386-97e9-4bce-ad0f-05970edfbad6` |
| `session-m4-E5-98d65710-dc21-44bd-ae54-cd2c970436cd` | m4/E组 | 52 KB | 2026-09-03 20:37 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E5-98d65710-dc21-44bd-ae54-cd2c970436cd` |
| `session-m4-E5-ae0f0bae-cf52-439a-a154-20c9d79defbd` | m4/E组 | 32 KB | 2026-09-10 22:26 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E5-ae0f0bae-cf52-439a-a154-20c9d79defbd` |
| `session-m4-E5-b3563b6a-be1b-454c-8a47-a8839553cb7e` | m4/E组 | 36 KB | 2026-09-10 22:40 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E5-b3563b6a-be1b-454c-8a47-a8839553cb7e` |
| `session-m4-E6-427c285d-1af5-4a44-a923-3a59f030336e` | m4/E组 | 32 KB | 2026-09-10 22:27 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E6-427c285d-1af5-4a44-a923-3a59f030336e` |
| `session-m4-E6-9e3877fb-068b-4e55-9cdd-b7781faff023` | m4/E组 | 36 KB | 2026-09-03 20:38 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E6-9e3877fb-068b-4e55-9cdd-b7781faff023` |
| `session-m4-E6-c45d6d61-13ac-4a40-9405-c994180c75bb` | m4/E组 | 32 KB | 2026-09-10 20:13 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E6-c45d6d61-13ac-4a40-9405-c994180c75bb` |
| `session-m4-E6-eb281fd8-4793-439c-a6c2-090f6fb3f1a5` | m4/E组 | 48 KB | 2026-09-10 22:40 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E6-eb281fd8-4793-439c-a6c2-090f6fb3f1a5` |
| `session-m4-E7-2e627daf-447c-4117-b140-667507e850d2` | m4/E组 | 32 KB | 2026-09-10 22:41 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E7-2e627daf-447c-4117-b140-667507e850d2` |
| `session-m4-E7-31744241-ce4d-4944-b02c-9080f2704d8f` | m4/E组 | 36 KB | 2026-09-10 22:27 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E7-31744241-ce4d-4944-b02c-9080f2704d8f` |
| `session-m4-E7-b1e26c62-7e77-423f-a7e4-f83a62424700` | m4/E组 | 36 KB | 2026-09-10 20:13 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E7-b1e26c62-7e77-423f-a7e4-f83a62424700` |
| `session-m4-E7-e187edc7-7f90-4439-ae4a-58c87b94767d` | m4/E组 | 40 KB | 2026-09-03 20:38 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E7-e187edc7-7f90-4439-ae4a-58c87b94767d` |
| `session-m4-E8-0a0f07f2-6df4-4794-af2b-6d8c88916a57` | m4/E组 | 36 KB | 2026-09-10 22:41 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E8-0a0f07f2-6df4-4794-af2b-6d8c88916a57` |
| `session-m4-E8-164beb01-626c-44fb-93da-93deb5663790` | m4/E组 | 32 KB | 2026-09-10 20:14 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E8-164beb01-626c-44fb-93da-93deb5663790` |
| `session-m4-E8-39958641-f067-4fd1-bd54-427de15838a4` | m4/E组 | 52 KB | 2026-09-03 20:39 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E8-39958641-f067-4fd1-bd54-427de15838a4` |
| `session-m4-E8-c4ffec98-7fb0-4a31-9195-9de7d6be030b` | m4/E组 | 32 KB | 2026-09-10 22:27 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E8-c4ffec98-7fb0-4a31-9195-9de7d6be030b` |
| `session-m4-E9-1304273c-4ed4-4d5c-a258-ba6e81ab8e0c` | m4/E组 | 36 KB | 2026-09-03 20:39 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E9-1304273c-4ed4-4d5c-a258-ba6e81ab8e0c` |
| `session-m4-E9-53cba33c-e889-482a-b7bf-85f2e628a17c` | m4/E组 | 32 KB | 2026-09-10 22:28 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E9-53cba33c-e889-482a-b7bf-85f2e628a17c` |
| `session-m4-E9-c4b13ca3-394f-49d7-b4c9-3410e3709265` | m4/E组 | 32 KB | 2026-09-10 20:14 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E9-c4b13ca3-394f-49d7-b4c9-3410e3709265` |
| `session-m4-E9-c862a158-9084-4556-9b03-e7214b016b8f` | m4/E组 | 32 KB | 2026-09-10 22:42 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E9-c862a158-9084-4556-9b03-e7214b016b8f` |
| `session-trajectory-04a26e67-f82c-4874-ab07-e9e8dc72ecbc` | trajectory | 24 KB | 2026-09-03 19:42 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-trajectory-04a26e67-f82c-4874-ab07-e9e8dc72ecbc` |
| `session-trajectory-16b771e2-1796-4b43-b836-79fabfc19e78` | trajectory | 24 KB | 2026-09-03 19:41 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-trajectory-16b771e2-1796-4b43-b836-79fabfc19e78` |
| `session-trajectory-259428af-50fd-4624-9bbf-f4cc23f02bc0` | trajectory | 32 KB | 2026-09-10 20:15 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-trajectory-259428af-50fd-4624-9bbf-f4cc23f02bc0` |
| `session-trajectory-40b5e19f-485e-451e-af88-fd7827d39f98` | trajectory | 24 KB | 2026-09-03 19:40 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-trajectory-40b5e19f-485e-451e-af88-fd7827d39f98` |
| `session-trajectory-4322b423-dc9f-4421-80d1-b8af8f82121e` | trajectory | 24 KB | 2026-09-03 19:41 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-trajectory-4322b423-dc9f-4421-80d1-b8af8f82121e` |
| `session-trajectory-620faf9d-58aa-451f-b7b7-8e0943955fa4` | trajectory | 28 KB | 2026-09-03 19:41 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-trajectory-620faf9d-58aa-451f-b7b7-8e0943955fa4` |
| `session-trajectory-e2fbb059-a6e2-4cf2-b75c-0f269a3f3e39` | trajectory | 28 KB | 2026-09-03 19:42 | `/Users/vito/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--/session-trajectory-e2fbb059-a6e2-4cf2-b75c-0f269a3f3e39` |

## B. 同 ID 镜像层 —— 待定（是否一并清理由你决定）

以下条目的会话 ID 与 A 完全同源（worker 29 项 ⊂ A 的 57；cache 28 项 ⊂ A 的 57），
是同批探针会话在 worker store 与 projection cache 中的副本；A 删除后它们成为孤儿缓存。

### B1. worker store（29 项）

根：`/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--`

| 会话 ID | 归属前缀 | 大小 | 最后修改 | 路径 |
| --- | --- | --- | --- | --- |
| `session-m4-C1-406c4db5-9913-4877-b47b-76e623317ed4` | m4/C组 | 28 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C1-406c4db5-9913-4877-b47b-76e623317ed4` |
| `session-m4-C2-959990b8-ee7f-46c5-bcf8-ba6ad756baf9` | m4/C组 | 40 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C2-959990b8-ee7f-46c5-bcf8-ba6ad756baf9` |
| `session-m4-C3-3ec784ad-8f6b-4090-bf2e-a6c7da192639` | m4/C组 | 28 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C3-3ec784ad-8f6b-4090-bf2e-a6c7da192639` |
| `session-m4-C4-ba656594-49ba-4224-9de9-6367c789eb40` | m4/C组 | 32 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C4-ba656594-49ba-4224-9de9-6367c789eb40` |
| `session-m4-C5-e6702c23-abda-4991-bc34-53d2e2a19b30` | m4/C组 | 44 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C5-e6702c23-abda-4991-bc34-53d2e2a19b30` |
| `session-m4-C6-6970d998-b355-4e8c-92d9-05b4511c8890` | m4/C组 | 40 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C6-6970d998-b355-4e8c-92d9-05b4511c8890` |
| `session-m4-C7-0e6b35dd-67bb-45bb-bf0f-dc89612b49bb` | m4/C组 | 28 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C7-0e6b35dd-67bb-45bb-bf0f-dc89612b49bb` |
| `session-m4-C8-9785b85f-1e03-41d2-84bf-711f9d6adce3` | m4/C组 | 32 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C8-9785b85f-1e03-41d2-84bf-711f9d6adce3` |
| `session-m4-C9-fae0d4de-e658-4b8c-a025-f3df7b20c33c` | m4/C组 | 32 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-C9-fae0d4de-e658-4b8c-a025-f3df7b20c33c` |
| `session-m4-E1-234d187c-04ed-4c6f-b08b-39b206ee0324` | m4/E组 | 48 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E1-234d187c-04ed-4c6f-b08b-39b206ee0324` |
| `session-m4-E1-a60909bc-6e9a-4383-a10b-62b2df3df4b9` | m4/E组 | 36 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E1-a60909bc-6e9a-4383-a10b-62b2df3df4b9` |
| `session-m4-E1-a945758c-f09c-4584-a2da-ce631099ff9d` | m4/E组 | 32 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E1-a945758c-f09c-4584-a2da-ce631099ff9d` |
| `session-m4-E1-e68727a1-79d7-48bb-9a31-43d7bc65e8b8` | m4/E组 | 48 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E1-e68727a1-79d7-48bb-9a31-43d7bc65e8b8` |
| `session-m4-E2-a7537117-c14b-4d91-9117-df31d063511f` | m4/E组 | 40 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E2-a7537117-c14b-4d91-9117-df31d063511f` |
| `session-m4-E2-cdd54f31-1c65-4a79-ab74-e3a93a47f6ad` | m4/E组 | 36 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E2-cdd54f31-1c65-4a79-ab74-e3a93a47f6ad` |
| `session-m4-E3-ae3f890b-0353-49a9-b3dd-087e3a3357e1` | m4/E组 | 32 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E3-ae3f890b-0353-49a9-b3dd-087e3a3357e1` |
| `session-m4-E3-eb35462b-455e-45db-8b6e-1161b9f2e4ec` | m4/E组 | 28 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E3-eb35462b-455e-45db-8b6e-1161b9f2e4ec` |
| `session-m4-E4-7796ebf1-ee0c-461d-ac29-ca45d9d7139a` | m4/E组 | 40 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E4-7796ebf1-ee0c-461d-ac29-ca45d9d7139a` |
| `session-m4-E5-98d65710-dc21-44bd-ae54-cd2c970436cd` | m4/E组 | 52 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E5-98d65710-dc21-44bd-ae54-cd2c970436cd` |
| `session-m4-E6-9e3877fb-068b-4e55-9cdd-b7781faff023` | m4/E组 | 36 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E6-9e3877fb-068b-4e55-9cdd-b7781faff023` |
| `session-m4-E7-e187edc7-7f90-4439-ae4a-58c87b94767d` | m4/E组 | 40 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E7-e187edc7-7f90-4439-ae4a-58c87b94767d` |
| `session-m4-E8-39958641-f067-4fd1-bd54-427de15838a4` | m4/E组 | 52 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E8-39958641-f067-4fd1-bd54-427de15838a4` |
| `session-m4-E9-1304273c-4ed4-4d5c-a258-ba6e81ab8e0c` | m4/E组 | 36 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-m4-E9-1304273c-4ed4-4d5c-a258-ba6e81ab8e0c` |
| `session-trajectory-04a26e67-f82c-4874-ab07-e9e8dc72ecbc` | trajectory | 24 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-trajectory-04a26e67-f82c-4874-ab07-e9e8dc72ecbc` |
| `session-trajectory-16b771e2-1796-4b43-b836-79fabfc19e78` | trajectory | 24 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-trajectory-16b771e2-1796-4b43-b836-79fabfc19e78` |
| `session-trajectory-40b5e19f-485e-451e-af88-fd7827d39f98` | trajectory | 24 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-trajectory-40b5e19f-485e-451e-af88-fd7827d39f98` |
| `session-trajectory-4322b423-dc9f-4421-80d1-b8af8f82121e` | trajectory | 24 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-trajectory-4322b423-dc9f-4421-80d1-b8af8f82121e` |
| `session-trajectory-620faf9d-58aa-451f-b7b7-8e0943955fa4` | trajectory | 28 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-trajectory-620faf9d-58aa-451f-b7b7-8e0943955fa4` |
| `session-trajectory-e2fbb059-a6e2-4cf2-b75c-0f269a3f3e39` | trajectory | 28 KB | 2026-09-05 14:24 | `/Users/vito/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--/session-trajectory-e2fbb059-a6e2-4cf2-b75c-0f269a3f3e39` |

### B2. projection cache（28 项）

根：`/Users/vito/.dsh/storages/session_projcache/sessions`

| 会话 ID | 归属前缀 | 大小 | 最后修改 | 路径 |
| --- | --- | --- | --- | --- |
| `session-m4-E1-3086ef93-c703-4d47-9f13-468a5efa7e92` | m4/E组 | 8 KB | 2026-09-10 20:12 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E1-3086ef93-c703-4d47-9f13-468a5efa7e92.json` |
| `session-m4-E1-4478e2ed-ca11-47e8-a86f-53dc9876547f` | m4/E组 | 8 KB | 2026-09-10 22:39 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E1-4478e2ed-ca11-47e8-a86f-53dc9876547f.json` |
| `session-m4-E1-92bf66a6-86fb-4ce6-a24a-a1d178828e46` | m4/E组 | 8 KB | 2026-09-10 22:25 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E1-92bf66a6-86fb-4ce6-a24a-a1d178828e46.json` |
| `session-m4-E2-04e2c487-aeb7-47e5-a0b0-af7c117ee55d` | m4/E组 | 8 KB | 2026-09-10 20:12 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E2-04e2c487-aeb7-47e5-a0b0-af7c117ee55d.json` |
| `session-m4-E2-6c77b86a-d608-4b00-9c5b-71470a4b95b5` | m4/E组 | 8 KB | 2026-09-10 22:39 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E2-6c77b86a-d608-4b00-9c5b-71470a4b95b5.json` |
| `session-m4-E2-e7d13435-2121-481b-a65b-8606fc8512b6` | m4/E组 | 8 KB | 2026-09-10 22:26 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E2-e7d13435-2121-481b-a65b-8606fc8512b6.json` |
| `session-m4-E3-26e79bb8-9037-48de-8f42-8cd23a6e8307` | m4/E组 | 8 KB | 2026-09-10 22:26 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E3-26e79bb8-9037-48de-8f42-8cd23a6e8307.json` |
| `session-m4-E3-7fb70cb3-0038-4f05-8eda-df1add8bf85f` | m4/E组 | 8 KB | 2026-09-10 20:13 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E3-7fb70cb3-0038-4f05-8eda-df1add8bf85f.json` |
| `session-m4-E3-dd2ed91d-7707-4416-a667-fecef774354a` | m4/E组 | 8 KB | 2026-09-10 22:40 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E3-dd2ed91d-7707-4416-a667-fecef774354a.json` |
| `session-m4-E4-032a75cb-09d3-43d6-bf78-eecbe94378da` | m4/E组 | 8 KB | 2026-09-10 22:40 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E4-032a75cb-09d3-43d6-bf78-eecbe94378da.json` |
| `session-m4-E4-480ec6b3-1df3-4d92-8cf5-df2d0b3dafbf` | m4/E组 | 8 KB | 2026-09-10 22:26 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E4-480ec6b3-1df3-4d92-8cf5-df2d0b3dafbf.json` |
| `session-m4-E4-bef8f1be-2e04-451e-8246-ca9c2cd17b90` | m4/E组 | 8 KB | 2026-09-10 20:13 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E4-bef8f1be-2e04-451e-8246-ca9c2cd17b90.json` |
| `session-m4-E5-4c40b386-97e9-4bce-ad0f-05970edfbad6` | m4/E组 | 8 KB | 2026-09-10 20:13 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E5-4c40b386-97e9-4bce-ad0f-05970edfbad6.json` |
| `session-m4-E5-ae0f0bae-cf52-439a-a154-20c9d79defbd` | m4/E组 | 8 KB | 2026-09-10 22:27 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E5-ae0f0bae-cf52-439a-a154-20c9d79defbd.json` |
| `session-m4-E5-b3563b6a-be1b-454c-8a47-a8839553cb7e` | m4/E组 | 8 KB | 2026-09-10 22:40 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E5-b3563b6a-be1b-454c-8a47-a8839553cb7e.json` |
| `session-m4-E6-427c285d-1af5-4a44-a923-3a59f030336e` | m4/E组 | 8 KB | 2026-09-10 22:27 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E6-427c285d-1af5-4a44-a923-3a59f030336e.json` |
| `session-m4-E6-c45d6d61-13ac-4a40-9405-c994180c75bb` | m4/E组 | 8 KB | 2026-09-10 20:13 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E6-c45d6d61-13ac-4a40-9405-c994180c75bb.json` |
| `session-m4-E6-eb281fd8-4793-439c-a6c2-090f6fb3f1a5` | m4/E组 | 8 KB | 2026-09-10 22:41 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E6-eb281fd8-4793-439c-a6c2-090f6fb3f1a5.json` |
| `session-m4-E7-2e627daf-447c-4117-b140-667507e850d2` | m4/E组 | 8 KB | 2026-09-10 22:41 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E7-2e627daf-447c-4117-b140-667507e850d2.json` |
| `session-m4-E7-31744241-ce4d-4944-b02c-9080f2704d8f` | m4/E组 | 8 KB | 2026-09-10 22:27 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E7-31744241-ce4d-4944-b02c-9080f2704d8f.json` |
| `session-m4-E7-b1e26c62-7e77-423f-a7e4-f83a62424700` | m4/E组 | 8 KB | 2026-09-10 20:14 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E7-b1e26c62-7e77-423f-a7e4-f83a62424700.json` |
| `session-m4-E8-0a0f07f2-6df4-4794-af2b-6d8c88916a57` | m4/E组 | 8 KB | 2026-09-10 22:42 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E8-0a0f07f2-6df4-4794-af2b-6d8c88916a57.json` |
| `session-m4-E8-164beb01-626c-44fb-93da-93deb5663790` | m4/E组 | 8 KB | 2026-09-10 20:14 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E8-164beb01-626c-44fb-93da-93deb5663790.json` |
| `session-m4-E8-c4ffec98-7fb0-4a31-9195-9de7d6be030b` | m4/E组 | 8 KB | 2026-09-10 22:28 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E8-c4ffec98-7fb0-4a31-9195-9de7d6be030b.json` |
| `session-m4-E9-53cba33c-e889-482a-b7bf-85f2e628a17c` | m4/E组 | 8 KB | 2026-09-10 22:28 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E9-53cba33c-e889-482a-b7bf-85f2e628a17c.json` |
| `session-m4-E9-c4b13ca3-394f-49d7-b4c9-3410e3709265` | m4/E组 | 8 KB | 2026-09-10 20:14 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E9-c4b13ca3-394f-49d7-b4c9-3410e3709265.json` |
| `session-m4-E9-c862a158-9084-4556-9b03-e7214b016b8f` | m4/E组 | 8 KB | 2026-09-10 22:42 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-m4-E9-c862a158-9084-4556-9b03-e7214b016b8f.json` |
| `session-trajectory-259428af-50fd-4624-9bbf-f4cc23f02bc0` | trajectory | 8 KB | 2026-09-10 20:16 | `/Users/vito/.dsh/storages/session_projcache/sessions/session-trajectory-259428af-50fd-4624-9bbf-f4cc23f02bc0.json` |

## C. /tmp 本轮临时项 —— 建议删除（22 项）

范围按 Q11 `dsh-ticket04…13-*` 实测 22 项（含裸目录 `dsh-ticket11`、`dsh-ticket12`）。

| # | 路径 | 类型 | 大小 | 最后修改 | 归属票 |
| --- | --- | --- | --- | --- | --- |
| 1 | `/tmp/dsh-ticket04-home` | 目录 | 64 KB | 2026-09-10 16:13 | 票据 04 |
| 2 | `/tmp/dsh-ticket04-smoke.txt` | 文件 | 4 KB | 2026-09-10 16:15 | 票据 04 |
| 3 | `/tmp/dsh-ticket04-ws` | 目录 | 4 KB | 2026-09-10 16:13 | 票据 04 |
| 4 | `/tmp/dsh-ticket05-check` | 目录 | 16 KB | 2026-09-10 17:41 | 票据 05 |
| 5 | `/tmp/dsh-ticket05-dump.err` | 文件 | 0 KB | 2026-09-10 17:41 | 票据 05 |
| 6 | `/tmp/dsh-ticket05-dump.yml` | 文件 | 16 KB | 2026-09-10 17:41 | 票据 05 |
| 7 | `/tmp/dsh-ticket09-dump-init.err` | 文件 | 0 KB | 2026-09-10 22:10 | 票据 09 |
| 8 | `/tmp/dsh-ticket09-dump-init.yml` | 文件 | 12 KB | 2026-09-10 22:10 | 票据 09 |
| 9 | `/tmp/dsh-ticket09-home` | 目录 | 52 KB | 2026-09-10 22:10 | 票据 09 |
| 10 | `/tmp/dsh-ticket09-ws` | 目录 | 8 KB | 2026-09-10 22:10 | 票据 09 |
| 11 | `/tmp/dsh-ticket11` | 目录 | 128 KB | 2026-09-11 11:36 | 票据 11 |
| 12 | `/tmp/dsh-ticket11-backup` | 目录 | 12 KB | 2026-09-10 23:36 | 票据 11 |
| 13 | `/tmp/dsh-ticket11-final-tui-dev.dump.yml` | 文件 | 16 KB | 2026-09-10 23:50 | 票据 11 |
| 14 | `/tmp/dsh-ticket11-headless.dump.err` | 文件 | 0 KB | 2026-09-10 23:39 | 票据 11 |
| 15 | `/tmp/dsh-ticket11-headless.dump.yml` | 文件 | 12 KB | 2026-09-10 23:39 | 票据 11 |
| 16 | `/tmp/dsh-ticket11-probe.dump.err` | 文件 | 0 KB | 2026-09-10 23:44 | 票据 11 |
| 17 | `/tmp/dsh-ticket11-probe.dump.yml` | 文件 | 16 KB | 2026-09-10 23:44 | 票据 11 |
| 18 | `/tmp/dsh-ticket11-smoke.txt` | 文件 | 4 KB | 2026-09-10 23:39 | 票据 11 |
| 19 | `/tmp/dsh-ticket11-tui-dev.dump.err` | 文件 | 0 KB | 2026-09-10 23:38 | 票据 11 |
| 20 | `/tmp/dsh-ticket11-tui-dev.dump.yml` | 文件 | 16 KB | 2026-09-10 23:38 | 票据 11 |
| 21 | `/tmp/dsh-ticket12` | 目录 | 152 KB | 2026-09-11 14:22 | 票据 12 |
| 22 | `/tmp/dsh-ticket13-seeded-preview` | 目录 | 12 KB | 2026-09-11 15:54 | 票据 13 |

### C 备注：被已完成票据 evidence 引用的情况

- `dsh-ticket11`、`dsh-ticket11-backup`、`dsh-ticket12`：
  `docs/tickets/dsh-v0.1.5-rc.1-upgrade/evidence/11-subagent-model-selection.md`、`12-allowed-route-verification.md`
  以路径方式引用其中文件（settings 副本、patch .orig、route-probe.json、探针会话）。删除后这些引用不可复现，
  但结论与 sha256 已写在 evidence 里；如需保留原始素材请点名。
- `dsh-ticket04-*`、`dsh-ticket09-*`：对应 evidence 文档中的复现命令使用这些路径，结论已固化入库。
- `dsh-ticket13-seeded-preview`：seeded 预览探针的隔离 home，fixture 已快照入 `experiments/fixtures/session-preview-seeded/`。

## 范围外发现（本票不碰，仅记录）

盘点时顺带发现的其它探针残留，均不在 Q11 授权范围内：

| 发现 | 位置 | 条数 | 说明 |
| --- | --- | --- | --- |
| `session-smoke-*` | `~/.dsh/sessions/--Users-vito-data-dev-dsh-tui--/` 及其 worker 镜像 | 6 + 6 | 属 **另一个项目目录**（dsh-tui），Q11 明确「其余会话目录不碰」 |
| `session-ticket11-*` / `session-ticket12-*` | 仅 `~/.dsh/storages/session_projcache/sessions/` | 6 + 3 | 会话本体在 C 组的 `/tmp/dsh-ticket11|12`（隔离 root）；C 删除后成孤儿缓存。来源 `experiments/subagent-model-selection/{probe,route-probe}.mjs`，即票据 01 evidence 提过的「projection cache 写真实 `~/.dsh/storages`」泄漏面 |
| `session-model-hot-switch-*` | — | 0 | 真实 store 中未发现（`experiments/model-hot-switch-live-spike.mjs:78` 定义的会话未落盘或已清） |
| 随机 UUID 会话 | dsh-plugins 项目目录 | 165 | 无法按前缀证明归属探针；按票面「只清可证明前缀」原则不动 |

## 拟执行命令（**待你确认后才运行**，本文件生成时未执行）

```sh
# A. 真实会话根 57 项（仅限两个前缀，逐条列出，不用目录级通配）
cd ~/.dsh/sessions/--Users-vito-data-dev-dsh-plugins--
rm -rf session-m4-C{1..9}-* session-m4-E{1..9}-* session-trajectory-*
# 精确写法：按清单逐条 rm -rf <上表 A 的 57 个路径>

# B（若确认一并清理）
cd ~/.dsh/worker/sessions/--Users-vito-data-dev-dsh-plugins--
rm -rf session-m4-* session-trajectory-*          # 29 项，全部 ⊂ A
cd ~/.dsh/storages/session_projcache/sessions
rm -f session-m4-*.json session-trajectory-*.json # 28 项，全部 ⊂ A

# C. /tmp 22 项
cd /tmp && rm -rf dsh-ticket04-* dsh-ticket05-* dsh-ticket09-* dsh-ticket11 dsh-ticket11-* dsh-ticket12 dsh-ticket12-* dsh-ticket13-*
```

## 删除后验证

1. `ls ~/.dsh/sessions/--Users-vito-data-dev-dsh-plugins-- | grep -c '^session-m4-\|^session-trajectory-'` → 0
2. 上述目录条目总数 = 清理前 221（非探针数不变）
3. `ls ~/.dsh/sessions | wc -l` 与清理前一致（20）
4. `ls /tmp | grep -c '^dsh-ticket'` → 0；`ls /tmp | grep -c '^dsh-'` = 54（其它前缀未动）
5. 本清单与实际删除条数逐条对账，差异写入 evidence/05

