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
- 时间线帖子、观察事件和访问事件按 `postId` 合并为单条卡片，访问过的帖子显示访问标识；
- OpenAI 兼容 API 的每日知识日报，分别归纳时间线与访问内容，并基于证据推测兴趣方向；
- 手动 S3 兼容对象存储同步，支持配置 endpoint、Bucket、Region 和访问凭据。
- 每日知识日报定时生成，可推送至通用 Webhook 和 Telegram Bot；
- 导出完整 JSON 数据快照或帖子 CSV。

AI 和 S3 服务由用户在扩展设置中配置。AI Key 和 S3 凭据只保存在扩展本地存储中；帖子正文会发送给配置的 AI 服务，S3 同步会上传本地实体快照。S3 快照当前使用单个 JSON 对象，远端对象未加密；需为 Bucket 配置允许扩展来源执行 GET 和 PUT 的 CORS 规则。

定时日报和推送在扩展设置中配置，按浏览器本地时间每日运行；浏览器需要保持打开。通用 Webhook 接收包含日报、日期和统计数据的 JSON POST 请求。Telegram 需要 Bot Token 和 Chat ID；密钥保存在扩展本地设置中。设置页可下载包含所有实体域的 JSON 备份，或下载按帖子合并的 CSV。

## 快速验证

```sh
npm test
npm run check
npm run build:extensions
```

`npm run build:extensions` 会生成：

- `build/chrome/x-memory-chrome.zip`：Chrome MV3 发布包。Chrome 开发调试仍可直接加载项目根目录 `/Volumes/nfs/src/x-memory`；
- `build/safari/X-Memory.app`：macOS Safari Web Extension App；
- `build/safari/X-Memory-macos-safari.zip`：macOS Safari App 压缩包；
- `build/safari-project/X Memory/X Memory.xcodeproj`：Safari 的 Xcode 工程。

构建默认使用 `CODE_SIGNING_ALLOWED=NO`，用于验证编译和嵌入扩展结构。安装到 Safari 或分发前，需要在 Xcode 中选择有效的 Apple Development/Distribution signing identity。项目中 `apps/extension/manifest.json` 是早期源码参考；Chrome 发布包只使用根目录 `manifest.json`，避免两个扩展根目录产生歧义。

在 Chrome 中加载项目根目录 `/Volumes/nfs/src/x-memory` 作为 unpacked extension。根目录的 `manifest.json` 指向 `apps/extension`，这样 service worker 可以使用同一项目内的 `src` 模块。点击扩展图标会打开 X Memory popup；如果此前已经加载过旧版本，需要在 `chrome://extensions` 点击 Reload，或移除后重新加载包含 `manifest.json` 的解压目录。

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
