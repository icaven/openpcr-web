(function(){
// Inline-editable value widget.  Click to edit, Enter/blur to commit, Escape to cancel.

const { useState, useRef, useEffect } = React;

function EditableValue({ value, displayValue, onCommit, parseValue, suffix = "", type = "text", min, max, step, width, dark, align = "left", placeholder }) {
  const editDraft = displayValue != null ? String(displayValue) : String(value ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(editDraft);
  const ref = useRef(null);

  useEffect(() => { if (!editing) setDraft(editDraft); }, [value, displayValue, editing]);
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select(); } }, [editing]);

  const commit = () => {
    let v = draft;
    if (parseValue) {
      const parsed = parseValue(draft);
      v = parsed != null ? parsed : value;
    } else if (type === "number") {
      v = parseFloat(draft);
      if (isNaN(v)) v = value;
      if (min != null) v = Math.max(min, v);
      if (max != null) v = Math.min(max, v);
    }
    onCommit(v);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        type={type === "number" ? "number" : "text"}
        value={draft}
        min={min} max={max} step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(editDraft); setEditing(false); }
        }}
        style={{
          width: width || "auto",
          textAlign: align,
          background: dark ? "oklch(0.18 0.01 260)" : "white",
          color: "inherit",
          border: "1.5px solid oklch(0.62 0.16 260)",
          borderRadius: 4,
          padding: "1px 4px",
          font: "inherit",
          outline: "none",
        }}
      />
    );
  }
  return (
    <span
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      style={{ cursor: "text", borderRadius: 4, padding: "1px 4px", margin: "-1px -4px" }}
      title="Click to edit"
    >
      {value === "" || value == null ? <span style={{ opacity: 0.4 }}>{placeholder || "—"}</span> : <>{displayValue ?? value}{suffix}</>}
    </span>
  );
}

window.EditableValue = EditableValue;
})();