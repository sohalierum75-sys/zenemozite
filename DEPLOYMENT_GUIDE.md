# MovieStream - Docker CI/CD Deployment Guide

## 📋 Overview

This guide covers the complete setup for automatic deployment from VS Code → GitHub → Docker → VPS.

---

## A. Files Created/Modified

### New Files:
```
✅ Dockerfile                      - Multi-stage production build
✅ docker-compose.yml              - Production container orchestration
✅ .dockerignore                   - Exclude unnecessary files from image
✅ .gitignore                      - Protect secrets and build artifacts
✅ .env.example                    - Environment variable template
✅ backend/.env.example            - Backend environment template
✅ .github/workflows/deploy.yml    - CI/CD automation pipeline
✅ DEPLOYMENT_GUIDE.md             - This file
```

---

## B. Docker Architecture

```
┌─────────────────────────────────────────────────────────┐
│           Multi-Stage Docker Build                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Stage 1: Frontend Builder (node:18-alpine)             │
│  ├─ Install dependencies                                │
│  ├─ Build React + Vite → dist/                          │
│  └─ Output: /app/dist                                   │
│                                                          │
│  Stage 2: Backend Builder (node:18-alpine)              │
│  ├─ Install backend dependencies                        │
│  ├─ Run prisma generate                                 │
│  └─ Output: node_modules + prisma client                │
│                                                          │
│  Stage 3: Production Runtime (node:18-alpine)           │
│  ├─ Copy backend code + dependencies                    │
│  ├─ Copy frontend build (dist/)                         │
│  ├─ Create /app/data for SQLite                         │
│  ├─ Run as non-root user (nodejs:1001)                  │
│  ├─ Expose port 5000                                    │
│  └─ CMD: node backend/server.js                         │
│                                                          │
└─────────────────────────────────────────────────────────┘

Production Container:
├── /app/backend/
│   ├── server.js
│   ├── node_modules/
│   └── prisma/
├── /app/frontend/dist/ (optional, if backend serves it)
└── /app/data/
    └── moviestream.db (persisted via Docker volume)
```

---

## C. GitHub Secrets Required

Go to your GitHub repository → Settings → Secrets and variables → Actions → New repository secret

Add these secrets:

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `SERVER_HOST` | Your VPS IP address or domain | `192.168.1.100` or `moviestream.com` |
| `SERVER_USER` | SSH username on VPS | `root` or `ubuntu` |
| `SERVER_SSH_KEY` | Private SSH key for authentication | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `SERVER_PORT` | SSH port (optional, defaults to 22) | `22` |

**Note:** TMDB_API_KEY should be stored in `.env` on the VPS, NOT as a GitHub secret.

---

## D. VPS Initial Setup

### 1. Install Docker & Docker Compose

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group (optional, avoid sudo)
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose
sudo apt install docker-compose-plugin -y

# Verify installations
docker --version
docker compose version
```

### 2. Create Deployment Directory

```bash
# Create directory
sudo mkdir -p /opt/moviestream
sudo chown $USER:$USER /opt/moviestream
cd /opt/moviestream
```

### 3. Create Production Environment File

```bash
nano .env
```

Add:
```env
# TMDB API Key (REQUIRED)
TMDB_API_KEY=your_real_tmdb_api_key_here

# Docker Image
IMAGE_NAME=ghcr.io/YOUR_GITHUB_USERNAME/moviestream:latest

# Cache Configuration
CACHE_DURATION_HOURS=24
```

**Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username!**

Save and exit (Ctrl+X, Y, Enter)

### 4. Upload docker-compose.yml

```bash
# Option A: Create manually
nano docker-compose.yml
# Copy contents from your local docker-compose.yml

# Option B: Upload via SCP from local machine
scp docker-compose.yml user@your-vps-ip:/opt/moviestream/
```

### 5. Login to GitHub Container Registry (if private repo)

```bash
# Create GitHub Personal Access Token with read:packages permission
# Go to: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)

# Login
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

### 6. Pull and Start Container

```bash
cd /opt/moviestream

# Pull image
docker compose pull

# Start container
docker compose up -d

# Check status
docker compose ps
docker compose logs -f
```

### 7. Verify Deployment

