// Mobile (touchscreen) layout — Direction A.  Single-column.
// Sheet-based navigation: program list sheet ↔ program detail.

(function(){
const { useState: useStateM } = React;

// Parse a duration entry: "m:ss" or "mm:ss" → seconds; bare integer → seconds.
// Returns null on invalid input (widget reverts to previous value).
function parseDuration(raw) {
  const s = raw.trim();
  if (s.includes(':')) {
    const [mPart, sPart] = s.split(':');
    const m = parseInt(mPart, 10);
    const sec = parseInt(sPart, 10);
    if (isNaN(m) || isNaN(sec) || m < 0 || sec < 0 || sec > 59) return null;
    return m * 60 + sec;
  }
  const n = parseInt(s, 10);
  return isNaN(n) || n < 0 ? null : n;
}

function PCRMobileApp({ tweaks }) {
  const { theme = "light", density = "compact", intensity = "medium", timeFormat = "mmss", tempUnit = "C" } = tweaks || {};
  const apiRef = React.useRef(null);
  if (!apiRef.current) apiRef.current = window.createRemotePcrApi('');
  const api = window.usePcrApi(apiRef.current);

  const programs = api.listPrograms();
  const templates = api.listTemplates();
  const runStatus = api.getRunStatus();
  const [selectedId, setSelectedId] = useStateM(programs[0]?.id || null);
  const [viewingTemplate, setViewingTemplate] = useStateM(false);
  const [view, setView] = useStateM("list"); // "list" | "detail"
  const [showLogin, setShowLogin] = useStateM(false);

  // Once both programs and status have loaded, auto-select the running program
  // and switch to the detail view; otherwise stay on the default list view.
  const initDoneRef = React.useRef(false);
  React.useEffect(() => {
    if (initDoneRef.current || programs.length === 0 || runStatus === null) return;
    initDoneRef.current = true;
    if (runStatus.programId) {
      setSelectedId(runStatus.programId);
      setView("detail");
    } else {
      setSelectedId(programs[0].id);
    }
  }, [programs.length, runStatus]);

  const [selectedStepId, setSelectedStepId] = useStateM(null);
  const isTemplate = viewingTemplate;
  const program = isTemplate
    ? templates.find((t) => t.id === selectedId)
    : programs.find((p) => p.id === selectedId);
  const showRunStatus = runStatus && runStatus.state !== 'offline' && runStatus.state !== 'stopped'
    && (runStatus.programId == null || runStatus.programId === selectedId)
    ? runStatus : null;

  // Client-side step timer: start at 0 when job="holding" first appears for a
  // step (not at the server-poll timestamp). Reset on step-name or group change.
  const stepNameRef = React.useRef(null);
  const groupIdxRef = React.useRef(null);
  const holdingActiveRef = React.useRef(false);
  const stepStartRef = React.useRef(null);
  const liveStepName = showRunStatus?.step?.name || '';
  const liveGroupIdx = showRunStatus?.cycleIdx ?? null;
  const liveHolding = showRunStatus?.stepHolding || false;
  if (liveStepName !== stepNameRef.current || liveGroupIdx !== groupIdxRef.current) {
    stepNameRef.current = liveStepName;
    groupIdxRef.current = liveGroupIdx;
    holdingActiveRef.current = false;
    stepStartRef.current = null;
  }
  if (liveHolding && !holdingActiveRef.current) {
    holdingActiveRef.current = true;
    stepStartRef.current = Date.now();
  }
  if (!liveHolding) holdingActiveRef.current = false;
  let liveProgressInStep = null;
  if (liveHolding && liveStepName && stepStartRef.current !== null && showRunStatus) {
    const gi = showRunStatus.cycleIdx;
    const stepDur = program?.cycles?.[gi]?.steps?.find((s) => s.name === liveStepName)?.duration;
    if (stepDur) liveProgressInStep = Math.min(1.0, (Date.now() - stepStartRef.current) / 1000 / stepDur);
  }
  const showRunStatusWithProgress = showRunStatus
    ? { ...showRunStatus, progressInStep: liveProgressInStep }
    : showRunStatus;
  const dark = theme === "dark";

  const bg = dark ? "oklch(0.18 0.01 260)" : "oklch(0.985 0.002 80)";
  const fg = dark ? "oklch(0.95 0.01 260)" : "oklch(0.22 0.01 260)";
  const subBg = dark ? "oklch(0.22 0.01 260)" : "white";
  const border = dark ? "oklch(0.30 0.01 260)" : "oklch(0.92 0.005 80)";

  const totalSec = program ? window.programTotalSeconds(program) : 0;
  const isOperator = api.isOperator();
  const anyRunning = runStatus?.state === 'running';
  const isEditable = isOperator && !anyRunning && !isTemplate;
  const isRunning = showRunStatus?.state === "running";
  const isPaused = showRunStatus?.state === "paused";
  const isError = showRunStatus?.state === "error";
  const isDone = showRunStatus?.done;
  const isOffline = runStatus?.state === "offline";

  const selectRunning = () => {
    const pid = runStatus?.programId;
    if (pid) { setSelectedId(pid); setViewingTemplate(false); }
    setView("detail");
  };

  return (
    <div style={{
      width: "100%", height: "100%", background: bg, color: fg, fontFamily: "var(--font-sans)",
      display: "flex", flexDirection: "column", overflow: "hidden",
      position: "relative",
    }}>
      {view === "list" ? (
        <MobileList
          programs={programs} templates={templates} selectedId={selectedId} runningId={runStatus?.programId}
          runStatus={runStatus} isEditable={isEditable} isOperator={isOperator}
          onSelect={(id) => { setSelectedId(id); setViewingTemplate(false); setView("detail"); setSelectedStepId(null); }}
          onAdd={() => { const p = api.createProgram(); setSelectedId(p.id); setViewingTemplate(false); setView("detail"); }}
          onDuplicate={(id) => { api.duplicateProgram(id).then((p) => { if (p) { setSelectedId(p.id); setViewingTemplate(false); setView("detail"); } }); }}
          onViewTemplate={(id) => { setSelectedId(id); setViewingTemplate(true); setView("detail"); setSelectedStepId(null); }}
          onUseTemplate={(id) => { api.duplicateProgram(id).then((p) => { if (p) { setSelectedId(p.id); setViewingTemplate(false); setView("detail"); } }); }}
          onRename={(id, name) => api.updateProgram(id, { name })}
          onDelete={(id) => api.deleteProgram(id)}
          onShowLogin={() => setShowLogin(true)}
          onLogout={() => api.logout()}
          onSelectRunning={selectRunning}
          tweaks={{ density, intensity, timeFormat, tempUnit }}
          api={api}
          dark={dark} subBg={subBg} border={border}
        />
      ) : (
        <MobileDetail
          program={program} runStatus={showRunStatusWithProgress} api={api}
          tweaks={{ density, intensity, timeFormat, tempUnit }}
          dark={dark} subBg={subBg} border={border}
          isRunning={isRunning} isPaused={isPaused} isError={isError} isDone={isDone} isOffline={isOffline}
          isEditable={isEditable} isOperator={isOperator} anyRunning={anyRunning} isTemplate={isTemplate}
          totalSec={totalSec} selectedStepId={selectedStepId}
          onSelectStep={(id) => setSelectedStepId(id === selectedStepId ? null : id)}
          onBack={() => setView("list")}
          onShowLogin={() => setShowLogin(true)}
          onLogout={() => api.logout()}
          onSaveTemplate={() => api.saveAsTemplate(program.id)}
          onUseTemplate={() => { api.duplicateProgram(selectedId).then((p) => { if (p) { setSelectedId(p.id); setViewingTemplate(false); setSelectedStepId(null); } }); }}
        />
      )}
      {showLogin && (
        <LoginSheet
          dark={dark} subBg={subBg} border={border}
          onClose={() => setShowLogin(false)}
          onLogin={(pw) => api.login(pw)}
        />
      )}
    </div>
  );
}

// ── Login sheet ───────────────────────────────────────────────────────────────

function LoginSheet({ dark, subBg, border, onClose, onLogin }) {
  const [password, setPassword] = useStateM('');
  const [error, setError] = useStateM('');
  const [busy, setBusy] = useStateM(false);
  const inputRef = React.useRef(null);
  React.useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      await onLogin(password);
      onClose();
    } catch (e) {
      setError('Wrong password');
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100,
        display: "flex", alignItems: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", background: subBg, borderRadius: "16px 16px 0 0",
          padding: "20px 20px calc(env(safe-area-inset-bottom,0px) + 20px)",
          boxShadow: "0 -4px 24px rgba(0,0,0,0.18)",
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 4 }}>Operator Login</div>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 16 }}>
          Enter the operator password to enable editing and run control.
        </div>
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Password"
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "12px 14px", borderRadius: 10, fontSize: 15,
            border: `1.5px solid ${error ? "oklch(0.62 0.20 25)" : border}`,
            background: dark ? "oklch(0.18 0.01 260)" : "white",
            color: "inherit", outline: "none",
          }}
        />
        {error && <div style={{ color: "oklch(0.55 0.20 25)", fontSize: 12, marginTop: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={mobileBtn(border, dark, false)}>Cancel</button>
          <button onClick={submit} disabled={busy} style={mobileBtn(border, dark, true)}>
            {busy ? 'Logging in…' : 'Login as Operator'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Running-program status bar ────────────────────────────────────────────────

function ListStatusStrip({ runStatus, programs, tweaks, dark, subBg, border }) {
  const { intensity, tempUnit, timeFormat } = tweaks;
  const isRunning = runStatus?.state === 'running';
  const blockTemp = runStatus?.blockTempC ?? null;
  const lidTemp   = runStatus?.lidTempC   ?? null;
  const blockColors = dark ? window.tempColorDark(blockTemp ?? 20, intensity) : window.tempColor(blockTemp ?? 20, intensity);
  const lidColors   = dark ? window.tempColorDark(lidTemp ?? 20, intensity)   : window.tempColor(lidTemp ?? 20, intensity);
  const runningProgram = programs.find(p => p.id === runStatus?.programId);
  const totalSec = runningProgram ? window.programTotalSeconds(runningProgram) : 0;
  const remainingSec = isRunning
    ? (runStatus.remainingSec > 0 ? runStatus.remainingSec : (runStatus.cycleIdx == null ? totalSec : 0))
    : null;
  return (
    <div style={{ padding: "10px 14px", background: subBg, borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Block</div>
          <div style={{
            display: "inline-block", padding: "2px 8px", borderRadius: 6,
            background: blockColors.bg, color: blockColors.fg,
            fontFamily: "var(--font-mono)", fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em",
          }}>{blockTemp != null ? window.fmtTemp(blockTemp, tempUnit) : "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Lid</div>
          <div style={{
            display: "inline-block", padding: "2px 8px", borderRadius: 6,
            background: lidColors.bg, color: lidColors.fg,
            fontFamily: "var(--font-mono)", fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em",
          }}>{lidTemp != null ? window.fmtTemp(lidTemp, tempUnit) : "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Remaining</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em" }}>
            {remainingSec != null ? window.fmtTime(remainingSec, timeFormat) : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Login / logout button ─────────────────────────────────────────────────────

function AuthButton({ isOperator, onShowLogin, onLogout, dark }) {
  const style = {
    padding: "5px 10px", borderRadius: 8,
    border: `1px solid ${dark ? "oklch(0.40 0.01 260)" : "oklch(0.85 0.01 260)"}`,
    background: "transparent",
    color: dark ? "oklch(0.85 0.01 260)" : "oklch(0.45 0.01 260)",
    fontSize: 11, fontWeight: 500, cursor: "pointer",
  };
  return isOperator
    ? <button onClick={onLogout} title="Return to viewer mode" style={style}>Logout</button>
    : <button onClick={onShowLogin} title="Login as operator" style={style}>Login</button>;
}

// ── Program list ──────────────────────────────────────────────────────────────

function MobileList({ programs, templates = [], selectedId, runningId, runStatus, tweaks, api, isEditable, isOperator, onSelect, onAdd, onDuplicate, onViewTemplate, onUseTemplate, onRename, onDelete, onShowLogin, onLogout, onSelectRunning, dark, subBg, border }) {
  const [showTpl, setShowTpl] = useStateM(false);
  return (
    <>
      <div style={{
        padding: "14px 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: `1px solid ${border}`, background: subBg,
      }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.015em" }}>Programs</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isOperator && (
            <button
              onClick={() => {
                if (window.confirm('Shut down the Raspberry Pi?')) {
                  api.shutdownDevice().catch(() => {});
                }
              }}
              title="Gracefully power off the Raspberry Pi"
              style={{
                padding: "5px 10px", borderRadius: 8,
                border: `1px solid ${dark ? "oklch(0.40 0.01 260)" : "oklch(0.85 0.01 260)"}`,
                background: "transparent",
                color: dark ? "oklch(0.85 0.01 260)" : "oklch(0.45 0.01 260)",
                fontSize: 11, fontWeight: 500, cursor: "pointer",
              }}
            >Power off</button>
          )}
          <AuthButton isOperator={isOperator} onShowLogin={onShowLogin} onLogout={onLogout} dark={dark} />
          {isEditable && (
            <button
              onClick={onAdd}
              aria-label="New program"
              style={{
                width: 36, height: 36, borderRadius: 10, border: "none",
                background: "oklch(0.62 0.16 260)", color: "white",
                display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          )}
        </div>
      </div>
      <ListStatusStrip runStatus={runStatus} programs={programs} tweaks={tweaks} dark={dark} subBg={subBg} border={border} />
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px" }}>
        {programs.length === 0 && (
          <div style={{ padding: 28, textAlign: "center", opacity: 0.6, fontSize: 13 }}>
            No programs yet{isEditable ? " — tap + to create one." : "."}
          </div>
        )}
        {programs.map((p, i) => {
          const isSel = p.id === selectedId;
          const isRun = p.id === runningId;
          const totalSec = window.programTotalSeconds(p);
          return (
            <div
              key={p.id}
              onClick={() => onSelect(p.id)}
              style={{
                padding: "12px 14px", borderRadius: 12, marginBottom: 6,
                background: isSel ? (dark ? "oklch(0.30 0.04 260)" : "oklch(0.96 0.02 260)") : subBg,
                border: `1px solid ${border}`,
                display: "flex", alignItems: "center", gap: 12, cursor: "pointer",
                minHeight: 56,
              }}
            >
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, opacity: 0.5, minWidth: 18 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {p.name || "Untitled program"}
                </div>
                <div style={{ fontSize: 11, opacity: 0.55, fontFamily: "var(--font-mono)", marginTop: 2 }}>
                  {p.cycles.length} cycles · {window.fmtTime(totalSec, "hms")}
                </div>
              </div>
              {isRun && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "oklch(0.65 0.16 150)" }} />}
              {isEditable && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDuplicate(p.id); }}
                    aria-label="Duplicate"
                    style={{
                      width: 32, height: 32, borderRadius: 8, border: "none",
                      background: "transparent", color: dark ? "oklch(0.85 0.01 260)" : "oklch(0.42 0.16 260)",
                      display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.1" fill="none" /><path d="M8 3.5V2.5a1 1 0 00-1-1H2.5a1 1 0 00-1 1V7a1 1 0 001 1h1" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" /></svg>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete "${p.name || "Untitled program"}"?`)) onDelete(p.id); }}
                    aria-label="Delete"
                    style={{
                      width: 32, height: 32, borderRadius: 8, border: "none",
                      background: "transparent", color: dark ? "oklch(0.7 0.05 25)" : "oklch(0.55 0.12 25)",
                      display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M2.5 3.5h7M5 5.5v3M7 5.5v3M3.5 3.5l.5 6.5h4l.5-6.5M4.5 3.5V2h3v1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                </>
              )}
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.4 }}>
                <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          );
        })}

        {/* Templates */}
        <div style={{ marginTop: 18, paddingTop: 4 }}>
          <button
            onClick={() => setShowTpl(!showTpl)}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 6,
              padding: "10px 6px", border: "none", background: "transparent",
              color: "inherit", cursor: "pointer",
              fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.6,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: `rotate(${showTpl ? 90 : 0}deg)`, transition: "transform 150ms ease" }}>
              <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Template library
            <span style={{ marginLeft: "auto", fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "rgba(0,0,0,0.06)", letterSpacing: 0 }}>{templates.length}</span>
          </button>
          {showTpl && templates.map((t) => (
            <div
              key={t.id}
              style={{
                padding: "10px 14px", borderRadius: 10, marginBottom: 4,
                background: subBg, border: `1px dashed ${border}`,
                display: "flex", alignItems: "center", gap: 10, minHeight: 50,
                cursor: "pointer",
              }}
              onClick={() => onViewTemplate(t.id)}
            >
              <svg width="12" height="13" viewBox="0 0 9 10" fill="none" style={{ opacity: 0.4, flexShrink: 0 }}>
                <rect x="1.5" y="4.5" width="6" height="5" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
                <path d="M3 4.5V3a1.5 1.5 0 013 0v1.5" stroke="currentColor" strokeWidth="1" fill="none" />
              </svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</div>
                {t.notes && <div style={{ fontSize: 10.5, opacity: 0.5, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.notes}</div>}
              </div>
              {isEditable && (
                <button
                  onClick={(e) => { e.stopPropagation(); onUseTemplate(t.id); }}
                  style={{
                    padding: "6px 12px", borderRadius: 7, border: `1px solid oklch(0.85 0.06 260)`,
                    background: "transparent", color: "oklch(0.42 0.16 260)",
                    fontSize: 12, fontWeight: 500, cursor: "pointer",
                  }}
                >
                  Use
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Program detail ────────────────────────────────────────────────────────────

function MobileDetail({ program, runStatus, api, tweaks, dark, subBg, border, isRunning, isPaused, isError, isDone, isOffline, isEditable, isOperator, anyRunning, isTemplate, totalSec, selectedStepId, onSelectStep, onBack, onShowLogin, onLogout, onSaveTemplate, onUseTemplate }) {
  if (!program) {
    return (
      <div style={{ padding: 40, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.6 }}>No program selected</div>
        <button onClick={onBack} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${border}`, background: "transparent", color: "inherit", cursor: "pointer" }}>Back to list</button>
      </div>
    );
  }
  const { density, intensity, timeFormat, tempUnit } = tweaks;
  // During lid pre-heat (running but no cycle started yet), the device hasn't begun its
  // countdown — use the full program duration as the estimate until it does.
  const remainingSec = runStatus
    ? (runStatus.remainingSec > 0
        ? runStatus.remainingSec
        : (runStatus.state === 'running' && runStatus.cycleIdx == null ? totalSec : 0))
    : totalSec;
  const elapsedSec = runStatus ? runStatus.elapsedSec : 0;

  // Compute progress bar from cycle/iteration position so ramp time between
  // steps doesn't inflate the percentage beyond the step durations in the YAML.
  let completedSec = 0;
  if (runStatus && program && runStatus.cycleIdx != null) {
    const gi = runStatus.cycleIdx;
    for (let i = 0; i < gi && i < program.cycles.length; i++) {
      const g = program.cycles[i];
      completedSec += g.loops * g.steps.reduce((s, st) => s + (st.duration || 0), 0);
    }
    if (gi < program.cycles.length) {
      const iterSec = program.cycles[gi].steps.reduce((s, st) => s + (st.duration || 0), 0);
      completedSec += (runStatus.iter || 0) * iterSec;
    }
  }
  const pct = totalSec > 0 ? Math.min(100, (completedSec / totalSec) * 100) : 0;
  const blockTemp = runStatus?.blockTempC ?? api.getRunStatus()?.blockTempC ?? 22.0;
  const blockColors = dark ? window.tempColorDark(blockTemp, intensity) : window.tempColor(blockTemp, intensity);
  // Use raw API status for lid temp so it shows even when the device is stopped.
  const lidTemp = runStatus?.lidTempC ?? api.getRunStatus()?.lidTempC ?? null;
  const lidColors = dark ? window.tempColorDark(lidTemp ?? 20, intensity) : window.tempColor(lidTemp ?? 20, intensity);

  const stateLabel = isTemplate ? "TEMPLATE" : isOffline ? "OFFLINE" : isError ? "ERROR" : isDone ? "COMPLETE" : isPaused ? "PAUSED" : isRunning ? "RUNNING" : "READY";
  const stateColor = isTemplate ? "oklch(0.55 0.14 290)" : isOffline ? "oklch(0.62 0.14 55)" : isError ? "oklch(0.62 0.20 25)" : isDone ? "oklch(0.55 0.14 150)" : isPaused ? "oklch(0.65 0.14 75)" : isRunning ? "oklch(0.55 0.14 150)" : (dark ? "oklch(0.65 0.01 260)" : "oklch(0.55 0.01 260)");

  return (
    <>
      {/* Top bar */}
      <div style={{
        padding: "calc(env(safe-area-inset-top, 0px) + 14px) 12px 10px", borderBottom: `1px solid ${border}`,
        display: "flex", alignItems: "center", gap: 10, background: subBg, flexShrink: 0,
      }}>
        <button
          onClick={onBack}
          aria-label="Back"
          style={{
            width: 36, height: 36, borderRadius: 9, border: "none", background: "transparent",
            color: dark ? "oklch(0.92 0.05 260)" : "oklch(0.42 0.16 260)",
            display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 14 14" fill="none"><path d="M9 3l-4 4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 1 }}>{isTemplate ? "Template" : "Program"}</div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {isEditable
              ? <window.EditableValue value={program.name} onCommit={(v) => api.updateProgram(program.id, { name: v })} dark={dark} placeholder="Untitled" />
              : (program.name || "Untitled")}
          </h2>
        </div>
        <AuthButton isOperator={isOperator} onShowLogin={onShowLogin} onLogout={onLogout} dark={dark} />
        <span style={{
          padding: "3px 8px", borderRadius: 999, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
          background: `${stateColor.replace(")", " / 0.14)")}`, color: stateColor,
        }}>{stateLabel}</span>
      </div>

      {/* Status card */}
      <div style={{ padding: "12px 14px", background: subBg, borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Block</div>
            <div style={{
              display: "inline-block", padding: "2px 8px", borderRadius: 6,
              background: blockColors.bg, color: blockColors.fg,
              fontFamily: "var(--font-mono)", fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em",
            }}>{window.fmtTemp(blockTemp, tempUnit)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Lid</div>
            <div style={{
              display: "inline-block", padding: "2px 8px", borderRadius: 6,
              background: lidColors.bg, color: lidColors.fg,
              fontFamily: "var(--font-mono)", fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em",
            }}>{lidTemp != null ? window.fmtTemp(lidTemp, tempUnit) : "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Remaining</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em" }}>
              {window.fmtTime(remainingSec, timeFormat)}
            </div>
          </div>
        </div>
        {runStatus?.step && (
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            <span style={{ fontWeight: 600 }}>{runStatus.step.name}</span>
            <span style={{ opacity: 0.4, margin: "0 6px" }}>·</span>
            <span style={{ opacity: 0.7 }}>{`Cycle ${runStatus.cycleIdx + 1}`}</span>
            <span style={{ opacity: 0.4, margin: "0 6px" }}>·</span>
            <span style={{ fontFamily: "var(--font-mono)", opacity: 0.7 }}>iter {runStatus.iter + 1}/{runStatus.loops}</span>
          </div>
        )}
        <div style={{ height: 4, borderRadius: 2, background: dark ? "oklch(0.30 0.01 260)" : "oklch(0.92 0.005 80)", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "oklch(0.62 0.16 260)", transition: "width 250ms linear" }} />
        </div>
        {isError && (
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "oklch(0.96 0.04 25)", color: "oklch(0.45 0.18 25)", fontSize: 12 }}>
            {runStatus.error?.message}
          </div>
        )}
      </div>

      {/* "Stop run first" banner for operators while a run is active */}
      {isOperator && anyRunning && !isTemplate && (
        <div style={{
          padding: "8px 16px", fontSize: 12, opacity: 0.8, flexShrink: 0,
          background: "oklch(0.62 0.14 55 / 0.10)", borderBottom: `1px solid ${border}`,
        }}>
          Stop the current run to edit programs.
        </div>
      )}

      {/* Cycles */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "12px 12px 16px" }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, opacity: 0.55, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Settings</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ opacity: 0.6, fontSize: 17 }}>Lid temperature</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
              {isEditable
                ? <window.EditableValue
                    value={program.lid_temperature ?? 110}
                    onCommit={(v) => api.updateProgram(program.id, { lid_temperature: Math.round(v) })}
                    type="number" min={20} max={120} step={1} suffix="°C" dark={dark} />
                : window.fmtTemp(program.lid_temperature ?? 110, tempUnit)
              }
            </span>
          </div>
        </div>
        <div style={{ fontSize: 10, opacity: 0.55, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>Cycles</div>
        {program.cycles.map((cycle, idx) => (
          <MobileCycle
            key={cycle.id}
            cycle={{ ...cycle, _idx: idx }}
            program={program} api={api} runStatus={runStatus}
            intensity={intensity} dark={dark} border={border} subBg={subBg}
            isEditable={isEditable} selectedStepId={selectedStepId} onSelectStep={onSelectStep}
          />
        ))}
        {isEditable && (
          <button
            onClick={() => api.addCycle(program.id)}
            style={{
              width: "100%", padding: "12px", borderRadius: 12,
              border: `1.5px dashed ${border}`, background: "transparent",
              color: dark ? "oklch(0.78 0.01 260)" : "oklch(0.42 0.16 260)",
              cursor: "pointer", fontSize: 13, fontWeight: 500,
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              marginTop: 4,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            Add cycle
          </button>
        )}
      </div>

      {/* Bottom run controls */}
      <div style={{
        padding: "10px 14px calc(env(safe-area-inset-bottom, 0px) + 14px)",
        background: subBg, borderTop: `1px solid ${border}`, display: "flex", gap: 8,
        boxShadow: "0 -2px 8px rgba(0,0,0,0.04)", flexShrink: 0,
      }}>
        {isTemplate ? (
          isOperator ? (
            <button style={mobileBtn(border, dark, true)} onClick={onUseTemplate}>Use template</button>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, opacity: 0.5 }}>
              Login as operator to use this template
            </div>
          )
        ) : isOperator ? (
          isError ? (
            <>
              <button style={mobileBtn(border, dark, false)} onClick={() => api.clearError()}>Acknowledge</button>
              <button style={mobileBtn(border, dark, true, "oklch(0.62 0.20 25)")} onClick={() => api.stopRun()}>Stop</button>
            </>
          ) : isDone ? (
            <>
              <button style={mobileBtn(border, dark, true)} onClick={() => api.stopRun()}>Reset</button>
              <button style={{ ...mobileBtn(border, dark, false), flex: "none", padding: "13px 14px", fontSize: 12 }} onClick={onSaveTemplate}>Save as template</button>
            </>
          ) : isRunning ? (
            <button style={mobileBtn(border, dark, true, "oklch(0.62 0.20 25)")} onClick={() => api.stopRun()}>Stop</button>
          ) : (
            <>
              <button style={mobileBtn(border, dark, true)} onClick={() => api.startRun(program.id)} disabled={!program.cycles.length}>
                ▶ Run program
              </button>
              <button style={{ ...mobileBtn(border, dark, false), flex: "none", padding: "13px 14px", fontSize: 12 }} onClick={onSaveTemplate}>Save as template</button>
            </>
          )
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, opacity: 0.5 }}>
            Login as operator to run programs
          </div>
        )}
      </div>
    </>
  );
}

function mobileBtn(border, dark, primary, accent) {
  return {
    flex: 1, padding: "13px", borderRadius: 11, fontSize: 14, fontWeight: 600,
    border: primary ? "none" : `1px solid ${border}`,
    background: primary ? (accent || "oklch(0.62 0.16 260)") : (dark ? "oklch(0.26 0.01 260)" : "white"),
    color: primary ? "white" : (dark ? "oklch(0.92 0.01 260)" : "oklch(0.32 0.01 260)"),
    cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  };
}

// ── Cycle card ────────────────────────────────────────────────────────────────

function MobileCycle({ cycle, program, api, runStatus, intensity, dark, border, subBg, isEditable, selectedStepId, onSelectStep }) {
  const isActiveCycle = runStatus && runStatus.cycle?.id === cycle.id;
  return (
    <div style={{
      marginBottom: 10, padding: "10px 12px", borderRadius: 12, background: subBg,
      border: `1px solid ${border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>
          {`Cycle ${cycle._idx + 1}`}
        </div>
        <div style={{
          padding: "2px 8px", borderRadius: 999,
          background: dark ? "oklch(0.30 0.04 260)" : "oklch(0.94 0.02 260)",
          color: dark ? "oklch(0.92 0.05 260)" : "oklch(0.42 0.16 260)",
          fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600,
        }}>
          ×{isEditable
            ? <window.EditableValue value={cycle.loops} onCommit={(v) => api.updateCycle(program.id, cycle.id, { loops: Math.max(1, Math.round(v)) })} type="number" min={1} max={999} dark={dark} />
            : cycle.loops}
        </div>
        {isActiveCycle && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, opacity: 0.7 }}>{runStatus.iter + 1}/{cycle.loops}</div>
        )}
        {isEditable && (
          <button
            onClick={() => { if (window.confirm(`Delete cycle "${cycle.name || `Cycle ${cycle._idx + 1}`}" and its ${cycle.steps.length} step${cycle.steps.length === 1 ? "" : "s"}?`)) api.deleteCycle(program.id, cycle.id); }}
            aria-label="Delete cycle"
            style={{
              width: 28, height: 28, borderRadius: 7, border: `1px solid ${border}`,
              background: "transparent", color: dark ? "oklch(0.78 0.05 25)" : "oklch(0.55 0.12 25)",
              cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M2.5 3.5h7M5 5.5v3M7 5.5v3M3.5 3.5l.5 6.5h4l.5-6.5M4.5 3.5V2h3v1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {cycle.steps.map((step) => {
          const colors = dark ? window.tempColorDark(step.target, intensity) : window.tempColor(step.target, intensity);
          const isActiveStep = runStatus && runStatus.step?.id === step.id && runStatus.cycle?.id === cycle.id;
          const isSelected = selectedStepId === step.id;
          return (
            <div
              key={step.id}
              onClick={() => onSelectStep(step.id)}
              style={{
                padding: "10px 12px", borderRadius: 9,
                background: colors.bg, color: colors.fg,
                border: `1.5px solid ${isSelected ? "oklch(0.62 0.16 260)" : colors.border}`,
                display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                position: "relative", overflow: "hidden",
              }}
            >
              {isActiveStep && runStatus.progressInStep != null && (
                <div style={{
                  position: "absolute", inset: 0,
                  background: `linear-gradient(to right, oklch(0.62 0.16 260 / 0.16) ${runStatus.progressInStep * 100}%, transparent ${runStatus.progressInStep * 100}%)`,
                  pointerEvents: "none",
                }} />
              )}
              <div style={{ position: "relative", zIndex: 1, flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  {isEditable
                    ? <window.EditableValue value={step.name} onCommit={(v) => api.updateStep(program.id, cycle.id, step.id, { name: v })} dark={dark} placeholder="step" />
                    : (step.name || "step")}
                </div>
                <div style={{ fontSize: 18, fontWeight: 600, opacity: 0.85, fontFamily: "var(--font-mono)", letterSpacing: "-0.02em", lineHeight: 1.1 }}>
                  {isEditable
                    ? <window.EditableValue value={step.duration} displayValue={window.fmtTime(step.duration)} parseValue={parseDuration} onCommit={(v) => api.updateStep(program.id, cycle.id, step.id, { duration: v })} dark={dark} />
                    : window.fmtTime(step.duration)}
                </div>
              </div>
              <div style={{ position: "relative", zIndex: 1, fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
                {isEditable
                  ? <window.EditableValue value={step.target} onCommit={(v) => api.updateStep(program.id, cycle.id, step.id, { target: v })} type="number" min={20} max={105} step={0.1} suffix="°" dark={dark} />
                  : `${step.target}°`}
              </div>
              {isEditable && (
                <button
                  onClick={(e) => { e.stopPropagation(); api.deleteStep(program.id, cycle.id, step.id); }}
                  aria-label="Delete step"
                  style={{
                    position: "relative", zIndex: 2,
                    width: 28, height: 28, borderRadius: 7, border: "none",
                    background: "rgba(255,255,255,0.5)", color: "oklch(0.45 0.16 25)",
                    cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M2.5 3.5h7M5 5.5v3M7 5.5v3M3.5 3.5l.5 6.5h4l.5-6.5M4.5 3.5V2h3v1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              )}
            </div>
          );
        })}
        {isEditable && (
          <button
            onClick={() => api.addStep(program.id, cycle.id)}
            style={{
              padding: "10px", borderRadius: 9, border: `1.5px dashed ${border}`, background: "transparent",
              color: dark ? "oklch(0.78 0.01 260)" : "oklch(0.55 0.01 260)", cursor: "pointer", fontSize: 12,
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            Add step
          </button>
        )}
      </div>
    </div>
  );
}

window.PCRMobileApp = PCRMobileApp;
})();
