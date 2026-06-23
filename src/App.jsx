import { useState, useEffect, useRef, useCallback } from "react";

const SCORES = Array.from({ length: 21 }, (_, i) => +(10 - i * 0.5).toFixed(1));
const STORAGE_KEY = "game-ranker-v2";
const BGG_USERNAME_KEY = "game-ranker-bgg-username";

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

function roundToHalf(n) {
  return Math.round(n * 2) / 2;
}

function parseBGGCollection(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const items = doc.querySelectorAll("item");
  const games = [];
  items.forEach(item => {
    const id = parseInt(item.getAttribute("objectid"));
    const name = item.querySelector("name")?.textContent?.trim();
    const numplays = parseInt(item.querySelector("numplays")?.textContent || "0");
    const ratingEl = item.querySelector("stats > rating");
    const ratingVal = ratingEl?.getAttribute("value");
    const rating = ratingVal && ratingVal !== "N/A" ? parseFloat(ratingVal) : null;
    if (name && id) {
      games.push({ id, name, plays: numplays, rating });
    }
  });
  return games;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        buckets: parsed.buckets || {},
        unranked: parsed.unranked || [],
        playCounts: parsed.playCounts || {},
        bggIds: parsed.bggIds || {},
        needsSort: parsed.needsSort || [],
      };
    }
  } catch {}
  return { buckets: {}, unranked: [], playCounts: {}, bggIds: {}, needsSort: [] };
}

function saveState(buckets, unranked, playCounts, bggIds, needsSort) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ buckets, unranked, playCounts, bggIds, needsSort }));
  } catch {}
}

