import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import "dotenv/config";
import { query } from "./src/db.js";
import { signToken, requireAuth, requireRole } from "./src/auth.js";

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
  fileFilter: (_, file, cb) => cb(allowedDocs.has(path.extname(file.originalname).toLowerCase()) ? null : new Error("Unsupported document type."), allowedDocs.has(path.extname(file.originalname).toLowerCase()))
});
const imageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(allowedImages.has(path.extname(file.originalname).toLowerCase()) ? null : new Error("Only JPG, PNG and WEBP images are allowed."), allowedImages.has(path.extname(file.originalname).toLowerCase()))
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
  fileFilter: (_, file, cb) => cb(allowedDocs.has(path.extname(file.originalname).toLowerCase()) ? null : new Error("Unsupported report-card file type."), allowedDocs.has(path.extname(file.originalname).toLowerCase()))
});
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.get('/robots.txt', (req,res)=>{
  const base=`${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /dashboard.html\nDisallow: /login.html\nDisallow: /register.html#statusForm\nSitemap: ${base}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (req,res)=>{
  const base=`${req.protocol}://${req.get('host')}`;
  const urls=['/','/index.html','/login.html','/register.html'].map(p=>`<url><loc>${base}${p}</loc></url>`).join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

app.use(express.static(path.join(process.cwd(), "public")));

const ok = (res, data, status = 200) => res.status(status).json(data);
const safeUser = "id,name,username,email,phone,role,profile_picture,created_at";
const clean = value => String(value ?? "").trim();
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validPhone = value => /^[+0-9][0-9\s-]{7,19}$/.test(value);
const validName = value => /^[\p{L}][\p{L}\s'’-]{1,159}$/u.test(value);
const titleCaseName = value => clean(value).toLocaleLowerCase().replace(/(^|[\s'’-])([\p{L}])/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase());
const credentialKey = crypto.createHash('sha256').update(process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.JWT_SECRET || 'change-this-secret-in-production').digest();
function encryptCredential(value){const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',credentialKey,iv);const encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);return [iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');}
function decryptCredential(value){if(!value)return null;try{const [ivB,tagB,dataB]=String(value).split('.');const decipher=crypto.createDecipheriv('aes-256-gcm',credentialKey,Buffer.from(ivB,'base64url'));decipher.setAuthTag(Buffer.from(tagB,'base64url'));return Buffer.concat([decipher.update(Buffer.from(dataB,'base64url')),decipher.final()]).toString('utf8');}catch{return null;}}
function generateStudentUsername(name, fan){const base=titleCaseName(name).toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'') || 'student';return `${base}.${String(fan).slice(-4)}`;}
function generateStudentPassword(){return `Kersa-${crypto.randomBytes(5).toString('hex')}-${crypto.randomInt(10,100)}`;}

const settings = async () => (await query("SELECT * FROM site_settings WHERE id=1")).rows[0] || {};
const MESSAGE_MAX_LENGTH = 2000;
const BANNED_TERMS = [
  'fuck','fucker','fucking','shit','bitch','asshole','bastard','motherfucker',
  'idiot','stupid','dumbass','nigger','nigga','whore','slut','cunt','retard'
];
function moderateMessage(value) {
  const body = clean(value);
  if (!body) return { ok:false, error:'Message cannot be empty.' };
  if (body.length > MESSAGE_MAX_LENGTH) return { ok:false, error:`Message must be ${MESSAGE_MAX_LENGTH} characters or fewer.` };
  const normalized = body.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ');
  const hit = BANNED_TERMS.find(t => new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?=\\s|$)`, 'i').test(normalized));
  if (hit) return { ok:false, error:'Please keep communication respectful, ethical, and free from insults, harassment, hate speech, threats, or abusive language.' };
  return { ok:true, body };
}
async function isMeetingParticipant(meetingId, userId) {
  const r = await query('SELECT 1 FROM meeting_participants WHERE meeting_id=$1 AND user_id=$2',[meetingId,userId]);
  return !!r.rows[0];
}



const ETHIOPIA_REGIONS = [
  "Tigray", "Afar", "Amhara", "Oromia", "Somali", "Benishangul-Gumuz", "Central Ethiopia",
  "South Ethiopia", "South West Ethiopia", "Gambela", "Harari", "Addis Ababa", "Dire Dawa", "Sidama", "Contested"
];
const ETHIOPIA_WOREDAS = {
  "Oromia": ["Adama Zuria", "Akaki", "Ambo", "Arsi Negele", "Asella", "Bale Gasegar", "Batu Zuria", "Bishoftu", "Bokoji", "Bore", "Boset", "Chiro", "Dale Sadi", "Daro Labu", "Dembi Dolo", "Dera", "Dugda", "East Hararghe", "East Shewa", "Ejere", "Fentale", "Gimbichu", "Goba", "Goro", "Guji", "Gurawa", "Horo Guduru", "Illubabor", "Jimma Arjo", "Jimma Geneti", "Jimma Zone", "Kersa", "Kersa Malima", "Kiremt", "Kofale", "Kokosa", "Kuyyu", "Liben", "Limu", "Munesa", "Nono", "Nono Benja", "Oda Bultum", "Oromia Special Zone Surrounding Finfinne", "Seka Chekorsa", "Sendafa", "Shashemene Zuria", "Sibu Sire", "Sinana", "Siraro", "Sululta", "Tiyo", "Tulama", "Welenchiti", "West Arsi", "West Guji", "West Hararghe", "West Shewa", "Woliso", "Yaya Gulele", "Yaya Gulele", "Yemalogi Welele"],
  "Amhara": ["Bahir Dar Zuria", "Banja", "Bure", "Dera", "Debre Elias", "Debre Markos", "Dejen", "East Belesa", "Enebsie Sar Midir", "Enebse Sar Midir", "Gonji Kolela", "Gondar Zuria", "Lay Gayint", "Meket", "Mecha", "Merawi", "Sekela", "South Achefer", "Tach Gayint", "Tenta", "Wadla", "Woreilu", "Yilmana Densa"],
  "Tigray": ["Adwa", "Aksum", "Endamekoni", "Hintalo Wajirat", "Kilte Awulaelo", "Laelay Maychew", "Mekelle", "Raya Azebo", "Shire", "Tahtay Adiyabo", "Welkait"],
  "Afar": ["Afambo", "Abaala", "Amibara", "Asayita", "Dubti", "Erebti", "Gewane", "Kori", "Logiya", "Mile", "Semera"],
  "Somali": ["Jijiga", "Gode", "Shilabo", "Kebri Dehar", "Kebri Beyah", "Shinile", "Dolo", "Fik", "Degehabur", "Warder"],
  "Benishangul-Gumuz": ["Assosa", "Bambasi", "Homosha", "Kurmuk", "Menge", "Pawe", "Sherkole", "Sirba Abay"],
  "Sidama": ["Hawassa Zuria", "Aleta Wondo", "Aleta Chuko", "Bensa", "Dale", "Hula", "Loka Abaya", "Malga", "Wondo Genet", "Yirgalem"],
  "Central Ethiopia": ["Butajira", "Gurage", "Ezhana Wolene", "Kebena", "Sodo Zuria", "Wolkite", "Worabe"],
  "South Ethiopia": ["Arba Minch Zuria", "Chencha", "Dita", "Doyogena", "Gamo Gofa", "Konso", "Kucha", "Mirab Abaya", "Segen Zuria", "Wolaita"],
  "South West Ethiopia": ["Bonga", "Masha", "Tepi", "Yeki", "Sheko", "Surma"],
  "Gambela": ["Abobo", "Gambela Zuria", "Itang", "Jikawo", "Lare", "Nuer Zone"],
  "Harari": ["Amir Nur", "Aboker", "Jin'Eala", "Abadir", "Hakim", "Shenkor", "Dire Teyara", "Jinela", "Harari Town"],
  "Addis Ababa": ["Addis Ketema", "Akaki Kaliti", "Arada", "Bole", "Gullele", "Kirkos", "Kolfe Keranio", "Lideta", "Nifas Silk-Lafto", "Yeka", "Lemi Kura"],
  "Dire Dawa": ["Dire Dawa City", "Gurgura"],
  "Contested": []
};

app.get("/api/health", async (_, res) => {
  try { await query("SELECT 1"); ok(res, { ok: true, database: true, service: "Kersa School Portal" }); }
  catch (e) { ok(res, { ok: false, database: false, error: e.message }, 503); }
});
app.get("/api/ethiopia/regions", (_, res) => ok(res, { regions: ETHIOPIA_REGIONS }));
app.get("/api/ethiopia/woredas", (req, res) => {
  const region = clean(req.query.region);
  if (!ETHIOPIA_REGIONS.includes(region)) return ok(res, { error: "Select a valid Ethiopian region first." }, 400);
  ok(res, { region, woredas: [...new Set(ETHIOPIA_WOREDAS[region] || [])].sort((a,b) => a.localeCompare(b)) });
});

app.get("/api/public/home", async (_, res) => {
  // Public content is intentionally isolated so a missing/empty optional table
  // cannot take down the whole homepage or the acknowledgment section.
  const jobs = await Promise.allSettled([
    query("SELECT id,title,body,created_at FROM announcements ORDER BY created_at DESC LIMIT 8"),
    query("SELECT id,title,event_date,description FROM events ORDER BY event_date ASC LIMIT 8"),
    query("SELECT id,title,image_url,created_at FROM gallery ORDER BY created_at DESC LIMIT 12"),
    query("SELECT * FROM site_settings WHERE id=1"),
    query("SELECT slot,title,image_url,uploaded_at FROM acknowledgment_media ORDER BY slot")
  ]);
  const rows = jobs.map(x => x.status === "fulfilled" ? x.value : { rows: [] });
  ok(res, { announcements: rows[0].rows, events: rows[1].rows, gallery: rows[2].rows, acknowledgment: rows[4].rows, settings: rows[3].rows[0] || {} });
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
app.post("/api/auth/logout", (_, res) => { res.clearCookie("token", { httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV==='production' }); ok(res, { ok: true }); });
app.get("/api/auth/me", requireAuth, async (req, res) => { const r = await query(`SELECT ${safeUser} FROM users WHERE id=$1`, [req.user.id]); ok(res, { user: r.rows[0] }); });
app.post("/api/profile", requireAuth, async(req,res)=>{const name=clean(req.body?.name),requestedUsername=clean(req.body?.username),email=clean(req.body?.email),phone=clean(req.body?.phone);if(!name||!email)return ok(res,{error:'Name and email are required.'},400);try{const current=await query("SELECT username,role FROM users WHERE id=$1",[req.user.id]);if(!current.rows[0])return ok(res,{error:'Account not found.'},404);const username=current.rows[0].role==='student'?current.rows[0].username:requestedUsername;if(!username)return ok(res,{error:'Username is required.'},400);const r=await query("UPDATE users SET name=$1,username=$2,email=$3,phone=$4 WHERE id=$5 RETURNING id,name,username,email,phone,role",[name,username,email,phone||null,req.user.id]);ok(res,{user:r.rows[0]});}catch(e){if(e.code==='23505')return ok(res,{error:'Username, email or phone already exists.'},409);throw e;}});
app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  const current = String(req.body?.currentPassword ?? ""), next = String(req.body?.newPassword ?? "");
  if (next.length < 8) return ok(res, { error: "New password must be at least 8 characters." }, 400);
  const r = await query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
  if (!r.rows[0] || !(await bcrypt.compare(current, r.rows[0].password_hash))) return ok(res, { error: "Current password is incorrect." }, 401);
  await query("UPDATE users SET password_hash=$1 WHERE id=$2", [await bcrypt.hash(next, 12), req.user.id]);
  ok(res, { ok: true, message: "Password changed successfully." });
});

app.post("/api/registration", privateDocumentUpload.single("reportCard"), async (req, res) => {
  const client = await import("./src/db.js").then(m => m.pool.connect());
  try {
    const b = Object.fromEntries(Object.entries(req.body || {}).map(([k,v]) => [k, clean(v)]));
    const required = ["studentName","fatherName","grandfatherName","email","gender","fanNumber","familyFanNumber","familyPhone","disabilityStatus","phone","region","townCity","woreda","school","pastClassResult","grade"];
    if (required.some(k => !b[k])) return ok(res, { error: "Please complete all required fields." }, 400);
    if (![b.studentName,b.fatherName,b.grandfatherName].every(validName)) return ok(res, { error: "Names may contain letters, spaces, apostrophes and hyphens only." }, 400);
    b.studentName = titleCaseName(b.studentName); b.fatherName = titleCaseName(b.fatherName); b.grandfatherName = titleCaseName(b.grandfatherName);
    if (!validEmail(b.email)) return ok(res, { error: "Enter a valid email address." }, 400);
    if (!validPhone(b.phone) || !validPhone(b.familyPhone)) return ok(res, { error: "Enter valid student and family phone numbers." }, 400);
    if (!/^\d{16}$/.test(b.fanNumber) || !/^\d{16}$/.test(b.familyFanNumber)) return ok(res, { error: "Student and family FAN numbers must each be exactly 16 digits." }, 400);
    if (!ETHIOPIA_REGIONS.includes(b.region)) return ok(res, { error: "Select a valid Ethiopian region." }, 400);
    if (!(ETHIOPIA_WOREDAS[b.region] || []).includes(b.woreda)) return ok(res, { error: "Select a woreda from the selected region." }, 400);
    const grade = Number(b.grade);
    if (![9,10,11,12].includes(grade)) return ok(res, { error: "Grade must be 9–12." }, 400);
    if ([11,12].includes(grade) && !b.stream) return ok(res, { error: "Stream is required for grades 11 and 12." }, 400);
    const pastResult = Number(b.pastClassResult);
    if (!Number.isFinite(pastResult) || pastResult < 50 || pastResult > 100) return ok(res, { error: "You have not passed. A past class result of 50 or above is required to submit this application." }, 400);
    if (grade === 9 && !req.file) return ok(res, { error: "Grade 8 report card is required for grade 9." }, 400);
    if (req.file && req.file.size > 10 * 1024 * 1024) return ok(res, { error: "Report card is too large." }, 400);

    const existing = await query("SELECT id FROM users WHERE email=$1 OR phone=$2", [b.email, b.phone]);
    if (existing.rows.length) return ok(res, { error: "Email or phone is already registered." }, 409);
    const fan = await query("SELECT id FROM students WHERE fan_number IN ($1,$2) OR family_fan_number IN ($1,$2)", [b.fanNumber,b.familyFanNumber]);
    if (fan.rows.length) return ok(res, { error: "FAN number is already registered." }, 409);

    await client.query("BEGIN");
    const pendingPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    const user = await client.query(`INSERT INTO users(name,username,email,phone,password_hash,role) VALUES($1,NULL,$2,$3,$4,'student') RETURNING id,name,username,email,phone,role`, [b.studentName,b.email,b.phone,pendingPasswordHash]);
    const finalUsername = null;
    await client.query(`INSERT INTO students(user_id,father_name,grandfather_name,family_fan_number,family_phone,gender,fan_number,disability_status,region,town_city,woreda,previous_school,past_class_result,grade,stream,grade8_report_card,status,generated_password_encrypted) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending',NULL)`, [user.rows[0].id,b.fatherName,b.grandfatherName,b.familyFanNumber,b.familyPhone,b.gender,b.fanNumber,b.disabilityStatus,b.region,b.townCity,b.woreda,b.school,pastResult,grade,b.stream||null,req.file ? req.file.filename : null]);
    await client.query("INSERT INTO notifications(user_id,title,body) VALUES($1,$2,$3)",[user.rows[0].id,"Registration received","Your Kersa Secondary School application was received successfully. An administrator will review it and your status will appear in the portal."]);
    await client.query("COMMIT");
    ok(res, { message: "Registration submitted successfully.", username: finalUsername, status: "pending", note: "Your unique username and password will be created only after administrator approval." }, 201);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (req.file) await fs.promises.unlink(path.join(privateUploadDir, req.file.filename)).catch(() => {});
    console.error(e);
    if (e.code === "23505") return ok(res, { error: "Email, username, phone or FAN number is already registered." }, 409);
    ok(res, { error: "Registration failed. Please try again." }, 500);
  } finally { client.release(); }
});

app.post("/api/registration/status", async (req, res) => {
  const email = clean(req.body?.email), fanNumber = clean(req.body?.fanNumber);
  if (!validEmail(email) || !/^\d{16}$/.test(fanNumber)) return ok(res, { error: "Enter the registration email and exactly 16-digit FAN number." }, 400);
  const r = await query(`SELECT s.status,s.admin_reply,s.reviewed_at,s.generated_password_encrypted,u.name,u.username,u.email,s.grade,s.created_at FROM students s JOIN users u ON u.id=s.user_id WHERE u.email=$1 AND s.fan_number=$2`, [email, fanNumber]);
  if (!r.rows[0]) return ok(res, { error: "No registration was found with those details." }, 404);
  const registration = {...r.rows[0]};
  if (registration.status === 'approved') registration.generated_password = decryptCredential(registration.generated_password_encrypted);
  delete registration.generated_password_encrypted;
  ok(res, { registration });
});

app.get("/api/dashboard", requireAuth, async (req, res) => {
  const u = req.user;
  if (u.role === "student") {
    const s = await query(`SELECT u.id,u.name,u.username,u.email,u.phone,u.profile_picture,s.*, COALESCE((SELECT COUNT(*) FROM assignments a WHERE a.grade=s.grade),0)::int pending_assignments, COALESCE((SELECT ROUND(AVG(g.score),2) FROM grades g WHERE g.student_id=s.id),0) average, COALESCE((SELECT ROUND(100.0*SUM(CASE WHEN at.status='present' THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) FROM attendance at WHERE at.student_id=s.id),0) attendance FROM users u JOIN students s ON s.user_id=u.id WHERE u.id=$1`, [u.id]);
    const timetable = await query("SELECT day_name,period,subject,teacher FROM timetable WHERE grade=$1 ORDER BY id LIMIT 30", [s.rows[0]?.grade || 9]);
    const grades = await query("SELECT subject,score,term FROM grades WHERE student_id=$1 ORDER BY term,subject", [s.rows[0]?.id]);
    ok(res, { role:u.role, profile:s.rows[0], timetable:timetable.rows, grades:grades.rows });
  } else if (u.role === "teacher") {
    const [resources, assignments] = await Promise.all([query("SELECT * FROM resources WHERE uploaded_by=$1 ORDER BY created_at DESC LIMIT 20", [u.id]), query("SELECT * FROM assignments WHERE created_by=$1 ORDER BY due_date DESC LIMIT 20", [u.id])]);
    ok(res, { role:u.role, profile:u, resources:resources.rows, assignments:assignments.rows });
  } else if (u.role === "parent") {
    const c = await query(`SELECT s.id student_id,u.id user_id,u.name,s.grade,s.stream,s.status FROM parent_links p JOIN students s ON s.id=p.student_id JOIN users u ON u.id=s.user_id WHERE p.parent_id=$1 ORDER BY u.name`, [u.id]);
    ok(res, { role:u.role, profile:u, children:c.rows });
  } else {
    const [users,students,ann,resources,gallery,pending] = await Promise.all([query("SELECT COUNT(*)::int count FROM users"),query("SELECT COUNT(*)::int count FROM students"),query("SELECT COUNT(*)::int count FROM announcements"),query("SELECT COUNT(*)::int count FROM resources"),query("SELECT COUNT(*)::int count FROM gallery"),query("SELECT COUNT(*)::int count FROM students WHERE status='pending'")]);
    ok(res,{role:u.role,profile:u,stats:{users:users.rows[0].count,students:students.rows[0].count,announcements:ann.rows[0].count,resources:resources.rows[0].count,gallery:gallery.rows[0].count,pending:pending.rows[0].count}});
  }
});

app.get("/api/admin/students.csv", requireAuth, requireRole("admin"), async(req,res)=>{
  const r=await query(`SELECT s.id,u.name AS student_name,s.father_name,s.grandfather_name,u.email,s.gender,s.fan_number,s.family_fan_number,s.family_phone,s.disability_status,s.region,s.town_city,s.woreda,s.previous_school,s.past_class_result,s.grade,s.stream,s.status,s.admin_reply,u.phone,s.created_at FROM students s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC`);
  const headers=['ID','Student Name','Father Name','Grandfather Name','Email','Gender','FAN Number','Family FAN','Family Phone','Disability Status','Region','Town/City','Woreda','Previous School','Past Class Result','Grade','Stream','Status','Admin Reply','Student Phone','Registered At'];
  const escCsv=v=>{const s=String(v??'');return /[",\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s};
  const rows=r.rows.map(x=>[x.id,x.student_name,x.father_name,x.grandfather_name,x.email,x.gender,String(x.fan_number),String(x.family_fan_number),x.family_phone,x.disability_status,x.region,x.town_city,x.woreda,x.previous_school,x.past_class_result,x.grade,x.stream||'',x.status,x.admin_reply||'',x.phone||'',x.created_at].map(escCsv).join(','));
  const csv='\uFEFF'+headers.map(escCsv).join(',')+'\r\n'+rows.join('\r\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8'); res.setHeader('Content-Disposition','attachment; filename="Kersa-Student-Registrations.csv"'); res.send(csv);
});
app.get("/api/resources", requireAuth, async (_,res)=>ok(res,(await query("SELECT * FROM resources ORDER BY created_at DESC LIMIT 100")).rows));
app.post("/api/resources", requireAuth, requireRole("teacher","admin"), upload.single("file"), async (req,res)=>{if(!req.body.title||!req.file)return ok(res,{error:"Title and file are required."},400);const r=await query("INSERT INTO resources(title,grade,subject,file_url,uploaded_by) VALUES($1,$2,$3,$4,$5) RETURNING *",[clean(req.body.title),req.body.grade||null,clean(req.body.subject),`/uploads/${req.file.filename}`,req.user.id]);ok(res,r.rows[0],201);});
app.delete("/api/resources/:id", requireAuth, requireRole("admin"), async(req,res)=>{await query("DELETE FROM resources WHERE id=$1",[req.params.id]);ok(res,{ok:true});});

app.get("/api/announcements", async(_,res)=>ok(res,(await query("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50")).rows));
app.post("/api/announcements", requireAuth, requireRole("admin"), async(req,res)=>{if(!clean(req.body.title)||!clean(req.body.body))return ok(res,{error:"Title and body are required."},400);const r=await query("INSERT INTO announcements(title,body,created_by) VALUES($1,$2,$3) RETURNING *",[clean(req.body.title),clean(req.body.body),req.user.id]);ok(res,r.rows[0],201);});
app.delete("/api/announcements/:id", requireAuth, requireRole("admin"), async(req,res)=>{await query("DELETE FROM announcements WHERE id=$1",[req.params.id]);ok(res,{ok:true});});

app.get("/api/acknowledgment-media", async(_,res)=>ok(res,(await query("SELECT slot,title,image_url,uploaded_at FROM acknowledgment_media ORDER BY slot")).rows));
app.post("/api/admin/acknowledgment-media", requireAuth, requireRole("admin"), imageUpload.single("image"), async(req,res)=>{
  const slot=clean(req.body?.slot);const titles={allah:"My Almighty Allah",parents:"My Dad Desiye Buta & Mom Zebiba Tuna",safi:"Director Safi Abu",teachers:"Teacher Shimellis Haile & Teacher Ebrahim Geribe"};
  if(!titles[slot]||!req.file)return ok(res,{error:"Choose a valid acknowledgment section and image."},400);
  try{const exists=await query("SELECT 1 FROM acknowledgment_media WHERE slot=$1",[slot]);if(exists.rows.length){await fs.promises.unlink(path.join(uploadDir,req.file.filename)).catch(()=>{});return ok(res,{error:"This acknowledgment image is permanently locked and cannot be replaced or edited."},409);}const r=await query("INSERT INTO acknowledgment_media(slot,title,image_url,uploaded_by) VALUES($1,$2,$3,$4) RETURNING slot,title,image_url,uploaded_at",[slot,titles[slot],`/uploads/${req.file.filename}`,req.user.id]);ok(res,r.rows[0],201);}catch(e){await fs.promises.unlink(path.join(uploadDir,req.file.filename)).catch(()=>{});if(e.code==='23505')return ok(res,{error:"This acknowledgment image is already locked and cannot be replaced."},409);throw e;}});

app.get("/api/gallery", async(_,res)=>ok(res,(await query("SELECT * FROM gallery ORDER BY created_at DESC LIMIT 100")).rows));
app.post("/api/gallery", requireAuth, requireRole("admin"), imageUpload.single("image"), async(req,res)=>{if(!clean(req.body.title)||!req.file)return ok(res,{error:"Title and image are required."},400);const r=await query("INSERT INTO gallery(title,image_url,uploaded_by) VALUES($1,$2,$3) RETURNING *",[clean(req.body.title),`/uploads/${req.file.filename}`,req.user.id]);ok(res,r.rows[0],201);});
app.delete("/api/gallery/:id", requireAuth, requireRole("admin"), async(req,res)=>{await query("DELETE FROM gallery WHERE id=$1",[req.params.id]);ok(res,{ok:true});});

app.get("/api/messages", requireAuth, async(req,res)=>ok(res,(await query(`SELECT m.*,su.name sender_name,su.role sender_role,ru.name receiver_name,ru.role receiver_role FROM messages m JOIN users su ON su.id=m.sender_id JOIN users ru ON ru.id=m.receiver_id WHERE m.sender_id=$1 OR m.receiver_id=$1 ORDER BY m.created_at ASC LIMIT 500`,[req.user.id])).rows));
app.post("/api/messages", requireAuth, async(req,res)=>{
  const receiverId=Number(req.body?.receiverId); const subject=clean(req.body?.subject).slice(0,160); const moderation=moderateMessage(req.body?.body);
  if(!receiverId||!moderation.ok)return ok(res,{error:moderation.error||"Recipient and message are required."},400);
  if(receiverId===req.user.id)return ok(res,{error:"You cannot message yourself."},400);
  const target=await query("SELECT id,role FROM users WHERE id=$1",[receiverId]);
  if(!target.rows[0])return ok(res,{error:"Recipient not found."},404);
  const allowed=(req.user.role==='student'&&['teacher','admin'].includes(target.rows[0].role))||
    (req.user.role==='teacher'&&['student','parent','teacher','admin'].includes(target.rows[0].role))||
    (req.user.role==='parent'&&['teacher','admin'].includes(target.rows[0].role))||
    (req.user.role==='admin'&&['student','teacher','parent','admin'].includes(target.rows[0].role));
  if(!allowed)return ok(res,{error:"Messaging is restricted to appropriate school communication roles."},403);
  const r=await query("INSERT INTO messages(sender_id,receiver_id,subject,body) VALUES($1,$2,$3,$4) RETURNING *",[req.user.id,receiverId,subject||null,moderation.body]); await query("INSERT INTO notifications(user_id,title,body) VALUES($1,$2,$3)",[receiverId,subject?`New message: ${subject}`:"New school message",`You received a new message from ${req.user.name||"a school user"}.`]); ok(res,r.rows[0],201);
});
app.get("/api/contacts", requireAuth, async(req,res)=>ok(res,(await query("SELECT id,name,username,role FROM users WHERE id<>$1 ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'teacher' THEN 2 WHEN 'parent' THEN 3 ELSE 4 END,name",[req.user.id])).rows));

app.post("/api/contact", async(req,res)=>{const b=req.body||{};if(!clean(b.name)||!validEmail(clean(b.email))||!clean(b.subject)||!clean(b.message))return ok(res,{error:"Name, valid email, subject and message are required."},400);const r=await query("INSERT INTO contact_messages(name,email,phone,subject,message) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at",[clean(b.name),clean(b.email),clean(b.phone),clean(b.subject),clean(b.message)]);ok(res,{ok:true,id:r.rows[0].id,created_at:r.rows[0].created_at},201);});

app.get("/api/teacher/gradebook", requireAuth, requireRole("teacher","admin"), async(_,res)=>ok(res,(await query(`SELECT s.id student_id,u.name student_name,s.grade,s.stream,g.subject,g.score,g.term FROM students s JOIN users u ON u.id=s.user_id LEFT JOIN grades g ON g.student_id=s.id ORDER BY s.grade,u.name,g.subject`)).rows));
app.post("/api/teacher/grades", requireAuth, requireRole("teacher","admin"), async(req,res)=>{const studentId=Number(req.body?.studentId),subject=clean(req.body?.subject),score=Number(req.body?.score),term=clean(req.body?.term)||"Term 1";if(!studentId||!subject||Number.isNaN(score)||score<0||score>100)return ok(res,{error:"Valid student, subject and score (0–100) are required."},400);const student=await query("SELECT id FROM students WHERE id=$1 AND status='approved'",[studentId]);if(!student.rows[0])return ok(res,{error:"Only an approved student can receive a grade."},404);const r=await query(`INSERT INTO grades(student_id,subject,score,term,teacher_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(student_id,subject,term) DO UPDATE SET score=EXCLUDED.score,teacher_id=EXCLUDED.teacher_id RETURNING *`,[studentId,subject,score,term,req.user.id]);ok(res,r.rows[0],201);});

app.get("/api/admin/students", requireAuth, requireRole("admin"), async(_,res)=>ok(res,(await query(`SELECT s.*,u.name,u.username,u.email,u.phone,u.created_at FROM students s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC`)).rows));
app.patch("/api/admin/students/:id", requireAuth, requireRole("admin"), async(req,res)=>{
  const id=Number(req.params.id), status=clean(req.body?.status);
  if(status && !["pending","approved","rejected"].includes(status)) return ok(res,{error:"Invalid registration status."},400);
  let safeAdminReply;
  if(req.body.adminReply!==undefined){const mod=moderateMessage(req.body.adminReply);if(!mod.ok)return ok(res,{error:mod.error},400);safeAdminReply=mod.body;}
  const client=await import("./src/db.js").then(m=>m.pool.connect());
  try{await client.query("BEGIN");
    const current=await client.query("SELECT s.*,u.id user_id,u.name,u.username FROM students s JOIN users u ON u.id=s.user_id WHERE s.id=$1 FOR UPDATE",[id]);
    if(!current.rows[0]){await client.query("ROLLBACK");return ok(res,{error:"Registration not found."},404);}
    if(status==='approved' && current.rows[0].status==='approved'){await client.query("ROLLBACK");return ok(res,{error:"This registration is already approved. The existing credentials remain unchanged."},409);}
    const sets=[],vals=[];
    for(const f of ["grade","stream","disability_status","region","town_city","woreda","previous_school"]){if(req.body[f]!==undefined){sets.push(`${f}=$${vals.length+1}`);vals.push(clean(req.body[f]));}}
    if(req.body.adminReply!==undefined){sets.push(`admin_reply=$${vals.length+1}`);vals.push(safeAdminReply);}
    let credentials=null;
    if(status){sets.push(`status=$${vals.length+1}`);vals.push(status);sets.push(`reviewed_at=NOW()`);sets.push(`reviewed_by=$${vals.length+1}`);vals.push(req.user.id);}
    if(status==='approved'){
      let username=current.rows[0].username;
      if(!username){const base=generateStudentUsername(current.rows[0].name,current.rows[0].fan_number);username=base;for(let i=2;;i++){const t=await client.query("SELECT 1 FROM users WHERE username=$1",[username]);if(!t.rows.length)break;username=`${base}.${i}`;}}
      const password=generateStudentPassword();
      sets.push(`generated_password_encrypted=$${vals.length+1}`);vals.push(encryptCredential(password));
      await client.query("UPDATE users SET username=$1,password_hash=$2 WHERE id=$3",[username,bcrypt.hashSync(password,12),current.rows[0].user_id]);
      credentials={username,password};
    }else if(status==='rejected'){
      sets.push(`generated_password_encrypted=NULL`);
      await client.query("UPDATE users SET username=NULL,password_hash=$1 WHERE id=$2",[bcrypt.hashSync(crypto.randomBytes(32).toString('hex'),12),current.rows[0].user_id]);
    }
    if(!sets.length){await client.query("ROLLBACK");return ok(res,{error:"Nothing to update."},400);}
    vals.push(id);
    const r=await client.query(`UPDATE students SET ${sets.join(",")} WHERE id=$${vals.length} RETURNING *`,vals);
    if(status){const reply=clean(req.body.adminReply)||`Your registration was ${status}.`;await client.query("INSERT INTO notifications(user_id,title,body) VALUES($1,$2,$3)",[current.rows[0].user_id,`Registration ${status}`,status==='approved'?`${reply} Your unique username and password have been generated. Check your registration status for the credentials.`:reply]);}
    await client.query("COMMIT");ok(res,{...r.rows[0],credentials});
  }catch(e){await client.query("ROLLBACK").catch(()=>{});console.error(e);if(e.code==='23505')return ok(res,{error:"Could not create a unique username. Please try approval again."},409);return ok(res,{error:"Registration update failed."},500);}finally{client.release();}
});
app.get("/api/admin/students/:id/report-card", requireAuth, requireRole("admin"), async(req,res)=>{
  const r=await query("SELECT grade8_report_card FROM students WHERE id=$1",[req.params.id]);
  const filename=r.rows[0]?.grade8_report_card;
  if(!filename)return res.status(404).send("Report card not found");
  const safeFilename=path.basename(filename);
  const filePath=path.join(privateUploadDir,safeFilename);
  if(!fs.existsSync(filePath))return res.status(404).send("Report card file is unavailable");
  res.sendFile(filePath);
});

app.get("/api/admin/students/:id/print", requireAuth, requireRole("admin"), async(req,res)=>{
  const r=await query(`SELECT s.*,u.name,u.username,u.email,u.phone,u.created_at FROM students s JOIN users u ON u.id=s.user_id WHERE s.id=$1`,[req.params.id]);
  if(!r.rows[0])return res.status(404).send("Registration not found");
  const x=r.rows[0];
  const escHtml=v=>String(v??"").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>Kersa Student Registration - ${escHtml(x.name)}</title><style>body{font-family:Arial,sans-serif;margin:40px;color:#111}h1{text-align:center;color:#163a70}table{width:100%;border-collapse:collapse;margin-top:24px}td{border:1px solid #bbb;padding:10px}td:first-child{font-weight:700;width:30%;background:#f4f6f9}.sig{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin-top:80px}.line{border-top:1px solid #111;padding-top:8px}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print / Save as PDF</button><h1>Kersa Secondary School</h1><h2>Student Registration Form</h2><table>${[["Student name",x.name],["Username",x.username],["Father's name",x.father_name],["Grandfather's name",x.grandfather_name],["Family FAN number",x.family_fan_number||"—"],["Family phone",x.family_phone||"—"],["Email",x.email],["Phone",x.phone],["Gender",x.gender],["FAN number",x.fan_number],["Disability status",x.disability_status],["Region",x.region],["Town/City",x.town_city],["Woreda",x.woreda],["Previous school",x.previous_school],["Past class result",x.past_class_result+"%"],["Grade",x.grade],["Stream",x.stream||"—"],["Status",x.status],["Admin reply",x.admin_reply||"—"],["Submitted",new Date(x.created_at).toLocaleString()]].map(([a,b])=>`<tr><td>${escHtml(a)}</td><td>${escHtml(b)}</td></tr>`).join("")}</table><div class="sig"><div class="line">Administrator signature</div><div class="line">Student/Parent signature</div></div></body></html>`);
});

app.get("/api/admin/users", requireAuth, requireRole("admin"), async(_,res)=>ok(res,(await query(`SELECT ${safeUser} FROM users ORDER BY created_at DESC`)).rows));
app.post("/api/admin/users", requireAuth, requireRole("admin"), async(req,res)=>{const name=clean(req.body?.name),username=clean(req.body?.username),email=clean(req.body?.email),phone=clean(req.body?.phone),password=String(req.body?.password||""),role=clean(req.body?.role);if(!name||!email||!password||!username||!['teacher','parent','admin'].includes(role))return ok(res,{error:"Name, username, email, password and a valid role are required."},400);if(password.length<8)return ok(res,{error:"Password must be at least 8 characters."},400);try{const r=await query(`INSERT INTO users(name,username,email,phone,password_hash,role) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${safeUser}`,[name,username,email,phone||null,bcrypt.hashSync(password,12),role]);ok(res,r.rows[0],201);}catch(e){if(e.code==='23505')return ok(res,{error:'Username, email or phone already exists.'},409);throw e;}});
app.patch("/api/admin/users/:id", requireAuth, requireRole("admin"), async(req,res)=>{const id=Number(req.params.id);if(id===req.user.id&&req.body?.role&&req.body.role!=='admin')return ok(res,{error:"You cannot remove your own administrator role."},400);const {name,username,email,phone,role}=req.body||{};if(role&&!['student','teacher','parent','admin'].includes(role))return ok(res,{error:'Invalid role.'},400);const r=await query(`UPDATE users SET name=COALESCE($1,name),username=COALESCE($2,username),email=COALESCE($3,email),phone=COALESCE($4,phone),role=COALESCE($5,role) WHERE id=$6 RETURNING ${safeUser}`,[name,username,email,phone,role,id]);ok(res,r.rows[0]||{},r.rows[0]?200:404);});
app.delete("/api/admin/users/:id", requireAuth, requireRole("admin"), async(req,res)=>{if(Number(req.params.id)===req.user.id)return ok(res,{error:"You cannot delete your own account."},400);await query("DELETE FROM users WHERE id=$1",[req.params.id]);ok(res,{ok:true});});
app.post("/api/admin/users/:id/password", requireAuth, requireRole("admin"), async(req,res)=>{const password=String(req.body?.password||"");if(password.length<8)return ok(res,{error:'Password must be at least 8 characters.'},400);await query("UPDATE users SET password_hash=$1 WHERE id=$2",[bcrypt.hashSync(password,12),req.params.id]);ok(res,{ok:true});});

app.post("/api/admin/parent-links", requireAuth, requireRole("admin"), async(req,res)=>{const {parentId,studentId,relationship}=req.body||{};if(!parentId||!studentId)return ok(res,{error:"Parent and student are required."},400);const r=await query(`INSERT INTO parent_links(parent_id,student_id,relationship) VALUES($1,$2,$3) ON CONFLICT(parent_id,student_id) DO UPDATE SET relationship=EXCLUDED.relationship RETURNING *`,[parentId,studentId,clean(relationship)||'Parent']);ok(res,r.rows[0],201);});
app.delete("/api/admin/parent-links/:id", requireAuth, requireRole("admin"), async(req,res)=>{await query("DELETE FROM parent_links WHERE id=$1",[req.params.id]);ok(res,{ok:true});});

app.get("/api/admin/contacts", requireAuth, requireRole("admin"), async(_,res)=>ok(res,(await query("SELECT * FROM contact_messages ORDER BY created_at DESC")).rows));
app.patch("/api/admin/contacts/:id", requireAuth, requireRole("admin"), async(req,res)=>{const status=clean(req.body?.status)||'new';if(!['new','read','resolved'].includes(status))return ok(res,{error:'Invalid status.'},400);const r=await query("UPDATE contact_messages SET status=$1 WHERE id=$2 RETURNING *",[status,req.params.id]);ok(res,r.rows[0]||{},r.rows[0]?200:404);});
app.get("/api/admin/settings", requireAuth, requireRole("admin"), async(_,res)=>ok(res,await settings()));
app.post("/api/admin/logo", requireAuth, requireRole("admin"), imageUpload.single("logo"), async(req,res)=>{if(!req.file)return ok(res,{error:"Logo image is required."},400);const url=`/uploads/${req.file.filename}`;await query("UPDATE site_settings SET logo_url=$1,updated_at=NOW() WHERE id=1",[url]);ok(res,{logo_url:url});});
app.post("/api/admin/settings", requireAuth, requireRole("admin"), async(req,res)=>{const schoolName=clean(req.body?.schoolName);if(!schoolName)return ok(res,{error:'School name is required.'},400);const r=await query("UPDATE site_settings SET school_name=$1,updated_at=NOW() WHERE id=1 RETURNING *",[schoolName]);ok(res,r.rows[0]);});
app.post("/api/admin/profile", requireAuth, requireRole("admin"), async(req,res)=>{const name=clean(req.body?.name),username=clean(req.body?.username),email=clean(req.body?.email),phone=clean(req.body?.phone);if(!name||!username||!email)return ok(res,{error:'Name, username and email are required.'},400);try{const r=await query("UPDATE users SET name=$1,username=$2,email=$3,phone=$4 WHERE id=$5 RETURNING id,name,username,email,phone,role",[name,username,email,phone||null,req.user.id]);ok(res,{user:r.rows[0]});}catch(e){if(e.code==='23505')return ok(res,{error:'Username, email or phone already exists.'},409);throw e;}});

app.post("/api/reactions", requireAuth, async(req,res)=>{const {itemType,itemId,reaction}=req.body||{};if(!itemType||!itemId||!reaction)return ok(res,{error:"Reaction data required."},400);const r=await query(`INSERT INTO reactions(user_id,item_type,item_id,reaction) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,item_type,item_id) DO UPDATE SET reaction=EXCLUDED.reaction RETURNING *`,[req.user.id,itemType,itemId,reaction]);ok(res,r.rows[0]);});

app.get("/api/notifications", requireAuth, async(req,res)=>{const r=await query("SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",[req.user.id]);ok(res,r.rows);});
app.patch("/api/notifications/:id/read", requireAuth, async(req,res)=>{await query("UPDATE notifications SET read_at=NOW() WHERE id=$1 AND user_id=$2",[req.params.id,req.user.id]);ok(res,{ok:true});});

app.post("/api/ai/chat", requireAuth, async(req,res)=>{const key=process.env.OPENAI_API_KEY;if(!key)return ok(res,{error:"Kersa AI is not configured yet. Add OPENAI_API_KEY to .env and restart the server."},503);const message=clean(req.body?.message);if(!message)return ok(res,{error:"Ask Kersa AI a question."},400);try{const response=await fetch("https://api.openai.com/v1/responses",{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5.6-luna',input:`You are Kersa AI, the helpful learning assistant for Kersa Secondary School in Ethiopia. Answer clearly and safely for students, teachers and parents. Prefer simple English, Afaan Oromo or Amharic when the user writes in those languages. Never invent school records. User question: ${message}`})});const data=await response.json();if(!response.ok)return ok(res,{error:data.error?.message||'AI request failed.'},response.status);ok(res,{answer:data.output_text||data.output?.flatMap(x=>x.content||[]).map(x=>x.text||'').join('')||'No answer returned.'});}catch(e){ok(res,{error:'Kersa AI connection failed. Please try again.'},502);}});

app.get("/api/meetings", requireAuth, async(_,res)=>ok(res,(await query(`SELECT m.*,u.name creator_name FROM meetings m LEFT JOIN users u ON u.id=m.created_by ORDER BY m.starts_at DESC LIMIT 50`)).rows));
app.post("/api/meetings", requireAuth, requireRole("teacher","admin"), async(req,res)=>{const title=clean(req.body?.title);if(!title||title.length>200)return ok(res,{error:'Meeting title is required and must be 200 characters or fewer.'},400);const code=`KERSA-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;const r=await query(`INSERT INTO meetings(title,room_code,created_by,mode) VALUES($1,$2,$3,'hybrid') RETURNING *`,[title,code,req.user.id]);ok(res,r.rows[0],201);});
app.post("/api/meetings/:id/join", requireAuth, async(req,res)=>{const m=await query("SELECT id FROM meetings WHERE id=$1",[req.params.id]);if(!m.rows[0])return ok(res,{error:"Meeting not found."},404);const r=await query(`INSERT INTO meeting_participants(meeting_id,user_id,last_seen) VALUES($1,$2,NOW()) ON CONFLICT(meeting_id,user_id) DO UPDATE SET last_seen=NOW() RETURNING *`,[req.params.id,req.user.id]);ok(res,r.rows[0]);});
app.post("/api/meetings/:id/leave", requireAuth, async(req,res)=>{await query("DELETE FROM meeting_participants WHERE meeting_id=$1 AND user_id=$2",[req.params.id,req.user.id]);ok(res,{ok:true});});
app.get("/api/meetings/:id/participants", requireAuth, async(req,res)=>{if(!(await isMeetingParticipant(req.params.id,req.user.id)))return ok(res,{error:'Join the meeting first.'},403);await query("UPDATE meeting_participants SET last_seen=NOW() WHERE meeting_id=$1 AND user_id=$2",[req.params.id,req.user.id]);const r=await query(`SELECT mp.user_id,u.name,u.role FROM meeting_participants mp JOIN users u ON u.id=mp.user_id WHERE mp.meeting_id=$1 AND mp.last_seen>NOW()-INTERVAL '45 seconds' ORDER BY mp.user_id`,[req.params.id]);ok(res,r.rows);});
app.get("/api/meetings/:id/messages", requireAuth, async(req,res)=>{if(!(await isMeetingParticipant(req.params.id,req.user.id)))return ok(res,{error:'Join the meeting first.'},403);ok(res,(await query(`SELECT mm.*,u.name sender_name,u.role sender_role FROM meeting_messages mm JOIN users u ON u.id=mm.sender_id WHERE mm.meeting_id=$1 ORDER BY mm.created_at ASC LIMIT 500`,[req.params.id])).rows)});
app.post("/api/meetings/:id/messages", requireAuth, async(req,res)=>{if(!(await isMeetingParticipant(req.params.id,req.user.id)))return ok(res,{error:'Join the meeting before sending messages.'},403);const mod=moderateMessage(req.body?.body);if(!mod.ok)return ok(res,{error:mod.error},400);const meeting=await query("SELECT id FROM meetings WHERE id=$1",[req.params.id]);if(!meeting.rows[0])return ok(res,{error:'Meeting not found.'},404);const r=await query(`INSERT INTO meeting_messages(meeting_id,sender_id,body) VALUES($1,$2,$3) RETURNING *`,[req.params.id,req.user.id,mod.body]); const participants=await query("SELECT user_id FROM meeting_participants WHERE meeting_id=$1 AND user_id<>$2",[req.params.id,req.user.id]); for(const p of participants.rows){await query("INSERT INTO notifications(user_id,title,body) VALUES($1,$2,$3)",[p.user_id,"New meeting message",`A participant sent a new message in your meeting.`]);} ok(res,r.rows[0],201);});
app.get("/api/meetings/:id/signals", requireAuth, async(req,res)=>{if(!(await isMeetingParticipant(req.params.id,req.user.id)))return ok(res,{error:'Join the meeting first.'},403);const since=Number(req.query.since||0);const r=await query(`SELECT id,sender_id,receiver_id,type,payload,created_at FROM meeting_signals WHERE meeting_id=$1 AND id>$2 AND (receiver_id IS NULL OR receiver_id=$3) ORDER BY id ASC LIMIT 100`,[req.params.id,since,req.user.id]);ok(res,r.rows);});
app.post("/api/meetings/:id/signals", requireAuth, async(req,res)=>{if(!(await isMeetingParticipant(req.params.id,req.user.id)))return ok(res,{error:'Join the meeting first.'},403);const type=clean(req.body?.type),payload=req.body?.payload,receiverId=req.body?.receiverId?Number(req.body.receiverId):null;if(!['offer','answer','ice','leave'].includes(type)||!payload)return ok(res,{error:'Invalid meeting signal.'},400);const meeting=await query('SELECT id FROM meetings WHERE id=$1',[req.params.id]);if(!meeting.rows[0])return ok(res,{error:'Meeting not found.'},404);if(receiverId&&!(await isMeetingParticipant(req.params.id,receiverId)))return ok(res,{error:'Recipient is not in this meeting.'},400);const r=await query(`INSERT INTO meeting_signals(meeting_id,sender_id,receiver_id,type,payload) VALUES($1,$2,$3,$4,$5) RETURNING id`,[req.params.id,req.user.id,receiverId,type,JSON.stringify(payload)]);ok(res,r.rows[0],201);});
app.delete("/api/meetings/:id", requireAuth, requireRole("admin"), async(req,res)=>{await query("DELETE FROM meetings WHERE id=$1",[req.params.id]);ok(res,{ok:true});});

app.get("/api/admin/summary", requireAuth, requireRole("admin"), async(_,res)=>{const [u,s,g,r,ga,c,m,a,e,p]=await Promise.all([query("SELECT COUNT(*)::int n FROM users"),query("SELECT COUNT(*)::int n FROM students"),query("SELECT COUNT(*)::int n FROM grades"),query("SELECT COUNT(*)::int n FROM resources"),query("SELECT COUNT(*)::int n FROM gallery"),query("SELECT COUNT(*)::int n FROM contact_messages WHERE status='new'"),query("SELECT COUNT(*)::int n FROM messages"),query("SELECT COUNT(*)::int n FROM announcements"),query("SELECT COUNT(*)::int n FROM meetings"),query("SELECT COUNT(*)::int n FROM students WHERE status='pending'")]);ok(res,{users:u.rows[0].n,students:s.rows[0].n,grades:g.rows[0].n,resources:r.rows[0].n,gallery:ga.rows[0].n,newContacts:c.rows[0].n,messages:m.rows[0].n,announcements:a.rows[0].n,meetings:e.rows[0].n,pending:p.rows[0].n});});
app.get("/api/admin/events", requireAuth, requireRole("admin"), async(_,res)=>ok(res,(await query("SELECT * FROM events ORDER BY event_date ASC")).rows));
app.post("/api/admin/events", requireAuth, requireRole("admin"), async(req,res)=>{if(!clean(req.body?.title)||!clean(req.body?.eventDate))return ok(res,{error:'Title and event date are required.'},400);const r=await query("INSERT INTO events(title,event_date,description) VALUES($1,$2,$3) RETURNING *",[clean(req.body.title),req.body.eventDate,clean(req.body.description)||null]);ok(res,r.rows[0],201);});
app.delete("/api/admin/events/:id", requireAuth, requireRole("admin"), async(req,res)=>{await query("DELETE FROM events WHERE id=$1",[req.params.id]);ok(res,{ok:true});});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return ok(res, { error: err.code === "LIMIT_FILE_SIZE" ? "The uploaded file is too large." : `Upload error: ${err.code}` }, 400);
  if (err) return ok(res, { error: err.message || "Request failed." }, 400);
  next();
});

app.listen(PORT, () => console.log(`Kersa portal running at http://localhost:${PORT}`));
