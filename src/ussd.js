// ussd.js
// USSD handler for Water Monitoring System

const express = require("express");
const router = express.Router();
const { getDb } = require("./db");

// ===============================
// Helper Functions
// ===============================

// Get latest readings
async function getLatestReadings() {
  const db = await getDb();
  const result = await db.query(
    `SELECT ph, turbidity, temperature, recorded_at
     FROM sensor_readings
     ORDER BY recorded_at DESC
     LIMIT 1`
  );
  return result.rows[0];
}

// Get last 5 history records
async function getHistory() {
  const db = await getDb();
  const result = await db.query(
    `SELECT ph, turbidity, temperature, recorded_at
     FROM sensor_readings
     ORDER BY recorded_at DESC
     LIMIT 5`
  );
  return result.rows;
}

// ===============================
// USSD ROUTE
// Africa's Talking sends POST here
// ===============================
router.post("/", async (req, res) => {
  try {
    const { sessionId, serviceCode, phoneNumber, text } = req.body;

    console.log("[USSD] Incoming request", {
      sessionId,
      serviceCode,
      phoneNumber,
      text,
      timestamp: new Date().toISOString(),
    });

    let response = "";

    // MAIN MENU
    if (text === "") {
      response = `CON Constantinople Enterprise
Water Monitoring System

1. Latest Readings
2. History`;
    }

    // ======================
    // Latest Readings
    // ======================
    else if (text === "1") {
      const data = await getLatestReadings();

      if (!data) {
        response = "END No data available yet.";
      } else {
        response = `END Latest Readings

      pH: ${data.ph}
      Turbidity: ${data.turbidity} NTU
      Temperature: ${data.temperature}°C
      Updated: ${new Date(data.recorded_at).toLocaleString()}`;
      }
    }

    // ======================
    // History Records
    // ======================
    else if (text === "2") {
      const history = await getHistory();

      if (history.length === 0) {
        response = "END No history records.";
      } else {
        let historyText = "Recent Records:\n\n";

        history.forEach((r, i) => {
          historyText += `${i + 1}. pH:${r.ph} NTU:${r.turbidity} T:${r.temperature}°C\n`;
        });

        response = `END ${historyText}`;
      }
    }

    // Invalid input
    else {
      response = "END Invalid option.";
    }

    res.set("Content-Type", "text/plain");
    res.send(response);
  } catch (error) {
    console.error("[USSD] Handler error", error);
    res.send("END System error. Try again later.");
  }
});

module.exports = router;
