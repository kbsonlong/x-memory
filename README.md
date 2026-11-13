# X Memory

X Memory 是一个本地优先的 X 内容记忆产品。它把时间线历史和访问足迹作为独立数据域，把查询、搜索、AI、同步、权限和 Agent 接口实现为全局能力。

## 当前实现

当前版本完成第一条可验证垂直链路：

- 统一实体外壳和 `post`、`timeline_observation`、`visit_event`、`tombstone` 模型；
- 独立数据域存储，不把时间线和足迹合并为一个数组；
- Repository 统一读写入口；
- Query Service 跨域按 `postId` 关联时间线和足迹；
- MV3 service worker 消息入口：`memory.query.related`、`rewind.capture`、`footprints.upsert`；
- 兼容迁移函数：从旧 `items`、`records`、`tombstones` 生成新实体；
- 全局 AI、同步接口的产品级契约和安全边界文档。

AI 和远端同步目前只完成接口与本地状态契约，未宣称已经连接真实模型或 S3。

## 快速验证

```sh
npm test
npm run check
```

在 Chrome 中加载项目根目录 `/Volumes/nfs/src/x-memory` 作为 unpacked extension。根目录的 `manifest.json` 指向 `apps/extension`，这样 service worker 可以使用同一项目内的 `src` 模块。

## 目录

```text
apps/extension/      MV3 manifest 和统一 service worker
src/                 schema、repository、query、migration、AI、sync
 test/               Node 内置测试
 docs/               产品和架构设计
```

## 设计原则

1. 全局能力统一流程和协议，数据域保留自己的语义、生命周期和冲突策略。
2. `postId` 是跨域关联键；事件实体使用自己的稳定 ID。
3. UI 和 content script 不直接访问本地存储、AI endpoint 或 S3。
4. 远端失败不能阻塞本地回看。
5. 迁移可重复执行，不删除旧数据，不覆盖已有新实体。

## 基线

设计依据：

- `rewind-for-x` `4122793d28bd7da0768553d1350bd5dcf38c978c`
- `x-footprints` `2b205e1a5d9992058611d818e8cb19dd668a3b6`

两个基线仓库保持原样，可随时对照或回退。
