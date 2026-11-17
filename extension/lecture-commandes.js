// La mémoire des commandes.
// Courses U n'affiche que les 8 dernières commandes. Ce script tourne sur
// coursesu.com, lit la page « Mes commandes » dans la session ouverte, et
// recopie chaque commande dans le stockage du navigateur pour qu'elle ne se
// perde jamais. Il ne fait que LIRE : il ne touche ni au panier ni au compte.
// Il ne lit rien d'autre que ces deux pages, même sur les pages de connexion
// ou de paiement où il est chargé.

(function () {
  "use strict";

  const DELAI_ENTRE_LECTURES_MS = 6 * 60 * 60 * 1000; // une lecture toutes les 6 heures au plus
  const PAUSE_ENTRE_PAGES_MS = 600; // rythme humain entre deux pages de détail
  const PAGE_LISTE = "/mon-compte/mes-commandes";
  const PAGE_DETAIL = "/mon-compte/mes-commandes/detail?orderId=";
  // Une commande retirée n'est plus relue... une fois sa date passée de 3 jours :
  // si le site l'a mal décrite le premier jour, on se laisse le temps de corriger.
  const FIGEE_APRES_JOURS = 3;
  const VERROU_MAX_MS = 2 * 60 * 1000; // une lecture ne dure jamais plus : verrou périmé au-delà

  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  async function lirePage(chemin) {
    const reponse = await fetch(chemin, { credentials: "include" });
    if (!reponse.ok) throw new Error("page " + chemin + " : code " + reponse.status);
    // Pas connecté : le site renvoie vers /connexion ou vers EspaceClient-Login (vu le 17/11)
    if (/connexion|login/i.test(new URL(reponse.url).pathname)) return null;
    return new DOMParser().parseFromString(await reponse.text(), "text/html");
  }

  function dateIso(texte) {
    const m = String(texte).match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }

  // La carte d'une commande : on remonte depuis son lien jusqu'au bloc le plus
  // large qui ne contient qu'elle, sans jamais atteindre le cadre de la page
  // (avec une seule commande, on lirait sinon le menu et le pied de page).
  function carteDe(doc, id) {
    let el = doc.querySelector(`a[href*="orderId=${id}"]`);
    if (!el) return null;
    for (let niveaux = 0; el.parentElement && niveaux < 12; niveaux++) {
      const parent = el.parentElement;
      if (parent.matches("body, main, html") || parent.querySelector("header, footer, nav")) break;
      const ids = new Set([...parent.querySelectorAll('a[href*="orderId="]')].map((a) => (a.getAttribute("href").match(/orderId=(\d+)/) || [])[1]));
      if (ids.size > 1) break;
      el = parent;
    }
    return el;
  }

  function lireListe(doc) {
    const ids = [...new Set([...doc.querySelectorAll('a[href*="orderId="]')].map((a) => (a.getAttribute("href").match(/orderId=(\d+)/) || [])[1]).filter(Boolean))];
    return ids.map((id) => {
      const texte = (carteDe(doc, id) || {}).textContent || "";
      // « en cours » d'abord : la carte de la commande en cours contient la phrase
      // « ne peut être modifiée ou annulée en ligne », qui n'est pas un statut.
      // Le statut d'une commande annulée s'écrit avec une majuscule : « Annulée ».
      const statut = /en cours/i.test(texte) ? "en_cours" : /Annulée/.test(texte) ? "annulee" : "retiree";
      return { id, statut, date: dateIso(texte) };
    });
  }

  function lireDetail(doc) {
    const lignes = [];
    for (const groupe of doc.querySelectorAll(".su-order-products-group-content")) {
      const titre = groupe.previousElementSibling ? groupe.previousElementSibling.textContent : "";
      const rayon = titre.replace(/\s*\(\d+\)\s*$/, "").trim();
      for (const article of groupe.children) {
        // l'identifiant est porté par le bloc du produit lui-même
        const fiche = article.matches("[data-list-product-id]") ? article : article.querySelector("[data-list-product-id]");
        if (!fiche) continue;
        const texte = article.textContent.replace(/\s+/g, " ");
        const prix = (texte.match(/(\d+,\d{2}) €/) || [])[1];
        lignes.push({
          pid: fiche.getAttribute("data-list-product-id"),
          nom: (fiche.getAttribute("data-list-product-name") || "").trim(),
          rayon,
          qte: parseInt((texte.match(/Qté : (\d+)/) || [])[1] || "0", 10),
          prix: prix ? parseFloat(prix.replace(",", ".")) : null,
        });
      }
    }
    return lignes;
  }

  const jours = (dateIso) => (Date.now() - new Date(dateIso + "T12:00:00").getTime()) / 86400000;

  // Une commande lue est-elle crédible ? Sinon on refuse de l'enregistrer :
  // mieux vaut une erreur visible qu'un historique faussé en silence.
  function controler(id, date, lignes, statut) {
    if (!date) return "commande " + id + " sans date lisible : le site a peut-être changé";
    if (statut === "annulee") return null;
    if (!lignes.length) return "commande " + id + " illisible : le site a peut-être changé";
    if (lignes.some((l) => !l.pid)) return "commande " + id + " : produit sans identifiant, le site a peut-être changé";
    if (lignes.every((l) => !l.qte)) return "commande " + id + " : quantités illisibles, le site a peut-être changé";
    return null;
  }

  // Deux onglets coursesu.com, ou un clic pendant la lecture automatique : une seule lecture à la fois.
  let lectureLocale = null;
  function memoriser(force) {
    if (!lectureLocale) lectureLocale = memoriserSansDoublon(force).finally(() => { lectureLocale = null; });
    return lectureLocale;
  }

  async function memoriserSansDoublon(force) {
    const { lectureEnCours } = await chrome.storage.local.get("lectureEnCours");
    if (lectureEnCours && Date.now() - lectureEnCours < VERROU_MAX_MS) return; // un autre onglet lit déjà
    await chrome.storage.local.set({ lectureEnCours: Date.now() });
    try {
      await lire(force);
    } finally {
      await chrome.storage.local.remove("lectureEnCours");
    }
  }

  async function lire(force) {
    const { commandes = {}, derniereLecture } = await chrome.storage.local.get(["commandes", "derniereLecture"]);
    // La pause ne vaut qu'après une lecture réussie : une lecture ratée (pas encore
    // connecté, page lente) se retente au chargement de page suivant.
    const recente = derniereLecture && !derniereLecture.erreur && Date.now() - derniereLecture.quand < DELAI_ENTRE_LECTURES_MS;
    if (!force && recente) return;

    const bilan = { quand: Date.now(), nouvelles: 0, misesAJour: 0, erreur: null };
    try {
      const liste = await lirePage(PAGE_LISTE);
      if (!liste) {
        bilan.erreur = "Pas connecté à Courses U : connecte-toi pour que tes commandes soient lues.";
      } else {
        const resumes = lireListe(liste);
        if (!resumes.length) {
          throw new Error(Object.keys(commandes).length
            ? "aucune commande trouvée sur la page : le site a peut-être changé"
            : "Aucune commande sur ton compte Courses U pour l'instant. Passe ta première commande, Cartloop l'apprendra ensuite.");
        }
        for (const r of resumes) {
          const connue = commandes[r.id];
          // terminée, déjà copiée, et assez ancienne pour ne plus bouger
          if (connue && connue.statut === "retiree" && connue.date && jours(connue.date) > FIGEE_APRES_JOURS) continue;
          await pause(PAUSE_ENTRE_PAGES_MS);
          const detail = await lirePage(PAGE_DETAIL + r.id);
          const lignes = detail ? lireDetail(detail) : [];
          const date = r.date || (connue && connue.date);
          const probleme = controler(r.id, date, lignes, r.statut);
          if (probleme) throw new Error(probleme);
          commandes[r.id] = { id: r.id, date, statut: r.statut, lignes, luLe: Date.now() };
          connue ? bilan.misesAJour++ : bilan.nouvelles++;
          await chrome.storage.local.set({ commandes }); // commande par commande : rien de perdu si la page se ferme
        }
      }
    } catch (e) {
      bilan.erreur = String(e.message || e);
    }
    bilan.total = Object.keys(commandes).length;
    await chrome.storage.local.set({ derniereLecture: bilan });
  }

  chrome.runtime.onMessage.addListener((message, _expediteur, repondre) => {
    if (message && message.type === "lire-maintenant") {
      memoriser(true).then(() => repondre({ ok: true }));
      return true;
    }
  });

  memoriser(false);
})();
