---
name: Pilothouse Operational System
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#45464d'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#006399'
  on-secondary: '#ffffff'
  secondary-container: '#7bc2ff'
  on-secondary-container: '#004f7b'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#111c2d'
  on-tertiary-container: '#79849a'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#cde5ff'
  secondary-fixed-dim: '#94ccff'
  on-secondary-fixed: '#001d32'
  on-secondary-fixed-variant: '#004b74'
  tertiary-fixed: '#d8e3fb'
  tertiary-fixed-dim: '#bcc7de'
  on-tertiary-fixed: '#111c2d'
  on-tertiary-fixed-variant: '#3c475a'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.015em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.005em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.04em
  metric-xl:
    fontFamily: JetBrains Mono
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.03em
  metric-lg:
    fontFamily: JetBrains Mono
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.02em
  metric-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0em
  metric-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-lg: 1.5rem
  margin: 1rem
  margin-md: 1.5rem
  margin-lg: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
  space-2xl: 2rem
---

## Brand & Style

This design system draws direct inspiration from modern maritime pilothouses and avionics flight decks: engineered instruments designed for high-stakes command, calm operational focus, and instantaneous situational awareness. Built for senior leadership teams and executive operators in agile, high-performance environments, the aesthetic discards decorative noise, hyper-saturated trends, and novelty interactions.

The visual language balances calculated precision with understated authority:
- **Calm, High-Information Density:** Interfaces present metrics, OKRs, and operating cadences with structured hierarchy, avoiding visual clutter through intentional grid architecture.
- **Instrument-Grade Readability:** Critical states can be assessed in under 200 milliseconds via deliberate contrast, semantic status indicators, and tabular precision.
- **Structural Integrity:** Spatial relationships rely on razor-thin 1px structural framing, disciplined alignment, and tactile surfaces that communicate stability, rigor, and executive control.

## Colors

The palette establishes an oceanic, instrument-grade command environment. Deep slate and navy tones establish structural anchors, supported by cool off-white porcelain surfaces that minimize eye strain during intense weekly review cycles.

### Functional Roles
- **Command Navies & Slates:**
  - `#0f172a` (Primary): Deepest obsidian navy for high-priority typography, primary action surfaces, and active navigation states.
  - `#1e293b` (Tertiary): Deep slate for secondary headers, focused states, and structural panel backdrops.
  - `#0369a1` (Secondary Oceanic): Marine beacon blue reserved for interactive anchors, active tabs, focus rings, and selection indicators.
- **Surfaces & Architecture:**
  - `#ffffff`: Primary card, table row, and sheet background.
  - `#f8fafc`: Canvas background and inactive container fills.
  - `#f1f5f9`: Sub-panel fills, hover states, and disabled tracks.
  - `#e2e8f0` & `#cbd5e1`: Structural 1px boundary lines, cell dividers, and precision rulers.
- **Telemetry & Status Signals (Muted High-Fidelity):**
  - **On Track / Nominal:** `#15803d` (Ink), `#dcfce7` (Surface), `#86efac` (Border).
  - **Caution / Warning:** `#b45309` (Ink), `#fef3c7` (Surface), `#fcd34d` (Border).
  - **Critical / Off Track:** `#b91c1c` (Ink), `#fee2e2` (Surface), `#fca5a5` (Border).
  - **Neutral / Standby:** `#475569` (Ink), `#f1f5f9` (Surface), `#cbd5e1` (Border).

## Typography

The typography strategy pairs Inter's legible, neutral grotesque design with the strict computational cadence of JetBrains Mono.

- **Tabular Numerals Everywhere:** All instances of Inter handling metrics, dates, percentages, and financial figures must enforce OpenType `tnum` (tabular figures) and `cv05` features to guarantee strict vertical column alignment across dense grids.
- **Flight-Deck Data Fields:** Numerical values, countdowns, timestamps, and status metrics are routed through the `metric-*` scale using JetBrains Mono, reinforcing the visual rhythm of an instrument console.
- **Uppercase Structural Micro-Labels:** `label-sm` is employed exclusively for subheaders, column labels, status tags, and instrument metadata, rendered in uppercase with positive letter spacing (`0.04em`) to establish crisp visual grouping.

## Layout & Spacing

The layout model uses a disciplined, non-elastic dashboard architecture. Data is nested within consistent visual tracks with minimal horizontal shifting during live updates.

- **Grid Framework:** A 12-column desktop grid with a locked max-width container (`1440px`), 24px gutters, and 32px outer canvas margins. Desktop operations favor side-docked navigational telemetry (260px fixed width) paired with a primary command canvas.
- **Sub-Grid Rhythm:** All component padding, internal module margins, and gap variables adhere to a strict 4px/8px incremental rhythm. Table cell padding is compressed (`8px 12px`) for high scannability, while executive briefing cards utilize relaxed spacing (`16px 20px`).
- **Breakpoints & Reflow:**
  - **Desktop (≥ 1280px):** 12 columns. Full multi-column scorecard, simultaneous display of cadence timers, objectives, and metric graphs.
  - **Tablet (768px - 1279px):** 8 columns. Sidebar collapses to an iconified instrument bar; metric grids reflow from 4-across to 2-across.
  - **Mobile (< 768px):** 4 columns. Margins contract to 16px. Status strips switch to horizontal sliding pill docks; nested trees collapse into flat drill-down views.

