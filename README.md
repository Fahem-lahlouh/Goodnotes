# Calame

Carnets manuscrits personnels pour **iPad et Apple Pencil**, sous forme d'application web installable (PWA).
Goodnotes sert de référence fonctionnelle ; Calame a sa propre identité (nom, logo, interface).

> **État : étape 1 terminée (fondations + moteur d'écriture), étape 2 en partie.**
> Les notes sont stockées **uniquement sur l'appareil** (IndexedDB). La synchronisation privée n'existe pas encore.
> Exportez régulièrement une sauvegarde. Détail : [docs/PROGRESS.md](docs/PROGRESS.md).

## Ce qui fonctionne aujourd'hui

- Écriture au stylet avec pression (et inclinaison si activée), lissage réglable, points prédits.
- Mode « stylet pour écrire, doigts pour naviguer » (automatique dès qu'un Apple Pencil est détecté).
- Stylo, surligneur (sous l'encre), gomme par trait ou partielle, lasso (déplacer, redimensionner, dupliquer, recolorer, supprimer).
- Annuler / rétablir (boutons, ⌘Z / ⇧⌘Z, toucher à deux / trois doigts).
- Zoom et défilement à deux doigts, à la molette / trackpad ; traits nets à tout niveau de zoom ; rotation de l'iPad.
- Bibliothèque : carnets avec couverture et papier (blanc, ligné, quadrillé, pointillé), récents, favoris, recherche par titre, corbeille.
- Pages : ajout, duplication, suppression, réordonnancement, miniatures.
- Enregistrement local automatique trait par trait, indicateur d'état, reprise à la même position.
- Protection multi-onglets (un seul onglet écrit, les autres en lecture seule et à jour).
- Sauvegarde complète exportable et restauration sans écrasement.
- Fonctionnement hors ligne après la première visite ; mises à jour appliquées seulement à la demande.
- Thèmes clair et sombre, barre d'outils repositionnable, mode concentration, raccourcis clavier.

La liste complète, avec ce qui **n'est pas** encore fait : [docs/FEATURES.md](docs/FEATURES.md).

## Démarrer en local

```bash
npm ci
```

```bash
npm run dev
```

Le serveur affiche une adresse réseau (`http://192.168.x.x:5173`) utilisable depuis l'iPad sur le même Wi-Fi.
Le service worker (hors ligne) n'est actif que sur la version construite :

```bash
npm run build && npm run preview
```

## Vérifications

```bash
npm run check
```

```bash
npm run e2e
```

`check` = types + tests unitaires + build + contrôle des secrets. `e2e` = tests Playwright (Chromium bureau et iPad émulé).
Résultats et limites : [docs/TESTS.md](docs/TESTS.md).

## Déploiement (GitHub Pages)

1. Dans le dépôt GitHub : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
2. Fusionner sur `main` : le workflow `Déploiement GitHub Pages` construit et publie `dist/`.
3. Adresse attendue : `https://fahem-lahlouh.github.io/Goodnotes/`.

GitHub Pages publie **l'interface** (code public). Il ne protège pas l'accès et ne stocke aucune note : vos notes restent
dans le navigateur de votre iPad. Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour l'authentification et la synchronisation prévues.

## Documentation

| Document | Contenu |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture, choix techniques, hébergement, sécurité |
| [docs/FEATURES.md](docs/FEATURES.md) | Matrice des fonctionnalités et état réel |
| [docs/IPAD.md](docs/IPAD.md) | Installation sur iPad et procédure de validation manuelle |
| [docs/BACKUP.md](docs/BACKUP.md) | Sauvegarde et restauration |
| [docs/FORMAT.md](docs/FORMAT.md) | Format de données et fichier `.calame` |
| [docs/TESTS.md](docs/TESTS.md) | Tests automatisés, résultats, limites |
| [docs/PROGRESS.md](docs/PROGRESS.md) | État d'avancement et prochaines étapes |

## Licence des dépendances

React (MIT), perfect-freehand (MIT), idb (ISC). Outils de développement : Vite, Vitest, Playwright, TypeScript.
