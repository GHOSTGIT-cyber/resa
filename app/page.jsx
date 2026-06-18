"use client";
import { useEffect, useState, useCallback } from "react";

const STATUS_LABEL = { pending: "En attente", confirmed: "Confirmée", cancelled: "Annulée" };

function fmtReceived(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState("list"); // "list" | "day"
  const [copied, setCopied] = useState("");

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

  async function setStatus(ref, status) {
    await fetch("/api/reservations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref, status }),
    });
    load();
  }

  // Suppression en 2 temps : on ne supprime QUE si déjà annulée, et avec confirmation.
  async function hardDelete(r) {
    if (r.status !== "cancelled") {
      // 1er temps : annuler (réversible, on garde toutes les infos client)
      return setStatus(r.ref, "cancelled");
    }
    // 2e temps : suppression définitive, confirmée explicitement
    const ok = window.confirm(
      `Supprimer DÉFINITIVEMENT la réservation de ${r.name || r.ref} ?\n` +
        `Cette action est irréversible et efface les coordonnées du client.`
    );
    if (!ok) return;
    await fetch("/api/reservations?ref=" + encodeURIComponent(r.ref), { method: "DELETE" });
    load();
  }

  async function copy(text, tag) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(""), 1200);
    } catch {
      /* clipboard indisponible */
    }
  }

  if (!data) return <div className="wrap">Chargement…</div>;

  const { authed, stats, reservations } = data;
  const slots = Object.entries(stats.bySlot || {}).sort();
  // Public : on masque les annulées. Connecté : on voit tout (annulées grisées).
  const rows = authed ? reservations : reservations.filter((r) => r.status !== "cancelled");
  const colCount = authed ? 12 : 6;

  function StatusBadge({ s }) {
    return <span className={"st st-" + s}>{STATUS_LABEL[s] || s}</span>;
  }

  function CopyBtn({ text, tag }) {
    if (!text) return <>—</>;
    return (
      <span className="copywrap">
        {text}
        <button className="mini" title="Copier" onClick={() => copy(text, tag)}>
          {copied === tag ? "✓" : "⧉"}
        </button>
      </span>
    );
  }

  function Row({ r }) {
    const cancelled = r.status === "cancelled";
    return (
      <tr className={cancelled ? "rowcancel" : ""}>
        <td>{r.date}</td>
        <td>{r.slot}</td>
        <td>{r.participants}</td>
        <td>{r.formule}</td>
        <td>{r.level}</td>
        <td><StatusBadge s={r.status} /></td>
        {authed && <td>{r.name}</td>}
        {authed && <td><CopyBtn text={r.phone} tag={"p" + r.ref} /></td>}
        {authed && <td><CopyBtn text={r.email} tag={"e" + r.ref} /></td>}
        {authed && <td className="msgcell">{r.message || "—"}</td>}
        {authed && <td>{fmtReceived(r.createdAt)}</td>}
        {authed && (
          <td className="actions">
            {r.status !== "confirmed" && !cancelled && (
              <button className="mini ok" onClick={() => setStatus(r.ref, "confirmed")}>
                Confirmer
              </button>
            )}
            {!cancelled && (
              <button className="mini warn" onClick={() => setStatus(r.ref, "cancelled")}>
                Annuler
              </button>
            )}
            {cancelled && (
              <button className="mini" onClick={() => setStatus(r.ref, "pending")}>
                Réactiver
              </button>
            )}
            {cancelled && (
              <button className="mini danger" onClick={() => hardDelete(r)}>
                🗑 Supprimer
              </button>
            )}
          </td>
        )}
      </tr>
    );
  }

  function Table({ list }) {
    return (
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Créneau</th>
            <th>Pers.</th>
            <th>Formule</th>
            <th>Niveau</th>
            <th>Statut</th>
            {authed && <th>Nom</th>}
            {authed && <th>Téléphone</th>}
            {authed && <th>E-mail</th>}
            {authed && <th>Message</th>}
            {authed && <th>Reçu le</th>}
            {authed && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr>
              <td colSpan={colCount} className="muted">
                Aucune réservation.
              </td>
            </tr>
          )}
          {list.map((r, i) => (
            <Row key={r.ref + i} r={r} />
          ))}
        </tbody>
      </table>
    );
  }

  // Regroupement par date pour la vue "Par jour".
  const byDay = {};
  for (const r of rows) (byDay[r.date || "—"] ||= []).push(r);
  const days = Object.keys(byDay).sort();

  return (
    <div className="wrap">
      <header className="top">
        <h1>Réservations — eFoil Côte d'Azur</h1>
        <span className="badge">{authed ? "Accès complet" : "Vue publique"}</span>
      </header>

      <div className="cards">
        <div className="card">
          <div className="num">{stats.totalReservations}</div>
          <div className="lbl">Réservations actives</div>
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
          <div className="row">
            <div className="seg">
              <button
                className={view === "list" ? "on" : ""}
                onClick={() => setView("list")}
              >
                Liste
              </button>
              <button className={view === "day" ? "on" : ""} onClick={() => setView("day")}>
                Par jour
              </button>
            </div>
            <span className="refresh">Actualisé toutes les 30 s</span>
          </div>
        </div>

        {view === "list" ? (
          <div className="scroll" style={{ marginTop: 12 }}>
            <Table list={rows} />
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {days.length === 0 && <p className="muted">Aucune réservation.</p>}
            {days.map((d) => {
              const dayRows = byDay[d];
              const total = dayRows
                .filter((r) => r.status !== "cancelled")
                .reduce((s, r) => s + (Number(r.participants) || 0), 0);
              return (
                <div key={d} className="dayblock">
                  <div className="dayhead">
                    <strong>{d}</strong>
                    <span className="muted">
                      {dayRows.length} résa · {total} pers.
                    </span>
                  </div>
                  <div className="scroll">
                    <Table list={dayRows} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
