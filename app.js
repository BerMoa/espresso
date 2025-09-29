const form = document.getElementById("dialForm");
const sliders = document.querySelectorAll("input[type='range']");
const diagnosisText = document.getElementById("diagnosisText");
const confidenceText = document.getElementById("confidenceText");
const rationaleList = document.getElementById("rationaleList");
const riskList = document.getElementById("riskList");
const actionList = document.getElementById("actionList");
const prepFocusList = document.getElementById("prepFocusList");
const targetNotes = document.getElementById("targetNotes");
const targetRecipe = document.getElementById("targetRecipe");
const presetCards = document.getElementById("presetCards");
const saveProfileBtn = document.getElementById("saveProfile");
const clearProfilesBtn = document.getElementById("clearProfiles");
const profileList = document.getElementById("profileList");
const compareSelect = document.getElementById("compareSelect");
const comparison = document.getElementById("comparison");

const STORAGE_KEY = "espresso-profiles";

function formatNumber(value, digits = 1) {
  if (Number.isNaN(value) || value === undefined || value === null) {
    return "–";
  }
  return Number.parseFloat(value).toFixed(digits);
}

function ratio(dose, yieldOut) {
  return dose ? yieldOut / dose : 0;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function collectCheckedValues(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(
    (checkbox) => checkbox.value
  );
}

function determineBaseTargets(data) {
  const styles = {
    ristretto: { ratio: 1.5, ratioRange: [1.2, 1.7], timeRange: [22, 26] },
    normale: { ratio: 2.0, ratioRange: [1.8, 2.2], timeRange: [25, 30] },
    lungo: { ratio: 2.7, ratioRange: [2.4, 3.0], timeRange: [28, 34] },
  };

  const style = styles[data.shotStyle] || styles.normale;
  const milkRange = [1.6, 1.9];
  const ratioRange =
    data.drinkType === "milk"
      ? [Math.max(milkRange[0], style.ratioRange[0]), Math.min(milkRange[1], style.ratioRange[1])]
      : style.ratioRange;

  const targetRatio = clamp(style.ratio, ratioRange[0], ratioRange[1]);

  const roastTemps = {
    light: 94,
    medium: 93,
    "medium-dark": 92,
    dark: 91,
  };

  const baseTemperature = roastTemps[data.roast] ?? 93;

  return {
    ratio: targetRatio,
    ratioRange,
    timeRange: style.timeRange,
    temperature: baseTemperature,
  };
}

function getProcessAdjustments(process) {
  switch (process) {
    case "anaerobic":
      return {
        temp: -1.5,
        ratio: -0.05,
        note: "Anaerobic lots prefer slightly cooler water to tame fermented acidity.",
      };
    case "carbonic":
      return {
        temp: -1,
        ratio: -0.05,
        note: "Carbonic maceration benefits from a cooler brew to control boozy notes.",
      };
    case "natural":
      return {
        temp: -0.5,
        ratio: 0.05,
        note: "Naturals often open up with a touch more yield or ratio.",
      };
    case "honey":
      return {
        temp: -0.3,
        ratio: 0.03,
        note: "Honey processes like a gentle ratio bump for clarity.",
      };
    default:
      return { temp: 0, ratio: 0, note: "" };
  }
}

function evaluateSignals(data, brewRatio, baseTargets) {
  const signals = {
    under: [],
    over: [],
    channeling: [],
    strength: [],
  };

  if (data.time && data.time < baseTargets.timeRange[0]) {
    signals.under.push(`Shot finished in ${formatNumber(data.time, 0)}s (< ${baseTargets.timeRange[0]}s window).`);
  }

  if (data.time && data.time > baseTargets.timeRange[1]) {
    signals.over.push(`Shot ran ${formatNumber(data.time, 0)}s (> ${baseTargets.timeRange[1]}s window).`);
  }

  if (brewRatio && brewRatio > baseTargets.ratioRange[1] + 0.05) {
    signals.under.push(
      `Brew ratio ${formatNumber(brewRatio, 2)} is higher than the target ${formatNumber(baseTargets.ratio, 2)}.`
    );
  }

  if (brewRatio && brewRatio < baseTargets.ratioRange[0] - 0.05) {
    signals.over.push(
      `Brew ratio ${formatNumber(brewRatio, 2)} is tighter than the style floor ${formatNumber(baseTargets.ratioRange[0], 2)}.`
    );
  }

  if (data.tasteFlags.includes("sour")) {
    signals.under.push("Taste marked sour." );
  }

  if (data.tasteFlags.includes("weak")) {
    signals.under.push("Perceived weak body / under-extraction.");
    if (data.time >= baseTargets.timeRange[0] && data.time <= baseTargets.timeRange[1]) {
      signals.strength.push("Weak taste despite nominal time — adjust ratio or dose for strength.");
    }
  }

  if (data.visualFlags.includes("gushing") || data.visualFlags.includes("blonding_early")) {
    signals.under.push("Fast flow visuals (gushing / early blonding).");
  }

  if (
    data.tasteFlags.some((flag) => ["bitter", "astringent", "burnt"].includes(flag))
  ) {
    signals.over.push("Taste flagged bitter/astringent/burnt.");
  }

  if (data.visualFlags.includes("blonding_late") || data.visualFlags.includes("slow_drip")) {
    signals.over.push("Late blonding or choking flow indicates over-extraction.");
  }

  const hasSour = data.tasteFlags.includes("sour");
  const hasBitter = data.tasteFlags.includes("bitter") || data.tasteFlags.includes("astringent");
  if (hasSour && hasBitter) {
    signals.channeling.push("Combined sour and bitter tasting notes (hollow cup).");
  }

  if (data.tasteFlags.includes("hollow")) {
    signals.channeling.push("Hollow cup descriptor selected.");
  }

  if (data.visualFlags.includes("spritzing")) {
    signals.channeling.push("Spritzing / channeling observed at the spouts.");
  }

  if (
    data.prepFlags.some((flag) => ["no_wdt", "uneven_tamp", "overdosed", "screen_imprint"].includes(flag))
  ) {
    signals.channeling.push("Prep flag suggests uneven puck resistance.");
  }

  return signals;
}

function determineExtractionState(signals) {
  if (signals.channeling.length) {
    return "channeling";
  }

  const hasUnder = signals.under.length > 0;
  const hasOver = signals.over.length > 0;

  if (hasUnder && hasOver) {
    return "mixed";
  }

  if (hasUnder) {
    return "under";
  }

  if (hasOver) {
    return "over";
  }

  return "balanced";
}

function computeConfidence(state, signals) {
  let count = 0;
  if (state === "under" || state === "over") {
    count = signals[state].length;
  } else if (state === "channeling") {
    count = signals.channeling.length;
  } else if (state === "mixed") {
    count = Math.max(signals.under.length, signals.over.length);
  } else {
    count = 0;
  }

  let level = "Low";
  if (count >= 3) {
    level = "High";
  } else if (count === 2) {
    level = "Medium";
  } else if (state === "balanced") {
    level = "Medium";
  }

  return { level, count };
}

function buildAdjustments(state, data, brewRatio, baseTargets, processAdjust, signals) {
  const target = {
    dose: data.dose,
    ratio: clamp(brewRatio || baseTargets.ratio, baseTargets.ratioRange[0], baseTargets.ratioRange[1]),
    time: clamp(data.time || baseTargets.timeRange[1], baseTargets.timeRange[0], baseTargets.timeRange[1]),
    temperature: clamp(baseTargets.temperature + processAdjust.temp, 88, 97),
    grind: "Hold grind",
    preinfusionSeconds: 0,
    preinfusionText: "0-1 s (skip unless needed)",
    prepFocus: [],
    notes: "",
  };

  const actions = [];
  const notes = [];

  switch (state) {
    case "under": {
      target.grind = "Finer — medium step (≈2-3 clicks / 5-8%)";
      target.ratio = clamp(
        brewRatio ? brewRatio - 0.15 : baseTargets.ratio - 0.1,
        baseTargets.ratioRange[0],
        baseTargets.ratioRange[1]
      );
      target.time = clamp(
        Math.max(data.time + 3, baseTargets.timeRange[0] + 1),
        baseTargets.timeRange[0],
        baseTargets.timeRange[1]
      );
      const tempDelta = data.roast === "light" ? 1.5 : 1;
      target.temperature = clamp(target.temperature + tempDelta, 88, 97);
      target.preinfusionSeconds = 3;
      target.preinfusionText = "3 s gentle preinfusion";
      actions.push("Grind finer by ~2-3 clicks to slow flow.");
      actions.push(
        `Aim for ${formatNumber(target.ratio, 2)} : 1 (slightly shorter to concentrate sweetness).`
      );
      actions.push(`Let the shot run to about ${formatNumber(target.time, 0)}s.`);
      notes.push("Slight heat bump helps extract light roasts when under.");
      break;
    }
    case "over": {
      target.grind = "Coarser — small/medium step (≈1-2 clicks)";
      target.ratio = clamp(
        brewRatio ? brewRatio - 0.2 : baseTargets.ratio - 0.15,
        baseTargets.ratioRange[0],
        baseTargets.ratioRange[1]
      );
      target.time = clamp(
        Math.max(baseTargets.timeRange[0], (data.time || baseTargets.timeRange[1]) - 3),
        baseTargets.timeRange[0],
        baseTargets.timeRange[1]
      );
      const tempDelta = data.roast === "dark" || data.roast === "medium-dark" ? -1.5 : -1;
      target.temperature = clamp(target.temperature + tempDelta, 88, 97);
      target.preinfusionSeconds = 1;
      target.preinfusionText = "1 s or straight on";
      actions.push("Open the grind slightly to cut off bitter tail.");
      actions.push(
        `Stop earlier around ${formatNumber(data.dose * target.ratio, 0)}g (${formatNumber(target.ratio, 2)} : 1).`
      );
      actions.push(`Keep total time near ${formatNumber(target.time, 0)}s.`);
      notes.push("Cool the water 1-2°C to smooth harshness.");
      break;
    }
    case "mixed": {
      target.grind = "Micro-step finer but shorten the shot";
      target.ratio = clamp(
        brewRatio ? brewRatio - 0.15 : baseTargets.ratio - 0.1,
        baseTargets.ratioRange[0],
        baseTargets.ratioRange[1]
      );
      target.time = clamp(
        Math.max(baseTargets.timeRange[0] + 1, (data.time || baseTargets.timeRange[1]) - 1),
        baseTargets.timeRange[0],
        baseTargets.timeRange[1]
      );
      const tempDelta = data.roast === "light" ? 0.5 : -0.5;
      target.temperature = clamp(target.temperature + tempDelta, 88, 97);
      target.preinfusionSeconds = 3;
      target.preinfusionText = "3-4 s soak to stabilise flow";
      target.prepFocus.push("Reinforce prep (WDT, level tamp) before chasing grind.");
      actions.push("Conflicting signals: tighten prep, then nudge grind finer and cut the shot slightly shorter.");
      actions.push(`Target roughly ${formatNumber(target.ratio, 2)} : 1 in ${formatNumber(target.time, 0)}s.`);
      notes.push("Mixed cues — balance grind with improved puck prep.");
      break;
    }
    case "channeling": {
      target.grind = "Hold grind — fix prep first";
      target.ratio = clamp(baseTargets.ratio, baseTargets.ratioRange[0], baseTargets.ratioRange[1]);
      target.time = clamp(
        Math.max(baseTargets.timeRange[0] + 1, data.time || baseTargets.timeRange[1]),
        baseTargets.timeRange[0],
        baseTargets.timeRange[1]
      );
      target.preinfusionSeconds = 4;
      target.preinfusionText = "4 s soft preinfusion";
      target.prepFocus.push("Thorough WDT / distribution before tamp.");
      target.prepFocus.push("Level tamp with even pressure.");
      target.prepFocus.push("Leave ~1 mm headspace; reduce dose if shower screen imprints.");
      actions.push("Run 4 s low-pressure preinfusion to settle puck.");
      actions.push("Focus on puck prep before changing grind further.");
      notes.push("Channeling suspected — keep recipe stable while fixing prep.");
      break;
    }
    case "balanced":
    default: {
      target.grind = "Hold grind";
      target.ratio = clamp(
        baseTargets.ratio + processAdjust.ratio,
        baseTargets.ratioRange[0],
        baseTargets.ratioRange[1]
      );
      target.time = clamp(
        data.time || baseTargets.timeRange[1],
        baseTargets.timeRange[0],
        baseTargets.timeRange[1]
      );
      target.preinfusionSeconds = 2;
      target.preinfusionText = "2 s to keep consistency";
      actions.push("Keep recipe steady and log repeat shots for learning.");
      break;
    }
  }

  if (signals.strength.length) {
    const strengthRatio = clamp(target.ratio - 0.1, baseTargets.ratioRange[0], baseTargets.ratioRange[1]);
    actions.push(
      `Shot tasted weak: either increase dose to ${formatNumber(data.dose + 1, 1)}g (if basket allows) or tighten ratio to ${formatNumber(strengthRatio, 2)} : 1.`
    );
    notes.push("Strength tweak recommended while keeping extraction balanced.");
  }

  if (!target.prepFocus.length) {
    target.prepFocus.push("WDT or comparable distribution every time.");
    target.prepFocus.push("Level tamp and confirm headspace before locking in.");
  }

  target.temperature = clamp(target.temperature, 88, 97);
  target.ratio = clamp(target.ratio, baseTargets.ratioRange[0], baseTargets.ratioRange[1]);
  target.time = clamp(target.time, baseTargets.timeRange[0], baseTargets.timeRange[1]);
  target.yield = Math.round(target.dose * target.ratio);
  target.notes = notes.filter(Boolean).join(" ");

  return { target, actions };
}

function computeDiagnosis(data) {
  const brewRatio = ratio(data.dose, data.yield);
  const baseTargets = determineBaseTargets(data);
  const processAdjust = getProcessAdjustments(data.process);
  const signals = evaluateSignals(data, brewRatio, baseTargets);
  const extraction = determineExtractionState(signals);
  const confidence = computeConfidence(extraction, signals);
  const { target, actions } = buildAdjustments(extraction, data, brewRatio, baseTargets, processAdjust, signals);

  const rationale = new Set();
  const risks = new Set();

  if (extraction === "balanced") {
    rationale.add("Inputs sit within the target windows; keep logging for refinement.");
  } else if (extraction === "mixed") {
    signals.under.forEach((msg) => rationale.add(msg));
    signals.over.forEach((msg) => rationale.add(msg));
    risks.add("Mixed signals — adjust grind carefully and control prep.");
  } else if (extraction === "channeling") {
    signals.channeling.forEach((msg) => rationale.add(msg));
    risks.add("Channeling risk causing uneven extraction.");
  } else {
    signals[extraction].forEach((msg) => rationale.add(msg));
  }

  if (signals.strength.length) {
    signals.strength.forEach((msg) => rationale.add(msg));
  }

  if (processAdjust.note) {
    rationale.add(processAdjust.note);
  }

  if (signals.channeling.length && extraction !== "channeling") {
    risks.add("Prep flags indicate potential channeling — monitor puck prep.");
  }

  const suggestions = Array.from(new Set(actions));

  return {
    extraction,
    confidence,
    rationale: Array.from(rationale),
    risks: Array.from(risks),
    actions: suggestions,
    target,
    brewRatio,
    baseTargets,
  };
}

function renderDiagnosis(result) {
  const { extraction, confidence, rationale, risks, actions, target, brewRatio } = result;
  const labels = {
    under: "Under-extracted",
    over: "Over-extracted",
    balanced: "On target",
    mixed: "Inconsistent extraction",
    channeling: "Channeling suspected",
  };

  diagnosisText.textContent = `${labels[extraction] || "Assessment"} — ratio ${formatNumber(brewRatio, 2)} : 1`;
  confidenceText.textContent = `Confidence: ${confidence.level}${
    confidence.count ? ` (${confidence.count} signals)` : ""
  }`;

  rationaleList.innerHTML = "";
  if (rationale.length) {
    rationale.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      rationaleList.appendChild(li);
    });
  }

  riskList.innerHTML = "";
  if (risks.length) {
    risks.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      riskList.appendChild(li);
    });
  }

  actionList.innerHTML = "";
  if (actions.length) {
    actions.slice(0, 6).forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      actionList.appendChild(li);
    });
  }

  prepFocusList.innerHTML = "";
  target.prepFocus.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    prepFocusList.appendChild(li);
  });

  if (target.notes) {
    targetNotes.textContent = target.notes;
    targetNotes.classList.remove("hidden");
  } else {
    targetNotes.textContent = "";
    targetNotes.classList.add("hidden");
  }

  targetRecipe.classList.remove("muted");
  targetRecipe.innerHTML = `
    <div><dt>Dose</dt><dd>${formatNumber(target.dose, 1)} g</dd></div>
    <div><dt>Yield</dt><dd>${formatNumber(target.yield, 0)} g</dd></div>
    <div><dt>Ratio</dt><dd>${formatNumber(target.ratio, 2)} : 1</dd></div>
    <div><dt>Time</dt><dd>${formatNumber(target.time, 0)} s</dd></div>
    <div><dt>Temp</dt><dd>${formatNumber(target.temperature, 0)} °C</dd></div>
    <div><dt>Grind</dt><dd>${target.grind}</dd></div>
    <div><dt>Preinfusion</dt><dd>${target.preinfusionText}</dd></div>
  `;
}

