﻿# X Memory 架构

## 1. 运行结构

```text
X 页面
  ├─ timeline content adapter ─┐
  └─ detail footprint adapter ─┤
                                v
                         MV3 service worker
                                ├─ Repository
                                ├─ Query Service
                                ├─ AI Orchestrator
                                ├─ Sync Engine
                                └─ Permission / Redaction
                                v
                     chrome.storage.local / remote adapter
```

UI、content script 和 Agent 只能调用 service worker 的命名空间消息或产品 API，不直接读存储和远端。

## 2. 模块职责

### Timeline Adapter

从 `article[data-testid="tweet"]` 提取时间线帖子，写入 `post` 和 `timeline_observation`。它不查询 S3，也不调用 AI。

### Footprint Adapter

在详情页提取当前 status ID 和访问时间，写入 `visit_event`。它不负责生成日报或执行同步。

### Repository

提供实体级的 `put`、`get`、`list`、`delete` 和快照导出。生产环境使用独立的 storage namespace；测试可以注入内存存储。

### Query Service

组合多个数据域的只读结果。`getRelated({postId})` 是历史栏的稳定契约。

### AI Orchestrator

接受实体引用，执行权限检查、脱敏、上下文组装、缓存和模型调用。当前只定义接口，不自动调用外部服务。

### Sync Engine

管理变更队列、游标、重试、tombstone、冲突和状态。数据域提供 merge policy。当前垂直切片只实现本地队列契约，不访问真实 S3。

## 3. 消息命名空间

```text
memory.query.related
memory.query.search
memory.ai.run
memory.sync.status
rewind.capture
footprints.upsert
```

消息处理器必须校验输入，未知消息返回结构化错误，不抛出未处理异常。

## 4. 故障隔离

- 采集失败不清空既有数据；
- 足迹查询失败不阻塞时间线主体；
- AI 失败返回可展示的错误状态；
- 同步失败保留本地数据和待处理操作；
- 迁移失败保留旧 key。
