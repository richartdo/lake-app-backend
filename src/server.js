require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const {
  getDb,
  initDatabase,
  computeMetricStatus,
  computeOverallStatus,
} = require("./db");
const ussdRouter = require("./ussd");

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
const RESET_TOKEN_TTL_MINUTES = Number(process.env.RESET_TOKEN_TTL_MINUTES || 30);
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;

const hashResetToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

let cachedTransporterPromise;

const getMailerTransporter = async () => {
  if (cachedTransporterPromise) return cachedTransporterPromise;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
    cachedTransporterPromise = Promise.resolve(
      nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT),
        secure: Number(SMTP_PORT) === 465,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      })
    );
    return cachedTransporterPromise;
  }

  cachedTransporterPromise = nodemailer.createTestAccount().then((account) =>
    nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: {
        user: account.user,
        pass: account.pass,
      },
    })
  );

  return cachedTransporterPromise;
};

const app = express();
const PORT = Number(process.env.PORT || 4000);
const SAMPLE_WINDOW_MS = 5 * 60 * 1000;
const REST_WINDOW_MS = 40 * 60 * 1000;
const SAMPLE_TICK_MS = 10 * 1000;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const generateReading = (previous) => {
  const prevPh = previous?.ph ?? 7.1;
  const prevTurbidity = previous?.turbidity ?? 4.0;
  const prevTemperature = previous?.temperature ?? 25.0;

  const ph = Number(clamp(prevPh + (Math.random() - 0.5) * 0.3, 6.3, 8.7).toFixed(2));
  const turbidity = Number(clamp(prevTurbidity + (Math.random() - 0.5) * 1.2, 1.0, 11.5).toFixed(2));
  const temperature = Number(clamp(prevTemperature + (Math.random() - 0.5) * 0.7, 20.0, 30.5).toFixed(2));

  return { ph, turbidity, temperature };
};

const minutesSince = (isoTime) => {
  if (!isoTime) return null;
  const diffMs = Date.now() - new Date(isoTime).getTime();
  return Math.max(0, Math.round(diffMs / 60000));
};

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`);
  });
  next();
});

app.use("/ussd", ussdRouter);

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    service: "constantinople-backend",
    timestamp: new Date().toISOString(),
  });
});

app.post("/auth/register", async (req, res) => {
  const { fullName, email, password } = req.body || {};
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: "fullName, email and password are required" });
  }

  try {
    const db = await getDb();
    
    // Hash password with salt rounds
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await db.query(
      `INSERT INTO users (full_name, email, password, created_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, full_name, email`,
      [fullName, email.toLowerCase(), hashedPassword, new Date().toISOString()]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(201).json({
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
      },
      token,
    });
  } catch (error) {
    if (String(error.message || "").includes("unique")) {
      return res.status(409).json({ error: "Email already exists" });
    }
    console.error("Registration error:", error);
    return res.status(500).json({ error: "Failed to register user" });
  }
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  try {
    const db = await getDb();
    const result = await db.query(
      `SELECT id, full_name, email, password
       FROM users
       WHERE email = $1`,
      [email.toLowerCase()]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const storedPassword = String(user.password || "");
    const looksHashed = /^\$2[aby]\$\d{2}\$/.test(storedPassword);

    let validPassword = false;

    if (looksHashed) {
      validPassword = await bcrypt.compare(password, storedPassword);
    } else {
      validPassword = password === storedPassword;
      if (validPassword) {
        const upgradedHash = await bcrypt.hash(password, 10);
        await db.query("UPDATE users SET password = $1 WHERE id = $2", [upgradedHash, user.id]);
      }
    }

    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
      },
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Login failed" });
  }
});

app.post("/auth/forgot-password", async (req, res) => {
  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  try {
    const db = await getDb();
    const normalizedEmail = email.toLowerCase();
    const userResult = await db.query(
      `SELECT id, full_name, email FROM users WHERE email = $1`,
      [normalizedEmail]
    );
    const user = userResult.rows[0];

    if (!user) {
      return res.json({ message: "If that email exists, a reset link has been sent." });
    }

    await db.query(
      `UPDATE password_reset_tokens
       SET used_at = $1
       WHERE user_id = $2 AND used_at IS NULL`,
      [new Date().toISOString(), user.id]
    );

    const resetToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(resetToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

    await db.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    const resetLink = `${APP_BASE_URL}/auth/reset-password?token=${encodeURIComponent(resetToken)}`;
    const transporter = await getMailerTransporter();
    const fromAddress = process.env.MAIL_FROM || process.env.SMTP_USER || "no-reply@constantinople.local";

    const sentInfo = await transporter.sendMail({
      from: fromAddress,
      to: user.email,
      subject: "Reset your Constantinople password",
      text: `Hello ${user.full_name || "User"},\n\nUse this link to reset your password:\n${resetLink}\n\nThis link expires in ${RESET_TOKEN_TTL_MINUTES} minutes.`,
      html: `<p>Hello ${user.full_name || "User"},</p><p>Use this link to reset your password:</p><p><a href=\"${resetLink}\">Reset Password</a></p><p>This link expires in ${RESET_TOKEN_TTL_MINUTES} minutes.</p>`,
    });

    const previewUrl = nodemailer.getTestMessageUrl(sentInfo);
    if (previewUrl) {
      console.log("[Password Reset Preview URL]", previewUrl);
    }

    return res.json({
      message: "If that email exists, a reset link has been sent.",
      previewUrl: previewUrl || undefined,
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ error: "Failed to process password reset request" });
  }
});

