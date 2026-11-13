#!/usr/bin/env python3
"""截图后处理：把实拍图整理成商店可用规格，并对敏感区域打码。

依赖：Pillow（仓库环境已内置）。

典型用法
--------
1) 只检查尺寸是否符合商店要求（不写文件）：
   python tools/screenshot_prep.py shot.png --check

2) 裁切/补白到 1280×800（cover 居中裁切，适合横屏截图）：
   python tools/screenshot_prep.py shot.png -o out/01-rules.png

3) 先对敏感区域打码，再缩放（可多次 --redact）：
   python tools/screenshot_prep.py shot.png -o out/02-wsdata.png \
       --redact 40,90,420,260 --redact 900,60,300,40

4) 自定义目标尺寸与填充色（640×400 为商店最小尺寸）：
   python tools/screenshot_prep.py shot.png -o out/small.png \
       --size 640x400 --mode contain --bg FFFFFF

参数说明
--------
--size     目标尺寸，默认 1280x800（商店推荐）
--mode     cover（默认，裁剪多余部分）/ contain（完整保留，留白填充）
--bg       contain 模式的填充色，默认白色
--redact   x,y,w,h 打码区域，可重复；坐标为原图像素
--mosaic   马赛克块大小，默认 12（越大越模糊）
--check    只输出当前尺寸与建议，不写文件
--force    尺寸不达标时仍然输出（默认会拒绝）
"""

import argparse
import os
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("缺少 Pillow：请使用仓库自带 Python（含 Pillow）运行本脚本")

# Windows 终端默认 GBK，统一按 UTF-8 输出，避免中文提示乱码
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


STORE_SIZES = [(1280, 800), (640, 400)]


def parse_size(text):
    try:
        w, h = text.lower().split("x")
        return int(w), int(h)
    except ValueError:
        raise argparse.ArgumentTypeError("尺寸格式应为 WxH，例如 1280x800")


def parse_rect(text):
    try:
        x, y, w, h = [int(v) for v in text.split(",")]
    except ValueError:
        raise argparse.ArgumentTypeError("打码区域格式应为 x,y,w,h")
    if w <= 0 or h <= 0:
        raise argparse.ArgumentTypeError("打码区域宽高必须为正")
    return x, y, w, h


def mosaic_region(img, rect, block):
    """把指定矩形区域做马赛克（不可逆，避免信息残留）。"""
    x, y, w, h = rect
    box = (max(0, x), max(0, y), min(img.width, x + w), min(img.height, y + h))
    if box[2] - box[0] < 2 or box[3] - box[1] < 2:
        return img
    region = img.crop(box)
    small = region.resize(
        (max(1, region.width // block), max(1, region.height // block)),
        Image.Resampling.BILINEAR,
    )
    return_img = img.copy()
    return_img.paste(small.resize(region.size, Image.Resampling.NEAREST), box)
    return return_img


def fit_cover(img, size):
    tw, th = size
    scale = max(tw / img.width, th / img.height)
    resized = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - tw) // 2
    top = (resized.height - th) // 2
    return resized.crop((left, top, left + tw, top + th))


def fit_contain(img, size, bg):
    tw, th = size
    scale = min(tw / img.width, th / img.height)
    resized = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (tw, th), bg)
    canvas.paste(resized, ((tw - resized.width) // 2, (th - resized.height) // 2))
    return canvas


def describe_size(w, h):
    exact = (w, h) in STORE_SIZES
    ratio = w / h
    return f"{w}×{h}（比例 {ratio:.2f}:1）", exact


def main():
    ap = argparse.ArgumentParser(description="商店截图规格整理 + 敏感区域打码")
    ap.add_argument("input")
    ap.add_argument("-o", "--output")
    ap.add_argument("--size", type=parse_size, default=(1280, 800))
    ap.add_argument("--mode", choices=["cover", "contain"], default="cover")
    ap.add_argument("--bg", default="FFFFFF")
    ap.add_argument("--redact", type=parse_rect, action="append", default=[])
    ap.add_argument("--mosaic", type=int, default=12)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    if not os.path.isfile(args.input):
        sys.exit(f"输入文件不存在：{args.input}")

    img = Image.open(args.input)
    img.load()
    desc, exact = describe_size(*img.size)
    note, target_exact = describe_size(*args.size)
    print(f"输入：{os.path.basename(args.input)} → {desc}")
    print(f"目标：{note}" + ("" if target_exact else "（非商店标准尺寸，请确认）"))

    if args.check:
        if exact:
            print("结论：尺寸符合商店要求（1280×800 或 640×400）")
        else:
            print("结论：尺寸不符合商店要求，需要裁切/缩放（去掉 --check 后带 -o 运行）")
        return 0

    if not args.output:
        sys.exit("需要 -o/--output 指定输出文件")

    if not exact and not args.force and args.size in STORE_SIZES:
        print("提示：输入尺寸不达标但会按目标尺寸重新排布（--force 可跳过此提示）")

    out = img.convert("RGB")
    for rect in args.redact:
        out = mosaic_region(out, rect, args.mosaic)
        print(f"已打码：{rect}（马赛克块 {args.mosaic}px）")

    out = fit_cover(out, args.size) if args.mode == "cover" else fit_contain(out, args.size, "#" + args.bg)

    # 去掉 EXIF / ICC 等元数据，避免携带拍摄环境信息
    out.info.clear()
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    if args.output.lower().endswith((".jpg", ".jpeg")):
        out.save(args.output, "JPEG", quality=92)
    else:
        out.save(args.output, "PNG", optimize=True)
    print(f"输出：{args.output} → {out.width}×{out.height}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
