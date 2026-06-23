import { useState, useEffect, useRef, useCallback } from "react";

const SCORES = Array.from({ length: 21 }, (_, i) => +(10 - i * 0.5).toFixed(1));
const STORAGE_KEY = "game-ranker-v2";

const scoreColor = (s) => {
  if (s >= 9.5) return "#b8860b";
  if (s >= 8.5) return "#4a7c3f";
  if (s >= 7.5) return "#2a7a5a";
  if (s >= 6.5) return "#2a6080";
  if (s >= 5.5) return "#5a4a8a";
  if (s >= 4.0) return "#8a5a2a";
  if (s >= 2.0) return "#8a2a2a";
  return "#888";
};

const scoreBg = (s) => {
  if (s >= 9.5) return "#fdf6e0";
  if (s >= 8.5) return "#f0f7ee";
  if (s >= 7.5) return "#edf7f3";
  if (s >= 6.5) return "#edf3f7";
  if (s >= 5.5) return "#f2f0f8";
  if (s >= 4.0) return "#f7f2ed";
  if (s >= 2.0) return "#f7edee";
  return "#f5f5f5";
};

// Parses the custom format: Title (year), Plays: N
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  // Skip header row
  const games = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Split on last comma to handle titles with commas
    const lastComma = line.lastIndexOf(",");
    if (lastComma === -1) continue;
    let title = line.slice(0, lastComma).replace(/^"|"$/g, "").trim();
    const playsRaw = line.slice(lastComma + 1).replace(/^"|"$/g, "").trim();
    // Strip year from title e.g. "Wingspan (2019)" -> "Wingspan"
    title = title.replace(/\s*\(\d{4}\)\s*$/, "").trim();
    // Parse "Plays: N"
    const playsMatch = playsRaw.match(/(\d+)/);
    const plays = playsMatch ? parseInt(playsMatch[1]) : 0;
    if (title && plays > 0) games.push({ name: title, plays });
  }
  return games;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { buckets: {}, unranked: [], playCounts: {} };
}

function saveState(buckets, unranked, playCounts) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ buckets, unranked, playCounts }));
  } catch {}
}

