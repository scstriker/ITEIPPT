from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import List

from PIL import Image, ImageChops, ImageStat

PAGE_MAPPING = [
    {"name": "cover", "generated_page": 1, "reference_page": 1},
    {"name": "toc_section", "generated_page": 2, "reference_page": 2},
    {"name": "content", "generated_page": 3, "reference_page": 3},
    {"name": "ending", "generated_page": 4, "reference_page": 21},
]


@dataclass
class PageDiffResult:
    slide_name: str
    generated_page: int
    reference_page: int
    generated_image: str
    reference_image: str
    diff_image: str
    generated_size: tuple[int, int]
    reference_size: tuple[int, int]
    mae: float
    changed_ratio: float
    status: str
    notes: str


def run_cmd(args: List[str]) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=True, capture_output=True, text=True)


def find_binary(binary_name: str) -> str | None:
    return shutil.which(binary_name)


def convert_pptx_to_pdf(pptx_path: Path, output_dir: Path, soffice_bin: str) -> Path:
    run_cmd(
        [
            soffice_bin,
            "--headless",
            "--convert-to",
            "pdf",
            str(pptx_path),
            "--outdir",
            str(output_dir),
        ]
    )
    pdf_path = output_dir / f"{pptx_path.stem}.pdf"
    if not pdf_path.exists():
        raise RuntimeError(f"PDF conversion output not found: {pdf_path}")
    return pdf_path


def convert_pdf_page_to_png(pdf_path: Path, page: int, output_png: Path, pdftoppm_bin: str) -> None:
    prefix = output_png.with_suffix("")
    run_cmd(
        [
            pdftoppm_bin,
            "-png",
            "-f",
            str(page),
            "-l",
            str(page),
            "-singlefile",
            str(pdf_path),
            str(prefix),
        ]
    )
    if not output_png.exists():
        raise RuntimeError(f"PNG conversion output not found: {output_png}")


def diff_images(reference_png: Path, generated_png: Path, diff_png: Path) -> tuple[float, float, tuple[int, int], tuple[int, int]]:
    with Image.open(reference_png).convert("RGB") as ref, Image.open(generated_png).convert("RGB") as gen:
        ref_size = ref.size
        gen_size = gen.size
        if ref.size != gen.size:
            gen = gen.resize(ref.size, Image.Resampling.BICUBIC)

        diff = ImageChops.difference(ref, gen)
        diff.save(diff_png)

        stat = ImageStat.Stat(diff)
        mae = float(sum(stat.mean) / len(stat.mean))

        # Any pixel with perceptible change in grayscale > 12 is counted.
        mask = diff.convert("L").point(lambda pixel: 255 if pixel > 12 else 0)
        histogram = mask.histogram()
        changed_pixels = sum(histogram[1:])
        total_pixels = ref.size[0] * ref.size[1]
        changed_ratio = changed_pixels / total_pixels if total_pixels else 0.0

        return mae, changed_ratio, gen_size, ref_size


def classify_result(changed_ratio: float, size_mismatch: bool) -> tuple[str, str]:
    if size_mismatch:
        return "fail", "Image size mismatch detected; generation and reference use different rendered dimensions."
    if changed_ratio > 0.05:
        return "fail", "Large visual difference (>5%)."
    if changed_ratio > 0.01:
        return "warn", "Moderate visual difference (>1%)."
    return "pass", "Within tolerance."


