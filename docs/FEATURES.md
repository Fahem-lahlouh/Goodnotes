# Matrice des fonctionnalités

**État** : ✅ réalisé et testé automatiquement · 🟡 réalisé, validation sur iPad réel requise · 🔶 partiel · ⬜ non commencé ·
✖ hors périmètre (décision). **Contrainte : aucune base de données ni serveur, 100 % gratuit.**

L'inventaire détaillé des fonctions de Goodnotes (observées sur vos captures, documentées, propositions) et leurs tests est
dans [AUDIT.md](AUDIT.md). Le détail des corrections du 11/11/2026 est dans [CORRECTIONS.md](CORRECTIONS.md).

Dernière mise à jour : 11/11/2026 (2ᵉ lot : écriture, voir [ECRITURE.md](ECRITURE.md) ; 3ᵉ lot : menus et outils, voir [OUTILS.md](OUTILS.md)).

## Écriture

| Fonctionnalité | Équivalent Calame | Limites | État |
| --- | --- | --- | --- |
| Écriture Apple Pencil, pression | Pointer Events `pen`, pression par outil × sensibilité | Latence réelle à mesurer | 🟡 (✅ simulé) |
| Précision du trait | Filtre One Euro à la saisie (indépendant de la fréquence), encre jusqu'à la pointe, aucun saut au lever | Sensation à valider | 🟡 (✅ mesuré) |
| Inclinaison | `altitudeAngle` ou `tiltX/Y`, effet réglable | `altitudeAngle` : Safari ≥ 18.2 | 🟡 |
| Outils : bille, feutre fin, plume, pinceau, crayon, marqueur, surligneur | Rendus distincts, couleur / épaisseur / lissage mémorisés par outil | — | ✅ |
| Épaisseur, palette, couleurs personnalisées, lissage | Panneau de l'outil, aperçu exact | — | ✅ |
| Favoris d'outils | 8 favoris dans la barre | — | ✅ |
| Doigt : « stylet uniquement » / « doigt et stylet » | Bouton visible + réglage | — | ✅ (iPad 🟡) |
| Rejet de paume | Doigt ignoré pendant un tracé au stylet ; heuristique optionnelle | Pas d'équivalent natif | 🟡 |
| Gomme trait entier / partielle, taille réglable | Diamètre constant à l'écran, aperçu exact | — | ✅ |
| Annuler / rétablir | Par document, page affichée avant d'annuler, 500 étapes ; geste dont la fin est perdue récupéré ; libellé de l'action | Non conservé après fermeture | ✅ |
| Lasso, rectangle, carré ; règle explicite ; filtres | Géométrie réelle | Une page à la fois | ✅ |
| Déplacer, redimensionner, dupliquer, copier/coller, couleur, épaisseur | Poignées aux 4 coins | Pas de rotation | ✅ |
| Blocs de texte (police, taille, G/I/S, couleur, alignement) | Outil Texte | Mise en forme par bloc | ✅ |
| Images (insertion, déplacement, redimensionnement) | Réduites à 2048 px au plus | Pas de recadrage | ✅ |
| Zoom / déplacement deux doigts, netteté | Rendu vectoriel | — | ✅ (iPad 🟡) |
| Forme nette par maintien (droite, cercle, ellipse, rectangle) | Délai réglable, « garder le tracé libre », annulable | Ellipse alignée sur les axes | ✅ (iPad 🟡) |
| Fenêtre de zoom d'écriture | Cadre déplaçable et redimensionnable, avance automatique, retour à la ligne, grossissement ×1,25–×8 | — | ✅ (iPad 🟡) |
| Menus « Outils » et « Plus » (toujours accessibles, téléphone compris) | Panneau du bas sur téléphone | — | ✅ (iPad 🟡) |
| Outil Formes, pointeur laser | Reconnaissance au lever ; laser éphémère non enregistré | — | ✅ (iPad 🟡) |
| Règle | Déplacer (1 doigt), pivoter (2 doigts, ±15°), tracé collé au bord | Page principale seulement | ✅ (iPad 🟡) |
| Notes repositionnables | 6 couleurs, texte modifiable | — | ✅ |
| Aligner les objets | Aimantation et guides | Déplacement seulement (pas le redimensionnement) | ✅ |
| Minuteur | Chrono et compte à rebours | — | ✅ |
| Personnalisation de la barre d'outils | 12 éléments, position d'annuler | — | ✅ |
| Conversion manuscrit → texte | Vérification avant remplacement ; saisie / Scribble (local), navigateur (local), Google Vision (clé personnelle, optionnel) | Qualité non évaluée ; voir [RECONNAISSANCE.md](RECONNAISSANCE.md) | 🔶 |

## Pages et navigation

| Fonctionnalité | Équivalent | État |
| --- | --- | --- |
| Navigation horizontale par défaut, arrêt net, compteur, boutons | Balayage (1 ou 2 doigts selon le mode), ← →, trackpad | ✅ |
| Navigation verticale (préférence) | Défilement continu | ✅ |
| Miniatures | Rendu paresseux | ✅ |
| Favoris de pages, plan du carnet, accéder à une page | Menu Plus, onglets du panneau des pages | ✅ |
| Changer de modèle (une page ou toutes) | Menu Plus | ✅ |
| Supprimer certains éléments, effacer la page | Une action annulable | ✅ |
| Tirer pour ajouter une page, numéro de page, barre latérale gauche/droite, écran toujours allumé | Menu Plus → Modification des documents | ✅ (Wake Lock 🟡) |
| Ajouter, dupliquer, supprimer, réordonner | Panneau des pages | ✅ |
| Chargement des pages à la demande | Page courante ± 1 | ✅ |
| Plein écran / mode concentration / mode application | Trois modes distincts | ✅ (iPad 🟡) |

## Bibliothèque et documents

| Fonctionnalité | État |
| --- | --- |
| Carnets illimités ; formats A3–A7, Lettre, Tabloïd ; portrait / paysage | ✅ |
| Papier blanc, jaune, crème, sombre ; uni, ligné, quadrillé, pointillé | ✅ |
| Modèles : Cornell, 2 et 3 colonnes, tâches, semainier, mensuel, réunion, brainstorming, révision Java, fiches Q/R | ✅ |
| Couvertures (12 couleurs × 6 motifs) | ✅ |
| Dossiers (un niveau), favoris, récents, tri, recherche par titre, corbeille | ✅ |
| Note rapide, tableau blanc (grande page, non infinie) | ✅ / 🔶 |
| Import d'image en nouveau carnet | ✅ |
| Import et annotation PDF, export PDF / image | ⬜ |
| Document texte autonome | ⬜ |

## Données, confidentialité, plateforme

| Fonctionnalité | État |
| --- | --- |
| Enregistrement local automatique, indicateur « enregistré sur cet appareil » | ✅ |
| Âge de la dernière sauvegarde exportée, export en un toucher | ✅ |
| Sauvegarde `.calame` v2 (texte, images, dossiers) ; relecture des v1 ; restauration sans écrasement | ✅ |
| Copie de sécurité automatique avant mise à niveau du format | ✅ |
| Migrations versionnées (base et enregistrements) | ✅ |
| Protection multi-onglets | ✅ |
| Hors ligne après première visite ; mises à jour à la demande ; version servie vérifiable | ✅ |
| Verrouillage local par code (Web Crypto) | ⬜ |
| Authentification, synchronisation, partage, intégrations cloud | ✖ (aucun serveur ; copie entre appareils par `.calame`) |
