# 数据与视图接口（schemaVersion 1）

所有数值坐标使用米。`null`表示缺失，不能解释为0。`source:index+2`为当前工作簿的稳定对象ID，其中index从0开始，Excel行号从2开始。当前输入表无内部空行；更新输入表后必须重建、核对来源行号和数量。

## manifest.json

- `version`：Excel、DEM和处理脚本内容哈希生成的版本。
- `sources[]`：输入文件名与SHA256；`pipelineSHA256`和`runtime`记录处理版本。
- `coordinate`：暂定工作EPSG、基准未确认状态、PROJ操作说明、垂直孔的用户确认依据。
- `origin`：仅渲染时减去的共同原点；`bounds`为原始局部坐标包围盒。
- `dem`：下载URL、时间、HTTP元数据、校验值、栅格参数、产品名、垂直基准、引用与许可。
- `chemistry[]`：化学物种ID、统一显示单位、各来源字段索引/原单位/换算系数，以及全体数据数值范围和正值范围。
- `counts`及`comparisons`：数量、质量统计与候选DEM残差。

## observations.json.gz

压缩的UTF-8 JSON，浏览器用DecompressionStream解压。`surface`、`collar`、`drill`各自包含平行数组`headers`、`rows`、`geometry`、`flags`。`rows[i]`按原始表头顺序保留所有单元格值；flags为质量代码数组。

| 来源 | geometry[i] |
|---|---|
| surface | `[East, North, displayHeight或null, "original"或"dem"或"unlocated"]` |
| collar | `[East, North, originalHeight]` |
| drill | `[collarIndex, topHeight, bottomHeight]`，无效区间为null |

地表原始高程保存在`surface.rows[i][53]`，未覆盖。钻孔FROM/TO为原表索引1/2。`terrain`包含east、north一维坐标数组，以及按`northIndex * east.length + eastIndex`排列的高程。含无效顶点的网格单元不绘制。

## quality.json / dem_residuals.csv

质量报告包括`issues`与`gaps`；每条问题带来源、行号、标识和详情。DEM CSV包括来源、行号、编号、局部E/N、原始H、DEM H及差值，未删去大残差。

## 视图JSON

`schemaVersion`、`datasetVersion`、`controls`、`camera`、`selected`。controls包含图层开关、元素/变换、色域、筛选、点大小和线宽；camera包含position、target、up、zoom、span。位置使用渲染局部原点。selected为`{kind,index}`或null。

恢复前验证版本、数值范围、枚举、对象索引和相机合法性。版本不匹配拒绝恢复。CSV导出将原始字段加上来源与列索引前缀，避免同名Y（北坐标/钇元素）等冲突；规范含量列带单位。为避免Excel公式执行，文本字段若以公式触发字符开头则加单引号，数值字段仍保留数值含义。
