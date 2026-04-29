import { useState, useEffect, useRef } from "react";

const SCORES = Array.from({ length: 21 }, (_, i) => +(10 - i * 0.5).toFixed(1));
const BGG_ENDPOINT = "/.netlify/functions/bgg";
const STORAGE_KEY = "game-ranker-v1";

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

async function fetchBGGCollection(username, onStatus) {
  const url = `${BGG_ENDPOINT}?username=${encodeURIComponent(username)}`;
  onStatus("Fetching your BGG collection…");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status}). Try again.`);

  const xml = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");

  const errorEl = doc.querySelector("error message");
  if (errorEl) throw new Error(errorEl.textContent);

  const items = Array.from(doc.querySelectorAll("item"));
  if (items.length === 0) {
    throw new Error("No played games found. Make sure your BGG collection is public and you have logged plays.");
  }

  return items.map((item) => item.querySelector("name")?.textContent?.trim()).filter(Boolean);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { buckets: {}, unranked: [] };
}

function saveState(buckets, unranked) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ buckets, unranked }));
  } catch {}
}

export default function App() {
  const [buckets, setBuckets] = useState({});
  const [unranked, setUnranked] = useState([]);
  const [input, setInput] = useState("");
  const [held, setHeld] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [bggUsername, setBggUsername] = useState("");
  const [importStatus, setImportStatus] = useState(null);
  const [importMessage, setImportMessage] = useState("");
  const drag = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  useEffect(() => {
    const { buckets: b, unranked: u } = loadState();
    setBuckets(b);
    setUnranked(u);
  }, []);

  const commit = (b, u) => { setBuckets(b); setUnranked(u); saveState(b, u); };

  const addGame = () => {
    const name = input.trim();
    if (!name) return;
    commit(buckets, [name, ...unranked]);
    setInput("");
  };

  const handleImport = async () => {
    const username = bggUsername.trim();
    if (!username) return;
    setImportStatus("loading");
    try {
      const games = await fetchBGGCollection(username, setImportMessage);
      const existing = new Set([...unranked, ...Object.values(buckets).flat()]);
      const newGames = games.filter((g) => !existing.has(g));
      commit(buckets, [...newGames, ...unranked]);
      setImportStatus("success");
      const skipped = games.length - newGames.length;
      setImportMessage(
        newGames.length > 0
          ? `Added ${newGames.length} game${newGames.length !== 1 ? "s" : ""}.${skipped > 0 ? ` ${skipped} already present, skipped.` : ""}`
          : "All your BGG games are already in your list."
      );
      setTimeout(() => {
        setShowImport(false);
        setImportStatus(null);
        setImportMessage("");
        setBggUsername("");
      }, 3500);
    } catch (err) {
      setImportStatus("error");
      setImportMessage(err.message);
    }
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
      setHeld(null); commit(b, u);
    } else {
      setHeld({ bucket, idx, name: getList(bucket)[idx] });
    }
  };

  const handleSlotTap = (bucket, insertBefore) => {
    if (!held) return;
    const { b, u } = applyMove(held.bucket, held.idx, bucket, insertBefore);
    setHeld(null); commit(b, u);
  };

  const deleteGame = (bucket, idx, e) => {
    e.stopPropagation();
    if (held?.bucket === bucket && held?.idx === idx) setHeld(null);
    let b = { ...buckets }; let u = [...unranked];
    if (bucket === "unranked") { u.splice(idx, 1); } else { b[bucket] = [...(b[bucket] || [])]; b[bucket].splice(idx, 1); }
    commit(b, u);
  };

  const onDragStart = (bucket, idx) => { drag.current = { bucket, idx }; };
  const onDragOver = (e, bucket, insertBefore) => { e.preventDefault(); setDragOver({ bucket, insertBefore }); };
  const onDrop = (e, toBucket, insertBefore) => {
    e.preventDefault();
    if (!drag.current) return;
    const { bucket: fb, idx: fi } = drag.current;
    const { b, u } = applyMove(fb, fi, toBucket, insertBefore);
    drag.current = null; setDragOver(null); commit(b, u);
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
            onClick={() => { setShowImport(!showImport); setImportStatus(null); setImportMessage(""); }}
            style={{
              background: showImport ? "#1a1200" : "transparent",
              border: `1px solid ${showImport ? "#c8880a" : "#2a2a2a"}`,
              borderRadius: 8, color: showImport ? "#c8880a" : "#444",
              padding: "6px 12px", cursor: "pointer",
              fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5,
            }}
          >
            BGG IMPORT
          </button>
        </div>

        {showImport && (
          <div style={{ background: "#121000", border: "1px solid #2a2000", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ color: "#555", fontSize: 11, fontFamily: "'Space Mono', monospace", marginBottom: 8, letterSpacing: 0.5 }}>
              IMPORT PLAYED GAMES FROM BGG
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={bggUsername}
                onChange={(e) => setBggUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && importStatus !== "loading" && handleImport()}
                placeholder="BGG username…"
                disabled={importStatus === "loading"}
                style={{
                  flex: 1, background: "#1a1600", border: "1px solid #2a2200",
                  borderRadius: 8, color: "#e0d0b0", padding: "8px 12px",
                  fontSize: 14, fontFamily: "'Playfair Display', serif",
                  opacity: importStatus === "loading" ? 0.5 : 1,
                }}
              />
              <button
                onClick={handleImport}
                disabled={importStatus === "loading" || !bggUsername.trim()}
                style={{
                  background: importStatus === "loading" ? "#2a1a00" : "#c8880a",
                  border: "none", borderRadius: 8,
                  color: importStatus === "loading" ? "#c8880a" : "#0d0d0d",
                  fontWeight: 700, padding: "0 14px", minWidth: 60,
                  cursor: importStatus === "loading" || !bggUsername.trim() ? "default" : "pointer",
                  fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5,
                  opacity: !bggUsername.trim() ? 0.4 : 1,
                }}
              >
                {importStatus === "loading" ? "…" : "FETCH"}
              </button>
            </div>
            {importMessage && (
              <div style={{
                marginTop: 8, fontSize: 12, fontFamily: "'Space Mono', monospace", lineHeight: 1.6,
                color: importStatus === "error" ? "#b05050" : importStatus === "success" ? "#60d090" : "#888",
              }}>
                {importMessage}
              </div>
            )}
            <div style={{ marginTop: 8, color: "#2a2a2a", fontSize: 10, fontFamily: "'Space Mono', monospace", lineHeight: 1.6 }}>
              Pulls games with logged plays. Expansions excluded. Already-ranked games skipped. BGG collection must be public.
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addGame()}
            placeholder="Or add a game manually…"
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
