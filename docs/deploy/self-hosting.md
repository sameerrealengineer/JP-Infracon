# JP Infracon server — free, open-source self-hosting

Sab kuch open source hai aur ek free cloud machine par chalta hai:

| Hissa | Kya hai | Kharcha |
|---|---|---|
| Server machine | Oracle Cloud **Always Free** Ubuntu VM (Ampere A1, 2 CPU / 12 GB RAM tak) | Free (card sirf verification ke liye) |
| Database | MySQL 8.4 (open source), Docker me | Free |
| Photos / PDF | Server ki disk par private folder | Free |
| HTTPS | Caddy (open source) + Let's Encrypt | Free |
| Domain | DuckDNS free subdomain, jaise `jpinfracon.duckdns.org` | Free |
| WhatsApp (optional) | WAHA (open source) | Free |

Phone se bhi ho sakta hai: Oracle ka **Cloud Shell** browser me terminal deta hai.

> Free plans badalte rehte hain. 2026 me Oracle ne Always Free A1 ko 4 CPU / 24 GB se ghata kar 2 CPU / 12 GB kiya hai — yeh app ke liye kaafi hai. Sign-up se pehle Oracle ka "Always Free resources" page dekh lein.

## 1. Free server banayein (Oracle Cloud)

1. <https://www.oracle.com/cloud/free/> par account banayein (Home region: **India South (Hyderabad)** ya **India West (Mumbai)**).
2. **Compute → Instances → Create instance**
   - Image: **Ubuntu 24.04**
   - Shape: **Ampere → VM.Standard.A1.Flex**, 2 OCPU, 12 GB
   - "Add SSH keys": "Generate a key pair" chunein aur private key download kar lein.
3. Instance ka **Public IP** note karein.
4. **Networking → VCN → Security List → Add Ingress Rules**: Source `0.0.0.0/0`, TCP, ports **80** aur **443**.

## 2. Free domain (DuckDNS)

1. <https://www.duckdns.org> par Google/GitHub se login.
2. Ek naam chunein, jaise `jpinfracon` → IP me server ka Public IP daalein → **update ip**.
3. Aapka address banega: `jpinfracon.duckdns.org`

## 3. Server par Docker lagayein

Oracle Cloud Shell (ya SSH) se server me login karke:

```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
# Ubuntu images on Oracle block ports by default:
sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo apt -y install iptables-persistent && sudo netfilter-persistent save
```

## 4. Code laayein aur settings bharein

Repository private hai, isliye GitHub **Personal access token** (read-only) chahiye:

```bash
git clone https://<TOKEN>@github.com/sameerrealengineer/jp-infracon.git
cd jp-infracon/deploy
cp .env.selfhost.example .env
nano .env
```

`.env` me bharein:

- `DOMAIN` = aapka DuckDNS naam, jaise `jpinfracon.duckdns.org`
- `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `JWT_SECRET`, `JP_SUPERADMIN_BOOTSTRAP_SECRET` — har ek ke liye `openssl rand -hex 24` chala kar alag lambi value daalein
- Optional: `GEMINI_API_KEY` (aistudio.google.com), `SARVAM_API_KEY` (dashboard.sarvam.ai)

`.env` file kabhi GitHub par na daalein.

## 5. Chalayein

```bash
docker compose --env-file .env up -d --build
docker compose logs -f api     # "migrations up to date" aur "server listening" dikhna chahiye
```

Pehli baar build me 5–10 minute lagte hain. Database ki saari tables (migrations 0000–0013) khud ban jaati hain.

Check: browser me `https://jpinfracon.duckdns.org/api/health` kholein → `{"ok":true,...}` aana chahiye.

## 6. App jodein

1. APK kholein → login screen par **Server · Change** → `https://jpinfracon.duckdns.org` → **Check & save**.
2. "Create the Super Admin" screen aayegi → naam, username, password, aur `.env` wala `JP_SUPERADMIN_BOOTSTRAP_SECRET` daalein.
3. Super Admin se company, project aur site banayein → **More → Invite codes** se team ko code bhejein.

## 7. Backup (zaroori)

Har raat database backup:

```bash
mkdir -p ~/backups
( crontab -l 2>/dev/null; echo '30 2 * * * cd ~/jp-infracon/deploy && docker compose exec -T mysql sh -c "mysqldump -uroot -p\$MYSQL_ROOT_PASSWORD jp_infracon" | gzip > ~/backups/jp-$(date +\%F).sql.gz && find ~/backups -mtime +14 -delete' ) | crontab -
```

Photos Docker volume `deploy_files` me hain; kabhi-kabhi `~/backups` ke saath kisi doosri jagah (Google Drive etc.) copy karein.

## 8. Update karna

```bash
cd ~/jp-infracon && git pull && cd deploy && docker compose --env-file .env up -d --build
```

Nayi migrations start par apne aap lagti hain — update se pehle backup le lein.

## Optional: WhatsApp alerts (WAHA)

```bash
docker compose --env-file .env --profile whatsapp up -d
```

`.env` me `WHATSAPP_PROVIDER=waha`, `WAHA_URL=http://waha:3000`, `WAHA_API_KEY=...` rakhein. WAHA dashboard me ek alag business number se QR scan karke session start karein. Dhyan dein: WAHA WhatsApp ka official tool nahi hai — number block hone ka risk hai.

## Bina VM ke (zyada aasaan, par dheema)

Agar VM sambhalna nahi hai: API ko **Render** free web service par, database **TiDB Cloud** (MySQL-compatible free plan) par, aur photos **Cloudflare R2** (10 GB free, `S3_*` settings) par rakh sakte hain. Kami: Render ka free server 15 minute khaali rehne par so jaata hai, aur pehli request me 30–60 second lagte hain.

## Jaanch (developer ke liye)

Ek **khaali** naye server par poora flow check karne ke liye:

```bash
SMOKE_BASE_URL=https://jpinfracon.duckdns.org SMOKE_SETUP_KEY=<setup key> npx tsx scripts/selfhost-smoke.mts
```

Yeh test Super Admin aur test records banata hai — asli data wale server par kabhi na chalayein.
