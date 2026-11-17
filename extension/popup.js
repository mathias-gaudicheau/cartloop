// Fenêtre de Cartloop : la commande de la semaine, les propositions, le premier
// lancement, et le bouton « Remplir mon panier ».
// Les calculs sont dans rythme.js ; ici on ne fait qu'afficher et transmettre.

const $ = (id) => document.getElementById(id);
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const SITE = "https://www.coursesu.com/";
const QTE_MAX = 10; // le site plafonne la plupart des produits à 10
const BILAN_VISIBLE_MS = 12 * 60 * 60 * 1000; // le bilan d'un remplissage reste affiché 12 heures

const etat = {
  commandes: [], nbCommandes: 0, familles: [], maListe: null, articles: [], lecture: null, nbBase: 0,
  remplissage: null, refaire: null, confirmerRefaire: false, annulation: null, ajout: false,
};

/* ---------- Icônes (un trait, une épaisseur) ---------- */
const ICONES = {
  coche: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  moins: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 5h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 5h6M5 2v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  croix: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  echange: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4.2h7.5L7.6 2.3M10 7.8H2.5l1.9 1.9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alerte: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 3v3.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="6" cy="9" r=".95" fill="currentColor"/></svg>',
};

function el(balise, attributs = {}, ...enfants) {
  const e = document.createElement(balise);
  for (const [k, v] of Object.entries(attributs)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v; // uniquement les icônes fixes ci-dessus, jamais du texte venu du site
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v === true ? "" : v);
  }
  for (const enfant of enfants) if (enfant !== null && enfant !== undefined && enfant !== false) e.append(enfant);
  return e;
}

/* ---------- Données ---------- */
async function chargerJson(fichier) {
  const r = await fetch(chrome.runtime.getURL(fichier));
  if (!r.ok) throw new Error(fichier + " introuvable");
  return r.json();
}

const enregistrerMaListe = () => chrome.storage.local.set({ maListe: etat.maListe });
const cleDe = (x) => Rythme.cleDe(x.nom, x.pid, etat.familles, Rythme.aliasDe(etat.maListe));

// Toute décision prise à la main sur un produit (ajout, retrait, oui/non à une
// proposition) repousse les propositions le concernant de trois commandes.
function decider(cle) {
  etat.maListe.decisions = etat.maListe.decisions || {};
  etat.maListe.decisions[cle] = aujourdhui();
}