app.get("/auth/reset-password", (req, res) => {
  const token = req.query?.token || "";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Reset Password</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f5f7fb; padding: 24px; }
      .card { max-width: 420px; margin: 0 auto; background: #fff; padding: 20px; border-radius: 10px; box-shadow: 0 6px 20px rgba(0,0,0,0.08); }
      input, button { width: 100%; padding: 12px; margin-top: 12px; border-radius: 8px; border: 1px solid #d0d7e2; }
      button { border: none; background: #0a84ff; color: white; font-weight: 600; cursor: pointer; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>Reset Password</h2>
      <form method="POST" action="/auth/reset-password">
        <input type="hidden" name="token" value="${String(token).replace(/"/g, "&quot;")}" />
        <label>New Password</label>
        <input type="password" name="newPassword" minlength="6" required />
        <button type="submit">Update Password</button>
      </form>
    </div>
  </body>
</html>`);
});

app.post("/auth/reset-password", async (req, res) => {
  const token = (req.body?.token || "").trim();
  const newPassword = (req.body?.newPassword || "").trim();

  if (!token || !newPassword) {
    return res.status(400).json({ error: "token and newPassword are required" });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: "newPassword must be at least 6 characters" });
  }

  try {
    const db = await getDb();
    const tokenHash = hashResetToken(token);
    const now = new Date().toISOString();

    const tokenResult = await db.query(
      `SELECT id, user_id, expires_at, used_at
       FROM password_reset_tokens
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );

    const tokenRow = tokenResult.rows[0];
    if (!tokenRow || tokenRow.used_at || new Date(tokenRow.expires_at).getTime() < Date.now()) {
      if (req.headers["content-type"]?.includes("application/json")) {
        return res.status(400).json({ error: "Invalid or expired reset token" });
      }
      return res.status(400).send("<h3>Invalid or expired reset token.</h3>");
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    await db.query("UPDATE users SET password = $1 WHERE id = $2", [newHash, tokenRow.user_id]);
    await db.query("UPDATE password_reset_tokens SET used_at = $1 WHERE id = $2", [now, tokenRow.id]);

    if (req.headers["content-type"]?.includes("application/json")) {
      return res.json({ message: "Password reset successful" });
    }

    return res.send("<h3>Password reset successful. You can close this page and log in from the app.</h3>");
  } catch (error) {
    console.error("Reset password error:", error);
    if (req.headers["content-type"]?.includes("application/json")) {
      return res.status(500).json({ error: "Failed to reset password" });
    }
    return res.status(500).send("<h3>Failed to reset password.</h3>");
  }
});

