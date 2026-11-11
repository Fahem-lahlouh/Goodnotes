# Tests : résultats et limites

## Automatisés

| Suite | Outil | Couverture |
| --- | --- | --- |
| `tests/unit` (34 tests) | Vitest + fake-indexeddb | Viewport (conversions après zoom/déplacement, bornes), géométrie (gomme partielle, contact, lasso, transformation), session (annuler/rétablir, groupement de la gomme, lecture seule, purge à la suppression de page), persistance (création/réouverture, propriétés des traits, pages atomiques, suppression sans orphelins), file d'écriture (échec quota → nouvel essai sans perte ni réordonnancement), sauvegarde (base64 sans perte, aller-retour, restauration sans écrasement, fichiers invalides), migrations (v0 → v1, refus d'un schéma futur) |
| `tests/e2e` (22 tests exécutés, 2 projets) | Playwright, Chromium | Stylet simulé via le protocole Chromium (pression, inclinaison) : écriture + rechargement, coordonnées après zoom/déplacement, annuler/rétablir, gommes, lasso ; gestes tactiles réels (défilement au doigt après détection du stylet, pincement) ; souris ; bibliothèque (pages, corbeille, recherche) ; export puis restauration dans un navigateur vierge ; deux onglets (lecture seule, prise de main) ; hors ligne après première visite |

### Résultats du 11/11/2026 (environnement Linux, Chromium 1243 headless)
- `npm run typecheck` : OK
- `npm test` : **34/34**
- `npm run build` : OK (JS 92 Ko gzip)
- `npx playwright test` : **22/22** (4 cas ignorés volontairement selon le projet : souris/export/hors ligne testés sur bureau seulement)
- `node scripts/check-secrets.mjs` : aucun secret

### Non testé automatiquement / limites
- **Safari et WebKit** : non exécutables dans l'environnement de développement initial (téléchargement bloqué).
  La CI GitHub exécute une étape WebKit « iPad Pro 11 » **informative** ; elle n'est pas encore validée.
- **Apple Pencil réel** : latence, rejet de paume, pression réelle, survol, rotation : voir la procédure [IPAD.md](IPAD.md).
- **Performances** : aucune mesure sur iPad n'a encore été faite. L'interface affiche des mesures réelles
  (temps de rendu, délai événement → frame, échantillons/s) à activer dans les réglages. Aucun chiffre n'est annoncé.
- **Synchronisation, authentification, isolation de compte, conflits** : non testés car non implémentés.
- **Annotation/export PDF** : non implémentés.

## Validation iPad
_À compléter après la procédure de [IPAD.md](IPAD.md) : modèle d'iPad, version d'iPadOS, modèle de Pencil,
résultats par scénario, mesures affichées._
