# Onde · lecteur de musique local

Application de musique type « streaming », mais **100 % sur ton téléphone** :
pas de pub, pas de compte, pas d'internet. Tu importes tes fichiers audio,
ils sont stockés dans l'application et jouables hors connexion.

## Fonctionnalités
- Import de fichiers ou d'un dossier entier (MP3, M4A/AAC, FLAC, OGG/Opus, WAV…)
- Lecture automatique des tags : titre, artiste, album, n° de piste, genre, **pochette**
- Accueil, Recherche, Bibliothèque (playlists, albums, artistes, titres)
- Titres likés, playlists (créer, renommer, ajouter/retirer), file d'attente
- Lecture aléatoire, répétition (tout / un titre), minuteur de sommeil
- **Fondu enchaîné** réglable entre les morceaux (Android / ordinateur)
- Lecteur plein écran animé : fond aux couleurs de la pochette, visualiseur audio,
  glisser la pochette pour changer de titre, glisser vers le bas pour fermer
- Contrôles sur l'écran de verrouillage et casque Bluetooth
- Reprise de l'écoute là où tu t'étais arrêté·e

## Installer sur le téléphone
L'app doit être servie en HTTPS une fois (par ex. GitHub Pages), puis elle s'installe
et fonctionne ensuite sans connexion.

1. Active GitHub Pages sur ce dépôt (Settings → Pages → branche `main`, dossier `/`).
2. Ouvre `https://<utilisateur>.github.io/<dépôt>/musique/` sur ton téléphone.
3. **Android (Chrome)** : menu ⋮ → « Installer l'application ».
   **iPhone (Safari)** : Partager → « Sur l'écran d'accueil ».
4. Ouvre Onde → « Importer ma musique ».

La musique importée reste uniquement sur ton téléphone (stockage local du navigateur),
elle n'est jamais envoyée nulle part.

## Tester sur ordinateur
```
cd musique && python3 -m http.server 8000
```
puis ouvrir http://localhost:8000 (on peut glisser-déposer des fichiers dans la fenêtre).