export default function App() {
  const [buckets, setBuckets] = useState({});
  const [unranked, setUnranked] = useState([]);
  const [playCounts, setPlayCounts] = useState({});
  const [bggIds, setBggIds] = useState({});
  const [needsSort, setNeedsSort] = useState([]);
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
  const [bggUsername, setBggUsername] = useState(() => localStorage.getItem(BGG_USERNAME_KEY) || "");
  const [bggUsernameInput, setBggUsernameInput] = useState("");
  const [showBggSetup, setShowBggSetup] = useState(false);
  const [bggSyncing, setBggSyncing] = useState(false);
  const drag = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  const syncTextRef = useRef(null);
  const bucketRefs = useRef({});
  const addOverlayInputRef = useRef(null);
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(120);

  useEffect(() => {
    const { buckets: b, unranked: u, playCounts: p, bggIds: ids, needsSort: ns } = loadState();
    setBuckets(b);
    setUnranked(u);
    setPlayCounts(p || {});
    setBggIds(ids || {});
    setNeedsSort(ns || []);
  }, []);

  useEffect(() => {
    if (!headerRef.current) return;
    const measure = () => setHeaderHeight(headerRef.current.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const hh = headerRef.current ? headerRef.current.getBoundingClientRect().height : 120;
      const detectAt = hh + (window.innerHeight - hh) * 0.33;
      let found = null;
      for (const key of SCORES) {
        const el = bucketRefs.current[key];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= detectAt && rect.bottom > detectAt) { found = key; break; }
      }
      if (!found) {
        for (const key of SCORES) {
          const el = bucketRefs.current[key];
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          if (rect.top > detectAt && rect.top < window.innerHeight) { found = key; break; }
        }
      }
      setCurrentBucket(found);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const setBucketRef = useCallback((bucket) => (el) => { bucketRefs.current[bucket] = el; }, []);

  const commit = (b, u, p, ids, ns) => {
    const finalIds = ids ?? bggIds;
    const finalNs = ns ?? needsSort;
    setBuckets(b); setUnranked(u); setPlayCounts(p); setBggIds(finalIds); setNeedsSort(finalNs);
    saveState(b, u, p, finalIds, finalNs);
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

  // BGG Sync
  const syncWithBGG = async (username) => {
    setBggSyncing(true);
    setImportStatus("loading");
    setImportMessage("Fetching your collection from BGG...");

    let xml = null;
    const maxRetries = 5;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(`/.netlify/functions/bgg?username=${encodeURIComponent(username)}`);

        if (response.status === 202) {
          setImportMessage(`BGG is preparing your data... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`BGG returned ${response.status}`);
        }

        xml = await response.text();
        break;
      } catch (err) {
        if (attempt === maxRetries - 1) {
          setImportStatus("error");
          setImportMessage(`Sync failed: ${err.message}`);
          setBggSyncing(false);
          return;
        }
      }
    }

    if (!xml) {
      setImportStatus("error");
      setImportMessage("BGG took too long to respond. Try again in a minute.");
      setBggSyncing(false);
      return;
    }

    const bggGames = parseBGGCollection(xml);

    if (bggGames.length === 0) {
      setImportStatus("error");
      setImportMessage("No played games found on BGG.");
      setBggSyncing(false);
      return;
    }

    // Build lookup of existing games (by name, case-insensitive)
    const existingByName = {};
    Object.entries(buckets).forEach(([score, games]) => {
      games.forEach(name => { existingByName[name.toLowerCase()] = name; });
    });
    unranked.forEach(name => { existingByName[name.toLowerCase()] = name; });

    // Build reverse lookup of existing BGG IDs
    const existingByBggId = {};
    Object.entries(bggIds).forEach(([name, id]) => { existingByBggId[id] = name; });

    let newB = { ...buckets };
    let newU = [...unranked];
    let newP = { ...playCounts };
    let newIds = { ...bggIds };
    let newNs = [...needsSort];

    let added = 0;
    let updated = 0;
    let linked = 0;

    bggGames.forEach(({ id, name: bggName, plays, rating }) => {
      // Try to find existing game: first by BGG ID, then by name
      const existingName = existingByBggId[id] || existingByName[bggName.toLowerCase()];

      if (existingName) {
        // Game exists — update play count, link BGG ID if needed
        newP[existingName] = Math.max(plays, newP[existingName] || 0);
        if (!newIds[existingName]) {
          newIds[existingName] = id;
          linked++;
        }
        updated++;
      } else {
        // New game — add to bucket based on rating or unranked
        newIds[bggName] = id;
        newP[bggName] = plays;

        if (rating !== null && !isNaN(rating)) {
          const bucket = roundToHalf(Math.min(10, Math.max(0, rating)));
          newB[bucket] = [...(newB[bucket] || []), bggName];
          newNs.push(bggName);
        } else {
          newU = [...newU, bggName];
        }
        added++;

        // Register in lookup so duplicates within BGG response are caught
        existingByName[bggName.toLowerCase()] = bggName;
        existingByBggId[id] = bggName;
      }
    });

    commit(newB, newU, newP, newIds, newNs);

    // Save username
    localStorage.setItem(BGG_USERNAME_KEY, username);
    setBggUsername(username);

    setImportStatus("success");
    const parts = [];
    if (added > 0) parts.push(`${added} new game${added !== 1 ? "s" : ""} added`);
    if (updated > 0) parts.push(`${updated} play count${updated !== 1 ? "s" : ""} updated`);
    if (linked > 0) parts.push(`${linked} game${linked !== 1 ? "s" : ""} linked to BGG`);
    setImportMessage(parts.join(", ") + ".");
    setBggSyncing(false);
    setTimeout(() => { setImportStatus(null); setImportMessage(""); }, 5000);
  };

  const handleBggSync = () => {
    if (bggUsername) {
      syncWithBGG(bggUsername);
    } else {
      setShowBggSetup(true);
      setBggUsernameInput("");
    }
  };

  const handleBggUsernameSubmit = () => {
    const u = bggUsernameInput.trim();
    if (!u) return;
    setShowBggSetup(false);
    syncWithBGG(u);
  };

  // Export: encode full state as base64
  const handleExport = () => {
    const data = JSON.stringify({ buckets, unranked, playCounts, bggIds, needsSort });
    const encoded = btoa(unescape(encodeURIComponent(data)));
    setSyncImportText(encoded);
    setTimeout(() => syncTextRef.current?.select(), 50);
  };

  // Import: decode base64 and restore state
  const handleSyncImport = () => {
    try {
      const decoded = decodeURIComponent(escape(atob(syncImportText.trim())));
      const { buckets: b, unranked: u, playCounts: p, bggIds: ids, needsSort: ns } = JSON.parse(decoded);
      commit(b || {}, u || [], p || {}, ids || {}, ns || []);
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
    const ns = needsSort.filter(n => !selected.has(n));
    setSelected(new Set());
    setSelectMode(false);
    commit(b, u, playCounts, undefined, ns);
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
    return { b, u, movedName: name };
  };

  const handleGameTap = (bucket, idx) => {
    const name = getList(bucket)[idx];
    if (selectMode) { toggleSelect(name); return; }
    if (held) {
      if (held.bucket === bucket && held.idx === idx) { setHeld(null); return; }
      const { b, u, movedName } = applyMove(held.bucket, held.idx, bucket, idx);
      const ns = needsSort.filter(n => n !== movedName);
      setHeld(null); commit(b, u, playCounts, undefined, ns);
    } else {
      setHeld({ bucket, idx, name });
    }
  };

  const handleSlotTap = (bucket, insertBefore) => {
    if (!held || selectMode) return;
    const { b, u, movedName } = applyMove(held.bucket, held.idx, bucket, insertBefore);
    const ns = needsSort.filter(n => n !== movedName);
    setHeld(null); commit(b, u, playCounts, undefined, ns);
  };

  const deleteGame = (bucket, idx, e) => {
    e.stopPropagation();
    const name = getList(bucket)[idx];
    if (held?.bucket === bucket && held?.idx === idx) setHeld(null);
    let b = { ...buckets }; let u = [...unranked];
    if (bucket === "unranked") { u.splice(idx, 1); } else { b[bucket] = [...(b[bucket] || [])]; b[bucket].splice(idx, 1); }
    const ns = needsSort.filter(n => n !== name);
    commit(b, u, playCounts, undefined, ns);
  };

  const onDragStart = (bucket, idx) => { if (selectMode) return; drag.current = { bucket, idx }; };
  const onDragOver = (e, bucket, insertBefore) => { e.preventDefault(); setDragOver({ bucket, insertBefore }); };
  const onDrop = (e, toBucket, insertBefore) => {
    e.preventDefault();
    if (!drag.current) return;
    const { bucket: fb, idx: fi } = drag.current;
    const { b, u, movedName } = applyMove(fb, fi, toBucket, insertBefore);
    const ns = needsSort.filter(n => n !== movedName);
    drag.current = null; setDragOver(null); commit(b, u, playCounts, undefined, ns);
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
            width: 62, flexShrink: 0, display: "flex", alignItems: "flex-start", justifyContent: "center",
            borderRight: `2px solid ${isEmpty && !held ? "#e8e0d0" : color + "55"}`,
            background: isEmpty && !held ? "#faf8f4" : bg,
            cursor: held && !selectMode ? "pointer" : "default",
            transition: "color 0.15s, background 0.15s",
            userSelect: "none",
          }}
        >
          <div style={{
            position: "sticky", top: headerHeight + 2,
            fontFamily: "'Playfair Display', serif", fontWeight: 700,
            fontSize: isUnrankedBucket ? 18 : 16,
            color: isEmpty && !held ? "#ccc" : color,
            padding: "6px 0",
          }}>
            {label}
          </div>
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
            const isNew = needsSort.includes(name);

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
                    background: isSelected ? "#ffeef0" : beingMoved ? color + "18" : isDragging ? "#f0ebe0" : isNew ? "#fffdf0" : "#fff",
                    border: isSelected ? "1px solid #e08090" : beingMoved ? `1px solid ${color}88` : isNew ? "1px solid #e8d898" : `1px solid ${held && !selectMode ? color + "33" : "#e0d8cc"}`,
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
                  {isNew && !selectMode && (
                    <span style={{
                      fontSize: 8, fontWeight: 700, fontFamily: "'Space Mono', monospace",
                      color: "#b8860b", flexShrink: 0,
                      background: "#fdf6e0", border: "1px solid #e8d898",
                      borderRadius: 3, padding: "1px 4px", letterSpacing: 0.5,
                    }}>NEW</span>
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

      <div ref={headerRef} style={{ padding: "18px 16px 14px", background: "#fff", borderBottom: "2px solid #e8e0d0", position: "sticky", top: 0, zIndex: 50, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
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
            <button onClick={handleBggSync} disabled={bggSyncing} style={{
              background: bggSyncing ? "#e8e0d0" : "#f5f0e8",
              border: "1px solid #d0c8b8",
              borderRadius: 8, color: bggSyncing ? "#bbb" : "#8a7a5a",
              padding: "6px 10px", cursor: bggSyncing ? "default" : "pointer",
              fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5,
            }}>
              BGG
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
          </div>
        </div>

        {/* BGG username setup */}
        {showBggSetup && (
          <div style={{ marginBottom: 10, padding: "12px", background: "#f0f7ee", border: "1px solid #a0d0b0", borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontFamily: "'Space Mono', monospace", color: "#4a7c3f", marginBottom: 8, letterSpacing: 0.5 }}>ENTER YOUR BGG USERNAME</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={bggUsernameInput}
                onChange={(e) => setBggUsernameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleBggUsernameSubmit()}
                placeholder="BGG username…"
                autoFocus
                style={{
                  flex: 1, background: "#fff", border: "1px solid #a0d0b0",
                  borderRadius: 6, color: "#2a2018", padding: "8px 10px",
                  fontSize: 13, fontFamily: "'Playfair Display', serif",
                }}
              />
              <button onClick={handleBggUsernameSubmit} style={{
                background: "#4a7c3f", border: "none", borderRadius: 6,
                color: "#fff", fontWeight: 700, padding: "0 14px",
                cursor: "pointer", fontFamily: "'Space Mono', monospace", fontSize: 11,
              }}>SYNC</button>
              <button onClick={() => setShowBggSetup(false)} style={{
                background: "#f5f0e8", border: "1px solid #d0c8b8", borderRadius: 6,
                color: "#8a7a5a", padding: "0 10px",
                cursor: "pointer", fontFamily: "'Space Mono', monospace", fontSize: 11,
              }}>✕</button>
            </div>
          </div>
        )}

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

        {!selectMode && !showSync && !showBggSetup && (
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
