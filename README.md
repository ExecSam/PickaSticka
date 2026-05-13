# PickaSticka

PickaSticka is a tiny self-hosted sticker hub. Upload individual images, paste an image from your clipboard, or bulk import a zip. Click any sticker to copy it back to your clipboard. Stickers are sorted by how often they are copied.

## Features

- Single page sticker grid
- JPEG, PNG, GIF, and WEBP uploads
- Zip bulk import
- Clipboard paste import
- Clipboard copy on sticker click
- SQLite copy counts
- Defaults to port `6767`
- Works behind a Cloudflare Tunnel

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:6767`.

## Production Setup

These instructions assume the repo is cloned to `/opt/pickasticka`.

```bash
sudo useradd --system --home /opt/pickasticka --shell /usr/sbin/nologin pickasticka
sudo mkdir -p /opt/pickasticka
sudo chown -R pickasticka:pickasticka /opt/pickasticka
cd /opt/pickasticka
npm ci --omit=dev
sudo cp systemd/pickasticka.service /etc/systemd/system/pickasticka.service
sudo systemctl daemon-reload
sudo systemctl enable --now pickasticka
```

The app listens on `0.0.0.0:6767`.

## Redeploy

```bash
sudo scripts/redeploy.sh
```

The redeploy script runs:

- `git pull --ff-only`
- `npm ci --omit=dev`
- `systemctl restart pickasticka`

## Cloudflare Tunnel

Point your tunnel service at:

```text
http://localhost:6767
```

No special app configuration is required.

## Data

By default:

- Stickers: `data/stickers`
- SQLite database: `data/pickasticka.sqlite`

You can override these paths with:

- `PICKASTICKA_DATA_DIR`
- `PICKASTICKA_STICKER_DIR`
- `PICKASTICKA_DB_PATH`
