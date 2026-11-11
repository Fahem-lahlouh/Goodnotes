# Architecture

## Vue d'ensemble

```
┌──────────────── Navigateur (Safari iPadOS / ordinateur) ────────────────┐
│  Interface React (src/ui)            ← préférences de l'appareil         │
│     │  outil, réglages        ▲ page courante, zoom, sélection           │
│     ▼                         │                                          │
│  Moteur d'encre (src/ink)  — TypeScript pur, 2 canvas, aucun rendu React │
│     │  changements {before, after}                                       │
│     ▼                                                                    │
│  Session du carnet (src/model/session.ts) — historique annuler/rétablir  │
│     │  écritures sérialisées                                             │
│     ▼                                                                    │
│  Persistance locale (src/storage) — IndexedDB, migrations, sauvegardes   │
│  Service worker (sw.js) — cache de l'application uniquement             │
└──────────────────────────────────────────────────────────────────────────┘
        ▲ fichiers statiques (code public)        Aucun serveur, aucune base de données :
   GitHub Pages                                 les notes ne quittent jamais l'appareil
```

| Rôle | Solution actuelle | Remarque |
| --- | --- | --- |
| Dépôt du code | GitHub `Fahem-lahlouh/Goodnotes` | Public requis pour Pages gratuit : aucun secret, aucune note. |
| Hébergement de l'interface | GitHub Pages (workflow `deploy.yml`) | Statique, public. |
| Authentification | **Aucune (choix)** | Aucune donnée n'est sur un serveur ; verrouillage local par code prévu. |
| Stockage des données | IndexedDB du navigateur | Non garanti à vie → sauvegardes exportables. |
| Synchronisation | **Aucune (choix)** | Copie entre appareils par fichier `.calame`. |
| IA / reconnaissance | **Non implémentée** | Rien n'est envoyé à un service externe. |

## Modules

| Dossier | Responsabilité |
| --- | --- |
| `src/model` | Types du document (carnet, page, trait), identifiants, session + historique. |
| `src/ink` | Moteur d'écriture : entrées Pointer Events, gestes, outils, rendu, géométrie (gomme, lasso). |
| `src/storage` | IndexedDB (`db.ts`), accès (`repo.ts`), migrations, file d'écriture, ouverture multi-onglets, sauvegardes, quota. |
| `src/ui` | Écrans React : bibliothèque, éditeur, barre d'outils, panneaux. |
| `src/pwa` | Enregistrement et gabarit du service worker. |

## Décisions

### D1 — Pile technique
Vite + React 19 + TypeScript pour l'interface. Le **moteur d'encre n'utilise pas React** : il reçoit les
Pointer Events directement, accumule les points et dessine dans un `requestAnimationFrame`. React n'est
re-rendu que pour des changements d'état d'interface (outil, page courante, sélection).

### D2 — Rendu de l'encre
- `perfect-freehand` (MIT, ~200 lignes, sans dépendance, utilisé par tldraw/Excalidraw) calcule le contour
  d'un trait à partir des points et de la pression. Le contour est mis en cache (`Path2D`) par trait. Il est calculé dans
  un repère 8 fois plus fin, pour neutraliser un seuil fixe de la bibliothèque (crochets de fin de mot).
- **Saisie** (11/11/2026, 2ᵉ lot) : filtre One Euro sur la position (`src/ink/filter.ts`), fondé sur le temps réel entre
  événements ; points filtrés enregistrés, `streamline` à 0. L'encre affichée inclut le dernier échantillon brut, et le
  tracé en cours utilise exactement le calcul du trait enregistré.
- **Surfaces** : la page principale et la fenêtre de zoom sont deux `Surface` (deux canvas + une vue chacune) servies par
  le même moteur. Un trait écrit dans la fenêtre est créé une fois, en coordonnées page, et rendu sur les deux.
- **Formes nettes** : `src/ink/shapes.ts` (reconnaissance géométrique locale, seuils relatifs à la taille du tracé).
- Deux canvas : **base** (pages + traits enregistrés, redessinés vectoriellement à chaque changement de vue
  → netteté à tout zoom) et **live** (trait en cours, lasso, sélection, curseur), effacé à chaque frame.
- Ajout d'un trait au stylo : dessin **incrémental** sur le canvas de base (pas de rendu complet).
- Pendant un geste, si un rendu complet dépasse 12 ms, le canvas de base est transformé en CSS puis
  redessiné net dès que le geste se stabilise (≈120 ms).
- Les canvas sont limités à 16 Mpx (limite mémoire canvas d'iOS).

### D3 — Données éditables
Chaque trait est un enregistrement indépendant (`strokes`) : points `Float32Array` (x, y, pression, temps,
inclinaison), couleur, épaisseur, outil et **paramètres de rendu figés** (un changement de réglage ne modifie
pas les anciens traits). Aucune image bitmap n'est la source des données. Détails : [FORMAT.md](FORMAT.md).

### D4 — Écriture sûre
- Chaque action produit des changements `{before, after}` appliqués en mémoire puis écrits par une file
  sérialisée (`SaveQueue`) dans **une transaction IndexedDB** par action. En cas d'échec (quota, stockage
  indisponible), la file réessaie, n'abandonne rien et affiche l'erreur.
- Multi-onglets : verrou **Web Locks** par carnet (un seul onglet écrit), diffusion **BroadcastChannel**
  pour rafraîchir les autres. « Écrire ici » retire le verrou à l'autre onglet après vidage de sa file.
