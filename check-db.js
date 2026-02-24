const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
  password: "richartdo@123",
  host: "localhost",
  port: 5433,
  database: "constantinople_db",
});

async function checkData() {
  try {
    console.log("🔍 Checking latest reading in database...\n");

    const result = await pool.query(
      `SELECT * FROM sensor_readings ORDER BY recorded_at DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      console.log("❌ No readings found in database!");
      await pool.end();
      return;
    }

    const row = result.rows[0];
    console.log("Latest reading from PostgreSQL:");
    console.log(JSON.stringify(row, null, 2));
    
    console.log("\nData type check:");
    console.log(`  ph type: ${typeof row.ph}, value: ${row.ph}`);
    console.log(`  turbidity type: ${typeof row.turbidity}, value: ${row.turbidity}`);
    console.log(`  temperature type: ${typeof row.temperature}, value: ${row.temperature}`);

    console.log("\nConversion test:");
    console.log(`  Number(row.ph) = ${Number(row.ph)}`);
    console.log(`  Number(row.turbidity) = ${Number(row.turbidity)}`);
    console.log(`  Number(row.temperature) = ${Number(row.temperature)}`);

    // Count total readings
    const countResult = await pool.query("SELECT COUNT(*) as total FROM sensor_readings");
    console.log(`\n📊 Total readings in database: ${countResult.rows[0].total}`);

    await pool.end();
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

checkData();
