#!/bin/bash

# ============================================
# LeadForge - Synology NAS Deployment Script
# ============================================

set -e  # Exit on error

echo "🚀 Starting LeadForge deployment to Synology NAS..."

# Configuration - Use Tailscale IP for remote access
SYNOLOGY_HOST="${SYNOLOGY_HOST:-100.122.165.61}"
SYNOLOGY_USER="${SYNOLOGY_USER:-Ben}"
DEPLOY_PATH="/volume1/docker/leadforge/app"
REPO_URL="https://github.com/bensblueprints/leadforge.git"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}📡 Connecting to Synology NAS via Tailscale (${SYNOLOGY_HOST})...${NC}"
echo -e "${YELLOW}⚠️  Note: Make sure you're connected to Tailscale network${NC}"

# Deploy via SSH
ssh -o StrictHostKeyChecking=no ${SYNOLOGY_USER}@${SYNOLOGY_HOST} << 'ENDSSH'

set -e

# Create deployment directories
DEPLOY_PATH="/volume1/docker/leadforge/app"
POSTGRES_PATH="/volume1/docker/leadforge/postgres"

echo "📦 Setting up deployment directories..."
sudo mkdir -p $DEPLOY_PATH
sudo mkdir -p $POSTGRES_PATH

cd $DEPLOY_PATH

# Pull latest code or clone
if [ -d ".git" ]; then
    echo "🔄 Pulling latest changes..."
    sudo git pull origin main
else
    echo "📥 Cloning repository..."
    sudo git clone https://github.com/bensblueprints/leadforge.git .
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "📋 Creating .env from example..."
    sudo cp .env.example .env
    echo "⚠️  Please edit $DEPLOY_PATH/.env with your credentials!"
    echo "📝 Update DATABASE_URL to use Synology IP address"
    exit 1
fi

# Check if Docker/Container Manager is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed or not in PATH"
    echo "📦 Please install Container Manager from Synology Package Center"
    exit 1
fi

# Stop existing containers
echo "🛑 Stopping existing containers..."
sudo docker-compose down || true

# Remove old containers and images (optional - saves space)
echo "🧹 Cleaning up old containers..."
sudo docker container prune -f || true

# Build and start containers
echo "🏗️  Building Docker images..."
sudo docker-compose build --no-cache

echo "🚀 Starting containers..."
sudo docker-compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 15

# Initialize database
echo "🗄️  Initializing database..."
curl -f http://localhost:3000/api/setup-db || echo "⚠️  Manual database initialization may be required"

# Show running containers
echo "✅ Deployment complete! Running containers:"
sudo docker-compose ps

# Get container IPs
echo ""
echo "📊 Container Network Info:"
sudo docker inspect leadforge-app | grep IPAddress || true

echo ""
echo "🌐 LeadForge is now running on port 3000"
echo "🔗 Local access: http://localhost:3000"
echo "🔗 Tailscale access: http://100.122.165.61:3000"
echo "🔗 LAN access (if on Ann House WiFi): http://192.168.1.84:3000"
echo ""
echo "📊 View logs: sudo docker-compose logs -f app"
echo "🛑 Stop: sudo docker-compose down"
echo "🔄 Restart: sudo docker-compose restart"

ENDSSH

echo -e "${GREEN}✅ Deployment to Synology NAS complete!${NC}"
echo -e "${BLUE}🌐 Access your application at:${NC}"
echo -e "   ${GREEN}Tailscale:${NC} http://${SYNOLOGY_HOST}:3000"
echo -e "   ${GREEN}Local:${NC} http://192.168.1.84:3000 (when on Ann House WiFi)"
