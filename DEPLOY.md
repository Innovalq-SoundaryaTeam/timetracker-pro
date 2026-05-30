# Deploying TimeTracker Pro to Fly.io

## Prerequisites
- A free Fly.io account → https://fly.io/app/sign-up
- Docker Desktop installed and **running** on your machine
- Node 24+ installed locally (already have it)

---

## Step 1 — Install flyctl (Fly CLI)

Open PowerShell and run:
```powershell
iwr https://fly.io/install.ps1 -useb | iex
```
Then restart your terminal.  Verify: `fly version`

---

## Step 2 — Log in to Fly.io
```bash
fly auth login
```
This opens a browser. Sign in / create account.

---

## Step 3 — Choose your app name

Open `fly.toml` and change this line to a unique name (lowercase, hyphens only):
```toml
app = "timetracker-pro"   # e.g. "timetracker-soundarya"
```

---

## Step 4 — Create the app on Fly.io
```bash
cd "C:\Users\Soundarya Ram\Downloads\timetracker-pro (2)"
fly apps create timetracker-soundarya   # use same name as in fly.toml
```

---

## Step 5 — Create the persistent volume (stores your SQLite DB)
```bash
fly volumes create timetracker_data --region sin --size 1 --app timetracker-soundarya
```
> Change `sin` (Singapore) to your preferred region, e.g. `bom` (Mumbai), `lhr` (London).

---

## Step 6 — Set the JWT secret
```bash
fly secrets set JWT_SECRET="replace-with-a-long-random-string-here" --app timetracker-soundarya
```
Pick any long random string, e.g. `openssl rand -hex 32` or just type 40+ random characters.

---

## Step 7 — Deploy!
```bash
fly deploy --app timetracker-soundarya
```
This will:
1. Build the Docker image (builds React frontend + bundles server)
2. Push image to Fly's registry
3. Start your machine with the volume mounted at `/data`

First deploy takes ~3–5 minutes.

---

## Step 8 — Open your app
```bash
fly open --app timetracker-soundarya
```
Your app will be live at: `https://timetracker-soundarya.fly.dev`

Default admin login:
- **Email:** admin@company.com
- **Password:** admin123

> Change the admin password immediately after first login!

---

## Useful commands

| Command | What it does |
|---------|-------------|
| `fly logs --app timetracker-soundarya` | Live server logs |
| `fly status --app timetracker-soundarya` | Machine health |
| `fly deploy --app timetracker-soundarya` | Redeploy after code changes |
| `fly ssh console --app timetracker-soundarya` | SSH into the machine |
| `fly volumes list --app timetracker-soundarya` | Check volume |

---

## Re-deploying after code changes

Every time you update the code, just run:
```bash
fly deploy --app timetracker-soundarya
```
Your database on the volume is **never touched** during redeploys — all data is safe.

---

## Regions close to India
| Code | Location |
|------|----------|
| `bom` | Mumbai, India |
| `sin` | Singapore |
| `blr` | Bangalore (if available) |

Run `fly platform regions` to see the full list.
