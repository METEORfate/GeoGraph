# 加玛 GeoProspect

本地三维地学工作台。地表采样以点表示，垂直钻孔的每条分析区间以独立线段表示。使用原始 Excel 与 Copernicus GLO-30 构建数据，无业务服务器、数据库或在线地图依赖。初次准备 DEM 与安装依赖需要联网；之后可以离线运行。

## 启动

在项目目录打开 PowerShell：

```powershell
./start.ps1
```

打开 http://127.0.0.1:5173/ 。脚本仅绑定本机回环地址，按 Ctrl+C 停止。要求 Node.js 22.12+（建议 24 LTS）。当前已安装依赖、生成数据，无需重新准备。

如果 PowerShell 的执行策略阻止脚本，可直接执行 `npm.cmd run dev`，无需更改系统策略。端口被占用时运行 `./start.ps1 -Port 5174`。

## 使用

- 拖动旋转，滚轮缩放，右键拖动平移；全区、俯视、东侧和南侧按钮切换正交视角。
- 默认青色地表点、铜色钻孔线段与孔口。DEM 地形默认关闭，可单独打开。
- 悬停显示摘要；点击固定详情。用“定位此对象”放大后可以选择相邻的短分析区间。全区视角下多个不足一个像素的区间可能重叠，不能仅凭远景区分它们。
- 元素选择后支持线性、log10、手动色域及含量范围。色域始终来自全体有效数据，筛选不会重新拉伸。空白表示自动范围。
- 跨来源 Cu、Mo、Pb、Zn 的 `%` 转换为 `ppm`；氧化物保持 `%`，不与元素混同。右侧原始字段保留原单位。
- 缺失值灰色；log10 下非正值单独标记，不加伪计数。孔口始终保持类型色，因为孔口没有对应的区间化验值。
- 钻孔编号仅筛选钻孔与孔口，样本类型仅筛选地表；高程来源筛选适用于全场景。含量筛选不剔除孔口。
- 支持 3840 像素宽 PNG、筛选对象 CSV、JSON 视图配置保存/恢复。数据版本不同时拒绝恢复配置，避免错误对应。
- “数据与方法”查看数量、异常记录、DEM 配准残差与引用依据。

## 重建与验证

Python 3.11 已验证。重新处理数据：

```powershell
./prepare.ps1
# DEM 已缓存时，禁止重新下载：
./prepare.ps1 -Offline

./.venv/Scripts/python.exe -m unittest discover -s tests -p 'test_*.py'
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

`prepare.ps1` 首次会建立 `.venv` 并安装 `requirements.txt` 中的依赖；`-Offline` 仅禁止 DEM 下载，Python 依赖仍需已安装或命中 pip 缓存。完全离线重建可直接运行 `./.venv/Scripts/python.exe scripts/prepare_data.py --offline`。

生成内容：

- `public/dataset/manifest.json`：数据版本、来源校验值、坐标假设、单位字典、DEM 元数据和比对结果。
- `public/dataset/observations.json.gz`：完整原始属性、几何、高程来源与记录级质量标记。
- `public/dataset/quality.json`、`reports/quality.json`：异常及分析间隙清单。
- `reports/dem_residuals.csv`：所有有效原始地表及孔口高程的逐条 DEM 比对。
- `data/dem/`：原始 DEM 缓存和下载元数据。原始 Excel 不修改。

数据版本由 Excel、DEM 与处理脚本的 SHA256 共同生成；构建依赖由 `package-lock.json` 锁定。

## 科研边界

原始大地基准仍未确认。去除带号后采用项目局部 East/North；DEM 暂按 CGCS2000 / 高斯–克吕格中央经线 93°E（EPSG:4540）配准，转换库明确报告到 WGS84 的近似转换。该 EPSG 是工作假设，不能写作原始测绘坐标系已获确认。

地表保留 1,963 个有效原始高程，7,058 个缺失或异常 H 使用 DEM 估算。孔口一律保留原始高程。所有钻孔为垂直孔的依据是用户确认。模型展示观测数据位置，不是矿体边界或资源量估算。

详细处理与论文方法说明见 [docs/methodology.md](docs/methodology.md)，接口见 [docs/data-format.md](docs/data-format.md)。

## 已保存的交付结果

- [验证记录](reports/verification.md)：自动测试、浏览器操作、性能观测及验证限制。
- [3840 像素三维总览](reports/jiama-overview.png)：由应用实际导出，包含图例与方法注记。
- [应用界面预览](reports/app-preview.png)：Cu 对数着色与地形图层。

导出后页面提供下载链接；PNG 还可点击“查看图片”预览。内置浏览器的自动下载完成回执未验证，详情见验证记录。
