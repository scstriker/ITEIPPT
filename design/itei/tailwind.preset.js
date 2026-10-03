/** ITEI Tailwind preset — use with `presets: [require("./tailwind.preset.js")]` and import tokens.css */
module.exports = {
  "theme": {
    "extend": {
      "colors": {
        "brand-navy": "var(--brand-navy)",
        "brand-navy-deep": "var(--brand-navy-deep)",
        "brand-red": "var(--brand-red)",
        "brand-sky": "var(--brand-sky)",
        "link": "var(--link)",
        "gradient-start": "var(--gradient-start)",
        "gradient-end": "var(--gradient-end)",
        "on-brand": "var(--on-brand)",
        "on-gradient": "var(--on-gradient)",
        "surface": "var(--surface)",
        "surface-sunken": "var(--surface-sunken)",
        "surface-raised": "var(--surface-raised)",
        "ink": "var(--ink)",
        "ink-muted": "var(--ink-muted)",
        "ink-disabled": "var(--ink-disabled)",
        "border": "var(--border)",
        "border-strong": "var(--border-strong)",
        "focus": "var(--focus)",
        "success": "var(--success)",
        "warning": "var(--warning)",
        "danger": "var(--danger)",
        "info": "var(--info)",
        "success-bg": "var(--success-bg)",
        "warning-bg": "var(--warning-bg)",
        "danger-bg": "var(--danger-bg)",
        "info-bg": "var(--info-bg)",
        "chart-1": "var(--chart-1)",
        "chart-2": "var(--chart-2)",
        "chart-3": "var(--chart-3)",
        "chart-4": "var(--chart-4)",
        "chart-5": "var(--chart-5)"
      },
      "spacing": {
        "1": "4px",
        "2": "8px",
        "3": "12px",
        "4": "16px",
        "5": "24px",
        "6": "32px",
        "7": "48px",
        "8": "64px"
      },
      "borderRadius": {
        "none": "0px",
        "sm": "2px",
        "md": "4px",
        "pill": "999px"
      },
      "boxShadow": {
        "raised": "var(--shadow-raised)",
        "modal": "var(--shadow-modal)"
      },
      "fontFamily": {
        "sans": [
          "\"Microsoft YaHei\", \"微软雅黑\", \"PingFang SC\", \"Noto Sans CJK SC\", \"Source Han Sans SC\", \"Hiragino Sans GB\", system-ui, -apple-system, \"Segoe UI\", sans-serif"
        ],
        "display": [
          "\"HYCuSongJ\", \"汉仪粗宋简\", \"Noto Serif CJK SC\", \"Source Han Serif SC\", \"Songti SC\", \"SimSun\", serif"
        ],
        "mono": [
          "\"JetBrains Mono\", \"Cascadia Code\", \"SF Mono\", Consolas, \"Microsoft YaHei\", monospace"
        ]
      },
      "maxWidth": {
        "content": "1200px"
      }
    }
  }
};