export default function App() {
  const [buckets, setBuckets] = useState({});
  const [unranked, setUnranked] = useState([]);
  const [playCounts, setPlayCounts] = useState({});
  const [input, setInput] = useState("");
  const [held, setHeld] = useState(null);
  const [importStatus, setImportStatus] = useState(null);
  const [importMessage, setImportMessage] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [showSync, setShowSync] = useState(false);
  const [syncImportText, setSyncImportText] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [showAddOverlay, setShowAddOverlay] = useState(false);
  const [addOverlayInput, setAddOverlayInput] = useState("");
  const [addOverlayScore, setAddOverlayScore] = useState(null);
  const [currentBucket, setCurrentBucket] = useState(null);
  const drag = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  const fileInputRef = useRef(null);
  const syncTextRef = useRef(null);
  const bucketRefs = useRef({});
  const addOverlayInputRef = useRef(null);

  useEffect(() => {
    const { buckets: b, unranked: u, playCounts: p } = loadState();
    setBuckets(b);
    setUnranked(u);
    setPlayCounts(p || {});
  }, []);

  // Sticky bucket indicator: track which bucket is near the top of the viewport
  useEffect(() => {
    const handleScroll = () => {
      let closest = null;
      let closestDist = Infinity;
      Object.entries(bucketRefs.current).forEach(([key, el]) => {
        if (!el || key === "unranked") return;
        const rect = el.getBoundingClientRect();
        // Find the bucket whose top is closest to (but not far below) the header
        const dist = Math.abs(rect.top - 120);
        if (rect.top < window.innerHeight && rect.bottom > 120 && dist < closestDist) {
          closestDist = dist;
          closest = key;
        }
      });
      setCurrentBucket(closest);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const setBucketRef = useCallback((bucket) => (el) => { bucketRefs.current[bucket] = el; }, []);

  const commit = (b, u, p) => {
    setBuckets(b); setUnranked(u); setPlayCounts(p);
    saveState(b, u, p);
  };

  const addGame = () => {
    const name = input.trim();
    if (!name) return;
    if (unranked.includes(name) || Object.values(buckets).flat().includes(name)) return;
    commit(buckets, [name, ...unranked], playCounts);
    setInput("");
  };

  const addGameWithScore = () => {
    const name = addOverlayInput.trim();
    if (!name) return;
    if (unranked.includes(name) || Object.values(buckets).flat().includes(name)) return;
    if (addOverlayScore !== null) {
      const b = { ...buckets };
      b[addOverlayScore] = [...(b[addOverlayScore] || []), name];
      commit(b, unranked, playCounts);
    } else {
      commit(buckets, [name, ...unranked], playCounts);
    }
    setAddOverlayInput("");
    setAddOverlayScore(null);
    setShowAddOverlay(false);
  };

  const handleCSVImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportStatus("loading");
    setImportMessage("Reading CSV…");
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const games = parseCSV(evt.target.result);
        if (games.length === 0) {
          setImportStatus("error");
          setImportMessage("No played games found. Make sure this is the correct format (Title, Plays: N).");
          return;
        }
        const allRanked = Object.values(buckets).flat();
        const existing = new Set([...unranked, ...allRanked]);
        const newPlayCounts = { ...playCounts };
        games.forEach(({ name, plays }) => { newPlayCounts[name] = plays; });
        const newGames = games.filter(({ name }) => !existing.has(name)).map(g => g.name);
        commit(buckets, [...newGames, ...unranked], newPlayCounts);
        setImportStatus("success");
        const skipped = games.length - newGames.length;
        setImportMessage(`Added ${newGames.length} game${newGames.length !== 1 ? "s" : ""} to unranked.${skipped > 0 ? ` ${skipped} already in your list (play counts updated).` : ""}`);
        setTimeout(() => { setImportStatus(null); setImportMessage(""); }, 4000);
      } catch {
        setImportStatus("error");
        setImportMessage("Failed to parse CSV. Check the file format.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Export: encode full state as base64
  const handleExport = () => {
    const data = JSON.stringify({ buckets, unranked, playCounts });
    const encoded = btoa(unescape(encodeURIComponent(data)));
    setSyncImportText(encoded);
    setTimeout(() => syncTextRef.current?.select(), 50);
  };

  // Import: decode base64 and restore state
  const handleSyncImport = () => {
    try {
      const decoded = decodeURIComponent(escape(atob(syncImportText.trim())));
      const { buckets: b, unranked: u, playCounts: p } = JSON.parse(decoded);
      commit(b || {}, u || [], p || {});
      setSyncMessage("Synced successfully!");
      setTimeout(() => { setSyncMessage(""); setShowSync(false); setSyncImportText(""); }, 2500);
    } catch {
      setSyncMessage("Invalid code. Copy it again from your other device.");
    }
  };

  const toggleSelectMode = () => {
    setSelectMode(!selectMode);
    setSelected(new Set());
    setHeld(null);
  };

  const toggleSelect = (name) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name); else next.add(name);
    setSelected(next);
  };

  const deleteSelected = () => {
    let b = { ...buckets };
    let u = unranked.filter(n => !selected.has(n));
    Object.keys(b).forEach(k => { b[k] = b[k].filter(n => !selected.has(n)); });
    setSelected(new Set());
    setSelectMode(false);
    commit(b, u, playCounts);
  };

  const getList = (bucket) => bucket === "unranked" ? unranked : buckets[bucket] || [];

  const applyMove = (fromBucket, fromIdx, toBucket, insertBefore) => {
    let b = { ...buckets }; let u = [...unranked];
    const fromList = [...getList(fromBucket)];
    const [name] = fromList.splice(fromIdx, 1);
    if (fromBucket === "unranked") u = fromList; else b[fromBucket] = fromList;
    const targetList = fromBucket === toBucket ? fromList : toBucket === "unranked" ? [...u] : [...(b[toBucket] || [])];
    let pos = insertBefore === null ? targetList.length : insertBefore;
    if (fromBucket === toBucket && fromIdx < (insertBefore ?? targetList.length + 1)) pos = Math.max(0, pos - 1);
    pos = Math.max(0, Math.min(pos, targetList.length));
    targetList.splice(pos, 0, name);
    if (toBucket === "unranked") u = targetList; else b[toBucket] = targetList;
    return { b, u };
  };

  const handleGameTap = (bucket, idx) => {
    const name = getList(bucket)[idx];
    if (selectMode) { toggleSelect(name); return; }
    if (held) {
      if (held.bucket === bucket && held.idx === idx) { setHeld(null); return; }
      const { b, u } = applyMove(held.bucket, held.idx, bucket, idx);
      setHeld(null); commit(b, u, playCounts);
    } else {
      setHeld({ bucket, idx, name });
    }
  };

  const handleSlotTap = (bucket, insertBefore) => {
    if (!held || selectMode) return;
    const { b, u } = applyMove(held.bucket, held.idx, bucket, insertBefore);
    setHeld(null); commit(b, u, playCounts);
  };

  const deleteGame = (bucket, idx, e) => {
    e.stopPropagation();
    if (held?.bucket === bucket && held?.idx === idx) setHeld(null);
    let b = { ...buckets }; let u = [...unranked];
    if (bucket === "unranked") { u.splice(idx, 1); } else { b[bucket] = [...(b[bucket] || [])]; b[bucket].splice(idx, 1); }
    commit(b, u, playCounts);
  };

  const onDragStart = (bucket, idx) => { if (selectMode) return; drag.current = { bucket, idx }; };
  const onDragOver = (e, bucket, insertBefore) => { e.preventDefault(); setDragOver({ bucket, insertBefore }); };
  const onDrop = (e, toBucket, insertBefore) => {
    e.preventDefault();
    if (!drag.current) return;
    const { bucket: fb, idx: fi } = drag.current;
    const { b, u } = applyMove(fb, fi, toBucket, insertBefore);
    drag.current = null; setDragOver(null); commit(b, u, playCounts);
  };
  const onDragEnd = () => { drag.current = null; setDragOver(null); };

  const ranks = {};
  let r = 1;
  SCORES.forEach((s) => (buckets[s] || []).forEach((_, i) => { ranks[`${s}-${i}`] = r++; }));
  const totalRanked = r - 1;

  const renderBucket = (bucket, label, color, isUnrankedBucket = false) => {
    const games = getList(bucket);
    const isEmpty = games.length === 0;
    const bg = isUnrankedBucket ? "#f9f6f0" : scoreBg(bucket);

    return (
      <div key={bucket} ref={setBucketRef(bucket)} data-bucket={bucket} style={{ display: "flex", alignItems: "stretch", minHeight: isEmpty && !held ? 24 : undefined, borderBottom: "1px solid #e8e0d0" }}>
        <div
          onClick={() => held && !selectMode && handleSlotTap(bucket, null)}
          onDragOver={(e) => onDragOver(e, bucket, null)}
          onDrop={(e) => onDrop(e, bucket, null)}
          style={{
            width: 62, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Playfair Display', serif", fontWeight: 700,
            fontSize: isUnrankedBucket ? 18 : 16,
            color: isEmpty && !held ? "#ccc" : color,
            borderRight: `2px solid ${isEmpty && !held ? "#e8e0d0" : color + "55"}`,
            background: isEmpty && !held ? "#faf8f4" : bg,
            cursor: held && !selectMode ? "pointer" : "default",
            transition: "color 0.15s, background 0.15s",
            userSelect: "none",
          }}
        >
          {label}
        </div>

        <div
          style={{ flex: 1, padding: isEmpty ? "0" : "2px 4px", background: isEmpty ? "#faf8f4" : bg }}
          onDragOver={(e) => { if (isEmpty) onDragOver(e, bucket, null); }}
          onDrop={(e) => { if (isEmpty) onDrop(e, bucket, null); }}
          onClick={(e) => { if (held && !selectMode && e.target === e.currentTarget) setHeld(null); }}
        >
          {held && !selectMode && <InsertSlot onClick={() => handleSlotTap(bucket, 0)} color={color} />}
          {dragOver?.bucket === bucket && dragOver.insertBefore === 0 && <DropLine color={color} />}

          {games.map((name, i) => {
            const beingMoved = held?.bucket === bucket && held?.idx === i;
            const rank = !isUnrankedBucket ? ranks[`${bucket}-${i}`] : null;
            const isDragging = drag.current?.bucket === bucket && drag.current?.idx === i;
            const plays = playCounts[name];
            const isSelected = selected.has(name);

            return (
              <div key={`${name}-${i}`}>
                <div
                  draggable={!selectMode}
                  onDragStart={() => onDragStart(bucket, i)} onDragEnd={onDragEnd}
                  onDragOver={(e) => { e.stopPropagation(); onDragOver(e, bucket, i); }}
                  onDrop={(e) => { e.stopPropagation(); onDrop(e, bucket, i); }}
                  onClick={() => handleGameTap(bucket, i)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "5px 8px 5px 10px", margin: "2px 3px",
                    background: isSelected ? "#ffeef0" : beingMoved ? color + "18" : isDragging ? "#f0ebe0" : "#fff",
                    border: isSelected ? "1px solid #e08090" : beingMoved ? `1px solid ${color}88` : `1px solid ${held && !selectMode ? color + "33" : "#e0d8cc"}`,
                    borderRadius: 6,
                    cursor: selectMode ? "pointer" : beingMoved ? "grabbing" : held ? "pointer" : "grab",
                    opacity: isDragging ? 0.4 : 1,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                    transition: "border-color 0.1s, background 0.1s",
                    userSelect: "none",
                  }}
                >
                  {selectMode && (
                    <div style={{
                      width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                      border: isSelected ? "2px solid #c0392b" : "2px solid #ccc",
                      background: isSelected ? "#c0392b" : "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {isSelected && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span>}
                    </div>
                  )}
                  {rank != null && !selectMode && (
                    <span style={{ color: color, fontSize: 13, fontWeight: 700, fontFamily: "'Space Mono', monospace", minWidth: 32, flexShrink: 0, textAlign: "right" }}>
                      #{rank}
                    </span>
                  )}
                  <span style={{ flex: 1, color: isSelected ? "#8a2a2a" : beingMoved ? color : "#2a2018", fontSize: 14, fontFamily: "'Playfair Display', serif", fontWeight: 400, letterSpacing: 0.2 }}>
                    {name}
                  </span>
                  {plays > 0 && (
                    <span style={{
                      fontSize: 11, fontWeight: 700, fontFamily: "'Space Mono', monospace",
                      color: "#5a4a3a", flexShrink: 0,
                      background: "#f0ebe0", border: "1px solid #d8d0c0",
                      borderRadius: 10, padding: "2px 7px",
                    }}>
                      {plays}×
                    </span>
                  )}
                  {!selectMode && (
                    <button onClick={(e) => deleteGame(bucket, i, e)}
                      style={{ background: "none", border: "none", color: "#ddd", cursor: "pointer", fontSize: 16, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#c0392b")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#ddd")}
                    >×</button>
                  )}
                </div>
                {held && !selectMode && !(held.bucket === bucket && held.idx === i) && (
                  <InsertSlot onClick={() => handleSlotTap(bucket, i + 1)} color={color} />
                )}
                {dragOver?.bucket === bucket && dragOver.insertBefore === i + 1 && <DropLine color={color} />}
              </div>
            );
          })}

          {isEmpty && held && !selectMode && (
            <div onClick={() => handleSlotTap(bucket, null)}
              style={{ color: color + "88", fontSize: 11, fontFamily: "'Space Mono', monospace", padding: "7px 12px", cursor: "pointer", letterSpacing: 1 }}>
              drop here
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ background: "#f5f0e8", minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        button:focus { outline: none; }
        input:focus { outline: none; }
        textarea:focus { outline: none; }
        input::placeholder { color: #bbb; }
        textarea::placeholder { color: #bbb; }
      `}</style>

      <div style={{ padding: "18px 16px 14px", background: "#fff", borderBottom: "2px solid #e8e0d0", position: "sticky", top: 0, zIndex: 50, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontFamily: "'Playfair Display', serif", color: "#2a2018", fontSize: 22, fontWeight: 700, letterSpacing: 0.5 }}>
            Game Ranker
            {totalRanked > 0 && (
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#bbb", marginLeft: 12, fontWeight: 400 }}>
                {totalRanked} ranked
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={toggleSelectMode} style={{
              background: selectMode ? "#ffeef0" : "#f5f0e8",
              border: `1px solid ${selectMode ? "#e08090" : "#d0c8b8"}`,
              borderRadius: 8, color: selectMode ? "#c0392b" : "#8a7a5a",
              padding: "6px 10px", cursor: "pointer",
              fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5,
            }}>
              {selectMode ? "CANCEL" : "SELECT"}
            </button>
            <button onClick={() => fileInputRef.current?.click()} style={{
              background: "#f5f0e8", border: "1px solid #d0c8b8",
              borderRadius: 8, color: "#8a7a5a", padding: "6px 10px",
              cursor: "pointer", fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5,
            }}>
              CSV
            </button>
            <button onClick={() => { setShowSync(!showSync); setSyncMessage(""); setSyncImportText(""); }} style={{
              background: showSync ? "#edf3f7" : "#f5f0e8",
              border: `1px solid ${showSync ? "#a0b8d0" : "#d0c8b8"}`,
              borderRadius: 8, color: showSync ? "#2a6080" : "#8a7a5a",
              padding: "6px 10px", cursor: "pointer",
              fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5,
            }}>
              SYNC
            </button>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCSVImport} style={{ display: "none" }} />
          </div>
        </div>

        {importMessage && (
          <div style={{
            marginBottom: 10, padding: "8px 12px",
            background: importStatus === "error" ? "#fdf0f0" : importStatus === "success" ? "#f0fdf4" : "#fdfaf0",
            border: `1px solid ${importStatus === "error" ? "#e0a0a0" : importStatus === "success" ? "#a0d0b0" : "#d0c080"}`,
            borderRadius: 8, fontSize: 12, fontFamily: "'Space Mono', monospace", lineHeight: 1.6,
            color: importStatus === "error" ? "#8a2a2a" : importStatus === "success" ? "#2a6a3a" : "#6a5a2a",
          }}>
            {importMessage}
          </div>
        )}

        {/* Sync panel */}
        {showSync && (
          <div style={{ marginBottom: 10, padding: "12px", background: "#edf3f7", border: "1px solid #a0b8d0", borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontFamily: "'Space Mono', monospace", color: "#2a6080", marginBottom: 8, letterSpacing: 0.5 }}>SYNC ACROSS DEVICES</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <button onClick={handleExport} style={{
                flex: 1, padding: "8px", background: "#2a6080", border: "none",
                borderRadius: 6, color: "#fff", cursor: "pointer",
                fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5,
              }}>EXPORT CODE</button>
              <button onClick={handleSyncImport} disabled={!syncImportText.trim()} style={{
                flex: 1, padding: "8px", background: syncImportText.trim() ? "#4a7c3f" : "#ccc",
                border: "none", borderRadius: 6, color: "#fff",
                cursor: syncImportText.trim() ? "pointer" : "default",
                fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5,
              }}>IMPORT CODE</button>
            </div>
            <textarea
              ref={syncTextRef}
              value={syncImportText}
              onChange={(e) => setSyncImportText(e.target.value)}
              placeholder="Export generates a code here. To sync another device, paste that code here and hit Import."
              style={{
                width: "100%", height: 72, background: "#fff", border: "1px solid #a0b8d0",
                borderRadius: 6, padding: "8px", fontSize: 11,
                fontFamily: "'Space Mono', monospace", color: "#2a2018",
                resize: "none", lineHeight: 1.4,
              }}
            />
            {syncMessage && (
              <div style={{ marginTop: 6, fontSize: 11, fontFamily: "'Space Mono', monospace", color: syncMessage.includes("success") ? "#2a6a3a" : "#8a2a2a" }}>
                {syncMessage}
              </div>
            )}
          </div>
        )}

        {!selectMode && !showSync && (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addGame()}
              placeholder="Add a game manually…"
              style={{
                flex: 1, background: "#faf8f4", border: "1px solid #d8d0c0",
                borderRadius: 8, color: "#2a2018", padding: "9px 12px",
                fontSize: 14, fontFamily: "'Playfair Display', serif",
              }}
            />
            <button onClick={addGame} style={{
              background: "#8a7a5a", border: "none", borderRadius: 8,
              color: "#fff", fontWeight: 700, padding: "0 16px",
              cursor: "pointer", fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5,
            }}>ADD</button>
          </div>
        )}

        {selectMode && selected.size > 0 && (
          <button onClick={deleteSelected} style={{
            width: "100%", padding: "10px", background: "#c0392b", border: "none",
            borderRadius: 8, color: "#fff", fontWeight: 700,
            cursor: "pointer", fontFamily: "'Space Mono', monospace", fontSize: 12, letterSpacing: 0.5,
          }}>
            DELETE {selected.size} GAME{selected.size !== 1 ? "S" : ""}
          </button>
        )}

        {selectMode && selected.size === 0 && (
          <div style={{ color: "#aaa", fontSize: 12, fontFamily: "'Space Mono', monospace", padding: "8px 0", letterSpacing: 0.5 }}>
            Tap games to select them
          </div>
        )}
      </div>

      {held && !selectMode && (
        <div style={{
          position: "sticky", top: 85, zIndex: 40,
          background: "#fffbf0", borderBottom: "2px solid #e8d898",
          padding: "10px 16px", display: "flex", alignItems: "center", gap: 10,
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        }}>
          <span style={{ color: "#8a7a2a", fontSize: 11, fontWeight: 700, fontFamily: "'Space Mono', monospace", flexShrink: 0, background: "#f5edc8", padding: "3px 8px", borderRadius: 4 }}>MOVING</span>
          <span style={{ color: "#2a2018", fontSize: 14, fontFamily: "'Playfair Display', serif", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {held.name}
          </span>
          <button onClick={() => setHeld(null)} style={{
            background: "#c0392b", border: "none",
            color: "#fff", borderRadius: 6, padding: "7px 16px",
            cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Space Mono', monospace",
            letterSpacing: 0.5,
          }}>✕ CANCEL</button>
        </div>
      )}

      <div style={{ paddingBottom: 60 }} onClick={(e) => {
        if (held && !selectMode && e.target === e.currentTarget) setHeld(null);
      }}>
        {(unranked.length > 0 || (held && held.bucket !== "unranked")) && (
          <div>{renderBucket("unranked", "?", "#888", true)}</div>
        )}
        {SCORES.map((score) => renderBucket(score, score.toFixed(1), scoreColor(score)))}
      </div>

      {/* Sticky bucket indicator */}
      {currentBucket && currentBucket !== "unranked" && !showAddOverlay && (
        <div style={{
          position: "fixed", top: 90, right: 16, zIndex: 45,
          background: scoreColor(parseFloat(currentBucket)),
          color: "#fff", fontFamily: "'Playfair Display', serif",
          fontWeight: 700, fontSize: 16, padding: "6px 12px",
          borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          pointerEvents: "none", opacity: 0.9,
        }}>
          {parseFloat(currentBucket).toFixed(1)}
        </div>
      )}

      {/* Floating add button */}
      {!showAddOverlay && !selectMode && (
        <button
          onClick={() => { setShowAddOverlay(true); setTimeout(() => addOverlayInputRef.current?.focus(), 100); }}
          style={{
            position: "fixed", bottom: 24, right: 20, zIndex: 60,
            width: 56, height: 56, borderRadius: "50%",
            background: "#8a7a5a", border: "none", color: "#fff",
            fontSize: 28, fontWeight: 300, cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            lineHeight: 1,
          }}
        >+</button>
      )}

      {/* Add game overlay */}
      {showAddOverlay && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) { setShowAddOverlay(false); setAddOverlayInput(""); setAddOverlayScore(null); } }}
          style={{
            position: "fixed", inset: 0, zIndex: 70,
            background: "rgba(0,0,0,0.3)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
            padding: "0 12px 24px",
          }}
        >
          <div style={{
            background: "#fff", borderRadius: 16, padding: "20px 16px 16px",
            width: "100%", maxWidth: 420,
            boxShadow: "0 -4px 20px rgba(0,0,0,0.12)",
          }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 700, color: "#2a2018", marginBottom: 14 }}>
              Add Game
            </div>
            <input
              ref={addOverlayInputRef}
              value={addOverlayInput}
              onChange={(e) => setAddOverlayInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addGameWithScore()}
              placeholder="Game title…"
              style={{
                width: "100%", background: "#faf8f4", border: "1px solid #d8d0c0",
                borderRadius: 8, color: "#2a2018", padding: "10px 12px",
                fontSize: 15, fontFamily: "'Playfair Display', serif", marginBottom: 12,
              }}
            />
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#aaa", letterSpacing: 0.5, marginBottom: 8 }}>
              SCORE (OPTIONAL)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 16 }}>
              <button
                onClick={() => setAddOverlayScore(null)}
                style={{
                  padding: "5px 10px", borderRadius: 6, fontSize: 12,
                  fontFamily: "'Space Mono', monospace", cursor: "pointer",
                  border: addOverlayScore === null ? "2px solid #888" : "1px solid #d8d0c0",
                  background: addOverlayScore === null ? "#f0ebe0" : "#faf8f4",
                  color: addOverlayScore === null ? "#2a2018" : "#aaa",
                  fontWeight: addOverlayScore === null ? 700 : 400,
                }}
              >?</button>
              {SCORES.map((s) => (
                <button
                  key={s}
                  onClick={() => setAddOverlayScore(s)}
                  style={{
                    padding: "5px 8px", borderRadius: 6, fontSize: 11,
                    fontFamily: "'Space Mono', monospace", cursor: "pointer",
                    border: addOverlayScore === s ? `2px solid ${scoreColor(s)}` : "1px solid #d8d0c0",
                    background: addOverlayScore === s ? scoreBg(s) : "#faf8f4",
                    color: addOverlayScore === s ? scoreColor(s) : "#aaa",
                    fontWeight: addOverlayScore === s ? 700 : 400,
                  }}
                >{s.toFixed(1)}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => { setShowAddOverlay(false); setAddOverlayInput(""); setAddOverlayScore(null); }}
                style={{
                  flex: 1, padding: "10px", background: "#f5f0e8", border: "1px solid #d0c8b8",
                  borderRadius: 8, color: "#8a7a5a", fontWeight: 700,
                  cursor: "pointer", fontFamily: "'Space Mono', monospace", fontSize: 12,
                }}
              >CANCEL</button>
              <button
                onClick={addGameWithScore}
                style={{
                  flex: 1, padding: "10px", background: "#8a7a5a", border: "none",
                  borderRadius: 8, color: "#fff", fontWeight: 700,
                  cursor: "pointer", fontFamily: "'Space Mono', monospace", fontSize: 12,
                }}
              >ADD</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InsertSlot({ onClick, color }) {
  const [hover, setHover] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ height: hover ? 16 : 8, margin: "0 4px", display: "flex", alignItems: "center", cursor: "pointer", transition: "height 0.1s", overflow: "hidden" }}>
      <div style={{ height: 2, flex: 1, background: hover ? color : color + "33", borderRadius: 2, transition: "background 0.1s" }} />
    </div>
  );
}

function DropLine({ color }) {
  return <div style={{ height: 2, margin: "1px 8px", background: color, borderRadius: 2 }} />;
}
