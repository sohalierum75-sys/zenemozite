# VPS Setup for Zenemozite Deployment

## ✅ Changes Made

### 1. Updated Paths
```diff
- /opt/moviestream
+ /opt/zenemozite
```

### 2. Updated Service Names
```diff
- container_name: moviestream
+ container_name: zenemozite

- moviestream-data volume
+ zenemozite-data volume

- moviestream-network
+ zenemozite-network
```

### 3. Updated Docker Commands
```diff
- docker compose down
+ docker-compose down

- docker compose up -d
+ docker-compose up -d

- docker compose ps
+ docker-compose ps

- docker compose logs
+ docker-compose logs
```

---

## 🚀 VPS Initial Setup

### Step 1: Install Docker & Docker Compose

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose (v1 - standalone binary)
sudo curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify installations
docker --version
docker-compose --version
```

**Expected Output:**
```
Docker version 20.10.x+
docker-compose version 1.29.2
```

### Step 2: Create Deployment Directory

```bash
# Create directory
sudo mkdir -p /opt/zenemozite
sudo chown $USER:$USER /opt/zenemozite
cd /opt/zenemozite
```

### Step 3: Create Environment File

```bash
nano .env
```

**Add:**
```env
# TMDB API Key (REQUIRED)
TMDB_API_KEY=your_real_tmdb_api_key_here

# Docker Image
IMAGE_NAME=ghcr.io/sohalierum75-sys/zenemozite:latest

# Cache Configuration
CACHE_DURATION_HOURS=24
```

Save and exit: `Ctrl+X`, `Y`, `Enter`

### Step 4: Upload docker-compose.yml

**Option A: Create manually**
```bash
nano docker-compose.yml
```
Copy the contents from your local `docker-compose.yml`

**Option B: Download from GitHub** (after first push)
```bash
curl -O https://raw.githubusercontent.com/sohalierum75-sys/zenemozite/main/docker-compose.yml
```

### Step 5: Login to GitHub Container Registry

```bash
# Create GitHub Personal Access Token
# Go to: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
# Permissions: read:packages

# Login
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u sohalierum75-sys --password-stdin
```

### Step 6: Pull and Start

```bash
cd /opt/zenemozite

# Pull image
docker-compose pull

# Start container
docker-compose up -d

# Check status
docker-compose ps
docker-compose logs -f
```

### Step 7: Verify Deployment

```bash
# Check container is running
docker ps | grep zenemozite

# Test API endpoint
curl http://localhost:5000/api/status

# Check logs
docker-compose logs --tail=50
```

---

## 📋 Exact Changes Summary

### docker-compose.yml
```yaml
services:
  zenemozite:                          # Changed from: moviestream
    image: ghcr.io/.../zenemozite:latest  # Changed from: moviestream:latest
    container_name: zenemozite          # Changed from: moviestream
    environment:
      - DATABASE_URL=file:/app/data/zenemozite.db  # Changed from: moviestream.db
    volumes:
      - zenemozite-data:/app/data       # Changed from: moviestream-data
    networks:
      - zenemozite-network              # Changed from: moviestream-network
    labels:
      - "com.zenemozite.description=..." # Changed from: com.moviestream

volumes:
  zenemozite-data:                     # Changed from: moviestream-data

networks:
  zenemozite-network:                  # Changed from: moviestream-network
```

### .github/workflows/deploy.yml
```yaml
script: |
  cd /opt/zenemozite              # Changed from: /opt/moviestream
  
  docker-compose down             # Changed from: docker compose down
  docker-compose up -d            # Changed from: docker compose up -d
  docker-compose ps               # Changed from: docker compose ps
  docker-compose logs             # Changed from: docker compose logs
  
  if docker-compose ps | grep -q "zenemozite.*Up"; then  # Changed from: moviestream
```

---

## 🔍 Common Commands

```bash
# View logs
docker-compose logs -f

# Restart container
docker-compose restart

# Stop container
docker-compose down

# Start container
docker-compose up -d

# Check status
docker-compose ps

# Manual update
cd /opt/zenemozite
docker-compose pull
docker-compose up -d

# Backup database
docker-compose exec zenemozite cat /app/data/zenemozite.db > backup-$(date +%Y%m%d).db
```

---

## ✅ Deployment Flow

```
GitHub Actions (on push to main)
  ↓
Build Docker image
  ↓
Push to ghcr.io/sohalierum75-sys/zenemozite:latest
  ↓
SSH to VPS (password auth)
  ↓
cd /opt/zenemozite
  ↓
docker pull ghcr.io/sohalierum75-sys/zenemozite:latest
  ↓
docker-compose down
  ↓
docker-compose up -d
  ↓
Health check (http://localhost:5000/api/status)
  ↓
✅ Deployment complete!
```

---

## 🐛 Troubleshooting

### "docker: unknown command: docker compose"
**Solution:** Use `docker-compose` (with hyphen), not `docker compose`

### "cd: /opt/zenemozite: No such file or directory"
**Solution:** Create directory on VPS:
```bash
sudo mkdir -p /opt/zenemozite
sudo chown $USER:$USER /opt/zenemozite
```

### "container not found: zenemozite"
**Solution:** Check container name:
```bash
docker ps -a | grep zene
```

### "permission denied"
**Solution:** Add user to docker group:
```bash
sudo usermod -aG docker $USER
newgrp docker
```

---

## 📦 Files Structure on VPS

```
/opt/zenemozite/
├── docker-compose.yml
├── .env
└── (Docker volumes managed automatically)
```

---

**✅ VPS is now ready for automatic deployments!**

Every push to GitHub main branch will automatically:
1. Build new Docker image
2. Push to GHCR
3. Deploy to VPS at `/opt/zenemozite`
4. Restart container with `docker-compose`
