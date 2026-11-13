﻿# 数据域与实体模型

## 1. 稳定身份

- X status ID 按字符串保存，作为 `postId`；
- 帖子实体 ID 为 `post:<postId>`；
- 访问事件 ID 为 `visit:<deviceId>:<sequence>`，不能用 `postId` 覆盖多次访问；
- AI 产物 ID 由任务、输入 hash 和模型版本决定；
- tombstone ID 等于被删除实体 ID。

`context`、`socialContext`、作者名称和展示文案不是主键。

## 2. 统一实体外壳

```js
{
  id,
  type,
  domain,
  schemaVersion,
  createdAt,
  updatedAt,
  observedAt,
  source: { adapter, deviceId, url },
  subject: { postId, authorId, canonicalUrl },
  payload,
  revision,
  deletedAt
}
```

## 3. 数据域隔离

```text
timeline.posts
timeline.observations
footprints.visit_events
media.assets
ocr.documents
ai.artifacts
sync.operations
```

独立域意味着独立生命周期和权限，不意味着不能通过 `postId` 查询关联。

## 4. 删除语义

删除不立即丢失同步所需信息。先写 tombstone，再由同步层传播。彻底清理由明确的数据生命周期任务执行，并要求用户确认。

## 5. 迁移兼容

旧数据：

```text
items       → post + timeline_observation
records     → visit_event（legacy record id 保留在 provenance）
tombstones  → tombstone
```

迁移使用确定性 ID、版本标记和 upsert。重复执行不能增加实体数量，也不能覆盖新实体的非空字段。
