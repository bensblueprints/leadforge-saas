# LeadForge Deployment Guide

This guide covers deploying LeadForge to both Hetzner server and Synology NAS using Docker.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Deployment](#quick-deployment)
3. [Hetzner Server Deployment](#hetzner-server-deployment)
4. [Synology NAS Deployment](#synology-nas-deployment)
5. [Manual Deployment](#manual-deployment)
6. [Post-Deployment](#post-deployment)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

- Docker & Docker Compose (on target server)
- Git
- SSH access to target server

### Hetzner Server Requirements

- Ubuntu/Debian server
- Root or sudo access
- Docker and Docker Compose installed
- Ports 3000 and 5432 available

### Synology NAS Requirements

- Synology DSM 7.0+
- Container Manager (formerly Docker) installed from Package Center
- SSH access enabled (Control Panel → Terminal & SNMP)
- Tailscale installed (recommended for remote access)

---

## Quick Deployment

### 1. Clone Repository (on your local machine)

```bash
git clone https://github.com/bensblueprints/leadforge.git
cd leadforge
```

### 2. Choose Your Target

**For Hetzner:**
```bash
# Make script executable
chmod +x deploy-hetzner.sh

# Set your server details
export HETZNER_HOST="your-server-ip"
export HETZNER_USER="root"

# Deploy
./deploy-hetzner.sh
```

**For Synology NAS:**
```bash
# Make script executable
chmod +x deploy-synology.sh

# Deploy (uses Tailscale IP by default)
./deploy-synology.sh
```

---

## Hetzner Server Deployment

### Step 1: Prepare Server

SSH into your Hetzner server:

```bash
ssh root@your-server-ip
```

Install Docker and Docker Compose:

```bash
# Update packages
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install docker-compose -y

# Verify installation
docker --version
docker-compose --version
```

### Step 2: Setup Deployment Directory

```bash
mkdir -p /opt/leadforge
cd /opt/leadforge
```

### Step 3: Clone Repository

```bash
git clone https://github.com/bensblueprints/leadforge.git .
```

### Step 4: Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit with your credentials
nano .env
```

**Required .env variables:**

```env
DATABASE_URL=postgresql://leadforge:YourStrongPassword@postgres:5432/leadforge
JWT_SECRET=your-random-32-character-secret-key
GOOGLE_MAPS_API_KEY=your-google-maps-api-key

POSTGRES_USER=leadforge
POSTGRES_PASSWORD=YourStrongPassword
POSTGRES_DB=leadforge
```

### Step 5: Deploy

```bash
# Build and start containers
docker-compose up -d

# View logs
docker-compose logs -f

# Initialize database
curl http://localhost:3000/api/setup-db
```

### Step 6: Verify Deployment

```bash
# Check running containers
docker-compose ps

# Test API
curl http://localhost:3000/api/setup-db

# View application logs
docker-compose logs -f app
```

---

## Synology NAS Deployment

### Step 1: Install Prerequisites

1. **Install Container Manager**
   - Open Package Center
   - Search for "Container Manager"
   - Install it

2. **Enable SSH**
   - Go to Control Panel → Terminal & SNMP
   - Enable SSH service
   - Note: Default SSH port is 22

3. **Install Tailscale (Recommended)**
   - Download Tailscale package for Synology
   - Install via Package Center → Manual Install
   - Configure Tailscale network

### Step 2: Connect via SSH

**Using Tailscale (Recommended):**
```bash
ssh Ben@100.122.165.61
```

**Using Local Network (Ann House WiFi only):**
```bash
ssh Ben@192.168.1.84
```

Password: `JEsus777$$!`

### Step 3: Setup Deployment Directory

```bash
# Create directory structure
sudo mkdir -p /volume1/docker/leadforge/app
sudo mkdir -p /volume1/docker/leadforge/postgres

# Navigate to app directory
cd /volume1/docker/leadforge/app
```

### Step 4: Clone Repository

```bash
sudo git clone https://github.com/bensblueprints/leadforge.git .
```

### Step 5: Configure Environment

```bash
# Copy example file
sudo cp .env.example .env

# Edit configuration
sudo nano .env
```

**Important for Synology:** Update `DATABASE_URL` to use the Synology IP or hostname:

```env
# Use localhost since containers are on same Docker network
DATABASE_URL=postgresql://leadforge:YourStrongPassword@postgres:5432/leadforge

# Or use Synology Tailscale IP for external access
DATABASE_URL=postgresql://leadforge:YourStrongPassword@100.122.165.61:5432/leadforge

JWT_SECRET=your-random-32-character-secret-key
GOOGLE_MAPS_API_KEY=your-google-maps-api-key

POSTGRES_USER=leadforge
POSTGRES_PASSWORD=YourStrongPassword
POSTGRES_DB=leadforge
```

### Step 6: Deploy with Docker Compose

```bash
# Build and start containers
sudo docker-compose up -d

# View logs
sudo docker-compose logs -f

# Initialize database
curl http://localhost:3000/api/setup-db
```

### Step 7: Access LeadForge

**Local Access (on Synology):**
```
http://localhost:3000
```

**Tailscale Access (from anywhere):**
```
http://100.122.165.61:3000
```

**LAN Access (Ann House WiFi only):**
```
http://192.168.1.84:3000
```

---

## Manual Deployment

If you prefer manual control:

### 1. Build Docker Image

```bash
docker build -t leadforge:latest .
```

### 2. Run PostgreSQL

```bash
docker run -d \
  --name leadforge-db \
  -e POSTGRES_USER=leadforge \
  -e POSTGRES_PASSWORD=YourStrongPassword \
  -e POSTGRES_DB=leadforge \
  -p 5432:5432 \
  -v leadforge_postgres:/var/lib/postgresql/data \
  postgres:16-alpine
```

### 3. Run LeadForge App

```bash
docker run -d \
  --name leadforge-app \
  --link leadforge-db:postgres \
  -e DATABASE_URL="postgresql://leadforge:YourStrongPassword@postgres:5432/leadforge" \
  -e JWT_SECRET="your-secret-key" \
  -e GOOGLE_MAPS_API_KEY="your-api-key" \
  -p 3000:3000 \
  leadforge:latest
```

### 4. Initialize Database

```bash
curl http://localhost:3000/api/setup-db
```

---

## Post-Deployment

### 1. Create Admin User

First user to register becomes admin (or manually set in database):

```sql
UPDATE lf_users SET is_admin = true WHERE email = 'ben@justfeatured.com';
```

### 2. Setup Reverse Proxy (Optional)

**For Nginx:**

```nginx
server {
    listen 80;
    server_name leadforge.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3. SSL/TLS with Let's Encrypt

```bash
# Install Certbot
apt install certbot python3-certbot-nginx -y

# Get certificate
certbot --nginx -d leadforge.yourdomain.com
```

### 4. Backup Strategy

**Database Backup:**

```bash
# Create backup
docker exec leadforge-db pg_dump -U leadforge leadforge > backup_$(date +%Y%m%d).sql

# Restore backup
docker exec -i leadforge-db psql -U leadforge leadforge < backup_20240101.sql
```

**Automated Backups (cron):**

```bash
# Add to crontab
0 2 * * * docker exec leadforge-db pg_dump -U leadforge leadforge > /backups/leadforge_$(date +\%Y\%m\%d).sql
```

---

## Useful Commands

### Docker Compose Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Restart services
docker-compose restart

# View logs
docker-compose logs -f

# View logs for specific service
docker-compose logs -f app

# Rebuild and restart
docker-compose up -d --build

# Remove everything (including volumes)
docker-compose down -v
```

### Docker Commands

```bash
# List running containers
docker ps

# View container logs
docker logs leadforge-app -f

# Execute command in container
docker exec -it leadforge-app sh

# Access PostgreSQL
docker exec -it leadforge-db psql -U leadforge

# View container resource usage
docker stats
```

### Database Commands

```bash
# Connect to database
docker exec -it leadforge-db psql -U leadforge leadforge

# List tables
\dt

# View table schema
\d lf_users

# Exit
\q
```

---

## Troubleshooting

### Container Won't Start

**Check logs:**
```bash
docker-compose logs app
docker-compose logs postgres
```

**Common issues:**
- Port 3000 or 5432 already in use
- Invalid DATABASE_URL
- Missing environment variables

### Database Connection Errors

**Verify PostgreSQL is running:**
```bash
docker-compose ps
docker exec leadforge-db pg_isready -U leadforge
```

**Test connection manually:**
```bash
docker exec -it leadforge-db psql -U leadforge -d leadforge -c "SELECT NOW();"
```

### Application Errors

**View detailed logs:**
```bash
docker-compose logs -f app
```

**Restart application:**
```bash
docker-compose restart app
```

**Rebuild application:**
```bash
docker-compose up -d --build app
```

### Synology-Specific Issues

**Docker not found:**
```bash
# Add Docker to PATH
export PATH=$PATH:/usr/local/bin:/volume1/@appstore/ContainerManager/bin
```

**Permission denied:**
```bash
# Use sudo for Docker commands
sudo docker-compose up -d
```

**Container Manager GUI:**
- Open Container Manager app
- Navigate to Container tab
- View logs and stats for leadforge-app and leadforge-db

### Network Issues

**Test internal connectivity:**
```bash
docker exec leadforge-app ping postgres
docker exec leadforge-app nc -zv postgres 5432
```

**Check port mappings:**
```bash
docker port leadforge-app
docker port leadforge-db
```

---

## Monitoring

### Health Checks

The application includes built-in health checks:

**Application health:**
```bash
curl http://localhost:3000/api/setup-db
```

**Docker health status:**
```bash
docker inspect leadforge-app | grep -A 10 Health
```

### Performance Monitoring

```bash
# Container resource usage
docker stats

# Database connections
docker exec leadforge-db psql -U leadforge -d leadforge -c "SELECT count(*) FROM pg_stat_activity;"
```

---

## Updating LeadForge

### Pull Latest Changes

```bash
cd /opt/leadforge  # or /volume1/docker/leadforge/app on Synology
git pull origin main
docker-compose up -d --build
```

### With Zero Downtime

```bash
# Pull changes
git pull origin main

# Build new image
docker-compose build app

# Recreate only app container
docker-compose up -d --no-deps app
```

---

## Support

For issues or questions:
- Email: ben@justfeatured.com
- Check logs: `docker-compose logs -f`
- GitHub Issues: https://github.com/bensblueprints/leadforge/issues

---

**Last Updated:** February 2026
