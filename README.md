# Prat

Jeu de bateaux pirates qui capturent des "Prat" (comme pirate sans le i et le e). Les Prat sont des créatures formées de lettres, plus fortes quand elles sont grosses ou en italique.

## Stack

- Next.js 16 + React 19 + TypeScript
- Phaser.js (jeu 2D)
- Supabase (auth + DB)
- Tailwind CSS

## Développement

```bash
npm install
npm run dev
```

## Déploiement

### Render (SSL inclus)

1. Créer un compte sur [Render](https://render.com)
2. New > Web Service, connecter le repo
3. Build: `npm install && npm run build`
4. Start: `npm start`
5. SSL automatique sur `*.onrender.com`

### Domaine gratuit + Cloudflare

- **Sous-domaine gratuit**: `prat.onrender.com` (fourni par Render)
- **Domaine personnalisé**: Acheter un domaine (ex: Namecheap ~10€/an) ou utiliser [Freenom](https://www.freenom.com) (gratuit mais limité)
- **Cloudflare**: Ajouter le site dans Cloudflare, pointer les DNS vers Render. SSL gratuit via Cloudflare.

### Variables d'environnement

Créer `.env.local` (requis pour le multijoueur) :

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=xxx
```

Sans Supabase, le jeu fonctionne en solo. Avec ces variables, le multijoueur temps réel est activé (plusieurs joueurs sur la même partie).

### Ko-fi

Variable d'environnement `NEXT_PUBLIC_KOFI_USERNAME` ou modifier `KofiButton.tsx`.

### Multijoueur (Supabase)

1. Créer un projet sur [Supabase](https://supabase.com)
2. Récupérer URL et clé anon dans Settings > API
3. Ajouter `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` dans Render
