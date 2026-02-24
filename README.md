# Constantinople Backend (Dev)

Simple Node.js + Express API with a single SQLite file for development/testing.

## Run

```bash
cd constantinople-backend
npm install
npm start
```

Server starts on `http://localhost:4000` by default.

## Env

Use `.env`:

- `PORT` - API port
- `DB_PATH` - SQLite database file path
- `CORS_ORIGIN` - allowed CORS origin (use `*` for dev)

## Endpoints

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `GET /users`
- `GET /latest-readings`
- `GET /history?from=&to=&q=&limit=`
- `GET /device-status`
- `POST /iot/readings`

## Notes

- DB is auto-created and seeded with sample users/devices/readings on first run.
- This setup is for testing and local development only.
