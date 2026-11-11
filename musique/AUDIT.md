# Audit complet de Maison — rapport du manager

Sept experts ont passé l'application au crible, chacun dans son domaine :
performance, lecture audio, interface et accessibilité, assistant et voix,
robustesse et sécurité, produit, qualité du code.
Ils ont remonté environ 180 points. Le manager les a classés en trois catégories :
**fait**, **impossible** ou **contourné**.
Le tout a été appliqué dans cet ordre, chapitre par chapitre.

## Chapitre 1 — Sécurité et données
- **Fait.** Faille d'injection de code via les images de radios (annuaire public) :
  les adresses sont maintenant vérifiées et échappées partout, y compris les anciennes déjà enregistrées.
- **Fait.** Stockage du téléphone plein : l'app libère de la place et prévient
  (avant, une clé « enregistrée » pouvait être perdue).
- **Fait.** Titres supprimés qui revenaient après un redémarrage : corrigé.
- **Fait.** Double appui sur l'assistant qui lançait deux fois la même chose : verrou ajouté.
- **Fait.** Réseau : délai maximum pour chaque requête et erreurs YouTube en français
  (quota épuisé, clé invalide, API non activée). Un quota épuisé est retenu jusqu'au lendemain.
- **Fait.** Sauvegarde et restauration de toutes les données dans un fichier (sans les clés).
- **Fait.** Partage d'une playlist avec quelqu'un sous forme de fichier `.maison.json` :
  les titres YouTube et les radios passent, les fichiers du téléphone sont retrouvés par nom.
- **Fait.** Les mises à jour de l'app attendent la pause pour ne jamais couper la musique.
- **Contourné.** Le SDK Claude est chargé depuis un CDN :
  il est gardé, avec un délai court et une seule nouvelle tentative.

## Chapitre 2 — Lecture
- **Fait.** Un son illisible (vidéo non intégrable, épisode introuvable)
  passe automatiquement au suivant, au maximum 5 fois d'affilée.
- **Fait.** Deux vidéos YouTube pouvaient jouer en même temps : chaque lecteur n'est créé qu'une fois.
- **Fait.** Radio : reconnexion automatique si le flux coupe.
  Après une pause, elle reprend en direct, sans consommer de données pendant la pause.
- **Fait.** Minuteur de sommeil fiable, même écran éteint et avec les radios.
- **Fait.** Écran verrouillé : durée et position justes, pas d'avance rapide sur une radio,
  sauts de 15 / 30 s sur les podcasts, image par défaut.
- **Fait.** Lecture automatique de sons du même style quand la file est finie (réglable).
- **Fait.** La file YouTube et podcasts est retrouvée après un redémarrage.
- **Fait.** Égaliseur avec marge (il ne sature plus) ; mode aléatoire jamais appliqué aux podcasts.
- **Impossible.** Lecture YouTube en arrière-plan :
  c'est réservé à YouTube Premium et interdit par les règles de YouTube.
  La relance forcée a été retirée pour ne pas risquer le blocage de la clé.
  Les radios, podcasts et fichiers continuent en arrière-plan.
- **Contourné.** Le son suivant est préparé « en attente » (chargé, pas lu en sourdine)
  pour rester dans les règles de YouTube tout en changeant vite de son.

## Chapitre 3 — Assistant et voix
Sur 90 nouvelles phrases de test, l'assistant en comprenait 39 avant, et 86 après.
Les 179 phrases de test d'avant sont toujours comprises.

- **Fait.** Réglages à la voix : couleur, fond, vinyle, police, taille du texte,
  « appelle-toi Jarvis », « appelle-moi… », nom de l'app, vitesse de la voix,
  ton, égaliseur, fondu, lecture automatique, « ouvre les réglages ».
- **Fait.** Plusieurs demandes dans une phrase : « mets du rap et monte le son »,
  « lance Jul en aléatoire », « mets Ninho puis Jul ».
- **Fait.** Dictée : « mais du rap », « r f m » épelé, « une demi-heure », « volume à cinquante ».
- **Fait.** Suites de conversation : « son dernier album », « change de radio », « encore » ; humeur triste.
- **Fait.** « mets Changes », « mets I like it » ne sont plus confondus avec des commandes.
- **Fait.** Agent Claude :
  - compréhension locale d'abord (« pause » est instantané) ;
  - délai de 20 s et cache du catalogue ;
  - recherche web pour l'actualité musicale ;
  - nouvel outil pour régler l'app.
- **Fait.** Voix :
  - garde-fou de 15 s ;
  - les mots entendus ne sont plus perdus ;
  - erreurs de micro expliquées ;
  - la radio baisse au lieu de se couper.
- **Impossible.** Un vrai réveil qui sonne quand l'app est fermée : le navigateur ne le permet pas.
  L'assistant le dit et propose le minuteur.
- **Impossible sans clé Claude.** Questions de culture musicale :
  sans clé, l'app répond via YouTube puis propose « vas-y ».

## Chapitre 4 — Interface, accessibilité, fluidité
- **Fait.** Grille des playlists qui débordait de l'écran.
- **Fait.** « Texte grand » appliqué partout (lecteur, onglets, feuilles).
- **Fait.** Boutons d'au moins 44 px, contrastes corrigés, utilisable au clavier et au lecteur d'écran.
- **Fait.** Erreurs en français avec « Réessayer » ; bouton « Annuler » après un retrait.
- **Fait.** Recherches récentes ; récap de la semaine cohérent.
- **Fait.** Longues listes affichées petit à petit ; animations plus légères ;
  visualiseur coupé par défaut (batterie).
- **Fait.** Icônes corrigées (engrenage, horloge, haut-parleur) ;
  barre du téléphone à la couleur du fond.

## Chapitre 5 — Code et mise en ligne
- **Fait.** Sommaire en 27 chapitres en tête de `js/app.js` ; règles CSS inutilisées supprimées.
- **Fait.** Version 20 : les fichiers déjà en cache s'affichent tout de suite ;
  la page ne bloque plus sur un réseau lent.

## Reste à faire plus tard
Gros chantiers, à prévoir pour une prochaine version :
- réorganiser les titres d'une playlist en les glissant ;
- import de playlist YouTube sans clé ;
- récap annuel ;
- mode voiture ;
- suivi des nouveaux épisodes de podcasts ;
- découpage de `app.js` en modules.
