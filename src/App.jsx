import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";

const SCORES = Array.from({ length: 21 }, (_, i) => +(10 - i * 0.5).toFixed(1));
const STORAGE_KEY = "game-ranker-v2";
const BGG_USERNAME_KEY = "game-ranker-bgg-username";

const supabase = createClient(
  "https://nkjbvuroovltdvomhzbf.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ramJ2dXJvb3ZsdGR2b21oemJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NzgwNTEsImV4cCI6MjEwMjA1NDA1MX0.ygnWv2LbWZNoYS3B3o5aqkd6SUD-lJQPr1TFkOfbPVA"
);

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

function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/\s*[:–—]\s.*$/, '')
    .replace(/\s*\(.*?\)/g, '')
    .replace(/\b(deluxe|collector'?s?|big\s*box|revised|new)\s*(edition)?\b/g, '')
    .replace(/\b(second|third|fourth|2nd|3rd|4th|5th)\s*(edition)?\b/g, '')
    .replace(/\bedition\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fuzzyFindMatch(bggName, existingNames) {
  const bggLower = bggName.toLowerCase();
  const bggNorm = normalizeName(bggName);
  const bggWords = new Set(bggNorm.split(/\s+/).filter(w => w.length > 0));

  if (existingNames[bggLower]) return existingNames[bggLower];

  let bestMatch = null;
  let bestScore = 0;

  for (const [key, originalName] of Object.entries(existingNames)) {
    const existNorm = normalizeName(key);
    if (!existNorm) continue;

    if (existNorm === bggNorm) return originalName;

    const existWords = new Set(existNorm.split(/\s+/).filter(w => w.length > 0));

    const [smaller, larger] = existWords.size <= bggWords.size ? [existWords, bggWords] : [bggWords, existWords];
    const allContained = [...smaller].every(w => larger.has(w));
    if (allContained && smaller.size >= 1) {
      const score = smaller.size / larger.size;
      if (score > bestScore) { bestScore = score; bestMatch = originalName; }
    }

    if (existNorm.length >= 4 && bggNorm.length >= 4) {
      if (bggNorm.includes(existNorm) || existNorm.includes(bggNorm)) {
        const score = Math.min(existNorm.length, bggNorm.length) / Math.max(existNorm.length, bggNorm.length);
        if (score > bestScore) { bestScore = score; bestMatch = originalName; }
      }
    }
  }

  if (bestMatch && bestScore > 0.2) return bestMatch;
  return null;
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
      const collid = item.getAttribute("collid");
      games.push({ id, name, plays: numplays, rating, collid });
    }
  });
  return games;
}

const EMPTY_STATE = { buckets: {}, unranked: [], playCounts: {}, bggIds: {}, needsSort: [], collIds: {} };

function loadLocalState() {
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
        collIds: parsed.collIds || {},
      };
    }
  } catch {}
  return null;
}

