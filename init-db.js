import fs from "fs";
import "dotenv/config";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { pool } from "./db.js";

const adminEmail = process.env.ADMIN_EMAIL || "admin@kersasecondary.edu.et";
const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString("base64url");

async function initializeDatabase() {
  const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  console.log("Kersa Secondary School — SQLite database initialization");
  await pool.query(schema);
  console.log("✓ SQLite database schema created/updated.");

  const existing = await pool.query("SELECT id FROM users WHERE email=$1 OR username=$2 LIMIT 1", [adminEmail, adminUsername]);
  if (!existing.rows.length) {
    const hash = await bcrypt.hash(adminPassword, 12);
    await pool.query(`INSERT INTO users(name,username,email,password_hash,role) VALUES($1,$2,$3,$4,'admin')`, ["Kersa Administrator", adminUsername, adminEmail, hash]);
    console.log("✓ Administrator account created.");
    console.log(`Admin password (shown only because this account was newly created): ${adminPassword}`);
  } else {
    await pool.query(`UPDATE users SET username=$1,email=$2 WHERE id=$3`, [adminUsername, adminEmail, existing.rows[0].id]);
    console.log("✓ Administrator account verified; existing password was not changed.");
  }

  const announcements = [
    ["Welcome to Kersa Secondary School", "Online registration and the new school portal are now open."],
    ["Student registration", "Grade 9–12 applicants can submit their registration online."]
  ];
  const adminRow = await pool.query("SELECT id FROM users WHERE username=$1 LIMIT 1", [adminUsername]);
  if (adminRow.rows[0]) {
    for (const [title, body] of announcements) {
      await pool.query(
        `INSERT INTO announcements(title,body,created_by)
         SELECT $1,$2,$3
         WHERE NOT EXISTS (SELECT 1 FROM announcements WHERE title=$1)`,
        [title, body, adminRow.rows[0].id]
      );
    }
  }
  console.log("✓ Default announcements verified.");
  console.log("\nSQLite database initialized successfully.");
  console.log(`Database file: ${process.env.SQLITE_PATH || "data/kersa.sqlite"}`);
  console.log(`Admin username: ${adminUsername}`);
  console.log(`Admin email: ${adminEmail}`);
}
try { await initializeDatabase(); }
catch (error) {
  console.error("\n✗ SQLite database initialization failed.");
  console.error(`Reason: ${error.message}`);
  process.exitCode = 1;
} finally { await pool.end().catch(() => {}); }
