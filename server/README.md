# mnthnnnn's Extension — Key Server

## Architecture
```
Render  →  Node.js API + PostgreSQL (backend)
Netlify →  Admin Panel HTML (frontend)
Extension → calls your Render URL to validate keys
```

---

## Step 1 — Deploy Server to Render

### Option A — Automatic (recommended)
1. Push this whole project to a **GitHub repo**
2. Go to [render.com](https://render.com) → **New → Blueprint**
3. Connect your GitHub repo
4. Render reads `render.yaml` and auto-creates:
   - Your Node.js web service
   - A free PostgreSQL database (linked automatically)
5. In the Render dashboard → your service → **Environment**:
   - Set `ADMIN_PASSWORD` = your secure password
6. Click **Deploy**
7. Copy your Render URL — looks like `https://mnthnnnn-keys.onrender.com`

### Option B — Manual
1. Go to [render.com](https://render.com) → **New → Web Service**
   - Connect your GitHub repo
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
2. Create a **New PostgreSQL** database on Render
   - Copy the **Internal Database URL**
3. In your web service → **Environment**, add:
   - `DATABASE_URL` = (paste the internal DB URL)
   - `ADMIN_PASSWORD` = your secure password
4. Deploy

---

## Step 2 — Deploy Admin Panel to Netlify

1. Go to [netlify.com](https://netlify.com) → **Add new site → Import from Git**
2. Connect the same GitHub repo
3. Set:
   - **Publish directory**: `server/public`
   - **Build command**: *(leave empty)*
4. Deploy
5. Your admin panel is live at `https://your-site.netlify.app/admin.html`

**First time opening the admin panel on Netlify:**
It will ask for your **Render server URL** (e.g. `https://mnthnnnn-keys.onrender.com`) — enter it once and it's saved in your browser.

---

## Step 3 — Update the Chrome Extension

In `scripts/sw-bridge.js`, line 8:
```js
const VPS_URL = 'https://mnthnnnn-keys.onrender.com'; // your Render URL
```

In `manifest.json`, replace `http://YOUR_VPS_IP:3000/*` with:
```json
"https://mnthnnnn-keys.onrender.com/*"
```

Also update the CSP line to use the same HTTPS URL.

---

## Key Format
```
MNTHNNNN-XXXX-XXXX-XXXX
```

## License Plans
| Plan   | Duration    |
|--------|-------------|
| trial  | 30 minutes  |
| 1d     | 1 day       |
| 3d     | 3 days      |
| 7d     | 7 days      |
| 15d    | 15 days     |
| 1m     | 1 month     |
| 3m     | 3 months    |
| 6m     | 6 months    |
| 1y     | 1 year      |

## Keep Render Awake (Free Plan)
Render free tier sleeps after 15 min. Use [UptimeRobot](https://uptimerobot.com) (free):
- Monitor URL: `https://mnthnnnn-keys.onrender.com/health`
- Interval: every 5 minutes
- This prevents the server from sleeping.

## Notes
- PostgreSQL database is persistent — data survives restarts ✅
- Render free PostgreSQL expires after 90 days — upgrade plan or export/reimport data
- The admin panel is a static file — Netlify serves it for free with no limits ✅
