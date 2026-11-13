﻿# 测试与验收

## 已实现的自动化门槛

```sh
npm test
npm run check
```

测试使用 Node 内置 `node:test`，不引入第三方依赖。

## 核心测试

- 实体校验和 ID 规范；
- Repository 按域隔离；
- `postId` 关联时间线和足迹；
- 查询空结果和缺失数据；
- 迁移幂等、坏记录降级和 tombstone；
- 消息输入校验和未知消息；
- AI 输入引用和同步队列契约。

## 尚未完成的实测

- 真实 X 页面和 SPA 导航；
- Chrome MV3 service worker 被回收后的消息可靠性；
- Playwright 浏览器测试；
- 真实 OpenAI-compatible endpoint；
- Cloudflare R2 或其他 S3 的条件写入、ETag 和 CORS；
- 多设备冲突；
- 移动端布局。

这些项目不能以单元测试通过代替。发布报告必须分别列出通过、未执行和阻塞原因。
