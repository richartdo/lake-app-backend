const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

let pool;

function computeMetricStatus(type, value) {
  if (type === "ph") {
    return value < 6.5 || value > 8.5 ? "warning" : "normal";
  }
  if (type === "turbidity") {
    return value > 8 ? "warning" : "normal";
  }
  if (type === "temperature") {
    return value < 20 || value > 30 ? "warning" : "normal";
  }
  return "normal";
}

function computeOverallStatus(ph, turbidity, temperature) {
  const statuses = [
    computeMetricStatus("ph", ph),
    computeMetricStatus("turbidity", turbidity),
    computeMetricStatus("temperature", temperature),
  ];

  return statuses.includes("warning") ? "warning" : "normal";
}

function readingAt(minutesAgo, ph, turbidity, temperature) {
  const timestamp = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
  return {
    ph,
    turbidity,
    temperature,
    status: computeOverallStatus(ph, turbidity, temperature),
    recorded_at: timestamp,
  };
}

async function getDb() {
  if (pool) return pool;

  const dbConfig = {
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "richartdo@123",
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 5433,
    database: process.env.DB_NAME || "constantinople_db",
  };

  pool = new Pool(dbConfig);

  pool.on("error", (err) => {
    console.error("Unexpected error on idle client", err);
  });

  return pool;
}

async function initDatabase() {
  const db = await getDb();

  try {
    // Create tables
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS devices (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        metric VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        battery INTEGER NOT NULL,
        heartbeat VARCHAR(255) NOT NULL,
        signal INTEGER NOT NULL,
        calibration VARCHAR(255) NOT NULL,
        freshness_minutes INTEGER NOT NULL,
        last_update TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sensor_readings (
        id SERIAL PRIMARY KEY,
        ph DECIMAL(10, 2) NOT NULL,
        turbidity DECIMAL(10, 2) NOT NULL,
        temperature DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) NOT NULL,
        recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Check if user exists
    const userResult = await db.query("SELECT COUNT(*) AS total FROM users");
    if (userResult.rows[0].total === 0) {
      const seededPasswordHash = await bcrypt.hash("123456", 10);
      await db.query(
        `INSERT INTO users (full_name, email, password, created_at)
         VALUES ($1, $2, $3, $4)`,
        [
          "Richard Brian",
          "richard@constantnople.com",
          seededPasswordHash,
          new Date().toISOString(),
        ]
      );
      console.log("✓ Sample user created");
    }

    // Check if devices exist
    const deviceResult = await db.query("SELECT COUNT(*) AS total FROM devices");
    if (deviceResult.rows[0].total === 0) {
      const now = new Date().toISOString();
      const sampleDevices = [
        ["Temperature Sensor", "temperature", "on", 91, "2s ago", 84, "Calibrated", 12, now],
        ["Turbidity Sensor", "turbidity", "on", 88, "8s ago", 63, "Due Soon", 38, now],
        ["pH Sensor", "ph", "off", 42, "Offline", 24, "Needs Calibration", 97, now],
      ];

      for (const row of sampleDevices) {
        await db.query(
          `INSERT INTO devices (
            name, metric, status, battery, heartbeat, signal, calibration, freshness_minutes, last_update
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          row
        );
      }
      console.log("✓ Sample devices created");
    }

    // Check if readings exist
    const readingResult = await db.query("SELECT COUNT(*) AS total FROM sensor_readings");
    if (readingResult.rows[0].total === 0) {
      const sampleReadings = [
        readingAt(0, 7.2, 3.5, 25.4),
        readingAt(40, 6.8, 5.1, 26.1),
        readingAt(80, 7.5, 2.0, 24.8),
        readingAt(120, 7.1, 3.9, 25.3),
        readingAt(160, 7.3, 4.2, 25.9),
        readingAt(200, 7.0, 4.8, 24.7),
        readingAt(240, 7.6, 3.1, 24.3),
        readingAt(280, 6.9, 5.5, 26.4),
      ];

      for (const reading of sampleReadings) {
        await db.query(
          `INSERT INTO sensor_readings (ph, turbidity, temperature, status, recorded_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            reading.ph,
            reading.turbidity,
            reading.temperature,
            reading.status,
            reading.recorded_at,
          ]
        );
      }
      console.log("✓ Sample readings created");
    }

    console.log("✓ Database initialized successfully");
  } catch (error) {
    console.error("Database initialization error:", error);
    throw error;
  }
}

module.exports = {
  getDb,
  initDatabase,
  computeMetricStatus,
  computeOverallStatus,
};
