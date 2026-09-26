# ✅ Backend Server Status

## Server Running!

**Backend Status:** 🟢 RUNNING
- **Port:** 5000
- **URL:** http://localhost:5000
- **API Base:** http://localhost:5000/api

## Current Status

```
Server running on port 5000
Waiting for MongoDB connection...
```

## ⚠️ Important: MongoDB Setup Required

The backend is running but needs MongoDB to function. You have two options:

### Option 1: Use MongoDB Locally (Recommended for Development)

1. **Install MongoDB Community Edition:**
   - Download: https://www.mongodb.com/try/download/community
   - Windows installer will set up MongoDB as a service

2. **Start MongoDB:**
   ```bash
   # MongoDB will auto-start as a service
   # Or manually start from Windows Services
   ```

3. **Verify Connection:**
   - Backend will show: `MongoDB connected`
   - Then the app is fully functional

### Option 2: Use MongoDB Atlas (Cloud)

1. **Sign up:** https://www.mongodb.com/cloud/atlas
2. **Create a free cluster**
3. **Get connection string:** `mongodb+srv://user:password@cluster.mongodb.net/fintech-loan`
4. **Update `.env` file:**
   ```env
   MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/fintech-loan
   ```
5. **Backend will auto-reconnect**

## API Endpoints (Ready to Test!)

### Health Check
```bash
curl http://localhost:5000/api/health
```

### Signup
```bash
curl -X POST http://localhost:5000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "9876543210",
    "password": "Test@123",
    "confirmPassword": "Test@123"
  }'
```

### Login
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "Test@123"
  }'
```

## 🔧 Backend Configuration

Edit `backend/.env` to change:
- `PORT` - Server port (default: 5000)
- `MONGODB_URI` - Database connection string
- `JWT_SECRET` - JWT signing key
- `DEFAULT_INTEREST_RATE` - Loan interest rate

## 📱 Next: Mobile App Setup

Once MongoDB is connected, you can set up the Flutter mobile app:

```bash
cd mobile
flutter pub get
flutter run
```

The app will connect to: `http://localhost:5000/api`

For Android emulator, use: `http://10.0.2.2:5000/api`

## 🚀 Full Integration

When everything is ready:
1. ✅ Backend running on port 5000
2. ⏳ MongoDB connected (waiting for setup)
3. ⏳ Flutter mobile app connected

## Terminal Output

```
[nodemon] starting `node src/index.js`
Server running on port 5000
```

The backend is watching for file changes. When you modify files in `src/`, the server will auto-restart.

## Troubleshooting

**Backend not connecting to MongoDB?**
- Verify MongoDB is running
- Check connection string in `.env`
- For local: ensure `mongod` process is running
- For Atlas: verify network access and credentials

**Port 5000 already in use?**
- Change `PORT` in `.env`
- Or kill the process: `netstat -ano | findstr :5000`

**Need to stop the server?**
- Press `Ctrl+C` in the terminal where it's running
- Or type `exit`

---

**✅ Backend is ready! Set up MongoDB next.**
