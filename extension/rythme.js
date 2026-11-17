// Calcul des rythmes d'achat. Aucune dépendance, aucun accès au réseau :
// on lui donne des commandes, il rend des chiffres. Le même fichier sert à
// l'extension (dans le navigateur) et aux tests (avec Node).
//
// Règle de base : on fait les courses une fois par semaine. Le temps se compte donc en COMMANDES, pas en jours : une
// commande = une semaine. Les trous du calendrier (voyage, quelqu'un d'autre
// a fait les courses) ne faussent pas les rythmes.

(function (racine) {
  "use strict";

  const RAYONS_QUOTIDIEN = ["hygiene et beaute", "entretien et nettoyage"];
  const NB_ECARTS_RETENUS = 3; // le rythme suit les trois derniers rachats
  const BASE_RYTHME_MAX = 2; // acheté au moins une semaine sur deux : liste de base
  const BASE_RECENCE_MAX = 2; // ... et acheté dans l'une des deux dernières commandes
  // Un seul écart mesuré, c'est trop peu quand la famille a une durée de départ :
  // deux shampoings achetés coup sur coup ne veulent pas dire « un par semaine ».
  const ECARTS_MIN_SI_DEPART = 2;
  // Habitude arrêtée : plus achetée depuis trois fois son rythme (et au moins 4 semaines).
  // On ne la rappelle plus ; elle revient d'elle-même au prochain achat.
  const FACTEUR_ARRET = 3;
  const ARRET_MIN_SEMAINES = 4;

  function normaliser(texte) {
    return String(texte || "")
      .toLowerCase()
      .replace(/œ/g, "oe")
      .replace(/æ/g, "ae")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function contientMot(nomNormalise, mot) {
    const m = normaliser(mot);
    return (" " + nomNormalise + " ").includes(" " + m + " ");
  }

  function familleDe(nomProduit, familles) {
    const n = normaliser(nomProduit);
    for (const f of familles) {
      if (f.mots.some((mot) => contientMot(n, mot))) return f;
    }
    return null;
  }

  function mediane(valeurs) {
    if (!valeurs.length) return null;
    const v = [...valeurs].sort((a, b) => a - b);
    const milieu = Math.floor(v.length / 2);
    return v.length % 2 ? v[milieu] : (v[milieu - 1] + v[milieu]) / 2;
  }

  function estQuotidien(rayon) {
    return RAYONS_QUOTIDIEN.includes(normaliser(rayon));
  }

  // Clé d'un produit : sa famille s'il en a une, sinon le produit lui-même.
  // alias : { pid du remplaçant: pid du produit de la liste } ; un remplaçant
  // compte comme le produit qu'il remplace (des œufs d'une autre marque quand
  // les habituels manquent ne sont pas une nouvelle habitude).
  function cleDe(nom, pid, familles, alias) {
    const f = familleDe(nom, familles);
    if (f) return "f:" + f.nom;
    return "p:" + ((alias && alias[pid]) || pid);
  }

  function aliasDe(maListe) {
    const alias = {};
    for (const b of (maListe && maListe.base) || []) for (const r of b.remplacants || []) if (r && r.pid) alias[r.pid] = b.pid;
    return alias;
  }

  // commandes : [{ id, date: "AAAA-MM-JJ", statut, lignes: [{ pid, nom, rayon, qte }] }]
  // familles  : le tableau "familles" de familles.json
  // rythmesImposes : { cle: semaines } ; les rythmes fixés à la main
  // alias : voir cleDe
  function analyser(commandes, familles, rythmesImposes, alias) {
    const imposes = rythmesImposes || {};
    const valides = commandes
      .filter((c) => c && c.statut !== "annulee" && c.date)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const nbCommandes = valides.length;
    const parFamille = new Map();

    valides.forEach((commande, indice) => {
      for (const ligne of commande.lignes || []) {
        if (!ligne || !ligne.qte || !ligne.pid) continue;
        const f = familleDe(ligne.nom, familles);
        const cle = cleDe(ligne.nom, ligne.pid, familles, alias);
        if (!parFamille.has(cle)) {
          parFamille.set(cle, {
            cle,
            nom: f ? f.nom : ligne.nom,
            dureeDepart: f && f.duree_depart ? f.duree_depart : null,
            quotidien: estQuotidien(ligne.rayon),
            achats: [],
          });
        }
        const fam = parFamille.get(cle);
        const dernier = fam.achats[fam.achats.length - 1];
        if (dernier && dernier.indice === indice) {
          dernier.qte += ligne.qte; // deux références de la même famille dans une commande
          dernier.produits.push({ pid: ligne.pid, nom: ligne.nom, qte: ligne.qte });
        } else {
          fam.achats.push({
            indice,
            date: commande.date,
            qte: ligne.qte,
            produits: [{ pid: ligne.pid, nom: ligne.nom, qte: ligne.qte }],
          });
        }
      }
    });

    const resultat = [];
    for (const fam of parFamille.values()) {
      const indices = fam.achats.map((a) => a.indice);
      const ecarts = indices.slice(1).map((v, i) => v - indices[i]);
      const recents = ecarts.slice(-NB_ECARTS_RETENUS);
      const ecartsMin = fam.dureeDepart ? ECARTS_MIN_SI_DEPART : 1;
      const mesure = ecarts.length >= ecartsMin ? mediane(recents) : null;
      const impose = imposes[fam.cle] || null;
      const rythme = impose || (mesure !== null ? mesure : fam.dureeDepart);
      const dernierAchat = fam.achats[fam.achats.length - 1];
      // 0 = acheté à la toute dernière commande (celle de cette semaine)
      const commandesDepuis = nbCommandes - 1 - dernierAchat.indice;
      // à la prochaine commande, combien de semaines se seront écoulées depuis l'achat
      const semainesALaProchaine = commandesDepuis + 1;
      resultat.push({
        cle: fam.cle,
        nom: fam.nom,
        quotidien: fam.quotidien,
        nbAchats: fam.achats.length,
        ecarts,
        rythme, // en semaines (commandes), null si inconnu
        origineRythme: impose ? "impose" : mesure !== null ? "mesure" : rythme !== null ? "depart" : null,
        commandesDepuis,
        semainesALaProchaine,
        arretee: !impose && rythme !== null && semainesALaProchaine > Math.max(ARRET_MIN_SEMAINES, FACTEUR_ARRET * rythme),
        qteHabituelle: Math.max(1, Math.round(mediane(fam.achats.slice(-3).map((a) => a.qte)))),
        dernierAchat: dernierAchat.date,
        indicesAchats: indices, // rang des commandes où la famille a été achetée (0 = la plus ancienne)
        aRacheter: dernierAchat.produits, // ce qu'on remettra au panier
      });
    }
    return { nbCommandes, familles: resultat };
  }

  // Liste de base PROPOSÉE (point de départ, ou suggestion de changement) :
  // l'alimentaire acheté au moins une semaine sur deux, et encore acheté récemment.
  function proposerBase(analyse) {
    return analyse.familles
      .filter((f) => !f.quotidien && f.origineRythme === "mesure" && f.rythme <= BASE_RYTHME_MAX && f.semainesALaProchaine <= BASE_RECENCE_MAX)
      .sort((a, b) => a.rythme - b.rythme || b.nbAchats - a.nbAchats);
  }

  // Rappels pour la prochaine commande : tout ce qui n'est ni dans la base ni
  // écarté à la main, et dont le délai habituel est atteint.
  function rappels(analyse, clesBase, clesExclues) {
    const ecartees = new Set([...(clesBase || []), ...(clesExclues || [])]);
    return analyse.familles
      .filter((f) => !ecartees.has(f.cle) && f.rythme !== null && !f.arretee && f.semainesALaProchaine >= Math.round(f.rythme))
      .sort((a, b) => b.semainesALaProchaine / b.rythme - a.semainesALaProchaine / a.rythme);
  }

  // La commande de la semaine, à partir des choix de la personne (sa liste) :
  //   base   : [{ nom, pid, qte, toutesLes, remplacants }] ; toutesLes = 1 chaque semaine, 2 une sur deux...
  //   exclus : [{ nom, pid }]  jamais rappelés
  //   rythmes: [{ nom, pid, toutesLes }]  rythme fixé à la main pour un rappel
  function preparerCommande(commandes, familles, maListe) {
    const alias = aliasDe(maListe);
    const cle = (x) => cleDe(x.nom, x.pid, familles, alias);
    const imposes = {};
    for (const r of maListe.rythmes || []) imposes[cle(r)] = r.toutesLes;
    const analyse = analyser(commandes, familles, imposes, alias);
    const parCle = new Map(analyse.familles.map((f) => [f.cle, f]));

    const base = (maListe.base || []).map((item) => {
      const f = parCle.get(cle(item));
      const toutesLes = item.toutesLes || 1;
      const semaines = f ? f.semainesALaProchaine : null;
      return { ...item, cle: cle(item), semainesALaProchaine: semaines, aPrendre: toutesLes <= 1 || semaines === null || semaines >= toutesLes };
    });
    const clesBase = base.map((b) => b.cle);
    const clesExclues = (maListe.exclus || []).map(cle);
    return { analyse, base, rappels: rappels(analyse, clesBase, clesExclues) };
  }

  // Propositions de changement de la liste de base : l'outil PROPOSE, la
  // personne valide ; rien ne change tout seul. On ne regarde que les commandes
  // passées APRÈS sa dernière décision sur le produit (validation de la liste,
  // oui/non à une proposition, ajout ou retrait à la main), sinon on lui
  // reproposerait ce qu'elle vient de trancher.
  const NB_COMMANDES_PREUVE = 3;

  function proposerChangements(commandes, familles, maListe) {
    const alias = aliasDe(maListe);
    const cle = (x) => cleDe(x.nom, x.pid, familles, alias);
    const decisions = maListe.decisions || {};
    const valides = commandes
      .filter((c) => c && c.statut !== "annulee" && c.date)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const reference = (k) => [maListe.valideeLe || "", decisions[k] || ""].sort().pop();
    const apres = (k) => valides.filter((c) => c.date > reference(k));
    const quantite = (commande, k) => (commande.lignes || []).filter((l) => l && l.qte && cle(l) === k).reduce((s, l) => s + l.qte, 0);

    const propositions = [];
    const clesBase = new Set();
    for (const item of maListe.base || []) {
      const k = cle(item);
      clesBase.add(k);
      const n = item.toutesLes || 1;
      const cs = apres(k);
      const qtes = cs.map((c) => quantite(c, k));
      if (cs.length >= NB_COMMANDES_PREUVE * n && qtes.slice(-NB_COMMANDES_PREUVE * n).every((q) => q === 0)) {
        propositions.push({ type: "retirer", cle: k, nom: item.nom, commandes: NB_COMMANDES_PREUVE * n });
        continue;
      }
      const achats = qtes.filter((q) => q > 0).slice(-NB_COMMANDES_PREUVE);
      if (achats.length >= NB_COMMANDES_PREUVE) {
        const m = Math.round(mediane(achats));
        if (m !== item.qte) propositions.push({ type: "quantite", cle: k, nom: item.nom, avant: item.qte, apres: m });
      }
    }

    const exclues = new Set((maListe.exclus || []).map(cle));
    const vues = new Map(); // cle -> dernière ligne achetée
    for (const c of valides) for (const l of c.lignes || []) if (l && l.qte && l.pid) vues.set(cle(l), l);
    for (const [k, ligne] of vues) {
      if (clesBase.has(k) || exclues.has(k) || estQuotidien(ligne.rayon)) continue;
      const cs = apres(k).slice(-NB_COMMANDES_PREUVE);
      if (cs.length < NB_COMMANDES_PREUVE) continue;
      const qtes = cs.map((c) => quantite(c, k));
      if (qtes.every((q) => q > 0)) {
        propositions.push({ type: "ajouter", cle: k, nom: ligne.nom, pid: ligne.pid, qte: Math.round(mediane(qtes)) });
      }
    }
    return propositions;
  }

  const api = { normaliser, familleDe, cleDe, aliasDe, mediane, analyser, proposerBase, rappels, preparerCommande, proposerChangements };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.Rythme = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
