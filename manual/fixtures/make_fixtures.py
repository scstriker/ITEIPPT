"""Generate the synthetic sample files used for screenshots and embedded in the manual.

Every file is fictional and carries “示例” in its name. Run from the repo root:
    python manual/fixtures/make_fixtures.py
Needs python-docx, Pillow and the SimHei font (C:/Windows/Fonts/simhei.ttf).
"""

from pathlib import Path

from docx import Document
from docx.shared import Pt
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent / 'out'
FONT = 'C:/Windows/Fonts/simhei.ttf'

TITLE = '团体标准《医用呼吸机关键零部件 第1部分：压力传感器》编制说明（示例）'

SECTIONS = [
    ('一、项目背景及必要性', [
        '医用呼吸机是重症救治的关键设备，压力传感器决定通气压力监测的准确性和响应速度。',
        '目前国内整机厂商使用的压力传感器约 70% 依赖进口，供货周期长达 16 周，供应链风险较高。',
        '现行国家标准只规定了呼吸机整机性能，没有针对压力传感器这一关键零部件的统一技术要求。',
        '制定本标准可以统一测量范围、准确度和环境适应性要求，为国产传感器替代提供检验依据。',
    ]),
    ('二、项目适用范围及主要内容', [
        '本标准适用于医用呼吸机气路压力监测用的压阻式和电容式压力传感器。',
        '本标准规定了压力传感器的术语和定义、技术要求、试验方法、检验规则以及标志和包装。',
        '主要技术指标包括：测量范围 -10 kPa～10 kPa，准确度优于满量程的 1%，响应时间不超过 20 ms。',
        '环境适应性要求覆盖工作温度 10 ℃～40 ℃、相对湿度不大于 90%，并规定了 5,000 次压力循环耐久试验。',
    ]),
    ('三、项目制定过程', [
        '2024 年 3 月本项目获批立项，计划编号为 T/ITEI 2024-016（示例）。',
        '起草组由 9 家单位组成，先后召开 4 次工作组会议，形成征求意见稿。',
        '征求意见阶段共发出意见征询函 32 份，收到反馈意见 57 条，采纳 41 条，部分采纳 9 条。',
        '验证试验在 3 家检测机构完成，覆盖 6 个型号共 60 只样品，全部指标与标准草案一致。',
        '参编单位包括整机厂商 3 家、传感器厂商 4 家和检测机构 2 家。',
    ]),
    ('四、国内外先进性、创新性、产业化情况', [
        '本标准首次将动态响应时间和压力循环耐久性纳入呼吸机压力传感器的通用技术要求。',
        '与国际标准相比，本标准补充了湿热环境下零点漂移的限值，零点漂移不超过满量程的 0.5%。',
        '目前已有 4 家国内企业的产品通过验证试验，预计 2 年内国产化率可提高到 50% 以上。',
    ]),
    ('五、预期达到的经济社会效益', [
        '标准实施后，预计可缩短整机厂商的零部件选型周期约 30%，降低采购成本约 15%。',
        '统一的检验方法可以减少重复检测，单个型号的检测费用预计减少 2 万元。',
        '国产传感器稳定供货有助于提升重症救治设备的应急保障能力。',
    ]),
    ('六、其他需要说明的问题', [
        '本标准与现行法律法规和强制性国家标准没有冲突。',
        '本标准不涉及专利，建议发布后 6 个月实施，并开展宣贯培训。',
    ]),
]

IMAGES = [
    ('配图-制定流程（示例）.png', '标准制定流程', ['立项', '起草', '征求意见', '验证', '送审']),
    ('配图-产业链（示例）.png', '压力传感器产业链', ['敏感元件', '封装测试', '整机厂商', '医疗机构']),
    ('配图-必要性（示例）.png', '国产化必要性', ['进口依赖 70%', '供货 16 周', '标准缺失']),
    ('配图-适用范围（示例）.png', '标准适用范围', ['压阻式', '电容式', '气路监测']),
]


def make_docx() -> Path:
    doc = Document()
    style = doc.styles['Normal']
    style.font.size = Pt(11)
    doc.add_paragraph(TITLE)
    for heading, paragraphs in SECTIONS:
        doc.add_paragraph(heading)
        for text in paragraphs:
            doc.add_paragraph(text)
    path = OUT / '压力传感器标准编制说明（示例）.docx'
    doc.save(path)
    return path


def make_blank_pdf() -> Path:
    path = OUT / '扫描件（示例）.pdf'
    c = canvas.Canvas(str(path), pagesize=A4)
    c.rect(72, 600, 300, 160)
    c.save()
    return path


def make_doc() -> Path:
    path = OUT / '旧版文档（示例）.doc'
    path.write_bytes(b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' + b'\x00' * 504)
    return path


def make_image(name: str, title: str, steps: list[str]) -> Path:
    width, height = 1280, 720
    image = Image.new('RGB', (width, height), '#f4f7fa')
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.truetype(FONT, 44)
    box_font = ImageFont.truetype(FONT, 30)
    draw.rectangle((0, 0, width, 96), fill='#044470')
    draw.text((48, 24), title, font=title_font, fill='white')
    count = len(steps)
    gap = 36
    box_w = (width - 96 - gap * (count - 1)) // count
    top = 300
    for index, step in enumerate(steps):
        left = 48 + index * (box_w + gap)
        fill = '#b81c27' if index == 0 else '#0080cc'
        draw.rectangle((left, top, left + box_w, top + 140), fill=fill)
        text_w = draw.textlength(step, font=box_font)
        draw.text((left + (box_w - text_w) / 2, top + 52), step, font=box_font, fill='white')
        if index < count - 1:
            x = left + box_w + 4
            draw.polygon([(x, top + 60), (x + gap - 8, top + 70), (x, top + 80)], fill='#044470')
    draw.text((48, height - 70), '示例配图，非真实数据', font=box_font, fill='#5b6b7a')
    path = OUT / name
    image.save(path)
    return path


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    print(make_docx())
    print(make_blank_pdf())
    print(make_doc())
    for args in IMAGES:
        print(make_image(*args))