/* ---------- Mise en forme ---------- */
// « Ratatouille cuisinée CASSEGRAIN - Boîte 380g » -> « Ratatouille cuisinée Cassegrain » + « Boîte 380g »
function decouper(nom) {
  const propre = String(nom).replace(/\s+/g, " ").trim()
    .replace(/\b([A-ZÀ-Ý'’]{3,})\b/g, (m) => m.charAt(0) + m.slice(1).toLowerCase());
  const m = propre.match(/^(.+?)(?:\s+-\s+|,\s+)(.+)$/);
  return m ? [m[1], m[2]] : [propre, ""];
}

function lundiDeLaSemaine() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

function ilYa(quand) {
  const min = Math.round((Date.now() - quand) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${pluriel(Math.round(h / 24), "jour")}`;
}

/* ---------- Une ligne de produit ---------- */
let compteurId = 0;
function ligne(article, detail, { actions = null, retirer = null, dabord = false } = {}) {
  const id = "p" + compteurId++;
  const [nom, precision] = decouper(article.nom);
  const caseACocher = el("input", { type: "checkbox", id, checked: article.coche, "aria-label": nom });
  const pastille = el("span", { class: "pastille", "aria-label": `Quantité ${article.qte}` }, String(article.qte));
  const moins = el("button", { type: "button", "aria-label": "Un de moins", title: "Un de moins", html: ICONES.moins });
  const plus = el("button", { type: "button", "aria-label": "Un de plus", title: "Un de plus", html: ICONES.plus });
  // sur un rappel, « acheté il y a… » passe avant la description du produit, sinon elle le coupe
  const texteDetail = (actions || dabord ? [detail, precision] : [precision, detail]).filter(Boolean).join(" · ");
  const boutonRetirer = retirer
    ? el("button", { type: "button", class: "retirer", "aria-label": "Retirer de ma liste", title: "Retirer de ma liste", html: ICONES.croix, onclick: (ev) => { ev.preventDefault(); retirer(); } })
    : null;
  const noeud = el("label", { class: "ligne" + (article.coche ? "" : " decochee"), for: id, title: article.nom },
    pastille,
    el("span", { class: "texte" }, el("span", { class: "nom" }, nom),
      el("span", { class: "detail" }, texteDetail),
      actions ? el("span", { class: "actions" }, ...actions) : null),
    el("span", { class: "reglage" }, moins, plus, boutonRetirer),
    el("span", { class: "case" }, caseACocher, el("span", { html: ICONES.coche })));

  const majQte = () => {
    pastille.textContent = String(article.qte);
    pastille.setAttribute("aria-label", `Quantité ${article.qte}`);
    moins.disabled = article.qte <= 1;
    plus.disabled = article.qte >= QTE_MAX;
  };
  const changer = (delta) => (ev) => { ev.preventDefault(); article.qte = Math.min(QTE_MAX, Math.max(1, article.qte + delta)); majQte(); majResume(); };
  moins.addEventListener("click", changer(-1));
  plus.addEventListener("click", changer(1));
  caseACocher.addEventListener("change", () => { article.coche = caseACocher.checked; noeud.classList.toggle("decochee", !article.coche); majResume(); });
  majQte();
  article.noeud = noeud;
  return noeud;
}

const titreSection = (gauche, droite = "") => el("h2", { class: "section-titre" }, el("span", {}, gauche), el("span", {}, droite));
const lien = (texte, action) => el("button", { type: "button", class: "lien-ligne", onclick: (ev) => { ev.preventDefault(); action(); } }, texte);

/* ---------- Encarts : propositions, bilan, confirmation ---------- */
function encart(texte, boutons, classe = "") {
  return el("div", { class: "encart " + classe }, ...texte,
    boutons.length ? el("div", { class: "boutons" }, ...boutons.map(([libelle, action, type]) => el("button", { type: "button", class: type || "oui", onclick: action }, libelle))) : null);
}

function encartsPropositions() {
  const props = Rythme.proposerChangements(etat.commandes, etat.familles, etat.maListe);
  return props.map((p) => {
    const [nom] = decouper(p.nom);
    const texte = p.type === "retirer"
      ? `tu n'en as plus pris depuis ${p.commandes} semaines. Je le retire de ta liste ?`
      : p.type === "quantite"
        ? `tu en prends ${p.apres} depuis trois semaines, pas ${p.avant}.`
        : `pris chacune des trois dernières semaines. Je l'ajoute à ta liste (${p.qte} par semaine) ?`;
    const [oui, non] = p.type === "retirer" ? ["Retirer", "Garder"] : p.type === "quantite" ? [`Passer à ${p.apres}`, `Garder ${p.avant}`] : ["Ajouter", "Non merci"];
    const repondre = async (accepte) => {
      const m = etat.maListe;
      decider(p.cle);
      if (accepte) {
        if (p.type === "retirer") m.base = m.base.filter((b) => cleDe(b) !== p.cle);
        if (p.type === "quantite") m.base.find((b) => cleDe(b) === p.cle).qte = p.apres;
        if (p.type === "ajouter") m.base.push({ nom: p.nom, pid: p.pid, qte: p.qte });
      }
      await enregistrerMaListe();
      afficher();
    };
    return encart([el("b", {}, nom), ` : ${texte}`], [[oui, () => repondre(true)], [non, () => repondre(false), "non"]]);
  });
}

// Le dernier remplissage, tel que le script de la page l'a vérifié dans le panier.
function bilanRemplissage() {
  const r = etat.remplissage;
  if (!r) return null;
  if (r.enCours) return null; // l'avancement s'affiche sur les lignes et dans le bouton
  if (r.vu || Date.now() - (r.fin || 0) > BILAN_VISIBLE_MS) return null;
  const traites = r.lignes.filter((l) => l.statut !== "non_traite");
  const ok = r.lignes.filter((l) => l.statut === "ajoute" || l.statut === "remplace").length;
  const aVoir = r.lignes.filter((l) => l.statut === "echec" || l.statut === "partiel" || l.statut === "non_traite");
  const phrases = [];
  phrases.push(el("b", {}, ok === r.lignes.length ? `${pluriel(ok, "produit")} dans ton panier` : `${ok} sur ${r.lignes.length} dans ton panier`));
  phrases.push(` (${ilYa(r.fin)}${r.verifie ? ", vérifié dans le panier" : ", panier non relu"}).`);
  if (r.arret) phrases.push(` Arrêté : ${r.arret}. ${traites.length < r.lignes.length ? "Les produits non traités sont restés cochés : reclique plus tard." : ""}`);
  if (aVoir.length) {
    phrases.push(el("span", { class: "a-voir" }, ...aVoir.map((l) => {
      const [nom] = decouper(l.nom);
      const raison = l.statut === "partiel" ? `${l.recu} sur ${l.qte}, quantité maximale du site ?` : l.statut === "non_traite" ? "pas traité" : "indisponible, à remplacer à la main";
      return el("span", { class: "a-voir-ligne" }, `${nom} : ${raison}`);
    })));
  } else if (ok) {
    phrases.push(" Il ne reste qu'à choisir ton créneau sur le site.");
  }
  const fermer = async () => {
    etat.remplissage = { ...r, vu: true };
    await chrome.storage.local.set({ remplissage: etat.remplissage });
    afficher();
  };
  return encart(phrases, [["OK", fermer, "non"]], aVoir.length ? "alerte" : "");
}

/* ---------- Les écrans ---------- */
function ecranSemaine() {
  const { base, rappels } = Rythme.preparerCommande(etat.commandes, etat.familles, etat.maListe);
  etat.articles = [];
  etat.nbBase = base.length;
  const blocs = [];
  if (etat.confirmerRefaire) {
    blocs.push(encart(["Refaire ta liste ? Je te propose une nouvelle liste de base d'après tes dernières commandes. Tes produits écartés et tes réglages sont gardés."],
      [["Refaire ma liste", () => { etat.refaire = etat.maListe; etat.confirmerRefaire = false; afficher(); }], ["Annuler", () => { etat.confirmerRefaire = false; afficher(); }, "non"]]));
  }
  const bilan = bilanRemplissage();
  if (bilan) blocs.push(bilan);
  if (etat.annulation) blocs.push(etat.annulation);
  blocs.push(...encartsPropositions());

  blocs.push(titreSection("Ta liste de base", `${base.filter((b) => b.aPrendre).length} sur ${base.length}`));
  for (const b of base) {
    const article = { pid: b.pid, nom: b.nom, qte: b.qte, remplacants: b.remplacants || [], coche: b.aPrendre, base: true };
    etat.articles.push(article);
    const n = b.toutesLes || 1;
    const detail = n > 1 ? (b.aPrendre ? `une semaine sur ${n}` : `pas cette semaine, une sur ${n}`) : "";
    blocs.push(ligne(article, detail, { retirer: () => retirerDeLaBase(b) }));
  }
  if (!base.length) blocs.push(el("p", { class: "vide" }, "Ta liste de base est vide."));
  blocs.push(el("button", { type: "button", class: "ajouter", onclick: ouvrirAjout }, el("span", { html: ICONES.plus }), "Ajouter un produit déjà acheté"));

  blocs.push(titreSection("Pense aussi à", rappels.length ? String(rappels.length) : ""));
  for (const f of rappels) {
    const produit = f.aRacheter[0];
    const article = { pid: produit.pid, nom: produit.nom, qte: Math.min(QTE_MAX, produit.qte || 1), remplacants: [], coche: false };
    etat.articles.push(article);
    const actions = [lien("ajouter à ma liste", () => ajouterALaBase(f, article)), " · ", lien("ne plus proposer", () => ecarter(produit))];
    blocs.push(ligne(article, `acheté il y a ${pluriel(f.semainesALaProchaine, "semaine")}`, { actions }));
  }
  if (!rappels.length) blocs.push(el("p", { class: "vide" }, "Rien à racheter d'après tes habitudes."));

  const exclus = etat.maListe.exclus || [];
  if (exclus.length) {
    blocs.push(el("details", { class: "ecartes" }, el("summary", {}, `Produits écartés (${exclus.length})`),
      ...exclus.map((x) => el("div", { class: "ecarte" }, el("span", {}, decouper(x.nom)[0]), lien("remettre", () => remettre(x))))));
  }
  blocs.push(memoire());
  return blocs;
}

function memoire() {
  const l = etat.lecture;
  const texte = `${pluriel(etat.nbCommandes, "commande")} en mémoire` + (l && l.quand && !l.erreur ? `, lues ${ilYa(l.quand)}` : "");
  return el("p", { class: "mention" }, texte + ".");
}

function ecranAccueil() {
  etat.articles = [];
  const etape = (n, titre, texte) => el("div", { class: "etape" }, el("span", { class: "pastille" }, String(n)),
    el("span", { class: "texte" }, el("span", { class: "nom" }, titre), el("span", { class: "detail libre" }, texte)));
  return [
    el("p", { class: "intro" }, "Cartloop apprend ce que tu achètes sur Courses U, et à quel rythme. Ensuite, il remplit ton panier en un clic et te rappelle ce qui va manquer. Il ne passe jamais la commande à ta place."),
    titreSection("Pour commencer"),
    etape(1, "Ouvre coursesu.com", "Connecte-toi à ton compte, dans n'importe quel onglet."),
    etape(2, "Je lis tes commandes", "Les 8 dernières, en lecture seule. Puis chaque nouvelle."),
    etape(3, "Tu valides ta liste", "Je te propose ta liste de la semaine, tu coches ce qui te va."),
    el("p", { class: "mention" }, "Tout reste dans ton navigateur. Outil indépendant, non affilié à Courses U ni à Système U. ",
      lien("Restaurer une sauvegarde", ouvrirSauvegarde)),
  ];
}

function ecranPremiereListe() {
  const analyse = Rythme.analyser(etat.commandes, etat.familles);
  // en refaisant sa liste, les produits écartés restent écartés
  const exclus = new Set(((etat.refaire && etat.refaire.exclus) || []).map(cleDe));
  const proposees = Rythme.proposerBase(analyse).filter((f) => !exclus.has(f.cle));
  let intro;
  if (proposees.length) {
    etat.articles = proposees.map((f) => {
      const produit = f.aRacheter[0];
      return { pid: produit.pid, nom: produit.nom, qte: Math.min(QTE_MAX, f.qteHabituelle), coche: true, remplacants: [], toutesLes: Math.round(f.rythme) };
    });
    intro = `D'après tes ${pluriel(analyse.nbCommandes, "commande")}, voici ce que tu achètes presque chaque semaine. Décoche ce qui ne doit pas revenir, ajuste les quantités, puis valide.`;
  } else {
    // Une seule commande (ou des achats trop irréguliers) : on part de la dernière, rien n'est coché d'office.
    const derniere = etat.commandes.filter((c) => c.statut !== "annulee" && c.date).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const lignes = derniere ? (derniere.lignes || []).filter((l) => l.pid && l.qte && !Rythme.familleDe(l.nom, etat.familles) && !exclus.has(cleDe(l))) : [];
    etat.articles = lignes.map((l) => ({ pid: l.pid, nom: l.nom, qte: Math.min(QTE_MAX, l.qte), coche: false, remplacants: [], toutesLes: 1 }));
    intro = "Pas encore assez de commandes pour deviner tes habitudes. Voici ta dernière commande : coche ce que tu reprends chaque semaine.";
  }
  const blocs = [el("p", { class: "intro" }, intro)];
  if (etat.refaire) blocs.push(el("p", { class: "mention" }, "Ta liste actuelle reste en place tant que tu n'as pas validé la nouvelle. ", lien("Garder ma liste actuelle", () => { etat.refaire = null; afficher(); })));
  blocs.push(titreSection("Ta future liste de base", pluriel(etat.articles.length, "produit")));
  if (etat.articles.length) blocs.push(...etat.articles.map((a) => ligne(a, a.toutesLes > 1 ? `une semaine sur ${a.toutesLes}` : "chaque semaine")));
  else blocs.push(el("p", { class: "vide" }, "Rien à proposer pour l'instant. Reviens après ta prochaine commande."));
  return blocs;
}

// Ajouter à sa liste un produit déjà acheté : tout l'historique du compte, du
// plus récent au plus ancien, avec un filtre. Pas de catalogue du site : on ne
// propose que ce que la personne a déjà commandé.
function ecranAjout() {
  const alias = Rythme.aliasDe(etat.maListe);
  const dansLaListe = new Set(etat.maListe.base.map((b) => b.pid));
  const valides = etat.commandes.filter((c) => c.statut !== "annulee" && c.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  const analyse = Rythme.analyser(etat.commandes, etat.familles, {}, alias);
  const rythmeDe = new Map(analyse.familles.map((f) => [f.cle, f.rythme]));
  const produits = new Map();
  valides.forEach((c, indice) => {
    for (const l of c.lignes || []) {
      if (!l.pid || !l.qte || dansLaListe.has(l.pid) || alias[l.pid]) continue;
      const p = produits.get(l.pid) || { pid: l.pid, nom: l.nom, fois: 0 };
      p.fois++;
      p.indice = indice;
      p.qte = l.qte;
      produits.set(l.pid, p);
    }
  });
  const liste = [...produits.values()].sort((a, b) => b.indice - a.indice || b.fois - a.fois);
  etat.articles = liste.map((p) => {
    const rythme = rythmeDe.get(cleDe(p)) || 1;
    return { pid: p.pid, nom: p.nom, qte: Math.min(QTE_MAX, p.qte), coche: false, remplacants: [], toutesLes: rythme > 1.4 ? Math.round(rythme) : 1, fois: p.fois, depuis: valides.length - 1 - p.indice };
  });
  const lignes = etat.articles.map((a) => {
    const quand = a.depuis === 0 ? "dernière commande" : `il y a ${pluriel(a.depuis, "semaine")}`;
    const noeud = ligne(a, `${a.fois > 1 ? `acheté ${a.fois} fois` : "acheté une fois"}, ${quand}`, { dabord: true });
    noeud.dataset.recherche = Rythme.normaliser(a.nom);
    return noeud;
  });
  const vide = el("p", { class: "vide", hidden: true }, "Aucun produit de ton historique ne correspond.");
  const titre = titreSection("Déjà achetés", pluriel(liste.length, "produit"));
  const filtre = el("input", { type: "search", class: "recherche", placeholder: "Filtrer : lait, café, lessive…", "aria-label": "Filtrer les produits déjà achetés" });
  filtre.addEventListener("input", () => {
    const mots = Rythme.normaliser(filtre.value).split(" ").filter(Boolean);
    let visibles = 0;
    for (const n of lignes) {
      const ok = mots.every((m) => n.dataset.recherche.includes(m));
      n.hidden = !ok;
      if (ok) visibles++;
    }
    vide.hidden = visibles > 0;
    titre.lastChild.textContent = mots.length ? `${visibles} sur ${liste.length}` : pluriel(liste.length, "produit");
  });
  setTimeout(() => filtre.focus(), 0);
  return [
    el("div", { class: "barre-ajout" }, lien("Retour à ma liste", fermerAjout)),
    el("p", { class: "intro" }, "Coche les produits à ajouter à ta liste de base. La quantité se règle au survol ; le rythme vient de tes achats."),
    filtre,
    titre,
    ...(liste.length ? lignes : [el("p", { class: "vide" }, "Tous les produits de ton historique sont déjà dans ta liste.")]),
    vide,
  ];
}

function ouvrirAjout() {
  etat.ajout = true;
  etat.annulation = null;
  afficher();
  $("contenu").scrollTop = 0;
}

function fermerAjout() {
  etat.ajout = false;
  afficher();
}

async function validerAjout() {
  const choisis = etat.articles.filter((a) => a.coche);
  const m = etat.maListe;
  for (const a of choisis) {
    m.base.push({ nom: a.nom, pid: a.pid, qte: a.qte, ...(a.toutesLes > 1 ? { toutesLes: a.toutesLes } : {}) });
    decider(cleDe(a));
  }
  const ajoutes = new Set(choisis.map((a) => a.pid));
  m.exclus = (m.exclus || []).filter((x) => !ajoutes.has(x.pid)); // ajouté à la main : plus écarté
  await enregistrerMaListe();
  etat.ajout = false;
  afficher();
  note(choisis.length > 1 ? `${choisis.length} produits ajoutés à ta liste.` : `${decouper(choisis[0].nom)[0]} ajouté à ta liste.`, "ok");
}

/* ---------- Modifier sa liste à la main ---------- */
async function retirerDeLaBase(item) {
  const m = etat.maListe;
  const avant = m.base.slice();
  m.base = m.base.filter((b) => b !== item && b.pid !== item.pid);
  decider(cleDe(item));
  await enregistrerMaListe();
  const [nom] = decouper(item.nom);
  etat.annulation = encart([el("b", {}, nom), " est retiré de ta liste."], [["Annuler", async () => {
    m.base = avant;
    etat.annulation = null;
    await enregistrerMaListe();
    afficher();
  }, "non"]]);
  afficher();
}

async function ajouterALaBase(famille, article) {
  const toutesLes = famille.rythme && famille.rythme > 1 ? Math.round(famille.rythme) : 1;
  etat.maListe.base.push({ nom: article.nom, pid: article.pid, qte: article.qte, ...(toutesLes > 1 ? { toutesLes } : {}) });
  decider(cleDe(article));
  await enregistrerMaListe();
  etat.annulation = null;
  afficher();
  note(`${decouper(article.nom)[0]} ajouté à ta liste${toutesLes > 1 ? `, une semaine sur ${toutesLes}` : ""}.`, "ok");
}

async function ecarter(produit) {
  etat.maListe.exclus = etat.maListe.exclus || [];
  etat.maListe.exclus.push({ nom: produit.nom, pid: produit.pid });
  await enregistrerMaListe();
  afficher();
}

async function remettre(x) {
  etat.maListe.exclus = (etat.maListe.exclus || []).filter((e) => e !== x);
  await enregistrerMaListe();
  afficher();
}

/* ---------- Bandeau, bouton, note ---------- */
function mode() {
  if (etat.maListe && !etat.refaire && etat.ajout) return "ajout";
  if (etat.maListe && !etat.refaire) return "semaine";
  return etat.commandes.length ? "premiere-liste" : "accueil";
}

function majResume() {
  const m = mode();
  const resume = $("resume");
  const jauge = $("jauge");
  const choisis = etat.articles.filter((a) => a.coche);
  const unites = choisis.reduce((s, a) => s + a.qte, 0);
  resume.textContent = "";
  if (m === "accueil") {
    resume.append(el("b", {}, "Bienvenue"));
    jauge.hidden = true;
  } else if (m === "premiere-liste") {
    resume.append(el("b", {}, String(choisis.length)), el("span", {}, `${choisis.length > 1 ? "produits retenus" : "produit retenu"} pour ta liste`));
    jauge.hidden = true;
  } else if (m === "ajout") {
    resume.append(el("b", {}, String(choisis.length)), el("span", {}, `${choisis.length > 1 ? "produits" : "produit"} à ajouter à ta liste`));
    jauge.hidden = true;
  } else {
    resume.append(el("b", {}, String(choisis.length)), el("span", {}, `${choisis.length > 1 ? "produits prêts" : "produit prêt"}, ${pluriel(unites, "article")}`));
    const baseCochee = etat.articles.filter((a) => a.base && a.coche).length;
    jauge.hidden = !etat.nbBase;
    $("jauge-remplie").style.width = etat.nbBase ? `${(100 * baseCochee) / etat.nbBase}%` : "0";
  }
  const bouton = $("remplir");
  bouton.textContent = m === "accueil" ? "Lire mes commandes" : m === "premiere-liste" ? "Valider ma liste" : m === "ajout" ? "Ajouter à ma liste" : "Remplir mon panier";
  bouton.disabled = m !== "accueil" && !choisis.length;
  afficherAvancement();
}

function note(texte, type = "", action = null) {
  const n = $("note");
  n.hidden = !texte;
  n.textContent = texte || "";
  n.className = "note" + (type ? " " + type : "");
  if (action) n.append(" ", lien(action[0], action[1]));
}

// L'onglet Courses U où travailler : l'onglet actif s'il est sur le site, sinon
// n'importe quel onglet du site déjà ouvert.
async function ongletCoursesU() {
  const surLeSite = (o) => o && /^https:\/\/www\.coursesu\.com\//.test(o.url || "");
  const [actif] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (surLeSite(actif)) return actif;
  const ouverts = await chrome.tabs.query({ url: SITE + "*" });
  return ouverts[0] || null;
}

function pasDOnglet() {
  note("Ouvre coursesu.com et connecte-toi, puis reclique.", "alerte", ["Ouvrir Courses U", () => chrome.tabs.create({ url: SITE })]);
}

/* ---------- Remplir le panier ---------- */
const LIBELLES = {
  envoye: [ICONES.coche, "Envoyé, vérification à la fin"],
  refuse: [ICONES.alerte, "Refusé par le site"],
  ajoute: [ICONES.coche, "Au panier"],
  remplace: [ICONES.echange, "Remplacé"],
  partiel: [ICONES.alerte, "Quantité incomplète"],
  echec: [ICONES.alerte, "Pas ajouté"],
};

// Reporte sur les lignes affichées l'avancement ou le bilan du remplissage.
function afficherAvancement() {
  const r = etat.remplissage;
  if (!r || mode() !== "semaine") return;
  const recent = r.enCours || (!r.vu && Date.now() - (r.fin || 0) < BILAN_VISIBLE_MS);
  if (!recent) return;
  let faits = 0;
  for (const l of r.lignes) {
    if (l.statut !== "attente") faits++;
    const article = etat.articles.find((a) => a.pid === l.pid && a.noeud);
    if (!article || !LIBELLES[l.statut]) continue;
    const [icone, libelleBase] = LIBELLES[l.statut];
    const libelle = l.statut === "remplace" && l.par ? `Remplacé par ${l.par.nom}` : l.raison ? `${libelleBase} : ${l.raison}` : libelleBase;
    const classe = l.statut === "envoye" ? "etat envoye" : l.statut === "refuse" || l.statut === "partiel" ? "etat echec" : "etat " + l.statut;
    const ancienne = article.noeud.querySelector(".case, .etat");
    if (ancienne.classList.contains("etat") && ancienne.className === classe) continue;
    ancienne.replaceWith(el("span", { class: classe, title: libelle, role: "img", "aria-label": libelle, html: icone }));
    const detail = article.noeud.querySelector(".detail");
    if (l.statut === "remplace" && l.par) detail.textContent = `Remplacé par ${decouper(l.par.nom)[0]}`;
    if (l.statut === "partiel") detail.textContent = `${l.recu} sur ${l.qte} au panier`;
    if (l.statut === "echec") detail.textContent = "Indisponible : à remplacer à la main";
    article.noeud.classList.add("traitee");
    setTimeout(() => article.noeud.classList.add("fin"), 450);
  }
  if (r.enCours) {
    $("jauge").hidden = false;
    $("jauge-remplie").style.width = `${(100 * faits) / r.lignes.length}%`;
    const bouton = $("remplir");
    bouton.disabled = true;
    bouton.textContent = faits < r.lignes.length ? `Ajout ${faits} sur ${r.lignes.length}…` : "Vérification du panier…";
    note("Tu peux fermer cette fenêtre : le remplissage continue dans l'onglet Courses U.");
  }
}

async function remplir() {
  const onglet = await ongletCoursesU();
  if (!onglet) return pasDOnglet();
  const articles = etat.articles.filter((a) => a.coche).map(({ pid, nom, qte, remplacants }) => ({ pid, nom, qte, remplacants }));
  const bouton = $("remplir");
  bouton.disabled = true;
  bouton.textContent = `Ajout de ${pluriel(articles.length, "produit")}…`;
  note("");
  let reponse;
  try {
    reponse = await chrome.tabs.sendMessage(onglet.id, { type: "remplir-panier", articles });
  } catch (e) {
    reponse = { erreur: "La page Courses U ne répond pas : recharge-la, puis reclique." };
  }
  if (!reponse || reponse.erreur) {
    majResume();
    return note((reponse && reponse.erreur) || "Pas de réponse de la page.", "alerte");
  }
  etat.remplissage = reponse.remplissage;
  afficher();
}

async function lireMaintenant() {
  const onglet = await ongletCoursesU();
  if (!onglet) return pasDOnglet();
  note("Lecture de tes commandes…");
  try {
    await chrome.tabs.sendMessage(onglet.id, { type: "lire-maintenant" });
  } catch (e) {
    return note("La page Courses U ne répond pas : recharge-la, puis reclique.", "alerte");
  }
  await demarrer(true);
}

async function validerPremiereListe() {
  const choisis = etat.articles.filter((a) => a.coche);
  const ancienne = etat.refaire || {};
  const remplacantsDe = (pid) => ((ancienne.base || []).find((b) => b.pid === pid) || {}).remplacants;
  etat.maListe = {
    valideeLe: aujourdhui(),
    base: choisis.map(({ nom, pid, qte, toutesLes }) => {
      const remplacants = remplacantsDe(pid);
      return { nom, pid, qte, ...(toutesLes > 1 ? { toutesLes } : {}), ...(remplacants ? { remplacants } : {}) };
    }),
    exclus: ancienne.exclus || [],
    rythmes: ancienne.rythmes || [],
    decisions: {},
  };
  etat.refaire = null;
  await enregistrerMaListe();
  afficher();
  note("Ta liste de base est enregistrée.", "ok");
}

function ouvrirSauvegarde() {
  chrome.tabs.create({ url: chrome.runtime.getURL("sauvegarde.html") });
}

$("remplir").addEventListener("click", () => {
  const m = mode();
  if (m === "accueil") return lireMaintenant();
  if (m === "premiere-liste") return validerPremiereListe();
  if (m === "ajout") return validerAjout();
  return remplir();
});
$("relire").addEventListener("click", lireMaintenant);
$("refaire").addEventListener("click", () => { etat.confirmerRefaire = true; afficher(); $("contenu").scrollTop = 0; });
$("sauvegarde").addEventListener("click", ouvrirSauvegarde);

/* ---------- Affichage ---------- */
function afficher() {
  const contenu = $("contenu");
  contenu.textContent = "";
  const m = mode();
  if (etat.lecture && etat.lecture.erreur) contenu.append(el("div", { class: "encart alerte" }, etat.lecture.erreur));
  contenu.append(...(m === "accueil" ? ecranAccueil() : m === "premiere-liste" ? ecranPremiereListe() : m === "ajout" ? ecranAjout() : ecranSemaine()));
  $("semaine").textContent = `Semaine du ${lundiDeLaSemaine()}`;
  note(m === "accueil" ? "Rien n'est envoyé ailleurs que sur coursesu.com." : "");
  document.querySelector(".liens").hidden = m !== "semaine";
  majResume();
}

async function demarrer(relu) {
  const { commandes = {}, derniereLecture, maListe, remplissage } = await chrome.storage.local.get(["commandes", "derniereLecture", "maListe", "remplissage"]);
  etat.commandes = Object.values(commandes).filter((c) => c && typeof c === "object");
  etat.nbCommandes = etat.commandes.filter((c) => c.statut !== "annulee").length;
  etat.lecture = derniereLecture || null;
  etat.maListe = maListe || null;
  etat.remplissage = remplissage || null;
  if (!etat.familles.length) etat.familles = (await chargerJson("familles.json")).familles;
  // La dernière lecture a échoué (souvent : pas encore connecté à ce moment-là).
  // On retente une fois à l'ouverture, sans attendre que la personne clique.
  const onglet = !relu && etat.lecture && etat.lecture.erreur ? await ongletCoursesU() : null;
  if (onglet) {
    etat.lecture = null;
    afficher();
    note("Lecture de tes commandes…");
    try { await chrome.tabs.sendMessage(onglet.id, { type: "lire-maintenant" }); } catch (e) { /* page pas prête : l'erreur reviendra à l'affichage */ }
    return demarrer(true);
  }
  afficher();
}

// Ce que la page Courses U écrit pendant que la fenêtre est ouverte : une
// lecture qui se termine, l'avancement du remplissage.
chrome.storage.onChanged.addListener((changes, zone) => {
  if (zone !== "local") return;
  if (changes.remplissage) {
    etat.remplissage = changes.remplissage.newValue || null;
    if (etat.remplissage && !etat.remplissage.enCours && !etat.remplissage.vu) afficher();
    else afficherAvancement();
  }
  if ((changes.commandes || changes.derniereLecture) && !(etat.remplissage && etat.remplissage.enCours)) {
    clearTimeout(demarrer.attente);
    demarrer.attente = setTimeout(() => demarrer(true), 400); // une lecture écrit commande par commande : on attend la fin
  }
});

demarrer().catch((e) => note("Erreur : " + e.message, "alerte"));
