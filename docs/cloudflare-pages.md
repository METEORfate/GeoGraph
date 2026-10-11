# Cloudflare Pages 部署

此项目的交互式 3D 场景使用 Three.js + Vite，浏览器端渲染。仓库已经包含预处理后的 `public/dataset/` 数据。**Cloudflare 无需运行 Python 或 prepare.ps1**。

## 通过 GitHub 自动部署（推荐）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 进入 **Workers & Pages**，新建 **Pages** 项目，选择 **Connect to Git**，授权 GitHub，并选择 `METEORfate/GeoGraph`。
3. 生产分支选择 `main`，配置如下：

| 配置项 | 值 |
| --- | --- |
| Framework preset | Vite（如果可选） |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/`（仓库根目录） |
| Environment variable `NODE_VERSION` | `24.9.0` |

4. 部署完成后打开 Cloudflare 分配的 `*.pages.dev` 地址，等待模型加载。
5. 检查 `/dataset/manifest.json`、`/dataset/observations.json.gz`、`/dataset/quality.json` 是否返回 HTTP 200，然后验证三维旋转、钻孔选择、DEM 显隐、CSV/PNG 导出。
6. 以后向 `main` 推送更新即可自动部署。

## 构建说明

```bash
npm ci
npm test
npm run build
```

Node.js 版本记录于 `.node-version`。已经验证 Node.js 24.9.0 下 6 个测试通过且生产构建成功。

浏览器通过 `DecompressionStream('gzip')` 解码数据；请不要在 Cloudflare 配置中额外为 `observations.json.gz` 添加 `Content-Encoding: gzip`，否则可能触发不必要的自动解压；现有加载逻辑已兼容收到原始 gzip 或解压后的响应。

**数据公开提醒：** Pages 是公开站点，`public/dataset/` 下的观测记录、样本属性及坐标均可被访问者下载。上线前应确认拥有公开发布授权；如需私有访问，必须先添加鉴权并设计数据访问控制，不能只靠隐藏界面。

如需后续从 Excel 更新数据，在本地运行 `prepare.ps1`，生成更新后的 `public/dataset/` 文件并提交 GitHub。
