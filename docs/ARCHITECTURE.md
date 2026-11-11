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
        ▲ fichiers statiques                    (étape 3, non implémentée)
   GitHub Pages                                 Service privé : auth + copie distante
```

| Rôle | Solution actuelle | Remarque |
| --- | --- | --- |
| Dépôt du code | GitHub `Fahem-lahlouh/Goodnotes` | Peut être public : aucun secret, aucune note. |
| Hébergement de l'interface | GitHub Pages (workflow `deploy.yml`) | Statique, public. |
| Authentification | **Aucune pour l'instant** | Les notes ne quittent pas l'appareil. Voir « Étape 3 ». |
| Stockage des données | IndexedDB du navigateur | Non garanti à vie → sauvegardes exportables. |
| Synchronisation | **Non implémentée** | Indicateur « Non synchronisé » toujours affiché. |
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
  d'un trait à partir des points et de la pression. Le contour est mis en cache (`Path2D`) par trait.
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

### D5 — Service worker
Écrit à la main (≈70 lignes, `src/pwa/sw-template.js`) plutôt que Workbox (dont `workbox-build` remontait
des alertes de sécurité). Il ne met en cache **que les fichiers de l'application** listés au build ; aucune
autre requête n'est interceptée. Une nouvelle version **attend** que l'utilisateur touche « Mettre à jour »,
après vidage de la file d'écriture.

### D6 — Sécurité du frontend
CSP stricte injectée au build (`script-src 'self'`, `connect-src 'self'`, `object-src 'none'`…),
`referrer: no-referrer`, aucun script tiers, aucune requête réseau sortante. `scripts/check-secrets.mjs`
bloque le build CI si un motif de secret apparaît dans le dépôt ou le bundle.

## Étape 3 — Authentification et synchronisation privée (à décider)

GitHub Pages ne fournit ni authentification serveur ni stockage privé. Deux options simples :

| | **A. Supabase** (recommandée) | **B. Cloudflare Pages + Access + Workers/D1/R2** |
| --- | --- | --- |
| Interface | Reste sur GitHub Pages | Déplacée sur Cloudflare Pages |
| Accès privé | Compte unique, inscriptions désactivées, règles RLS `owner = auth.uid()` côté base | Cloudflare Access devant **toute** l'application (même l'interface devient privée) |
| Stockage | Postgres (traits) + Storage (PDF, audio) | D1 (SQL) + R2 (fichiers) |
| Hors ligne | Inchangé (IndexedDB) ; synchro au retour du réseau | Idem |
| Maintenance | Faible (service géré) | Moyenne (code Worker à maintenir) |
| Coût | Offre gratuite suffisante pour un usage personnel ; **projet mis en pause après une période d'inactivité** sur l'offre gratuite ; offre payante ≈ 25 $/mois | Offres gratuites généreuses pour un utilisateur |

Les quotas et prix sont à **revérifier sur les pages officielles au moment du choix** (non consultables
depuis l'environnement de développement initial). Aucune option n'a été engagée.

Principes retenus quelle que soit l'option : la clé publique (« anon ») seule dans le bundle ; toute
autorisation appliquée **côté serveur** ; synchronisation par trait (identifiants UUID, horodatage,
suppressions en « pierres tombales ») ; en cas de conflit sur le même enregistrement, conservation des deux
versions plutôt qu'écrasement silencieux ; option de chiffrement de bout en bout (Web Crypto, AES-GCM, clé
dérivée PBKDF2) à étudier.

### Option « tout sur GitHub Pages »
Possible avec un **coffre local chiffré** (Web Crypto) : cela protège les données du coffre si quelqu'un
accède à l'appareil, mais **ne rend pas l'interface privée** (le site et son code restent publics) et
n'offre aucune copie distante. Ce n'est donc pas un substitut à l'accès privé demandé.

## Limites connues de la plateforme web (Safari iPadOS)

- Double-tap / pression (squeeze) de l'Apple Pencil : non exposés aux pages web.
- Rejet de paume : le web ne fournit pas l'information native ; Calame ignore les doigts quand le stylet écrit
  et en mode « le doigt navigue ». Performances réelles à valider sur l'appareil ([IPAD.md](IPAD.md)).
- `getCoalescedEvents` : disponible dans Safari récent (iOS 18.2 selon les sources consultées) ; repli automatique sinon.
- Stockage : Safari peut évincer les données d'un site ; l'app installée sur l'écran d'accueil a de meilleures
  chances d'obtenir le stockage persistant (accordé par heuristique, non garanti).
