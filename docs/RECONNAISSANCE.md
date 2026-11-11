# Conversion manuscrit → texte : services, données, coûts

Calame reste entièrement utilisable **sans aucun service** de reconnaissance. Rien n'est envoyé hors de l'appareil sans que
vous ayez choisi un service externe et saisi votre propre clé.

| Service | Où | Français | Données envoyées | Coût | Hors ligne | Disponibilité |
| --- | --- | --- | --- | --- | --- | --- |
| **Saisie manuelle** (défaut) | — | — | aucune | gratuit | oui | partout |
| **Scribble** d'iPadOS dans le champ du dialogue | sur l'iPad | oui (France, Belgique, Canada, Suisse ; depuis iPadOS 14.5) | aucune (traitement Apple sur l'appareil) | gratuit | oui | iPad + Apple Pencil |
| **Reconnaissance du navigateur** (API Handwriting Recognition) | sur l'appareil | selon l'appareil ; Calame vérifie que le français est proposé avant de l'activer | aucune | gratuit | oui | certains navigateurs Chromium (initialement Chrome OS) ; **pas Safari / iPad** |
| **Google Cloud Vision** (`DOCUMENT_TEXT_DETECTION`) | serveurs Google | oui (indication `fr` envoyée) | **une image PNG des traits sélectionnés** (noir sur blanc) et votre clé ; l'en-tête *Referer* ne contient que l'origine publique du site (`https://fahem-lahlouh.github.io/`) ; ni titre, ni autres pages, ni identifiant | 1 000 images/mois gratuites, puis environ 1,50 $ les 1 000 jusqu'à 5 millions, 0,60 $ au-delà (tarif Google, à vérifier avant usage) ; Google exige un compte de facturation actif | non | partout, avec votre clé |

## Google Cloud Vision : mise en place (facultatif)
1. Créer un projet Google Cloud, activer l'**API Cloud Vision** et un compte de facturation (exigé par Google, même dans
   la tranche gratuite).
2. Créer une **clé API restreinte** : *API restrictions* → Cloud Vision API uniquement ; *Application restrictions* → sites
   web → `https://fahem-lahlouh.github.io/*`. Facultatif : un plafond de quota quotidien (par exemple 30 requêtes par
   jour), pour ne jamais dépasser la tranche gratuite.
3. Dans Calame : sélection → Convertir en texte → **Changer** → Google Cloud Vision → coller la clé → « Enregistrer et
   reconnaître ».

La clé est conservée **uniquement dans ce navigateur** (`localStorage`, entrée `calame:ocr:v1`). Elle n'est ni exportée
dans les sauvegardes, ni dans le dépôt, ni envoyée ailleurs qu'à Google. Elle reste lisible par quiconque a accès à cet
appareil déverrouillé : restreignez-la comme indiqué ci-dessus. La politique de sécurité du contenu (CSP) de Calame
n'autorise que `https://vision.googleapis.com` comme destination externe.

## Limites
- La reconnaissance n'est jamais appliquée sans vérification : le texte est toujours affiché, modifiable, puis remplace
  les traits sur votre confirmation (action annulable).
- Qualité sur l'écriture cursive française : **non évaluée** (aucun essai réel n'a été fait). Google Vision est conçu pour
  le texte dans les images. Il reconnaît l'écriture manuscrite, mais les erreurs sont probables sur une écriture rapide :
  d'où la vérification obligatoire.
- Les formules, schémas et surlignages ne sont pas convertis (le surligneur est ignoré).
- Hors ligne, seule la saisie manuelle ou Scribble fonctionne ; le dialogue l'indique.

## Écarté
- **MyScript** : très bonne reconnaissance de l'écriture, mais compte développeur et clés HMAC exigés, et service payant
  au-delà d'un quota gratuit limité. Écarté pour rester gratuit et sans compte supplémentaire.
- **OCR de texte imprimé local** (Tesseract) : non fiable sur l'écriture manuscrite ; non proposé comme reconnaissance
  d'écriture.

Sources : tarifs Cloud Vision (pages officielles Google Cloud), documentation Chrome « Handwriting Recognition API »,
annonces Apple sur les langues de Scribble (iPadOS 14.5). Voir le rapport de session pour les liens.
