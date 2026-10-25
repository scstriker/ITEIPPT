# ITEISlides 使用手册的源文件

`docs/ITEISlides_使用手册_V1.0.pdf` 由这里的脚本生成，写法按 `manual-writing-prompt.md`（参考型使用手册，GB/T 7713.3—2014 版式）。

| 目录 | 内容 |
|---|---|
| `fixtures/` | 示例文件的生成脚本，产物在 `fixtures/out/`，文件名都带“示例” |
| `capture/` | 截图：`lib.py` 启动生产构建、真实后端和模拟 Gemini；`journeys.py` 按功能分组截图；`annotate.py` 画框、编号并拼图；`render_pptx.py` 用 PowerPoint 渲染导出的 PPTX |
| `diagrams/` | 手写的 SVG 示意图 |
| `shots/final/` | 标注后的截图，`shots/meta.json` 记录裁剪框和标注框 |
| `src/um/` | 手册正文（Markdown），`src/common/manual.css` 是版式 |
| `build/` | `config.yaml` 元数据，`build.py` 构建 PDF，`check.py` 检查 |

## 重新生成

在仓库根目录执行。需要 Python 3（markdown、beautifulsoup4、PyYAML、PyMuPDF、pypdf、Playwright、Pillow、pypinyin、python-docx、reportlab、pywin32）、Chrome 和 PowerPoint。

```bash
python manual/fixtures/make_fixtures.py
```

```bash
cd manual/capture && python journeys.py && python annotate.py && python render_pptx.py
```

```bash
python manual/build/build.py
```

```bash
python manual/build/check.py
```

只改了正文时，只需运行后两条。`check.py` 在 `manual/out/preview/` 生成每张 9 页的缩略图，用于目视检查。

截图中的 AI 输出由 `capture/mockBackend.ts` 按脚本返回，不联网，也不需要 Gemini 密钥。
