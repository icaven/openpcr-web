(function(){
// pcrApi — adapter layer between the UI and the (future) Python backend.
//
// All UI components talk to this object only.  The default implementation
// keeps state in memory + localStorage so the prototype works standalone.
// To wire up a real Python backend, implement createRemotePcrApi() against
// HTTP + WebSocket endpoints with the same method signatures.
//
// ── BACKEND CONTRACT ──────────────────────────────────────────────────────
//
//   REST (suggested mapping)
//     GET    /programs                   → listPrograms()
//     POST   /programs                   → createProgram()
//     PATCH  /programs/:id               → updateProgram(id, patch)
//     DELETE /programs/:id               → deleteProgram(id)
//     POST   /programs/:id/cycles        → addCycle(programId)
//     PATCH  /programs/:id/cycles/:cid   → updateCycle(programId, cid, patch)
//     DELETE /programs/:id/cycles/:cid   → deleteCycle(programId, cid)
//     POST   /programs/:id/cycles/:cid/steps     → addStep(...)
//     PATCH  /programs/:id/cycles/:cid/steps/:sid → updateStep(...)
//     DELETE /programs/:id/cycles/:cid/steps/:sid → deleteStep(...)
//
//   Run control
//     POST   /run/start  { programId }   → startRun(programId)
//     POST   /run/pause                  → pauseRun()
//     POST   /run/resume                 → resumeRun()
//     POST   /run/stop                   → stopRun()
//
//   Live telemetry — WebSocket /ws emits {type, payload}:
//     "status"   { programId, stepId, cycleId, cycleIdx, iter, loops,
//                  blockTempC, lidTempC, elapsedSec, totalSec, state }
//     "complete" { programId }
//     "error"    { code, message }   // e.g. "LID_OPEN", "THERMAL_FAULT"
//
//   Data shapes
//     Program = { id, name, notes, cycles: Cycle[] }
//     Cycle   = { id, name, loops, steps: Step[] }
//     Step    = { id, name, direction: "heating"|"cooling",
//                 target: number /*°C*/, duration: number /*sec*/ }
//
// ──────────────────────────────────────────────────────────────────────────

function createLocalPcrApi(initial, templates = []) {
  const state = {
    programs: structuredClone(initial),
    templates: structuredClone(templates),
    run: null, // { programId, startedAt, pausedAt, totalPaused, state, error }
    block: 22.0,
    lid: 21.0,
  };
  const listeners = new Set();
  const emit = (evt) => listeners.forEach((fn) => fn(evt));

  // --- programs --------------------------------------------------------
  function listPrograms() { return structuredClone(state.programs); }
  function listTemplates() { return structuredClone(state.templates); }

  function duplicateProgram(id, opts = {}) {
    // id can refer to a program OR a template
    const src = state.programs.find((p) => p.id === id) || state.templates.find((t) => t.id === id);
    if (!src) return null;
    const copy = {
      id: window.uid(),
      name: opts.name ?? `${src.name} (copy)`,
      notes: src.notes || "",
      cycles: src.cycles.map((c) => ({
        id: window.uid(),
        loops: c.loops,
        steps: c.steps.map((s) => ({ ...s, id: window.uid() })),
      })),
    };
    state.programs.push(copy);
    emit({ type: "programs" });
    return Promise.resolve(structuredClone(copy));
  }

  function getProgram(id) {
    return structuredClone(state.programs.find((p) => p.id === id) || null);
  }

  function createProgram(partial = {}) {
    const program = {
      id: window.uid(),
      name: partial.name ?? "Untitled program",
      notes: partial.notes ?? "",
      cycles: partial.cycles ?? [
        { id: window.uid(), loops: 1, steps: [
          { id: window.uid(), name: "Step 1", direction: "heating", target: 95, duration: 30 },
        ]},
      ],
    };
    state.programs.push(program);
    emit({ type: "programs" });
    return structuredClone(program);
  }

  function updateProgram(id, patch) {
    const p = state.programs.find((x) => x.id === id);
    if (!p) return null;
    Object.assign(p, patch);
    emit({ type: "programs" });
    return structuredClone(p);
  }

  function deleteProgram(id) {
    const i = state.programs.findIndex((p) => p.id === id);
    if (i < 0) return false;
    state.programs.splice(i, 1);
    emit({ type: "programs" });
    return true;
  }

  // --- cycles ----------------------------------------------------------
  function addCycle(programId) {
    const p = state.programs.find((x) => x.id === programId);
    if (!p) return null;
    const cycle = {
      id: window.uid(),
      loops: 1,
      steps: [{ id: window.uid(), name: "Step 1", direction: "heating", target: 95, duration: 30 }],
    };
    p.cycles.push(cycle);
    emit({ type: "programs" });
    return structuredClone(cycle);
  }

  function updateCycle(programId, cycleId, patch) {
    const p = state.programs.find((x) => x.id === programId);
    const c = p?.cycles.find((x) => x.id === cycleId);
    if (!c) return null;
    Object.assign(c, patch);
    emit({ type: "programs" });
    return structuredClone(c);
  }

  function deleteCycle(programId, cycleId) {
    const p = state.programs.find((x) => x.id === programId);
    if (!p) return false;
    const i = p.cycles.findIndex((c) => c.id === cycleId);
    if (i < 0) return false;
    p.cycles.splice(i, 1);
    emit({ type: "programs" });
    return true;
  }

  // --- steps -----------------------------------------------------------
  function addStep(programId, cycleId, partial = {}) {
    const p = state.programs.find((x) => x.id === programId);
    const c = p?.cycles.find((x) => x.id === cycleId);
    if (!c) return null;
    const step = {
      id: window.uid(),
      name: partial.name ?? `Step ${c.steps.length + 1}`,
      direction: partial.direction ?? "heating",
      target: partial.target ?? 72,
      duration: partial.duration ?? 30,
    };
    c.steps.push(step);
    emit({ type: "programs" });
    return structuredClone(step);
  }

  function updateStep(programId, cycleId, stepId, patch) {
    const p = state.programs.find((x) => x.id === programId);
    const c = p?.cycles.find((x) => x.id === cycleId);
    const s = c?.steps.find((x) => x.id === stepId);
    if (!s) return null;
    // Auto-derive direction from previous step's target so user doesn't have to set it.
    if ("target" in patch) {
      const flat = c.steps;
      const idx = flat.findIndex((x) => x.id === stepId);
      const prevTarget = idx > 0 ? flat[idx - 1].target : 22;
      patch.direction = patch.target >= prevTarget ? "heating" : "cooling";
    }
    Object.assign(s, patch);
    emit({ type: "programs" });
    return structuredClone(s);
  }

  function deleteStep(programId, cycleId, stepId) {
    const p = state.programs.find((x) => x.id === programId);
    const c = p?.cycles.find((x) => x.id === cycleId);
    if (!c) return false;
    const i = c.steps.findIndex((s) => s.id === stepId);
    if (i < 0) return false;
    c.steps.splice(i, 1);
    emit({ type: "programs" });
    return true;
  }

  // --- run control -----------------------------------------------------
  function startRun(programId) {
    state.run = {
      programId,
      startedAt: Date.now(),
      pausedAt: null,
      totalPaused: 0,
      state: "running",
      error: null,
    };
    emit({ type: "run" });
    return getRunStatus();
  }

  function pauseRun() {
    if (!state.run || state.run.state !== "running") return null;
    state.run.pausedAt = Date.now();
    state.run.state = "paused";
    emit({ type: "run" });
    return getRunStatus();
  }

  function resumeRun() {
    if (!state.run || state.run.state !== "paused") return null;
    state.run.totalPaused += Date.now() - state.run.pausedAt;
    state.run.pausedAt = null;
    state.run.state = "running";
    emit({ type: "run" });
    return getRunStatus();
  }

  function stopRun() {
    state.run = null;
    emit({ type: "run" });
    return null;
  }

  function injectError(code, message) {
    if (!state.run) return null;
    state.run.state = "error";
    state.run.error = { code, message };
    emit({ type: "run" });
    return getRunStatus();
  }

  function clearError() {
    if (state.run?.error) {
      state.run.error = null;
      state.run.state = "running";
      emit({ type: "run" });
    }
  }

  function getRunStatus() {
    if (!state.run) return null;
    const r = state.run;
    let elapsedMs;
    if (r.state === "paused") {
      elapsedMs = r.pausedAt - r.startedAt - r.totalPaused;
    } else if (r.state === "error") {
      elapsedMs = Date.now() - r.startedAt - r.totalPaused;
    } else {
      elapsedMs = Date.now() - r.startedAt - r.totalPaused;
    }
    const elapsedSec = elapsedMs / 1000;
    const program = state.programs.find((p) => p.id === r.programId);
    const status = window.statusAt(program, elapsedSec);
    // Simulate block/lid temperature heading toward step target.
    const target = status.step?.target ?? 22;
    const lidTarget = 105;
    state.block += (target - state.block) * 0.18;
    state.lid += (lidTarget - state.lid) * 0.05;
    return {
      programId: r.programId,
      state: r.state,
      error: r.error,
      elapsedSec,
      totalSec: status.total,
      remainingSec: Math.max(0, status.total - elapsedSec),
      done: !!status.done,
      step: status.step,
      cycle: status.cycle,
      cycleIdx: status.cycleIdx,
      iter: status.iter,
      loops: status.loops,
      progressInStep: status.progressInStep,
      blockTempC: state.block,
      lidTempC: state.lid,
    };
  }

  // --- subscription ---------------------------------------------------
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    listPrograms, listTemplates, getProgram, createProgram, duplicateProgram, updateProgram, deleteProgram,
    addCycle, updateCycle, deleteCycle,
    addStep, updateStep, deleteStep,
    startRun, pauseRun, resumeRun, stopRun, injectError, clearError,
    getRunStatus,
    subscribe,
  };
}

// React hook on top of the API.  Re-renders on every emit + a 250ms tick
// while a run is active (so live telemetry updates).
function usePcrApi(api) {
  const [, setVer] = React.useState(0);
  React.useEffect(() => {
    return api.subscribe(() => setVer((v) => v + 1));
  }, [api]);
  React.useEffect(() => {
    const id = setInterval(() => {
      const s = api.getRunStatus();
      if (s && (s.state === "running" || s.state === "paused")) {
        setVer((v) => v + 1);
      }
    }, 250);
    return () => clearInterval(id);
  }, [api]);
  return api;
}

const DEFAULT_LID_TEMP_C = 110; // must match serve.py DEFAULT_LID_TEMP_C
const DEFAULT_BLOCK_TEMP_C = 21; // must match serve.py DEFAULT_BLOCK_TEMP_C

// ---------------------------------------------------------------------------
// Remote API — talks to the Python backend via REST + 2-second status poll.
//
// Drop-in replacement for createLocalPcrApi: all methods are synchronous
// from the UI's perspective (optimistic cache + background sync).
//
// Usage: createRemotePcrApi('')   ← empty string = same origin
// ---------------------------------------------------------------------------
function createRemotePcrApi(baseUrl) {
  const base = (baseUrl || '').replace(/\/$/, '');
  const listeners = new Set();
  const emit = (type) => listeners.forEach((fn) => fn({ type }));

  // Synchronous cache — returned directly by all read methods.
  const cache = { programs: [], templates: [] };
  let cachedStatus = null;

  // ── Auth ──────────────────────────────────────────────────────────────────

  let _token = sessionStorage.getItem('operatorToken') || null;
  let _authRequired = true; // updated from /status; assume true until we know otherwise

  function isOperator() { return !_authRequired || !!_token; }

  function _authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (_token) h['Authorization'] = `Bearer ${_token}`;
    return h;
  }

  async function login(password) {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) throw new Error('wrong password');
    const { token } = await res.json();
    _token = token;
    if (token) sessionStorage.setItem('operatorToken', token);
    emit('auth');
  }

  function logout() {
    if (_token) {
      fetch(`${base}/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${_token}` },
      }).catch(() => {});
    }
    _token = null;
    sessionStorage.removeItem('operatorToken');
    emit('auth');
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  async function apiFetch(method, path, body) {
    const opts = { method, headers: _authHeaders() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`${base}${path}`, opts);
    if (res.status === 403) {
      _token = null;
      sessionStorage.removeItem('operatorToken');
      emit('auth');
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.clone().json(); if (j.error) msg = j.error; } catch (_) {}
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  }

  // ── Slugify (must match server's slugify exactly) ─────────────────────────

  function slugify(text) {
    return (text || '').toLowerCase().trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '') || 'program';
  }

  function makeId(name) {
    const slug = slugify(name);
    const taken = new Set(cache.programs.map((p) => p.id));
    if (!taken.has(slug)) return slug;
    let i = 1;
    while (taken.has(`${slug}-${i}`)) i++;
    return `${slug}-${i}`;
  }

  // ── Status transform ──────────────────────────────────────────────────────
  // Maps the server's /status shape onto the local API's getRunStatus() shape
  // so the UI works without modification.

  function transformStatus(raw) {
    if (!raw || !raw.state) return null;
    if (raw.state === 'offline') return { state: 'offline' };

    const result = {
      state: raw.state,
      blockTempC: raw.blockTempC ?? 22,
      lidTempC: raw.lidTempC ?? 22,
      elapsedSec: raw.elapsedSec ?? 0,
      remainingSec: raw.remainingSec ?? 0,
      done: raw.state === 'complete',
      error: raw.error ?? null,
    };

    if (raw.state === 'running' && raw.cycleGroupIndex !== undefined) {
      result.programId = raw.programId;
      const program = cache.programs.find((p) => p.id === raw.programId);
      const cycle = program?.cycles[raw.cycleGroupIndex] ?? {
        id: `c${raw.cycleGroupIndex}`,
        loops: raw.cycleLoops || 1,
        steps: [],
      };
      const step = cycle.steps?.find((s) => s.name === raw.stepName)
        ?? { id: null, name: raw.stepName || '' };
      result.step = step;
      result.cycle = cycle;
      result.cycleIdx = raw.cycleGroupIndex;
      result.iter = (raw.cycleIteration || 1) - 1; // 0-based to match local API
      result.loops = raw.cycleLoops || 1;
      result.progressInStep = raw.progressInStep ?? null;
      result.stepHolding = raw.stepHolding ?? false;
    }

    return result;
  }

  // ── Background sync ───────────────────────────────────────────────────────

  let _pendingRun = false;  // true while a /run/start POST is in flight
  let _pendingStop = false; // true while a /run/stop POST is in flight

  async function syncPrograms() {
    try {
      cache.programs = await apiFetch('GET', '/programs');
      emit('programs');
    } catch (e) {
      // Server unreachable — keep stale cache, don't crash.
    }
  }

  async function syncTemplates() {
    try {
      cache.templates = await apiFetch('GET', '/templates');
      emit('programs');
    } catch (e) {}
  }

  async function syncStatus() {
    // Suppress polls while a run-start or run-stop is in flight: the device
    // transitions over ~2-8 s and an intermediate poll would revert optimistic state.
    if (_pendingRun || _pendingStop) return;
    try {
      const raw = await apiFetch('GET', '/status');
      const wasAuthRequired = _authRequired;
      _authRequired = raw.authRequired !== false; // treat missing as true for safety
      cachedStatus = transformStatus(raw);
      if (_authRequired !== wasAuthRequired) emit('auth');
    } catch (e) {
      cachedStatus = { state: 'offline' };
    }
    emit('run');
  }

  async function saveAsTemplate(programId) {
    await apiFetch('POST', `/programs/${programId}/template`);
    await syncTemplates();
  }

  // Load programs and templates immediately; poll status every 2 s.
  syncPrograms();
  syncTemplates();
  syncStatus();
  setInterval(syncStatus, 2000);

  // ── Synchronous reads (served from cache) ─────────────────────────────────

  function listPrograms() { return cache.programs; }
  function listTemplates() { return cache.templates; }
  function getProgram(id) { return cache.programs.find((p) => p.id === id) ?? null; }
  function getRunStatus() { return cachedStatus; }

  // ── Generic program mutation helper ───────────────────────────────────────
  // Updates local cache immediately (optimistic), then syncs to server.

  function _mutateProgram(programId, mutateFn) {
    const idx = cache.programs.findIndex((p) => p.id === programId);
    if (idx < 0) return null;
    const updated = JSON.parse(JSON.stringify(cache.programs[idx])); // deep clone
    const result = mutateFn(updated);
    cache.programs = [
      ...cache.programs.slice(0, idx),
      updated,
      ...cache.programs.slice(idx + 1),
    ];
    emit('programs');
    apiFetch('PATCH', `/programs/${programId}`, updated)
      .then(() => syncPrograms())
      .catch(console.error);
    return result;
  }

  // ── Program CRUD ──────────────────────────────────────────────────────────

  function createProgram(partial = {}) {
    const name = partial.name ?? 'Untitled program';
    const id = makeId(name);
    const program = {
      id, name,
      notes: partial.notes ?? '',
      lid_temperature: DEFAULT_LID_TEMP_C,
      cycles: partial.cycles ?? [{
        id: `${id}-c0`, loops: 1,
        steps: [{ id: `${id}-c0-s0`, name: 'Step 1', direction: 'heating', target: DEFAULT_BLOCK_TEMP_C, duration: 30 }],
      }],
    };
    cache.programs = [...cache.programs, program];
    emit('programs');
    apiFetch('POST', '/programs', program)
      .then((saved) => {
        if (saved && saved.id !== id) {
          cache.programs = cache.programs.map((p) => p.id === id ? saved : p);
          emit('programs');
        }
      })
      .catch(console.error);
    return program;
  }

  function duplicateProgram(srcId) {
    const src = cache.programs.find((p) => p.id === srcId)
      ?? cache.templates.find((t) => t.id === srcId);
    if (!src) return Promise.resolve(null);
    const name = `${src.name} (copy)`;
    const id = makeId(name);
    const copy = {
      ...JSON.parse(JSON.stringify(src)),
      id, name,
      cycles: src.cycles.map((c, ci) => ({
        ...c, id: `${id}-c${ci}`,
        steps: c.steps.map((s, si) => ({ ...s, id: `${id}-c${ci}-s${si}` })),
      })),
    };
    cache.programs = [...cache.programs, copy];
    emit('programs');
    return apiFetch('POST', '/programs', copy)
      .then((saved) => {
        if (saved && saved.id !== id) {
          cache.programs = cache.programs.map((p) => p.id === id ? saved : p);
          emit('programs');
          return saved;
        }
        return copy;
      })
      .catch((err) => { console.error(err); return copy; });
  }

  function updateProgram(id, patch) {
    return _mutateProgram(id, (p) => { Object.assign(p, patch); return p; });
  }

  function deleteProgram(id) {
    cache.programs = cache.programs.filter((p) => p.id !== id);
    emit('programs');
    apiFetch('DELETE', `/programs/${id}`).catch(console.error);
    return true;
  }

  // ── Cycle CRUD ────────────────────────────────────────────────────────────

  function addCycle(programId) {
    return _mutateProgram(programId, (p) => {
      const ci = p.cycles.length;
      const cycle = {
        id: `${programId}-c${ci}`, loops: 1,
        steps: [{ id: `${programId}-c${ci}-s0`, name: 'Step 1', direction: 'heating', target: DEFAULT_BLOCK_TEMP_C, duration: 30 }],
      };
      p.cycles.push(cycle);
      return cycle;
    });
  }

  function updateCycle(programId, cycleId, patch) {
    return _mutateProgram(programId, (p) => {
      const c = p.cycles.find((x) => x.id === cycleId);
      if (c) Object.assign(c, patch);
      return c ?? null;
    });
  }

  function deleteCycle(programId, cycleId) {
    return _mutateProgram(programId, (p) => {
      const i = p.cycles.findIndex((c) => c.id === cycleId);
      if (i >= 0) p.cycles.splice(i, 1);
      return i >= 0;
    });
  }

  // ── Step CRUD ─────────────────────────────────────────────────────────────

  function addStep(programId, cycleId, partial = {}) {
    return _mutateProgram(programId, (p) => {
      const c = p.cycles.find((x) => x.id === cycleId);
      if (!c) return null;
      const si = c.steps.length;
      const step = {
        id: `${cycleId}-s${si}`,
        name: partial.name ?? `Step ${si + 1}`,
        direction: partial.direction ?? 'heating',
        target: partial.target ?? DEFAULT_BLOCK_TEMP_C,
        duration: partial.duration ?? 30,
      };
      c.steps.push(step);
      return step;
    });
  }

  function updateStep(programId, cycleId, stepId, patch) {
    return _mutateProgram(programId, (p) => {
      const c = p.cycles.find((x) => x.id === cycleId);
      const s = c?.steps.find((x) => x.id === stepId);
      if (!s) return null;
      if ('target' in patch) {
        const idx = c.steps.findIndex((x) => x.id === stepId);
        const prevTarget = idx > 0 ? c.steps[idx - 1].target : 22;
        patch.direction = patch.target >= prevTarget ? 'heating' : 'cooling';
      }
      Object.assign(s, patch);
      return s;
    });
  }

  function deleteStep(programId, cycleId, stepId) {
    return _mutateProgram(programId, (p) => {
      const c = p.cycles.find((x) => x.id === cycleId);
      if (!c) return false;
      const i = c.steps.findIndex((s) => s.id === stepId);
      if (i >= 0) c.steps.splice(i, 1);
      return i >= 0;
    });
  }

  // ── Run control ───────────────────────────────────────────────────────────

  function startRun(programId) {
    _pendingRun = true;
    cachedStatus = { state: 'running', programId, blockTempC: 22.0, lidTempC: 22.0, elapsedSec: 0, remainingSec: 0, done: false, error: null };
    emit('run');
    apiFetch('POST', '/run/start', { programId })
      .then(() => { _pendingRun = false; return syncStatus(); })
      .catch((err) => {
        _pendingRun = false;
        cachedStatus = { state: 'error', error: { message: err.message } };
        emit('run');
      });
    return cachedStatus;
  }

  function stopRun() {
    _pendingStop = true;
    cachedStatus = { state: 'stopped' };
    emit('run');
    apiFetch('POST', '/run/stop')
      .then(() => { _pendingStop = false; return syncStatus(); })
      .catch(() => { _pendingStop = false; });
    return null;
  }

  function shutdownDevice() {
    return apiFetch('POST', '/system/shutdown');
  }

  // The OpenPCR device has no pause/resume — expose as no-ops for API compat.
  function pauseRun() { return null; }
  function resumeRun() { return null; }
  function injectError() { return null; }
  function clearError() {}

  // ── Subscription ─────────────────────────────────────────────────────────

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    listPrograms, listTemplates, getProgram, createProgram, duplicateProgram,
    updateProgram, deleteProgram,
    addCycle, updateCycle, deleteCycle,
    addStep, updateStep, deleteStep,
    startRun, pauseRun, resumeRun, stopRun, shutdownDevice, injectError, clearError,
    getRunStatus,
    login, logout, isOperator, saveAsTemplate,
    subscribe,
  };
}

window.createLocalPcrApi = createLocalPcrApi;
window.createRemotePcrApi = createRemotePcrApi;
window.usePcrApi = usePcrApi;

})();
