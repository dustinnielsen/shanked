"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ── Supabase config ──────────────────────────────────────────────────────────
const SUPA_URL = "https://vqtuuncnolvkxyelapdo.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxdHV1bmNub2x2a3h5ZWxhcGRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxODU0ODQsImV4cCI6MjA4ODc2MTQ4NH0.q0HuKI3QWfih2jDdsJWwLTCfRnAJpDXG2li8vqIUsOA";

async function supaFetch(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: "return=representation" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPA_URL}/rest/v1${path}`, opts);
  if (!res.ok) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Game Session Persistence ─────────────────────────────────────────────────
const SESSION_KEY = "shanked_session_id";

function saveSessionId(id) {
  try { localStorage.setItem(SESSION_KEY, id); } catch {}
}

function loadSessionId() {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}

function clearSessionId() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

async function createGameSession(state) {
  const { sessionId, tripName, players, totalRounds, betAmount, currentRound, hole,
          allScores, roundScores, roastLog, courseInfo, propBets, isMultiplayer, roomId } = state;
  return supaFetch("/game_sessions", "POST", {
    id: sessionId, trip_name: tripName, players, total_rounds: totalRounds,
    bet_amount: betAmount, current_round: currentRound, current_hole: hole,
    all_scores: allScores, round_scores: roundScores, roast_log: roastLog,
    course_info: courseInfo, prop_bets: propBets,
    is_multiplayer: isMultiplayer, room_id: roomId, is_active: true,
  });
}

async function updateGameSession(sessionId, patch) {
  return supaFetch(`/game_sessions?id=eq.${sessionId}`, "PATCH", {
    ...patch, updated_at: new Date().toISOString()
  });
}

async function loadGameSession(sessionId) {
  const rows = await supaFetch(`/game_sessions?id=eq.${sessionId}&limit=1`);
  return rows?.[0] || null;
}

function genId() { return Math.random().toString(36).slice(2, 9).toUpperCase(); }

// ── Constants ────────────────────────────────────────────────────────────────
const ROAST_INTENSITY = [
  { holes: [1, 3],   label: "Warm Up",         emoji: "😏", color: "#f59e0b" },
  { holes: [4, 6],   label: "Getting Personal", emoji: "😬", color: "#f97316" },
  { holes: [7, 9],   label: "Front 9 Damage",   emoji: "🔥", color: "#16a34a" },
  { holes: [10, 12], label: "No Mercy",          emoji: "💀", color: "#15803d" },
  { holes: [13, 15], label: "Scorched Earth",    emoji: "☠️", color: "#166534" },
  { holes: [16, 18], label: "SAVAGE MODE",       emoji: "🤬", color: "#14532d" },
];
const getIntensity = (hole) =>
  ROAST_INTENSITY.find((r) => hole >= r.holes[0] && hole <= r.holes[1]) || ROAST_INTENSITY[5];

const PROP_TEMPLATES = [
  (p) => `${p} 3-putts at least once`,
  (p) => `${p} hits it into the water`,
  (p) => `${p} takes a mulligan`,
  (p) => `${p} blames their equipment`,
  (p) => `${p} loses a ball`,
  (p) => `${p} asks for a ruling`,
  (p) => `${p} takes longest to putt out`,
  (p) => `${p} complains about the course`,
  (p) => `${p} has the best excuse for a bad shot`,
  (p) => `${p} celebrates a bogey like it's a birdie`,
];

function buildRoastPrompt(hole, intensity, worstPlayer, worstProfile, playerScores, worstShot, hasPhoto, courseInfo) {
  const par = courseInfo?.pars?.[hole - 1];
  const courseLine = courseInfo?.name ? `Course: ${courseInfo.name}` : "";
  const parLine = par ? `Hole ${hole} par: ${par}` : "";
  return `You are a savage golf roast machine at a casual golf trip with friends. Roast the worst performer.

Intensity: ${intensity.label} (hole ${hole}/18 — ${hole <= 6 ? "light and funny" : hole <= 12 ? "personal and sharp" : "full savage, no mercy"})
Player: ${worstPlayer}
Traits/weaknesses: ${worstProfile?.traits || "none"}
Scores: ${playerScores}
${courseLine}${parLine ? ` · ${parLine}` : ""}
${worstShot ? `Worst shot: ${worstShot}` : ""}
${hasPhoto ? "Photo attached — reference specific visual details." : ""}
${par ? `Reference the par when relevant (e.g. if they scored way over par, roast them for it specifically).` : ""}

ONE roast, 3-5 sentences. Funny, specific, escalating. Reference other scores to twist the knife. No intro. Ruthless but not mean-spirited.`;
}

// ── Supabase spectator helpers ───────────────────────────────────────────────
async function createSession(sessionId, tripName, players) {
  return supaFetch("/spectator_sessions", "POST", {
    id: sessionId, trip_name: tripName, players,
    current_round: 1, current_hole: 1,
    all_scores: [], roast_log: [], latest_roast: null, is_active: true,
  });
}

async function updateSession(sessionId, patch) {
  return supaFetch(`/spectator_sessions?id=eq.${sessionId}`, "PATCH", { ...patch, updated_at: new Date().toISOString() });
}

async function getSession(sessionId) {
  const rows = await supaFetch(`/spectator_sessions?id=eq.${sessionId}&limit=1`);
  return rows?.[0] || null;
}

