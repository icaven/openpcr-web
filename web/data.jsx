(function(){
// Shared data model + utilities for the OpenPCR interface.
// Programs > Cycles > Steps.

const SAMPLE_PROGRAMS = [
  {
    id: "p1",
    name: "Bar coding",
    notes: "Standard 16S rRNA barcoding protocol.",
    cycles: [
      { id: "c1", loops: 1, steps: [
        { id: "s1", name: "Hot start", direction: "heating", target: 95, duration: 180 },
      ]},
      { id: "c2", loops: 30, steps: [
        { id: "s2", name: "Denature", direction: "heating", target: 95, duration: 30 },
        { id: "s3", name: "Anneal",   direction: "cooling", target: 55, duration: 30 },
        { id: "s4", name: "Extend",   direction: "heating", target: 72, duration: 60 },
      ]},
      { id: "c3", loops: 1, steps: [
        { id: "s5", name: "Final extend", direction: "heating", target: 72, duration: 300 },
      ]},
      { id: "c4", loops: 1, steps: [
        { id: "s6", name: "Hold", direction: "cooling", target: 20, duration: 0 },
      ]},
    ],
  },
  {
    id: "p2",
    name: "Amplification",
    notes: "Quick 25-cycle amplification.",
    cycles: [
      { id: "c5", loops: 1, steps: [
        { id: "s7", name: "Denature", direction: "heating", target: 94, duration: 120 },
      ]},
      { id: "c6", loops: 25, steps: [
        { id: "s8",  name: "Denature", direction: "heating", target: 94, duration: 20 },
        { id: "s9",  name: "Anneal",   direction: "cooling", target: 58, duration: 20 },
        { id: "s10", name: "Extend",   direction: "heating", target: 72, duration: 45 },
      ]},
    ],
  },
  {
    id: "p3",
    name: "Colony PCR",
    notes: "",
    cycles: [
      { id: "c7", loops: 1, steps: [
        { id: "s11", name: "Init", direction: "heating", target: 95, duration: 300 },
      ]},
      { id: "c8", loops: 28, steps: [
        { id: "s12", name: "Denature", direction: "heating", target: 95, duration: 30 },
        { id: "s13", name: "Anneal",   direction: "cooling", target: 52, duration: 30 },
        { id: "s14", name: "Extend",   direction: "heating", target: 72, duration: 90 },
      ]},
    ],
  },
];

// Read-only template library — these can be cloned but not edited or deleted.
const TEMPLATE_PROGRAMS = [
  {
    id: "tpl-std-pcr",
    name: "Standard PCR (35 cycles)",
    notes: "General-purpose PCR for ~1 kb amplicons with Taq polymerase.",
    cycles: [
      { id: "tc1", loops: 1, steps: [
        { id: "ts1", name: "Denature",      direction: "heating", target: 95, duration: 180 },
      ]},
      { id: "tc2", loops: 35, steps: [
        { id: "ts2", name: "Denature",      direction: "heating", target: 95, duration: 30 },
        { id: "ts3", name: "Anneal",        direction: "cooling", target: 55, duration: 30 },
        { id: "ts4", name: "Extend",        direction: "heating", target: 72, duration: 60 },
      ]},
      { id: "tc3", loops: 1, steps: [
        { id: "ts5", name: "Final extend",  direction: "heating", target: 72, duration: 300 },
      ]},
      { id: "tc4", loops: 1, steps: [
        { id: "ts6", name: "Hold",          direction: "cooling", target: 4,  duration: 0 },
      ]},
    ],
  },
  {
    id: "tpl-touchdown",
    name: "Touchdown PCR",
    notes: "Anneal stepping down 65→55 °C over 10 cycles, then 25 cycles at 55 °C. Reduces non-specific priming.",
    cycles: [
      { id: "tc5", loops: 1, steps: [
        { id: "ts7",  name: "Denature",     direction: "heating", target: 95, duration: 180 },
      ]},
      { id: "tc6", loops: 5, steps: [
        { id: "ts8",  name: "Denature",     direction: "heating", target: 95, duration: 30 },
        { id: "ts9",  name: "Anneal",       direction: "cooling", target: 65, duration: 30 },
        { id: "ts10", name: "Extend",       direction: "heating", target: 72, duration: 60 },
      ]},
      { id: "tc7", loops: 5, steps: [
        { id: "ts11", name: "Denature",     direction: "heating", target: 95, duration: 30 },
        { id: "ts12", name: "Anneal",       direction: "cooling", target: 60, duration: 30 },
        { id: "ts13", name: "Extend",       direction: "heating", target: 72, duration: 60 },
      ]},
      { id: "tc8", loops: 25, steps: [
        { id: "ts14", name: "Denature",     direction: "heating", target: 95, duration: 30 },
        { id: "ts15", name: "Anneal",       direction: "cooling", target: 55, duration: 30 },
        { id: "ts16", name: "Extend",       direction: "heating", target: 72, duration: 60 },
      ]},
      { id: "tc9", loops: 1, steps: [
        { id: "ts17", name: "Final extend", direction: "heating", target: 72, duration: 300 },
      ]},
    ],
  },
  {
    id: "tpl-2step",
    name: "2-step PCR (qPCR-style)",
    notes: "Combined annealing + extension at 60 °C. Common for short amplicons under 200 bp.",
    cycles: [
      { id: "tc10", loops: 1, steps: [
        { id: "ts18", name: "Denature",         direction: "heating", target: 95, duration: 120 },
      ]},
      { id: "tc11", loops: 40, steps: [
        { id: "ts19", name: "Denature",         direction: "heating", target: 95, duration: 15 },
        { id: "ts20", name: "Anneal/Extend",    direction: "cooling", target: 60, duration: 60 },
      ]},
    ],
  },
  {
    id: "tpl-restriction",
    name: "Restriction digest",
    notes: "37 °C incubation followed by enzyme heat-inactivation.",
    cycles: [
      { id: "tc12", loops: 1, steps: [
        { id: "ts21", name: "Incubate",     direction: "heating", target: 37, duration: 3600 },
      ]},
      { id: "tc13", loops: 1, steps: [
        { id: "ts22", name: "Inactivate",   direction: "heating", target: 80, duration: 1200 },
      ]},
      { id: "tc14", loops: 1, steps: [
        { id: "ts23", name: "Hold",         direction: "cooling", target: 4,  duration: 0 },
      ]},
    ],
  },
  {
    id: "tpl-ligation",
    name: "Ligation",
    notes: "T4 ligase overnight at 16 °C, then heat inactivation.",
    cycles: [
      { id: "tc15", loops: 1, steps: [
        { id: "ts24", name: "Ligate",       direction: "cooling", target: 16, duration: 14400 },
      ]},
      { id: "tc16", loops: 1, steps: [
        { id: "ts25", name: "Inactivate",   direction: "heating", target: 65, duration: 600 },
      ]},
    ],
  },
];

function programTotalSeconds(program) {
  if (!program) return 0;
  return program.cycles.reduce((sum, c) => {
    const cycleSec = c.steps.reduce((s, st) => s + (st.duration || 0), 0);
    return sum + cycleSec * Math.max(1, c.loops || 1);
  }, 0);
}

function cycleTotalSeconds(cycle) {
  const inner = cycle.steps.reduce((s, st) => s + (st.duration || 0), 0);
  return inner * Math.max(1, cycle.loops || 1);
}

// Map a temperature to a color tint.  Anchor: 4°C = blue, 95°C = red.
function tempColor(tempC, intensity = "medium") {
  const t = Math.max(4, Math.min(95, tempC));
  const norm = (t - 4) / (95 - 4); // 0..1

  // Hue path: 240 (blue) -> 200 (cyan) -> 150 (green) -> 75 (amber) -> 25 (red)
  const stops = [
    { p: 0.00, h: 240 },
    { p: 0.30, h: 210 },
    { p: 0.55, h: 150 },
    { p: 0.78, h: 60 },
    { p: 1.00, h: 25 },
  ];
  let h = 25;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (norm >= a.p && norm <= b.p) {
      const k = (norm - a.p) / (b.p - a.p);
      h = a.h + (b.h - a.h) * k;
      break;
    }
  }

  const intensityCfg = {
    subtle:  { bgL: 0.96, bgC: 0.04, fgL: 0.42, fgC: 0.18, borderL: 0.88, borderC: 0.06 },
    medium:  { bgL: 0.92, bgC: 0.08, fgL: 0.36, fgC: 0.22, borderL: 0.82, borderC: 0.10 },
    bold:    { bgL: 0.78, bgC: 0.16, fgL: 0.22, fgC: 0.10, borderL: 0.62, borderC: 0.20 },
  }[intensity] || { bgL: 0.92, bgC: 0.08, fgL: 0.36, fgC: 0.22, borderL: 0.82, borderC: 0.10 };

  return {
    bg:     `oklch(${intensityCfg.bgL} ${intensityCfg.bgC} ${h})`,
    fg:     `oklch(${intensityCfg.fgL} ${intensityCfg.fgC} ${h})`,
    border: `oklch(${intensityCfg.borderL} ${intensityCfg.borderC} ${h})`,
    line:   `oklch(0.62 0.18 ${h})`,
  };
}

function tempColorDark(tempC, intensity = "medium") {
  const t = Math.max(4, Math.min(95, tempC));
  const norm = (t - 4) / (95 - 4);
  const stops = [
    { p: 0.00, h: 240 }, { p: 0.30, h: 210 }, { p: 0.55, h: 150 },
    { p: 0.78, h: 60 }, { p: 1.00, h: 25 },
  ];
  let h = 25;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (norm >= a.p && norm <= b.p) { h = a.h + (b.h - a.h) * ((norm - a.p) / (b.p - a.p)); break; }
  }
  const intensityCfg = {
    subtle:  { bgL: 0.26, bgC: 0.04, fgL: 0.85, fgC: 0.10, borderL: 0.34, borderC: 0.06 },
    medium:  { bgL: 0.30, bgC: 0.08, fgL: 0.92, fgC: 0.14, borderL: 0.40, borderC: 0.10 },
    bold:    { bgL: 0.42, bgC: 0.18, fgL: 0.97, fgC: 0.06, borderL: 0.56, borderC: 0.22 },
  }[intensity] || { bgL: 0.30, bgC: 0.08, fgL: 0.92, fgC: 0.14, borderL: 0.40, borderC: 0.10 };
  return {
    bg:     `oklch(${intensityCfg.bgL} ${intensityCfg.bgC} ${h})`,
    fg:     `oklch(${intensityCfg.fgL} ${intensityCfg.fgC} ${h})`,
    border: `oklch(${intensityCfg.borderL} ${intensityCfg.borderC} ${h})`,
    line:   `oklch(0.72 0.18 ${h})`,
  };
}

