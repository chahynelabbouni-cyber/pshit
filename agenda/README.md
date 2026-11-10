# Agenda Chahyn

L'agenda personnel de Chahyn : calendrier, échéancier, notes et assistant IA, dans la DA noir & or de Maison Chahyn. S'installe sur le téléphone comme une vraie appli (PWA) et marche hors connexion.

## Les modules
- **Aujourd'hui** : ce qui se passe maintenant (avec barre de progression) ou le prochain rendez-vous avec compte à rebours, ta journée avec les créneaux libres, échéances, tâches, notes épinglées, aperçu de demain et graphique des heures de la semaine par catégorie.
- **Conseils automatiques** : examen proche sans révision → « Planifier mes révisions » en un geste (séances placées dans tes créneaux libres) ; journée du lendemain chargée ; tâches en retard ; doublons repérés dans Google Agenda.
- **Calendrier** : vues Mois, Semaine, 3 jours, Jour et Liste. Glisse à gauche ou à droite pour changer de période. Couleur par catégorie (Cours, Examens, Échéances, Révisions, Santé, Sport, Pro, Perso, Fériés), détectée automatiquement d'après le titre, et filtrable.
- **Échéancier** : examens, remises de devoirs et tâches, classés par urgence (en retard, aujourd'hui, cette semaine, ce mois-ci…) avec un compteur J-x.
- **Notes** : notes rapides en couleur, épinglables sur l'accueil, avec un rappel à la date de ton choix, et transformables en tâche.
- **Assistant** : écris ou dicte (micro) « ajoute boxe jeudi 20h30 », « rappelle-moi de payer le loyer le 5 », « qu'est-ce que j'ai demain ? », « planifie mes révisions »… Il range tout seul dans le calendrier, l'échéancier ou les notes. Chaque action peut être annulée.
  - Sans clé : il comprend les phrases simples, sans internet.
  - Avec ta clé Claude (Réglages) : il comprend n'importe quelle demande (déplacer, annuler, réorganiser ta semaine, repérer les conflits…).

## Google Agenda
Une fois connecté, l'appli lit **et** écrit directement dans ton Google Agenda : ce que tu ajoutes ici (ou ce que l'assistant programme) apparaît sur Google, et inversement à chaque synchro (bouton ⟳ en haut).
Il faut créer une fois un « ID client OAuth » gratuit sur Google Cloud. Le guide pas à pas est dans **Réglages → Google Agenda**.

Sans connexion Google, tu peux aussi importer un fichier `.ics` (export de Google Agenda) ou `.json` (Réglages → Importer).

## Installer sur le téléphone
1. Mettre le dépôt en ligne en HTTPS (GitHub Pages : Settings → Pages → branche `main`, dossier `/`).
2. Ouvrir `https://<utilisateur>.github.io/<dépôt>/agenda/` sur le téléphone.
3. Android (Chrome) : ⋮ → « Installer l'application ». iPhone (Safari) : Partager → « Sur l'écran d'accueil ».

Tes données restent sur ton téléphone (et dans ton Google Agenda si tu le connectes).
