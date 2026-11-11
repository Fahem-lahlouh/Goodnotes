# Corrections du 11/11/2026 — rapport détaillé

Légende des vérifications : **[auto]** test automatisé (Vitest ou Playwright/Chromium), **[nav]** essai dans un navigateur
(captures Chromium), **[iPad]** à vérifier sur votre iPad (procédure dans [IPAD.md](IPAD.md)). Aucune validation Apple
Pencil n'a été faite sur matériel réel.

## 0. Conservation des notes (préalable)
- **Risque** : les nouvelles fonctions demandaient de nouveaux magasins de données (texte, images, dossiers).
- **Correction** : base IndexedDB v2 *additive* (aucun enregistrement existant n'est réécrit). Avant toute mise à niveau, **copie
  complète automatique** dans une base séparée `calame-safety` (3 dernières copies, exportables depuis « Stockage et
  sauvegardes »). Enregistrements migrés v1 → v2 à la lecture ; sauvegardes `.calame` v1 toujours relisibles.
- **Tests** : [auto] `snapshot.test.ts` (base v1 réelle → v2, copie présente, aucune donnée perdue) ; e2e « mise à niveau d'une
  base v1 existante » (carnet v1 ouvert dans l'app, trait présent, copie listée) ; relecture d'un fichier v1 ; aller-retour
  export/restauration avec texte, images et dossiers.
- **Limite** : un onglet resté ouvert sur l'ancienne version ne peut plus écrire après la mise à niveau (il est invité à se
  recharger par le navigateur) ; ses écritures non enregistrées restent affichées en erreur.

## 1. Plein écran incomplet
- **Cause** : le bouton « agrandir » activait seulement le *mode concentration* (masquage de la barre du carnet, en CSS). L'API
  Plein écran du navigateur n'était jamais appelée : la barre de Chrome restait donc visible (capture 1).
- **Correction** : trois modes distincts.
  - *Plein écran* (icône ⛶) : `requestFullscreen` (ou `webkitRequestFullscreen`), sortie par le bouton ou Échap, état du
    bouton synchronisé sur l'événement `fullscreenchange`. S'il est refusé ou indisponible, une explication s'affiche
    (installation sur l'écran d'accueil), sans prétendre masquer l'interface du navigateur en CSS.
  - *Mode concentration* (icône cible, touche F) : masque la barre du carnet, garde les outils et une petite barre flottante.
  - *Mode application* : lancement depuis l'écran d'accueil (aucune interface de navigateur), détecté et affiché dans Réglages.
  - Dimensions et repères recalculés à chaque changement (ResizeObserver, `resize`, `fullscreenchange`).
- **Tests** : [auto] e2e « plein écran / mode concentration + écriture » (plein écran réellement obtenu dans Chromium, bouton
  synchronisé, puis écriture : le premier point du trait tombe exactement sous le stylet).
- **Limites** : [iPad] la disponibilité de l'API Plein écran dépend de la version d'iPadOS/Safari ; elle est détectée, pas
  supposée. Sur iPhone elle n'existe pas pour une page. La solution sûre sur iPad reste le lancement depuis l'écran d'accueil.

## 2. Outils d'écriture trop limités
- **Cause** : un seul rendu de stylo, épaisseurs en 4 boutons, pas de favoris, réglages globaux.
- **Correction** : quatre outils au rendu réellement distinct — **bille** (largeur quasi constante), **plume** (pleins et déliés
  selon la direction, bec à 45°), **pinceau** (forte variation, extrémités effilées), **crayon** (texture de graphite) — plus le
  surligneur. Pour chaque outil : épaisseur (curseur + préréglages), palette de 16 couleurs + couleurs personnalisées
  mémorisées, lissage, **aperçu exact** (même moteur de rendu que la page). Pression et inclinaison réglables (utilisées
  seulement si fournies). **Favoris** (outil + couleur + épaisseur + lissage) en un toucher. Réglages mémorisés par outil.
  Les paramètres de rendu sont figés dans chaque trait : changer un réglage ne modifie pas les anciens traits.
  **Texte saisi** : outil Texte distinct, 5 polices système (Sans, Serif, Code, Arrondie, Manuscrite), taille, gras, italique,
  souligné, couleur, alignement.
- **Tests** : [auto] e2e « rendus réellement différents » (mesure de l'encre sur le canvas pour les 4 outils), « favoris »,
  « texte » ; unitaire plume (pleins/déliés ≥ 1,8×, bille constante).
- **Limites** : mise en forme par bloc de texte, pas par caractère. [iPad] ressenti de la pression/inclinaison à valider.

## 3. Design
- **Correction** : bibliothèque avec barre latérale (Documents, Favoris, Corbeille, Dossiers, Stockage), grand titre, recherche,
  tri, menu « Nouveau », récents, cartes de carnets avec couvertures (couleur × motif) et étoile ; dialogue de création en
  galerie (format, couleur, orientation, modèles groupés avec aperçus réels) ; éditeur : barre de navigation (page précédente,
  compteur, suivante), barre d'outils avec outil actif nettement marqué et panneaux flottants qui se ferment d'un appui ailleurs
  **sans bloquer le trait** ; thèmes clair/sombre revus ; cibles tactiles ≥ 44 px ; portrait et paysage.
- **Tests** : [nav] captures 820 × 1180 et 1180 × 820, clair et sombre ; [auto] tous les e2e passent par les nouveaux écrans.
- **Limites** : [iPad] confort réel (taille des boutons, zones de sécurité, clavier virtuel) à confirmer.

## 4. Gomme non réglable
- **Cause** : la taille n'était réglable que dans la fenêtre Réglages (introuvable en écrivant), sans aperçu.
- **Correction** : panneau Gomme (second appui sur l'outil) : mode trait entier / partielle, curseur 6–96 px, 4 préréglages,
  aperçu du diamètre à l'échelle réelle, « surligneur seulement ». Dernière taille mémorisée.
  **Règle au zoom** : le diamètre est constant *à l'écran* ; en unités de page, rayon = diamètre / 2 / zoom. Le cercle affiché
  a exactement ce rayon. Trait entier : supprimé si son encre touche le cercle. Partielle : la portion dont l'encre entre dans
  le cercle est retirée, les extrémités restantes s'arrêtent au bord. Un geste = une action d'historique, même s'il coupe
  plusieurs traits.
- **Tests** : [auto] e2e « gomme : taille réglable, aperçu exact au zoom » (24 px n'efface pas à 28 px, 64 px efface ; après
  zoom ×2, rayon écran = 32 px exactement, 40 px hors zone, 26 px dans la zone ; taille mémorisée) ; e2e historique (une gomme
  qui coupe 3 traits = 1 action, annulée/rétablie en entier).

## 5. Annuler / rétablir peu fiables
- **Causes** (le scénario simple passait déjà dans Chromium ; les défauts venaient des cas combinés) :
  1. l'annulation s'appliquait à une page **non affichée** (défilement vertical multi-pages) : impression que « rien ne se passe » ;
  2. le **toucher à deux doigts** pouvait déclencher une annulation à la fin d'un petit pincement ;
  3. boutons actifs en **lecture seule** (autre onglet) mais sans effet ;
  4. un trait **rétabli** pouvait s'afficher au-dessus de traits plus récents jusqu'au rendu suivant ;
  5. aucune protection contre une annulation **pendant** un geste de gomme.
- **Correction** : historique **par document** (500 étapes, non conservé après fermeture) ; chaque étape mémorise sa page et
  **la page est affichée avant d'annuler/rétablir** ; trait = 1 action, geste de gomme = 1 action, déplacement / redimensionnement
  continu = 1 action, couleur / épaisseur / texte / image = 1 action ; nouvelle action ⇒ branche de rétablissement supprimée ;
  boutons désactivés si rien à faire, en lecture seule et pendant un geste ; toucher à deux doigts limité à 220 ms, 10 px,
  sans zoom ; rendu incrémental seulement si le trait est au sommet de la pile. Les opérations sur les pages ne sont pas dans
  l'historique ; supprimer une page retire les étapes qui la concernent. Raccourcis : ⌘/Ctrl+Z, ⇧⌘Z, Ctrl+Y.
- **Tests** : [auto] e2e « 3 traits → gomme partielle → déplacement → tout annuler → tout rétablir = identique » (et identique
  après rechargement) ; « changement de page + annulation » ; « clavier et branche supprimée » ; unitaires session (texte +
  traits dans une même étape, lecture seule, purge).

## 6. Navigation horizontale
- **Correction** : mode **horizontal par défaut** (vertical en préférence). Une page à la fois, **arrêt net** (animation 260 ms
  vers la position de repos). Changement de page si le geste dépasse le bord de plus de 20 % de l'écran (ou balayage rapide),
  sinon retour en place. **Page agrandie** : le geste déplace d'abord dans la page ; le changement n'a lieu qu'au-delà du bord.
  Un pincement n'est jamais un changement de page. Gestes : *stylet uniquement* → un doigt ; *doigt et stylet* → deux doigts ;
  trackpad : balayage horizontal ; clavier : ← → ; boutons précédent / suivant et compteur (ouvre les miniatures).
  Aucun changement de page pendant un tracé ou une sélection ; changer de page vide la sélection.
  **Mémoire** : les pages sont chargées à la demande (page courante et voisines) ; les miniatures lisent puis libèrent le
  contenu ; le cache de chemins est borné (LRU).
- **Défaut trouvé pendant les tests** : un balayage à deux doigts était parfois pris pour un zoom (les deux doigts sont
  signalés l'un après l'autre, l'écart varie entre deux événements). Corrigé : seul le zoom **net** du geste compte.
- **Tests** : [auto] e2e (iPad émulé, tactile réel du protocole Chromium) : balayage gauche/droite, petit geste sans effet, arrêt
  net, page agrandie, deux doigts en mode doigt, long trait au stylet sans changement de page, pincement ; unitaire chargement
  paresseux.
- **Limites** : [iPad] seuils de geste à ajuster à l'usage réel.

## 7. Écriture au doigt impossible
- **Cause** : le mode « automatique » (caché dans Réglages) faisait passer le doigt en navigation **dès la détection d'un
  Apple Pencil**, définitivement ; une heuristique de paume (contact > 44 px) pouvait aussi rejeter un doigt.
- **Correction** : réglage explicite et visible (bouton « Doigt : écrit / navigue » dans la barre d'outils + Réglages) :
  *stylet uniquement* ou *doigt et stylet*. À la première détection du stylet en mode « doigt et stylet », une question est
  posée (rien n'est changé sans accord). Heuristique de paume désactivée par défaut (seuil 80 px si activée). Arbitrage
  centralisé : une seule interaction à la fois ; second doigt < 180 ms ⇒ navigation (le début de trait est annulé) ; stylet
  pendant une navigation au doigt ⇒ le stylet écrit ; doigt pendant un tracé au stylet ⇒ ignoré ; changement d'outil ou
  mise en arrière-plan ⇒ geste terminé proprement. Souris : écrit au bouton gauche, déplacement avec Espace ou bouton du milieu.
- **Tests** : [auto] e2e doigt (un doigt écrit, deux doigts tournent la page), paume pendant un tracé au stylet (ignorée, pas de
  défilement), souris ; unitaire reprise des anciennes préférences.
- **Limites** : [iPad] la réjection de paume n'est pas garantie sans essai réel.

## 8. Lasso défectueux, sélection rectangulaire absente
- **Cause** : un trait était sélectionné si **≥ 50 % de ses points** étaient dans le lasso. Le nombre de points dépend de la
  vitesse d'écriture : un trait dont seul le début (écrit lentement) était entouré était sélectionné alors que l'essentiel était
  dehors (reproduit). Pas de rectangle ni de carré ; sélection peu visible (seulement un cadre).
- **Correction** : modes **lasso**, **rectangle**, **carré** (contrainte accessible au doigt via le panneau ; Maj sur
  ordinateur). **Règle explicite** : « entièrement inclus » (par défaut : tous les points du tracé dans la zone) ou « touchés »
  (un point dans la zone ou un segment qui croise le contour). Toujours la géométrie réelle, jamais la seule boîte englobante.
  Filtres traits / textes / images. Aperçu en direct des éléments retenus pendant le tracé de la zone ; éléments sélectionnés
  surlignés ; 4 poignées de redimensionnement ; déplacer, dupliquer, copier / couper / coller, supprimer, couleur, épaisseur ;
  tout est annulable. La sélection est en coordonnées de page : elle suit zoom, défilement et rotation.
- **Tests** : [auto] unitaires (`selection.test.ts` : inclusion, contact, boîte seule insuffisante, indépendance vis-à-vis de la
  vitesse, lasso concave, objets) ; e2e règle inclus/touchés sur le cas reproduit, rectangle vs carré, poignée,
  couleur/épaisseur puis annulations, sélection + navigation.