def write_issue_list(path: Path, status: str, issues: List[str], page_results: List[PageDiffResult], blockers: List[str]) -> None:
    lines: List[str] = []
    lines.append("# Phase 1 Gate Issue List")
    lines.append("")
    lines.append(f"- Generated At: {datetime.now().isoformat(timespec='seconds')}")
    lines.append(f"- Overall Status: {status.upper()}")
    lines.append("")

    lines.append("## Blockers")
    if blockers:
        for blocker in blockers:
            lines.append(f"- [ ] {blocker}")
    else:
        lines.append("- None")
    lines.append("")

    lines.append("## Visual Diff Summary")
    for result in page_results:
        lines.append(
            f"- `{result.slide_name}` (gen p{result.generated_page} vs ref p{result.reference_page}): "
            f"status={result.status}, changed_ratio={result.changed_ratio:.4%}, mae={result.mae:.2f}"
        )
    lines.append("")

    lines.append("## Issues")
    if issues:
        for issue in issues:
            lines.append(f"- [ ] {issue}")
    else:
        lines.append("- No visual issues detected in current threshold.")
    lines.append("")

    lines.append("## Iteration Loop")
    lines.append("- [ ] Record issue in this list")
    lines.append("- [ ] Adjust `template_structure.json` or renderer logic")
    lines.append("- [ ] Re-run `npm run gate:phase1`")
    lines.append("- [ ] Re-check diff images and close resolved items")

    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 1 visual comparison for gate sample PPTX.")
    parser.add_argument("--generated", required=True, type=Path)
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--issue-list", required=True, type=Path)
    parser.add_argument("--report-json", required=True, type=Path)
    args = parser.parse_args()

    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    image_dir = output_dir / "diff_images"
    image_dir.mkdir(parents=True, exist_ok=True)

    blockers: List[str] = []
    issues: List[str] = []
    page_results: List[PageDiffResult] = []

    soffice_bin = find_binary("soffice")
    pdftoppm_bin = find_binary("pdftoppm")

    if not soffice_bin:
        blockers.append("`soffice` is not installed or not in PATH; cannot convert PPTX to PDF for visual diff.")
    if not pdftoppm_bin:
        blockers.append("`pdftoppm` is not installed or not in PATH; cannot convert PDF pages to PNG.")

    if blockers:
        write_issue_list(args.issue_list, "blocked", issues, page_results, blockers)
        report = {
            "status": "blocked",
            "generated": str(args.generated),
            "reference": str(args.reference),
            "blockers": blockers,
            "page_results": [],
        }
        args.report_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[Phase1 Gate] Visual compare blocked. See: {args.issue_list}")
        return 0

    with tempfile.TemporaryDirectory(prefix="phase1_gate_") as tmp:
        tmp_dir = Path(tmp)
        gen_pdf = convert_pptx_to_pdf(args.generated, tmp_dir, soffice_bin)
        ref_pdf = convert_pptx_to_pdf(args.reference, tmp_dir, soffice_bin)

        for mapping in PAGE_MAPPING:
            slide_name = mapping["name"]
            generated_page = mapping["generated_page"]
            reference_page = mapping["reference_page"]

            generated_png = image_dir / f"generated_{slide_name}_p{generated_page}.png"
            reference_png = image_dir / f"reference_{slide_name}_p{reference_page}.png"
            diff_png = image_dir / f"diff_{slide_name}.png"

            convert_pdf_page_to_png(gen_pdf, generated_page, generated_png, pdftoppm_bin)
            convert_pdf_page_to_png(ref_pdf, reference_page, reference_png, pdftoppm_bin)

            mae, changed_ratio, gen_size, ref_size = diff_images(reference_png, generated_png, diff_png)
            status, note = classify_result(changed_ratio, gen_size != ref_size)

            if status != "pass":
                issues.append(
                    f"[{slide_name}] changed_ratio={changed_ratio:.4%}, mae={mae:.2f}. "
                    f"Check positioning/font/color/background alignment using `{diff_png.name}`."
                )

            page_results.append(
                PageDiffResult(
                    slide_name=slide_name,
                    generated_page=generated_page,
                    reference_page=reference_page,
                    generated_image=str(generated_png),
                    reference_image=str(reference_png),
                    diff_image=str(diff_png),
                    generated_size=gen_size,
                    reference_size=ref_size,
                    mae=mae,
                    changed_ratio=changed_ratio,
                    status=status,
                    notes=note,
                )
            )

    overall_status = "pass" if not issues else "fail"
    write_issue_list(args.issue_list, overall_status, issues, page_results, blockers)

    report = {
        "status": overall_status,
        "generated": str(args.generated),
        "reference": str(args.reference),
        "blockers": blockers,
        "issues": issues,
        "page_results": [asdict(item) for item in page_results],
    }
    args.report_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[Phase1 Gate] Compare completed with status={overall_status}.")
    print(f"[Phase1 Gate] Issue list: {args.issue_list}")
    print(f"[Phase1 Gate] JSON report: {args.report_json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

