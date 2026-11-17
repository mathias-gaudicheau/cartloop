// Tests du calcul des rythmes. Lancer : node --test outils/
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../extension/rythme.js");
const { familles } = require("../extension/familles.json");

const fam = (nom) => (R.familleDe(nom, familles) || { nom: null }).nom;

test("les noms sont normalisés sans accents ni ponctuation", () => {
  assert.equal(R.normaliser("Œufs Plein air L'OEUF - x20"), "oeufs plein air l oeuf x20");
  assert.equal(R.normaliser("Pâte de curry"), "pate de curry");
});

test("chaque produit tombe dans la bonne famille", () => {
  assert.equal(fam("Lessive liquide - Savon de Marseille - 45 lavages"), "Lessive");
  assert.equal(fam("Recharge crème lavante mains lait LE PETIT MARSEILLAIS 250ml"), "Savon pour les mains");
  assert.equal(fam("Recharge de savon liquide pur U en flacon 500mL"), "Savon pour les mains");
  assert.equal(fam("Brosse à dents manuelle triple action medium SIGNAL x4"), "Brosse à dents");
  assert.equal(fam("Essuie-tout U blanc x6"), "Essuie-tout");
  assert.equal(fam("Capsules lave-vaisselle tout en 1 FINISH x30"), "Entretien lave-vaisselle");
  assert.equal(fam("Liquide vaisselle main peaux sensibles"), "Liquide vaisselle");
});

test("l'alimentaire n'a pas de famille : chaque produit compte pour lui-même", () => {
  for (const nom of ["Tagliatelles aux oeufs 250g", "Oeufs Plein air Bleu blanc coeur - Plateau de 20", "Sauce tomate basilic",
    "Vinaigre de riz", "Croquettes chat au saumon", "Sauce au poivre", "Yaourt à la banane", "Savon noir ménager", "Café Capsules L'OR",
    "Filet de poulet jaune, France, 870 g environ"]) {
    assert.equal(fam(nom), null, nom);
  }
});

function commandes(...listes) {
  // une commande par élément ; les dates s'écartent volontairement de façon irrégulière
  const dates = ["2026-01-01", "2026-01-08", "2026-03-20", "2026-03-27", "2026-06-01", "2026-06-08", "2026-06-15"];
  return listes.map((lignes, i) => ({ id: String(i), date: dates[i], statut: "retiree", lignes }));
}
const L = (nom, qte = 1, rayon = "Epicerie salée", pid = nom) => ({ pid, nom, rayon, qte });

test("acheté à chaque commande : rythme d'une semaine, malgré les trous du calendrier", () => {
  const a = R.analyser(commandes([L("Riz complet")], [L("Riz complet")], [L("Riz complet")], [L("Riz complet")]), familles);
  const riz = a.familles.find((f) => f.nom === "Riz complet");
  assert.equal(riz.rythme, 1);
  assert.equal(riz.origineRythme, "mesure");
  assert.equal(riz.semainesALaProchaine, 1);
  assert.equal(riz.commandesDepuis, 0); // acheté à la dernière commande
});

test("une semaine sur deux : rythme de 2, et les variantes comptent ensemble", () => {
  const a = R.analyser(
    commandes([L("Liquide vaisselle amande", 1, "Entretien et nettoyage", "a")], [], [L("Liquide vaisselle peaux sensibles", 1, "Entretien et nettoyage", "b")], [], [L("Liquide vaisselle amande", 1, "Entretien et nettoyage", "a")]),
    familles
  );
  const lv = a.familles.find((f) => f.nom === "Liquide vaisselle");
  assert.equal(lv.nbAchats, 3);
  assert.deepEqual(lv.ecarts, [2, 2]);
  assert.equal(lv.rythme, 2);
  assert.equal(lv.quotidien, true);
  assert.equal(lv.aRacheter[0].pid, "a");
});

test("acheté une seule fois : on prend la durée de départ de la famille", () => {
  const a = R.analyser(commandes([L("Dentifrice SIGNAL", 1, "Hygiène et beauté")], [], []), familles);
  const d = a.familles.find((f) => f.nom === "Dentifrice");
  assert.equal(d.rythme, 6);
  assert.equal(d.origineRythme, "depart");
  assert.equal(d.semainesALaProchaine, 3);
});

test("deux achats coup sur coup ne suffisent pas à remplacer la durée de départ", () => {
  const S = (n) => L("Shampooing argan " + n, 1, "Hygiène et beauté", "s" + n);
  const a = R.analyser(commandes([S(1)], [S(2)], []), familles);
  const s = a.familles.find((f) => f.nom === "Shampoing");
  assert.deepEqual(s.ecarts, [1]);
  assert.equal(s.rythme, 8);
  assert.equal(s.origineRythme, "depart");
});

test("une habitude arrêtée n'est plus rappelée", () => {
  const sk = L("Yaourt Skyr vanille");
  const c = commandes([sk], [sk], [sk], [], [], [], []);
  const a = R.analyser(c, familles);
  const f = a.familles.find((x) => x.nom === "Yaourt Skyr vanille");
  assert.equal(f.rythme, 1);
  assert.equal(f.semainesALaProchaine, 5);
  assert.equal(f.arretee, true);
  assert.deepEqual(R.rappels(a, []), []);
  assert.deepEqual(R.proposerBase(a), []);
});