app.get("/latest-readings", async (_, res) => {
  try {
    const db = await getDb();
    const latestResult = await db.query(
      `SELECT * FROM sensor_readings ORDER BY recorded_at DESC LIMIT 1`
    );
    const latest = latestResult.rows[0];

    if (!latest) {
      return res.status(404).json({ error: "No readings found" });
    }

    console.log("[DEBUG] Latest reading from DB:", latest);

    // Convert string values from PostgreSQL to numbers
    const ph = latest.ph ? Number(latest.ph) : 0;
    const turbidity = latest.turbidity ? Number(latest.turbidity) : 0;
    const temperature = latest.temperature ? Number(latest.temperature) : 0;

    console.log("[DEBUG] Converted values:", { ph, turbidity, temperature });

    const devicesResult = await db.query(`SELECT status FROM devices`);
    const devices = devicesResult.rows;
    const deviceStatus = devices.some((d) => d.status === "off") ? "offline" : "online";

    return res.json({
      ph: {
        value: Number(ph.toFixed(2)),
        status: computeMetricStatus("ph", ph),
        range: "6.5-8.5",
      },
      turbidity: {
        value: Number(turbidity.toFixed(2)),
        status: computeMetricStatus("turbidity", turbidity),
        unit: "NTU",
        range: "0-10",
      },
      temperature: {
        value: Number(temperature.toFixed(2)),
        status: computeMetricStatus("temperature", temperature),
        unit: "°C",
        range: "20-30",
      },
      deviceStatus,
      lastUpdate: latest.recorded_at,
    });
  } catch (error) {
    console.error("[/latest-readings] Error:", error.message);
    return res.status(500).json({ error: "Failed to fetch latest readings" });
  }
});

