"""Builds server/seed/media.json: the images the client start data attaches.

- Two real photos from jpinfracon.com (the Kalyan Mandap building, and an example overhead
  tank), resized. Download them first into the folder given as the first argument.
- SAMPLE ILLUSTRATIONS (drawn, clearly labelled, never presented as site photos): stages of the
  Kalyan Mandap work and of each overhead tank's repainting.
- Two drawings with dimensions (Kalyan Mandap ground floor plan, OHT elevation) for the drawing
  reader.

Run: python3 -I scripts/generate-seed-media.py <photos-folder>
"""

import base64
import io
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 960, 720
OUT = Path(__file__).resolve().parent.parent / "server" / "seed" / "media.json"


def font(size, bold=False):
    names = ["DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"]
    for name in names:
        for folder in ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu"]:
            path = Path(folder) / name
            if path.exists():
                return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def jpeg(image, quality=72):
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, "JPEG", quality=quality, optimize=True)
    return base64.b64encode(buffer.getvalue()).decode()


def png(image):
    buffer = io.BytesIO()
    image.save(buffer, "PNG", optimize=True)
    return base64.b64encode(buffer.getvalue()).decode()


def banner(draw, title, subtitle):
    draw.rectangle([0, 0, W, 86], fill=(22, 50, 79))
    draw.text((24, 12), "SAMPLE ILLUSTRATION", font=font(18, True), fill=(230, 201, 135))
    draw.text((24, 38), title, font=font(26, True), fill="white")
    draw.text((24, H - 34), subtitle, font=font(16), fill=(60, 60, 60))
    draw.rectangle([0, H - 44, W, H - 42], fill=(176, 138, 62))


def sky_ground(draw):
    for y in range(86, 470):
        shade = int(205 + (y - 86) * 0.12)
        draw.line([(0, y), (W, y)], fill=(min(shade, 245), min(shade + 12, 250), 255))
    draw.rectangle([0, 470, W, H - 44], fill=(176, 146, 104))


# ── Kalyan Mandap stages ────────────────────────────────────────────────────────────────────
BUILDING_STAGES = [
    ("Excavation for footings", "excavation"),
    ("PCC and footings", "footings"),
    ("Plinth beam and filling", "plinth"),
    ("Ground floor columns", "columns"),
    ("First floor slab", "slab"),
    ("Brickwork", "brick"),
    ("Plaster", "plaster"),
    ("UPVC doors and windows", "upvc"),
    ("Interior painting", "paint_in"),
    ("Exterior painting", "paint_out"),
    ("Electrical and pump", "electrical"),
    ("Handed over", "done"),
]


