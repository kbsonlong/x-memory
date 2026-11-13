﻿# 迁移方案

## 1. 输入

- Rewind：`items`、`ocr`、`ocrState`；
- Footprints：`records`、`tombstones`；
- 配置：只迁移非敏感的功能开关；API key、S3 secret 等配置不进入实体迁移。

## 2. 原子性原则

迁移先读取旧 key，转换并校验，再分批写入新 namespace，最后写入 migration marker。任何失败都保留旧 key，并返回包含阶段和错误原因的结果。

## 3. 幂等性

- 帖子 ID 使用 `post:<statusId>`；
- 旧 record 的稳定 ID 作为访问事件 ID 的确定性输入；
- upsert 只补充空字段，不覆盖已有非空数据；
- marker 不是唯一防线，重复运行本身必须安全。

## 4. 回滚

新数据写入失败时不删除旧数据。已经成功迁移的实体可以由 marker 重新校验；正式删除旧 key 必须作为独立、可确认的高危操作，不包含在首次迁移中。

## 5. 验收

迁移测试覆盖空数据、重复运行、坏记录、缺少 status ID、tombstone、字段冲突和写入异常。