app.get("/history", async (req, res) => {
  const { from, to, q, limit } = req.query;

  try {
    const db = await getDb();
    const where = [];
    const params = [];
    let paramIndex = 1;

    if (from) {
      where.push(`recorded_at >= $${paramIndex}`);
      params.push(from);
      paramIndex++;
    }

    if (to) {
      where.push(`recorded_at <= $${paramIndex}`);
      params.push(to);
      paramIndex++;
    }

    if (q) {
      where.push(`CAST(recorded_at AS TEXT) ILIKE $${paramIndex}`);
      params.push(`%${q}%`);
      paramIndex++;
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rowLimit = Number(limit || 100);
    params.push(rowLimit);

    const result = await db.query(
      `SELECT id, ph, turbidity, temperature, status, recorded_at
       FROM sensor_readings
       ${whereClause}
       ORDER BY recorded_at DESC
       LIMIT $${paramIndex}`,
      params
    );
    const rows = result.rows;

    return res.json(
      rows.map((row) => {
        const ph = row.ph ? Number(row.ph) : 0;
        const turbidity = row.turbidity ? Number(row.turbidity) : 0;
        const temperature = row.temperature ? Number(row.temperature) : 0;
        return {
          id: row.id,
          ph: Number(ph.toFixed(2)),
          turbidity: Number(turbidity.toFixed(2)),
          temperature: Number(temperature.toFixed(2)),
          status: row.status,
          timestamp: row.recorded_at,
        };
      })
    );
  } catch (error) {
    console.error("[/history] Error:", error.message);
    return res.status(500).json({ error: "Failed to fetch history" });
  }
});

app.get("/device-status", async (_, res) => {
  try {
    const db = await getDb();
    const result = await db.query(
      `SELECT id, name, metric, status, battery, heartbeat, signal, calibration, freshness_minutes AS freshnessMinutes, last_update AS lastUpdate
       FROM devices
       ORDER BY id ASC`
    );
    const rows = result.rows;

    return res.json(rows);
  } catch {
    return res.status(500).json({ error: "Failed to fetch device status" });
  }
});

app.post("/iot/readings", async (req, res) => {
  const { ph, turbidity, temperature } = req.body || {};

  const parsedPh = Number(ph);
  const parsedTurbidity = Number(turbidity);
  const parsedTemperature = Number(temperature);

  if (
    Number.isNaN(parsedPh) ||
    Number.isNaN(parsedTurbidity) ||
    Number.isNaN(parsedTemperature)
  ) {
    return res.status(400).json({
      error: "ph, turbidity and temperature must be numeric values",
    });
  }

  try {
    const db = await getDb();
    const timestamp = new Date().toISOString();
    const status = computeOverallStatus(parsedPh, parsedTurbidity, parsedTemperature);

    const result = await db.query(
      `INSERT INTO sensor_readings (ph, turbidity, temperature, status, recorded_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [parsedPh, parsedTurbidity, parsedTemperature, status, timestamp]
    );

    return res.status(201).json({
      id: result.rows[0].id,
      ph: parsedPh,
      turbidity: parsedTurbidity,
      temperature: parsedTemperature,
      status,
      timestamp,
    });
  } catch {
    return res.status(500).json({ error: "Failed to store IoT reading" });
  }
});

app.get("/users", async (_, res) => {
  try {
    const db = await getDb();
    const result = await db.query(
      `SELECT id, full_name AS fullName, email, created_at AS createdAt
       FROM users
       ORDER BY id ASC`
    );
    const users = result.rows;

    return res.json(users);
  } catch {
    return res.status(500).json({ error: "Failed to fetch users" });
  }
});

const startSamplingCycle = async () => {
  const db = await getDb();
  let cycleStart = Date.now();
  let previousReadingResult = await db.query(
    `SELECT ph, turbidity, temperature, recorded_at
     FROM sensor_readings
     ORDER BY recorded_at DESC
     LIMIT 1`
  );
  let previousReading = previousReadingResult.rows[0];

  const tick = async () => {
    const elapsed = Date.now() - cycleStart;
    const isSampling = elapsed < SAMPLE_WINDOW_MS;
    const timestamp = new Date().toISOString();

    if (elapsed >= SAMPLE_WINDOW_MS + REST_WINDOW_MS) {
      cycleStart = Date.now();
    }

    if (isSampling) {
      const next = generateReading(previousReading);
      const status = computeOverallStatus(next.ph, next.turbidity, next.temperature);

      await db.query(
        `INSERT INTO sensor_readings (ph, turbidity, temperature, status, recorded_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [next.ph, next.turbidity, next.temperature, status, timestamp]
      );

      previousReading = { ...next, recorded_at: timestamp };
    }

    const freshness = minutesSince(previousReading?.recorded_at);
    const deviceStatus = isSampling ? "on" : "off";
    const heartbeat = isSampling ? "Just now" : "Offline";
    const signal = isSampling ? 75 : 20;

    await db.query(
      `UPDATE devices
       SET status = $1,
           heartbeat = $2,
           signal = $3,
           freshness_minutes = $4,
           last_update = $5`,
      [
        deviceStatus,
        heartbeat,
        signal,
        Number.isFinite(freshness) ? freshness : 0,
        timestamp,
      ]
    );
  };

  await tick();
  setInterval(() => {
    tick().catch((error) => console.error("Sampling cycle error", error));
  }, SAMPLE_TICK_MS);
};

(async () => {
  try {
    await initDatabase();
    // Temporarily disabled sampling cycle - using seeded data for testing
    // await startSamplingCycle();
    app.listen(PORT, () => {
      console.log(`Backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start backend", error);
    process.exit(1);
  }
})();
