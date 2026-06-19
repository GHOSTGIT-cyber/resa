"use client";
import { useEffect, useState, useCallback } from "react";

const STATUS_LABEL = {
  pending: "En attente",
  confirmed: "Confirmée",
  proposed: "Créneau proposé",
  cancelled: "Annulée",
};

// Messages pré-écrits pour la proposition d'un autre créneau.
const TEMPLATES = [
  "Le créneau demandé n'est plus disponible, nous vous proposons ce qui suit.",
  "La météo / l'état de la mer est défavorable ce jour-là, voici un report possible.",
  "Pour mieux vous accueillir, nous vous proposons un autre horaire.",
];

// "2026-06-21" -> "21/06/2026"
function fmtDate(d) {
  if (!d) return "—";
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

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
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState("");
  // Modal "annuler" (avec ou sans mail)
  const [cancelFor, setCancelFor] = useState(null);
  // Modal "proposer un autre créneau"
  const [proposeFor, setProposeFor] = useState(null);
  const [propDate, setPropDate] = useState("");
  const [propSlot, setPropSlot] = useState("");
  const [propMsg, setPropMsg] = useState("");

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

  function flashMsg(m) {
    setFlash(m);
    setTimeout(() => setFlash(""), 5000);
  }

  // Confirme la réservation ET envoie le mail de validation au client.
  async function confirmAndNotify(r) {
    if (!r.email) {
      if (!window.confirm("Pas d'e-mail client. Confirmer quand même (sans envoi) ?")) return;
    }
    setBusy(r.ref);
    try {
      const res = await fetch("/api/reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: r.ref, status: "confirmed", notify: true }),
      });
      const data = await res.json().catch(() => ({}));
      const e = data?.emailed;
      if (e?.ok) flashMsg(`✅ E-mail de validation envoyé à ${r.email}`);
      else if (e && e.ok === false) flashMsg(`⚠️ Confirmé, mais e-mail NON envoyé : ${e.error || "erreur"}`);
      else flashMsg("Réservation confirmée.");
    } finally {
      setBusy("");
      load();
    }
  }

  // Annule la réservation, avec ou sans mail au client.
  async function doCancel(r, withMail) {
    setCancelFor(null);
    setBusy(r.ref);
    try {
      const res = await fetch("/api/reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: r.ref, status: "cancelled", notify: withMail }),
      });
      const data = await res.json().catch(() => ({}));
      const e = data?.emailed;
      if (withMail && e?.ok) flashMsg(`Réservation annulée — mail envoyé à ${r.email}`);
      else if (withMail && e && e.ok === false) flashMsg(`Annulée, mais e-mail NON envoyé : ${e.error || "erreur"}`);
      else flashMsg("Réservation annulée (sans mail).");
    } finally {
      setBusy("");
      load();
    }
  }

  function openPropose(r) {
    setProposeFor(r);
    setPropDate("");
    setPropSlot("");
    setPropMsg("");
  }

  // Propose un autre créneau au client (statut "Créneau proposé" + e-mail).
  async function submitProposal() {
    const r = proposeFor;
    if (!r || !propDate || !propSlot) return;
    setBusy(r.ref);
    try {
      const res = await fetch("/api/reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: r.ref,
          status: "proposed",
          proposal: { date: propDate, slot: propSlot, message: propMsg },
        }),
      });
      const data = await res.json().catch(() => ({}));
      const e = data?.emailed;
      if (e?.ok) flashMsg(`📅 Proposition envoyée à ${r.email}`);
      else if (e && e.ok === false) flashMsg(`⚠️ Enregistré, mais e-mail NON envoyé : ${e.error || "erreur"}`);
      else flashMsg("Proposition enregistrée.");
      setProposeFor(null);
    } finally {
      setBusy("");
      load();
    }
  }

  // Suppression en 2 temps : on ne supprime QUE si déjà annulée, et avec confirmation.
  async function hardDelete(r) {
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

  function StatusBadge({ s }) {
    return <span className={"st st-" + s}>{STATUS_LABEL[s] || s}</span>;
  }

  function CopyVal({ text, tag }) {
    if (!text) return <span className="muted">—</span>;
    return (
      <span className="copywrap">
        <span className="cval">{text}</span>
        <button className="mini" title="Copier" onClick={() => copy(text, tag)}>
          {copied === tag ? "✓" : "⧉"}
        </button>
      </span>
    );
  }

  // Une carte = un client, entièrement visible (pensé mobile, aucun scroll latéral).
  function Card({ r }) {
    const cancelled = r.status === "cancelled";
    return (
      <div className={"rcard" + (cancelled ? " rcard-cancel" : "")}>
        <div className="rcard-top">
          <div className="rcard-when">
            <strong>{fmtDate(r.date)}</strong> · {r.slot}
          </div>
          <StatusBadge s={r.status} />
        </div>

        <div className="rcard-meta">
          <span>{r.participants} pers.</span>
          {r.formule && <span>· {r.formule}</span>}
          {r.level && <span>· {r.level}</span>}
        </div>

        {r.status === "proposed" && r.proposedDate && (
          <div className="rcard-prop">
            📅 Proposé : <strong>{fmtDate(r.proposedDate)}</strong> · {r.proposedSlot}
          </div>
        )}

        {authed && (
          <>
            <div className="rcard-name">{r.name || "—"}</div>
            <div className="rcard-line">
              <span className="k">Tél</span>
              <CopyVal text={r.phone} tag={"p" + r.ref} />
            </div>
            <div className="rcard-line">
              <span className="k">E-mail</span>
              <CopyVal text={r.email} tag={"e" + r.ref} />
            </div>
            {r.message && <div className="rcard-msg">{r.message}</div>}
            <div className="rcard-recu">Reçu le {fmtReceived(r.createdAt)}</div>

            <div className="rcard-actions">
              {r.status !== "confirmed" && !cancelled && (
                <button
                  className="mini ok"
                  disabled={busy === r.ref}
                  onClick={() => confirmAndNotify(r)}
                >
                  {busy === r.ref ? "…" : "✅ Confirmer + e-mail"}
                </button>
              )}
              {r.status === "confirmed" && !cancelled && (
                <button
                  className="mini"
                  disabled={busy === r.ref}
                  onClick={() => confirmAndNotify(r)}
                >
                  {busy === r.ref ? "…" : "✉️ Renvoyer l'e-mail"}
                </button>
              )}
              {!cancelled && (
                <button className="mini" onClick={() => openPropose(r)}>
                  📅 Proposer un créneau
                </button>
              )}
              {!cancelled && (
                <button className="mini warn" onClick={() => setCancelFor(r)}>
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
            </div>
          </>
        )}
      </div>
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
              <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>
                Liste
              </button>
              <button className={view === "day" ? "on" : ""} onClick={() => setView("day")}>
                Par jour
              </button>
            </div>
            <span className="refresh">Actualisé toutes les 30 s</span>
          </div>
        </div>

        {flash && <div className="flash">{flash}</div>}

        {rows.length === 0 ? (
          <p className="muted" style={{ marginTop: 12 }}>
            Aucune réservation.
          </p>
        ) : view === "list" ? (
          <div className="rgrid">
            {rows.map((r, i) => (
              <Card key={r.ref + i} r={r} />
            ))}
          </div>
        ) : (
          <div>
            {days.map((d) => {
              const dayRows = byDay[d];
              const total = dayRows
                .filter((r) => r.status !== "cancelled")
                .reduce((s, r) => s + (Number(r.participants) || 0), 0);
              return (
                <div key={d} className="dayblock">
                  <div className="dayhead">
                    <strong>{fmtDate(d)}</strong>
                    <span className="muted">
                      {dayRows.length} résa · {total} pers.
                    </span>
                  </div>
                  <div className="rgrid">
                    {dayRows.map((r, i) => (
                      <Card key={r.ref + i} r={r} />
                    ))}
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

      {cancelFor && (
        <div className="modal-bg" onClick={() => setCancelFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 4px" }}>Annuler la réservation</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              {cancelFor.name || cancelFor.ref}
              {cancelFor.email ? ` · ${cancelFor.email}` : " · (pas d'e-mail)"}
            </p>
            <div className="modal-actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
              {cancelFor.email && (
                <button
                  className="btn"
                  disabled={busy === cancelFor.ref}
                  onClick={() => doCancel(cancelFor, true)}
                >
                  Annuler + envoyer le mail
                </button>
              )}
              <button
                className="btn secondary"
                disabled={busy === cancelFor.ref}
                onClick={() => doCancel(cancelFor, false)}
              >
                Annuler sans mail
              </button>
              <button className="mini" onClick={() => setCancelFor(null)}>
                Retour
              </button>
            </div>
          </div>
        </div>
      )}

      {proposeFor && (
        <div className="modal-bg" onClick={() => setProposeFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 2px" }}>Proposer un autre créneau</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              À {proposeFor.name || "ce client"}
              {proposeFor.email ? ` · ${proposeFor.email}` : " · (pas d'e-mail)"}
            </p>

            <label>Nouvelle date</label>
            <input type="date" value={propDate} onChange={(e) => setPropDate(e.target.value)} />

            <label>Heure / créneau</label>
            <input
              type="text"
              placeholder="ex. 10:00"
              value={propSlot}
              onChange={(e) => setPropSlot(e.target.value)}
            />

            <label>Message au client</label>
            <div className="tpl-row">
              {TEMPLATES.map((t, i) => (
                <button key={i} type="button" className="mini" onClick={() => setPropMsg(t)}>
                  Modèle {i + 1}
                </button>
              ))}
            </div>
            <textarea
              rows={4}
              value={propMsg}
              onChange={(e) => setPropMsg(e.target.value)}
              placeholder="Votre message (ou choisissez un modèle ci-dessus)"
            />

            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setProposeFor(null)}>
                Annuler
              </button>
              <button
                className="btn"
                disabled={!proposeFor.email || !propDate || !propSlot || busy === proposeFor.ref}
                onClick={submitProposal}
              >
                {busy === proposeFor.ref ? "…" : "Envoyer la proposition"}
              </button>
            </div>
            {!proposeFor.email && (
              <p className="err" style={{ marginTop: 8 }}>
                Pas d'e-mail client : impossible d'envoyer la proposition.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
