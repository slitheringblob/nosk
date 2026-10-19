# Terminal Mono — Design System

A reusable design language for developer-flavoured web apps: dark-first, monospace everywhere,
hairline borders, square corners, and one warm accent. It reads like a well-made terminal, not a
retro gimmick.

Inspired by the aesthetic of [px0.ai](https://px0.ai) and the
[Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme) palette. Borrow the look, not
anyone's logo, name or copy.

Everything here is framework-agnostic: CSS custom properties plus a few conventions. A copy-paste
starter stylesheet is at the end ([§13](#13-starter-stylesheet)).

---

## 1. Principles

1. **Monospace everywhere.** One typeface for UI, content and code. Hierarchy comes from size,
   weight, case and colour — never from switching fonts.
2. **Square and flat.** Border radius is `0`. Surfaces are separated by 1px hairlines, not
   shadows. Only things that float above the page (menus, modals, toasts) cast a shadow.
3. **One accent, used sparingly.** Amber marks *the* primary action, the current selection,
   focus, and live state. If everything is amber, nothing is.
4. **Quiet chrome, loud content.** Navigation and controls are small, dim and uppercase-labelled;
   the user's content is larger and brighter.
5. **Translucent layers.** Surfaces are low-alpha tints of the text colour over the background, so
   they stack naturally and adapt to both themes.
6. **Reveal on intent.** Secondary controls (block toolbars, row actions) appear on hover/focus
   and stay out of the way otherwise.
7. **Terminal voice, human meaning.** Shell-flavoured details (`~/path`, `$ sign in`, `01/section`)
   decorate; they never replace clear labels.

---

## 2. Colour

All colours are tokens on `:root` (dark, the default) and overridden under
`[data-theme="light"]`. Components use tokens only — never raw hex values.

### 2.1 Tokens

| Token | Dark | Light | Role |
|-------|------|-------|------|
| `--bg` | `#06070b` | `#f4f5f8` | Page background |
| `--bg-elev` | `#0b0c12` | `#ffffff` | Sidebars, sticky chrome |
| `--panel` | `#0d0e16` | `#ffffff` | Opaque floating surfaces (modals, menus, toasts) |
| `--surface` | `#c0caf507` | `#0b0d1406` | Subtle fill (inputs, cards) |
| `--surface-2` | `#c0caf50e` | `#0b0d140d` | Hover fill, table headers |
| `--surface-3` | `#c0caf516` | `#0b0d1414` | Tracks, pressed states |
| `--bdr` | `#c0caf517` | `#0b0d141a` | Default hairline |
| `--bdr-hi` | `#c0caf533` | `#0b0d1438` | Inputs, buttons, emphasised hairline |
| `--txt` | `#e4e8f7` | `#0b0d14` | Primary text |
| `--txt-2` | `#9ba3c4` | `#454c5e` | Secondary text, body copy in chrome |
| `--txt-3` | `#747b9e` | `#686f82` | Meta, labels, eyebrows |
| `--txt-4` | `#3a4060` | `#b3b9c6` | Placeholders, disabled, decorative only |
| `--amber` | `#fbbf24` | `#b45309` | Accent text/lines, active states |
| `--amber-fill` | `#fcd34d` | `#fcd34d` | Primary button fill (same in both themes) |
| `--amber-fill-hover` | `#fef08a` | `#fef08a` | Primary button hover |
| `--amber-fill-active` | `#fbbf24` | `#fbbf24` | Primary button pressed |
| `--on-amber` | `#0b0a06` | `#0b0a06` | Text on amber fill |
| `--amber-wash` | `#fbbf2412` | `#b453090f` | Selected/hover background tint |
| `--amber-line` | `#fbbf2452` | `#b4530959` | Accent borders |
| `--amber-glow` | `#fbbf2459` | `#b4530938` | Glows, drop indicators |
| `--blue` | `#7aa2f7` | `#0969da` | Links, info |
| `--cyan` | `#7dcfff` | `#0550ae` | Secondary info, tags in code |
| `--violet` | `#bb9af7` | `#8250df` | Notes, keywords |
| `--green` | `#9ece6a` | `#116329` | Success, "online/synced" |
| `--rose` | `#f7768e` | `#cf222e` | Errors, destructive |
| `--orange` | `#ff9e64` | `#953800` | Inline code, numbers |
| `--grid` | `#c0caf509` | `#0b0d140b` | Background grid lines |
| `--nav-bg` | `#06070bd6` | `#f4f5f8e0` | Translucent sticky bars |
| `--scrim` | `#000000a6` | `#0b0d1440` | Modal backdrop |

**Code surfaces**: in the dark theme, code blocks sit on `--code-surface: #0a0c14` with a
`--code-surface-header: #0f111c` toolbar. In the light theme there are two valid choices:
keep code blocks dark (strong "terminal" feel), or render them on `--bg-elev` with a
`--surface-2` toolbar (calmer). Pick one per product and use it everywhere.

### 2.2 Contrast (WCAG 2.x, against `--bg` / `--panel`)

| Token | Dark | Light | Use for |
|-------|------|-------|---------|
| `--txt` | 16.5 | 17.8 | Anything |
| `--txt-2` | 8.1 | 7.9 | Anything |
| `--txt-3` | 4.9 / 4.6 | 4.6 / 5.0 | Small text OK (AA) — labels, meta |
| `--txt-4` | 2.0 | 1.8 | **Never for information.** Placeholders, disabled, ornaments |
| `--amber` | 12.1 | 4.6 | Text and icons |
| `--on-amber` on `--amber-fill` | 13.7 | 13.7 | Primary buttons |
| Status colours | 7.6–11.7 | 4.6–7.0 | Text and icons |

Rules:
- Never communicate state with colour alone — pair it with text, an icon, or a shape
  (e.g. a status dot *and* a label; a "ro" badge, not just a grey title).
- Translucent tokens are for fills and lines, not text.

### 2.3 Using the accent

Use amber for: the primary button, the active nav item / tab / selected row, focus rings, text
selection, the blinking cursor, progress, and "live" indicators. Do **not** use it for: body
links (use `--blue`), decorative borders, more than one button per view, or large background
areas (use `--amber-wash` if you need a tint).

Status colour mapping: info `--blue`, success `--green`, warning `--amber`, error `--rose`,
neutral/note `--violet`. Tinted panels use `color-mix(in srgb, <colour> 7%, transparent)` with a
2px left border in the solid colour.

---

## 3. Typography

### 3.1 Font

```css
--mono: "JetBrains Mono", ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
```

Load weights 400, 500, 600, 700, 800 (+ italic 400). On `body`:

```css
font-feature-settings: "zero" 1;   /* slashed zero: 0 vs O */
font-variant-ligatures: none;      /* no == → ≡ surprises in content */
-webkit-font-smoothing: antialiased;
```

If the webfont can't load (offline), the system monospace fallback must still look right — test it.

### 3.2 Scale

| Role | Size | Weight | Tracking | Line height | Notes |
|------|------|--------|----------|-------------|-------|
| Hero | `clamp(38px, 6vw, 84px)` | 800 | `-0.06em` | 0.94 | Second line in `--amber` |
| Page title | `clamp(28px, 3.6vw, 42px)` | 800 | `-0.045em` | 1.08 | |
| H1 | 28px | 800 | `-0.035em` | 1.25 | |
| H2 | 21px | 800 | `-0.035em` | 1.25 | |
| H3 | 16px | 800 | `-0.02em` | 1.25 | |
| Dialog title | 16px | 700 | `-0.02em` | 1.3 | |
| Content body | 14px | 400 | 0 | 1.7 | User-authored text |
| UI base | 13px | 400 | 0 | 1.6 | `body` default |
| Controls | 12–12.5px | 500–600 | 0 | — | Buttons, inputs, nav |
| Meta | 11–11.5px | 400 | `0.02em` | 1.5 | Timestamps, counts |
| Eyebrow | 10.5px | 600 | `0.1em` | — | UPPERCASE, `--txt-3` |
| Micro badge | 9.5–10px | 700 | `0.08em` | — | UPPERCASE |

Rules of thumb:
- **Big text gets negative tracking; tiny uppercase text gets positive tracking.**
- Never go below 9.5px. Uppercase only for labels ≤ 11px, never for sentences.
- Tabular figures (`font-variant-numeric: tabular-nums`) for counts, versions and progress.

### 3.3 The eyebrow and section index

Small uppercase labels sit above titles, sections and form fields:

```
~/PAGES                       ← breadcrumb eyebrow, "~/" in amber
01/PAGES   02/SHARED          ← numbered section index, zero-padded
```

Numbering (`01/`, `02/`…) is for peer sections of the same list (sidebar groups, tabs, feature
cards). Don't number a single item.

---

## 4. Space, size & layout

- **Base unit 2px**, practical steps: 2, 4, 6, 8, 10, 12, 14, 16, 18, 24, 32, 48, 64.
  Tight inside components (4–10), roomy between sections (24–64).
- **Control heights**: 34px default, 28px small, 22px inline/toolbar, icon buttons 28×28.
- **App shell**: sidebar 272px, side drawer 360px, top bar 48px, reading column ~760px.
- **Background grid** is 32px — align large layout gaps to multiples of 8 so it feels intentional.
- **Breakpoints**: `1180px` (drawers overlay instead of push), `860px` (sidebar becomes an
  off-canvas panel; single-column layouts), `520px` (hide tertiary actions).
- Mobile: 16–22px side gutters, no horizontal page scroll, tap targets ≥ 28px with spacing.

---

## 5. Shape, borders & elevation

| Element | Treatment |
|---------|-----------|
| Radius | `0` everywhere (inputs, buttons, cards, avatars, checkboxes where styleable) |
| Default border | `1px solid var(--bdr)` |
| Interactive border | `1px solid var(--bdr-hi)` → `var(--amber-line)` on hover/focus |
| Selected list item | `background: var(--amber-wash)` + `2px` left border in `--amber` |
| Active tab | `2px` bottom border in `--amber`, label in `--amber` |
| Callout / tinted panel | `1px` border + `2px` left border in the status colour |
| Empty / drop target | `1px dashed var(--bdr-hi)` |
| Cards & panels | No shadow |
| Floating layers | `box-shadow: var(--shadow-float)` |

```css
--shadow-float: 0 60px 140px -60px #000000f2;            /* dark  */
--shadow-float: 0 50px 100px -50px #0b0d1459;            /* light */
```

Sticky chrome (top bar, sidebar) is translucent:
`background: var(--nav-bg); backdrop-filter: blur(14px) saturate(140%);` with a hairline edge.
Modal and palette backdrops use `var(--scrim)` + `backdrop-filter: blur(3px)`.

---

## 6. Atmosphere

Two fixed, non-interactive background layers give depth without noise:

- **Grid**: 1px lines every 32px in `--grid`, masked with a radial gradient so it fades out
  below the fold.
- **Glow**: two blurred radial gradients — amber top-left, blue top-right — at ~70% opacity
  (50% in light theme).

Plus one signature motif: a **blinking block cursor** (`--amber`, `0.5em × 0.82em`,
`1.05s step-end`) after the wordmark and hero headline. Use it once or twice per screen, never
in body text.

Keep atmosphere behind the content (`z-index: 0`, `pointer-events: none`); app UI sits on
`z-index: 1+`.

---

## 7. Components

Each entry lists the anatomy and the states that must exist.

**Buttons**
- *Primary* — `--amber-fill` background, `--on-amber` text, weight 600; hover
  `--amber-fill-hover`; active `--amber-fill-active`. One per view.
- *Ghost* — transparent, `--bdr-hi` border, `--txt` text; hover: `--amber-line` border,
  `--amber-wash` fill, `--amber` text.
- *Danger* — transparent, rose border at 50% mix, `--rose` text; hover 12% rose fill.
- *Icon* — 28×28, transparent border that appears on hover with `--surface-2`.
- *Link button* — `--txt-2`, underline in `--bdr-hi`, offset 3px; hover turns amber.
- Labels are lowercase verbs (`new page`, `share`); terminal prompts are allowed on hero/auth
  CTAs (`$ sign in`). Disabled = 45% opacity + `not-allowed` cursor.

**Inputs** — `--surface` fill, `--bdr-hi` border, 7×10px padding, 12.5px text; focus:
`--amber-line` border + `--surface-2` fill, no glow. Placeholders `--txt-3`. Checkbox/range use
`accent-color: var(--amber)`. Labels are eyebrows above the field.

**Keycaps (`kbd`)** — 20px tall, `--bdr-hi` border with a **2px bottom border**, `--surface`
fill, 10.5px `--txt-2`. Show the platform modifier (`⌘K` on macOS, `Ctrl+K` elsewhere).

**Badges** — 9.5px uppercase, `0.08em` tracking, `--amber` text, `--amber-line` border,
`--amber-wash` fill. Neutral variant uses `--bdr` and `--txt-3`.

**Status pill** — 22px, uppercase 10px label + 6px square dot: green = ok, amber blinking = busy,
`--txt-3` = offline, rose = error/attention. The label always states the status in words.

**Navigation item** — 12.5px `--txt-2`; hover `--txt` + `--surface-2`; active `--txt` +
`--amber-wash` + 2px amber left border. Leading icon column 18px wide in `--txt-3`.

**Tabs** — uppercase 11px labels with section indices (`01/account`), 2px amber underline on
the active tab.

**Segmented control** — bordered group; active segment filled `--amber-fill`/`--on-amber`.

**Menus & popovers** — `--panel`, `--bdr-hi` border, float shadow, 4px vertical padding; items
6×12px with an icon column, hover/focus = `--amber-wash` + amber text; optional uppercase
heading rows and 1px separators; keyboard: arrows, Enter, Esc.

**Command palette** — centred at ~12vh, 620px max; prompt row with an amber sigil (`>` for
actions, `?` for search) and a borderless 14px input; results with 2px amber left border on the
selected row; footer of keycap hints.

**Modal** — `--panel`, float shadow, header = eyebrow + title + close (×), 16–18px padding,
actions right-aligned (ghost then primary). Esc and backdrop click close; focus returns to the
opener.

**Toast** — bottom-right, `--panel`, 2px left border coloured by type (blue/amber/rose/green),
optional single action button in amber outline; auto-dismiss 3.5s (8s if it has an action).

**Terminal window card** — for auth or showcase panels: a 34px header in
`--code-surface-header` with three 8px outlined squares and a `~/path` label, then the body.

**Avatar** — square 22px, initial letter, `--amber-wash` fill, `--amber-line` border.

**Tag chip** — 22px, `#tag` in amber on `--amber-wash` with `--amber-line` border; remove `×`
in `--txt-3` → rose on hover.

**Code block** — dark code surface, toolbar with three outlined squares on the left and
controls on the right, 12.5px code at line-height 1.65. Syntax colours: comment `#565f89`,
keyword `#bb9af7`, string `#9ece6a`, number `#ff9e64`, function `#7aa2f7`, tag `#7dcfff`.

**Progress** — 3px track in `--surface-3`, amber fill, numeric label in tabular 10.5px.

**Empty states** — dashed `--bdr-hi` box, `--txt-3` text that says what to do
("Empty page. Click here or press Enter to start writing.").

---

## 8. Motion

| What | Duration | Easing |
|------|----------|--------|
| Colour / border / background on hover | 120–150ms | default |
| Reveal-on-hover controls (opacity) | 120ms | default |
| Popover / menu / palette in | 120ms, from `translateY(-3px)` + fade | ease-out |
| Toast / modal in | 160–180ms, from `translateY(6px)` + fade | ease-out |
| Off-canvas sidebar | 200ms transform | ease |
| Cursor blink | 1.05s `step-end` infinite | — |

No bounces, no scale-ups, no long fades. Respect `prefers-reduced-motion` by disabling
animations and transitions.

---

## 9. Interaction & accessibility

- **Focus**: `:focus-visible { outline: 1px solid var(--amber); outline-offset: 2px; }` —
  never remove it without a replacement.
- **Selection**: `::selection { background: var(--amber-fill); color: #08080b; }`.
- **Keyboard first**: every action reachable by keyboard; menus/lists use arrows + Enter + Esc;
  publish shortcuts with keycaps in menus and a shortcuts reference.
- Hover-revealed controls must also appear on `:focus-within`, and on touch layouts they should
  be permanently visible or reachable through a menu.
- Icons-only buttons need `aria-label`; dialogs `role="dialog" aria-modal="true"`; live status
  regions `aria-live="polite"`.
- Hit targets ≥ 28px desktop, ≥ 40px preferred on touch.
- Check contrast when adding tokens; `--txt-4` is decoration only (§2.2).

---

## 10. Theming implementation

1. Define tokens on `:root` (dark), override on `:root[data-theme="light"]`.
2. Set `color-scheme: dark | light` in each block so native controls (scrollbars, date pickers)
   match.
3. Store the preference as `system | dark | light`; resolve `system` with
   `matchMedia('(prefers-color-scheme: dark)')` and listen for changes.
4. Apply `data-theme` **before first paint** with a tiny inline script in `<head>` to avoid a
   flash:

```html
<script>
  (function () {
    var pref = 'system';
    try { pref = localStorage.getItem('theme') || 'system'; } catch (e) {}
    var dark = matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = pref === 'system' ? (dark ? 'dark' : 'light') : pref;
  })();
</script>
```

5. Set `<meta name="theme-color" content="#06070b">` for mobile browser chrome.
6. Swap any third-party stylesheet that has its own theme (syntax highlighting) when the theme
   changes.

---

## 11. Voice & content

- **Lowercase UI labels** (`new page`, `templates`, `sign out`); sentence case for messages and
  descriptions; UPPERCASE only via CSS on eyebrows/badges.
- **Shell flavour as garnish**: `~/` breadcrumbs, `$` on hero/auth CTAs, `>` and `?` palette
  sigils, `01/` section indices. One or two per screen.
- **Headlines in two beats**, second beat in amber: "Write it down. / Sync everywhere."
- Errors say what happened and what to do: "Cannot reach the server. Is the backend running?"
- Prefer specific nouns over generic ones ("3 pending", "1 conflict", "edited 2m ago").

---

## 12. Do & don't

| Do | Don't |
|----|-------|
| One typeface, hierarchy via size/weight/case | Mix in a sans-serif "for readability" |
| Hairlines and translucent fills | Drop shadows on cards |
| One amber primary per view | Amber borders on everything |
| Square corners | "Just a little" 4px radius |
| Dim, small chrome; bright, larger content | Equal weight everywhere |
| Status = colour **and** words | A red dot as the only error signal |
| Tokens only in components | Raw hex values in component CSS |
| Terminal details as accents | ASCII art, scanlines over content, green-on-black pastiche |

---

## 13. Starter stylesheet

Drop this into a new project as `tokens.css` (+ base) and build components on top.

```css
:root {
    --bg: #06070b;
    --bg-elev: #0b0c12;
    --panel: #0d0e16;
    --surface: #c0caf507;
    --surface-2: #c0caf50e;
    --surface-3: #c0caf516;
    --code-surface: #0a0c14;
    --code-surface-header: #0f111c;
    --bdr: #c0caf517;
    --bdr-hi: #c0caf533;
    --txt: #e4e8f7;
    --txt-2: #9ba3c4;
    --txt-3: #747b9e;
    --txt-4: #3a4060;
    --amber: #fbbf24;
    --amber-fill: #fcd34d;
    --amber-fill-hover: #fef08a;
    --amber-fill-active: #fbbf24;
    --on-amber: #0b0a06;
    --amber-wash: #fbbf2412;
    --amber-line: #fbbf2452;
    --amber-glow: #fbbf2459;
    --blue: #7aa2f7;
    --cyan: #7dcfff;
    --violet: #bb9af7;
    --green: #9ece6a;
    --rose: #f7768e;
    --orange: #ff9e64;
    --grid: #c0caf509;
    --nav-bg: #06070bd6;
    --scrim: #000000a6;
    --shadow-float: 0 60px 140px -60px #000000f2;
    --mono: "JetBrains Mono", ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
    color-scheme: dark;
}

:root[data-theme="light"] {
    --bg: #f4f5f8;
    --bg-elev: #fff;
    --panel: #fff;
    --surface: #0b0d1406;
    --surface-2: #0b0d140d;
    --surface-3: #0b0d1414;
    --bdr: #0b0d141a;
    --bdr-hi: #0b0d1438;
    --txt: #0b0d14;
    --txt-2: #454c5e;
    --txt-3: #686f82;
    --txt-4: #b3b9c6;
    --amber: #b45309;
    --amber-wash: #b453090f;
    --amber-line: #b4530959;
    --amber-glow: #b4530938;
    --blue: #0969da;
    --cyan: #0550ae;
    --violet: #8250df;
    --green: #116329;
    --rose: #cf222e;
    --orange: #953800;
    --grid: #0b0d140b;
    --nav-bg: #f4f5f8e0;
    --scrim: #0b0d1440;
    --shadow-float: 0 50px 100px -50px #0b0d1459;
    color-scheme: light;
}

*, *::before, *::after { box-sizing: border-box; }

body {
    margin: 0;
    background: var(--bg);
    color: var(--txt);
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.6;
    font-feature-settings: "zero" 1;
    font-variant-ligatures: none;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

::selection { background: var(--amber-fill); color: #08080b; }
:focus-visible { outline: 1px solid var(--amber); outline-offset: 2px; }
button, input, select, textarea { font: inherit; color: inherit; }

/* Atmosphere — place <div class="atmos"><div class="atmos-glow"></div><div class="atmos-grid"></div></div> first in <body> */
.atmos { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.atmos-glow {
    position: absolute; inset: -30% -10% auto; height: 90vh; filter: blur(20px); opacity: .7;
    background:
        radial-gradient(40% 40% at 22% 30%, #fbbf2417, transparent 70%),
        radial-gradient(40% 40% at 80% 20%, #7aa2f71a, transparent 72%);
}
:root[data-theme="light"] .atmos-glow { opacity: .5; }
.atmos-grid {
    position: absolute; inset: 0;
    background-image: linear-gradient(var(--grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--grid) 1px, transparent 1px);
    background-size: 32px 32px;
    mask-image: radial-gradient(120% 70% at 50% 0, #000 25%, transparent 80%);
}

.cursor {
    display: inline-block; width: .5em; height: .82em; margin-left: .1em;
    background: var(--amber); animation: blink 1.05s step-end infinite;
}
@keyframes blink { 50% { opacity: 0; } }

.eyebrow {
    font-size: 10.5px; font-weight: 600; letter-spacing: .1em;
    text-transform: uppercase; color: var(--txt-3);
}

.btn {
    height: 34px; padding: 0 14px; display: inline-flex; align-items: center; gap: 8px;
    border: 1px solid transparent; border-radius: 0; font-size: 12px; font-weight: 600;
    cursor: pointer; transition: background-color .15s, border-color .15s, color .15s;
}
.btn-sm { height: 28px; padding: 0 10px; font-size: 11.5px; }
.btn-primary { background: var(--amber-fill); color: var(--on-amber); }
.btn-primary:hover { background: var(--amber-fill-hover); }
.btn-primary:active { background: var(--amber-fill-active); }
.btn-ghost { background: transparent; border-color: var(--bdr-hi); color: var(--txt); }
.btn-ghost:hover { border-color: var(--amber-line); background: var(--amber-wash); color: var(--amber); }
.btn:disabled { opacity: .45; cursor: not-allowed; }

input, select, textarea {
    background: var(--surface); border: 1px solid var(--bdr-hi); border-radius: 0;
    padding: 7px 10px; font-size: 12.5px;
}
input:focus, select:focus, textarea:focus { outline: none; border-color: var(--amber-line); background: var(--surface-2); }
input::placeholder, textarea::placeholder { color: var(--txt-3); }
input[type="checkbox"], input[type="range"] { accent-color: var(--amber); }

kbd {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 20px; height: 20px; padding: 0 5px;
    border: 1px solid var(--bdr-hi); border-bottom-width: 2px; background: var(--surface);
    font-family: var(--mono); font-size: 10.5px; color: var(--txt-2);
}

.badge {
    display: inline-flex; padding: 1px 6px; font-size: 9.5px; font-weight: 700;
    letter-spacing: .08em; text-transform: uppercase;
    color: var(--amber); border: 1px solid var(--amber-line); background: var(--amber-wash);
}

.panel-float { background: var(--panel); border: 1px solid var(--bdr-hi); box-shadow: var(--shadow-float); }

@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

Font loading:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap">
```

For offline/PWA apps, self-host the font files instead of using Google Fonts.

---

## 14. Checklist for a new screen

- [ ] Only tokens in component CSS; works in both themes
- [ ] Exactly one primary (amber) action
- [ ] Eyebrow labels on sections; numbered only when there are peers
- [ ] Hairlines instead of shadows; shadows only on floating layers
- [ ] Hover-only controls also show on `:focus-within` and on touch
- [ ] Every state readable without colour (text/icon/shape)
- [ ] Small text uses `--txt-3` or brighter; `--txt-4` is decorative only
- [ ] Keyboard path for every action; focus ring visible
- [ ] No horizontal scroll at 390px wide; 860px breakpoint behaves
- [ ] Reduced-motion respected