function generatePresets(data, diagnosis) {
  const { target, baseTargets } = diagnosis;
  const baseRatio = target.ratio;
  const ratioRange = baseTargets.ratioRange;
  const timeRange = baseTargets.timeRange;

  const sweetRatio = clamp(baseRatio - 0.1, ratioRange[0], ratioRange[1]);
  const brightRatio = clamp(baseRatio + 0.15, ratioRange[0], ratioRange[1]);

  const presets = [
    {
      name: "Sweet",
      tag: "comfort",
      ratio: sweetRatio,
      time: clamp(target.time - 1, timeRange[0], timeRange[1]),
      temp: clamp(target.temperature + 0.5, 88, 96),
      preinfusion: target.preinfusionSeconds,
      notes: "Stop a touch earlier to emphasize sugars.",
    },
    {
      name: "Balanced",
      tag: "reference",
      ratio: baseRatio,
      time: target.time,
      temp: target.temperature,
      preinfusion: target.preinfusionSeconds,
      notes: "Baseline recipe — confirm repeatability.",
    },
    {
      name: "Bright",
      tag: "explore",
      ratio: brightRatio,
      time: clamp(target.time + 2, timeRange[0], timeRange[1] + 1),
      temp: clamp(target.temperature - 0.5, 88, 96),
      preinfusion: Math.max(2, target.preinfusionSeconds),
      notes: "Longer ratio to open acidity and florals.",
    },
  ];

  return presets.map((preset) => ({
    ...preset,
    dose: data.dose,
    yield: Math.round(data.dose * preset.ratio),
  }));
}

