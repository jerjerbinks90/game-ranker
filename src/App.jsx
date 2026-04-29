import { useState, useEffect, useRef } from "react";

const SCORES = Array.from({ length: 21 }, (_, i) => +(10 - i * 0.5).toFixed(1));
const STORAGE_KEY = "game-ranker-v2";

const scoreColor = (s) => {
  if (s >= 9.5) return "#f0c040";
  if (s >= 8.5) return "#c8e060";
  if (s >= 7.5) return "#60d090";
  if (s >= 6.5) return "#50b8d0";
  if (s >= 5.5) return "#8890e0";
  if (s >= 4.0) return "#c07840";
  if (s >= 2.0) return "#b05050";
  return "#666";
};

function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim().toLowerCase());
  const nameIdx = headers.findIndex(h => h === "objectname" || h === "game name" || h === "name");
  const playsIdx = headers.findIndex(h => h === "numplays" || h === "plays" || h === "number of plays");

  if (nameIdx === -1) return [];

  const games = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
    const name = cols[nameIdx]?.replace(/^"|"$/g, "").trim();
    const plays = playsIdx !== -1 ? parseInt(cols[playsIdx]?.replace(/^"|"$/g, "").trim()) || 0 : 0;
    if (name) games.push({ name, plays });
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
  const drag = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const { buckets: b, unranked: u, playCounts: p } = loadState();
    setBuckets(b);
    setUnranked(u);
    setPlayCounts(p || {});
  }, []);

  const commit = (b, u, p) => {
    setBuckets(b);
    setUnranked(u);
    setPlayCounts(p);
    saveState(b, u, p);
  };

  const addGame = () => {
    const name = input.trim();
    if (!name) return;
    if (unranked.includes(name) || Object.values(buckets).flat().includes(name)) return;
    commit(buckets, [name, ...unranked], playCounts);
    setInput("");
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
          setImportMessage("Couldn't read the CSV. Make sure it's a BGG collection export.");
          return;
        }

        const allRanked = Object.values(buckets).flat();
        const existing = new Set([...unranked, ...allRanked]);

        // Update play counts for all games in CSV
        const newPlayCounts = { ...playCounts };
        games.forEach(({ name, plays }) => {
          if (plays > 0) newPlayCounts[name] = plays;
        });

        // Only add games not already in the list
        const newGames = games.filter(({ name }) => !existing.has(name)).map(g => g.name);
        const newUnranked = [...newGames, ...unranked];

        commit(buckets, newUnranked, newPlayCounts);
        setImportStatus("success");
        const skipped = games.length - newGames.length;
        setImportMessage(
          `Added ${newGames.length} game${newGames.length !== 1 ? "s" : ""} to unranked.${skipped > 0 ? ` ${skipped} already in your list (play counts updated).` : ""}`
        );
        setTimeout(() => { setImportStatus(null); setImportMessage(""); }, 4000);
      } catch {
        setImportStatus("error");
        setImportMessage("Failed to parse CSV. Try re-exporting from BGG.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const getList = (bucket) => bucket === "unranked" ? unranked : buckets[bucket] || [];

  const applyMove = (fromBucket, fromIdx, toBucket, insertBefore) => {
    let b = { ...buckets };
    let u = [...unranked];
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
    if (held) {
      if (held.bucket === bucket && held.idx === idx) { setHeld(null); return; }
      const { b, u } = applyMove(held.bucket, held.idx, bucket, idx);
      setHeld(null); commit(b, u, playCounts);
    } else {
      setHeld({ bucket, idx, name: getList(bucket)[idx] });
    }
  };

  const handleSlotTap = (bucket, insertBefore) => {
    if (!held) return;
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

  const onDragStart = (bucket, idx) => { drag.current = { bucket, idx }; };
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

    return (
      <div key={bucket} style={{ display: "flex", alignItems: "stretch", minHeight: isEmpty && !held ? 22 : undefined }}>
        <div
          onClick={() => held && handleSlotTap(bucket, null)}
          onDragOver={(e) => onDragOver(e, bucket, null)}
          onDrop={(e) => onDrop(e, bucket, null)}
          style={{
            width: 58, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Playfair Display', serif", fontWeight: 600,
            fontSize: isUnrankedBucket ? 16 : 17,
            color: isEmpty && !held ? "#2a2a2a" : color,
            borderRight: `2px solid ${isEmpty && !held ? "#1e1e1e" : color + "44"}`,
            cursor: held ? "pointer" : "default",
            background: held && isEmpty ? color + "10" : dragOver?.bucket === bucket && dragOver?.insertBefore === null && isEmpty ? color + "18" : "transparent",
            transition: "color 0.15s, background 0.15s", userSelect: "none",
          }}
        >
          {label}
        </div>

        <div style={{ flex: 1, padding: isEmpty ? "0" : "2px 4px" }}
          onDragOver={(e) => { if (isEmpty) onDragOver(e, bucket, null); }}
          onDrop={(e) => { if (isEmpty) onDrop(e, bucket, null); }}
        >
          {held && <InsertSlot onClick={() => handleSlotTap(bucket, 0)} color={color} />}
          {dragOver?.bucket === bucket && dragOver.insertBefore === 0 && <DropLine color={color} />}

          {games.map((name, i) => {
            const beingMoved = held?.bucket === bucket && held?.idx === i;
            const rank = !isUnrankedBucket ? ranks[`${bucket}-${i}`] : null;
            const isDragging = drag.current?.bucket === bucket && drag.current?.idx === i;
            const plays = playCounts[name];

            return (
              <div key={`${name}-${i}`}>
                <div
                  draggable onDragStart={() => onDragStart(bucket, i)} onDragEnd={onDragEnd}
                  onDragOver={(e) => { e.stopPropagation(); onDragOver(e, bucket, i); }}
                  onDrop={(e) => { e.stopPropagation(); onDrop(e, bucket, i); }}
                  onClick={() => handleGameTap(bucket, i)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "5px 6px 5px 10px", margin: "1px 2px",
                    background: beingMoved ? "#1c1400" : isDragging ? "#1a1a1a" : "#161616",
                    border: beingMoved ? `1px solid ${color}` : `1px solid ${held ? color + "22" : "#1e1e1e"}`,
                    borderRadius: 6,
                    cursor: beingMoved ? "grabbing" : held ? "pointer" : "grab",
                    opacity: beingMoved || isDragging ? 0.5 : 1,
                    transition: "border-color 0.1s, background 0.1s", userSelect: "none",
                  }}
                >
                  {rank != null && (
                    <span style={{ color: "#2e2e2e", fontSize: 10, fontFamily: "monospace", width: 22, flexShrink: 0, textAlign: "right" }}>
                      #{rank}
                    </span>
                  )}
                  <span style={{ flex: 1, color: beingMoved ? color : "#d8cbb0", fontSize: 14, fontFamily: "'Playfair Display', serif", fontWeight: 400, letterSpacing: 0.2 }}>
                    {name}
                  </span>
                  {plays > 0 && (
                    <span style={{
                      fontSize: 10, fontFamily: "'Space Mono', monospace",
                      color: beingMoved ? color + "99" : "#333",
                      flexShrink: 0, letterSpacing: 0.3,
                    }}>
                      {plays}×
                    </span>
                  )}
                  <button onClick={(e) => deleteGame(bucket, i, e)}
                    style={{ background: "none", border: "none", color: "#282828", cursor: "pointer", fontSize: 15, padding: "0 3px", lineHeight: 1, flexShrink: 0 }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#8a3030")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#282828")}
                  >×</button>
                </div>
                {held && !(held.bucket === bucket && held.idx === i) && (
                  <InsertSlot onClick={() => handleSlotTap(bucket, i + 1)} color={color} />
                )}
                {dragOver?.bucket === bucket && dragOver.insertBefore === i + 1 && <DropLine color={color} />}
              </div>
            );
          })}

          {isEmpty && held && (
            <div onClick={() => handleSlotTap(bucket, null)}
              style={{ color: color + "55", fontSize: 11, fontFamily: "monospace", padding: "7px 12px", cursor: "pointer", letterSpacing: 1 }}>
              tap to place here
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ background: "#0d0d0d", minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        button:focus { outline: none; }
        input:focus { outline: none; }
        input::placeholder { color: #333; }
      `}</style>

      <div style={{ padding: "20px 16px 14px", background: "#0f0f0f", borderBottom: "1px solid #1c1c1c", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontFamily: "'Playfair Display', serif", color: "#c8880a", fontSize: 20, letterSpacing: 1 }}>
            Game Ranker
            {totalRanked > 0 && (
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#333", marginLeft: 12 }}>
                {totalRanked} ranked
              </span>
            )}
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              background: "transparent", border: "1px solid #2a2a2a",
              borderRadius: 8, color: "#444", padding: "6px 12px", cursor: "pointer",
              fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5,
            }}
          >
            BGG CSV
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCSVImport} style={{ display: "none" }} />
        </div>

        {importMessage && (
          <div style={{
            marginBottom: 10, padding: "8px 12px",
            background: importStatus === "error" ? "#1a0000" : importStatus === "success" ? "#001a08" : "#1a1200",
            border: `1px solid ${importStatus === "error" ? "#b05050" : importStatus === "success" ? "#60d090" : "#c8880a"}33`,
            borderRadius: 8, fontSize: 12, fontFamily: "'Space Mono', monospace", lineHeight: 1.6,
            color: importStatus === "error" ? "#b05050" : importStatus === "success" ? "#60d090" : "#888",
          }}>
            {importMessage}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addGame()}
            placeholder="Add a game manually…"
            style={{
              flex: 1, background: "#161616", border: "1px solid #222",
              borderRadius: 8, color: "#e0d0b0", padding: "9px 12px",
              fontSize: 14, fontFamily: "'Playfair Display', serif",
            }}
          />
          <button onClick={addGame} style={{
            background: "#c8880a", border: "none", borderRadius: 8,
            color: "#0d0d0d", fontWeight: 700, padding: "0 16px",
            cursor: "pointer", fontFamily: "'Space Mono', monospace", fontSize: 12, letterSpacing: 0.5,
          }}>ADD</button>
        </div>
      </div>

      {held && (
        <div style={{
          position: "sticky", top: 77, zIndex: 40,
          background: "#140f00", borderBottom: "1px solid #c8880a33",
          padding: "8px 16px", display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ color: "#c8880a", fontSize: 10, fontFamily: "'Space Mono', monospace", flexShrink: 0 }}>MOVING</span>
          <span style={{ color: "#e8d090", fontSize: 14, fontFamily: "'Playfair Display', serif", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {held.name}
          </span>
          <button onClick={() => setHeld(null)} style={{
            background: "#1e1600", border: "1px solid #c8880a44",
            color: "#c8880a", borderRadius: 6, padding: "3px 10px",
            cursor: "pointer", fontSize: 11, fontFamily: "'Space Mono', monospace",
          }}>CANCEL</button>
        </div>
      )}

      <div style={{ paddingBottom: 60 }}>
        {(unranked.length > 0 || (held && held.bucket !== "unranked")) && (
          <div style={{ borderBottom: "1px solid #1a1a1a", marginBottom: 4, padding: "6px 0 2px" }}>
            {renderBucket("unranked", "?", "#555", true)}
          </div>
        )}
        {SCORES.map((score) => renderBucket(score, score.toFixed(1), scoreColor(score)))}
      </div>
    </div>
  );
}

function InsertSlot({ onClick, color }) {
  const [hover, setHover] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ height: hover ? 18 : 10, margin: "0 4px", display: "flex", alignItems: "center", cursor: "pointer", transition: "height 0.1s", overflow: "hidden" }}>
      <div style={{ height: 2, flex: 1, background: hover ? color : color + "33", borderRadius: 2, transition: "background 0.1s" }} />
    </div>
  );
}

function DropLine({ color }) {
  return <div style={{ height: 2, margin: "1px 8px", background: color, borderRadius: 2 }} />;
}