function saveLocalState(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

// ─── Auth Screen ───────────────────────────────────────────

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) { setError("Enter both email and password."); return; }
    if (mode === "signup" && password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setLoading(true);
    setError("");

    const { data, error: authErr } = mode === "signup"
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });

    setLoading(false);

    if (authErr) {
      setError(authErr.message);
      return;
    }

    if (mode === "signup" && data?.user && !data.session) {
      setError("Check your email for a confirmation link, then log in.");
      setMode("login");
      return;
    }

    if (data?.session) onAuth(data.session);
  };

  return (
    <div style={{ background: "#f5f0e8", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        button:focus, input:focus { outline: none; }
        input::placeholder { color: #bbb; }
      `}</style>
      <div style={{ background: "#fff", borderRadius: 16, padding: "32px 24px", width: "100%", maxWidth: 380, boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 700, color: "#2a2018", marginBottom: 4, textAlign: "center" }}>
          Game Ranker
        </div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#aaa", textAlign: "center", marginBottom: 28, letterSpacing: 0.5 }}>
          {mode === "login" ? "SIGN IN TO SYNC YOUR COLLECTION" : "CREATE YOUR ACCOUNT"}
        </div>

        <input
          value={email} onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="Email"
          type="email"
          style={{
            width: "100%", background: "#faf8f4", border: "1px solid #d8d0c0",
            borderRadius: 8, color: "#2a2018", padding: "12px 14px",
            fontSize: 14, fontFamily: "'Playfair Display', serif", marginBottom: 10,
          }}
        />
        <input
          value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="Password"
          type="password"
          style={{
            width: "100%", background: "#faf8f4", border: "1px solid #d8d0c0",
            borderRadius: 8, color: "#2a2018", padding: "12px 14px",
            fontSize: 14, fontFamily: "'Playfair Display', serif", marginBottom: 16,
          }}
        />

        {error && (
          <div style={{
            marginBottom: 12, padding: "8px 12px",
            background: error.includes("Check your email") ? "#f0fdf4" : "#fdf0f0",
            border: `1px solid ${error.includes("Check your email") ? "#a0d0b0" : "#e0a0a0"}`,
            borderRadius: 8, fontSize: 12, fontFamily: "'Space Mono', monospace",
            color: error.includes("Check your email") ? "#2a6a3a" : "#8a2a2a",
            lineHeight: 1.5,
          }}>
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{
            width: "100%", padding: "12px", background: loading ? "#ccc" : "#8a7a5a",
            border: "none", borderRadius: 8, color: "#fff", fontWeight: 700,
            cursor: loading ? "default" : "pointer",
            fontFamily: "'Space Mono', monospace", fontSize: 13, letterSpacing: 0.5,
            marginBottom: 12,
          }}
        >
          {loading ? "..." : mode === "login" ? "SIGN IN" : "SIGN UP"}
        </button>

        <div style={{ textAlign: "center" }}>
          <button
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
            style={{
              background: "none", border: "none", color: "#8a7a5a",
              cursor: "pointer", fontSize: 12, fontFamily: "'Space Mono', monospace",
              textDecoration: "underline",
            }}
          >
            {mode === "login" ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = no session
  const [dataLoaded, setDataLoaded] = useState(false);

  const [buckets, setBuckets] = useState({});
  const [unranked, setUnranked] = useState([]);
  const [playCounts, setPlayCounts] = useState({});
  const [bggIds, setBggIds] = useState({});
  const [collIds, setCollIds] = useState({});
  const [needsSort, setNeedsSort] = useState([]);
  const [input, setInput] = useState("");
  const [held, setHeld] = useState(null);
  const [importStatus, setImportStatus] = useState(null);
  const [importMessage, setImportMessage] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [showAddOverlay, setShowAddOverlay] = useState(false);
  const [addOverlayInput, setAddOverlayInput] = useState("");
  const [addOverlayScore, setAddOverlayScore] = useState(null);
  const [currentBucket, setCurrentBucket] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showScorePicker, setShowScorePicker] = useState(false);
  const [scorePickerSelection, setScorePickerSelection] = useState(null);
  const [bggUsername, setBggUsername] = useState(() => localStorage.getItem(BGG_USERNAME_KEY) || "");
  const [bggUsernameInput, setBggUsernameInput] = useState("");
  const [showBggSetup, setShowBggSetup] = useState(false);
  const [bggSyncing, setBggSyncing] = useState(false);
  const [bggPushing, setBggPushing] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const drag = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  const bucketRefs = useRef({});
  const addOverlayInputRef = useRef(null);
  const searchInputRef = useRef(null);
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(120);

  // Cloud sync refs
  const saveTimeoutRef = useRef(null);
  const lastSaveTime = useRef(0);

  const needsSortSet = useMemo(() => new Set(needsSort), [needsSort]);
  const searchLower = searchQuery.toLowerCase().trim();

  // ─── Auth ────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ─── Load data from Supabase (or migrate localStorage) ──

  useEffect(() => {
    if (!session?.user) return;

    const loadCloudData = async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("game_data")
        .eq("id", session.user.id)
        .single();

      if (profile?.game_data && Object.keys(profile.game_data).length > 0) {
        // Cloud data exists — use it
        const d = profile.game_data;
        setBuckets(d.buckets || {});
        setUnranked(d.unranked || []);
        setPlayCounts(d.playCounts || {});
        setBggIds(d.bggIds || {});
        setNeedsSort(d.needsSort || []);
        setCollIds(d.collIds || {});
        saveLocalState(d);
      } else {
        // No cloud data — check localStorage for existing data to migrate
        const local = loadLocalState();
        if (local) {
          setBuckets(local.buckets);
          setUnranked(local.unranked);
          setPlayCounts(local.playCounts);
          setBggIds(local.bggIds);
          setNeedsSort(local.needsSort);
          setCollIds(local.collIds);

          // Migrate up to cloud
          await supabase.from("profiles").upsert({
            id: session.user.id,
            game_data: local,
            updated_at: new Date().toISOString(),
          });
        } else {
          // Fresh start — create empty profile
          await supabase.from("profiles").upsert({
            id: session.user.id,
            game_data: EMPTY_STATE,
            updated_at: new Date().toISOString(),
          });
        }
      }
      setDataLoaded(true);
    };

    loadCloudData();
  }, [session?.user?.id]);

  // ─── Real-time sync ─────────────────────────────────────

  useEffect(() => {
    if (!session?.user) return;

    const channel = supabase
      .channel("profile-sync")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${session.user.id}`,
        },
        (payload) => {
          const remoteTime = new Date(payload.new.updated_at).getTime();
          // Only apply if this update came from another device
          if (remoteTime <= lastSaveTime.current) return;

          const d = payload.new.game_data;
          if (!d) return;
          setBuckets(d.buckets || {});
          setUnranked(d.unranked || []);
          setPlayCounts(d.playCounts || {});
          setBggIds(d.bggIds || {});
          setNeedsSort(d.needsSort || []);
          setCollIds(d.collIds || {});
          saveLocalState(d);
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [session?.user?.id]);

  // ─── Save helpers ───────────────────────────────────────

  const saveToCloud = useCallback((data) => {
    if (!session?.user) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      const now = Date.now();
      lastSaveTime.current = now;
      await supabase.from("profiles").upsert({
        id: session.user.id,
        game_data: data,
        updated_at: new Date(now).toISOString(),
      });
    }, 500);
  }, [session?.user?.id]);

  // ─── Header measurement ─────────────────────────────────

  useEffect(() => {
    if (!headerRef.current) return;
    const measure = () => setHeaderHeight(headerRef.current.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, [dataLoaded]);

  // ─── Scroll tracking ───────────────────────────────────

  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
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
        ticking = false;
      });
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const setBucketRef = useCallback((bucket) => (el) => { bucketRefs.current[bucket] = el; }, []);

  // ─── Core state helpers ─────────────────────────────────

  const commit = (b, u, p, ids, ns, cids) => {
    const finalIds = ids ?? bggIds;
    const finalNs = ns ?? needsSort;
    const finalCids = cids ?? collIds;
    setBuckets(b); setUnranked(u); setPlayCounts(p); setBggIds(finalIds); setNeedsSort(finalNs); setCollIds(finalCids);

    const data = { buckets: b, unranked: u, playCounts: p, bggIds: finalIds, needsSort: finalNs, collIds: finalCids };
    saveLocalState(data);
    saveToCloud(data);
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

  // ─── BGG Sync ───────────────────────────────────────────

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

    const existingByName = {};
    Object.entries(buckets).forEach(([score, games]) => {
      games.forEach(name => { existingByName[name.toLowerCase()] = name; });
    });
    unranked.forEach(name => { existingByName[name.toLowerCase()] = name; });

    const existingByBggId = {};
    Object.entries(bggIds).forEach(([name, id]) => { existingByBggId[id] = name; });

    let newB = { ...buckets };
    let newU = [...unranked];
    let newP = { ...playCounts };
    let newIds = { ...bggIds };
    let newNs = [...needsSort];
    let newCids = { ...collIds };

    let added = 0;
    let updated = 0;
    let linked = 0;
    let unmatched = [];

    bggGames.forEach(({ id, name: bggName, plays, rating, collid }) => {
      const existingName = existingByBggId[id] || fuzzyFindMatch(bggName, existingByName);

      if (existingName) {
        newP[existingName] = Math.max(plays, newP[existingName] || 0);
        if (!newIds[existingName]) {
          newIds[existingName] = id;
          linked++;
        }
        if (collid) newCids[existingName] = collid;
        updated++;
      } else {
        newIds[bggName] = id;
        if (collid) newCids[bggName] = collid;
        newP[bggName] = plays;

        if (rating !== null && !isNaN(rating)) {
          const bucket = roundToHalf(Math.min(10, Math.max(0, rating)));
          newB[bucket] = [...(newB[bucket] || []), bggName];
          newNs.push(bggName);
        } else {
          newU = [...newU, bggName];
        }
        added++;
        unmatched.push(bggName);

        existingByName[bggName.toLowerCase()] = bggName;
        existingByBggId[id] = bggName;
      }
    });

    commit(newB, newU, newP, newIds, newNs, newCids);

    localStorage.setItem(BGG_USERNAME_KEY, username);
    setBggUsername(username);

    setImportStatus("success");
    const parts = [];
    if (added > 0) parts.push(`${added} new game${added !== 1 ? "s" : ""} added`);
    if (updated > 0) parts.push(`${updated} play count${updated !== 1 ? "s" : ""} updated`);
    if (linked > 0) parts.push(`${linked} game${linked !== 1 ? "s" : ""} linked to BGG`);
    let msg = parts.length > 0 ? parts.join(", ") + "." : "Everything up to date.";
    if (unmatched.length > 0 && unmatched.length <= 10) {
      msg += " New: " + unmatched.join(", ");
    }
    setImportMessage(msg);
    setBggSyncing(false);
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

  // Push ratings to BGG
  const pushToBGG = async () => {
    if (!bggUsername) { setShowBggSetup(true); return; }
    setBggPushing(true);
    setImportStatus("loading");
    setImportMessage("Pushing ratings to BGG...");

    const updates = [];
    Object.entries(buckets).forEach(([score, games]) => {
      games.forEach(name => {
        const objectid = bggIds[name];
        const collid = collIds[name];
        if (objectid && collid) {
          updates.push({ collid, objectid, rating: parseFloat(score) });
        }
      });
    });

    if (updates.length === 0) {
      setImportStatus("error");
      setImportMessage("No games to push. Sync from BGG first to link your games.");
      setBggPushing(false);
      return;
    }

    let totalSuccess = 0;
    let totalFailed = 0;
    let lastResponse = null;

    for (let i = 0; i < updates.length; i += 10) {
      const batch = updates.slice(i, i + 10);
      setImportMessage(`Pushing ratings to BGG... (${i}/${updates.length})`);
      try {
        const res = await fetch('/.netlify/functions/bgg-rate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates: batch, username: bggUsername }),
        });
        const data = await res.json();
        lastResponse = data;
        if (data.error) {
          setImportStatus("error");
          setImportMessage(`Push failed: ${data.error}`);
          setBggPushing(false);
          return;
        }
        totalSuccess += data.success || 0;
        totalFailed += (data.total || 0) - (data.success || 0);
      } catch (err) {
        totalFailed += batch.length;
        lastResponse = { catchError: err.message };
      }
      if (i + 10 < updates.length) await new Promise(r => setTimeout(r, 1000));
    }

    setBggPushing(false);
    setImportStatus(totalFailed === 0 && totalSuccess > 0 ? "success" : "error");
    if (totalSuccess === 0 && totalFailed === 0) {
      const debugInfo = lastResponse ? JSON.stringify(lastResponse).slice(0, 200) : "no response";
      setImportMessage(`Push sent ${updates.length} games but got 0 results. Debug: ${debugInfo}`);
    } else {
      setImportMessage(`Pushed ${totalSuccess} rating${totalSuccess !== 1 ? "s" : ""} to BGG.${totalFailed > 0 ? ` ${totalFailed} failed.` : ""}`);
    }
  };

  // ─── Selection / delete ─────────────────────────────────

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

  // ─── Move / reorder ─────────────────────────────────────

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

  const reassignScore = (newBucket) => {
    if (!held) return;
    const { b, u, movedName } = applyMove(held.bucket, held.idx, newBucket, null);
    const ns = [...needsSort.filter(n => n !== movedName), movedName];
    setHeld(null); setShowScorePicker(false);
    commit(b, u, playCounts, undefined, ns);
  };

  const deleteGame = (bucket, idx, e) => {
    e.stopPropagation();
    const name = getList(bucket)[idx];
    setConfirmDelete({ bucket, idx, name });
  };

  const confirmDeleteGame = () => {
    if (!confirmDelete) return;
    const { bucket, idx, name } = confirmDelete;
    if (held?.bucket === bucket && held?.idx === idx) setHeld(null);
    let b = { ...buckets }; let u = [...unranked];
    if (bucket === "unranked") { u.splice(idx, 1); } else { b[bucket] = [...(b[bucket] || [])]; b[bucket].splice(idx, 1); }
    const ns = needsSort.filter(n => n !== name);
    const newP = { ...playCounts }; delete newP[name];
    const newIds = { ...bggIds }; delete newIds[name];
    const newCids = { ...collIds }; delete newCids[name];
    commit(b, u, newP, newIds, ns, newCids);
    setConfirmDelete(null);
  };

  // ─── Drag and drop ─────────────────────────────────────

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

  // ─── Sign out ───────────────────────────────────────────

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setDataLoaded(false);
    setBuckets({});
    setUnranked([]);
    setPlayCounts({});
    setBggIds({});
    setCollIds({});
    setNeedsSort([]);
    setShowAccount(false);
  };

  // ─── Ranks ──────────────────────────────────────────────

  const ranks = {};
  let r = 1;
  SCORES.forEach((s) => (buckets[s] || []).forEach((_, i) => { ranks[`${s}-${i}`] = r++; }));
  const totalRanked = r - 1;

  // ─── Render bucket ──────────────────────────────────────

  const renderBucket = (bucket, label, color, isUnrankedBucket = false) => {
    const games = getList(bucket);
    const hasMatch = !searchLower || games.some(n => n.toLowerCase().includes(searchLower));
    const isEmpty = games.length === 0;
    if (searchLower && !hasMatch && isEmpty) return null;
    if (searchLower && !hasMatch) return null;
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
          <InsertSlot active={!!held && !selectMode} onClick={() => handleSlotTap(bucket, 0)} color={color} />
          {dragOver?.bucket === bucket && dragOver.insertBefore === 0 && <DropLine color={color} />}

          {games.map((name, i) => {
            const beingMoved = held?.bucket === bucket && held?.idx === i;
            const rank = !isUnrankedBucket ? ranks[`${bucket}-${i}`] : null;
            const isDragging = drag.current?.bucket === bucket && drag.current?.idx === i;
            const plays = playCounts[name];
            const isSelected = selected.has(name);
            const isNew = needsSortSet.has(name);
            const matchesSearch = !searchLower || name.toLowerCase().includes(searchLower);

            return (
              <div key={`${name}-${i}`} style={{ display: matchesSearch ? "block" : "none" }}>
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
                {!(held?.bucket === bucket && held?.idx === i) && (
                  <InsertSlot active={!!held && !selectMode} onClick={() => handleSlotTap(bucket, i + 1)} color={color} />
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

  // ─── Auth gate ──────────────────────────────────────────

  if (session === undefined) {
    return (
      <div style={{ background: "#f5f0e8", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap');`}</style>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: "#aaa" }}>Loading...</div>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen onAuth={(s) => setSession(s)} />;
  }

  if (!dataLoaded) {
    return (
      <div style={{ background: "#f5f0e8", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap');`}</style>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: "#aaa" }}>Syncing your collection...</div>
      </div>
    );
  }

  // ─── Main render ────────────────────────────────────────

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
            <button onClick={() => { setShowSearch(!showSearch); if (showSearch) setSearchQuery(""); else setTimeout(() => searchInputRef.current?.focus(), 100); }} style={{
              background: showSearch ? "#fdf6e0" : "#f5f0e8",
              border: `1px solid ${showSearch ? "#e8d898" : "#d0c8b8"}`,
              borderRadius: 8, color: showSearch ? "#b8860b" : "#8a7a5a",
              padding: "6px 10px", cursor: "pointer",
              fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5,
            }}>
              {showSearch ? "✕" : "🔍"}
            </button>
            <button onClick={toggleSelectMode} style={{
              background: selectMode ? "#ffeef0" : "#f5f0e8",
              border: `1px solid ${selectMode ? "#e08090" : "#d0c8b8"}`,
              borderRadius: 8, color: selectMode ? "#c0392b" : "#8a7a5a",
              padding: "6px 10px", cursor: "pointer",
              fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5,
            }}>
              {selectMode ? "CANCEL" : "SELECT"}
            </button>
            <button onClick={handleBggSync} disabled={bggSyncing || bggPushing} style={{
              background: bggSyncing ? "#e8e0d0" : "#f5f0e8",
              border: "1px solid #d0c8b8",
              borderRadius: 8, color: bggSyncing ? "#bbb" : "#8a7a5a",
              padding: "6px 10px", cursor: bggSyncing ? "default" : "pointer",
              fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5,
            }}>
              BGG
            </button>
            <button onClick={pushToBGG} disabled={bggPushing || bggSyncing} style={{
              background: bggPushing ? "#e8e0d0" : "#f0f7ee",
              border: `1px solid ${bggPushing ? "#d0c8b8" : "#a0d0b0"}`,
              borderRadius: 8, color: bggPushing ? "#bbb" : "#4a7c3f",
              padding: "6px 10px", cursor: bggPushing ? "default" : "pointer",
              fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5,
            }}>
              PUSH
            </button>
            <button onClick={() => setShowAccount(!showAccount)} style={{
              background: showAccount ? "#edf3f7" : "#f5f0e8",
              border: `1px solid ${showAccount ? "#a0b8d0" : "#d0c8b8"}`,
              borderRadius: 8, color: showAccount ? "#2a6080" : "#8a7a5a",
              padding: "6px 10px", cursor: "pointer",
              fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5,
            }}>
              ⚙
            </button>
          </div>
        </div>

        {/* Account panel */}
        {showAccount && (
          <div style={{ marginBottom: 10, padding: "12px", background: "#edf3f7", border: "1px solid #a0b8d0", borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontFamily: "'Space Mono', monospace", color: "#2a6080", marginBottom: 8, letterSpacing: 0.5 }}>
              SIGNED IN AS
            </div>
            <div style={{ fontSize: 13, fontFamily: "'Playfair Display', serif", color: "#2a2018", marginBottom: 12 }}>
              {session.user.email}
            </div>
            <button onClick={handleSignOut} style={{
              padding: "8px 16px", background: "#c0392b", border: "none",
              borderRadius: 6, color: "#fff", cursor: "pointer",
              fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 0.5, fontWeight: 700,
            }}>
              SIGN OUT
            </button>
          </div>
        )}

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
          <div onClick={() => { setImportStatus(null); setImportMessage(""); }} style={{
            marginBottom: 10, padding: "8px 12px",
            background: importStatus === "error" ? "#fdf0f0" : importStatus === "success" ? "#f0fdf4" : "#fdfaf0",
            border: `1px solid ${importStatus === "error" ? "#e0a0a0" : importStatus === "success" ? "#a0d0b0" : "#d0c080"}`,
            borderRadius: 8, fontSize: 12, fontFamily: "'Space Mono', monospace", lineHeight: 1.6,
            color: importStatus === "error" ? "#8a2a2a" : importStatus === "success" ? "#2a6a3a" : "#6a5a2a",
            cursor: "pointer",
          }}>
            {importMessage}
            <span style={{ float: "right", opacity: 0.5, fontSize: 10 }}>tap to dismiss</span>
          </div>
        )}

        {showSearch && (
          <div style={{ marginBottom: 10 }}>
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search games…"
              style={{
                width: "100%", background: "#fdf6e0", border: "1px solid #e8d898",
                borderRadius: 8, color: "#2a2018", padding: "9px 12px",
                fontSize: 14, fontFamily: "'Playfair Display', serif",
              }}
            />
          </div>
        )}

        {!selectMode && !showBggSetup && !showSearch && !showAccount && (
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
          position: "fixed", top: headerHeight, left: 0, right: 0, zIndex: 40,
          background: "#fffbf0", borderBottom: "2px solid #e8d898",
          padding: "10px 16px", display: "flex", alignItems: "center", gap: 10,
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        }}>
          <span style={{ color: "#8a7a2a", fontSize: 11, fontWeight: 700, fontFamily: "'Space Mono', monospace", flexShrink: 0, background: "#f5edc8", padding: "3px 8px", borderRadius: 4 }}>MOVING</span>
          <span style={{ color: "#2a2018", fontSize: 14, fontFamily: "'Playfair Display', serif", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {held.name}
          </span>
          <button onClick={() => { setShowScorePicker(true); setScorePickerSelection(null); }} style={{
            background: "#8a7a5a", border: "none",
            color: "#fff", borderRadius: 6, padding: "7px 12px",
            cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Space Mono', monospace",
            letterSpacing: 0.5,
          }}>SCORE</button>
          <button onClick={() => setHeld(null)} style={{
            background: "#c0392b", border: "none",
            color: "#fff", borderRadius: 6, padding: "7px 16px",
            cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Space Mono', monospace",
            letterSpacing: 0.5,
          }}>✕ CANCEL</button>
        </div>
      )}

      {/* Score picker overlay */}
      {showScorePicker && held && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) { setShowScorePicker(false); setScorePickerSelection(null); } }}
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
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, fontWeight: 700, color: "#2a2018", marginBottom: 4 }}>
              Set Score
            </div>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 13, color: "#888", marginBottom: 14 }}>
              {held.name}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              <button
                onClick={() => setScorePickerSelection("unranked")}
                style={{
                  padding: "8px 14px", borderRadius: 8, fontSize: 14,
                  fontFamily: "'Space Mono', monospace", cursor: "pointer",
                  border: scorePickerSelection === "unranked" ? "2px solid #888" : "1px solid #d8d0c0",
                  background: scorePickerSelection === "unranked" ? "#f0ebe0" : "#faf8f4",
                  color: scorePickerSelection === "unranked" ? "#2a2018" : "#888",
                  fontWeight: scorePickerSelection === "unranked" ? 700 : 400,
                }}
              >?</button>
              {SCORES.map((s) => (
                <button
                  key={s}
                  onClick={() => setScorePickerSelection(s)}
                  style={{
                    padding: "8px 12px", borderRadius: 8, fontSize: 13,
                    fontFamily: "'Space Mono', monospace", cursor: "pointer",
                    border: scorePickerSelection === s ? `2px solid ${scoreColor(s)}` : "1px solid #d8d0c0",
                    background: scorePickerSelection === s ? scoreBg(s) : "#faf8f4",
                    color: scorePickerSelection === s ? scoreColor(s) : "#aaa",
                    fontWeight: scorePickerSelection === s ? 700 : 400,
                  }}
                >{s.toFixed(1)}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => { setShowScorePicker(false); setScorePickerSelection(null); }}
                style={{
                  flex: 1, padding: "10px", background: "#f5f0e8", border: "1px solid #d0c8b8",
                  borderRadius: 8, color: "#8a7a5a", fontWeight: 700,
                  cursor: "pointer", fontFamily: "'Space Mono', monospace", fontSize: 12,
                }}
              >CANCEL</button>
              <button
                onClick={() => { if (scorePickerSelection !== null) reassignScore(scorePickerSelection); }}
                disabled={scorePickerSelection === null}
                style={{
                  flex: 1, padding: "10px",
                  background: scorePickerSelection !== null ? "#8a7a5a" : "#ccc",
                  border: "none", borderRadius: 8, color: "#fff", fontWeight: 700,
                  cursor: scorePickerSelection !== null ? "pointer" : "default",
                  fontFamily: "'Space Mono', monospace", fontSize: 12,
                }}
              >CONFIRM</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation overlay */}
      {confirmDelete && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmDelete(null); }}
          style={{
            position: "fixed", inset: 0, zIndex: 70,
            background: "rgba(0,0,0,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "0 20px",
          }}
        >
          <div style={{
            background: "#fff", borderRadius: 16, padding: "20px 20px 16px",
            width: "100%", maxWidth: 340,
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
          }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, fontWeight: 700, color: "#2a2018", marginBottom: 8 }}>
              Delete Game?
            </div>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 14, color: "#555", marginBottom: 16 }}>
              Remove <strong>{confirmDelete.name}</strong> from your collection?
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setConfirmDelete(null)}
                style={{
                  flex: 1, padding: "10px", background: "#f5f0e8", border: "1px solid #d0c8b8",
                  borderRadius: 8, color: "#8a7a5a", fontWeight: 700,
                  cursor: "pointer", fontFamily: "'Space Mono', monospace", fontSize: 12,
                }}
              >CANCEL</button>
              <button
                onClick={confirmDeleteGame}
                style={{
                  flex: 1, padding: "10px", background: "#c0392b", border: "none",
                  borderRadius: 8, color: "#fff", fontWeight: 700,
                  cursor: "pointer", fontFamily: "'Space Mono', monospace", fontSize: 12,
                }}
              >DELETE</button>
            </div>
          </div>
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

function InsertSlot({ onClick, color, active }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={active ? onClick : undefined}
      onMouseEnter={active ? () => setHover(true) : undefined}
      onMouseLeave={active ? () => setHover(false) : undefined}
      style={{
        height: active && hover ? 16 : 8,
        margin: "0 4px",
        display: "flex", alignItems: "center",
        cursor: active ? "pointer" : "default",
        transition: "height 0.1s",
        overflow: "hidden",
      }}
    >
      {active && (
        <div style={{ height: 2, flex: 1, background: hover ? color : color + "33", borderRadius: 2, transition: "background 0.1s" }} />
      )}
    </div>
  );
}

function DropLine({ color }) {
  return <div style={{ height: 2, margin: "1px 8px", background: color, borderRadius: 2 }} />;
}