function renderPresets(presets) {
  presetCards.innerHTML = "";
  presets.forEach((preset) => {
    const card = document.createElement("article");
    card.className = "preset-card";
    card.innerHTML = `
      <h4>${preset.name} <small>${preset.tag}</small></h4>
      <div class="metric-grid">
        <div><dt>Dose</dt><dd>${formatNumber(preset.dose, 1)} g</dd></div>
        <div><dt>Yield</dt><dd>${preset.yield} g</dd></div>
        <div><dt>Ratio</dt><dd>${formatNumber(preset.ratio, 2)} : 1</dd></div>
        <div><dt>Time</dt><dd>${formatNumber(preset.time, 0)} s</dd></div>
        <div><dt>Temp</dt><dd>${formatNumber(preset.temp, 1)} °C</dd></div>
        <div><dt>Preinfusion</dt><dd>${preset.preinfusion ? `${preset.preinfusion}s` : "0-1s"}</dd></div>
      </div>
      <p class="muted">${preset.notes}</p>
    `;
    presetCards.appendChild(card);
  });
}

function readFormData() {
  const getValue = (id) => document.getElementById(id).value;
  const getNumber = (id) => Number.parseFloat(getValue(id)) || 0;

  return {
    bean: getValue("beanName").trim(),
    process: getValue("process"),
    roast: getValue("roast"),
    roastDate: getValue("roastDate"),
    drinkType: getValue("drinkType"),
    shotStyle: getValue("shotStyle"),
    equipment: getValue("equipment"),
    dose: getNumber("dose"),
    yield: getNumber("yield"),
    time: getNumber("time"),
    temperature: getNumber("temperature") || 93,
    grind: getValue("grind"),
    prepNotes: getValue("prepNotes"),
    sweetness: getNumber("sweetness"),
    acidity: getNumber("acidity"),
    bitterness: getNumber("bitterness"),
    body: getNumber("body"),
    tasteFlags: collectCheckedValues("tasteFlags"),
    visualFlags: collectCheckedValues("visualFlags"),
    prepFlags: collectCheckedValues("prepFlags"),
    notes: getValue("shotNotes"),
  };
}

