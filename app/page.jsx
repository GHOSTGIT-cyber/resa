"use client";
import { useEffect, useState, useCallback } from "react";

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/reservations", { cache: "no-store" });
    setData(await r.json());
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // rafraîchit toutes les 30 s
    return () => clearInterval(t);
  }, [load]);

  async function login(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setLoading(false);
    if (r.ok) {
      setPw("");
      load();
    } else {
      setErr("Mot de passe incorrect.");
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    load();
  }

  if (!data) return <div className="wrap">Chargement…</div>;

  const { authed, stats, reservations } = data;
  const slots = Object.entries(stats.bySlot || {}).sort();

  return (
    <div className="wrap">
      <header className="top">
        <h1>Réservations — eFoil Côte d'Azur</h1>
        <span className="badge">{authed ? "Accès complet" : "Vue publique"}</span>
      </header>

      <div className="cards">
        <div className="card">
          <div className="num">{stats.totalReservations}</div>
          <div className="lbl">Réservations</div>
        </div>
        <div className="card">
          <div className="num">{stats.totalParticipants}</div>
          <div className="lbl">Participants au total</div>
        </div>
        <div className="card">
          <div className="num">{slots.length}</div>
          <div className="lbl">Créneaux concernés</div>
        </div>
        <div className="card">
          <div className="num">{Object.keys(stats.byDate || {}).length}</div>
          <div className="lbl">Dates concernées</div>
        </div>
      </div>

      <div className="section">
        <h2>Participants par créneau</h2>
        {slots.length === 0 ? (
          <p className="muted">Aucune réservation pour l'instant.</p>
        ) : (
          slots.map(([s, n]) => (
            <span className="pill" key={s}>
              <strong>{s}</strong> · {n} pers.
            </span>
          ))
        )}
      </div>

      <div className="section">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Réservations</h2>
          <span className="refresh">Actualisé toutes les 30 s</span>
        </div>

        <div className="scroll" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Créneau</th>
                <th>Pers.</th>
                <th>Formule</th>
                <th>Niveau</th>
                {authed && <th>Nom</th>}
                {authed && <th>Téléphone</th>}
                {authed && <th>E-mail</th>}
              </tr>
            </thead>
            <tbody>
              {reservations.length === 0 && (
                <tr>
                  <td colSpan={authed ? 8 : 5} className="muted">
                    Aucune réservation.
                  </td>
                </tr>
              )}
              {reservations.map((r, i) => (
                <tr key={r.ref + i}>
                  <td>{r.date}</td>
                  <td>{r.slot}</td>
                  <td>{r.participants}</td>
                  <td>{r.formule}</td>
                  <td>{r.level}</td>
                  {authed && <td>{r.name}</td>}
                  {authed && <td>{r.phone}</td>}
                  {authed && <td>{r.email}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {authed ? (
        <button className="btn secondary" onClick={logout}>
          Masquer les données / se déconnecter
        </button>
      ) : (
        <div className="lock">
          <strong>Données confidentielles masquées</strong>
          <p className="muted" style={{ marginTop: 6 }}>
            Entrez le mot de passe pour afficher nom, téléphone et e-mail des clients.
          </p>
          <form className="row" onSubmit={login}>
            <span className="pw-field">
              <input
                type={showPw ? "text" : "password"}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="Mot de passe"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="pw-eye"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                title={showPw ? "Masquer" : "Afficher"}
              >
                {showPw ? "🙈" : "👁️"}
              </button>
            </span>
            <button className="btn" type="submit" disabled={loading}>
              {loading ? "…" : "Afficher"}
            </button>
          </form>
          {err && <div className="err">{err}</div>}
        </div>
      )}
    </div>
  );
}
