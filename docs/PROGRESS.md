# État d'avancement

_Mis à jour à chaque session. Le produit n'est **pas terminé**._

## Étape 1 — Fondations et preuve technique : ✅ (validation iPad réelle en attente)
- Architecture, choix techniques, documentation.
- Moteur d'encre : stylet/doigt, pression, inclinaison, lissage, prédiction, stylo, surligneur, gomme
  (trait/partielle), lasso, annuler/rétablir, zoom/défilement, rotation.
- Persistance IndexedDB incrémentale, reprise après rechargement, migrations.
- PWA : manifeste, icônes, service worker hors ligne, mises à jour contrôlées.
- CI (types, unitaires, build, secrets, e2e) et déploiement GitHub Pages.

## Étape 2 — Application quotidienne : 🔶 en cours
Fait : bibliothèque (carnets, couvertures, papiers, récents, favoris, recherche titres, corbeille), pages
multiples (ajout, duplication, suppression, réordonnancement, miniatures), sauvegarde/restauration,
protection multi-onglets, thèmes, barre d'outils repositionnable, mode concentration, raccourcis.

Reste :
1. Retours de la validation iPad ([IPAD.md](IPAD.md)) → corrections du moteur en priorité.
2. Dossiers ; signets et étiquettes ; couleurs favorites personnalisables.
3. Verrouillage de l'espace local (code + Web Crypto) — conception : clé AES-GCM dérivée par PBKDF2,
   verrouillage après inactivité, récupération uniquement via sauvegarde exportée.
4. Glisser-déposer des pages ; renommer depuis l'éditeur.
5. Palette de commandes (⌘K), capture rapide.

## Étape 3 — Documents : ⬜
- Import PDF (pdf.js, rendu progressif), annotation, export PDF/image ; texte, images, formes.
- Synchronisation : **retirée du périmètre** (décision du 11/11/2026 : aucune base, 100 % gratuit). Copie entre
  appareils par fichier `.calame`.

## Étape 4 — Fonctions avancées : ⬜
Reconnaissance (évaluation locale vs externe opt-in), audio synchronisé (les horodatages par point existent déjà),
fiches et répétition espacée, liens entre notes, vue partagée, modèles réunion/Java, blocs de code.

## Étape 5 — Finition et déploiement : ⬜
Mesures de performance sur iPad, accessibilité, déploiement vérifié.

## Décisions
- 11/11/2026 : aucune base de données ni serveur ; stockage sur l'appareil ; 100 % gratuit (GitHub Pages + Actions
  sur dépôt public). Indicateur « Non synchronisé » remplacé par l'âge de la dernière sauvegarde exportée.

## Points d'attention
- WebKit en CI : bloquant depuis le premier passage vert (bibliothèque, pages, multi-onglets) ; pas de test d'écriture WebKit automatisé.
- `getCoalescedEvents` sur Safari : un bogue d'identifiant de pointeur a été signalé sur iOS 18.2 ; Calame n'utilise pas cet identifiant.