function handleSubmit(event) {
  event.preventDefault();
  const data = readFormData();
  if (!data.dose || !data.yield || !data.time) {
    diagnosisText.textContent = "Dose, yield, and time are required to analyze.";
    return;
  }

  const result = computeDiagnosis(data);
  renderDiagnosis(result);
  const presets = generatePresets(data, result);
  renderPresets(presets);
  updateComparison();
}

function updateSliderValue(slider) {
  const readout = document.querySelector(`.slider-value[data-for="${slider.id}"]`);
  if (readout) {
    readout.textContent = slider.value;
  }
}

function loadProfiles() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error("Failed to load profiles", error);
    return [];
  }
}

function saveProfiles(profiles) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

function renderProfiles() {
  const profiles = loadProfiles();
  profileList.innerHTML = "";
  compareSelect.innerHTML = '<option value="">Select saved bean</option>';

  if (!profiles.length) {
    profileList.classList.add("muted");
    profileList.textContent = "No profiles saved yet.";
    comparison.textContent = "Pick a bean to compare.";
    comparison.classList.add("muted");
    return;
  }

  profileList.classList.remove("muted");
  comparison.classList.remove("muted");

  profiles.forEach((profile) => {
    const card = document.createElement("article");
    card.className = "profile-card";
    card.innerHTML = `
      <header>
        <h4>${profile.bean}</h4>
        <time>${new Date(profile.savedAt).toLocaleDateString()}</time>
      </header>
      <p class="muted">${profile.process} • ${profile.roast}</p>
      <p>Target ${formatNumber(profile.target.ratio, 2)} : 1 @ ${formatNumber(
      profile.target.temperature,
      0
    )} °C</p>
      <button class="secondary" data-load="${profile.id}">Load profile</button>
      <button class="danger" data-delete="${profile.id}">Delete</button>
    `;
    profileList.appendChild(card);

    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.bean;
    compareSelect.appendChild(option);
  });
}

