# Matrice des fonctionnalités

**Légende de l'état** — ✅ réalisé et testé automatiquement · 🟡 réalisé, validation sur iPad réel requise ·
🔶 partiel · ⬜ non commencé · ✖ hors périmètre (décision).

**Contrainte : aucune base de données ni serveur, 100 % gratuit** — toutes les données restent sur l'appareil. Un bouton présent n'implique pas une fonctionnalité réalisée.

**Sources Goodnotes.** Les pages officielles n'ont pas pu être ouvertes directement depuis l'environnement de
développement (réseau restreint) ; la colonne « Référence » s'appuie sur des extraits de pages officielles
obtenus via un moteur de recherche : [Tarifs](https://www.goodnotes.com/pricing) (« 3 notebooks » en gratuit),
[llms.txt](https://goodnotes.com/llms.txt), [comparatif officiel Goodnotes vs Freenotes](https://www.goodnotes.com/blog/goodnotes-vs-freenotes),
[fiche App Store](https://apps.apple.com/ua/app/goodnotes-6/id1444383602). À revérifier lors d'une prochaine session.

Dernière mise à jour : 11/11/2026 (fin d'étape 1).

## Écriture (priorité absolue)

| Fonctionnalité de référence | Source | Équivalent Calame | Faisabilité web | Limites | Prio | État |
| --- | --- | --- | --- | --- | --- | --- |
| Écriture Apple Pencil | App Store | Pointer Events `pen`, rendu perfect-freehand | Bonne | Latence à mesurer sur iPad | P0 | 🟡 |
| Pression | App Store | `PointerEvent.pressure` → épaisseur | Bonne | — | P0 | 🟡 (✅ simulée en CI) |
| Inclinaison | — | `altitudeAngle` ou `tiltX/Y`, réglage d'effet | Bonne | `altitudeAngle` Safari ≥ 18.2 | P1 | 🟡 |
| Stylet / doigt distincts, « doigts pour naviguer » | Tarifs | Mode auto/naviguer/écrire | Bonne | — | P0 | ✅ |
| Rejet de paume | — | Doigts ignorés pendant le tracé au stylet + heuristique de contact large | Partielle | Pas d'équivalent natif | P0 | 🟡 |
| Droitier / gaucher | — | Réglage + barre latérale côté opposé | Bonne | — | P2 | 🔶 |
| Lissage réglable | — | `streamline` 0–0,75 | Bonne | Fort lissage = léger retard | P0 | ✅ |
| Couleurs, épaisseurs, favoris | Tarifs | 7 couleurs + personnalisée, 4 épaisseurs | Bonne | Pas encore de favoris personnalisables | P0 | 🔶 |
| Stylo, surligneur, gomme | Tarifs | Les trois ; surligneur sous l'encre | Bonne | — | P0 | ✅ |
| Gomme par trait / partielle | — | Les deux | Bonne | — | P0 | ✅ |
| Annuler / rétablir | — | Pile de 200 étapes, gestes 2/3 doigts | Bonne | Historique non conservé après fermeture | P0 | ✅ |
| Lasso | Tarifs (offre gratuite) | Sélection ≥ 50 % des points | Bonne | Une page à la fois | P0 | ✅ |
| Déplacer / redimensionner / dupliquer | — | Oui (+ recolorer, supprimer) | Bonne | Pas de rotation | P0 | ✅ |
| Zoom / défilement deux doigts | — | Pincement, molette, trackpad | Bonne | — | P0 | ✅ (iPad réel 🟡) |
| Netteté au zoom | — | Rendu vectoriel à chaque vue | Bonne | — | P0 | ✅ |
| Écriture après zoom / rotation | — | Repère page indépendant de l'écran | Bonne | — | P0 | ✅ (rotation 🟡) |
| Fenêtre de zoom d'écriture | — | — | Moyenne | — | P2 | ⬜ |
| Reconnaissance de formes | Tarifs (offre gratuite) | — | Bonne (local) | — | P2 | ⬜ |

## Bibliothèque et carnets

| Fonctionnalité | Source | Équivalent | Faisabilité | Limites | Prio | État |
| --- | --- | --- | --- | --- | --- | --- |
| Carnets illimités | Tarifs (gratuit limité à 3) | Aucune limite artificielle | Bonne | Quota du navigateur affiché | P0 | ✅ |
| Titre, couverture, papier | — | 6 couvertures, 4 papiers, 3 couleurs | Bonne | — | P0 | ✅ |
| Dossiers | — | — | Bonne | — | P1 | ⬜ |
| Pages : ajouter, dupliquer, supprimer, réordonner | — | Panneau Pages | Bonne | Réordonner par flèches (pas de glisser) | P0 | ✅ |
| Miniatures | — | Rendu différé | Bonne | — | P1 | ✅ |
| Favoris | — | Oui | Bonne | — | P1 | ✅ |
| Signets / étiquettes | — | — | Bonne | — | P2 | ⬜ |
| Récents | — | 4 derniers ouverts | Bonne | — | P1 | ✅ |
| Recherche titres | — | Oui | Bonne | — | P1 | ✅ |
| Recherche dans le texte | — | — | Dépend de la reconnaissance | — | P2 | ⬜ |
| Corbeille + restauration | — | Oui (+ suppression définitive) | Bonne | Pas de vidage automatique | P1 | ✅ |
| Onglets internes | — | — | Bonne | — | P2 | ⬜ |

## Contenu et documents

| Fonctionnalité | Source | Équivalent | Faisabilité | Limites | Prio | État |
| --- | --- | --- | --- | --- | --- | --- |
| Texte, images, formes | Tarifs | — | Bonne | — | P1 | ⬜ |
| Import PDF multipage + annotation | llms.txt / Tarifs (limite d'import en gratuit) | pdf.js prévu, rendu progressif | Bonne | Mémoire iPad | P1 | ⬜ |
| Export PDF annoté, export image | — | — | Bonne | — | P1 | ⬜ |
| Format natif réimportable | — | `.calame` (JSON documenté) | Bonne | Pas encore de pièces jointes | P0 | ✅ |

## Fonctions avancées

| Fonctionnalité | Source | Équivalent envisagé | Local / externe | Prio | État |
| --- | --- | --- | --- | --- | --- |
| Reconnaissance manuscrite, conversion, recherche | Comparatif officiel | À évaluer : aucune API web locale fiable sur Safari ; service externe = opt-in explicite | À décider | P2 | ⬜ |
| Audio associé aux traits | llms.txt | MediaRecorder + horodatage des traits (déjà enregistré par point) | Local | P2 | ⬜ (données prêtes) |
| Fiches / répétition espacée | Comparatif officiel | Fiches Q/R + algorithme local | Local | P2 | ⬜ |
| Liens entre notes, vue partagée | — | — | Local | P2 | ⬜ |
| IA | Tarifs (option payante) | Optionnelle, désactivée par défaut | Externe opt-in | P3 | ⬜ |

## Adaptations personnelles

| Fonctionnalité | État |
| --- | --- |
| Modèle réunion (décisions / actions / questions), modèles Java | ⬜ |
| Blocs de code avec coloration + annotation au stylet | ⬜ |
| Fiches question/réponse | ⬜ |
| Palette de commandes | ⬜ (raccourcis clavier ✅) |
| Capture rapide d'idée | ⬜ |
| Mode concentration | ✅ |

## Plateforme, sauvegarde, confidentialité

| Fonctionnalité | Équivalent | État |
| --- | --- | --- |
| Installation écran d'accueil, mode standalone | Manifeste + icônes + méta Apple | 🟡 |
| Hors ligne après première visite | Service worker précache | ✅ (Chromium) / 🟡 Safari |
| Sauvegarde locale automatique incrémentale | Transaction par action | ✅ |
| Indicateurs distincts « enregistré sur l'appareil » / « sauvegardé hors navigateur » | Pastille + âge de la dernière sauvegarde (un toucher = export) | ✅ |
| Erreurs et quota de stockage | Message, nouvel essai, jauge de quota | ✅ |
| Migrations versionnées | Base + enregistrements | ✅ |
| Export / restauration complets | `.calame`, sans écrasement | ✅ |
| Protection multi-onglets | Web Locks + BroadcastChannel | ✅ |
| Mises à jour sans interrompre l'écriture | Activation manuelle après vidage | ✅ (logique) / 🟡 iPad |
| Verrouillage local par code (Web Crypto) | AES-GCM + PBKDF2 | ⬜ (étape 2) |
| Authentification, copie distante, synchronisation, conflits | — | ✖ Hors périmètre (choix : aucune base, 100 % gratuit) |
| Copie entre appareils | Export/restauration `.calame` via iCloud Drive | ✅ |
| Thèmes clair / sombre, barre repositionnable | Oui | ✅ |
