# Prat

Jeu de bateaux pirates qui capturent des "Prat" (comme pirate sans le i et le e). Les Prat sont des créatures formées de lettres, plus fortes quand elles sont grosses ou en italique.

## Stack

- Next.js 16 + React 19 + TypeScript (`apps/frontend`)
- Phaser.js (jeu 2D)
- Supabase (auth + DB)
- Tailwind CSS
- NestJS (`apps/backend`, API séparée en dev)

## Unités de simulation et affichage

Le jeu sépare **l’espace de simulation** (unités abstraites, type League of Legends) et **l’affichage** (pixels Phaser / navigateur). Toute la logique gameplay (serveur, collisions, vitesses) utilise des **unités de simulation** ; on ne convertit en pixels qu’au rendu (et l’inverse pour les entrées réseau).

### Principes

| Principe | Implémentation |
|----------|----------------|
| Pas de pixels d’écran dans la physique serveur | `apps/frontend/src/lib/gameEngine.ts` n’importe pas `displayConstants` |
| Constantes spatiales partagées | `simulationSpace.ts`, `gameBalance.ts` sous `apps/frontend/src/lib/` (distances commentées « simulation units ») |
| Canvas / zoom uniquement pour l’affichage | `VIEW_WIDTH` / `VIEW_HEIGHT` dans `displayConstants.ts` + `GameScene.updateCameraZoom()` (même dossier `apps/frontend/src/…`) |
| Une couche de conversion rendu | `simulationToDisplay.ts` : `simulationToPhaserPixels`, `phaserPixelsToSimulation` |
| Frontière client | `GameScene` : état SSE → `simulationToPhaserPixels` ; `MOVE` / `SHOOT` / `PRAT_CAPTURE` → `phaserPixelsToSimulation` |
| Ratio par défaut | `SIMULATION_UNITS_TO_PHASER_PIXELS = 1` (équivalent historique 1 unité monde = 1 px Phaser) |

### Fichiers

- **`apps/frontend/src/lib/simulationSpace.ts`** — Monde, vitesses, rayons, portées joueur, paramètres client (vitesse bateau, seuil d’arrivée, rayon de clic ciblage).
- **`apps/frontend/src/lib/gameBalance.ts`** — Progression, capture prat, octopus, etc. (distances en unités de simulation).
- **`apps/frontend/src/lib/displayConstants.ts`** — Résolution logique du canvas + zoom ; **pas** la simulation.
- **`apps/frontend/src/game/simulationToDisplay.ts`** — Point unique pour changer l’échelle globale affichage ↔ simulation sans toucher au serveur.
- **`apps/frontend/src/game/scenes/GameScene.ts`** — Conversions aux frontières réseau ↔ Phaser.

### Choix

1. **Nom « simulation units »** — Les nombres restent sur l’ancienne échelle (1 ≈ 1 « pixel monde » legacy) pour la balance ; pas de mélange avec des pixels CSS.
2. **Portée max des lettres joueur** — `PLAYER_PROJECTILE_MAX_TRAVEL_SIMULATION_UNITS` (~1102) remplace l’ancien `√(VIEW²)/2` dans le moteur : la logique ne dépend plus de la résolution.
3. **Zoom** — Indépendant du ratio `simulationToDisplay` : zoom = adapter la caméra à la fenêtre ; ratio = échelle monde → coordonnées Phaser.
4. **`WorldSpace.ts`** — Héritage non utilisé ailleurs ; la conversion officielle est `simulationToDisplay.ts`.

### Ajuster

- **Gameplay** : `apps/frontend/src/lib/simulationSpace.ts` et `apps/frontend/src/lib/gameBalance.ts`.
- **Rendu global** (tout plus grand/petit sans changer le serveur) : `SIMULATION_UNITS_TO_PHASER_PIXELS` dans `apps/frontend/src/game/simulationToDisplay.ts` (vérifier bounds Phaser et clamp).

### Limites

- Phaser / `physics.world.setBounds` restent en coordonnées **après** conversion (normal).
- Tailles de police des sprites texte en pixels CSS (hors modèle « monde simulation »).

## Développement

Monorepo **pnpm** : le frontend Next.js est dans `apps/frontend`, l’API NestJS de démo dans `apps/backend`.

```bash
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` lance Next (port 3000) et Nest (port 3001) en parallèle. Front uniquement : `pnpm dev:frontend`. API uniquement : `pnpm dev:backend`.

```bash
pnpm run build
```

Variables d’environnement Next : fichier **`apps/frontend/.env.local`** (voir ci-dessous).

## Déploiement

### Render (SSL inclus)

1. Créer un compte sur [Render](https://render.com)
2. New > Web Service, connecter le repo
3. Build: `corepack enable && pnpm install && pnpm run build`
4. Start: `pnpm run start`
5. SSL automatique sur `*.onrender.com`

### Domaine gratuit + Cloudflare

- **Sous-domaine gratuit**: `prat.onrender.com` (fourni par Render)
- **Domaine personnalisé**: Acheter un domaine (ex: Namecheap ~10€/an) ou utiliser [Freenom](https://www.freenom.com) (gratuit mais limité)
- **Cloudflare**: Ajouter le site dans Cloudflare, pointer les DNS vers Render. SSL gratuit via Cloudflare.

### Variables d'environnement

Créer `apps/frontend/.env.local` (requis pour le multijoueur) :

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=xxx
```

Sans Supabase, le jeu fonctionne en solo. Avec ces variables, le multijoueur temps réel est activé (plusieurs joueurs sur la même partie).

### Ko-fi

Variable d'environnement `NEXT_PUBLIC_KOFI_USERNAME` ou modifier `apps/frontend/src/components/KofiButton.tsx`.

### Musique de fond

Ajouter un fichier `apps/frontend/public/sounds/music.mp3` (libre de droits). La musique démarre au premier clic ou touche (politique autoplay des navigateurs).

### Multijoueur (Supabase)

1. Créer un projet sur [Supabase](https://supabase.com)
2. Récupérer URL et clé anon dans Settings > API
3. Ajouter `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` dans Render
