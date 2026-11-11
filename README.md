# Calame

Carnets manuscrits personnels pour **iPad et Apple Pencil**, sous forme d'application web installable (PWA).
Goodnotes sert de référence fonctionnelle ; Calame a sa propre identité (nom, logo, interface).

> **État : étapes 1 et 2 en grande partie réalisées ; PDF, verrouillage local et reconnaissance restent à faire.**
> **Aucune base de données, aucun serveur, 100 % gratuit** : les notes sont stockées uniquement sur l'appareil
> (IndexedDB). Exportez régulièrement une sauvegarde (bouton dans l'éditeur) dans Fichiers ou iCloud Drive. Détail : [docs/PROGRESS.md](docs/PROGRESS.md).

## Ce qui fonctionne aujourd'hui

- **Écriture** : stylo à bille, plume (pleins et déliés), pinceau, crayon, surligneur ; épaisseur, palette et couleurs
  personnalisées, lissage, pression et inclinaison ; aperçu exact du trait ; favoris ; réglages mémorisés par outil.
- **Doigt** : bouton visible « Doigt : écrit / navigue » (stylet uniquement, ou doigt et stylet avec deux doigts pour naviguer).
- **Gomme** trait entier ou partielle, diamètre réglable (préréglages + curseur) avec aperçu exact, y compris au zoom.
- **Sélection** lasso, rectangle ou carré ; règle explicite (entièrement inclus / touchés) ; filtres traits / textes / images ;
  déplacer, redimensionner, dupliquer, copier-coller, recolorer, épaissir, supprimer.
- **Annuler / rétablir** fiables (par document, la page concernée est affichée d'abord), raccourcis ⌘Z / ⇧⌘Z / Ctrl+Y.
- **Pages** : navigation horizontale par défaut (balayage, arrêt net, compteur, boutons), verticale en option ; miniatures ;
  chargement des pages à la demande.
- **Texte** saisi (5 polices, taille, gras, italique, souligné, alignement) et **images**.
- **Bibliothèque** : dossiers, favoris, récents, tri, recherche, corbeille ; formats A3–A7, Lettre, Tabloïd, portrait/paysage ;
  papier blanc, jaune, crème ou sombre ; modèles (ligné, quadrillé, pointillé, Cornell, colonnes, tâches, semainier, mensuel,
  réunion, brainstorming, révision Java, fiches Q/R) ; note rapide ; tableau blanc (grande page).
- **Plein écran** réel (API du navigateur), **mode concentration**, et mode application depuis l'écran d'accueil.
- **Données** : enregistrement automatique trait par trait, âge de la dernière sauvegarde visible (export en un toucher),
  sauvegarde `.calame` complète et restauration sans écrasement, copie de sécurité automatique avant toute mise à niveau du format,
  protection multi-onglets, hors ligne, mises à jour à la demande.

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

Chaque fusion sur `main` construit, publie, puis **vérifie la version réellement servie** (`version.json` doit correspondre
au commit déployé). Adresse : **https://fahem-lahlouh.github.io/Goodnotes/**.

GitHub Pages publie **l'interface** (code public, gratuit pour un dépôt public). Il ne stocke aucune note : vos notes
restent dans le navigateur de votre iPad et ne sont jamais envoyées. Seule exception, **si vous l'activez vous-même**
avec votre clé : l'image des traits que vous convertissez en texte part vers Google Cloud Vision ([docs/RECONNAISSANCE.md](docs/RECONNAISSANCE.md)).
Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentation

| Document | Contenu |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture, choix techniques, hébergement, sécurité |
| [docs/FEATURES.md](docs/FEATURES.md) | Matrice des fonctionnalités et état réel |
| [docs/CORRECTIONS.md](docs/CORRECTIONS.md) | Corrections du 11/11/2026 : cause, correction, test, limites |
| [docs/ECRITURE.md](docs/ECRITURE.md) | Écriture (2ᵉ lot) : précision, stylos, annuler fiable, formes nettes, fenêtre de zoom, conversion en texte |
| [docs/RENDU.md](docs/RENDU.md) | Netteté des traits : diagnostic mesuré, corrections, ce qui a été testé (4ᵉ lot) |
| [docs/OUTILS.md](docs/OUTILS.md) | Menus Outils et Plus, règle, Formes, laser, notes, minuteur, favoris et plan, téléphone (3ᵉ lot) |
| [docs/RECONNAISSANCE.md](docs/RECONNAISSANCE.md) | Conversion manuscrit → texte : services, données envoyées, coûts |
| [docs/AUDIT.md](docs/AUDIT.md) | Audit de Goodnotes et tableau de suivi |
| [docs/IPAD.md](docs/IPAD.md) | Installation sur iPad et procédure de validation manuelle |
| [docs/BACKUP.md](docs/BACKUP.md) | Sauvegarde et restauration |
| [docs/FORMAT.md](docs/FORMAT.md) | Format de données et fichier `.calame` |
| [docs/TESTS.md](docs/TESTS.md) | Tests automatisés, résultats, limites |
| [docs/PROGRESS.md](docs/PROGRESS.md) | État d'avancement et prochaines étapes |

## Licence des dépendances

React (MIT), perfect-freehand (MIT), idb (ISC). Outils de développement : Vite, Vitest, Playwright, TypeScript.