// ════════════════════════════════════════════════════════════════════════════
// SPECTATOR VIEW  (shown when ?spectate=XXXX in URL)
// ════════════════════════════════════════════════════════════════════════════
function SpectatorView({ sessionId }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRoastId, setLastRoastId] = useState(null);
  const [flash, setFlash] = useState(false);

  const poll = useCallback(async () => {
    const data = await getSession(sessionId);
    if (data) {
      const newRoastId = data.roast_log?.length;
      if (newRoastId !== lastRoastId && lastRoastId !== null) {
        setFlash(true);
        setTimeout(() => setFlash(false), 2000);
      }
      setLastRoastId(newRoastId);
      setSession(data);
    }
    setLoading(false);
  }, [sessionId, lastRoastId]);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [poll]);

  if (loading) return (
    <div className="spec-loading">
      <div className="loading-dots"><span /><span /><span /></div>
      <p>Connecting to live round...</p>
    </div>
  );

  if (!session) return (
    <div className="spec-loading"><p>Session not found. Check the link.</p></div>
  );

  const latestRoast = session.roast_log?.[session.roast_log.length - 1];
  const intensity = getIntensity(session.current_hole || 1);
  const players = session.players || [];

  // Build leaderboard from scores
  const totals = players.map(p => ({
    name: p.name,
    total: (session.all_scores || []).reduce((sum, h) => sum + (parseInt(h.scores?.[p.name]) || 0), 0),
  })).sort((a, b) => a.total - b.total);

  return (
    <div className="app">
      <div className="screen spec-screen">
        <div className="spec-header">
          <div className="spec-live-badge">🔴 LIVE</div>
          <h1 className="spec-title">{session.trip_name || "Golf Trip"}</h1>
          <p className="spec-sub">Round {session.current_round} · Hole {session.current_hole}</p>
        </div>

        {/* Live scoreboard */}
        <div className="spec-card">
          <h3 className="section-label">📊 Leaderboard</h3>
          {totals.map((p, i) => (
            <div key={p.name} className="spec-score-row">
              <span className="spec-rank">{i === 0 ? "🏅" : `${i + 1}.`}</span>
              <span className="spec-pname">{p.name}</span>
              <span className="spec-ptotal">{p.total || "—"}</span>
            </div>
          ))}
        </div>

        {/* Latest roast */}
        {latestRoast && (
          <div className={`spec-card spec-roast-card ${flash ? "flash" : ""}`} style={{ borderColor: getIntensity(latestRoast.hole).color }}>
            <div className="spec-roast-label" style={{ color: getIntensity(latestRoast.hole).color }}>
              {getIntensity(latestRoast.hole).emoji} Hole {latestRoast.hole} — {latestRoast.player} got roasted
            </div>
            <p className="spec-roast-text">"{latestRoast.roast}"</p>
          </div>
        )}

        {/* All roasts log */}
        {session.roast_log?.length > 1 && (
          <div className="spec-card">
            <h3 className="section-label">📋 Roast History</h3>
            {[...session.roast_log].reverse().slice(1).map((r, i) => {
              const int = getIntensity(r.hole);
              return (
                <div key={i} className="log-entry">
                  <div className="log-header">
                    <span className="log-hole" style={{ color: int.color }}>Hole {r.hole}</span>
                    <span className="log-player">{r.player}</span>
                    <span>{int.emoji}</span>
                  </div>
                  <p className="log-roast">{r.roast}</p>
                </div>
              );
            })}
          </div>
        )}

        <p className="spec-refresh-note">Auto-refreshes every 5 seconds</p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SETUP SCREEN
// ════════════════════════════════════════════════════════════════════════════
function SetupScreen({ onStart }) {
  const [tripName, setTripName] = useState("");
  const [numRounds, setNumRounds] = useState(1);
  const [totalHoles, setTotalHoles] = useState(18);
  const [players, setPlayers] = useState([{ name: "", traits: "" }, { name: "", traits: "" }]);
  const [betAmount, setBetAmount] = useState("");

  const addPlayer = () => { if (players.length < 6) setPlayers([...players, { name: "", traits: "" }]); };
  const removePlayer = (i) => { if (players.length > 2) setPlayers(players.filter((_, idx) => idx !== i)); };
  const updatePlayer = (i, f, v) => { const u = [...players]; u[i][f] = v; setPlayers(u); };
  const [mode, setMode] = useState("solo"); // solo | multi
  const canStart = players.every((p) => p.name.trim()) && tripName.trim();

  return (
    <div className="screen setup-screen">
      <div className="setup-header">
        <div className="shanked-logo">
          <svg viewBox="-40 0 400 110" xmlns="http://www.w3.org/2000/svg" className="shanked-svg">
            <defs>
              <linearGradient id="redGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#16a34a"/>
                <stop offset="100%" stopColor="#166534"/>
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            {/* Ball trajectory arc - shanked shot going sideways */}
            <path d="M 30 80 Q 80 20 260 65" stroke="#333" strokeWidth="1.5" fill="none" strokeDasharray="4,4"/>
            {/* Shanked trajectory - going wild */}
            <path d="M 30 80 Q 60 75 100 85 Q 140 95 290 30" stroke="url(#redGrad)" strokeWidth="2.5" fill="none" filter="url(#glow)"/>
            {/* Golf ball at impact */}
            <circle cx="30" cy="80" r="7" fill="#f0ece4" />
            <circle cx="30" cy="80" r="5" fill="#e8e0d5" />
            {/* Ball flying off wild */}
            <circle cx="290" cy="30" r="5" fill="#16a34a" filter="url(#glow)"/>
            {/* SHANKED text */}
            <text x="160" y="72" textAnchor="middle" fontFamily="'Russo One', sans-serif"
              fontSize="68" fontWeight="900" letterSpacing="4" fill="url(#redGrad)" filter="url(#glow)">
              SHANKED
            </text>
            {/* Underline slash */}
            <line x1="40" y1="82" x2="280" y2="82" stroke="#16a34a" strokeWidth="1.5" opacity="0.4"/>
          </svg>
          <p className="shanked-tagline">AI-powered golf trip roast machine</p>
        </div>
      </div>

      <div className="trip-meta">
        <h3 className="section-label">Trip Details</h3>
        <input className="input-name" placeholder="Trip name (e.g. Vegas 2026 🎰)" value={tripName} onChange={e => setTripName(e.target.value)} />
        <div className="meta-row">
          <div className="meta-field">
            <label className="meta-label">Holes</label>
            <div className="round-btns">
              {[9,18].map(n => (
                <button key={n} className={`round-btn ${totalHoles === n ? "active" : ""}`} onClick={() => setTotalHoles(n)}>{n}</button>
              ))}
            </div>
          </div>
          <div className="meta-field">
            <label className="meta-label">Rounds</label>
            <div className="round-btns">
              {[1,2,3].map(n => (
                <button key={n} className={`round-btn ${numRounds === n ? "active" : ""}`} onClick={() => setNumRounds(n)}>{n}</button>
              ))}
            </div>
          </div>
          <div className="meta-field">
            <label className="meta-label">$ Per Hole (optional)</label>
            <input className="input-bet" placeholder="e.g. 5" value={betAmount} onChange={e => setBetAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
          </div>
        </div>
      </div>

      <div className="players-list">
        <h3 className="section-label">Players</h3>
        {players.map((p, i) => (
          <div className="player-card" key={i} style={{ animationDelay: `${i * 0.08}s` }}>
            <div className="player-num">P{i + 1}</div>
            <div className="player-fields">
              <input className="input-name" placeholder="Player name" value={p.name} onChange={(e) => updatePlayer(i, "name", e.target.value)} />
              <input className="input-traits" placeholder="Weaknesses / traits (AI will weaponize these)" value={p.traits} onChange={(e) => updatePlayer(i, "traits", e.target.value)} />
            </div>
            {players.length > 2 && <button className="remove-btn" onClick={() => removePlayer(i)}>✕</button>}
          </div>
        ))}
      </div>

      <div className="setup-actions">
        <div className="mode-toggle">
          <button className={`mode-btn ${mode === "solo" ? "active" : ""}`} onClick={() => setMode("solo")}>
            👤 Solo Host
          </button>
          <button className={`mode-btn ${mode === "multi" ? "active" : ""}`} onClick={() => setMode("multi")}>
            👥 Multiplayer
          </button>
        </div>
        <p className="mode-hint">
          {mode === "solo" ? "You control everything. Others watch via spectator link." : "Each player joins on their own phone and submits their own score."}
        </p>
        {players.length < 6 && <button className="btn-secondary" onClick={addPlayer}>+ Add Player</button>}
        <button className={`btn-primary ${!canStart ? "disabled" : ""}`}
          onClick={() => canStart && onStart(players, tripName, numRounds, parseFloat(betAmount) || 0, mode, totalHoles)}>
          {mode === "multi" ? "CREATE ROOM →" : "START THE CARNAGE"}
        </button>
      </div>

      <div className="intensity-preview">
        <p className="preview-label">Roast escalation — holes get nastier as you go:</p>
        <div className="intensity-bar">
          {ROAST_INTENSITY.map((r, i) => <div key={i} className="intensity-segment" style={{ background: r.color }} />)}
        </div>
        <div className="intensity-labels"><span>😏 Mild</span><span>🤬 Savage</span></div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// HOLE SCREEN
// ════════════════════════════════════════════════════════════════════════════
function HoleScreen({ players, hole, round, totalRounds, onSubmit, betAmount, pendingNominations = [], isMultiplayer = false, courseInfo }) {
  const [holeScores, setHoleScores] = useState(players.reduce((a, p) => ({ ...a, [p.name]: "" }), {}));
  const [worstShot, setWorstShot] = useState("");
  const [worstPlayer, setWorstPlayer] = useState(players[0].name);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const fileRef = useRef();
  const intensity = getIntensity(hole);
  const allFilled = players.every((p) => holeScores[p.name] !== "");

  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setPhotoPreview(ev.target.result); setPhoto(ev.target.result.split(",")[1]); };
    reader.readAsDataURL(file);
  };

  return (
    <div className="screen hole-screen">
      <div className="hole-header" style={{ borderColor: intensity.color }}>
        <div>
          <div className="hole-badge" style={{ background: intensity.color }}>HOLE {hole}</div>
          {totalRounds > 1 && <div className="round-tag">Round {round}/{totalRounds}</div>}
        </div>
        <div className="intensity-tag">{intensity.emoji} {intensity.label}</div>
      </div>

      <div className="scores-section">
        <h3 className="section-label">Scores {betAmount > 0 && <span className="bet-tag">${betAmount}/hole</span>}</h3>
        <div className="score-grid">
          {players.map((p) => (
            <div className="score-row" key={p.name}>
              <span className="score-name">{p.name}</span>
              <div className="score-buttons">
                {[1,2,3,4,5,6,7,8,9].map((n) => (
                  <button key={n} className={`score-btn ${holeScores[p.name] == n ? "active" : ""}`}
                    style={holeScores[p.name] == n ? { background: intensity.color } : {}}
                    onClick={() => setHoleScores({ ...holeScores, [p.name]: n })}>{n}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="roast-fuel">
        <h3 className="section-label">🔥 Roast Fuel</h3>
        <select className="roast-select" value={worstPlayer} onChange={(e) => setWorstPlayer(e.target.value)}>
          {players.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
        <textarea className="shot-input" placeholder="Describe their worst shot... the AI will weaponize it."
          value={worstShot} onChange={(e) => setWorstShot(e.target.value)} rows={3} />
      </div>

      <div className="photo-section">
        <h3 className="section-label">📸 Evidence (optional)</h3>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handlePhoto} />
        {photoPreview ? (
          <div className="photo-preview-wrap">
            <img src={photoPreview} className="photo-preview" alt="hole" />
            <button className="photo-remove" onClick={() => { setPhoto(null); setPhotoPreview(null); }}>✕ Remove</button>
          </div>
        ) : (
          <button className="btn-photo" onClick={() => fileRef.current.click()}>📷 Add Photo of the Crime Scene</button>
        )}
      </div>

      {/* Multiplayer nominations from other players */}
      {isMultiplayer && pendingNominations.length > 0 && (
        <div className="nominations-card">
          <h3 className="section-label">📲 Player Nominations</h3>
          {pendingNominations.filter(n => n.hole === hole).map((n, i) => (
            <div key={i} className="nomination-row">
              <span className="nom-from">{n.from} nominates</span>
              <span className="nom-player" style={{ color: intensity.color }}>{n.player}</span>
              {n.shot && <p className="nom-shot">"{n.shot}"</p>}
            </div>
          ))}
        </div>
      )}

      <button className={`btn-primary ${!allFilled ? "disabled" : ""}`}
        onClick={() => allFilled && onSubmit(holeScores, worstPlayer, worstShot, photo, photoPreview)}
        style={allFilled ? { background: intensity.color } : {}}>
        ROAST 'EM →
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ROAST SCREEN
// ════════════════════════════════════════════════════════════════════════════
function RoastScreen({ players, hole, round, holeScores, worstPlayer, worstShot, photo, photoPreview, onNext, onEndRound, onFinal, onSaveRoast, isLastHole, isLastRound, courseInfo }) {
  const [roast, setRoast] = useState("");
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [shareMsg, setShareMsg] = useState("");
  const intensity = getIntensity(hole);
  const worstProfile = players.find((p) => p.name === worstPlayer);

  useEffect(() => { generateRoast(); }, []);

  const generateRoast = async () => {
    setLoading(true); setRevealed(false);
    const playerScores = players.map((p) => `${p.name}: ${holeScores[p.name]}`).join(", ");
    const messages = [{
      role: "user",
      content: photo
        ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: photo } },
           { type: "text", text: buildRoastPrompt(hole, intensity, worstPlayer, worstProfile, playerScores, worstShot, true, courseInfo) }]
        : [{ type: "text", text: buildRoastPrompt(hole, intensity, worstPlayer, worstProfile, playerScores, worstShot, false, courseInfo) }]
    }];
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const text = data.content?.find(b => b.type === "text")?.text || "The AI couldn't do worse than that shot.";
      setRoast(text);
      onSaveRoast(hole, worstPlayer, text);
    } catch (err) {
      const fallback = `API Error: ${err.message || "Unknown error"}`;
      setRoast(fallback);
      onSaveRoast(hole, worstPlayer, "The AI is weeping. That shot was too sad to roast.");
    }
    setLoading(false);
    setTimeout(() => setRevealed(true), 100);
  };

  const handleShare = async () => {
    const scoresSummary = players.map(p => `${p.name}: ${holeScores[p.name]}`).join(" | ");
    const text = `⛳ HOLE ${hole} ROAST ${intensity.emoji}\n\n${worstPlayer.toUpperCase()} GOT ROASTED:\n\n"${roast}"\n\n${scoresSummary}\n\n⛳ SHANKED — Golf Roast Machine`;
    try {
      if (navigator.share) { await navigator.share({ text, title: `Hole ${hole} Roast` }); setShareMsg("Shared! 🎉"); }
      else { await navigator.clipboard.writeText(text); setShareMsg("Copied! Paste it anywhere."); }
    } catch { setShareMsg("Long-press to copy manually."); }
    setTimeout(() => setShareMsg(""), 3000);
  };

  return (
    <div className="screen roast-screen">
      <div className="roast-target" style={{ color: intensity.color }}>{intensity.emoji} {worstPlayer.toUpperCase()} GETS ROASTED</div>
      {photoPreview && (
        <div className="hole-photo">
          <img src={photoPreview} alt="evidence" className="hole-photo-img" />
          <div className="hole-photo-label">📸 Exhibit A</div>
        </div>
      )}
      <div className={`roast-card ${revealed ? "revealed" : ""}`} style={{ borderColor: intensity.color }}>
        {loading ? (
          <div className="loading-roast">
            <div className="loading-dots">
              <span style={{ background: intensity.color }} /><span style={{ background: intensity.color }} /><span style={{ background: intensity.color }} />
            </div>
            <p className="loading-text">{photo ? "Analyzing the evidence..." : "AI sharpening its claws..."}</p>
          </div>
        ) : <p className="roast-text">{roast}</p>}
      </div>

      {!loading && (
        <>
          <div className="scores-recap">
            <p className="recap-label">Hole {hole} · Round {round}</p>
            <div className="recap-scores">
              {players.map((p) => (
                <div key={p.name} className={`recap-score ${p.name === worstPlayer ? "worst" : ""}`}
                  style={p.name === worstPlayer ? { borderColor: intensity.color, color: intensity.color } : {}}>
                  <span>{p.name}</span><span className="recap-num">{holeScores[p.name]}</span>
                </div>
              ))}
            </div>
          </div>
          <button className="btn-share" onClick={handleShare}>📤 Share This Roast</button>
          {shareMsg && <p className="share-msg">{shareMsg}</p>}
          <div className="roast-actions">
            {isLastHole && isLastRound
              ? <button className="btn-primary" style={{ background: intensity.color }} onClick={onFinal}>SEE FINAL ROAST REPORT 🏆</button>
              : isLastHole
              ? <button className="btn-primary" style={{ background: intensity.color }} onClick={onEndRound}>END ROUND {round} →</button>
              : <button className="btn-primary" style={{ background: intensity.color }} onClick={onNext}>NEXT HOLE →</button>
            }
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ROUND SUMMARY (between rounds)
// ════════════════════════════════════════════════════════════════════════════
function RoundSummaryScreen({ players, round, roundScores, betAmount, cumulativeScores, onNextRound }) {
  const roundTotals = players.map(p => ({
    name: p.name,
    total: roundScores.reduce((s, h) => s + (parseInt(h.scores[p.name]) || 0), 0),
  })).sort((a, b) => a.total - b.total);

  const cumTotals = players.map(p => ({
    name: p.name,
    total: cumulativeScores.reduce((s, h) => s + (parseInt(h.scores[p.name]) || 0), 0),
  })).sort((a, b) => a.total - b.total);

  // Bet calc: winner is lowest score
  const winner = roundTotals[0];
  const betPot = betAmount * 18 * (players.length - 1);

  return (
    <div className="screen summary-screen">
      <div className="summary-header">
        <div className="summary-icon">🏁</div>
        <h2 className="summary-title">ROUND {round} COMPLETE</h2>
      </div>

      <div className="summary-card">
        <h3 className="section-label">Round {round} Scores</h3>
        {roundTotals.map((p, i) => (
          <div key={p.name} className={`summary-row ${i === 0 ? "winner" : i === roundTotals.length - 1 ? "loser" : ""}`}>
            <span className="summary-rank">{i === 0 ? "🏅" : i === roundTotals.length - 1 ? "💀" : `#${i + 1}`}</span>
            <span className="summary-name">{p.name}</span>
            <span className="summary-score">{p.total}</span>
          </div>
        ))}
      </div>

      {betAmount > 0 && (
        <div className="bet-result-card">
          <h3 className="section-label">💰 Bet Result</h3>
          <p className="bet-winner">{winner.name} wins ${betPot.toFixed(0)}</p>
          <div className="bet-breakdown">
            {roundTotals.slice(1).map(p => (
              <p key={p.name} className="bet-loser-line">{p.name} owes ${(betAmount * 18).toFixed(0)}</p>
            ))}
          </div>
        </div>
      )}

      {cumulativeScores.length > 18 && (
        <div className="summary-card">
          <h3 className="section-label">Trip Running Total</h3>
          {cumTotals.map((p, i) => (
            <div key={p.name} className="summary-row">
              <span className="summary-rank">{i === 0 ? "🏅" : `#${i + 1}`}</span>
              <span className="summary-name">{p.name}</span>
              <span className="summary-score">{p.total}</span>
            </div>
          ))}
        </div>
      )}

      <button className="btn-primary" onClick={onNextRound}>START ROUND {round + 1} →</button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PROP BETS SCREEN
// ════════════════════════════════════════════════════════════════════════════
function PropBetsScreen({ players, onDone }) {
  const [props, setProps] = useState([]);
  const [results, setResults] = useState({});
  const [generated, setGenerated] = useState(false);
  const [loading, setLoading] = useState(false);

  const generateProps = async () => {
    setLoading(true);
    const names = players.map(p => p.name);
    const traits = players.map(p => `${p.name}: ${p.traits || "unknown"}`).join(", ");
    const prompt = `Generate 5 funny, specific prop bets for a casual golf round. Players: ${names.join(", ")}. Traits: ${traits}.
    
Make each bet about a specific player doing something hilarious or embarrassing. Format as JSON array: [{"bet": "...", "player": "PlayerName"}]. Only JSON, no other text.`;

    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "[]";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setProps(parsed);
    } catch {
      // Fallback to templates
      const shuffled = [...PROP_TEMPLATES].sort(() => Math.random() - 0.5).slice(0, 5);
      setProps(shuffled.map(t => ({ bet: t(names[Math.floor(Math.random() * names.length)]), player: names[0] })));
    }
    setGenerated(true);
    setLoading(false);
  };

  const toggleResult = (i, player) => {
    setResults(prev => ({ ...prev, [i]: prev[i] === player ? null : player }));
  };

  return (
    <div className="screen prop-screen">
      <div className="prop-header">
        <h2 className="prop-title">🎯 PROP BETS</h2>
        <p className="prop-sub">AI-generated bets for this round. Track who wins each.</p>
      </div>

      {!generated ? (
        <button className="btn-primary" onClick={generateProps} disabled={loading}>
          {loading ? "Generating..." : "🎲 Generate Prop Bets"}
        </button>
      ) : (
        <>
          <div className="props-list">
            {props.map((prop, i) => (
              <div key={i} className={`prop-card ${results[i] ? "settled" : ""}`}>
                <p className="prop-bet">{prop.bet}</p>
                <div className="prop-players">
                  <p className="prop-vote-label">Did it happen? Who?</p>
                  <div className="prop-btns">
                    <button className={`prop-btn ${results[i] === "NO" ? "active-no" : ""}`}
                      onClick={() => toggleResult(i, "NO")}>Nope</button>
                    {players.map(p => (
                      <button key={p.name} className={`prop-btn ${results[i] === p.name ? "active-yes" : ""}`}
                        onClick={() => toggleResult(i, p.name)}>{p.name}</button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button className="btn-secondary regen-btn" onClick={generateProps}>🔄 Regenerate</button>
          <button className="btn-primary" onClick={() => onDone(props, results)} style={{ marginTop: "10px" }}>
            Save & Continue →
          </button>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MID-ROUND TRASH TALK
// ════════════════════════════════════════════════════════════════════════════
function TrashTalkModal({ players, onClose }) {
  const [target, setTarget] = useState(players[0].name);
  const [situation, setSituation] = useState("");
  const [roast, setRoast] = useState("");
  const [loading, setLoading] = useState(false);
  const worstProfile = players.find(p => p.name === target);

  const fire = async () => {
    setLoading(true); setRoast("");
    const prompt = `Deliver a short, savage unprompted trash talk to ${target} during a casual golf round.
Traits: ${worstProfile?.traits || "none"}
${situation ? `Situation: ${situation}` : ""}
2-3 sentences max. No intro. Pure roast energy. Go.`;
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json();
      setRoast(data.content?.find(b => b.type === "text")?.text || "...");
    } catch { setRoast("The AI choked. Just like your swing."); }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">🔥 TRASH TALK</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <select className="roast-select" value={target} onChange={e => setTarget(e.target.value)} style={{ marginBottom: "10px" }}>
          {players.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
        <input className="input-name" placeholder="What just happened? (optional)" value={situation}
          onChange={e => setSituation(e.target.value)} style={{ marginBottom: "12px" }} />
        <button className="btn-primary" onClick={fire} disabled={loading} style={{ marginBottom: "12px" }}>
          {loading ? "Loading..." : "🔥 FIRE"}
        </button>
        {roast && <p className="trash-result">"{roast}"</p>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 19TH HOLE CARD  (shareable summary card)
// ════════════════════════════════════════════════════════════════════════════
function NineteenthHoleCard({ tripName, players, allScores, roastLog, totalRounds }) {
  const totals = players.map(p => ({
    name: p.name,
    total: allScores.reduce((s, h) => s + (parseInt(h.scores?.[p.name]) || 0), 0),
  })).sort((a, b) => a.total - b.total);

  const mostRoasted = roastLog.reduce((acc, r) => {
    acc[r.player] = (acc[r.player] || 0) + 1; return acc;
  }, {});
  const roastChamp = Object.entries(mostRoasted).sort((a, b) => b[1] - a[1])[0];
  const bestRoast = roastLog[Math.floor(roastLog.length * 0.7)] || roastLog[roastLog.length - 1];

  return (
    <div className="hole19-card">
      <div className="hole19-header">
        <span className="hole19-emoji">⛳</span>
        <div>
          <div className="hole19-title">{tripName}</div>
          <div className="hole19-sub">{totalRounds} Round{totalRounds > 1 ? "s" : ""} · {players.length} Players</div>
        </div>
        <span className="hole19-emoji">🏆</span>
      </div>

      <div className="hole19-scores">
        {totals.map((p, i) => (
          <div key={p.name} className="hole19-score-row">
            <span>{i === 0 ? "🏅" : i === totals.length - 1 ? "💀" : `#${i + 1}`}</span>
            <span className="hole19-name">{p.name}</span>
            <span className="hole19-num">{p.total}</span>
          </div>
        ))}
      </div>

      {roastChamp && (
        <div className="hole19-award">
          <span className="hole19-award-icon">☠️</span>
          <div>
            <div className="hole19-award-title">GOLDEN DIVOT AWARD</div>
            <div className="hole19-award-sub">{roastChamp[0]} · roasted {roastChamp[1]}x</div>
          </div>
        </div>
      )}

      {bestRoast && (
        <div className="hole19-roast">
          <div className="hole19-roast-label">Best roast of the trip:</div>
          <p className="hole19-roast-text">"{bestRoast.roast.slice(0, 120)}{bestRoast.roast.length > 120 ? "..." : ""}"</p>
        </div>
      )}

      <div className="hole19-footer">⛳ SHANKED · Golf Roast Machine</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FINAL SCREEN
// ════════════════════════════════════════════════════════════════════════════
function FinalScreen({ players, allScores, roastLog, tripName, totalRounds, betAmount, trophyRooms, onSaveToTrophy, onRestart }) {
  const [report, setReport] = useState("");
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState("");
  const [shareMsg, setShareMsg] = useState("");
  const [tab, setTab] = useState("report"); // report | card | trophy

  const totals = players.map(p => ({
    name: p.name,
    total: allScores.reduce((s, h) => s + (parseInt(h.scores?.[p.name]) || 0), 0),
    traits: p.traits || "",
  })).sort((a, b) => b.total - a.total);

  useEffect(() => { generateReport(); }, []);

  const generateReport = async () => {
    const summary = totals.map(p => `${p.name}: ${p.total} strokes. Traits: ${p.traits || "none"}`).join("\n");
    const highlights = roastLog.slice(0, 6).map(r => `Hole ${r.hole} (${r.player}): "${r.roast.slice(0, 80)}..."`).join("\n");
    const prompt = `Final Roast Report for golf trip "${tripName}" (${totalRounds} round${totalRounds > 1 ? "s" : ""}).

Players (worst to best):
${summary}

Sample roasts:
${highlights}

Write a Post-Round Roast Report:
1. Creative funny title
2. 2-3 sentence roast per player referencing their score and traits
3. "Golden Divot Award" to worst player with brutal closing line
4. One sendoff for the group

Like a drunk caddy who knows everyone. No markdown headers, flowing funny text.`;

    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json();
      setReport(data.content?.find(b => b.type === "text")?.text || "The AI retired.");
    } catch { setReport("The AI is in therapy after this round."); }
    setLoading(false);
  };

  const buildEmailBody = () => {
    const scoreLines = totals.map(p => `${p.name}: ${p.total}`).join("\n");
    const allRoasts = roastLog.map(r => `Hole ${r.hole} — ${r.player}:\n"${r.roast}"`).join("\n\n");
    return `GOLF ROAST MACHINE — ${tripName}\n${"=".repeat(40)}\n\nSCORES:\n${scoreLines}\n\n${"=".repeat(40)}\n\n${report}\n\n${"=".repeat(40)}\n\nHOLE-BY-HOLE:\n\n${allRoasts}\n\n🏌️‍♂️ Golf Roast Machine`;
  };

  const handleEmail = () => {
    if (!email.trim() || !report) return;
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(`⛳ ${tripName} — Roast Report`)}&body=${encodeURIComponent(buildEmailBody())}`;
    setTimeout(() => setEmailStatus("Email app opened! Hit send. 📧"), 800);
  };

  const handleShareReport = async () => {
    const text = `⛳ ${tripName} ROAST REPORT 🏆\n\n${report}\n\nScores: ${totals.map(p => `${p.name}: ${p.total}`).join(" | ")}`;
    try {
      if (navigator.share) { await navigator.share({ text, title: tripName }); setShareMsg("Shared! 🎉"); }
      else { await navigator.clipboard.writeText(text); setShareMsg("Copied! Paste anywhere."); }
    } catch { setShareMsg("Long-press to copy manually."); }
    setTimeout(() => setShareMsg(""), 4000);
  };

  // Bet final calc
  const tripWinner = [...totals].sort((a, b) => a.total - b.total)[0];
  const tripPot = betAmount * 18 * totalRounds * (players.length - 1);

  return (
    <div className="screen final-screen">
      <div className="final-header">
        <div className="trophy">🏆</div>
        <h2 className="final-title">TRIP COMPLETE</h2>
        <p className="final-trip-name">{tripName}</p>
      </div>

      {/* Tabs */}
      <div className="tab-bar">
        {["report", "card", "trophy"].map(t => (
          <button key={t} className={`tab-btn ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t === "report" ? "📝 Report" : t === "card" ? "🃏 19th Hole" : "🏆 Trophy"}
          </button>
        ))}
      </div>

      {tab === "report" && (
        <>
          <div className="final-scoreboard">
            {totals.map((p, i) => (
              <div key={p.name} className={`final-row ${i === 0 ? "loser" : i === totals.length - 1 ? "winner" : ""}`}>
                <span className="final-rank">{i === 0 ? "💀" : i === totals.length - 1 ? "🏅" : `#${i + 1}`}</span>
                <span className="final-name">{p.name}</span>
                <span className="final-total">{p.total}</span>
              </div>
            ))}
          </div>

          {betAmount > 0 && (
            <div className="bet-result-card">
              <h3 className="section-label">💰 Trip Bets</h3>
              <p className="bet-winner">{tripWinner.name} wins ${tripPot.toFixed(0)} total</p>
            </div>
          )}

          <div className={`final-report-card ${!loading ? "revealed" : ""}`}>
            {loading ? (
              <div className="loading-roast">
                <div className="loading-dots"><span style={{ background: "#16a34a" }} /><span style={{ background: "#16a34a" }} /><span style={{ background: "#16a34a" }} /></div>
                <p className="loading-text">Compiling the carnage...</p>
              </div>
            ) : <p className="report-text">{report}</p>}
          </div>

          {!loading && (
            <>
              <button className="btn-share" onClick={handleShareReport}>📤 Share Full Report</button>
              {shareMsg && <p className="share-msg">{shareMsg}</p>}
              <div className="email-section">
                <h3 className="section-label">📧 Email the Full Report</h3>
                <p className="email-hint">All 18 hole roasts + scores. Opens your mail app.</p>
                <div className="email-row">
                  <input className="email-input" type="email" placeholder="email@example.com" value={email} onChange={e => setEmail(e.target.value)} />
                  <button className={`btn-email ${!email.trim() ? "disabled" : ""}`} onClick={handleEmail} disabled={!email.trim()}>Send</button>
                </div>
                {emailStatus && <p className="email-status">{emailStatus}</p>}
              </div>
              {roastLog.length > 0 && (
                <div className="roast-log">
                  <h3 className="section-label">📋 All Hole Roasts</h3>
                  {roastLog.map((r, idx) => {
                    const int = getIntensity(r.hole);
                    return (
                      <div key={idx} className="log-entry">
                        <div className="log-header">
                          <span className="log-hole" style={{ color: int.color }}>Hole {r.hole}{r.round > 1 ? ` R${r.round}` : ""}</span>
                          <span className="log-player">{r.player}</span>
                          <span>{int.emoji}</span>
                        </div>
                        <p className="log-roast">{r.roast}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === "card" && (
        <div className="card-tab">
          <NineteenthHoleCard tripName={tripName} players={players} allScores={allScores} roastLog={roastLog} totalRounds={totalRounds} />
          <button className="btn-share" style={{ marginTop: "16px" }} onClick={async () => {
            const text = `⛳ ${tripName} · ${totalRounds} Round${totalRounds > 1 ? "s" : ""}\n\nScores: ${totals.map(p => `${p.name}: ${p.total}`).join(" | ")}\n\n🏌️‍♂️ Golf Roast Machine`;
            try {
              if (navigator.share) await navigator.share({ text });
              else { await navigator.clipboard.writeText(text); }
            } catch {}
          }}>📤 Share Trip Card</button>
        </div>
      )}

      {tab === "trophy" && (
        <div className="trophy-tab">
          <button className="btn-secondary" style={{ marginBottom: "16px" }} onClick={() => onSaveToTrophy(tripName, totals, roastLog)}>
            💾 Save This Trip to Trophy Room
          </button>
          {trophyRooms.length === 0 ? (
            <div className="trophy-empty">
              <p>No saved trips yet.</p>
              <p>Save this trip to start your Trophy Room.</p>
            </div>
          ) : (
            trophyRooms.map((trip, i) => (
              <div key={i} className="trophy-entry">
                <div className="trophy-trip-name">{trip.name}</div>
                <div className="trophy-trip-meta">{trip.date} · {trip.players.length} players</div>
                <div className="trophy-scores">
                  {trip.players.slice(0, 3).map((p, j) => (
                    <span key={j} className="trophy-score-pill">{j === 0 ? "🏅" : j === trip.players.length - 1 ? "💀" : ""}{p.name}: {p.total}</span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <button className="btn-primary restart-btn" onClick={onRestart} style={{ marginTop: "20px" }}>↩ NEW TRIP</button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  // Check for spectator mode
  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const spectateId = urlParams.get("spectate");
  const joinCode = urlParams.get("join");
  if (spectateId) return <SpectatorView sessionId={spectateId} />;
  if (joinCode) return <JoinScreen prefillCode={joinCode} />;

  const [screen, setScreen] = useState("loading");
  const [resumeSession, setResumeSession] = useState(null);
  const [players, setPlayers] = useState([]);
  const [tripName, setTripName] = useState("");
  const [totalRounds, setTotalRounds] = useState(1);
  const [totalHoles, setTotalHoles] = useState(18);
  const [betAmount, setBetAmount] = useState(0);
  const [currentRound, setCurrentRound] = useState(1);
  const [hole, setHole] = useState(1);
  const [allScores, setAllScores] = useState([]);
  const [roundScores, setRoundScores] = useState([]);
  const [currentHoleData, setCurrentHoleData] = useState(null);
  const [roastLog, setRoastLog] = useState([]);
  const [trophyRooms, setTrophyRooms] = useState([]);
  const [showTrashTalk, setShowTrashTalk] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [courseInfo, setCourseInfo] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [spectatorLink, setSpectatorLink] = useState("");
  const [showSpectatorModal, setShowSpectatorModal] = useState(false);
  const [propBets, setPropBets] = useState([]);
  const [roomId, setRoomId] = useState(null);
  const [isMultiplayer, setIsMultiplayer] = useState(false);
  const [pendingNominations, setPendingNominations] = useState([]);
  const myName = players[0]?.name || "Host";

  // ── Check for resumable session on mount ──
  useEffect(() => {
    const check = async () => {
      const savedId = loadSessionId();
      if (savedId) {
        const session = await loadGameSession(savedId);
        if (session && session.is_active && session.current_hole <= 18) {
          setResumeSession(session);
          setScreen("resume");
          return;
        }
      }
      setScreen("setup");
    };
    check();
  }, []);

  // ── Auto-save state after every hole ──
  const saveState = useCallback(async (patch = {}) => {
    if (!sessionId) return;
    await updateGameSession(sessionId, {
      current_hole: hole,
      current_round: currentRound,
      all_scores: allScores,
      round_scores: roundScores,
      roast_log: roastLog,
      course_info: courseInfo,
      prop_bets: propBets,
      ...patch,
    });
  }, [sessionId, hole, currentRound, allScores, roundScores, roastLog, courseInfo, propBets]);

  // Poll room nominations in multiplayer mode
  useEffect(() => {
    if (!isMultiplayer || !roomId || screen !== "hole") return;
    const poll = async () => {
      const r = await getRoom(roomId);
      if (r) setPendingNominations(r.hole_nominations || []);
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [isMultiplayer, roomId, screen]);

  const handleStart = async (p, name, rounds, bet, mode, holes = 18) => {
    setPlayers(p); setTripName(name); setTotalRounds(rounds); setBetAmount(bet); setTotalHoles(holes);
    setCurrentRound(1); setHole(1); setAllScores([]); setRoundScores([]); setRoastLog([]);
    setIsMultiplayer(mode === "multi");
    if (mode === "multi") { setScreen("mp_lobby"); return; }
    const sid = genId();
    setSessionId(sid);
    saveSessionId(sid);
    const link = `${window.location.origin}${window.location.pathname}?spectate=${sid}`;
    setSpectatorLink(link);
    await createSession(sid, name, p);
    await createGameSession({ sessionId: sid, tripName: name, players: p, totalRounds: rounds,
      betAmount: bet, currentRound: 1, hole: 1, allScores: [], roundScores: [], roastLog: [],
      courseInfo: null, propBets: null, isMultiplayer: false, roomId: null, total_holes: holes });
    setScreen("course");
  };

  const handleResume = (session) => {
    setPlayers(session.players || []);
    setTripName(session.trip_name || "");
    setTotalRounds(session.total_rounds || 1);
    setBetAmount(session.bet_amount || 0);
    setCurrentRound(session.current_round || 1);
    setHole(session.current_hole || 1);
    setAllScores(session.all_scores || []);
    setRoundScores(session.round_scores || []);
    setRoastLog(session.roast_log || []);
    setCourseInfo(session.course_info || null);
    setPropBets(session.prop_bets || null);
    setTotalHoles(session.total_holes || 18);
    setSessionId(session.id);
    setResumeSession(null);
    setScreen("hole");
  };

  const handleCourseDone = (info) => { setCourseInfo(info); setScreen("props"); };
  const handleCourseSkip = () => { setCourseInfo(null); setScreen("props"); };

  const handleRoomReady = async (rid) => {
    setRoomId(rid);
    // Also set spectator-style link for the room
    const link = `${window.location.origin}${window.location.pathname}?join=${rid}`;
    setSpectatorLink(link);
    setScreen("props");
  };

  const handlePropsDone = (bets, winners) => { setPropBets({ bets, winners }); setScreen("hole"); };

  const handleHoleSubmit = (scores, worstPlayer, worstShot, photo, photoPreview) => {
    setCurrentHoleData({ scores, worstPlayer, worstShot, photo, photoPreview });
    setScreen("roast");
  };

  const handleSaveRoast = async (holeNum, player, roastText) => {
    const entry = { hole: holeNum, round: currentRound, player, roast: roastText };
    const newLog = [...roastLog, entry];
    setRoastLog(newLog);
    if (sessionId) {
      await updateSession(sessionId, {
        current_hole: holeNum, current_round: currentRound,
        roast_log: newLog, latest_roast: entry, all_scores: allScores,
      });
      await updateGameSession(sessionId, { roast_log: newLog, current_hole: holeNum });
    }
    if (isMultiplayer && roomId) {
      await updateRoom(roomId, {
        current_hole: holeNum, current_round: currentRound,
        roast_log: newLog, latest_roast: entry, all_scores: allScores,
        hole_submissions: {}, hole_nominations: [],
      });
    }
  };

  const handleNext = () => {
    const newScores = [...allScores, { hole, round: currentRound, scores: currentHoleData.scores }];
    const newRoundScores = [...roundScores, { hole, scores: currentHoleData.scores }];
    setAllScores(newScores);
    setRoundScores(newRoundScores);
    setHole(hole + 1);
    setScreen("hole");
    if (sessionId) {
      updateSession(sessionId, { all_scores: newScores, current_hole: hole + 1 });
      updateGameSession(sessionId, { all_scores: newScores, round_scores: newRoundScores, current_hole: hole + 1 });
    }
  };

  const handleEndRound = () => {
    const newScores = [...allScores, { hole, round: currentRound, scores: currentHoleData.scores }];
    const newRoundScores = [...roundScores, { hole, scores: currentHoleData.scores }];
    setAllScores(newScores);
    setRoundScores(newRoundScores);
    if (sessionId) updateGameSession(sessionId, { all_scores: newScores, round_scores: newRoundScores });
    setScreen("roundsummary");
  };

  const handleNextRound = () => {
    setCurrentRound(currentRound + 1);
    setHole(1);
    setRoundScores([]);
    if (sessionId) updateGameSession(sessionId, { current_round: currentRound + 1, current_hole: 1, round_scores: [] });
    setScreen("course");
  };

  const handleFinal = () => {
    const newScores = [...allScores, { hole, round: currentRound, scores: currentHoleData.scores }];
    setAllScores(newScores);
    setScreen("final");
    if (sessionId) {
      updateSession(sessionId, { all_scores: newScores, is_active: false });
      updateGameSession(sessionId, { all_scores: newScores, is_active: false });
    }
    clearSessionId();
  };

  const handleSaveToTrophy = (name, totalsArr, log) => {
    setTrophyRooms(prev => [...prev, {
      name, date: new Date().toLocaleDateString(), players: totalsArr, roastCount: log.length
    }]);
  };

  const handleRestart = () => {
    clearSessionId();
    setScreen("setup"); setHole(1); setCurrentRound(1);
    setAllScores([]); setRoundScores([]); setCurrentHoleData(null); setRoastLog([]);
    setSessionId(null); setSpectatorLink(""); setCourseInfo(null); setPropBets([]);
    setResumeSession(null);
  };

  const isLastHole = hole === totalHoles;
  const isLastRound = currentRound === totalRounds;
  const activeSession = sessionId || roomId;
  const showFABs = ["hole","roast","roundsummary"].includes(screen);

  return (
    <div className="app">
      <style>{CSS}</style>

      {/* Spectator link banner */}
      {spectatorLink && screen !== "setup" && screen !== "final" && screen !== "mp_lobby" && screen !== "course" && (
        <div className="spec-banner" onClick={() => setShowSpectatorModal(true)}>
          {isMultiplayer ? `👥 ROOM ${roomId} · Tap to share join link` : "🔴 SHANKED · LIVE · Tap to share spectator link"}
        </div>
      )}

      {/* Floating Action Buttons */}
      {showFABs && (
        <>
          <button className="trash-talk-fab" onClick={() => setShowTrashTalk(true)}>🔥</button>
          {activeSession && <button className="chat-fab" onClick={() => setShowChat(true)}>💬</button>}
          <button className="stats-fab" onClick={() => setShowStats(true)}>📊</button>
        </>
      )}

      {/* Modals */}
      {showTrashTalk && <TrashTalkModal players={players} onClose={() => setShowTrashTalk(false)} />}
      {showChat && activeSession && (
        <GroupChatModal sessionId={activeSession} myName={myName} onClose={() => setShowChat(false)} />
      )}
      {showStats && (
        <StatsPanel players={players} allScores={allScores} roastLog={roastLog}
          courseInfo={courseInfo} onClose={() => setShowStats(false)} />
      )}

      {showSpectatorModal && (
        <div className="modal-overlay" onClick={() => setShowSpectatorModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">🔴 Spectator Link</h3>
              <button className="modal-close" onClick={() => setShowSpectatorModal(false)}>✕</button>
            </div>
            <p className="spec-modal-text">Share this link with anyone watching from home. They'll see live scores and roasts.</p>
            <div className="spec-link-box">{spectatorLink}</div>
            <button className="btn-primary" style={{ marginTop: "12px" }} onClick={async () => {
              try {
                if (navigator.share) await navigator.share({ url: spectatorLink, title: `${tripName} — Live Golf Roasts` });
                else { await navigator.clipboard.writeText(spectatorLink); alert("Copied!"); }
              } catch {}
            }}>📤 Share Link</button>
          </div>
        </div>
      )}

      {screen === "loading" && (
        <div className="spec-loading">
          <div className="loading-dots"><span style={{background:"#16a34a"}}/><span style={{background:"#16a34a"}}/><span style={{background:"#16a34a"}}/></div>
          <p style={{color:"#555",fontSize:"13px",marginTop:"12px"}}>Loading...</p>
        </div>
      )}
      {screen === "resume" && resumeSession && (
        <ResumeScreen session={resumeSession} onResume={() => handleResume(resumeSession)} onNew={handleRestart} />
      )}
      {screen === "setup" && <SetupScreen onStart={handleStart} />}
      {screen === "course" && <CourseSetupScreen onDone={handleCourseDone} onSkip={handleCourseSkip} />}
      {screen === "mp_lobby" && (
        <MultiplayerLobby tripName={tripName} players={players} totalRounds={totalRounds}
          betAmount={betAmount} onRoomReady={handleRoomReady} />
      )}
      {screen === "props" && <PropBetsScreenV2 players={players} onDone={handlePropsDone} />}
      {screen === "hole" && (
        <HoleScreen players={players} hole={hole} round={currentRound} totalRounds={totalRounds}
          betAmount={betAmount} onSubmit={handleHoleSubmit} courseInfo={courseInfo}
          pendingNominations={isMultiplayer ? pendingNominations : []} roomId={roomId} isMultiplayer={isMultiplayer} />
      )}
      {screen === "roast" && currentHoleData && (
        <RoastScreen players={players} hole={hole} round={currentRound}
          holeScores={currentHoleData.scores} worstPlayer={currentHoleData.worstPlayer}
          worstShot={currentHoleData.worstShot} photo={currentHoleData.photo}
          photoPreview={currentHoleData.photoPreview} courseInfo={courseInfo}
          onNext={handleNext} onEndRound={handleEndRound} onFinal={handleFinal}
          onSaveRoast={handleSaveRoast}
          isLastHole={isLastHole} isLastRound={isLastRound} />
      )}
      {screen === "roundsummary" && (
        <RoundSummaryScreen players={players} round={currentRound} roundScores={roundScores}
          betAmount={betAmount} cumulativeScores={allScores} onNextRound={handleNextRound} />
      )}
      {screen === "final" && (
        <FinalScreen players={players} allScores={allScores} roastLog={roastLog}
          tripName={tripName} totalRounds={totalRounds} betAmount={betAmount}
          courseInfo={courseInfo} propBets={propBets}
          trophyRooms={trophyRooms} onSaveToTrophy={handleSaveToTrophy} onRestart={handleRestart} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MULTIPLAYER SUPABASE HELPERS
// ════════════════════════════════════════════════════════════════════════════
async function createRoom(roomId, tripName, players, totalRounds, betAmount) {
  return supaFetch("/multiplayer_rooms", "POST", {
    id: roomId, trip_name: tripName, players,
    total_rounds: totalRounds, bet_amount: betAmount,
    current_round: 1, current_hole: 1,
    all_scores: [], roast_log: [], hole_submissions: {}, hole_nominations: [],
    latest_roast: null, phase: "lobby", is_active: true,
  });
}

async function getRoom(roomId) {
  const rows = await supaFetch(`/multiplayer_rooms?id=eq.${roomId}&limit=1`);
  return rows?.[0] || null;
}

async function updateRoom(roomId, patch) {
  return supaFetch(`/multiplayer_rooms?id=eq.${roomId}`, "PATCH", { ...patch, updated_at: new Date().toISOString() });
}

// ════════════════════════════════════════════════════════════════════════════
// MULTIPLAYER — HOST LOBBY (creates room, shares code)
// ════════════════════════════════════════════════════════════════════════════
function MultiplayerLobby({ tripName, players, totalRounds, betAmount, onRoomReady }) {
  const [roomId] = useState(() => genId().slice(0, 4));
  const [joined, setJoined] = useState([]);
  const [creating, setCreating] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const setup = async () => {
      const res = await createRoom(roomId, tripName, players, totalRounds, betAmount);
      if (!res) { setError("Failed to create room. Check connection."); }
      setCreating(false);
    };
    setup();
  }, []);

  // Poll for joined players
  useEffect(() => {
    const poll = async () => {
      const room = await getRoom(roomId);
      if (room) setJoined(room.players || []);
    };
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [roomId]);

  const joinLink = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}?join=${roomId}` : "";

  const shareCode = async () => {
    try {
      if (navigator.share) await navigator.share({ text: `Join my Shanked round! Code: ${roomId}\n${joinLink}`, title: "Join Shanked" });
      else { await navigator.clipboard.writeText(joinLink); alert("Link copied!"); }
    } catch {}
  };

  return (
    <div className="screen mp-lobby-screen">
      <div className="mp-header">
        <h2 className="mp-title">YOUR ROOM</h2>
        <div className="room-code">{roomId}</div>
        <p className="room-sub">Share this code with your crew</p>
      </div>

      {creating ? (
        <div className="loading-roast" style={{ margin: "20px 0" }}>
          <div className="loading-dots"><span style={{ background: "#16a34a" }} /><span style={{ background: "#16a34a" }} /><span style={{ background: "#16a34a" }} /></div>
          <p className="loading-text">Setting up room...</p>
        </div>
      ) : error ? (
        <p style={{ color: "#f87171", fontSize: "14px", textAlign: "center" }}>{error}</p>
      ) : (
        <>
          <button className="btn-share" onClick={shareCode}>📤 Share Room Link</button>

          <div className="mp-players-card">
            <h3 className="section-label">Players ({players.length} expected)</h3>
            {players.map((p, i) => (
              <div key={i} className="mp-player-row">
                <span className="mp-player-name">{p.name}</span>
                <span className="mp-player-status">{i === 0 ? "👑 Host" : "⏳ Waiting"}</span>
              </div>
            ))}
          </div>

          <p className="mp-hint">Players join at <strong>shanked.vercel.app</strong> → "Join a Room" → enter code <strong>{roomId}</strong></p>

          <button className="btn-primary" onClick={() => onRoomReady(roomId)} style={{ marginTop: "16px" }}>
            START ROUND →
          </button>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MULTIPLAYER — JOIN SCREEN (non-host players)
// ════════════════════════════════════════════════════════════════════════════
function JoinScreen({ prefillCode }) {
  const [code, setCode] = useState(prefillCode || "");
  const [playerName, setPlayerName] = useState("");
  const [room, setRoom] = useState(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");
  const [myIndex, setMyIndex] = useState(null);

  const handleJoin = async () => {
    if (!code.trim() || !playerName.trim()) return;
    setJoining(true); setError("");
    const r = await getRoom(code.toUpperCase());
    if (!r) { setError("Room not found. Check the code."); setJoining(false); return; }
    setRoom(r);
    const idx = r.players.findIndex(p => p.name.toLowerCase() === playerName.trim().toLowerCase());
    if (idx === -1) { setError("Name not found. Make sure it matches exactly."); setJoining(false); return; }
    setMyIndex(idx);
    setJoined(true);
    setJoining(false);
  };

  if (joined && room) {
    return <MultiplayerPlayerView roomId={code.toUpperCase()} playerName={playerName} myIndex={myIndex} />;
  }

  return (
    <div className="screen join-screen">
      <div className="setup-header">
        <div className="shanked-logo">
          <svg viewBox="-40 0 400 110" xmlns="http://www.w3.org/2000/svg" className="shanked-svg">
            <defs>
              <linearGradient id="redGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#16a34a"/><stop offset="100%" stopColor="#166534"/>
              </linearGradient>
              <filter id="glow2">
                <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <path d="M 30 80 Q 80 20 260 65" stroke="#333" strokeWidth="1.5" fill="none" strokeDasharray="4,4"/>
            <path d="M 30 80 Q 60 75 100 85 Q 140 95 290 30" stroke="url(#redGrad2)" strokeWidth="2.5" fill="none" filter="url(#glow2)"/>
            <circle cx="30" cy="80" r="7" fill="#f0ece4" /><circle cx="30" cy="80" r="5" fill="#e8e0d5" />
            <circle cx="290" cy="30" r="5" fill="#16a34a" filter="url(#glow2)"/>
            <text x="160" y="72" textAnchor="middle" fontFamily="'Russo One', sans-serif" fontSize="68" fontWeight="900" letterSpacing="4" fill="url(#redGrad2)" filter="url(#glow2)">SHANKED</text>
            <line x1="40" y1="82" x2="280" y2="82" stroke="#16a34a" strokeWidth="1.5" opacity="0.4"/>
          </svg>
          <p className="shanked-tagline">AI-powered golf trip roast machine</p>
        </div>
      </div>

      <div className="join-card">
        <h3 className="section-label">Join a Room</h3>
        <input className="input-name" placeholder="Room code (e.g. A3X9)" value={code}
          onChange={e => setCode(e.target.value.toUpperCase())} style={{ marginBottom: "10px", letterSpacing: "4px", fontSize: "18px", textAlign: "center" }} />
        <input className="input-name" placeholder="Your name (must match host's list)" value={playerName}
          onChange={e => setPlayerName(e.target.value)} style={{ marginBottom: "14px" }} />
        {error && <p className="join-error">{error}</p>}
        <button className={`btn-primary ${(!code.trim() || !playerName.trim()) ? "disabled" : ""}`}
          onClick={handleJoin} disabled={joining || !code.trim() || !playerName.trim()}>
          {joining ? "Joining..." : "JOIN ROOM →"}
        </button>
      </div>

      <div className="join-divider"><span>or</span></div>

      <button className="btn-secondary" onClick={() => window.location.href = window.location.pathname}>
        🏠 Create New Trip (Host)
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MULTIPLAYER — PLAYER VIEW (non-host in-round experience)
// ════════════════════════════════════════════════════════════════════════════
function MultiplayerPlayerView({ roomId, playerName, myIndex }) {
  const [room, setRoom] = useState(null);
  const [myScore, setMyScore] = useState("");
  const [nomination, setNomination] = useState("");
  const [nominatedPlayer, setNominatedPlayer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [nominated, setNominated] = useState(false);
  const [lastHole, setLastHole] = useState(null);
  const [flash, setFlash] = useState(false);

  const poll = useCallback(async () => {
    const r = await getRoom(roomId);
    if (!r) return;
    if (r.current_hole !== lastHole) {
      setSubmitted(false); setNominated(false);
      setMyScore(""); setNomination(""); setNominatedPlayer("");
      setLastHole(r.current_hole);
      if (lastHole !== null) { setFlash(true); setTimeout(() => setFlash(false), 1500); }
    }
    setRoom(r);
  }, [roomId, lastHole]);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [poll]);

  const submitScore = async () => {
    if (!myScore || !room) return;
    const existing = room.hole_submissions || {};
    const updated = { ...existing, [playerName]: parseInt(myScore) };
    await updateRoom(roomId, { hole_submissions: updated });
    setSubmitted(true);
  };

  const submitNomination = async () => {
    if (!nominatedPlayer || !room) return;
    const existing = room.hole_nominations || [];
    const updated = [...existing, { from: playerName, player: nominatedPlayer, shot: nomination, hole: room.current_hole }];
    await updateRoom(roomId, { hole_nominations: updated });
    setNominated(true);
  };

  if (!room) return (
    <div className="spec-loading">
      <div className="loading-dots"><span style={{ background: "#16a34a" }} /><span style={{ background: "#16a34a" }} /><span style={{ background: "#16a34a" }} /></div>
      <p>Connecting to room {roomId}...</p>
    </div>
  );

  const intensity = getIntensity(room.current_hole || 1);
  const latestRoast = room.roast_log?.[room.roast_log.length - 1];
  const submittedCount = Object.keys(room.hole_submissions || {}).length;
  const totalPlayers = room.players?.length || 0;

  return (
    <div className="app">
      <div className="spec-banner" style={{ cursor: "default" }}>
        ⛳ ROOM {roomId} · Round {room.current_round} · Hole {room.current_hole}
      </div>
      <div className="screen mp-player-screen">
        {/* Latest roast */}
        {latestRoast && (
          <div className={`spec-card mp-roast-flash ${flash ? "flash" : ""}`} style={{ borderColor: getIntensity(latestRoast.hole).color, marginBottom: "16px" }}>
            <div className="spec-roast-label" style={{ color: getIntensity(latestRoast.hole).color }}>
              {getIntensity(latestRoast.hole).emoji} Hole {latestRoast.hole} — {latestRoast.player} got roasted
            </div>
            <p className="spec-roast-text">"{latestRoast.roast}"</p>
          </div>
        )}

        {/* Score submission */}
        <div className="mp-action-card">
          <h3 className="section-label">Hole {room.current_hole} — Your Score</h3>
          {submitted ? (
            <div className="mp-submitted">✅ Score submitted! ({myScore} strokes)</div>
          ) : (
            <>
              <div className="score-buttons" style={{ marginBottom: "12px", flexWrap: "wrap", display: "flex", gap: "6px" }}>
                {[1,2,3,4,5,6,7,8,9].map(n => (
                  <button key={n} className={`score-btn ${myScore == n ? "active" : ""}`}
                    style={myScore == n ? { background: intensity.color } : {}}
                    onClick={() => setMyScore(n)}>{n}</button>
                ))}
              </div>
              <button className={`btn-primary ${!myScore ? "disabled" : ""}`}
                style={myScore ? { background: intensity.color } : {}}
                onClick={submitScore} disabled={!myScore}>
                SUBMIT SCORE
              </button>
            </>
          )}
          <p className="mp-waiting">{submittedCount}/{totalPlayers} players submitted</p>
        </div>

        {/* Nomination */}
        <div className="mp-action-card">
          <h3 className="section-label">🔥 Nominate for Roast</h3>
          {nominated ? (
            <div className="mp-submitted">✅ Nomination submitted!</div>
          ) : (
            <>
              <select className="roast-select" value={nominatedPlayer} onChange={e => setNominatedPlayer(e.target.value)} style={{ marginBottom: "10px" }}>
                <option value="">Pick who deserves it...</option>
                {room.players?.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              <textarea className="shot-input" placeholder="What did they do? Describe the shot..." value={nomination}
                onChange={e => setNomination(e.target.value)} rows={2} style={{ marginBottom: "10px" }} />
              <button className={`btn-secondary ${!nominatedPlayer ? "disabled" : ""}`}
                onClick={submitNomination} disabled={!nominatedPlayer}>
                NOMINATE →
              </button>
            </>
          )}
        </div>

        {/* Live leaderboard */}
        <div className="spec-card">
          <h3 className="section-label">📊 Trip Leaderboard</h3>
          {room.players?.map((p, i) => {
            const total = (room.all_scores || []).reduce((s, h) => s + (parseInt(h.scores?.[p.name]) || 0), 0);
            return (
              <div key={p.name} className="spec-score-row" style={p.name === playerName ? { background: "#0a1a0a", borderRadius: "6px", padding: "6px 4px" } : {}}>
                <span className="spec-rank">{i === 0 ? "🏅" : `${i+1}.`}</span>
                <span className="spec-pname">{p.name}{p.name === playerName ? " (you)" : ""}</span>
                <span className="spec-ptotal">{total || "—"}</span>
              </div>
            );
          })}
        </div>
        <p className="spec-refresh-note">Auto-refreshes every 4 seconds</p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CHAT HELPERS
// ════════════════════════════════════════════════════════════════════════════
const CHAT_EMOJIS = ["😂","🔥","💀","👏","😬","🤣","⛳","🏌️"];

async function sendChatMessage(sessionId, sender, message) {
  return supaFetch("/chat_messages", "POST", { session_id: sessionId, sender, message, reactions: {} });
}

async function getChatMessages(sessionId) {
  const rows = await supaFetch(`/chat_messages?session_id=eq.${sessionId}&order=created_at.asc&limit=100`);
  return rows || [];
}

async function addReaction(msgId, emoji) {
  // Get current reactions first
  const rows = await supaFetch(`/chat_messages?id=eq.${msgId}&limit=1`);
  if (!rows?.[0]) return;
  const reactions = rows[0].reactions || {};
  reactions[emoji] = (reactions[emoji] || 0) + 1;
  return supaFetch(`/chat_messages?id=eq.${msgId}`, "PATCH", { reactions });
}

// ════════════════════════════════════════════════════════════════════════════
// GROUP CHAT MODAL
// ════════════════════════════════════════════════════════════════════════════
function GroupChatModal({ sessionId, myName, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef();

  const poll = useCallback(async () => {
    const msgs = await getChatMessages(sessionId);
    setMessages(msgs);
  }, [sessionId]);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [poll]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    await sendChatMessage(sessionId, myName, input.trim());
    setInput("");
    await poll();
    setSending(false);
  };

  const handleReaction = async (msgId, emoji) => {
    await addReaction(msgId, emoji);
    await poll();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal chat-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">💬 GROUP CHAT</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="chat-messages">
          {messages.length === 0 && <p className="chat-empty">No messages yet. Say something.</p>}
          {messages.map((msg) => {
            const isMe = msg.sender === myName;
            return (
              <div key={msg.id} className={`chat-msg ${isMe ? "mine" : "theirs"}`}>
                {!isMe && <div className="chat-sender">{msg.sender}</div>}
                <div className={`chat-bubble ${isMe ? "bubble-mine" : "bubble-theirs"}`}>
                  {msg.message}
                </div>
                <div className="chat-reactions-row">
                  {Object.entries(msg.reactions || {}).map(([emoji, count]) => (
                    count > 0 && (
                      <button key={emoji} className="reaction-pill" onClick={() => handleReaction(msg.id, emoji)}>
                        {emoji} {count}
                      </button>
                    )
                  ))}
                  <div className="reaction-adder">
                    {CHAT_EMOJIS.map(e => (
                      <button key={e} className="reaction-add-btn" onClick={() => handleReaction(msg.id, e)}>{e}</button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input-row">
          <input className="chat-input" placeholder="Message the group..." value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSend()} />
          <button className="chat-send-btn" onClick={handleSend} disabled={sending || !input.trim()}>
            {sending ? "..." : "↑"}
          </button>
        </div>
        <p className="chat-note">Auto-refreshes every 3 seconds</p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// COURSE SETUP SCREEN
// ════════════════════════════════════════════════════════════════════════════
function CourseSetupScreen({ onDone, onSkip }) {
  const [courseName, setCourseName] = useState("");
  const [pars, setPars] = useState(Array(18).fill(4));
  const [numHoles, setNumHoles] = useState(18);
  const [loading, setLoading] = useState(false);

  const updatePar = (hole, val) => {
    const p = [...pars];
    p[hole] = parseInt(val) || 4;
    setPars(p);
  };

  const autoFill = async () => {
    if (!courseName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 300,
          messages: [{ role: "user", content: `What are the pars for each of the 18 holes at ${courseName}? Return ONLY a JSON array of 18 integers like [4,3,5,...]. No other text.` }]
        }),
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      const match = text.match(/\[[\d,\s]+\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.length === 18) setPars(parsed);
      }
    } catch {}
    setLoading(false);
  };

  const totalPar = pars.reduce((a, b) => a + b, 0);

  return (
    <div className="screen course-screen">
      <div className="course-header">
        <h2 className="course-title">⛳ COURSE SETUP</h2>
        <p className="course-sub">Enter course details for smarter roasts and +/- par scoring</p>
      </div>

      <div className="course-name-row">
        <input className="input-name" placeholder="Course name (e.g. Pebble Beach)" value={courseName}
          onChange={e => setCourseName(e.target.value)} style={{ marginBottom: "10px" }} />
        <button className={`btn-secondary ${!courseName.trim() || loading ? "disabled" : ""}`}
          onClick={autoFill} disabled={!courseName.trim() || loading}>
          {loading ? "Looking up..." : "🔍 Auto-fill Pars"}
        </button>
      </div>

      <div className="par-grid">
        <div className="par-grid-header">
          <h3 className="section-label">Par Per Hole</h3>
          <span className="total-par">Total Par: {totalPar}</span>
        </div>
        <div className="par-holes">
          {pars.map((par, i) => (
            <div key={i} className="par-hole">
              <span className="par-hole-num">{i + 1}</span>
              <div className="par-btns">
                {[3, 4, 5].map(n => (
                  <button key={n} className={`par-btn ${par === n ? "active" : ""}`}
                    onClick={() => updatePar(i, n)}>{n}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <button className="btn-primary" style={{ marginTop: "16px" }}
        onClick={() => onDone({ name: courseName, pars, totalPar })}>
        SET COURSE →
      </button>
      <button className="btn-secondary" style={{ marginTop: "8px" }} onClick={onSkip}>
        Skip — No Course Info
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// IMPROVED PROP BETS SCREEN
// ════════════════════════════════════════════════════════════════════════════
function PropBetsScreenV2({ players, onDone }) {
  const [bets, setBets] = useState([]);
  const [customBet, setCustomBet] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [winners, setWinners] = useState({});

  const generateAI = async () => {
    setGenerating(true);
    const names = players.map(p => p.name).join(", ");
    const traits = players.map(p => `${p.name}: ${p.traits || "unknown"}`).join("; ");
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 400,
          messages: [{ role: "user", content: `Generate 5 funny prop bets for a casual golf round. Players: ${names}. Traits: ${traits}. Make them specific to the players. Return ONLY a JSON array of strings like ["bet1","bet2",...]. No other text.` }]
        }),
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "[]";
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        setBets(prev => [...prev, ...parsed.map(b => ({ text: b, custom: false }))]);
      }
    } catch {}
    setGenerating(false);
    setGenerated(true);
  };

  const addCustom = () => {
    if (!customBet.trim()) return;
    setBets(prev => [...prev, { text: customBet.trim(), custom: true }]);
    setCustomBet("");
  };

  const removeBet = (i) => setBets(prev => prev.filter((_, idx) => idx !== i));

  const setWinner = (betIdx, player) => {
    setWinners(prev => ({ ...prev, [betIdx]: prev[betIdx] === player ? null : player }));
  };

  return (
    <div className="screen prop-screen">
      <div className="prop-header">
        <h2 className="prop-title">🎯 PROP BETS</h2>
        <p className="prop-sub">Set your bets before the round. Track who wins each one.</p>
      </div>

      {/* AI Generate */}
      <button className="btn-secondary" onClick={generateAI} disabled={generating} style={{ marginBottom: "12px" }}>
        {generating ? "Generating..." : "🤖 Generate AI Bets"}
      </button>

      {/* Custom bet input */}
      <div className="custom-bet-row">
        <input className="input-name" placeholder='Add your own (e.g. "First to say a swear word")'
          value={customBet} onChange={e => setCustomBet(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addCustom()} />
        <button className="btn-add-bet" onClick={addCustom} disabled={!customBet.trim()}>+ Add</button>
      </div>

      {/* Bets list */}
      {bets.length > 0 && (
        <div className="bets-list">
          {bets.map((bet, i) => (
            <div key={i} className="bet-card-v2">
              <div className="bet-top">
                <p className="bet-text-v2">{bet.text}</p>
                <button className="bet-remove" onClick={() => removeBet(i)}>✕</button>
              </div>
              <div className="bet-winners">
                <span className="bet-winner-label">Winner:</span>
                <div className="bet-winner-btns">
                  <button className={`bet-winner-btn ${winners[i] === "TBD" ? "active-tbd" : ""}`}
                    onClick={() => setWinner(i, "TBD")}>TBD</button>
                  {players.map(p => (
                    <button key={p.name} className={`bet-winner-btn ${winners[i] === p.name ? "active-won" : ""}`}
                      onClick={() => setWinner(i, p.name)}>{p.name}</button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {bets.length === 0 && generated && (
        <p style={{ color: "#555", fontSize: "13px", textAlign: "center", padding: "20px 0" }}>
          No bets generated. Add your own above.
        </p>
      )}

      <button className="btn-primary" style={{ marginTop: "16px" }}
        onClick={() => onDone(bets, winners)}>
        {bets.length > 0 ? `LOCK IN ${bets.length} BET${bets.length > 1 ? "S" : ""} →` : "SKIP BETS →"}
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LIVE STATS PANEL
// ════════════════════════════════════════════════════════════════════════════
function StatsPanel({ players, allScores, roastLog, courseInfo, onClose }) {
  const totals = players.map(p => {
    const scores = allScores.map(h => parseInt(h.scores?.[p.name]) || 0);
    const total = scores.reduce((a, b) => a + b, 0);
    const holesPlayed = scores.filter(s => s > 0).length;
    const pars = courseInfo?.pars || Array(18).fill(4);
    const parTotal = pars.slice(0, holesPlayed).reduce((a, b) => a + b, 0);
    const vspar = total - parTotal;
    const roastCount = roastLog.filter(r => r.player === p.name).length;
    const best = scores.filter(s => s > 0).reduce((a, b) => Math.min(a, b), 99);
    const worst = scores.filter(s => s > 0).reduce((a, b) => Math.max(a, b), 0);
    return { name: p.name, total, holesPlayed, vspar, roastCount, best, worst };
  }).sort((a, b) => a.total - b.total);

  const mostRoasted = [...totals].sort((a, b) => b.roastCount - a.roastCount)[0];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal stats-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">📊 LIVE STATS</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {courseInfo?.name && (
          <div className="stats-course-badge">
            ⛳ {courseInfo.name} · Par {courseInfo.totalPar}
          </div>
        )}

        <div className="stats-grid">
          {totals.map((p, i) => (
            <div key={p.name} className={`stats-card ${i === 0 ? "stats-leading" : ""}`}>
              <div className="stats-card-header">
                <span className="stats-rank">{i === 0 ? "🏅" : i === totals.length - 1 ? "💀" : `#${i + 1}`}</span>
                <span className="stats-name">{p.name}</span>
                <span className="stats-total">{p.total || "—"}</span>
              </div>
              {p.holesPlayed > 0 && (
                <div className="stats-details">
                  {courseInfo?.pars && (
                    <div className="stats-detail">
                      <span>vs Par</span>
                      <span className={p.vspar > 0 ? "stat-over" : p.vspar < 0 ? "stat-under" : "stat-even"}>
                        {p.vspar > 0 ? `+${p.vspar}` : p.vspar === 0 ? "E" : p.vspar}
                      </span>
                    </div>
                  )}
                  <div className="stats-detail"><span>Best Hole</span><span>{p.best === 99 ? "—" : p.best}</span></div>
                  <div className="stats-detail"><span>Worst Hole</span><span>{p.worst || "—"}</span></div>
                  <div className="stats-detail"><span>Roasted</span><span>🔥 {p.roastCount}x</span></div>
                  <div className="stats-detail"><span>Holes</span><span>{p.holesPlayed}/{totalHoles || 18}</span></div>
                </div>
              )}
            </div>
          ))}
        </div>

        {mostRoasted && mostRoasted.roastCount > 0 && (
          <div className="stats-award">
            ☠️ <strong>{mostRoasted.name}</strong> is getting destroyed — roasted {mostRoasted.roastCount}x so far
          </div>
        )}

        {roastLog.length > 0 && (
          <div className="stats-recent">
            <h4 className="section-label" style={{ marginBottom: "8px" }}>Recent Roasts</h4>
            {roastLog.slice(-3).reverse().map((r, i) => (
              <div key={i} className="stats-roast-row">
                <span className="stats-roast-hole">H{r.hole}</span>
                <span className="stats-roast-player">{r.player}</span>
                <span className="stats-roast-text">"{r.roast.slice(0, 60)}..."</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// RESUME SCREEN
// ════════════════════════════════════════════════════════════════════════════
function ResumeScreen({ session, onResume, onNew }) {
  const intensity = getIntensity(session.current_hole || 1);
  return (
    <div className="screen resume-screen">
      <div className="resume-header">
        <div className="resume-icon">⛳</div>
        <h2 className="resume-title">ROUND IN PROGRESS</h2>
        <p className="resume-sub">You've got an active round. Pick up where you left off?</p>
      </div>
      <div className="resume-card">
        <div className="resume-trip">{session.trip_name}</div>
        <div className="resume-details">
          <div className="resume-detail">
            <span>Round</span>
            <span>{session.current_round} of {session.total_rounds}</span>
          </div>
          <div className="resume-detail">
            <span>Hole</span>
            <span style={{ color: intensity.color }}>{intensity.emoji} {session.current_hole}</span>
          </div>
          {session.course_info?.name && (
            <div className="resume-detail">
              <span>Course</span>
              <span>{session.course_info.name}</span>
            </div>
          )}
          <div className="resume-detail">
            <span>Players</span>
            <span>{session.players?.map(p => p.name).join(", ")}</span>
          </div>
          <div className="resume-detail">
            <span>Roasts fired</span>
            <span>🔥 {session.roast_log?.length || 0}</span>
          </div>
        </div>
      </div>
      <button className="btn-primary" onClick={onResume} style={{ background: intensity.color }}>
        ↩ RESUME ROUND
      </button>
      <button className="btn-secondary" style={{ marginTop: "10px" }} onClick={onNew}>
        Start New Trip
      </button>
    </div>
  );
}

// ── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&family=Russo+One&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
.app { min-height: 100vh; background: #0a0a0a; color: #f0ece4; font-family: 'DM Sans', sans-serif; display: flex; flex-direction: column; align-items: center; padding-bottom: 80px; }
.screen { width: 100%; max-width: 480px; padding: 24px 20px; animation: fadeUp 0.35s ease both; }
@keyframes fadeUp { from { opacity:0; transform:translateY(16px);} to{opacity:1;transform:translateY(0);} }

/* Banner + FAB */
.spec-banner { width:100%; max-width:480px; background:#0a1a0a; color:#16a34a; font-size:12px; font-weight:600; letter-spacing:1px; text-align:center; padding:8px; cursor:pointer; border-bottom:1px solid #0a2a0a; }
.trash-talk-fab { position:fixed; bottom:24px; right:20px; width:52px; height:52px; border-radius:50%; background:#16a34a; border:none; font-size:22px; cursor:pointer; z-index:100; box-shadow:0 4px 20px rgba(22,163,74,0.4); transition:transform 0.15s; }
.trash-talk-fab:active { transform:scale(0.92); }

/* Setup */
.setup-header { text-align:center; margin-bottom:28px; padding-top:24px; }
.shanked-logo { display:flex; flex-direction:column; align-items:center; }
.shanked-svg { width:100%; max-width:300px; height:auto; margin-bottom:6px; }
.shanked-tagline { color:#555; font-size:12px; letter-spacing:1.5px; text-transform:uppercase; margin-top:2px; }
.fire-icon { font-size:48px; margin-bottom:12px; }
.title { font-family:'Bebas Neue',sans-serif; font-size:52px; line-height:1; letter-spacing:2px; }
.title-accent { color:#16a34a; }
.subtitle { color:#666; font-size:14px; margin-top:8px; }
.trip-meta { margin-bottom:24px; }
.meta-row { display:flex; gap:12px; margin-top:10px; }
.meta-field { flex:1; }
.meta-label { font-size:11px; color:#555; letter-spacing:1px; text-transform:uppercase; display:block; margin-bottom:6px; }
.round-btns { display:flex; gap:6px; }
.round-btn { flex:1; padding:10px; background:#1a1a1a; border:1px solid #2a2a2a; border-radius:6px; color:#888; font-family:'Bebas Neue',sans-serif; font-size:18px; cursor:pointer; transition:all 0.15s; }
.round-btn.active { background:#16a34a; border-color:#16a34a; color:#fff; }
.input-bet { background:#1a1a1a; border:1px solid #2a2a2a; border-radius:6px; color:#f0ece4; font-family:'DM Sans',sans-serif; font-size:14px; padding:10px 12px; outline:none; width:100%; }
.input-bet:focus { border-color:#16a34a; }
.players-list { margin-bottom:20px; }
.player-card { display:flex; align-items:flex-start; gap:12px; background:#141414; border:1px solid #222; border-radius:10px; padding:14px; margin-bottom:10px; animation:fadeUp 0.3s ease both; }
.player-num { font-family:'Bebas Neue',sans-serif; font-size:20px; color:#444; padding-top:6px; min-width:28px; }
.player-fields { flex:1; display:flex; flex-direction:column; gap:8px; }
.input-name,.input-traits,.shot-input,.roast-select,.email-input { width:100%; background:#1a1a1a; border:1px solid #2a2a2a; border-radius:6px; color:#f0ece4; font-family:'DM Sans',sans-serif; font-size:14px; padding:10px 12px; outline:none; transition:border-color 0.2s; }
.input-name:focus,.input-traits:focus,.shot-input:focus,.roast-select:focus,.email-input:focus { border-color:#16a34a; }
.input-traits { font-size:13px; color:#aaa; }
.shot-input { resize:none; }
.remove-btn { background:none; border:none; color:#444; font-size:16px; cursor:pointer; padding:4px; transition:color 0.2s; }
.remove-btn:hover { color:#16a34a; }
.setup-actions { display:flex; flex-direction:column; gap:10px; margin:20px 0; }
.btn-primary { width:100%; padding:15px; border:none; border-radius:8px; font-family:'Bebas Neue',sans-serif; font-size:20px; letter-spacing:1.5px; color:#fff; background:#16a34a; cursor:pointer; transition:opacity 0.2s,transform 0.1s; }
.btn-primary:active { transform:scale(0.98); }
.btn-primary.disabled,.btn-primary:disabled { opacity:0.3; cursor:not-allowed; }
.btn-secondary { width:100%; padding:12px; border:1px solid #333; border-radius:8px; font-family:'DM Sans',sans-serif; font-size:14px; color:#888; background:transparent; cursor:pointer; transition:border-color 0.2s,color 0.2s; }
.btn-secondary:hover { border-color:#555; color:#ccc; }
.intensity-preview { margin-top:28px; padding-top:20px; border-top:1px solid #1a1a1a; }
.preview-label { font-size:12px; color:#555; margin-bottom:10px; text-align:center; }
.intensity-bar { display:flex; height:6px; border-radius:3px; overflow:hidden; gap:2px; }
.intensity-segment { flex:1; border-radius:2px; }
.intensity-labels { display:flex; justify-content:space-between; font-size:12px; color:#555; margin-top:6px; }

/* Hole */
.hole-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; padding-bottom:16px; border-bottom:2px solid; }
.hole-badge { font-family:'Bebas Neue',sans-serif; font-size:28px; letter-spacing:1px; padding:4px 14px; border-radius:6px; color:#fff; }
.round-tag { font-size:11px; color:#666; margin-top:4px; letter-spacing:1px; }
.intensity-tag { font-size:14px; font-weight:500; color:#888; }
.section-label { font-size:11px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase; color:#555; margin-bottom:12px; }
.bet-tag { background:#1a1a0a; color:#f59e0b; font-size:10px; padding:2px 6px; border-radius:4px; margin-left:8px; font-weight:600; }
.scores-section { margin-bottom:24px; }
.score-grid { display:flex; flex-direction:column; gap:10px; }
.score-row { display:flex; align-items:center; gap:10px; }
.score-name { font-size:14px; font-weight:500; min-width:80px; color:#ccc; }
.score-buttons { display:flex; gap:5px; flex-wrap:wrap; }
.score-btn { width:32px; height:32px; background:#1a1a1a; border:1px solid #2a2a2a; border-radius:6px; color:#888; font-size:13px; font-weight:600; cursor:pointer; transition:all 0.15s; }
.score-btn.active { color:#fff; border-color:transparent; }
.score-btn:hover:not(.active) { border-color:#444; color:#ccc; }
.roast-fuel { margin-bottom:20px; }
.roast-select { appearance:none; cursor:pointer; margin-bottom:10px; }
.photo-section { margin-bottom:20px; }
.btn-photo { width:100%; padding:12px; background:#141414; border:1px dashed #333; border-radius:8px; color:#888; font-family:'DM Sans',sans-serif; font-size:14px; cursor:pointer; transition:border-color 0.2s,color 0.2s; }
.btn-photo:hover { border-color:#555; color:#ccc; }
.photo-preview-wrap { position:relative; }
.photo-preview { width:100%; max-height:180px; object-fit:cover; border-radius:8px; border:1px solid #333; }
.photo-remove { position:absolute; top:8px; right:8px; background:rgba(0,0,0,0.75); border:none; color:#ccc; font-size:12px; padding:4px 10px; border-radius:4px; cursor:pointer; }

/* Roast */
.roast-screen { padding-top:32px; }
.roast-target { font-family:'Bebas Neue',sans-serif; font-size:36px; letter-spacing:2px; text-align:center; margin-bottom:16px; }
.hole-photo { margin-bottom:16px; position:relative; }
.hole-photo-img { width:100%; max-height:200px; object-fit:cover; border-radius:10px; }
.hole-photo-label { position:absolute; bottom:8px; left:10px; background:rgba(0,0,0,0.7); color:#aaa; font-size:11px; padding:3px 8px; border-radius:4px; }
.roast-card { background:#111; border:2px solid; border-radius:12px; padding:24px; min-height:140px; display:flex; align-items:center; justify-content:center; margin-bottom:16px; opacity:0; transform:scale(0.97); transition:opacity 0.4s ease,transform 0.4s ease; }
.roast-card.revealed { opacity:1; transform:scale(1); }
.loading-roast { text-align:center; }
.loading-dots { display:flex; gap:8px; justify-content:center; margin-bottom:12px; }
.loading-dots span { width:10px; height:10px; border-radius:50%; animation:pulse 1s ease-in-out infinite; }
.loading-dots span:nth-child(2) { animation-delay:0.2s; }
.loading-dots span:nth-child(3) { animation-delay:0.4s; }
@keyframes pulse { 0%,100%{opacity:0.3;transform:scale(0.8);}50%{opacity:1;transform:scale(1.1);} }
.loading-text { font-size:13px; color:#555; }
.roast-text { font-size:15px; line-height:1.65; color:#e8e0d5; text-align:center; }
.scores-recap { margin-bottom:14px; }
.recap-label { font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:#444; margin-bottom:10px; }
.recap-scores { display:flex; gap:8px; flex-wrap:wrap; }
.recap-score { display:flex; flex-direction:column; align-items:center; gap:2px; background:#141414; border:1px solid #222; border-radius:8px; padding:8px 14px; font-size:13px; color:#666; }
.recap-score.worst { border-width:2px; font-weight:600; }
.recap-num { font-family:'Bebas Neue',sans-serif; font-size:22px; }
.btn-share { width:100%; padding:13px; background:#161616; border:1px solid #2a2a2a; border-radius:8px; color:#bbb; font-family:'DM Sans',sans-serif; font-size:15px; font-weight:600; cursor:pointer; margin-bottom:8px; transition:background 0.2s; }
.btn-share:hover { background:#1e1e1e; }
.share-msg { text-align:center; font-size:13px; color:#888; margin-bottom:10px; }
.roast-actions { margin-top:10px; }

/* Round Summary */
.summary-screen { padding-top:28px; }
.summary-header { text-align:center; margin-bottom:24px; }
.summary-icon { font-size:48px; margin-bottom:8px; }
.summary-title { font-family:'Bebas Neue',sans-serif; font-size:36px; letter-spacing:2px; }
.summary-card { background:#111; border:1px solid #1e1e1e; border-radius:10px; padding:16px; margin-bottom:16px; }
.summary-row { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid #1a1a1a; }
.summary-row:last-child { border-bottom:none; }
.summary-row.winner { background:#0a1a0a; border-radius:6px; padding:10px 8px; }
.summary-row.loser { background:#0a1a0a; border-radius:6px; padding:10px 8px; }
.summary-rank { font-size:18px; min-width:28px; }
.summary-name { flex:1; font-weight:500; }
.summary-score { font-family:'Bebas Neue',sans-serif; font-size:24px; color:#888; }
.bet-result-card { background:#0d0d00; border:1px solid #2a2a00; border-radius:10px; padding:16px; margin-bottom:16px; }
.bet-winner { font-family:'Bebas Neue',sans-serif; font-size:22px; color:#f59e0b; margin-bottom:8px; }
.bet-loser-line { font-size:13px; color:#888; margin-bottom:4px; }

/* Prop Bets */
.prop-screen { padding-top:28px; }
.prop-header { text-align:center; margin-bottom:24px; }
.prop-title { font-family:'Bebas Neue',sans-serif; font-size:40px; letter-spacing:2px; }
.prop-sub { font-size:13px; color:#666; margin-top:6px; }
.props-list { margin-bottom:12px; }
.prop-card { background:#111; border:1px solid #222; border-radius:10px; padding:14px; margin-bottom:10px; transition:border-color 0.2s; }
.prop-card.settled { border-color:#333; }
.prop-bet { font-size:14px; color:#e0dcd4; margin-bottom:10px; line-height:1.5; }
.prop-vote-label { font-size:11px; color:#555; letter-spacing:1px; text-transform:uppercase; margin-bottom:8px; }
.prop-btns { display:flex; gap:6px; flex-wrap:wrap; }
.prop-btn { padding:6px 12px; background:#1a1a1a; border:1px solid #2a2a2a; border-radius:6px; color:#888; font-size:12px; font-weight:600; cursor:pointer; transition:all 0.15s; }
.prop-btn.active-yes { background:#166534; border-color:#16a34a; color:#4ade80; }
.prop-btn.active-no { background:#0a1a0a; border-color:#14532d; color:#f87171; }
.regen-btn { margin-bottom:0; }

/* Trash Talk Modal */
.modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.8); display:flex; align-items:flex-end; justify-content:center; z-index:200; }
.modal { width:100%; max-width:480px; background:#111; border-top:1px solid #222; border-radius:16px 16px 0 0; padding:24px 20px 40px; animation:slideUp 0.3s ease; }
@keyframes slideUp { from{transform:translateY(100%);} to{transform:translateY(0);} }
.modal-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
.modal-title { font-family:'Bebas Neue',sans-serif; font-size:28px; letter-spacing:1px; }
.modal-close { background:none; border:none; color:#666; font-size:20px; cursor:pointer; }
.trash-result { background:#0a1a0a; border:1px solid #0a2a0a; border-radius:8px; padding:14px; font-size:14px; line-height:1.6; color:#d0e8d4; margin-top:12px; font-style:italic; }

/* Spectator Modal */
.spec-modal-text { font-size:14px; color:#888; margin-bottom:12px; line-height:1.5; }
.spec-link-box { background:#1a1a1a; border:1px solid #333; border-radius:6px; padding:10px 12px; font-size:12px; color:#aaa; word-break:break-all; }

/* Spectator View */
.spec-loading { min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; color:#666; font-size:14px; }
.spec-loading .loading-dots span { background:#16a34a; }
.spec-screen { padding-top:20px; }
.spec-header { text-align:center; margin-bottom:24px; }
.spec-live-badge { display:inline-block; background:#0a1a0a; color:#16a34a; font-size:12px; font-weight:700; letter-spacing:2px; padding:4px 12px; border-radius:20px; margin-bottom:10px; }
.spec-title { font-family:'Bebas Neue',sans-serif; font-size:36px; letter-spacing:2px; }
.spec-sub { font-size:13px; color:#666; margin-top:4px; }
.spec-card { background:#111; border:1px solid #1e1e1e; border-radius:10px; padding:16px; margin-bottom:16px; }
.spec-score-row { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #1a1a1a; }
.spec-score-row:last-child { border-bottom:none; }
.spec-rank { font-size:16px; min-width:24px; }
.spec-pname { flex:1; font-size:14px; font-weight:500; }
.spec-ptotal { font-family:'Bebas Neue',sans-serif; font-size:22px; color:#888; }
.spec-roast-card { transition:box-shadow 0.3s; }
.spec-roast-card.flash { box-shadow:0 0 20px currentColor; }
.spec-roast-label { font-family:'Bebas Neue',sans-serif; font-size:18px; letter-spacing:1px; margin-bottom:10px; }
.spec-roast-text { font-size:14px; line-height:1.65; color:#e8e0d5; font-style:italic; }
.spec-refresh-note { text-align:center; font-size:11px; color:#333; margin-top:16px; }

/* Final */
.final-screen { padding-top:24px; }
.final-header { text-align:center; margin-bottom:20px; }
.trophy { font-size:52px; margin-bottom:8px; }
.final-title { font-family:'Bebas Neue',sans-serif; font-size:36px; letter-spacing:2px; }
.final-trip-name { font-size:14px; color:#666; margin-top:4px; }
.tab-bar { display:flex; gap:6px; margin-bottom:20px; }
.tab-btn { flex:1; padding:10px; background:#141414; border:1px solid #222; border-radius:8px; color:#666; font-family:'DM Sans',sans-serif; font-size:13px; font-weight:600; cursor:pointer; transition:all 0.15s; }
.tab-btn.active { background:#1a1a1a; border-color:#555; color:#f0ece4; }
.final-scoreboard { background:#111; border-radius:10px; overflow:hidden; margin-bottom:16px; border:1px solid #1e1e1e; }
.final-row { display:flex; align-items:center; gap:12px; padding:12px 16px; border-bottom:1px solid #1a1a1a; font-size:15px; }
.final-row:last-child { border-bottom:none; }
.final-row.loser { background:#0a1a0a; }
.final-row.winner { background:#0a1a0a; }
.final-rank { font-size:18px; min-width:28px; }
.final-name { flex:1; font-weight:500; }
.final-total { font-family:'Bebas Neue',sans-serif; font-size:24px; color:#888; }
.final-report-card { background:#111; border:1px solid #222; border-radius:12px; padding:22px; margin-bottom:16px; opacity:0; transition:opacity 0.5s ease; }
.final-report-card.revealed { opacity:1; }
.report-text { font-size:14px; line-height:1.75; color:#d4cec7; white-space:pre-line; }
.email-section { background:#111; border:1px solid #1e1e1e; border-radius:10px; padding:16px; margin-bottom:20px; }
.email-hint { font-size:12px; color:#555; margin-bottom:12px; }
.email-row { display:flex; gap:8px; }
.email-input { flex:1; }
.btn-email { padding:10px 18px; background:#16a34a; border:none; border-radius:6px; color:#fff; font-family:'Bebas Neue',sans-serif; font-size:16px; letter-spacing:1px; cursor:pointer; white-space:nowrap; transition:opacity 0.2s; }
.btn-email.disabled { opacity:0.3; cursor:not-allowed; }
.email-status { font-size:12px; color:#16a34a; margin-top:8px; }
.roast-log { margin-bottom:20px; }
.log-entry { background:#111; border:1px solid #1a1a1a; border-radius:8px; padding:12px; margin-bottom:8px; }
.log-header { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.log-hole { font-family:'Bebas Neue',sans-serif; font-size:16px; letter-spacing:1px; }
.log-player { font-size:12px; font-weight:600; color:#888; flex:1; }
.log-roast { font-size:12px; line-height:1.55; color:#666; }
.restart-btn { background:#1a1a1a !important; color:#666 !important; }

/* 19th Hole Card */
.card-tab { padding-top:4px; }
.hole19-card { background:linear-gradient(135deg,#0d0d0d 0%,#111 100%); border:2px solid #2a2a2a; border-radius:16px; padding:20px; }
.hole19-header { display:flex; align-items:center; gap:12px; margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid #1e1e1e; }
.hole19-emoji { font-size:24px; }
.hole19-title { font-family:'Bebas Neue',sans-serif; font-size:22px; letter-spacing:1px; }
.hole19-sub { font-size:12px; color:#666; margin-top:2px; }
.hole19-scores { margin-bottom:16px; }
.hole19-score-row { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #161616; }
.hole19-score-row:last-child { border-bottom:none; }
.hole19-name { flex:1; font-size:14px; font-weight:500; }
.hole19-num { font-family:'Bebas Neue',sans-serif; font-size:22px; color:#888; }
.hole19-award { display:flex; align-items:center; gap:12px; background:#0a1a0a; border-radius:8px; padding:12px; margin-bottom:14px; }
.hole19-award-icon { font-size:24px; }
.hole19-award-title { font-family:'Bebas Neue',sans-serif; font-size:16px; color:#16a34a; letter-spacing:1px; }
.hole19-award-sub { font-size:12px; color:#888; margin-top:2px; }
.hole19-roast { background:#111; border-left:3px solid #333; padding:12px; border-radius:0 8px 8px 0; margin-bottom:14px; }
.hole19-roast-label { font-size:11px; color:#555; letter-spacing:1px; text-transform:uppercase; margin-bottom:6px; }
.hole19-roast-text { font-size:13px; line-height:1.6; color:#aaa; font-style:italic; }
.hole19-footer { text-align:center; font-size:11px; color:#333; }

/* Trophy Room */
.trophy-tab { padding-top:4px; }
.trophy-empty { text-align:center; padding:40px 20px; color:#555; font-size:14px; line-height:2; }
.trophy-entry { background:#111; border:1px solid #1e1e1e; border-radius:10px; padding:14px; margin-bottom:10px; }
.trophy-trip-name { font-family:'Bebas Neue',sans-serif; font-size:20px; letter-spacing:1px; margin-bottom:4px; }
.trophy-trip-meta { font-size:12px; color:#555; margin-bottom:10px; }
.trophy-scores { display:flex; gap:6px; flex-wrap:wrap; }
.trophy-score-pill { background:#1a1a1a; border:1px solid #222; border-radius:6px; padding:4px 10px; font-size:12px; color:#888; }

/* Multiplayer */
.mode-toggle { display:flex; gap:8px; margin-bottom:10px; }
.mode-btn { flex:1; padding:12px; background:#141414; border:1px solid #222; border-radius:8px; color:#666; font-family:'DM Sans',sans-serif; font-size:14px; font-weight:600; cursor:pointer; transition:all 0.15s; }
.mode-btn.active { background:#0a1a0a; border-color:#16a34a; color:#16a34a; }
.mode-hint { font-size:12px; color:#555; text-align:center; margin-bottom:12px; line-height:1.5; }
.mp-lobby-screen { padding-top:28px; }
.mp-header { text-align:center; margin-bottom:24px; }
.mp-title { font-family:'Bebas Neue',sans-serif; font-size:28px; letter-spacing:2px; color:#888; margin-bottom:12px; }
.room-code { font-family:'Russo One',sans-serif; font-size:64px; letter-spacing:8px; color:#16a34a; line-height:1; filter:drop-shadow(0 0 12px rgba(22,163,74,0.4)); }
.room-sub { font-size:13px; color:#555; margin-top:8px; }
.mp-players-card { background:#111; border:1px solid #1e1e1e; border-radius:10px; padding:16px; margin:16px 0; }
.mp-player-row { display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid #1a1a1a; }
.mp-player-row:last-child { border-bottom:none; }
.mp-player-name { font-size:14px; font-weight:500; }
.mp-player-status { font-size:12px; color:#555; }
.mp-hint { font-size:12px; color:#444; text-align:center; line-height:1.6; padding:0 10px; }
.mp-hint strong { color:#666; }
.join-screen { padding-top:12px; }
.join-card { background:#111; border:1px solid #1e1e1e; border-radius:12px; padding:20px; margin-bottom:16px; }
.join-error { color:#f87171; font-size:13px; margin-bottom:10px; text-align:center; }
.join-divider { text-align:center; color:#333; font-size:13px; margin:16px 0; position:relative; }
.join-divider::before { content:''; position:absolute; top:50%; left:0; right:0; height:1px; background:#1e1e1e; }
.join-divider span { background:#0a0a0a; padding:0 12px; position:relative; }
.mp-player-screen { padding-top:8px; }
.mp-action-card { background:#111; border:1px solid #1e1e1e; border-radius:10px; padding:16px; margin-bottom:14px; }
.mp-submitted { font-size:14px; color:#16a34a; font-weight:600; padding:8px 0; }
.mp-waiting { font-size:12px; color:#555; margin-top:8px; text-align:center; }
.mp-roast-flash { transition:box-shadow 0.3s; }
.mp-roast-flash.flash { box-shadow:0 0 20px rgba(22,163,74,0.3); }
.nominations-card { background:#0a1a0a; border:1px solid #14532d; border-radius:10px; padding:14px; margin-bottom:16px; }
.nomination-row { padding:8px 0; border-bottom:1px solid #0d2a0d; }
.nomination-row:last-child { border-bottom:none; }
.nom-from { font-size:11px; color:#555; text-transform:uppercase; letter-spacing:1px; margin-right:6px; }
.nom-player { font-size:14px; font-weight:700; }
.nom-shot { font-size:12px; color:#666; font-style:italic; margin-top:4px; }

/* Resume Screen */
.resume-screen { padding-top:60px; display:flex; flex-direction:column; align-items:center; }
.resume-header { text-align:center; margin-bottom:28px; }
.resume-icon { font-size:52px; margin-bottom:12px; }
.resume-title { font-family:'Bebas Neue',sans-serif; font-size:36px; letter-spacing:2px; }
.resume-sub { font-size:13px; color:#666; margin-top:8px; max-width:280px; line-height:1.5; }
.resume-card { width:100%; background:#111; border:1px solid #1e1e1e; border-radius:12px; padding:20px; margin-bottom:24px; }
.resume-trip { font-family:'Bebas Neue',sans-serif; font-size:28px; letter-spacing:1px; color:#16a34a; margin-bottom:16px; text-align:center; }
.resume-details { display:flex; flex-direction:column; gap:10px; }
.resume-detail { display:flex; justify-content:space-between; align-items:center; font-size:14px; padding:8px 0; border-bottom:1px solid #1a1a1a; }
.resume-detail:last-child { border-bottom:none; }
.resume-detail span:first-child { color:#555; }
.resume-detail span:last-child { font-weight:600; color:#ccc; font-size:13px; text-align:right; max-width:60%; }

/* Group Chat */
.chat-modal { height:85vh; display:flex; flex-direction:column; }
.chat-messages { flex:1; overflow-y:auto; padding:8px 0; display:flex; flex-direction:column; gap:12px; }
.chat-empty { text-align:center; color:#555; font-size:13px; padding:40px 0; }
.chat-msg { display:flex; flex-direction:column; max-width:85%; }
.chat-msg.mine { align-self:flex-end; align-items:flex-end; }
.chat-msg.theirs { align-self:flex-start; align-items:flex-start; }
.chat-sender { font-size:11px; color:#555; margin-bottom:4px; letter-spacing:0.5px; }
.chat-bubble { padding:10px 14px; border-radius:12px; font-size:14px; line-height:1.5; }
.bubble-mine { background:#16a34a; color:#fff; border-radius:12px 12px 4px 12px; }
.bubble-theirs { background:#1a1a1a; color:#e0dcd4; border-radius:12px 12px 12px 4px; }
.chat-reactions-row { display:flex; align-items:center; gap:4px; flex-wrap:wrap; margin-top:4px; }
.reaction-pill { background:#1a1a1a; border:1px solid #2a2a2a; border-radius:20px; padding:2px 8px; font-size:12px; cursor:pointer; transition:background 0.15s; }
.reaction-pill:hover { background:#222; }
.reaction-adder { display:flex; gap:2px; opacity:0; transition:opacity 0.2s; }
.chat-msg:hover .reaction-adder { opacity:1; }
.reaction-add-btn { background:none; border:none; font-size:14px; cursor:pointer; padding:2px; opacity:0.6; transition:opacity 0.15s; }
.reaction-add-btn:hover { opacity:1; }
.chat-input-row { display:flex; gap:8px; padding-top:12px; border-top:1px solid #1a1a1a; margin-top:8px; }
.chat-input { flex:1; background:#1a1a1a; border:1px solid #2a2a2a; border-radius:8px; color:#f0ece4; font-family:'DM Sans',sans-serif; font-size:14px; padding:10px 12px; outline:none; }
.chat-input:focus { border-color:#16a34a; }
.chat-send-btn { width:42px; height:42px; background:#16a34a; border:none; border-radius:8px; color:#fff; font-size:18px; cursor:pointer; transition:opacity 0.2s; }
.chat-send-btn:disabled { opacity:0.3; }
.chat-note { text-align:center; font-size:11px; color:#333; margin-top:6px; }
.chat-fab { position:fixed; bottom:84px; right:20px; width:48px; height:48px; border-radius:50%; background:#166534; border:none; font-size:20px; cursor:pointer; z-index:100; box-shadow:0 4px 16px rgba(22,101,52,0.4); transition:transform 0.15s; }
.chat-fab:active { transform:scale(0.92); }
.chat-unread { position:absolute; top:-2px; right:-2px; width:16px; height:16px; background:#f59e0b; border-radius:50%; font-size:10px; color:#000; font-weight:700; display:flex; align-items:center; justify-content:center; }

/* Course Setup */
.course-screen { padding-top:28px; }
.course-header { text-align:center; margin-bottom:24px; }
.course-title { font-family:'Bebas Neue',sans-serif; font-size:36px; letter-spacing:2px; }
.course-sub { font-size:13px; color:#666; margin-top:6px; }
.course-name-row { margin-bottom:20px; }
.par-grid { background:#111; border:1px solid #1e1e1e; border-radius:10px; padding:16px; }
.par-grid-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
.total-par { font-family:'Bebas Neue',sans-serif; font-size:20px; color:#16a34a; }
.par-holes { display:flex; flex-direction:column; gap:8px; }
.par-hole { display:flex; align-items:center; gap:12px; padding:6px 0; border-bottom:1px solid #1a1a1a; }
.par-hole:last-child { border-bottom:none; }
.par-hole-num { font-family:'Bebas Neue',sans-serif; font-size:18px; color:#555; min-width:24px; }
.par-btns { display:flex; gap:6px; }
.par-btn { width:40px; height:34px; background:#1a1a1a; border:1px solid #2a2a2a; border-radius:6px; color:#888; font-size:14px; font-weight:600; cursor:pointer; transition:all 0.15s; }
.par-btn.active { background:#16a34a; border-color:#16a34a; color:#fff; }

/* Prop Bets V2 */
.custom-bet-row { display:flex; gap:8px; margin-bottom:16px; }
.btn-add-bet { padding:10px 16px; background:#16a34a; border:none; border-radius:6px; color:#fff; font-family:'Bebas Neue',sans-serif; font-size:16px; letter-spacing:1px; cursor:pointer; white-space:nowrap; transition:opacity 0.2s; }
.btn-add-bet:disabled { opacity:0.3; cursor:not-allowed; }
.bets-list { display:flex; flex-direction:column; gap:10px; margin-bottom:8px; }
.bet-card-v2 { background:#111; border:1px solid #1e1e1e; border-radius:10px; padding:14px; }
.bet-top { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin-bottom:10px; }
.bet-text-v2 { font-size:14px; color:#e0dcd4; line-height:1.5; flex:1; }
.bet-remove { background:none; border:none; color:#444; font-size:14px; cursor:pointer; padding:2px; transition:color 0.2s; flex-shrink:0; }
.bet-remove:hover { color:#16a34a; }
.bet-winners { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.bet-winner-label { font-size:11px; color:#555; letter-spacing:1px; text-transform:uppercase; }
.bet-winner-btns { display:flex; gap:6px; flex-wrap:wrap; }
.bet-winner-btn { padding:5px 10px; background:#1a1a1a; border:1px solid #2a2a2a; border-radius:6px; color:#888; font-size:12px; font-weight:600; cursor:pointer; transition:all 0.15s; }
.bet-winner-btn.active-won { background:#14532d; border-color:#16a34a; color:#4ade80; }
.bet-winner-btn.active-tbd { background:#1a1a0a; border-color:#f59e0b; color:#f59e0b; }

/* Stats */
.stats-modal { max-height:85vh; overflow-y:auto; }
.stats-course-badge { background:#0a1a0a; border:1px solid #14532d; border-radius:6px; padding:8px 12px; font-size:13px; color:#16a34a; margin-bottom:16px; text-align:center; }
.stats-grid { display:flex; flex-direction:column; gap:10px; margin-bottom:16px; }
.stats-card { background:#111; border:1px solid #1e1e1e; border-radius:10px; padding:14px; }
.stats-card.stats-leading { border-color:#16a34a; background:#0a1a0a; }
.stats-card-header { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
.stats-rank { font-size:18px; min-width:24px; }
.stats-name { flex:1; font-size:15px; font-weight:600; }
.stats-total { font-family:'Bebas Neue',sans-serif; font-size:28px; color:#888; }
.stats-details { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.stats-detail { display:flex; justify-content:space-between; font-size:12px; color:#666; background:#161616; padding:5px 8px; border-radius:4px; }
.stats-detail span:last-child { font-weight:600; color:#aaa; }
.stat-over { color:#f87171 !important; }
.stat-under { color:#4ade80 !important; }
.stat-even { color:#f59e0b !important; }
.stats-award { background:#1a0a0a; border:1px solid #3a1a1a; border-radius:8px; padding:12px; font-size:13px; color:#888; margin-bottom:16px; text-align:center; }
.stats-award strong { color:#f0ece4; }
.stats-recent { background:#111; border:1px solid #1e1e1e; border-radius:8px; padding:12px; }
.stats-roast-row { display:flex; align-items:flex-start; gap:8px; padding:6px 0; border-bottom:1px solid #1a1a1a; }
.stats-roast-row:last-child { border-bottom:none; }
.stats-roast-hole { font-family:'Bebas Neue',sans-serif; font-size:14px; color:#16a34a; min-width:28px; }
.stats-roast-player { font-size:12px; font-weight:600; color:#888; min-width:60px; }
.stats-roast-text { font-size:12px; color:#555; font-style:italic; line-height:1.4; }
.stats-fab { position:fixed; bottom:144px; right:20px; width:48px; height:48px; border-radius:50%; background:#15803d; border:none; font-size:20px; cursor:pointer; z-index:100; box-shadow:0 4px 16px rgba(21,128,61,0.4); transition:transform 0.15s; }
.stats-fab:active { transform:scale(0.92); }
`;