function getProfileById(id) {
  return loadProfiles().find((profile) => profile.id === id);
}

function setCheckedValues(name, values = []) {
  const set = new Set(values);
  document.querySelectorAll(`input[name="${name}"]`).forEach((checkbox) => {
    checkbox.checked = set.has(checkbox.value);
  });
}

function populateForm(profile) {
  const shot = profile.lastShot || {};
  document.getElementById("beanName").value = profile.bean || "";
  document.getElementById("process").value = profile.process || "washed";
  document.getElementById("roast").value = profile.roast || "medium";
  document.getElementById("roastDate").value = profile.roastDate || "";
  document.getElementById("drinkType").value = shot.drinkType || "straight";
  document.getElementById("shotStyle").value = shot.shotStyle || "normale";
  document.getElementById("equipment").value = shot.equipment || "";
  document.getElementById("dose").value = shot.dose ?? profile.target.dose;
  document.getElementById("yield").value = shot.yield ?? profile.target.yield;
  document.getElementById("time").value = shot.time ?? profile.target.time;
  document.getElementById("temperature").value = shot.temperature ?? profile.target.temperature;
  document.getElementById("grind").value = shot.grind || profile.target.grind || "";
  document.getElementById("prepNotes").value = shot.prepNotes || "";
  document.getElementById("sweetness").value = shot.sweetness ?? 5;
  document.getElementById("acidity").value = shot.acidity ?? 5;
  document.getElementById("bitterness").value = shot.bitterness ?? 5;
  document.getElementById("body").value = shot.body ?? 5;
  document.getElementById("shotNotes").value = shot.notes || "";
  setCheckedValues("tasteFlags", shot.tasteFlags || []);
  setCheckedValues("visualFlags", shot.visualFlags || []);
  setCheckedValues("prepFlags", shot.prepFlags || []);
  sliders.forEach(updateSliderValue);
}

