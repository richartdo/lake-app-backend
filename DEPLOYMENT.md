# Constantinople Backend - Deployment Guide

## Deploy to Render.com (Recommended)

### Option 1: Using render.yaml (One-Click Deploy)

1. **Push code to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

2. **Create Render account**:
   - Go to https://render.com and sign up
   - Connect your GitHub account

3. **Deploy with Blueprint**:
   - Click "New +" → "Blueprint"
   - Select your repository
   - Render will detect `render.yaml` and create both:
     - Web Service (Node.js backend)
     - PostgreSQL database
   - Click "Apply"

4. **Set Environment Variables** (in Render dashboard):
   - `APP_BASE_URL`: Your Render service URL (e.g., https://constantinople-backend.onrender.com)
   - `DB_HOST`: Auto-set from database connection
   - `DB_PORT`: Auto-set from database connection
   - `DB_NAME`: Auto-set from database connection
   - `DB_USER`: Auto-set from database connection
   - `DB_PASSWORD`: Auto-set from database connection
   - `JWT_SECRET`: Auto-generated or set your own
   - For email (optional):
     - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`

### Option 2: Manual Setup

1. **Create PostgreSQL Database**:
   - Dashboard → "New +" → "PostgreSQL"
   - Name: `constantinople-db`
   - Plan: Free
   - Create Database

2. **Create Web Service**:
   - Dashboard → "New +" → "Web Service"
   - Connect your GitHub repository
   - Name: `constantinople-backend`
   - Region: Oregon (or closest to you)
   - Branch: `main`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: Free

3. **Configure Environment Variables**:
   - In the service dashboard, go to "Environment"
   - Add all variables listed above
   - Use the Internal Database URL from your PostgreSQL instance

### Database Migration

The database schema is automatically created on first run by `src/db.js`.

If you need to manually seed data:
```bash
# Connect to your Render PostgreSQL shell
# Run seed script (if needed)
```

### Free Plan Limitations

- Service spins down after 15 minutes of inactivity
- First request after spin-down takes ~30-60 seconds
- 750 hours/month free (enough for one service 24/7)
- PostgreSQL: 90-day data retention, 1GB storage

### Upgrade Considerations

For production with no downtime:
- Upgrade to **Starter Plan** ($7/month)
- No spin-down delays
- More compute resources
- PostgreSQL: 30-day retention, 10GB storage

## Alternative: Railway.app

1. Go to https://railway.app
2. Click "Start a New Project"
3. Select "Deploy from GitHub repo"
4. Add PostgreSQL plugin
5. Set environment variables
6. Railway auto-detects Node.js and starts the app

Cost: $5/month for resources used

## Post-Deployment

1. **Test the API**:
   ```bash
   curl https://your-app.onrender.com/health
   ```

2. **Update Mobile App**:
   - Update `.env` in constantinople-app:
     ```
     EXPO_PUBLIC_API_BASE_URL=https://your-app.onrender.com
     ```

3. **Test Authentication**:
   ```bash
   curl -X POST https://your-app.onrender.com/auth/register \
     -H "Content-Type: application/json" \
     -d '{"fullName":"Test User","email":"test@example.com","password":"password123"}'
   ```

4. **Monitor Logs**:
   - Render Dashboard → Your Service → Logs
   - Watch for database connection issues or errors

## Email Configuration (Password Reset)

For production password reset emails, use SendGrid free tier:

1. Sign up at https://sendgrid.com (100 emails/day free)
2. Create API key
3. Add to Render environment variables:
   ```
   SMTP_HOST=smtp.sendgrid.net
   SMTP_PORT=587
   SMTP_USER=apikey
   SMTP_PASS=YOUR_SENDGRID_API_KEY
   MAIL_FROM=noreply@yourdomain.com
   ```

## Troubleshooting

**Database Connection Failed**:
- Verify all DB_* environment variables match your PostgreSQL instance
- Check if database is in same region as web service

**Service Won't Start**:
- Check logs in Render dashboard
- Verify `npm start` works locally
- Ensure all required dependencies are in package.json

**Password Reset Not Working**:
- Check logs for SMTP errors
- Verify SMTP credentials
- Test with Ethereal (no SMTP vars set) to see preview URLs in logs
