# iPad : installation et validation manuelle

## Installer sur l'écran d'accueil
1. Ouvrir l'adresse de Calame dans **Safari** (pas dans une autre application).
2. Bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter**.
3. Lancer Calame depuis l'icône : l'application s'ouvre **sans barre Safari** (mode standalone).
4. Ouvrir une fois chaque écran avec du réseau, puis tester en mode Avion : l'app doit se lancer et écrire.

Le mode application (écran d'accueil) est distinct du plein écran du navigateur (bouton ⛶, API Fullscreen) : ce
dernier n'est proposé que si Safari l'autorise, et Calame l'indique sinon. Le lancement depuis l'écran d'accueil reste la
solution la plus fiable sur iPad. Les données de l'app installée sont séparées de celles de Safari : créez vos carnets
**dans l'app installée** (ou transférez-les par sauvegarde/restauration).

## Procédure de validation (≈ 20 min)

Activer d'abord **Réglages → Afficher les mesures de performance** et noter les valeurs affichées. Vérifier dans
**Réglages → Diagnostic** la version de Calame (elle doit correspondre au dernier déploiement).
Reporter les résultats dans `docs/TESTS.md` (section « Validation iPad »).

| # | Scénario | Attendu |
| --- | --- | --- |
| 1 | Écrire une ligne rapidement au Pencil, avec chacun des 4 stylos | Trait continu, sans retard gênant ; bille régulière, plume pleins/déliés, pinceau effilé, crayon granuleux |
| 2 | Appuyer plus fort puis plus léger | Le trait s'épaissit puis s'affine |
| 3 | Poser la paume puis écrire (mode « stylet uniquement ») | Aucun trait parasite, pas de défilement pendant l'écriture |
| 4 | Bouton « Doigt : écrit » : écrire au doigt ; deux doigts pour défiler | Le doigt trace ; deux doigts naviguent sans laisser de trait |
| 5 | Mode « stylet uniquement » : balayer d'un doigt vers la gauche puis la droite | Page suivante puis précédente, arrêt net ; un petit geste ne change pas de page |
| 6 | Zoomer à deux doigts, balayer d'un doigt | Le geste déplace dans la page ; la page ne change qu'au-delà du bord |
| 7 | Écrire après zoom, après rotation, après plein écran | Le trait est exactement sous la pointe |
| 8 | Gomme : diamètre 64, mode partiel, sur 3 traits ; puis annuler | Le cercle correspond à la zone effacée ; une seule annulation restaure tout |
| 9 | Lasso puis rectangle puis carré autour de mots ; déplacer, redimensionner, recolorer | Seuls les éléments attendus sont sélectionnés ; tout s'annule étape par étape |
| 10 | Écrire sur la page 1, aller page 2, annuler | Calame revient page 1 et annule là |
| 11 | Texte : toucher la page avec l'outil Texte, taper au clavier virtuel | Le champ reste visible au-dessus du clavier ; le bloc s'affiche après validation |
| 12 | Insérer une photo depuis la bibliothèque de l'iPad | L'image apparaît sélectionnée, déplaçable |
| 13 | Toucher à deux doigts / trois doigts | Annuler / rétablir (pas pendant un pincement) |
| 14 | Appui long au Pencil sans bouger | Pas de loupe, pas de menu, pas de sélection de texte |
| 15 | Bouton plein écran (Safari) | Plein écran obtenu, ou explication affichée si Safari le refuse |
| 16 | Écrire puis **forcer la fermeture** de l'app immédiatement | À la réouverture, le dernier trait est présent |
| 17 | Mode Avion → relancer → écrire → réactiver le réseau | Tout fonctionne ; aucune perte |
| 18 | Exporter une sauvegarde vers Fichiers | Le fichier `.calame` apparaît dans Fichiers |
| 19 | Clavier externe : P/H/E/S/T, ⌘Z, ⇧⌘Z, ← → | Raccourcis actifs |
| 20 | Split View / Slide Over, portrait et paysage | Mise en page lisible, écriture correcte |

### Écriture, formes, zoom, conversion (2ᵉ lot du 11/11/2026)

| # | Scénario | Attendu |
| --- | --- | --- |
| 21 | Écrire une phrase rapidement puis lentement, au bille puis au feutre fin | L'encre colle à la pointe, angles des lettres nets, aucun « saut » ni point détaché au lever |
| 22 | Écrire très légèrement le premier trait d'une lettre | Pas de goutte au départ |
| 23 | Les 6 stylos + surligneur, en changeant épaisseur, couleur, lissage | Rendus nettement différents ; réglages mémorisés par stylo |
| 24 | Gommer (partielle) 3 traits, puis toucher Annuler ; recommencer 10 fois en alternant gomme / sélection / changement de page | Chaque Annuler agit, sans bouton grisé à tort ; Rétablir rejoue tout |
| 25 | Glisser un geste système (bord de l'écran) pendant un trait, puis Annuler | Le trait est conservé ou annulé proprement ; rien ne reste bloqué |
| 26 | Tracer une ligne et garder le Pencil immobile ~½ s, déplacer l'extrémité, relever | Droite nette ; « Garder le tracé libre » rétablit le tracé ; Annuler aussi |
| 27 | Idem pour un cercle et un rectangle ; écrire normalement en marquant des pauses | Formes reconnues ; l'écriture ordinaire n'est jamais transformée (sinon augmenter le délai) |
| 28 | Fenêtre de zoom : écrire une ligne entière avec l'avance automatique, puis « Ligne » | Texte à la bonne taille dans le cadre, sans doublon ; le cadre avance puis revient à la marge |
| 29 | Dans la fenêtre : gomme, Annuler, pincer, glisser au doigt ; déplacer et redimensionner le cadre | Tout fonctionne ; aucun trait parasite lors du déplacement du cadre |
| 30 | Sélectionner une phrase → Convertir en texte → écrire au Pencil dans le champ (Scribble), corriger, Remplacer ; Annuler | Texte éditable à la place des traits ; Annuler restaure l'écriture |

Les points 1, 3, 5 et 7 conditionnent la suite du projet : s'ils ne sont pas satisfaisants, ils seront traités avant toute
nouvelle fonctionnalité.

## Après une mise à jour
Calame vérifie au démarrage et au retour au premier plan la version réellement servie (`version.json`, jamais mise en cache).
Si une nouvelle version existe, le bandeau « Une nouvelle version de Calame est prête » apparaît : touchez **Mettre à jour**
(vos écritures en attente sont enregistrées avant le rechargement). Si le bandeau n'apparaît pas, fermez complètement l'app
(balayage vers le haut) puis rouvrez-la.
