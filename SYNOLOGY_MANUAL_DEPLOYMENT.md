# LeadForge - Synology NAS Manual Deployment Guide

Since Docker CLI access is restricted on Synology, you'll need to deploy using the Container Manager GUI or by configuring Docker socket permissions.

## Files Already Prepared

✅ All files have been uploaded to: `~/leadforge/app/`
✅ Docker configuration files are ready
✅ `.env` file created from production template

## Option 1: Using Container Manager GUI (Recommended)

### Step 1: Open Container Manager
1. Open Synology DSM
2. Go to **Package Center** → **Container Manager**
3. Click to open Container Manager

### Step 2: Create PostgreSQL Container

1. Go to **Registry** tab
2. Search for `postgres`
3. Download `postgres:16-alpine`
4. Once downloaded, go to **Container** tab
5. Click **Create** → **Create via Docker Compose** or **Create from image**

If using **Create from image**:
- **Container Name:** leadforge-db
- **Image:** postgres:16-alpine
- **Port Settings:**
  - Container Port: 5432
  - Local Port: 5432
- **Volume Settings:**
  - Folder: Create `/volume1/docker/leadforge/postgres`
  - Mount path: `/var/lib/postgresql/data`
- **Environment Variables:**
  ```
  POSTGRES_USER=leadforge
  POSTGRES_PASSWORD=SecurePassword123!
  POSTGRES_DB=leadforge
  ```
- **Auto-restart:** Enabled

### Step 3: Build LeadForge App Image

Since you have the Dockerfile, you can build the image:

**Via SSH (if you get docker permissions):**
```bash
cd ~/leadforge/app
sudo /usr/local/bin/docker build -t leadforge:latest .
```

**Or via Container Manager:**
1. Go to **Image** tab
2. Click **Add** → **Add from File**
3. Browse to `~/leadforge/app`
4. It should detect the Dockerfile
5. Build the image

### Step 4: Create LeadForge App Container

1. Go to **Container** tab
2. Click **Create** → **Create from image**
3. Select `leadforge:latest`
4. **Container Name:** leadforge-app
5. **Port Settings:**
   - Container Port: 3000
   - Local Port: 3000
6. **Environment Variables:**
   ```
   NODE_ENV=production
   PORT=3000
   DATABASE_URL=postgresql://leadforge:SecurePassword123!@192.168.1.84:5432/leadforge
   JWT_SECRET=your-32-character-random-secret-here
   GOOGLE_MAPS_API_KEY=AIzaSyCngyzhiymWqY3ypkY4U5znvC_m18F1srA
   ```
7. **Auto-restart:** Enabled
8. **Links:** Link to `leadforge-db` container

### Step 5: Initialize Database

Once both containers are running, initialize the database by visiting:

```
http://192.168.1.84:3000/api/setup-db
```

Or via curl from SSH:
```bash
curl http://localhost:3000/api/setup-db
```

---

## Option 2: Fix Docker Socket Permissions (Advanced)

If you want to use Docker CLI directly, you need to grant your user access to the Docker socket.

### SSH into Synology and run:

```bash
# Check current socket permissions
ls -la /var/run/docker.sock

# Add your user to docker group (if it exists)
sudo synogroup --add docker Ben

# Or change socket permissions (less secure)
sudo chmod 666 /var/run/docker.sock

# Then try docker commands
/usr/local/bin/docker ps
```

### Then deploy with docker-compose:

```bash
cd ~/leadforge/app
/usr/local/bin/docker-compose up -d
```

---

## Option 3: Use Docker Compose via Container Manager

Container Manager on newer DSM versions supports Docker Compose YAML files directly.

### Steps:

1. Open **Container Manager**
2. Go to **Project** tab
3. Click **Create**
4. **Project Name:** leadforge
5. **Path:** Browse to `~/leadforge/app`
6. It should auto-detect `docker-compose.yml`
7. Click **Next** and review settings
8. Click **Done** to create and start

This will automatically create both containers with the proper networking.

---

## Verification

Once deployed, verify the deployment:

### 1. Check Containers are Running

In Container Manager → Container tab, you should see:
- ✅ `leadforge-db` (Status: Running)
- ✅ `leadforge-app` (Status: Running)

### 2. Check Logs

Click on each container and view **Logs** to ensure no errors.

### 3. Test the Application

**Local Access (on Synology):**
```
http://localhost:3000
```

**LAN Access (from Ann House WiFi):**
```
http://192.168.1.84:3000
```

**Tailscale Access (from anywhere):**
```
http://100.122.165.61:3000
```

### 4. Initialize Database

Visit:
```
http://192.168.1.84:3000/api/setup-db
```

You should see:
```json
{
  "success": true,
  "message": "All tables created successfully"
}
```

---

## Current Status

### Files Uploaded ✅
- Location: `~/leadforge/app/`
- All Docker configuration files present
- Production .env file created

### Docker Installation ✅
- Docker version: 24.0.2
- Docker Compose version: 2.20.1
- Location: `/usr/local/bin/docker`

### Remaining Steps:
1. Deploy containers using one of the methods above
2. Initialize database
3. Test the application

---

## Troubleshooting

### Container Won't Start

Check logs in Container Manager or via SSH:
```bash
/usr/local/bin/docker logs leadforge-app
/usr/local/bin/docker logs leadforge-db
```

### Database Connection Issues

Make sure:
- PostgreSQL container is running
- `DATABASE_URL` in app container points to correct host
- Use `192.168.1.84` or `100.122.165.61` instead of `localhost` for database host
- Or use Docker container name `leadforge-db` if containers are on same network

### Port Already in Use

If port 3000 or 5432 is taken:
- Check what's using it: `netstat -tulpn | grep :3000`
- Choose different external port in Container Manager
- Update your .env file if needed

---

## Access URLs

After successful deployment:

| Access Type | URL |
|------------|-----|
| Local (on NAS) | http://localhost:3000 |
| LAN (Ann House WiFi) | http://192.168.1.84:3000 |
| Tailscale (Remote) | http://100.122.165.61:3000 |
| Database Setup | http://[any-above]/api/setup-db |

---

## Support

For issues:
- Email: ben@justfeatured.com
- Check Container Manager logs
- Files location: `~/leadforge/app/`
