﻿# 全局同步设计

## 1. 目标

Sync Engine 统一处理所有数据域的本地变更队列、远端读写、游标、重试、冲突、tombstone 和状态展示。UI 不直接访问 S3。

## 2. 远端分区

```text
manifest.json
collections/posts/<chunk>.jsonl
collections/timeline_observations/<chunk>.jsonl
collections/visit_events/<chunk>.jsonl
tombstones/<domain>/<chunk>.jsonl
media/<sha256>
ai_artifacts/<hash>.json
```

不能把时间线、足迹和删除标记压成一个无版本的大对象作为最终格式。现有 Footprints 对象格式只作为迁移输入。

## 3. 冲突策略

- `post`：非空字段合并，内容按来源时间和 revision 选择；
- `timeline_observation`：追加并按 observation ID 去重；
- `visit_event`：追加并按事件 ID 去重；
- `tombstone`：删除优先，除非有更晚的合法恢复操作；
- `ai_artifact`：输入 hash 不变可复用，模型变化允许并存；
- 配置：明确的 last-write-wins。

## 4. 状态机

```text
queued → uploading → acknowledged
queued → failed → retrying → uploading
queued → cancelled
```

同步失败只改变同步状态，不删除本地实体。自动同步由 alarm 或后台队列触发，不由卡片渲染触发。

## 5. 凭据和隐私

密钥不得进入实体、日志或远端同步对象。远端未加密时必须明确提示用户；未来可以在 Sync Adapter 层加入客户端加密，但不能在未实现时宣称加密。