test("une commande annulée ne compte pas comme une semaine", () => {
  const c = commandes([L("Riz complet")], [L("Riz complet")]);
  c.push({ id: "x", date: "2026-02-01", statut: "annulee", lignes: [] });
  const a = R.analyser(c, familles);
  assert.equal(a.nbCommandes, 2);
});

test("rappel seulement quand le délai habituel est atteint, jamais pour la base", () => {
  const c = commandes(
    [L("Riz complet"), L("Papier toilette 18 rouleaux", 1, "Hygiène et beauté")],
    [L("Riz complet")],
    [L("Riz complet")],
    [L("Riz complet")]
  );
  const a = R.analyser(c, familles);
  const base = R.proposerBase(a).map((f) => f.cle);
  assert.deepEqual(base, ["p:Riz complet"]);
  assert.deepEqual(R.rappels(a, base).map((f) => f.nom), ["Papier toilette"]); // 4 semaines, départ 4

  const a2 = R.analyser(c.slice(0, 3), familles); // 3 semaines seulement
  assert.deepEqual(R.rappels(a2, base).map((f) => f.nom), []);
});

test("tes choix priment : base une semaine sur deux, produit écarté, rythme fixé à la main", () => {
  const pdt = L("Pomme de terre Agata 2,5kg", 1, "Fruits et Légumes", "pdt");
  const sau = L("Pavé de saumon", 1, "Viandes, poissons", "sau");
  const par = L("Parmigiano Reggiano râpé", 1, "Produits laitiers", "par");
  const c = commandes([pdt, sau, par], [sau], [sau], [pdt]);
  const maListe = {
    base: [{ nom: "Pomme de terre Agata 2,5kg", pid: "pdt", qte: 1, toutesLes: 2 }],
    exclus: [{ nom: "Pavé de saumon", pid: "sau" }],
    rythmes: [{ nom: "Parmigiano Reggiano râpé", pid: "par", toutesLes: 4 }],
  };
  const r = R.preparerCommande(c, familles, maListe);
  assert.equal(r.base[0].aPrendre, false); // achetées à la dernière commande, une semaine sur deux
  assert.deepEqual(r.rappels.map((f) => f.nom), ["Parmigiano Reggiano râpé"]); // 4 semaines, saumon écarté

  const r2 = R.preparerCommande([...c, { id: "z", date: "2026-06-30", statut: "retiree", lignes: [] }], familles, maListe);
  assert.equal(r2.base[0].aPrendre, true);
});

test("propositions : seulement après ta dernière décision, et sur trois commandes de preuve", () => {
  const P = (nom, qte = 1, pid = nom) => L(nom, qte, "Epicerie salée", pid);
  const c = [
    ["2026-11-10", [P("Poêlée bretonne 1kg"), P("Trio de choux", 2)]], // avant la validation : ignorée
    ["2026-11-24", [P("Trio de choux", 2), P("Chips paysanne")]],
    ["2026-12-01", [P("Trio de choux", 2), P("Chips paysanne")]],
    ["2026-12-08", [P("Trio de choux", 2), P("Chips paysanne", 2)]],
  ].map(([date, lignes], i) => ({ id: String(i), date, statut: "retiree", lignes }));
  const maListe = {
    valideeLe: "2026-11-17",
    base: [{ nom: "Poêlée bretonne 1kg", pid: "Poêlée bretonne 1kg", qte: 1 }, { nom: "Trio de choux", pid: "Trio de choux", qte: 1 }],
    exclus: [],
  };
  const p = R.proposerChangements(c, familles, maListe);
  assert.deepEqual(p.map((x) => x.type + ":" + x.nom).sort(), ["ajouter:Chips paysanne", "quantite:Trio de choux", "retirer:Poêlée bretonne 1kg"]);
  assert.equal(p.find((x) => x.type === "quantite").apres, 2);
  assert.equal(p.find((x) => x.type === "ajouter").qte, 1);

  // non le 01/12 pour les chips : plus de proposition avant 3 nouvelles commandes
  maListe.decisions = { "p:Chips paysanne": "2026-12-01" };
  assert.equal(R.proposerChangements(c, familles, maListe).some((x) => x.type === "ajouter"), false);
});

test("un remplaçant compte comme le produit qu'il remplace", () => {
  const O = (pid) => L("Oeufs plein air x20 " + pid, 4, "Crèmerie", pid);
  const c = commandes([O("o1")], [O("o2")], [O("o2")], [O("o3")]);
  const maListe = { valideeLe: "2025-12-31", base: [{ nom: "Oeufs plein air x20 o1", pid: "o1", qte: 4, remplacants: [{ nom: "autres", pid: "o2" }, { nom: "encore", pid: "o3" }] }], exclus: [] };
  const r = R.preparerCommande(c, familles, maListe);
  assert.equal(r.rappels.length, 0); // les œufs de secours ne deviennent pas des rappels
  const p = R.proposerChangements(c, familles, maListe);
  assert.deepEqual(p, []); // ni « retirer » les œufs habituels, ni « ajouter » ceux de secours
});

test("une commande abîmée (sans date, sans lignes) ne fait pas planter le calcul", () => {
  const c = [...commandes([L("Riz complet")], [L("Riz complet")]), { id: "y", statut: "retiree" }, { id: "z", date: "2026-07-01", statut: "retiree" }];
  const a = R.analyser(c, familles);
  assert.equal(a.nbCommandes, 3);
});
