# X Memory 打包与分发指南

> 更新于 2026-11-16 · 针对"暂无开发者账号"场景

结论先行：**不注册任何开发者账号也能立即分发使用**，方式是"加载已解压的扩展"；若要上架商店面向公众，Chrome 需一次性 $5，Edge 与 Firefox 免费，Safari（Mac App Store）需每年 $99。

---

## 1. 先打包

```sh
npm run build:chrome
```

产出两个文件，覆盖两种用途：

| 产物 | 用途 |
|------|------|
| `build/chrome/unpacked/` | 本地加载、内测分发 —— 直接给这个目录 |
| `build/chrome/x-memory-chrome.zip` | 上传商店 —— manifest 在压缩包根目录，符合商店要求 |

该命令**不需要 Xcode、不需要签名、不需要开发者账号**。
（项目原有的 `npm run build:extensions` 还会额外构建 Safari App，依赖 macOS + Xcode。）

> 分发前请把 `manifest.json` 里的 `"name": "X Memory (Development)"` 改成正式名称 `"X Memory"`，并补充图标、版本与描述。

---

## 2. 无账号分发（立即可用）

### 2.1 自己或技术型用户：加载已解压目录 ★推荐

1. 浏览器地址栏输入 `chrome://extensions`（Edge 为 `edge://extensions`）；
2. 打开右上角 **开发者模式**；
3. 点击 **加载已解压的扩展程序**，选中 `build/chrome/unpacked/` 目录。

- 优点：零成本、零账号、即时生效，可反复加载更新。
- 缺点：浏览器会常驻"开发者模式"并弹安全提示；每次代码更新需手动点扩展卡片的刷新按钮；普通用户操作门槛较高。
- 分发方式：把 `unpacked/` 压缩发给对方，对方解压后按上面三步加载。**不要依赖第三方站点直接安装 `.crx`** —— 新版 Chrome（约 111+ 起持续收紧）已基本封堵外部 CRX 静默安装，会提示"此扩展程序未列在 Chrome 应用商店中"而拒绝安装。

### 2.2 小范围团队：浏览器企业策略静默部署

若对方使用企业版 Chrome/Edge，可通过 `ExtensionInstallForcelist` 策略强制安装并自动更新。这需要自托管扩展与更新清单（`update_url`），属于零账号但需运维能力的方案，适合公司/实验室内部。

> 对本项目这种"记录 X 浏览足迹 + 调用 AI + 上传 S3"的隐私敏感扩展，小范围可信分发比公开上架更现实。

---

## 3. 商店分发（对比一览）

| 商店 | 账号成本 | 审核 | 对本项目的适配 |
|------|----------|------|----------------|
| **Microsoft Edge Add-ons** | **免费**（微软合作伙伴中心注册） | 有，通常数天至数周 | ★最直接：Chromium 扩展几乎零改动，`x-memory-chrome.zip` 可直接上传 |
| **Mozilla Firefox (AMO)** | **免费**（Firefox 账号即可） | 有，含代码审查 | 需少量适配：manifest 兼容性、API 差异 |
| **Chrome Web Store** | Google 账号 + **一次性 $5** 注册费 | 有，较严格 | 原生目标，最理想但需付费注册 |
| **Mac App Store (Safari)** | Apple Developer Program **$99/年** | 有，且需签名/公证 | 已有 Xcode 工程，但签名链是硬门槛 |

**建议路线**：先用 2.1 本地加载完成内测；若要公开，优先 **Edge Add-ons（免费）** 走通上架流程，再决定是否花 $5 上 Chrome 商店。

### 3.1 Edge Add-ons（免费，最推荐）

1. 注册微软合作伙伴中心账号（免费）；
2. 开发者中心 → 新建扩展，上传 `x-memory-chrome.zip`；
3. 填写描述、截图、隐私声明，提交审核。
   - Edge 基于 Chromium，MV3 与 `chrome.*` API 基本通用，通常无需改代码。
   - 注意：Edge 在 2026 年底前完成 MV2 → MV3 过渡，本项目是 MV3，符合要求。

### 3.2 Chrome Web Store（$5 一次性）

1. 注册 Chrome Web Store 开发者，支付一次性 $5 注册费；
2. 开发者信息中心 → 新增商品，上传 ZIP；
3. 填写商品详情、隐私政策 URL、权限说明，提交审核。
   - 注意：2026 年起商店对权限用途、隐私披露审查更严；本项目声明了 `storage/alarms/scripting` 与 `x.com`、`http(s)` 主机权限，且会把正文发送到用户配置的 AI/S3 服务，**必须在隐私政策中如实说明数据流**。

### 3.3 Safari / App Store（$99/年）

`npm run build:extensions` 会生成 **iOS + macOS 双目标** 的 Safari Web Extension（同一份 Xcode 工程）：

| 产物 | 说明 |
|------|------|
| `build/safari/X-Memory.app` | macOS 端 App（未签名，仅本机可用） |
| `build/safari/X-Memory-ios-simulator.zip` | iOS 模拟器包，可拖入模拟器即用 |
| `build/safari/X-Memory-xcode-project.zip` | 双平台 Xcode 工程，真机/上架用 |

- **iOS 模拟器**：无需签名，把模拟器 zip 解压后拖到打开的 Simulator 窗口即可安装；
- **iOS 真机**：用 Xcode 打开工程 zip 里的工程，Team 选个人 Apple ID（免费），连接 iPhone 运行；扩展会在设置 → Safari → 扩展中出现（需在 iOS 设置里开启开发者模式）；
- **正式分发/上架**：构建使用 `CODE_SIGNING_ALLOWED=NO`（仅验证编译）。要分发必须加入 Apple Developer Program（$99/年）并配置签名身份、公证后提交 App Store Connect。无账号时 App 无法在他人设备上正常运行。

> 注意：`safari-web-extension-converter` 要求 manifest 必须声明 icons，否则直接报错退出。`npm run check` 已包含图标存在性校验。

---

## 4. 上架前必须补齐的物料

无论哪个商店，提交前都需要：

1. **正式 manifest**：去掉 `(Development)` 后缀，补充 `default_icon`（16/48/128px PNG）、`description`、正式 `version`。
2. **隐私政策 URL**：说明本地存储、AI 正文外发、S3 上传、Webhook/Telegram 推送各自的数据流。这是本项目审核的最大风险点，务必如实填写。
3. **商店素材**：应用截图（至少 1–3 张）、512px 小图标、1024px 大图标、详细说明。截图可直接用 `design/index.html` 的高保真原型配合真实数据生成。
4. **权限用途说明**：解释为何需要读取 `x.com` 页面、为何需要 `scripting`（采集当前页）、为何需要广泛主机权限（用户自配置的 AI/S3/Webhook 地址）。

---

## 5. 版本更新

任何代码改动后都需要：
1. 提升 `manifest.json` 的 `version`；
2. 重新 `npm run build:chrome`（或 `npm run build:extensions`）；
3. 商店渠道重新上传新 ZIP 并过审；本地加载渠道则直接在 `chrome://extensions` 点刷新。