function fmtTime(seconds, format = "mmss") {
  if (seconds == null || isNaN(seconds)) return "0:00";
  const s = Math.max(0, Math.round(seconds));
  if (format === "hms") {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtTemp(c, unit = "C") {
  if (c == null || isNaN(c)) return "—";
  if (unit === "F") return `${(c * 9/5 + 32).toFixed(1)}°F`;
  return `${c.toFixed(1)}°C`;
}

// Generate a unique id
function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// Flat list of all steps with their absolute time bounds.  Each entry:
//   { stepId, cycleId, cycleIdx, iter, startSec, endSec, step, cycle }
function flattenProgram(program) {
  const out = [];
  if (!program) return out;
  let t = 0;
  program.cycles.forEach((cycle, cycleIdx) => {
    const loops = Math.max(1, cycle.loops || 1);
    for (let i = 0; i < loops; i++) {
      cycle.steps.forEach((step) => {
        const dur = step.duration || 0;
        out.push({
          stepId: step.id,
          cycleId: cycle.id,
          cycleIdx,
          iter: i,
          loops,
          startSec: t,
          endSec: t + dur,
          step,
          cycle,
        });
        t += dur;
      });
    }
  });
  return out;
}

// At a given absolute second t, what's running?
function statusAt(program, t) {
  const flat = flattenProgram(program);
  const total = programTotalSeconds(program);
  if (t >= total) return { done: true, total };
  for (const e of flat) {
    if (t >= e.startSec && t < e.endSec) {
      return { ...e, total, currentSec: t, progressInStep: (t - e.startSec) / Math.max(1, e.endSec - e.startSec) };
    }
  }
  return { done: true, total };
}

Object.assign(window, {
  SAMPLE_PROGRAMS,
  TEMPLATE_PROGRAMS,
  programTotalSeconds,
  cycleTotalSeconds,
  tempColor,
  tempColorDark,
  fmtTime,
  fmtTemp,
  uid,
  flattenProgram,
  statusAt,
});

})();
