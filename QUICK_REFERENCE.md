# MovieStream - Quick Deployment Reference

## 🚀 First-Time Setup (One-time only)

### 1. GitHub Repository Setup
```bash
git init
git add .
git commit -m "Initial commit with Docker CI/CD"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. GitHub Secrets (Settings → Secrets → Actions)
```
SERVER_HOST     = your-vps-ip
SERVER_USER     = root
SERVER_SSH_KEY  = -----BEGIN OPENSSH PRIVATE KEY-----...
```

### 3. VPS Setup
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh

# Create directory
sudo mkdir -p /opt/moviestream && cd /opt/moviestream

# Create .env file
nano .env
```

```env
TMDB_API_KEY=your_real_api_key
IMAGE_NAME=ghcr.io/YOUR_USERNAME/YOUR_REPO:latest
```

```bash
# Upload docker-compose.yml to /opt/moviestream/

# Pull and start
docker compose pull && docker compose up -d
```

---

## 📝 Daily Workflow

```bash
# Make changes in VS Code
git add .
git commit -m "Your message"
git push

# GitHub Actions automatically:
# → Builds Docker image
# → Pushes to ghcr.io
# → Deploys to VPS
# → Verifies deployment
# ✅ Done in ~3-5 minutes!
```

---

## 🔍 Check Status

### GitHub Actions
```
https://github.com/YOUR_USERNAME/YOUR_REPO/actions
```

### VPS Container
```bash
ssh user@vps-ip
cd /opt/moviestream
docker compose ps
docker compose logs -f
```

### Application Health
```bash
curl http://localhost:5000/api/status
```

---

## 🛠️ Troubleshooting

### Deployment failed?
```bash
# Check GitHub Actions logs
GitHub → Actions → Click failed workflow

# Check VPS logs
ssh user@vps-ip
docker compose logs --tail=100

# Restart container
docker compose down && docker compose up -d
```

### Container won't start?
```bash
# Check logs
docker logs moviestream

# Check environment
cat .env

# Rebuild
docker compose pull && docker compose up -d
```

---

## 📦 Files Created

```
✅ Dockerfile                    - Multi-stage production build
✅ docker-compose.yml            - Container orchestration
✅ .dockerignore                 - Exclude files from image
✅ .gitignore                    - Protect secrets
✅ .env.example                  - Environment template
✅ .github/workflows/deploy.yml  - CI/CD pipeline
✅ DEPLOYMENT_GUIDE.md           - Full documentation
✅ QUICK_REFERENCE.md            - This file
```

---

## 🔐 Important Reminders

- ❌ Never commit `.env` files
- ❌ Never commit API keys
- ✅ Use GitHub Secrets for VPS credentials
- ✅ Store TMDB_API_KEY in VPS `.env`
- ✅ Keep private repository if using free GHCR

---

## 🎯 Architecture

```
VS Code
   ↓ git push
GitHub
   ↓ Triggers Actions
Docker Build
   ↓ Push image
GHCR (GitHub Container Registry)
   ↓ Pull image
VPS /opt/moviestream
   ↓ docker compose up
✅ Live Application on port 5000
```

---

## 📞 Quick Commands

```bash
# View logs
docker compose logs -f

# Restart
docker compose restart

# Stop
docker compose down

# Start
docker compose up -d

# Status
docker compose ps

# Update
git pull && docker compose pull && docker compose up -d

# Backup database
docker compose exec moviestream cat /app/data/moviestream.db > backup.db
```

---

**Need help? Check DEPLOYMENT_GUIDE.md for detailed instructions!**
