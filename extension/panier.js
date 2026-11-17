// Remplir le panier Courses U.
// Reçoit de la fenêtre de l'extension la liste à ajouter, et l'ajoute produit par
// produit, exactement comme le bouton « Ajouter au panier » du site (même adresse,
// mêmes champs). Ensuite, il RELIT le vrai panier pour vérifier ce qui y est :
// le bilan ne repose jamais sur une supposition. Si un produit manque, ses
// remplaçants sont essayés dans l'ordre. Ne passe jamais commande : le créneau
// et la validation restent à la personne.
//
// Le bilan et l'avancement sont écrits dans le stockage de l'extension : la
// fenêtre peut être fermée pendant le remplissage, elle les retrouve à la
// réouverture.

(function () {
  "use strict";

  const ADRESSE_AJOUT = "/on/demandware.store/Sites-DigitalU-Site/fr_FR/Cart-AddProduct?format=ajax";
  const PAGE_PANIER = "/panier";
  // Entre deux ajouts : 0,2 à 0,45 seconde, jamais régulier. Le site met déjà
  // environ une demi-seconde à répondre à chaque ajout ; on ne lance jamais deux
  // ajouts en même temps (le panier du site pourrait en perdre un).
  const PAUSE_MIN_MS = 200;
  const PAUSE_ECART_MS = 250;
  const CODES_ARRET = [401, 403, 429]; // le site refuse ou freine : on s'arrête net
  const ECHECS_DE_SUITE_MAX = 3;
  const DUREE_MAX_MS = 10 * 60 * 1000; // au-delà, un remplissage « en cours » est considéré interrompu

  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const pauseHumaine = () => pause(PAUSE_MIN_MS + Math.random() * PAUSE_ECART_MS);
  const vaVersConnexion = (url) => /connexion|login/i.test(new URL(url).pathname);

  async function jetonDeSecurite() {
    const champ = document.querySelector('input[name="csrf_token"]');
    if (champ && champ.value) return champ.value;
    const page = await fetch("/", { credentials: "include" }).then((r) => r.text());
    const doc = new DOMParser().parseFromString(page, "text/html");
    const autre = doc.querySelector('input[name="csrf_token"]');
    return autre ? autre.value : null;
  }

  async function estConnecte() {
    const r = await fetch("/mon-compte/mes-commandes", { credentials: "include" });
    return !vaVersConnexion(r.url);
  }

  // Le panier tel que le site l'affiche : { pid: quantité }. null si illisible.
  // Chaque produit du panier est une ligne « cart-row » qui porte son
  // identifiant (data-pid) et un champ « Quantity » (vu le 2026-11-17).
  async function lirePanier() {
    try {
      const r = await fetch(PAGE_PANIER, { credentials: "include" });
      if (!r.ok || vaVersConnexion(r.url)) return null;
      const doc = new DOMParser().parseFromString(await r.text(), "text/html");
      const panier = {};
      for (const rangee of doc.querySelectorAll("li.cart-row")) {
        const pid = (rangee.querySelector("[data-pid]") || { getAttribute: () => null }).getAttribute("data-pid");
        const champ = rangee.querySelector('input[name="Quantity"]');
        if (pid && champ) panier[pid] = (panier[pid] || 0) + (parseInt(champ.value, 10) || 0);
      }
      return panier;
    } catch (e) {
      return null;
    }
  }

  // Met la quantité voulue dans le panier pour ce produit (la quantité est
  // absolue : relancer le remplissage ne double rien). Renvoie { ok, arret, raison }.
  async function ajouter(pid, qte, jeton) {
    const corps = new URLSearchParams({
      Quantity: String(qte),
      cartAction: "add",
      pid: String(pid),
      update: "true",
      modifiableOrderID: "",
      fullview: "false",
      location: "",
      quantity: String(qte),
      csrf_token: jeton,
    });
    let r;
    try {
      r = await fetch(ADRESSE_AJOUT, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
        body: corps.toString(),
      });
    } catch (e) {
      return { ok: false, raison: "pas de réseau" };
    }
    if (CODES_ARRET.includes(r.status)) return { ok: false, arret: true, raison: `le site refuse les ajouts (code ${r.status})` };
    if (r.redirected && vaVersConnexion(r.url)) return { ok: false, arret: true, raison: "la session Courses U a expiré" };
    if (!r.ok) return { ok: false, raison: "réponse " + r.status };
    let donnees = null;
    try { donnees = JSON.parse(await r.text()); } catch (e) { /* réponse en HTML : la relecture du panier tranchera */ }
    if (donnees && (donnees.error || donnees.success === false)) {
      return { ok: false, raison: String(donnees.message || donnees.errorMessage || "refusé par le site") };
    }
    return { ok: true };
  }

  async function enregistrer(etat) {
    await chrome.storage.local.set({ remplissage: etat });
    chrome.runtime.sendMessage({ type: "remplissage" }).catch(() => {}); // la fenêtre, si elle est ouverte
  }

  // articles : [{ pid, nom, qte, remplacants: [{ pid, nom }] }]
  async function remplir(articles) {
    const { remplissage } = await chrome.storage.local.get("remplissage");
    if (remplissage && remplissage.enCours && Date.now() - remplissage.debut < DUREE_MAX_MS) {
      return { erreur: "Un remplissage est déjà en cours : attends qu'il se termine." };
    }
    if (!(await estConnecte())) return { erreur: "Tu n'es pas connecté à Courses U : connecte-toi puis reclique." };
    const jeton = await jetonDeSecurite();
    if (!jeton) return { erreur: "Impossible de lire le jeton de sécurité du site : recharge la page puis reclique." };

    const etat = {
      enCours: true,
      debut: Date.now(),
      fin: null,
      verifie: false,
      arret: null,
      lignes: articles.map((a) => ({ pid: a.pid, nom: a.nom, qte: a.qte, statut: "attente" })),
    };
    await enregistrer(etat);

    // 1. Ajouter chaque produit
    let echecsDeSuite = 0;
    for (const [rang, a] of articles.entries()) {
      await pauseHumaine();
      const res = await ajouter(a.pid, a.qte, jeton);
      const ligne = etat.lignes[rang];
      ligne.statut = res.ok ? "envoye" : "refuse";
      if (!res.ok) ligne.raison = res.raison;
      echecsDeSuite = res.ok ? 0 : echecsDeSuite + 1;
      await enregistrer(etat);
      if (res.arret || echecsDeSuite >= ECHECS_DE_SUITE_MAX) {
        etat.arret = res.arret ? res.raison : "trois refus de suite du site";
        break;
      }
    }

    // 2. Relire le vrai panier, puis essayer les remplaçants de ce qui manque
    let panier = etat.arret ? null : await lirePanier();
    if (panier) {
      const manquants = articles.map((a, i) => ({ a, ligne: etat.lignes[i] })).filter(({ a }) => !panier[a.pid]);
      for (const { a, ligne } of manquants) {
        for (const r of a.remplacants || []) {
          if (panier[r.pid]) { ligne.par = { pid: r.pid, nom: r.nom }; break; } // déjà au panier
          await pauseHumaine();
          const res = await ajouter(r.pid, a.qte, jeton);
          if (res.arret) { etat.arret = res.raison; break; }
          if (res.ok) { ligne.par = { pid: r.pid, nom: r.nom }; break; }
        }
        if (etat.arret) break;
      }
      if (manquants.some(({ ligne }) => ligne.par)) panier = await lirePanier();
    }

    // 3. Le bilan, d'après le panier relu
    etat.verifie = !!panier;
    for (const ligne of etat.lignes) {
      if (ligne.statut === "attente") { ligne.statut = "non_traite"; continue; }
      if (!panier) { ligne.statut = ligne.statut === "envoye" ? "ajoute" : "echec"; continue; }
      const recu = panier[ligne.pid] || 0;
      const recuRemplacant = ligne.par ? panier[ligne.par.pid] || 0 : 0;
      if (recu >= ligne.qte) ligne.statut = "ajoute";
      else if (recu > 0) { ligne.statut = "partiel"; ligne.recu = recu; }
      else if (recuRemplacant > 0) { ligne.statut = "remplace"; ligne.recu = recuRemplacant; }
      else { ligne.statut = "echec"; ligne.raison = ligne.raison || "absent du panier : indisponible ?"; }
    }
    etat.enCours = false;
    etat.fin = Date.now();
    await enregistrer(etat);
    // la page se recharge pour afficher le panier à jour (la fenêtre n'a pas besoin d'être ouverte)
    setTimeout(() => location.reload(), 600);
    return { remplissage: etat };
  }

  chrome.runtime.onMessage.addListener((message, _expediteur, repondre) => {
    if (message && message.type === "remplir-panier") {
      remplir(message.articles)
        .then(repondre)
        .catch(async (e) => {
          const { remplissage } = await chrome.storage.local.get("remplissage");
          if (remplissage && remplissage.enCours) await enregistrer({ ...remplissage, enCours: false, fin: Date.now(), arret: String(e.message || e) });
          repondre({ erreur: String(e.message || e) });
        });
      return true;
    }
  });
})();
