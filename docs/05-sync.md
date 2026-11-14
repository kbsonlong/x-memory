# S3 同步

## 当前实现

扩展设置支持 S3 兼容 endpoint、Bucket、Region、Access Key ID、Secret Access Key、可选 Session Token 和对象前缀。点击“立即同步 S3”后，后台用 AWS Signature Version 4 读取并写入 `<prefix>/snapshot.json`。

快照包含版本号、更新时间和所有实体。同步按实体 ID 合并远端与本地数据，再把合并结果写回远端和本地仓库。需要 S3 `GetObject` 和 `PutObject` 权限；缺失对象首次读取应返回 404。浏览器扩展来源还需要在 Bucket CORS 规则中允许 GET 和 PUT，并允许 `Authorization`、`Content-Type` 和 `x-amz-*` 请求头。

## 安全和限制

- 凭据只保存在扩展本地存储，不写进同步快照、实体或日志。
- S3 对象当前未加密。请使用私有 Bucket 和最小权限的专用密钥。
- 当前 v1 使用单个完整 JSON 快照，没有并发写入锁或条件更新；多个设备同时同步时，最后一次写入可能覆盖另一台设备刚上传的变更。建议先手动串行同步。
- 大型数据集会受浏览器存储和单对象大小限制；后续可迁移到分区对象格式。
- 同步失败不会清除本地记录，错误状态会显示在扩展中。
