<p align="center">
  <img src="icons/ios/AppIcon.appiconset/icon-1024.png" alt="sub2api-mobile logo" width="96" />
</p>

# sub2api-mobile

Mobile-first admin console for Sub2API operations, built with Expo + React Native + Expo Router.

## Mobile Preview

<img src="docs/mobile.jpg" alt="Mobile Preview" width="420" />

## Highlights

- Cross-platform app (iOS / Android / Web) for operational and admin workflows.
- Server health and metrics monitoring views.
- User, API key, account, and group management pages.
- Multi-account admin server switching in settings.

## CCH 服务器

本机管理端同时支持独立的 CCH（Claude Code Hub）服务。生产 CCH 使用 `https://cch.cacr.site`，与 Sub2API 的 `https://cacr.site` 分开连接；CCH 的 Provider、用户、模型价格和监控请求不会发送到 Sub2API。

- CCH 管理连接在设置页单独配置，原生端使用安全存储；Web 端不会持久化 CCH Admin Key。
- CCH 健康状态使用 `/api/health`，运营接口使用 `/api/v1/*`。服务端部署、备份和升级细节见服务端仓库的 `deploy/README.md`。
- CCH Provider 的协议类型必须与上游入口匹配。同一 API Key 若同时提供 Chat Completions 与 Responses，页面可能显示两条必要记录，不应仅按名称判断为重复。
- Sub2API 与 CCH 是三个独立状态（本地代码、手机端、生产服务）；CCH 的生产状态需通过现场健康检查和管理接口确认。

## Tech Stack

- Expo SDK 54
- React Native 0.81
- React 19
- Expo Router
- TanStack Query
- Valtio

## Prerequisites

- Node.js 20+
- npm 10+

## Getting Started

Install dependencies:

```bash
npm ci
```

Run locally:

```bash
npm run start
```

Common targets:

```bash
npm run android
npm run ios
npm run web
```

## Build & Release

EAS scripts:

```bash
npm run eas:build:development
npm run eas:build:preview
npm run eas:build:production
```

OTA update scripts:

```bash
npm run eas:update:preview -- "your message"
npm run eas:update:production -- "your message"
```

Additional release notes: [docs/EXPO_RELEASE.md](docs/EXPO_RELEASE.md)

GitHub Actions Android build (downloadable):

- Workflow: `.github/workflows/eas-build.yml`
- Trigger: **Actions → EAS Build → Run workflow**
- Inputs: `profile=preview`, `platform=android`
- Requirement: repository secret `EXPO_TOKEN`
- Download: after completion, open the run **Summary** and use the `ANDROID download` link.

## Project Structure

```txt
app/                 Expo Router routes/screens
src/components/      Reusable UI components
src/services/        Admin API request layer
src/store/           Global config/account state (Valtio)
src/lib/             Utilities, query client, fetch helpers
docs/                Operational and release documentation
server/              Local Express proxy for admin APIs
```

## Security Notes

- Web builds are intentionally configured to avoid persistent storage of `adminApiKey`.
- Native platforms continue to use secure storage semantics.
- For responsible disclosure, see [SECURITY.md](SECURITY.md).

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
