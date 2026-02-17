#!/bin/bash

# ============================================
# LeadForge - Hetzner Deployment Script
# ============================================

set -e  # Exit on error

echo "🚀 Starting LeadForge deployment to Hetzner..."

# Configuration
HETZNER_HOST="${HETZNER_HOST:-your-hetzner-ip}"
HETZNER_USER="${HETZNER_USER:-root}"
DEPLOY_PATH="/opt/leadforge"
REPO_URL="https://github.com/bensblueprints/leadforge.git"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}📡 Connecting to Hetzner server...${NC}"

# Deploy via SSH
ssh ${HETZNER_USER}@${HETZNER_HOST} << 'ENDSSH'

set -e

# Navigate to deployment directory
cd /opt
DEPLOY_PATH="/opt/leadforge"

echo "📦 Setting up deployment directory..."
if [ ! -d "$DEPLOY_PATH" ]; then
    mkdir -p $DEPLOY_PATH
fi

cd $DEPLOY_PATH

# Pull latest code or clone
if [ -d ".git" ]; then
    echo "🔄 Pulling latest changes..."
    git pull origin main
else
    echo "📥 Cloning repository..."
    git clone https://github.com/bensblueprints/leadforge.git .
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "📋 Creating .env from example..."
    cp .env.example .env
    echo "⚠️  Please edit /opt/leadforge/.env with your credentials!"
    exit 1
fi

# Stop existing containers
echo "🛑 Stopping existing containers..."
docker-compose down || true

# Build and start containers
echo "🏗️  Building Docker images..."
docker-compose build --no-cache

echo "🚀 Starting containers..."
docker-compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Initialize database
echo "🗄️  Initializing database..."
docker-compose exec -T app node -e "
const http = require('http');
http.get('http://localhost:3000/api/setup-db', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Database initialized:', data);
    process.exit(res.statusCode === 200 ? 0 : 1);
  });
}).on('error', (err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
"

# Show running containers
echo "✅ Deployment complete! Running containers:"
docker-compose ps

echo "🌐 LeadForge is now running on port 3000"
echo "📊 View logs: docker-compose logs -f app"
echo "🛑 Stop: docker-compose down"

ENDSSH

echo -e "${GREEN}✅ Deployment to Hetzner complete!${NC}"
echo -e "${BLUE}🌐 Access your application at: http://${HETZNER_HOST}:3000${NC}"
