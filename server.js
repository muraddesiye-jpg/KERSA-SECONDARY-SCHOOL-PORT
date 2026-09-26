import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import "dotenv/config";
import { query } from "./.src/db.js";
import { signToken, requireAuth, requireRole } from "./.src/auth.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const uploadDir = path.join(process.cwd(), "public", "uploads");
const privateUploadDir = path.join(process.cwd(), "private_uploads");
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(privateUploadDir, { recursive: true });

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET is missing or too short. Set a random secret of at least 32 characters in .env.");
}
if (!process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.CREDENTIAL_ENCRYPTION_KEY.length < 32) {
  throw new Error("CREDENTIAL_ENCRYPTION_KEY is missing or too short. Set a random secret of at least 32 characters in .env.");
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${crypto.randomBytes(5).toString("hex")}-${safe}`);
  }
});
const allowedDocs = new Set([".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx", ".ppt", ".pptx"]);
const allowedImages = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    return cb(allowedDocs.has(ext) ? null : new Error("Unsupported document type."));
  }
});
const imageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    return cb(allowedImages.has(ext) ? null : new Error("Only JPG, PNG and WEBP images are allowed."));
  }
});
const privateDocumentStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, privateUploadDir),
  filename: (_, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safe}`);
  }
});
const privateDocumentUpload = multer({
  storage: privateDocumentStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    return cb(allowedDocs.has(ext) ? null : new Error("Unsupported report-card file type."));
  }
});
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.get('/robots.txt', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /dashboard.html\nDisallow: /login.html\nDisallow: /register.html#statusForm\nSitemap: ${base}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const urls = ['/', '/index.html', '/login.html', '/register.html'].map(p => `<url><loc>${base}${p}</loc></url>`).join('\n');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

app.use(express.static(path.join(process.cwd(), "public")));

const ok = (res, data, status = 200) => res.status(status).json(data);
const safeUser = "id,name,username,email,phone,role,profile_picture,created_at";
const clean = value => String(value ?? "").trim();
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validPhone = value => /^[+0-9][0-9\s-]{7,19}$/.test(value);
const validName = value => /^[\p{L}][\p{L}\s''-]{1,159}$/u.test(value);
const titleCaseName = value => clean(value).toLocaleLowerCase().replace(/(^|[\s''-])([\p{L}])/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase());
const credentialKey = crypto.createHash('sha256').update(process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.JWT_SECRET || 'change-this-secret-in-production').digest();

function encryptCredential(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialKey, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decryptCredential(value) {
  if (!value) return null;
  try {
    const [ivB, tagB, dataB] = String(value).split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', credentialKey, Buffer.from(ivB, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function generateStudentUsername(name, fan) {
  const base = titleCaseName(name).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'student';
  return `${base}.${String(fan).slice(-4)}`;
}

function generateStudentPassword() {
  return `Kersa-${crypto.randomBytes(5).toString('hex')}-${crypto.randomInt(10, 100)}`;
}

const settings = async () => (await query("SELECT * FROM site_settings WHERE id=1")).rows[0] || {};
const MESSAGE_MAX_LENGTH = 2000;
const BANNED_TERMS = [
  'fuck', 'fucker', 'fucking', 'shit', 'bitch', 'asshole', 'bastard', 'motherfucker',
  'idiot', 'stupid', 'dumbass', 'nigger', 'nigga', 'whore', 'slut', 'cunt', 'retard'
];

function moderateMessage(value) {
  const body = clean(value);
  if (!body) return { ok: false, error: 'Message cannot be empty.' };
  if (body.length > MESSAGE_MAX_LENGTH) return { ok: false, error: `Message must be ${MESSAGE_MAX_LENGTH} characters or fewer.` };
  const normalized = body.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
  const hit = BANNED_TERMS.find(t => new RegExp(`(^|\\s)${t.replace(/[.+*?^${}()|[\\]\\\\]/g, '\\$&')}(?=\\s|$)`, 'i').test(normalized));
  if (hit) return { ok: false, error: 'Please keep communication respectful, ethical, and free from insults, harassment, hate speech, threats, or abusive language.' };
  return { ok: true, body };
}

async function isMeetingParticipant(meetingId, userId) {
  const r = await query('SELECT 1 FROM meeting_participants WHERE meeting_id=$1 AND user_id=$2', [meetingId, userId]);
  return !!r.rows[0];
}

const ETHIOPIA_REGIONS = [
  "Tigray", "Afar", "Amhara", "Oromia", "Somali", "Benishangul-Gumuz", "Central Ethiopia",
  "South Ethiopia", "South West Ethiopia", "Gambela", "Harari", "Addis Ababa", "Dire Dawa", "Sidama", "Contested"
];
const ETHIOPIA_WOREDAS = {
  "Oromia": ["Adama Zuria", "Akaki", "Ambo", "Arsi Negele", "Asella", "Bale Gasegar", "Batu Zuria", "Bishoftu", "Bokoji", "Bore", "Boset", "Chiro", "Dale Sadi", "Daro Labu", "Dembi Dolo", "Dera", "Dugda", "East Hararighe", "East Shewa", "Ejere", "Fentale", "Gimbichu", "Goba", "Goro", "Guji", "Gurawa", "Horo Guduru", "Illubaabor", "Jimma Arjo", "Jimma Geneti", "Jimma Zone", "Kersa", "Kersa Malima", "Kiremet", "Kofale", "Kokosa", "Kuyyu", "Liben", "Limu", "Munesa", "Nono", "Nono Benja", "Oda Bultum", "Oromia Special Zone Surrounding Finfinne", "Seka Chekorsa", "Sendafa", "Shashemene Zuria", "Sibu Sire", "Sinana", "Siraro", "Suluta", "Tiyo", "Tulama", "Welenchiiti", "West Arsi", "West Guji", "West Hararighe", "West Shewa", "Woliso", "Yaya Gulele", "Yaya Gulele", "Yemalogi Welele"],
  "Amhara": ["Bahir Dar Zuria", "Banja", "Bure", "Dera", "Debre Elias", "Debre Marcos", "Dejen", "East Belesa", "Enebsie Sar Midir", "Enebse Sar Midir", "Gonji Kolela", "Gondar Zuria", "Lay Gayint", "Meket", "Mecha", "Merawi", "Sekela", "South Acheferer", "Tach Gayint", "Tenta", "Wadla", "Woreillu", "Yilmana Densa"],
  "Tigray": ["Adwa", "Aksum", "Endamekoni", "Hintalo Wajirát", "Kilte Awulaelo", "Laelay Maychew", "Mekelle", "Raya Azebo", "Shire", "Tahtay Adiyabo", "Welkait"],
  "Afar": ["Afambo", "Abaalá", "Amibaara", "Asayita", "Dubti", "Erebti", "Gewane", "Kori", "Logiya", "Mile", "Semera"],
  "Somali": ["Jijiga", "Gode", "Shilaabo", "Kebri Dehar", "Kebri Beyah", "Shinile", "Dolo", "Fik", "Degehabur", "Warder"],
  "Benishangul-Gumuz": ["Assosa", "Bambasi", "Homosaha", "Kurmuk", "Menge", "Pawe", "Sherkole", "Sirba Abay"],
  "Sidama": ["Hawassa Zuria", "Aleta Wondo", "Aleta Chuko", "Bensa", "Dale", "Hula", "Loka Abaya", "Malga", "Wondo Genet", "Yirgalem"],
  "Central Ethiopia": ["Butajira", "Gurage", "Ezjana Wolene", "Kebena", "Sodo Zuria", "Wolkite", "Worabe"],
  "South Ethiopia": ["Arba Minch Zuria", "Chencha", "Dita", "Doyogena", "Gamo Gofa", "Konso", "Kucha", "Mirab Abaya", "Segen Zuria", "Wolaita"],
  "South West Ethiopia": ["Bonga", "Masha", "Tepi", "Yeki", "Sheko", "Surma"],
  "Gambela": ["Abobo", "Gambela Zuria", "Itang", "Jikawo", "Lare", "Nuer Zone"],
  "Harari": ["Amir Nur", "Aboker", "Jin'Eala", "Abadir", "Hakim", "Shenkor", "Dire Teyara", "Jinela", "Harari Town"],
  "Addis Ababa": ["Addis Ketema", "Akaki Kaliti", "Arada", "Bole", "Gullele", "Kirkos", "Kolfe Keranio", "Lideta", "Nifas Silk-Lafto", "Yeka", "Lemi Kura"],
  "Dire Dawa": ["Dire Dawa City", "Gurgura"],
  "Contested": []
};

app.get("/api/health", async (_, res) => {
  try {
    await query("SELECT 1");
    ok(res, { ok: true, database: true, service: "Kersa School Portal" });
  } catch (e) {
    ok(res, { ok: false, database: false, error: e.message }, 503);
  }
});

app.get("/api/ethiopia/regions", (_, res) => ok(res, { regions: ETHIOPIA_REGIONS }));

app.get("/api/ethiopia/woredas", (req, res) => {
  const region = clean(req.query.region);
  if (!ETHIOPIA_REGIONS.includes(region)) return ok(res, { error: "Select a valid Ethiopian region first." }, 400);
  ok(res, { region, woredas: [...new Set(ETHIOPIA_WOREDAS[region] || [])].sort((a, b) => a.localeCompare(b)) });
});

app.get("/api/public/home", async (_, res) => {
  const jobs = await Promise.allSettled([
    query("SELECT id,title,body,created_at FROM announcements ORDER BY created_at DESC LIMIT 8"),
    query("SELECT id,title,event_date,description FROM events ORDER BY event_date ASC LIMIT 8"),
    query("SELECT id,title,image_url,created_at FROM gallery ORDER BY created_at DESC LIMIT 12"),
    query("SELECT * FROM site_settings WHERE id=1"),
    query("SELECT slot,title,image_url,uploaded_at FROM acknowledgment_media ORDER BY slot")
  ]);
  const rows = jobs.map(x => x.status === "fulfilled" ? x.value : { rows: [] });
  ok(res, { 
    announcements: rows[0].rows, 
    events: rows[1].rows, 
    gallery: rows[2].rows, 
    acknowledgment: rows[4].rows, 
    settings: rows[3].rows[0] || {} 
  });
});

app.post("/api/contact", async (req, res) => {
  const name = clean(req.body?.name);
  const email = clean(req.body?.email);
  const phone = clean(req.body?.phone);
  const subject = clean(req.body?.subject);
  const body = clean(req.body?.message);
  if (!name || !email || !subject || !body) return ok(res, { error: "Name, email, subject, and message are required." }, 400);
  if (!validEmail(email)) return ok(res, { error: "Invalid email address." }, 400);
  const msg = moderateMessage(body);
  if (!msg.ok) return ok(res, { error: msg.error }, 400);
  try {
    await query("INSERT INTO contact_messages(name,email,phone,subject,message) VALUES($1,$2,$3,$4,$5)", [name, email, phone, subject, msg.body]);
    ok(res, { ok: true, message: "Your message has been sent successfully." });
  } catch (e) {
    ok(res, { error: e.message }, 500);
  }
});

app.post("/api/auth/login", async (req, res) => {
  const identifier = clean(req.body?.identifier);
  const password = String(req.body?.password ?? "");
  if (!identifier || !password) return ok(res, { error: "Email, username or phone and password are required." }, 400);
  const r = await query("SELECT * FROM users WHERE email=$1 OR username=$1 OR phone=$1 LIMIT 1", [identifier]);
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) return ok(res, { error: "Invalid credentials. Passwords are case-sensitive." }, 401);
  if (u.role === "student") {
    const s = await query("SELECT status FROM students WHERE user_id=$1", [u.id]);
    const status = s.rows[0]?.status;
    if (status !== "approved") return ok(res, { error: status === "rejected" ? "Your registration was rejected. Check your registration response." : "Your registration is still pending approval." }, 403);
    await query("UPDATE students SET generated_password_encrypted=NULL WHERE user_id=$1", [u.id]);
  }
  res.cookie("token", signToken(u), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 });
  ok(res, { user: { id: u.id, name: u.name, username: u.username, email: u.email, role: u.role } });
});

app.post("/api/auth/logout", (_, res) => {
  res.clearCookie("token", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  ok(res, { ok: true });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const r = await query(`SELECT ${safeUser} FROM users WHERE id=$1`, [req.user.id]);
  ok(res, { user: r.rows[0] });
});

app.post("/api/profile", requireAuth, async (req, res) => {
  const name = clean(req.body?.name);
  const requestedUsername = clean(req.body?.username);
  const email = clean(req.body?.email);
  const phone = clean(req.body?.phone);
  if (!name || !email) return ok(res, { error: "Name and email are required." }, 400);
  try {
    const current = await query("SELECT username,role FROM users WHERE id=$1", [req.user.id]);
    if (!current.rows[0]) return ok(res, { error: "Account not found." }, 404);
    const username = current.rows[0].role === 'student' ? current.rows[0].username : requestedUsername;
    if (!username) return ok(res, { error: "Username is required." }, 400);
    const r = await query("UPDATE users SET name=$1,username=$2,email=$3,phone=$4 WHERE id=$5 RETURNING id,name,username,email,phone,role", [name, username, email, phone || null, req.user.id]);
    ok(res, { user: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') return ok(res, { error: "Username, email or phone already exists." }, 409);
    throw e;
  }
});

app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  const current = String(req.body?.currentPassword ?? "");
  const next = String(req.body?.newPassword ?? "");
  if (next.length < 8) return ok(res, { error: "New password must be at least 8 characters." }, 400);
  const r = await query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
  if (!r.rows[0] || !(await bcrypt.compare(current, r.rows[0].password_hash))) return ok(res, { error: "Current password is incorrect." }, 401);
  await query("UPDATE users SET password_hash=$1 WHERE id=$2", [await bcrypt.hash(next, 12), req.user.id]);
  ok(res, { ok: true, message: "Password changed successfully." });
});

app.post("/api/registration", privateDocumentUpload.single("reportCard"), async (req, res) => {
  const b = Object.fromEntries(Object.entries(req.body || {}).map(([k, v]) => [k, clean(v)]));
  const required = ["studentName", "fatherName", "grandfatherName", "email", "gender", "fanNumber", "familyFanNumber", "familyPhone", "disabilityStatus", "phone", "region", "townCity", "woreda", "school", "pastClassResult", "grade"];
  if (required.some(k => !b[k])) return ok(res, { error: "Please complete all required fields." }, 400);
  if (![b.studentName, b.fatherName, b.grandfatherName].every(validName)) return ok(res, { error: "Names may contain letters, spaces, apostrophes and hyphens only." }, 400);
  b.studentName = titleCaseName(b.studentName);
  b.fatherName = titleCaseName(b.fatherName);
  b.grandfatherName = titleCaseName(b.grandfatherName);
  if (!validEmail(b.email)) return ok(res, { error: "Enter a valid email address." }, 400);
  if (!validPhone(b.phone) || !validPhone(b.familyPhone)) return ok(res, { error: "Enter valid student and family phone numbers." }, 400);
  if (!/^\d{16}$/.test(b.fanNumber) || !/^\d{16}$/.test(b.familyFanNumber)) return ok(res, { error: "Student and family FAN numbers must each be exactly 16 digits." }, 400);
  if (!ETHIOPIA_REGIONS.includes(b.region)) return ok(res, { error: "Select a valid Ethiopian region." }, 400);
  if (!(ETHIOPIA_WOREDAS[b.region] || []).includes(b.woreda)) return ok(res, { error: "Select a woreda from the selected region." }, 400);
  const grade = Number(b.grade);
  if (![9, 10, 11, 12].includes(grade)) return ok(res, { error: "Grade must be 9–12." }, 400);
  if ([11, 12].includes(grade) && !b.stream) return ok(res, { error: "Stream is required for grades 11 and 12." }, 400);
  const pastResult = Number(b.pastClassResult);
  if (!Number.isFinite(pastResult) || pastResult < 50 || pastResult > 100) return ok(res, { error: "You have not passed. A past class result of 50 or above is required to submit this application." }, 400);
  if (grade === 9 && !req.file) return ok(res, { error: "Grade 8 report card is required for grade 9." }, 400);
  if (req.file && req.file.size > 10 * 1024 * 1024) return ok(res, { error: "Report card is too large." }, 400);

  const existing = await query("SELECT id FROM students WHERE fan_number=$1 OR family_fan_number=$1", [b.fanNumber]);
  if (existing.rows[0]) return ok(res, { error: "This FAN number is already registered." }, 409);

  const existingUser = await query("SELECT id FROM users WHERE email=$1", [b.email]);
  if (existingUser.rows[0]) return ok(res, { error: "This email is already registered." }, 409);

  try {
    const username = generateStudentUsername(b.studentName, b.fanNumber);
    const password = generateStudentPassword();
    const passwordHash = await bcrypt.hash(password, 12);
    const encryptedPassword = encryptCredential(password);

    const ur = await query(
      "INSERT INTO users(name,username,email,phone,password_hash,role) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
      [b.studentName, username, b.email, b.phone, passwordHash, "student"]
    );
    const userId = ur.rows[0].id;

    await query(
      "INSERT INTO students(user_id,father_name,grandfather_name,family_fan_number,family_phone,gender,fan_number,disability_status,region,town_city,woreda,previous_school,past_class_result,grade,stream,grade8_report_card,generated_password_encrypted) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
      [userId, b.fatherName, b.grandfatherName, b.familyFanNumber, b.familyPhone, b.gender, b.fanNumber, b.disabilityStatus, b.region, b.townCity, b.woreda, b.school, pastResult, grade, b.stream || null, req.file ? req.file.filename : null, encryptedPassword]
    );

    ok(res, { ok: true, message: "Registration submitted successfully!", username, password: "Check your email for login credentials." }, 201);
  } catch (e) {
    if (e.code === '23505') return ok(res, { error: "Email or FAN number already exists." }, 409);
    ok(res, { error: e.message }, 500);
  }
});

app.get("/api/dashboard/student/me", requireAuth, requireRole("student"), async (req, res) => {
  try {
    const s = await query("SELECT * FROM students WHERE user_id=$1", [req.user.id]);
    const student = s.rows[0];
    if (!student) return ok(res, { error: "Student profile not found." }, 404);
    const gs = await query("SELECT subject,score,term FROM grades WHERE student_id=$1 ORDER BY term,subject", [student.id]);
    ok(res, { student, grades: gs.rows });
  } catch (e) {
    ok(res, { error: e.message }, 500);
  }
});

app.listen(PORT, () => console.log(`Kersa School Portal running on port ${PORT}`));