def building(stage):
    image = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(image)
    sky_ground(draw)
    order = [key for _, key in BUILDING_STAGES]
    level = order.index(stage)
    left, right, ground = 180, 780, 470
    if level == 0:
        draw.rectangle([left, ground, right, ground + 90], fill=(120, 92, 60))
        for x in range(left + 40, right, 120):
            draw.rectangle([x, ground + 20, x + 60, ground + 80], fill=(95, 70, 45))
    if level >= 1:
        for x in range(left, right + 1, 120):
            draw.rectangle([x - 30, ground - 4, x + 30, ground + 30], fill=(150, 150, 150))
    if level >= 2:
        draw.rectangle([left - 10, ground - 20, right + 10, ground], fill=(140, 140, 140))
    if level >= 3:
        for x in range(left, right + 1, 120):
            draw.rectangle([x - 10, ground - 190, x + 10, ground - 20], fill=(130, 130, 130))
    if level >= 4:
        draw.rectangle([left - 20, ground - 205, right + 20, ground - 185], fill=(120, 120, 120))
        if level >= 5:
            for x in range(left, right + 1, 120):
                draw.rectangle([x - 10, ground - 370, x + 10, ground - 205], fill=(130, 130, 130))
            draw.rectangle([left - 20, ground - 385, right + 20, ground - 365], fill=(120, 120, 120))
    if level >= 5:
        wall = (178, 84, 56) if level == 5 else (190, 190, 190)
        for floor_top, floor_bottom in [(ground - 185, ground - 20), (ground - 365, ground - 205)]:
            draw.rectangle([left, floor_top, right, floor_bottom], fill=wall)
            if level == 5:
                for y in range(floor_top, floor_bottom, 14):
                    draw.line([(left, y), (right, y)], fill=(150, 70, 45))
    if level >= 7:
        for floor_top in [ground - 165, ground - 345]:
            for x in range(left + 40, right - 60, 120):
                draw.rectangle([x, floor_top, x + 60, floor_top + 70], fill=(70, 120, 180), outline="white", width=4)
        draw.rectangle([450, ground - 140, 530, ground - 20], fill=(250, 250, 250), outline=(90, 90, 90), width=3)
    if level >= 9:
        draw.rectangle([left, ground - 365, right, ground - 20], outline=(240, 236, 226), width=10)
    if stage == "paint_in":
        draw.rectangle([600, ground - 160, 720, ground - 40], fill=(245, 241, 230), outline=(176, 138, 62), width=3)
        draw.text((606, ground - 150), "Inside\n2 coats", font=font(18, True), fill=(22, 50, 79))
    if stage == "paint_out":
        draw.line([(left - 40, ground), (left - 40, ground - 390)], fill=(150, 110, 60), width=6)
        draw.line([(left - 70, ground), (left - 70, ground - 390)], fill=(150, 110, 60), width=6)
        for y in range(ground - 380, ground, 40):
            draw.line([(left - 70, y), (left - 40, y)], fill=(150, 110, 60), width=4)
    if level >= 10:
        draw.rectangle([820, ground - 70, 900, ground], fill=(40, 90, 140))
        draw.text((826, ground - 62), "PUMP", font=font(16, True), fill="white")
        draw.line([(860, ground), (860, ground + 60)], fill=(60, 60, 60), width=8)
    if level == 11:
        draw.ellipse([700, 120, 840, 260], fill=(52, 168, 83))
        draw.line([(730, 190), (765, 225), (815, 155)], fill="white", width=12)
    title = dict((key, name) for name, key in BUILDING_STAGES)[stage]
    banner(draw, f"Kalyan Mandap, Aska · {title}", "Drawing for training only. Replace with real site photos.")
    return image


# ── Overhead tank stages ────────────────────────────────────────────────────────────────────
TANK_STAGES = [
    ("Before work: old paint and stains", "before"),
    ("Condition survey", "survey"),
    ("Cleaning and disinfection", "clean"),
    ("Inside epoxy coating", "epoxy"),
    ("Outside weather coat", "outside"),
    ("Ladder and railing repaired", "ladder"),
    ("Sluice valve replaced", "valve"),
    ("Filled, tested and handed back", "done"),
]


