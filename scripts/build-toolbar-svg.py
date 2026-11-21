#!/usr/bin/env python3
"""Generates the toolbar icons (simplified vector logo) in ../icons/.

toolbar-on-light.svg: dark globe, for light toolbars.
toolbar-on-dark.svg: cream globe, for dark toolbars.
Run from anywhere: python3 scripts/build-toolbar-svg.py
(scripts/ is not part of the extension: exclude it when signing.)
"""
import math
from pathlib import Path

CORAL = "#fd6142"
GLOBES = {"toolbar-on-light.svg": "#2e2e2e", "toolbar-on-dark.svg": "#f6eddb"}

# Geometry, in a 32x32 viewBox (1 unit = 1 physical pixel at 16px on a 2x screen).
# Measured on the original logo, scaled to 30 units wide with a 1 unit margin.
GX, GY, GR = 16.1, 16.0, 10.9           # globe centre and radius
LINE = 1.6                              # globe stroke width
OX, OY, ORX, ORY, OROT = 16.0, 17.6, 14.2, 4.75, 7  # orbit ellipse (rotation in degrees)
ORBIT = 2.0                             # orbit stroke width
T_START, T_END = 218, -38               # visible part of the orbit (front), in degrees
PX, PY, PR, PTIP = 24.5, 10.2, 4.9, 18.4  # pin head centre, radius, tip y
HOLE = 2.1                              # pin hole radius
GAP = 1.1                               # cut-out between the globe and the coral shapes


def orbit_point(t_deg):
    t, r = math.radians(t_deg), math.radians(OROT)
    x = ORX * math.cos(t)
    y = ORY * math.sin(t)
    return OX + x * math.cos(r) - y * math.sin(r), OY + x * math.sin(r) + y * math.cos(r)


def orbit_path():
    (x1, y1), (x2, y2) = orbit_point(T_START), orbit_point(T_END)
    large = 1 if abs(T_START - T_END) > 180 else 0
    # Decreasing angle through the bottom (front) of the ellipse = counter-clockwise on screen.
    return f"M{x1:.2f} {y1:.2f}A{ORX} {ORY} {OROT} {large} 0 {x2:.2f} {y2:.2f}"


def pin_path():
    k = PR * 0.55
    head = (f"M{PX} {PTIP}C{PX - 1.1:.2f} {PTIP - 2.6:.2f} {PX - PR:.2f} {PY + k:.2f} {PX - PR:.2f} {PY}"
            f"A{PR} {PR} 0 1 1 {PX + PR:.2f} {PY}"
            f"C{PX + PR:.2f} {PY + k:.2f} {PX + 1.1:.2f} {PTIP - 2.6:.2f} {PX} {PTIP}Z")
    hole = f"M{PX - HOLE:.2f} {PY}a{HOLE} {HOLE} 0 1 0 {2 * HOLE:.2f} 0a{HOLE} {HOLE} 0 1 0 {-2 * HOLE:.2f} 0Z"
    return head, hole


def globe_lines():
    lat = GR * 0.42
    return "".join([
        f'<circle cx="{GX}" cy="{GY}" r="{GR}"/>',
        f'<ellipse cx="{GX}" cy="{GY}" rx="{GR * 0.48:.2f}" ry="{GR}"/>',
        f'<path d="M{GX} {GY - GR}V{GY + GR}M{GX - GR} {GY}H{GX + GR}'
        f'M{GX - GR} {GY - lat:.2f}H{GX + GR}M{GX - GR} {GY + lat:.2f}H{GX + GR}" clip-path="url(#inside)"/>',
    ])


def svg(globe_color):
    orbit = orbit_path()
    head, hole = pin_path()
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <defs>
    <clipPath id="inside"><circle cx="{GX}" cy="{GY}" r="{GR}"/></clipPath>
    <mask id="cuts" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
      <rect width="32" height="32" fill="#fff"/>
      <path d="{orbit}" fill="none" stroke="#000" stroke-width="{ORBIT + 2 * GAP}" stroke-linecap="round"/>
      <path d="{head}" fill="#000" stroke="#000" stroke-width="{2 * GAP}" stroke-linejoin="round"/>
    </mask>
  </defs>
  <g mask="url(#cuts)" fill="none" stroke="{globe_color}" stroke-width="{LINE}">{globe_lines()}</g>
  <path d="{orbit}" fill="none" stroke="{CORAL}" stroke-width="{ORBIT}" stroke-linecap="round"/>
  <path d="{head}{hole}" fill="{CORAL}" fill-rule="evenodd"/>
</svg>
"""


if __name__ == "__main__":
    here = Path(__file__).resolve().parent.parent / "icons"
    for name, color in GLOBES.items():
        (here / name).write_text(svg(color))
        print("wrote", here / name)