## Elevation & Depth

This system avoids expressive or dramatic dropshadows. Depth is articulated through functional layering, surface brightness variance, and crisp 1px borders.

- **Base Layer (Level 0):** Canvas `#f8fafc`. Completely matte. Serves as the structural deck.
- **Instrument Container (Level 1):** Solid `#ffffff` background bounded by a continuous 1px `#e2e8f0` border, resting on a nearly imperceptible baseline shadow: `0 1px 2px 0 rgba(15, 23, 42, 0.04)`.
- **Raised Interactive Panes & Flyouts (Level 2):** Focused rows, contextual inspection panels, and active scorecard cells lift via a controlled dual shadow: `0 1px 3px 0 rgba(15, 23, 42, 0.08), 0 4px 6px -2px rgba(15, 23, 42, 0.04)`, enclosed with `#cbd5e1`.
- **Command Overlays & Modals (Level 3):** Dialogs, hotkey command palettes, and meeting timer overlays utilize `0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.04)` over a dimming veil (`rgba(15, 23, 42, 0.4)` with `backdrop-filter: blur(2px)`).

## Shapes

The geometric framework balances human comfort with functional engineering:
- **Standard Radius (8px / `0.5rem`):** Applied to cards, input fields, structural tiles, dropdown menus, and table containers. Provides a modern, calm enclosure without feeling circular or casual.
- **Compact Radius (4px / `0.25rem`):** Assigned to inner-nested items, checkboxes, data tags, code blocks, and keyboard shortcuts (`kbd`).
- **Pill Capsulation (`9999px`):** Restricted solely to telemetry indicators: operational status badges, round-trip sync dots, and countdown timer chips. This distinctive shape immediately communicates that an element represents dynamic system state rather than a layout container.

## Components

### Buttons & Actions
- **Primary Command:** Solid `#0f172a` fill, white `#ffffff` typography, 8px radius, height 36px (compact) or 40px (standard). Hover: `#1e293b`. Active: `#020617`. Focus: 2px offset ring in `#0369a1`.
- **Secondary / Instrument Outline:** White `#ffffff` fill with 1px `#cbd5e1` outline, `#0f172a` text. Hover: `#f8fafc` background with `#94a3b8` border.
- **Ghost / Utility:** Transparent fill, `#475569` text. Hover: `#f1f5f9` surface with `#0f172a` text.

### Badges & Status Indicators
- Constructed with a fully pill-shaped boundary, height 24px, interior padding `2px 8px 2px 6px`.
- Contains a mandatory 6px solid circular status dot on the leading edge.
- **Passing / Green:** Background `#dcfce7`, text `#15803d`, dot `#16a34a`.
- **Warning / Amber:** Background `#fef3c7`, text `#b45309`, dot `#d97706`.
- **Critical / Red:** Background `#fee2e2`, text `#b91c1c`, dot `#dc2626`.
- **Neutral / Standby:** Background `#f1f5f9`, text `#475569`, dot `#94a3b8`.

### Precision Tables & Scorecards
- Outer wrapper encased in 1px `#e2e8f0` border with 8px corner radii.
- Headers: `#f8fafc` surface, 32px height, typography `label-sm` in `#64748b`, bottom border 1px `#cbd5e1`.
- Rows: 44px fixed height. Alternate hover state `#f8fafc`. Dividers: 1px `#f1f5f9`.
- Metric Cells: JetBrains Mono tabular display, right-aligned for all numerical parameters.

### Checklist & Cadence Rows
- Full-width interactive horizontal tracks. 
- Left section contains a custom 16px square checkbox with 4px corner radius and a 1.5px border (`#cbd5e1`). Checked state fills `#0f172a` with an interior checkmark.
- Hovering illuminates the entire row with a subtle `#f8fafc` tint and reveals inline assignment metadata.

### Instrument Status Strip
- A persistent horizontal operational banner docked at the top of the command view.
- Segmented into discreet diagnostic zones: Current Cadence Phase, Company North Star Velocity, Countdown to Executive Adjournment, and Flagged Impediments.
- Zones are partitioned by 1px vertical borders (`#e2e8f0`) with baseline `#ffffff` surface.

### Countdown Timers & Segmented Controls
- **Meeting Cadence Timer:** Monospaced display inside a `#0f172a` pill badge with pale green or amber counter text, displaying elapsed versus remaining time.
- **Segmented Control Tabs:** Recessed `#f1f5f9` track with 6px internal radius. Selected segment is an elevated `#ffffff` tile carrying a crisp `0 1px 2px rgba(0, 0, 0, 0.05)` shadow and `#0f172a` text weight `500`.

### Form Fields & Inputs
- Height 38px, background `#ffffff`, border 1px `#cbd5e1`, 8px radius.
- Text uses `body-md` in `#0f172a`. Placeholder text `#94a3b8`.
- Focus state: Border transitions to `#0369a1` accompanied by a 3px soft blue ring (`rgba(3, 105, 161, 0.15)`).