def tank(number, stage):
    image = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(image)
    sky_ground(draw)
    cx, top = 480, 150
    body = {"before": (178, 196, 150), "survey": (178, 196, 150), "clean": (190, 200, 170), "epoxy": (190, 200, 170)}.get(
        stage, (236, 240, 232)
    )
    for dx in (-110, -40, 40, 110):
        draw.rectangle([cx + dx - 12, top + 150, cx + dx + 12, 470], fill=(210, 214, 200) if stage in ("outside", "done") else (190, 200, 170))
    for y in (260, 360):
        draw.rectangle([cx - 130, y, cx + 130, y + 14], fill=(200, 205, 190))
    draw.ellipse([cx - 160, top + 110, cx + 160, top + 170], fill=(170, 180, 160))
    draw.rectangle([cx - 130, top, cx + 130, top + 140], fill=body)
    draw.ellipse([cx - 130, top - 25, cx + 130, top + 25], fill=tuple(max(c - 15, 0) for c in body))
    if stage == "before":
        for i in range(14):
            x = cx - 120 + (i * 37) % 240
            draw.line([(x, top + 10), (x + 6, top + 120)], fill=(110, 120, 90), width=5)
    if stage == "clean":
        for i in range(6):
            draw.line([(cx - 200, top + 40 + i * 15), (cx - 130, top + 60 + i * 12)], fill=(80, 150, 220), width=4)
        draw.text((cx - 300, top + 150), "Pressure wash\n+ chlorine", font=font(18, True), fill=(22, 50, 79))
    if stage == "epoxy":
        draw.rectangle([cx - 10, top + 10, cx + 120, top + 130], fill=(110, 160, 210), outline="white", width=3)
        draw.text((cx + 140, top + 40), "Inside: food-grade\nepoxy, 2 coats", font=font(18, True), fill=(22, 50, 79))
    if stage == "outside":
        draw.rectangle([cx - 130, top, cx, top + 140], fill=(178, 196, 150))
        draw.line([(cx - 170, 470), (cx - 170, top - 20)], fill=(150, 110, 60), width=6)
        draw.line([(cx - 190, 470), (cx - 190, top - 20)], fill=(150, 110, 60), width=6)
    if stage == "survey":
        draw.rectangle([700, 130, 880, 330], fill="white", outline=(22, 50, 79), width=4)
        for i, line in enumerate(["Cracks: 2 hairline", "Coating: failed", "Ladder: rusted", "Valves: 1 passing"]):
            draw.text((712, 145 + i * 44), line, font=font(17, True), fill=(22, 50, 79))
    if stage == "ladder":
        for x in (cx + 150, cx + 180):
            draw.line([(x, 470), (x, top + 20)], fill=(220, 120, 40), width=7)
        for y in range(top + 30, 470, 30):
            draw.line([(cx + 150, y), (cx + 180, y)], fill=(220, 120, 40), width=5)
        draw.text((cx + 200, top + 100), "Ladder and railing:\nrust removed,\nenamel 2 coats", font=font(18, True), fill=(22, 50, 79))
    if stage == "valve":
        draw.line([(cx - 40, 470), (cx - 40, 560)], fill=(70, 70, 70), width=16)
        draw.line([(cx - 40, 560), (cx + 260, 560)], fill=(70, 70, 70), width=16)
        draw.ellipse([cx + 70, 520, cx + 150, 600], outline=(200, 40, 40), width=10)
        draw.line([(cx + 110, 520), (cx + 110, 600)], fill=(200, 40, 40), width=6)
        draw.text((cx + 170, 590), "New 100 mm sluice valve", font=font(18, True), fill=(22, 50, 79))
    if stage == "done":
        draw.ellipse([720, 120, 860, 260], fill=(52, 168, 83))
        draw.line([(750, 190), (785, 225), (835, 155)], fill="white", width=12)
    draw.text((cx - 70, top + 55), f"OHT-{number:02d}", font=font(28, True), fill=(22, 50, 79))
    title = dict((key, name) for name, key in TANK_STAGES)[stage]
    banner(draw, f"Sheragada OHT-{number:02d} · {title}", "Drawing for training only. Replace with real site photos.")
    return image


# ── Drawings with dimensions ────────────────────────────────────────────────────────────────
def plan():
    image = Image.new("RGB", (1400, 1000), "white")
    draw = ImageDraw.Draw(image)
    scale = 50  # px per metre
    ox, oy = 150, 140
    rooms = [
        ("MAIN HALL", 0, 0, 18, 12),
        ("STAGE", 18, 0, 4, 12),
        ("KITCHEN", 0, 12, 6, 4),
        ("STORE", 6, 12, 3, 4),
        ("TOILETS (M)", 9, 12, 4, 4),
        ("TOILETS (F)", 13, 12, 4, 4),
        ("STAIR", 17, 12, 5, 4),
    ]
    for name, x, y, w, h in rooms:
        draw.rectangle([ox + x * scale, oy + y * scale, ox + (x + w) * scale, oy + (y + h) * scale], outline="black", width=4)
        draw.text((ox + x * scale + 10, oy + y * scale + 10), f"{name}\n{w:g} m x {h:g} m", font=font(20, True), fill="black")
    draw.line([(ox, oy - 40), (ox + 22 * scale, oy - 40)], fill="black", width=2)
    draw.text((ox + 11 * scale - 40, oy - 75), "22.00 m", font=font(22, True), fill="black")
    draw.line([(ox - 40, oy), (ox - 40, oy + 16 * scale)], fill="black", width=2)
    draw.text((ox - 140, oy + 8 * scale), "16.00 m", font=font(22, True), fill="black")
    for x in range(0, 23, 4 if False else 1):
        pass
    for gx in [0, 4.5, 9, 13.5, 18, 22]:
        for gy in [0, 6, 12, 16]:
            draw.rectangle([ox + gx * scale - 8, oy + gy * scale - 8, ox + gx * scale + 8, oy + gy * scale + 8], fill="black")
    draw.text((ox, oy + 16 * scale + 30), "GROUND FLOOR PLAN · G+1 GOVT KALYAN MANDAP, PAKALAPOLI, ASKA", font=font(20, True), fill=(22, 50, 79))
    draw.text((ox, oy - 120), "SAMPLE DRAWING (not for construction)", font=font(20, True), fill=(176, 60, 40))
    draw.text((ox, oy + 16 * scale + 60), "Columns 300 x 450 mm at grid; walls 230 mm fly ash brick; floor to floor 3.6 m; plinth +0.45 m.", font=font(18), fill="black")
    return image