function handleProfileActions(event) {
  const loadId = event.target.dataset.load;
  const deleteId = event.target.dataset.delete;

  if (loadId) {
    const profile = getProfileById(loadId);
    if (profile) {
      populateForm(profile);
      const result = computeDiagnosis(readFormData());
      renderDiagnosis(result);
      renderPresets(generatePresets(readFormData(), result));
    }
  }

  if (deleteId) {
    const filtered = loadProfiles().filter((profile) => profile.id !== deleteId);
    saveProfiles(filtered);
    renderProfiles();
    updateComparison();
  }
}

function handleSaveProfile() {
  const data = readFormData();
  if (!data.bean) {
    alert("Name the bean before saving.");
    return;
  }

  const diagnosis = computeDiagnosis(data);
  const profiles = loadProfiles();
  const existing = profiles.find((profile) => profile.bean.toLowerCase() === data.bean.toLowerCase());
  const profilePayload = {
    id: existing?.id || crypto.randomUUID(),
    bean: data.bean,
    process: data.process,
    roast: data.roast,
    roastDate: data.roastDate,
    target: diagnosis.target,
    lastShot: data,
    savedAt: new Date().toISOString(),
  };

  const updated = existing
    ? profiles.map((profile) => (profile.id === existing.id ? profilePayload : profile))
    : [profilePayload, ...profiles];

  saveProfiles(updated);
  renderProfiles();
  updateComparison();
}

