# Pool Equipment Inventory

Identified from equipment nameplate photos (2026-06-04). Values marked **(nameplate)** are
read directly from the labels; **(standard spec)** are typical published specs for that model
and should be confirmed against the manual; **(needs confirmation)** is not yet known.

This is reference for a future pump-tuning effort. The app does **not** write pump speeds —
see `docs/superpowers/specs/2026-06-04-pumps-view-design.md` (read-only Pumps view) and the
deferred adjustment work.

## Automation / control

- **Pentair EasyTouch** automation on a **Compool LX3600** retrofit panel
  ("Compool EasyTouch Upgrade"). Panel board part: **Compool PC-LX3600** (nameplate).
- This is the controller the ScreenLogic gateway **EE-59-51** connects to.
- Keypad circuits (confirm the gateway mapping): Filter Pump, Cleaner, Pool Light, Spa Light,
  Yard Lights, Spillway, Aux 6, Aux 7; plus Heater and **Solar** buttons. The panel is wired
  for solar/water/freeze sensors and a gas-valve heater relay.
- Electrical sub-panel: **T40000R170**, 100 A, 120/240 V single-phase (nameplate).

## Main pump (variable speed)

- **Pentair IntelliFlo 2 VST** variable-speed pump. Part marking **354038A** (nameplate).
  ENERGY STAR labeled.
- The gateway reports this pump as `pumpType=3` → IntelliFlo VS family.
- **RPM range: ~450–3450 RPM** (standard spec — confirm for this exact model).
- Currently programmed per-circuit speeds (read live from the pump):
  Pool 2600 · Spa 3450 · Cleaner 2400 · Spillway 2750 RPM.
- Drives filtration/circulation. The pool's water features and filtering run off this pump.

## Booster pump (cleaner)

- **Hayward** booster pump; motor **A.O. Smith `C48K2N143B4`**, **¾ HP**, 115/230 V,
  single-speed (nameplate). Labeled "Booster Pump … for swimming pools, hot tubs and spas."
- Single-speed (not RPM-adjustable). Runs a **pressure-side cleaner** when the **Cleaner**
  circuit is on. Because the cleaner has its own booster, the IntelliFlo "Cleaner" preset only
  needs to circulate, not power the cleaner head.

## Heater

- **Jandy JXi400N** (model **JXI400NK**), **400,000 BTU**, **natural gas** pool & spa heater.
  SN **(serial omitted)** (nameplate).
- Confirms the app's gas-heater model: heat mode HEATER (3) = enabled, OFF (0) = disabled.
- Has a **minimum flow requirement to fire** (needs confirmation — check the JXi manual for
  the exact GPM). Do not run the pump below that while heating.

## Filter

- **Hayward Micro-Clear DE4800** — **48 sq ft diatomaceous-earth (D.E.) filter** (nameplate).
- **Max design flow ≈ 96 GPM** (standard spec for a 48 sq ft DE filter at ~2 GPM/sq ft; the
  nameplate flow table also shows ~96 GPM). This is the **upper bound for filtering flow**.

## For future pump tuning (with a pool professional)

Inputs needed to choose safe/efficient RPM targets:
- ✅ Pump model & range — IntelliFlo 2 VST, ~450–3450 RPM.
- ✅ Filter ceiling — DE4800, ~96 GPM max.
- ✅ Heater present — JXi400N; respect its minimum firing flow (confirm GPM from manual).
- ✅ Cleaner — separate Hayward booster; IntelliFlo "Cleaner" preset only circulates.
- ❓ **Pool volume (gallons)** — not on any nameplate; needed for turnover (~1 turnover/day).
- ❓ Heater minimum firing flow (GPM) — confirm from the JXi manual.

General principle (not a recommendation for specific numbers): pump power scales ~cube of
speed, so lower RPM saves large amounts of energy — but flow must stay high enough to filter
(≤ ~96 GPM but enough to turn the water over), and high enough for the heater to fire while
heating. A pool professional should set the actual targets using the pool volume + these specs.