- Migrations : version de base IndexedDB + champ `v` sur chaque enregistrement, migrations pas à pas,
  refus explicite des données d'une version future.

### D4 bis — Arbitrage des entrées, historique, pagination (11/11/2026)
- **Un seul arbitre** (`InkEngine.onDown/onMove/onUp`) et **au plus une interaction active** : tracé, gomme, sélection,
  transformation, navigation ou appui texte. Les règles stylet / doigt / souris sont décrites en tête de `src/ink/engine.ts`.
- **Historique par document** dans `NotebookSession` : chaque étape = un ensemble de changements `{before, after}` sur des
  traits et des objets, avec la page concernée (affichée avant d'annuler). Gestes continus regroupés (`beginBatch/endBatch`).
- **Pagination** : mise en page horizontale (pages côte à côte) ou verticale (`computeLayout`) ; en horizontal, la vue est
  contrainte à la page courante, le dépassement du bord pendant un geste décide du changement de page.
- **Chargement paresseux** : à l'ouverture, seules les métadonnées des pages sont lues ; le contenu d'une page est chargé
  quand elle devient visible ou voisine ; cache de chemins `Path2D` borné (LRU).
- **Objets de page** : textes et images dans un magasin séparé ; ordre de rendu : papier → images → surligneur → texte → encre.

### D5 — Service worker
Écrit à la main (≈70 lignes, `src/pwa/sw-template.js`) plutôt que Workbox (dont `workbox-build` remontait
des alertes de sécurité). Il ne met en cache **que les fichiers de l'application** listés au build ; aucune
autre requête n'est interceptée. Une nouvelle version **attend** que l'utilisateur touche « Mettre à jour »,
après vidage de la file d'écriture.

### D6 — Sécurité du frontend
CSP stricte injectée au build (`script-src 'self'`, `connect-src 'self' https://vision.googleapis.com`, `object-src 'none'`…),
`referrer: no-referrer`, aucun script tiers. Seule requête sortante possible : la reconnaissance Google Cloud Vision,
**désactivée par défaut**, avec la clé de l'utilisateur stockée localement (voir [RECONNAISSANCE.md](RECONNAISSANCE.md)). `scripts/check-secrets.mjs`
bloque le build CI si un motif de secret apparaît dans le dépôt ou le bundle.

## Choix : aucune base de données, 100 % gratuit (décision du 11/11/2026)

Les notes sont stockées **uniquement sur l'appareil** (IndexedDB du navigateur). Il n'y a ni serveur, ni
base de données, ni compte, ni synchronisation automatique. Coût : **0 €**.

| Besoin | Réponse sans base de données | Coût |
| --- | --- | --- |
| Héberger l'interface | GitHub Pages | Gratuit **pour un dépôt public** (un dépôt privé exige une offre GitHub payante) |
| CI / déploiement | GitHub Actions | Gratuit (dépôt public) |
| Stocker les notes | IndexedDB de l'iPad | Gratuit, limité par l'espace de l'appareil |
| Copie de secours | Fichier `.calame` exporté dans Fichiers / iCloud Drive (5 Go gratuits) | Gratuit |
| Autre appareil | Exporter puis restaurer le fichier `.calame` | Gratuit |
| Espace réservé à soi | Les notes ne sont jamais envoyées : visiter l'adresse du site ne donne accès à rien. Verrouillage par code prévu (ci-dessous) | Gratuit |

Ce que ce choix implique :
- **Le code et l'interface sont publics** (dépôt public + GitHub Pages) ; ils ne contiennent ni secret ni note
  (contrôle automatique `check-secrets`).
- Pas de copie distante automatique : **la sauvegarde exportée est la seule protection** contre l'effacement du
  stockage du navigateur. L'éditeur affiche donc en permanence l'âge de la dernière sauvegarde (un toucher = export).
- Pas de synchronisation ni de gestion de conflits entre appareils (fonctionnalités retirées du périmètre).

### Verrouillage local (prévu, étape 2)
Code d'accès choisi par l'utilisateur → clé AES-GCM 256 dérivée par PBKDF2-SHA-256 (Web Crypto, aucun
algorithme maison). Points chiffrés avant écriture dans IndexedDB ; verrouillage après inactivité et à la mise en
arrière-plan ; clé jamais stockée. Code oublié = données illisibles : récupération uniquement par une sauvegarde
exportée (elle-même chiffrable). Protège contre l'accès à l'iPad déverrouillé par un tiers, pas contre un
appareil compromis.

### Si un jour une copie distante devient nécessaire
Options gratuites possibles sans « base » à administrer : dépôt du fichier `.calame` chiffré dans un stockage
personnel (iCloud Drive via la feuille de partage, déjà possible). Toute solution avec serveur (Supabase,
Cloudflare…) est écartée tant qu'elle n'est pas explicitement demandée.

## Limites connues de la plateforme web (Safari iPadOS)

- Double-tap / pression (squeeze) de l'Apple Pencil : non exposés aux pages web.
- Rejet de paume : le web ne fournit pas l'information native ; Calame ignore les doigts quand le stylet écrit
  et en mode « le doigt navigue ». Performances réelles à valider sur l'appareil ([IPAD.md](IPAD.md)).
- `getCoalescedEvents` : disponible dans Safari récent (iOS 18.2 selon les sources consultées) ; repli automatique sinon.
- Stockage : Safari peut évincer les données d'un site ; l'app installée sur l'écran d'accueil a de meilleures
  chances d'obtenir le stockage persistant (accordé par heuristique, non garanti).