def elevation():
    image = Image.new("RGB", (1000, 1300), "white")
    draw = ImageDraw.Draw(image)
    cx, scale = 500, 45
    base = 1150
    tank_bottom = base - 15 * scale
    draw.rectangle([cx - 4 * scale, tank_bottom - 4 * scale, cx + 4 * scale, tank_bottom], outline="black", width=4)
    for dx in (-3.5, -1.2, 1.2, 3.5):
        draw.line([(cx + dx * scale, tank_bottom), (cx + dx * scale, base)], fill="black", width=6)
    for level in (5, 10):
        draw.line([(cx - 3.5 * scale, base - level * scale), (cx + 3.5 * scale, base - level * scale)], fill="black", width=4)
    draw.line([(80, base), (920, base)], fill="black", width=3)
    draw.line([(850, base), (850, tank_bottom)], fill="black", width=2)
    draw.text((862, base - 8 * scale), "15.0 m\nstaging", font=font(20, True), fill="black")
    draw.line([(850, tank_bottom), (850, tank_bottom - 4 * scale)], fill="black", width=2)
    draw.text((862, tank_bottom - 3 * scale), "4.0 m\ntank", font=font(20, True), fill="black")
    draw.line([(cx - 4 * scale, tank_bottom - 4 * scale - 40), (cx + 4 * scale, tank_bottom - 4 * scale - 40)], fill="black", width=2)
    draw.text((cx - 60, tank_bottom - 4 * scale - 80), "8.0 m dia", font=font(20, True), fill="black")
    draw.text((60, 40), "OHT ELEVATION · 100 KL RCC OVERHEAD TANK", font=font(22, True), fill=(22, 50, 79))
    draw.text((60, 110), "SAMPLE DRAWING (not for construction)", font=font(20, True), fill=(176, 60, 40))
    draw.text((60, 72), "Inside wetted area about 86 sq m per tank; outside painted area about 380 sq m.", font=font(18), fill="black")
    return image


def main():
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    media = {"photos": {}, "illustrations": [], "drawings": {}}
    if folder:
        for key, name in [("kalyanMandap", "building.jpeg"), ("exampleTank", "reservoir.jpeg")]:
            photo = Image.open(folder / name)
            photo.thumbnail((1280, 1280))
            media["photos"][key] = jpeg(photo, 78)
    for name, key in BUILDING_STAGES:
        media["illustrations"].append({"place": "kalyan", "stage": key, "title": name, "jpeg": jpeg(building(key))})
    # Two more Kalyan Mandap views built on a stage drawing with a note.
    for name, base_stage, note in [
        ("Vitrified tile flooring", "plaster", "Tiles 600 x 600 mm laid\nin hall and stage"),
        ("Site safety check", "columns", "Helmets, shoes, toe boards,\nfirst aid box: checked"),
    ]:
        image = building(base_stage)
        draw = ImageDraw.Draw(image)
        draw.rectangle([0, 46, W, 86], fill=(22, 50, 79))
        draw.text((24, 38), f"Kalyan Mandap, Aska · {name}", font=font(26, True), fill="white")
        draw.rectangle([560, 500, 930, 640], fill="white", outline=(176, 138, 62), width=4)
        draw.text((575, 515), note, font=font(20, True), fill=(22, 50, 79))
        media["illustrations"].append({"place": "kalyan", "stage": base_stage, "title": name, "jpeg": jpeg(image)})
    for number in range(1, 11):
        stages = TANK_STAGES if number <= 3 else TANK_STAGES[:2]
        if number in (4, 5):
            stages = TANK_STAGES[:5]
        for name, key in stages:
            media["illustrations"].append({"place": f"oht{number}", "stage": key, "title": name, "jpeg": jpeg(tank(number, key))})
    media["drawings"]["kalyanPlan"] = png(plan())
    media["drawings"]["ohtElevation"] = png(elevation())
    OUT.write_text(json.dumps(media))
    print(f"{len(media['illustrations'])} illustrations, {len(media['photos'])} photos, 2 drawings → {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
