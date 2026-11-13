﻿# Agent Gateway 协议

Agent 只通过产品级只读协议访问 X Memory，不读取 storage key、S3 object 或扩展内部数组。

## 方法

```text
memory.search
memory.get
memory.related
memory.context
memory.ai
memory.sync.status
```

## 示例

```json
{
  "method": "memory.search",
  "params": {
    "query": "关于广州教育的帖子",
    "domains": ["timeline", "footprints"],
    "from": "2026-11-01",
    "to": "2026-11-13",
    "limit": 50
  }
}
```

返回值必须包含实体 ID、数据域、采集时间和原始 URL。足迹属于更高隐私等级，默认需要单独授权。Agent 不得取得 API key、同步密钥或未授权的原始访问事件。

第一阶段只定义本地 Query Service 的等价方法，不开放网络监听端口，不默认允许外部 Agent 连接。
