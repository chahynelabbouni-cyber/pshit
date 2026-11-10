# Agenda Chahyn

L'agenda personnel de Chahyn : calendrier, échéancier, notes et assistant IA, dans la DA noir & or de Maison Chahyn. S'installe sur le téléphone comme une vraie appli (PWA) et marche hors connexion.

## Les 5 onglets
- **Accueil** : ton tableau de bord, que tu composes toi-même (Moi → Mon accueil : choisir et ordonner les blocs).
  - Briefing du jour (lu à voix haute avec 🔊) et jauge de charge (journée légère, normale ou chargée).
  - Événement en cours ou prochain, avec l'heure de départ (🚶) et ce qu'il faut apporter (🎒).
  - Ajout rapide en texte ou à la voix, et **raccourcis appris de tes habitudes** (ex. « 🥊 Boxe 20h30 » en un geste).
  - Conseils personnels : examen sans révision, objectif en retard, journée du lendemain chargée, affaires à prendre, doublons Google…
  - Ma journée avec les créneaux libres (toucher pour ajouter), échéances, objectifs, Focus, comptes à rebours, matières, notes épinglées, demain, graphique de la semaine.
- **Calendrier** : vues Mois (point rouge = examen, fond gris = vacances, barre = charge du jour), **Semaine lisible** (une ligne par jour), Grille, 3 jours, Jour (avec bilan du jour) et Liste. Glisser pour changer de période, filtres par catégorie, recherche globale 🔍.
- **Assistant** : « résume ma journée », « quand est ma prochaine boxe ? », « combien d'heures de cours cette semaine ? », « déplace la boxe à 21h », « décale le TD anglais de 30 min », « annule… », « ajoute… », « rappelle-moi… », « planifie mes révisions ». Chaque action peut être annulée. Avec ta clé Claude, il comprend tout, connaît tes matières et tes objectifs.
- **Mémo** : l'échéancier (examens, remises, tâches, classés par urgence avec un compteur J-x) et les notes (dossiers, liées à une matière, **cases à cocher**, couleurs, épingles, rappels).
- **Moi** : Focus (minuteur 25, 50 ou 90 min par matière), **objectifs et habitudes** (boxe et heures de révision comptées automatiquement depuis l'agenda, habitudes à cocher avec séries de jours), **matières détectées automatiquement** (profs, salles, prochain cours, contrôles, heures, notes de cours, couleur), comptes à rebours, statistiques semaine et mois.

## Fiche d'un événement
Étoile « important » (compte à rebours sur l'accueil), temps de trajet et heure de départ (avec notification « pars dans 5 min »), changement de catégorie en un geste, liste « à apporter », notes perso, répétition chaque semaine ou chaque jour, couleur au choix, rappel, durée rapide.

## Personnalisation
- 6 ambiances (Noir & or, Nuit bleue, Rose nuit, Menthe, Clair & or, Lavande), couleur d'accent, avatar.
- Taille du texte (A− à A++), contraste renforcé, heures de début et de fin de journée, vue par défaut.
- Catégories : renommer, recolorer, changer l'emoji, masquer, **créer les tiennes avec des mots-clés**.
- Règles du type « si le titre contient… → mettre dans… », réappliquées à tout l'agenda.

## Google Agenda
Une fois connecté, l'appli lit **et** écrit directement dans ton Google Agenda : ce que tu ajoutes ici (ou ce que l'assistant programme) apparaît sur Google, et inversement à chaque synchro (bouton ⟳ en haut).
Il faut créer une fois un « ID client OAuth » gratuit sur Google Cloud. Le guide pas à pas est dans **Réglages → Google Agenda**.

Sans connexion Google, tu peux aussi importer un fichier `.ics` (export de Google Agenda) ou `.json` (Réglages → Importer).

## Installer sur le téléphone
1. Mettre le dépôt en ligne en HTTPS (GitHub Pages : Settings → Pages → branche `main`, dossier `/`).
2. Ouvrir `https://<utilisateur>.github.io/<dépôt>/agenda/` sur le téléphone.
3. Android (Chrome) : ⋮ → « Installer l'application ». iPhone (Safari) : Partager → « Sur l'écran d'accueil ».

Tes données restent sur ton téléphone (et dans ton Google Agenda si tu le connectes).
