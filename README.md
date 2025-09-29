# Espresso Dial-In Engine

Espresso is a science-driven dial-in assistant that turns a single shot's inputs and taste feedback into causal recommendations. Log a shot, capture the flavour and visual cues, and the heuristic layer will propose the next pull with grind direction, ratio, time, temperature, pre-infusion, and prep focus all tied back to the signals you reported.

## Getting started

1. Serve the static files with any local HTTP server (for example `python -m http.server 8000`).
2. Open `http://localhost:8000` in your browser.
3. Record dose, yield, time, temperature, and contextual flags, then submit to generate the diagnosis, target recipe, and presets.

## What the model considers

- **Extraction windows by style** – Normale (≈1:2, 25–30 s) by default, ristretto (1.0–1.7, 22–26 s), and lungo (2.4–3.0, 28–34 s). Milk drinks bias the target toward 1:1.6–1.9 for sweeter, denser shots.
- **Process-aware biases** – Fermentation-heavy beans (anaerobic, carbonic) cool down automatically while naturals/honey lots open up with slightly higher ratios.
- **Signal fusion** – Taste descriptors (sour, bitter, astringent, burnt, weak, hollow), visuals (gushing, blonding timing, spritzing), prep flags, and brew ratio/time combine to classify under, over, mixed, or channeling states with a confidence score.
- **Adjustment magnitudes** – Recommendations include grind direction + magnitude, ratio/yield target, time window, temperature tweaks, pre-infusion length, and prep focus items that mirror barista workflows (WDT, tamp, headspace).
- **Strength tuning** – If a shot tastes weak but sits inside the extraction window, guidance shifts toward dose or ratio changes instead of more contact time.

## Outputs

- **Diagnosis card** summarises the extraction state, supporting rationale, and risk factors.
- **Target recipe** delivers the adjusted dose, yield, ratio, time, temperature, grind change, and pre-infusion guidance alongside prep priorities and key next steps.
- **Testable presets** (Sweet, Balanced, Bright) let you explore adjacent recipes without guesswork.
- **Bean profiles** persist locally via `localStorage`, enabling quick load/compare flows with no accounts or backend.

Clearing browser storage removes saved profiles.
