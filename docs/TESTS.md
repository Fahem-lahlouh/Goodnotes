# Tests : résultats et limites

## Automatisés

| Suite | Outil | Couverture |
| --- | --- | --- |
| `tests/unit` (53 tests) | Vitest + fake-indexeddb | Viewport ; géométrie (gomme partielle, contact) ; **règles de sélection** (inclusion, contact, boîte seule insuffisante, indépendance vis-à-vis de la vitesse, lasso concave, objets, carré) ; **outils** (plume pleins/déliés, bille constante, paramètres par outil) ; session (annuler/rétablir, page de chaque étape, gomme groupée, traits + texte, lecture seule, purge, chargement paresseux) ; persistance (formats, dossiers, objets, images, suppression complète) ; file d'écriture ; sauvegardes (v2 avec images/texte/dossiers, relecture v1, sans écrasement) ; **copie de sécurité avant mise à niveau v1 → v2** ; migrations ; reprise des anciennes préférences |
| `tests/e2e` (45 tests exécutés : Chromium bureau + iPad émulé) | Playwright | Stylet via le protocole Chromium (pression, inclinaison) ; 4 outils au rendu distinct (mesure du canvas) ; favoris ; coordonnées après zoom ; **plein écran + concentration + écriture** ; **historique combiné** (3 traits → gomme partielle → déplacement → tout annuler → tout rétablir, puis rechargement) ; clavier ; **changement de page + annulation** ; **zoom + gomme** ; règles de sélection ; rectangle / carré / poignée / couleur / épaisseur ; **sélection + navigation** ; texte ; souris ; **navigation horizontale tactile** (balayage, arrêt net, page agrandie, deux doigts, pincement) ; **doigt + stylet** et paume pendant un tracé ; bibliothèque (formats, modèles, dossiers, tri, favoris, corbeille) ; **migration d'une base v1** dans l'app ; export/restauration ; deux onglets ; hors ligne |
| CI GitHub | Actions | Les mêmes + WebKit « iPad Pro 11 » (bibliothèque, dossiers, migration, onglets) |

### Résultats du 11/11/2026 (environnement Linux, Chromium headless)
- `npm run typecheck` : OK
- `npm test` : **53/53**
- `npx playwright test` : **45/45** (7 cas ignorés volontairement selon le projet : tests tactiles sur iPad émulé seulement, téléchargement et hors ligne sur bureau seulement)
- `npm run build` : OK ; `node scripts/check-secrets.mjs` : aucun secret

### Non testé automatiquement / limites
- **WebKit** (moteur de Safari, iPad Pro 11 émulé) : exécuté en CI GitHub uniquement. Premier passage le
  11/11/2026 : **4/4** (création/réouverture et pages, corbeille, recherche, deux onglets). Les tests d'écriture
  pilotent le stylet via le protocole Chromium et ne tournent donc pas sur WebKit : l'écriture sous Safari
  reste à valider sur l'iPad.
- **Apple Pencil réel** : latence, rejet de paume, pression réelle, survol, rotation : voir la procédure [IPAD.md](IPAD.md).
- **Performances** : aucune mesure sur iPad n'a encore été faite. L'interface affiche des mesures réelles
  (temps de rendu, délai événement → frame, échantillons/s) à activer dans les réglages. Aucun chiffre n'est annoncé.
- **Synchronisation, authentification, isolation de compte, conflits** : sans objet (aucun serveur, décision du 11/11/2026).
- **Insertion d'image depuis le sélecteur de fichiers** : testée indirectement (sauvegarde et restauration d'images en unitaire) ;
  l'ouverture du sélecteur de fichiers de l'iPad est à vérifier à la main.
- **Annotation/export PDF** : non implémentés.

## Validation iPad
_À compléter après la procédure de [IPAD.md](IPAD.md) : modèle d'iPad, version d'iPadOS, modèle de Pencil,
résultats par scénario, mesures affichées._