```bash
# Check container is running
docker ps | grep moviestream

# Test API endpoint
curl http://localhost:5000/api/status

# Check logs
docker compose logs --tail=50
```

---

## E. Git Initial Setup

### 1. Initialize Git Repository

```bash
# In VS Code terminal (in project root D:\W\)
git init
```

### 2. Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `moviestream` (or your preferred name)
3. **Keep it private** (contains deployment configs)
4. Do NOT initialize with README (you already have one)
5. Click "Create repository"

### 3. Connect Local to GitHub

```bash
# Add all files
git add .

# Initial commit
git commit -m "Initial commit with Docker CI/CD setup"

# Rename branch to main
git branch -M main

# Add remote (replace YOUR_USERNAME and REPO_NAME)
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git

# Push to GitHub
git push -u origin main
```

**Replace YOUR_USERNAME and REPO_NAME with your actual values!**

Example:
```bash
git remote add origin https://github.com/johndoe/moviestream.git
```

---

## F. Normal Workflow After Setup

### Daily Development Workflow:

```bash
# 1. Make your code changes in VS Code

# 2. Stage changes
git add .

# 3. Commit with message
git commit -m "Add new feature: search improvements"

# 4. Push to GitHub
git push
```

### What Happens Automatically:

```
1. Code pushed to GitHub main branch
   ↓
2. GitHub Actions triggered automatically
   ↓
3. Workflow runs:
   - Checkout code
   - Build Docker image
   - Push to ghcr.io
   ↓
4. SSH to VPS automatically
   ↓
5. Pull new image
   ↓
6. Restart container (docker compose down → up)
   ↓
7. Health check verifies deployment
   ↓
8. ✅ Website updated with new code!
```

**Time: ~3-5 minutes from push to live**

---

## G. Monitoring & Verification

### Check GitHub Actions Status

1. Go to your GitHub repository
2. Click "Actions" tab
3. See the latest workflow run
4. Click on it to see detailed logs

### Check VPS Container Status

```bash
# SSH into VPS
ssh user@your-vps-ip

# Go to deployment directory
cd /opt/moviestream

# Check running containers
docker compose ps

# View logs (real-time)
docker compose logs -f

# View last 100 lines
docker compose logs --tail=100

# Check container health
docker inspect moviestream | grep -A 10 Health
```

### Check Application Health

```bash
# From VPS
curl http://localhost:5000/api/status

# From browser (replace with your VPS IP)
http://YOUR_VPS_IP:5000/api/status
```

### Check Current Image Version

```bash
# On VPS
docker images | grep moviestream

# Check image digest
docker inspect ghcr.io/YOUR_USERNAME/moviestream:latest | grep Id
```

---

## H. Troubleshooting

### Deployment Failed

#### 1. Check GitHub Actions Logs
```bash
GitHub → Your Repo → Actions → Failed workflow → Click on it
```

Look for:
- Build errors
- Docker push errors  
- SSH connection errors
- Deployment verification failures

#### 2. Check VPS Logs
```bash
ssh user@your-vps-ip
cd /opt/moviestream
docker compose logs --tail=100
```

#### 3. Container Won't Start

```bash
# Check if container exists
docker ps -a | grep moviestream

# Check why it stopped
docker logs moviestream

# Try starting manually
docker compose up
# (without -d to see output)

# Check for port conflicts
sudo netstat -tulpn | grep 5000
```

#### 4. Database Issues

```bash
# Check if database volume exists
docker volume ls | grep moviestream

# Check database file permissions
docker compose exec moviestream ls -la /app/data/

# Reset database (WARNING: deletes data)
docker compose down
docker volume rm moviestream_moviestream-data
docker compose up -d
```

#### 5. Environment Variables Missing

```bash
# Check if .env exists on VPS
cd /opt/moviestream
cat .env

# Verify TMDB_API_KEY is set
grep TMDB_API_KEY .env

# Restart container after fixing .env
docker compose down
docker compose up -d
```

#### 6. Image Pull Fails

```bash
# Login to GHCR again
echo YOUR_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# Pull manually
docker pull ghcr.io/YOUR_USERNAME/moviestream:latest

# Check image exists on GitHub
# Go to: GitHub → Your Repo → Packages
```

