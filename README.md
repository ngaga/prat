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

Créer `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
```

### Ko-fi

Remplacer `YOUR_KOFI_USERNAME` dans `src/components/KofiButton.tsx` par ton identifiant Ko-fi.
