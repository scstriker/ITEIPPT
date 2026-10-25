"""Render the PPTX exported during capture into slide images with PowerPoint (COM).

    python manual/capture/render_pptx.py

Opens a separate PowerPoint instance read-only, exports PDF, then renders pages at 110 dpi.
"""

from __future__ import annotations

from pathlib import Path

import fitz
import pythoncom
import win32com.client

MANUAL = Path(__file__).resolve().parents[1]
PPTX = MANUAL / 'build' / 'export' / 'ITEIPPT_v2_output.pptx'
PDF = MANUAL / 'build' / 'export' / 'ITEIPPT_v2_output.pdf'
OUT = MANUAL / 'shots' / 'final'
PP_SAVE_AS_PDF = 32


def export_pdf() -> None:
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx('PowerPoint.Application')
    try:
        presentation = app.Presentations.Open(str(PPTX), True, False, False)  # ReadOnly, Untitled, WithWindow
        presentation.SaveAs(str(PDF), PP_SAVE_AS_PDF)
        presentation.Close()
    finally:
        app.Quit()
        pythoncom.CoUninitialize()


def render(pages: dict[str, int]) -> None:
    doc = fitz.open(PDF)
    print('pages', doc.page_count)
    OUT.mkdir(parents=True, exist_ok=True)
    for name, number in pages.items():
        pix = doc[number - 1].get_pixmap(dpi=110)
        path = OUT / f'{name}.png'
        pix.save(path)
        print(name, number, pix.width, pix.height)


def describe() -> None:
    """Print each slide's first text lines and image count, to choose figure pages."""
    doc = fitz.open(PDF)
    for index, page in enumerate(doc, start=1):
        text = ' / '.join(line for line in page.get_text().splitlines() if line.strip())[:60]
        print(index, len(page.get_images()), text)


if __name__ == '__main__':
    import sys

    export_pdf()
    if len(sys.argv) > 1 and sys.argv[1] == 'describe':
        describe()
    else:
        render({
            'pptx-cover': 1,
            'pptx-toc': 2,
            'pptx-table': 7,
            'pptx-overflow': 3,
            'pptx-images': 4,
            'pptx-placeholder': 9,
            'pptx-ending': 21,
        })