#### 7. SSH Connection Fails

Check GitHub Secrets:
- `SERVER_HOST` is correct IP/domain
- `SERVER_USER` exists on VPS
- `SERVER_SSH_KEY` is the PRIVATE key (not public)
- SSH key has no passphrase
- VPS allows SSH key authentication

Test SSH manually:
```bash
ssh -i path/to/private_key user@vps-ip
```

#### 8. Port Already in Use

```bash
# Check what's using port 5000
sudo lsof -i :5000

# Kill the process or change port in .env
# Then restart
docker compose down
docker compose up -d
```

---

## I. Rollback to Previous Version

If new deployment breaks the application:

```bash
# SSH to VPS
cd /opt/moviestream

# Stop current container
docker compose down

# List available images
docker images | grep moviestream

# Tag previous image as latest (if you kept it)
docker tag ghcr.io/USERNAME/moviestream:main-abc123 ghcr.io/USERNAME/moviestream:latest

# Or pull a specific commit SHA
docker pull ghcr.io/USERNAME/moviestream:main-abc123
docker tag ghcr.io/USERNAME/moviestream:main-abc123 ghcr.io/USERNAME/moviestream:latest

# Start with previous version
docker compose up -d

# Verify
curl http://localhost:5000/api/status
```

---

## J. Update Docker Compose or Environment Variables

```bash
# SSH to VPS
cd /opt/moviestream

# Edit .env
nano .env

# Or edit docker-compose.yml
nano docker-compose.yml

# Apply changes
docker compose down
docker compose up -d

# Verify
docker compose ps
docker compose logs -f
```

---

## K. Cleanup Old Images

```bash
# On VPS - remove dangling images
docker image prune -f

# Remove images older than 72 hours
docker image prune -af --filter "until=72h"

# List all images
docker images

# Remove specific old image
docker rmi ghcr.io/USERNAME/moviestream:old-tag
```

---

## L. Production Best Practices

### Security
- ✅ Never commit `.env` files
- ✅ Never commit SSH keys
- ✅ Use GitHub Secrets for sensitive data
- ✅ Container runs as non-root user
- ✅ Use strong SSH keys (4096-bit RSA or ed25519)

### Monitoring
- ✅ Check logs regularly: `docker compose logs`
- ✅ Monitor disk space: `df -h`
- ✅ Monitor container health: `docker ps`
- ✅ Set up alerts for failed deployments

### Backups
```bash
# Backup SQLite database
docker compose exec moviestream cat /app/data/moviestream.db > backup-$(date +%Y%m%d).db

# Or backup the volume
docker run --rm -v moviestream_moviestream-data:/data -v $(pwd):/backup alpine tar czf /backup/moviestream-data-$(date +%Y%m%d).tar.gz -C /data .
```

### Updates
```bash
# Update Docker
sudo apt update && sudo apt upgrade docker-ce docker-ce-cli containerd.io

# Update Docker Compose
sudo apt update && sudo apt upgrade docker-compose-plugin
```

---

## M. FAQ

**Q: How do I change the port from 5000?**
```bash
# Edit docker-compose.yml on VPS
ports:
  - "8080:5000"  # External:Internal

# Restart
docker compose down && docker compose up -d
```

**Q: Can I use a custom domain?**
```bash
# Set up reverse proxy (Nginx/Caddy) on VPS
# Point domain to VPS
# Configure proxy to forward to localhost:5000
```

**Q: How do I enable HTTPS?**
```bash
# Use Caddy (easiest) or Nginx + Certbot
# Caddy automatically handles SSL certificates
```

**Q: Database is too large, how to reset?**
```bash
docker compose down
docker volume rm moviestream_moviestream-data
docker compose up -d
# Database will be recreated from scratch
```

---

## N. Support

If you encounter issues:

1. Check logs: `docker compose logs -f`
2. Check GitHub Actions logs
3. Verify all secrets are correct
4. Ensure `.env` file exists on VPS with TMDB_API_KEY
5. Test SSH connection manually
6. Check firewall rules on VPS

---

**🎉 Your MovieStream project is now production-ready with automatic CI/CD deployment!**

Push to GitHub → Automatic Docker build → Auto-deploy to VPS → Live in minutes!
