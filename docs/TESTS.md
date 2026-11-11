# Tests : résultats et limites

## Automatisés

| Suite | Outil | Couverture |
| --- | --- | --- |
| `tests/unit` (83 tests) | Vitest + fake-indexeddb | **Rendu lisse** (coordonnées arrondies au pixel : bord, boucles, angles, pression, extrémités, coût) ; **Filtre du trait** (retard, bruit, angles à 240 Hz, indépendance de fréquence) ; **formes nettes** (droite, cercle, ellipse, rectangle droit et incliné, rejets) ; **historique aléatoire** (6 × 300 actions : annuler/rétablir exacts, persistance identique à l'affichage) ; **crochet de fin de trait** ; Viewport ; géométrie (gomme partielle, contact) ; **règles de sélection** (inclusion, contact, boîte seule insuffisante, indépendance vis-à-vis de la vitesse, lasso concave, objets, carré) ; **outils** (plume pleins/déliés, bille constante, paramètres par outil) ; session (annuler/rétablir, page de chaque étape, gomme groupée, traits + texte, lecture seule, purge, chargement paresseux) ; persistance (formats, dossiers, objets, images, suppression complète) ; file d'écriture ; sauvegardes (v2 avec images/texte/dossiers, relecture v1, sans écrasement) ; **copie de sécurité avant mise à niveau v1 → v2** ; migrations ; reprise des anciennes préférences |
| `tests/e2e` (119 tests exécutés : Chromium bureau + iPad émulé ; un scénario à 390 × 844) | Playwright | **Netteté** : canvas alignés (densités 2, 3, 1,25), ondulation mesurée sur les pixels (zoom 1, ×3, fenêtre de zoom, après rechargement, export PNG), grain réservé au crayon ; **Téléphone** (barres visibles, menu Outils, fenêtre de zoom) ; **marges du zoom**, cadre placé au doigt ; **Formes**, **laser**, **règle** (collage, rotation boutons et 2 doigts, déplacement) ; **alignement** ; **notes** ; **minuteur** ; **personnalisation** ; **favoris, plan, modèle, accéder, copier, supprimer par type, effacer** ; réglages du document ; **tirer pour ajouter une page** ; **Précision** (points saisis à < 0,5 px du trait, fin exacte, tracé en cours = trait enregistré) ; **6 stylos** distincts deux à deux ; **formes nettes** (droite ajustée, cercle, rectangle, délai, retour au tracé libre) ; **annuler fiable** (fin de geste perdue, stylet suivant, fin hors canvas, séquence mixte) ; **fenêtre de zoom** (un seul trait, coordonnées et taille exactes, gomme, annuler, avance, retour à la ligne, cadre, grossissement, pincement) ; **conversion en texte** (manuelle, Google simulé, erreur) ; Stylet via le protocole Chromium (pression, inclinaison) ; 4 outils au rendu distinct (mesure du canvas) ; favoris ; coordonnées après zoom ; **plein écran + concentration + écriture** ; **historique combiné** (3 traits → gomme partielle → déplacement → tout annuler → tout rétablir, puis rechargement) ; clavier ; **changement de page + annulation** ; **zoom + gomme** ; règles de sélection ; rectangle / carré / poignée / couleur / épaisseur ; **sélection + navigation** ; texte ; souris ; **navigation horizontale tactile** (balayage, arrêt net, page agrandie, deux doigts, pincement) ; **doigt + stylet** et paume pendant un tracé ; bibliothèque (formats, modèles, dossiers, tri, favoris, corbeille) ; **migration d'une base v1** dans l'app ; export/restauration ; deux onglets ; hors ligne |
| CI GitHub | Actions | Les mêmes + WebKit « iPad Pro 11 » (bibliothèque, dossiers, migration, onglets, **fenêtre de zoom + conversion + annuler par événements synthétiques**) |

### Résultats du 11/11/2026, 4ᵉ lot (environnement Linux, Chromium headless)
- `npm run typecheck` : OK
- `npm test` : **83/83**
- `npx playwright test` : **119/119** (11 cas ignorés volontairement selon le projet : tests tactiles sur iPad émulé seulement, téléchargement et hors ligne sur bureau seulement)
- Détail des mesures de netteté : [RENDU.md](RENDU.md)
- `npm run build` : OK ; `node scripts/check-secrets.mjs` : aucun secret

### Non testé automatiquement / limites
- **WebKit** (moteur de Safari, iPad Pro 11 émulé) : exécuté en CI GitHub uniquement (image officielle Playwright).
  11/11/2026 : **6/6** (formats et modèles, note rapide et tableau blanc, dossiers, corbeille/favoris/tri, **migration
  d'une base v1**, deux onglets ; téléchargement et hors ligne testés sur Chromium bureau). Les tests d'écriture pilotent
  le stylet via le protocole Chromium et ne tournent donc pas sur WebKit : l'écriture sous Safari reste à valider sur l'iPad.
- **Incident CI du 11/11/2026** : les machines GitHub ne résolvaient plus les miroirs apt d'Ubuntu, bloquant
  l'installation des navigateurs. Les tests de bout en bout tournent désormais dans l'image Playwright (sans apt).
- **Apple Pencil réel** : latence, rejet de paume, pression réelle, survol, rotation : voir la procédure [IPAD.md](IPAD.md).
- **Performances** : aucune mesure sur iPad n'a encore été faite. L'interface affiche des mesures réelles
  (temps de rendu, délai événement → frame, échantillons/s) à activer dans les réglages. Aucun chiffre n'est annoncé.
- **Synchronisation, authentification, isolation de compte, conflits** : sans objet (aucun serveur, décision du 11/11/2026).
- **Insertion d'image depuis le sélecteur de fichiers** : testée indirectement (sauvegarde et restauration d'images en unitaire) ;
  l'ouverture du sélecteur de fichiers de l'iPad est à vérifier à la main.
- **Annotation/export PDF** : non implémentés.
- **Reconnaissance d'écriture réelle** : aucun appel réel à Google Vision (réponses simulées) ; la reconnaissance du navigateur n'est pas disponible dans Chromium headless ; Scribble ne peut être testé que sur iPad.
- **Écran toujours allumé (Wake Lock)** : non testable automatiquement ; à vérifier sur l'iPad (selon la version d'iPadOS, il peut ne pas fonctionner dans l'app installée sur l'écran d'accueil).
- **Stylet simulé** : les événements du protocole Chromium n'ont ni la fréquence (240 Hz) ni le bruit d'un Apple Pencil ; le test de précision horodate les événements à 240 Hz avec un ralentissement réaliste dans les angles.

## Validation iPad
_À compléter après la procédure de [IPAD.md](IPAD.md) : modèle d'iPad, version d'iPadOS, modèle de Pencil,
résultats par scénario, mesures affichées._
