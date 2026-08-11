# AI ThemeStore Community

一套开源、离线、可恢复的 Codex Desktop macOS 主题 App。

> 非 OpenAI 官方产品。不修改官方 `.app`、`app.asar`、二进制文件或代码签名。

## Community 版包含什么

- 原生 SwiftUI Mac App
- 本地主题浏览、应用、验证与恢复
- 三套可再分发的原创主题：极简玻璃、赛博霓虹、粉色未来城
- 自定义主题目录与开放的 `theme.json` 格式
- 仅绑定 `127.0.0.1` 的 CDP 主题引擎
- 官方 Codex App 与其内置 Node.js 的签名校验
- 事务式主题切换、实时验证、失败回滚与安全模式

Community 版没有账号、遥测、远程设备、云端 Registry、在线主题下载或自动更新。

## 系统要求

- macOS 13 或更高版本
- 官方 Codex Desktop App
- Xcode Command Line Tools（仅从源码构建时需要）

## 从源码构建

```bash
./scripts/build-app.sh
open "dist/AI ThemeStore Community.app"
```

构建脚本会生成本地 ad-hoc 签名 App，不需要修改或重新签名官方 Codex App。

## 使用

1. 打开 AI ThemeStore Community。
2. 选择一套本地主题并点击“应用主题”。
3. App 会安全重启 Codex，并验证 New Chat 与任务页主题运行状态。
4. 点击“恢复官方外观”即可停止主题运行时并回到原生界面。

“打开主题目录”会打开：

```text
~/Library/Application Support/AIThemeStore/themes
```

每套主题是一个独立目录，至少包含 `theme.json` 以及该文件引用的背景图。字段、安全限制和最小示例见 [主题格式文档](docs/theme-format.md)。

## 测试

```bash
./tests/run-tests.sh
```

## 安全说明

主题运行期间，本地调试端口属于敏感能力。不要同时运行不受信任的本机软件。完整边界见 [SECURITY.md](SECURITY.md)。

## 完整版

Community 版专注离线本地主题。完整主题商店与更多经过适配的主题可访问 [themestore.ai](https://themestore.ai)。

## 许可证

代码与仓库内三套原创主题采用 [MIT License](LICENSE)。商标和第三方内容不在授权范围内，详见 [NOTICE.md](NOTICE.md)。