function handleClearProfiles() {
  if (confirm("Delete all saved bean profiles?")) {
    window.localStorage.removeItem(STORAGE_KEY);
    renderProfiles();
    updateComparison();
  }
}

function updateComparison() {
  const current = readFormData();
  const compareId = compareSelect.value;
  if (!compareId) {
    comparison.textContent = "Pick a bean to compare.";
    comparison.classList.add("muted");
    return;
  }

  const profile = getProfileById(compareId);
  if (!profile) {
    comparison.textContent = "Profile missing.";
    comparison.classList.add("muted");
    return;
  }

  const currentRatio = ratio(current.dose || profile.target.dose, current.yield || profile.target.yield);
  const diffRatio = formatNumber(currentRatio - profile.target.ratio, 2);
  const diffTemp = formatNumber((current.temperature || profile.target.temperature) - profile.target.temperature, 1);
  const diffTime = formatNumber((current.time || profile.target.time) - profile.target.time, 1);

  comparison.classList.remove("muted");
  comparison.innerHTML = `
    <div><strong>${current.bean || "Current shot"}</strong> vs <strong>${profile.bean}</strong></div>
    <div>Ratio delta: ${diffRatio} vs saved ${formatNumber(profile.target.ratio, 2)} : 1</div>
    <div>Time delta: ${diffTime}s vs saved ${formatNumber(profile.target.time, 0)}s</div>
    <div>Temp delta: ${diffTemp}°C vs saved ${formatNumber(profile.target.temperature, 0)}°C</div>
  `;
}

form.addEventListener("submit", handleSubmit);
profileList.addEventListener("click", handleProfileActions);
saveProfileBtn.addEventListener("click", handleSaveProfile);
clearProfilesBtn.addEventListener("click", handleClearProfiles);
compareSelect.addEventListener("change", updateComparison);
sliders.forEach((slider) => {
  slider.addEventListener("input", () => updateSliderValue(slider));
  updateSliderValue(slider);
});

renderProfiles();
