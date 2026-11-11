# État d'avancement

_Mis à jour à chaque session. Le produit n'est **pas terminé**._

## Étape 1 — Fondations et preuve technique : ✅ (validation iPad réelle en attente)
- Architecture, choix techniques, documentation.
- Moteur d'encre : stylet/doigt, pression, inclinaison, lissage, prédiction, stylo, surligneur, gomme
  (trait/partielle), lasso, annuler/rétablir, zoom/défilement, rotation.
- Persistance IndexedDB incrémentale, reprise après rechargement, migrations.
- PWA : manifeste, icônes, service worker hors ligne, mises à jour contrôlées.
- CI (types, unitaires, build, secrets, e2e) et déploiement GitHub Pages.

## Corrections et améliorations du 11/11/2026 : ✅
Plein écran réel, quatre outils d'écriture distincts, favoris, gomme réglable, historique fiabilisé, navigation horizontale,
mode doigt explicite, sélections lasso/rectangle/carré, texte et images, refonte du design, formats et modèles, dossiers,
copie de sécurité automatique avant mise à niveau. Détail : [CORRECTIONS.md](CORRECTIONS.md), inventaire : [AUDIT.md](AUDIT.md).

## Écriture, 2ᵉ lot du 11/11/2026 : ✅ (validation iPad en attente)
Précision du trait (filtre One Euro, encre jusqu'à la pointe, plus de saut au lever ni de goutte au départ), feutre fin et
marqueur, annuler/rétablir fiabilisé (gestes dont la fin est perdue), forme nette par maintien, fenêtre de zoom d'écriture,
conversion manuscrit → texte avec vérification. Détail : [ECRITURE.md](ECRITURE.md) ; services : [RECONNAISSANCE.md](RECONNAISSANCE.md).

## Étape 2 — Application quotidienne : 🔶 en cours
Fait : bibliothèque (barre latérale, carnets, couvertures, formats, modèles, récents, favoris, tri, recherche titres,
dossiers, corbeille), pages (ajout, duplication, suppression, réordonnancement, miniatures paresseuses), texte, images,
sauvegarde/restauration v2, protection multi-onglets, thèmes, plein écran / concentration, raccourcis.

Reste (par priorité) :
1. Retours de la validation iPad ([IPAD.md](IPAD.md)) → corrections du moteur en priorité.
2. Verrouillage de l'espace local (code + Web Crypto, AES-GCM / PBKDF2).
3. Import / annotation / export PDF (PDF.js, rendu progressif).
4. Recherche dans le texte des blocs ; signets et étiquettes ; sous-dossiers.
5. Glisser-déposer des pages ; renommer depuis l'éditeur ; palette de commandes (⌘K).

## Étape 3 — Documents : 🔶
- Fait : blocs de texte, images. À faire : import PDF (pdf.js, rendu progressif), annotation, export PDF/image, formes.
- Synchronisation : **retirée du périmètre** (décision du 11/11/2026 : aucune base, 100 % gratuit). Copie entre
  appareils par fichier `.calame`.

## Étape 4 — Fonctions avancées : ⬜
Reconnaissance : conversion avec vérification faite (Scribble / navigateur / Google Vision optionnel) ; reste la recherche dans l'écriture. Audio synchronisé (les horodatages par point existent déjà),
fiches et répétition espacée, liens entre notes, vue partagée, modèles réunion/Java, blocs de code.

## Étape 5 — Finition et déploiement : ⬜
Mesures de performance sur iPad, accessibilité, déploiement vérifié.

## Décisions
- 11/11/2026 : aucune base de données ni serveur ; stockage sur l'appareil ; 100 % gratuit (GitHub Pages + Actions
  sur dépôt public). Indicateur « Non synchronisé » remplacé par l'âge de la dernière sauvegarde exportée.

## Points d'attention
- WebKit en CI : bloquant depuis le premier passage vert (bibliothèque, pages, multi-onglets) ; pas de test d'écriture WebKit automatisé.
- `getCoalescedEvents` sur Safari : un bogue d'identifiant de pointeur a été signalé sur iOS 18.2 ; Calame n'utilise pas cet identifiant.
