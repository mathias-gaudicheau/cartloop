// Page « Sauvegarde » : télécharger tout ce que Cartloop sait, ou le restaurer.
// Ouverte dans un onglet (et non dans la fenêtre de l'extension, qui se ferme
// dès qu'on choisit un fichier).

const $ = (id) => document.getElementById(id);
const CLES_SAUVEES = ["commandes", "maListe"];
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const dateFr = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

function resumer(commandes, maListe) {
  const liste = Object.values(commandes || {});
  const dates = liste.map((c) => c.date).filter(Boolean).sort();
  const morceaux = [pluriel(liste.length, "commande") + (dates.length ? ` (du ${dateFr(dates[0])} au ${dateFr(dates[dates.length - 1])})` : "")];
  morceaux.push(maListe ? `une liste de base de ${pluriel((maListe.base || []).length, "produit")}` : "pas de liste de base");
  return morceaux.join(" et ");
}

async function afficherEtat() {
  const { commandes, maListe } = await chrome.storage.local.get(CLES_SAUVEES);
  $("etat-actuel").textContent = `Dans ce navigateur aujourd'hui : ${resumer(commandes, maListe)}.`;
}

$("telecharger").addEventListener("click", async () => {
  const donnees = await chrome.storage.local.get(CLES_SAUVEES);
  const fichier = { _cartloop: { format: 1, version: chrome.runtime.getManifest().version, exporteLe: new Date().toISOString() }, ...donnees };
  const blob = new Blob([JSON.stringify(fichier, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cartloop-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

/* ---------- Restaurer ---------- */
const estDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const ligneValide = (l) => l && typeof l === "object" && typeof l.pid === "string" && l.pid && Number.isFinite(l.qte) && l.qte >= 0 && typeof l.nom === "string";
const commandeValide = (c) => c && typeof c === "object" && typeof c.id === "string" && estDate(c.date)
  && ["retiree", "annulee", "en_cours"].includes(c.statut) && Array.isArray(c.lignes) && c.lignes.every(ligneValide);
const produitValide = (b) => b && typeof b === "object" && typeof b.pid === "string" && b.pid && typeof b.nom === "string" && Number.isInteger(b.qte) && b.qte > 0;

// Ne garde que ce qui est lisible ; dit ce qui a été écarté.
function verifier(fichier) {
  if (!fichier || typeof fichier !== "object" || Array.isArray(fichier)) throw new Error("Ce fichier n'est pas une sauvegarde Cartloop.");
  if (!fichier.commandes && !fichier.maListe) throw new Error("Ce fichier ne contient ni commandes ni liste : ce n'est pas une sauvegarde Cartloop.");
  const commandes = {};
  let ecartees = 0;
  for (const c of Object.values(fichier.commandes || {})) {
    if (commandeValide(c)) commandes[c.id] = c;
    else ecartees++;
  }
  let maListe = null;
  if (fichier.maListe) {
    const m = fichier.maListe;
    if (!m || typeof m !== "object" || !Array.isArray(m.base)) throw new Error("La liste de base de ce fichier est illisible.");
    const base = m.base.filter(produitValide);
    ecartees += m.base.length - base.length;
    maListe = {
      ...m,
      base,
      exclus: Array.isArray(m.exclus) ? m.exclus.filter((x) => x && typeof x.pid === "string") : [],
      rythmes: Array.isArray(m.rythmes) ? m.rythmes.filter((x) => x && typeof x.pid === "string" && Number.isInteger(x.toutesLes)) : [],
      decisions: m.decisions && typeof m.decisions === "object" ? m.decisions : {},
    };
  }
  return { commandes, maListe, ecartees };
}

function message(texte, alerte) {
  const apercu = $("apercu");
  apercu.hidden = false;
  apercu.className = "apercu" + (alerte ? " alerte" : "");
  apercu.textContent = "";
  const p = document.createElement("p");
  p.textContent = texte;
  apercu.append(p);
  return apercu;
}

$("fichier").addEventListener("change", async () => {
  const f = $("fichier").files[0];
  $("fichier").value = "";
  if (!f) return;
  let lu;
  try {
    lu = verifier(JSON.parse(await f.text()));
  } catch (e) {
    message(e instanceof SyntaxError ? "Ce fichier n'est pas lisible (ce n'est pas un fichier JSON)." : e.message, true);
    return;
  }
  const apercu = message(`Ce fichier contient ${resumer(lu.commandes, lu.maListe)}.` + (lu.ecartees ? ` ${pluriel(lu.ecartees, "élément abîmé")} sera ignoré.` : ""));
  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = "bouton";
  bouton.textContent = "Restaurer";
  bouton.addEventListener("click", async () => {
    bouton.disabled = true;
    const actuel = await chrome.storage.local.get(CLES_SAUVEES);
    // On ajoute, on n'efface pas : en cas de doublon, la version lue le plus récemment gagne.
    const commandes = { ...(actuel.commandes || {}) };
    for (const [id, c] of Object.entries(lu.commandes)) {
      if (!commandes[id] || (c.luLe || 0) > (commandes[id].luLe || 0)) commandes[id] = c;
    }
    const aEcrire = { commandes };
    if (lu.maListe) aEcrire.maListe = lu.maListe;
    await chrome.storage.local.set(aEcrire);
    const ok = document.createElement("p");
    ok.className = "ok";
    ok.textContent = "C'est restauré. Tu peux fermer cet onglet et rouvrir Cartloop.";
    bouton.replaceWith(ok);
    afficherEtat();
  });
  apercu.append(bouton);
});

afficherEtat();
