// ===== منصة تحصيلي بلس — خادم كامل بدون أي حزم خارجية =====
import http from 'node:http';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
// يخدم الواجهة من مجلد public إن وُجد، وإلا من جذر المشروع (للنشر المسطّح)
const PUBLIC = existsSync(join(__dirname, 'public', 'index.html')) ? join(__dirname, 'public') : __dirname;
const DENY = new Set(['server.js', 'dockerfile', 'package.json', 'package-lock.json', '.dockerignore', '.gitignore', 'readme.md']);

/* ============ قاعدة البيانات (مدمجة — لا ملف منفصل، لتفادي عدم التطابق) ============ */
const DATA_DIR = process.env.TH_DATA || join(__dirname, 'data');
const UPLOADS = process.env.TH_UPLOADS || join(DATA_DIR, 'uploads');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(UPLOADS)) mkdirSync(UPLOADS, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, 'app.db'));

function hashPw(p) { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(p, salt, 64).toString('hex'); }
function verifyPw(p, stored) { try { const [salt, h] = stored.split(':'); return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(crypto.scryptSync(p, salt, 64).toString('hex'))); } catch { return false; } }

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT 'student', xp INTEGER DEFAULT 0, streak INTEGER DEFAULT 0, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, options TEXT NOT NULL, answer INTEGER NOT NULL, subject TEXT NOT NULL, year TEXT, level TEXT, explanation TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, filename TEXT NOT NULL, subject TEXT, section TEXT, downloads INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS results(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, exam_name TEXT, score INTEGER, total INTEGER, duration TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS lessons(id INTEGER PRIMARY KEY AUTOINCREMENT, section TEXT NOT NULL, subject TEXT NOT NULL, grade TEXT NOT NULL, title TEXT NOT NULL, video_url TEXT, ord INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS topic_names(id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT, grade TEXT, name TEXT, created_at TEXT DEFAULT (datetime('now')), UNIQUE(subject,grade,name));
CREATE TABLE IF NOT EXISTS codes(code TEXT PRIMARY KEY, used INTEGER DEFAULT 0, used_by INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS progress(user_id INTEGER, lesson_id INTEGER, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id,lesson_id));
CREATE TABLE IF NOT EXISTS mistakes(user_id INTEGER, question_id INTEGER, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id,question_id));
CREATE TABLE IF NOT EXISTS favorites(user_id INTEGER, question_id INTEGER, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id,question_id));
CREATE TABLE IF NOT EXISTS notes(user_id INTEGER, question_id INTEGER, text TEXT, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id,question_id));
CREATE TABLE IF NOT EXISTS points_log(user_id INTEGER, points INTEGER, reason TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS activity_log(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, action TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS daily_answers(user_id INTEGER, day TEXT, question_id INTEGER, correct INTEGER, UNIQUE(user_id,day));
CREATE TABLE IF NOT EXISTS ratings(user_id INTEGER, question_id INTEGER, difficulty INTEGER, UNIQUE(user_id,question_id));
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, question_id INTEGER, reason TEXT, status TEXT DEFAULT 'open', created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS flashcards(id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT, grade TEXT, front TEXT, back TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS summaries(id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT, title TEXT, content TEXT, created_at TEXT DEFAULT (datetime('now')));
`);

// أكواد تفعيل جاهزة (10 أكواد) — تُزرع مرة واحدة
const FIKR_CODES = ['FIKR-4821', 'FIKR-9356', 'FIKR-1740', 'FIKR-6293', 'FIKR-5108', 'FIKR-8472', 'FIKR-3625', 'FIKR-7019', 'FIKR-2584', 'FIKR-9930'];
if (db.prepare('SELECT COUNT(*) c FROM codes').get().c === 0) {
  const insC = db.prepare('INSERT OR IGNORE INTO codes(code) VALUES(?)');
  for (const c of FIKR_CODES) insC.run(c);
}
// ترقيات تلقائية (تتجاهل الخطأ لو العمود موجود) — تضمن تطابق الأعمدة دائماً
for (const stmt of [
  'ALTER TABLE users ADD COLUMN last_login TEXT',
  'ALTER TABLE questions ADD COLUMN topic TEXT',
  'ALTER TABLE questions ADD COLUMN grade TEXT',
  'ALTER TABLE files ADD COLUMN url TEXT',
  'ALTER TABLE topic_names ADD COLUMN subject TEXT',
  'ALTER TABLE topic_names ADD COLUMN grade TEXT',
  'ALTER TABLE users ADD COLUMN phone TEXT',
  'ALTER TABLE users ADD COLUMN country TEXT',
  'ALTER TABLE users ADD COLUMN study_minutes INTEGER DEFAULT 0',
  'ALTER TABLE users ADD COLUMN subject TEXT',
  'ALTER TABLE mistakes ADD COLUMN due_at TEXT',
  'ALTER TABLE mistakes ADD COLUMN reps INTEGER DEFAULT 0',
  'ALTER TABLE users ADD COLUMN goal INTEGER',
  'ALTER TABLE users ADD COLUMN streak_freezes INTEGER DEFAULT 0',
  'ALTER TABLE users ADD COLUMN theme TEXT',
  'ALTER TABLE users ADD COLUMN city TEXT',
  'ALTER TABLE users ADD COLUMN school TEXT',
  'ALTER TABLE users ADD COLUMN region TEXT',
  'ALTER TABLE users ADD COLUMN parent_code TEXT',
  'ALTER TABLE questions ADD COLUMN chapter TEXT',
  'ALTER TABLE questions ADD COLUMN type TEXT',        // 'mcq' | 'tf'
  'ALTER TABLE questions ADD COLUMN image_url TEXT',   // صورة السؤال
  'ALTER TABLE questions ADD COLUMN opt_images TEXT',  // صور الخيارات (JSON)
  'ALTER TABLE users ADD COLUMN trial_start TEXT',     // بداية التجربة المجانية
  'ALTER TABLE users ADD COLUMN subscribed INTEGER DEFAULT 0', // مشترك مدفوع
]) { try { db.exec(stmt); } catch (e) {} }
// فهارس للأداء مع عشرات الآلاف من الأسئلة
try { db.exec('CREATE INDEX IF NOT EXISTS idx_q_subject ON questions(subject); CREATE INDEX IF NOT EXISTS idx_q_topic ON questions(topic); CREATE INDEX IF NOT EXISTS idx_q_chapter ON questions(chapter); CREATE INDEX IF NOT EXISTS idx_prog_user ON progress(user_id); CREATE INDEX IF NOT EXISTS idx_res_user ON results(user_id);'); } catch (e) {}
// إشعارات المنصة (يضيفها المدير ويراها الجميع)
try { db.exec("CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT, created_at TEXT DEFAULT (datetime('now')))"); } catch (e) {}

if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
  console.log('🌱 تهيئة البيانات الأولية...');
  const insU = db.prepare('INSERT INTO users(name,email,password,role,xp,streak) VALUES(?,?,?,?,?,?)');
  insU.run('مدير المنصة', 'admin@tahsili.sa', hashPw('admin123'), 'admin', 0, 0);
  insU.run('فارس الرحيل', 'faris@tahsili.sa', hashPw('123456'), 'student', 0, 0);
  const insQ = db.prepare('INSERT INTO questions(text,options,answer,subject,year,level,explanation) VALUES(?,?,?,?,?,?,?)');
  const Q = (t, o, a, s, y, l, e) => insQ.run(t, JSON.stringify(o), a, s, y, l, e);
  Q('ما ناتج اشتقاق الدالة f(x)=sin(x)؟', ['cos(x)', '-cos(x)', '-sin(x)', 'tan(x)'], 0, 'رياضيات', '1446', 'متوسط', 'مشتقة الجيب هي جيب التمام cos(x).');
  Q('وحدة قياس القوة في النظام الدولي هي؟', ['الجول', 'النيوتن', 'الواط', 'الباسكال'], 1, 'فيزياء', '1445', 'سهل', 'القوة تُقاس بالنيوتن.');
  Q('كم عدد إلكترونات التكافؤ لذرة الكربون؟', ['2', '4', '6', '8'], 1, 'كيمياء', '1446', 'صعب', 'الكربون لديه 4 إلكترونات تكافؤ.');
  Q('العضية المسؤولة عن إنتاج الطاقة في الخلية؟', ['النواة', 'الميتوكوندريا', 'الرايبوسوم', 'الفجوة'], 1, 'أحياء', '1446', 'سهل', 'الميتوكوندريا مصنع الطاقة.');
  const insL = db.prepare('INSERT INTO lessons(section,subject,grade,title,video_url,ord) VALUES(?,?,?,?,?,?)');
  for (const section of ['تأسيس', 'تجميعات'])
    for (const s of ['الرياضيات', 'الفيزياء', 'الكيمياء', 'الأحياء'])
      for (const g of ['أولى ثانوي', 'ثاني ثانوي', 'ثالث ثانوي'])
        for (let i = 1; i <= 2; i++) insL.run(section, s, g, `${s} ${g} — الدرس ${i}`, '', i);
  console.log('✅ تم.');
}

const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.pdf':'application/pdf','.ico':'image/x-icon' };

const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((resolve) => { let d=''; req.on('data',c=>{d+=c; if(d.length>120e6)req.destroy();}); req.on('end',()=>{ try{resolve(d?JSON.parse(d):{});}catch{resolve({});} }); });

const makeToken = () => crypto.randomBytes(24).toString('hex');

// ===== حساب أيام المذاكرة (Streak) بتوقيت السعودية (UTC+3) — بدون اعتماد على ICU =====
const dayStr = (d = new Date()) => new Date(d.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10); // YYYY-MM-DD
function updateStreak(u) {
  try {
    const today = dayStr();
    const yesterday = dayStr(new Date(Date.now() - 86400000));
    const dayBefore = dayStr(new Date(Date.now() - 2 * 86400000));
    let streak = u.streak || 0;
    if (u.last_login === today) return streak;            // دخل اليوم مسبقاً — لا تغيير
    if (u.last_login === yesterday) streak = streak + 1;  // دخل أمس — يوم جديد متتالي
    else if (u.last_login === dayBefore && (u.streak_freezes || 0) > 0) { // فاته يوم واحد + عنده حماية ستريك
      streak = streak + 1;
      db.prepare('UPDATE users SET streak_freezes = streak_freezes - 1 WHERE id=?').run(u.id);
    }
    else streak = 1;                                      // أول دخول أو انقطاع — يبدأ من 1
    db.prepare('UPDATE users SET streak=?, last_login=? WHERE id=?').run(streak, today, u.id);
    return streak;
  } catch (e) {
    console.error('streak update failed:', e.message);
    return u.streak || 0; // لا تمنع الدخول بسبب الستريك
  }
}
const levelOf = (xp) => Math.floor((xp || 0) / 300) + 1; // كل 300 XP = مستوى
const saveTopic = (name, subject, grade) => { if (name && String(name).trim()) { try { db.prepare('INSERT OR IGNORE INTO topic_names(subject,grade,name) VALUES(?,?,?)').run(subject || '', grade || '', String(name).trim()); } catch (e) {} } };
// منح XP مع تسجيل النقاط بالتاريخ (للوحات اليومية/الأسبوعية)
const addXp = (uid, pts, reason) => { db.prepare('UPDATE users SET xp = xp + ? WHERE id=?').run(pts, uid); try { db.prepare('INSERT INTO points_log(user_id,points,reason) VALUES(?,?,?)').run(uid, pts, reason || ''); } catch (e) {} };
const logActivity = (uid, name, action) => { try { db.prepare('INSERT INTO activity_log(user_id,name,action) VALUES(?,?,?)').run(uid, name || '', action); } catch (e) {} };
// خوارزمية المراجعة المتباعدة (فترات بالأيام)
const SR_INTERVALS = [1, 3, 7, 16, 35];
function getUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  if (!s) return null;
  const u = db.prepare('SELECT id,name,email,role,xp,streak,active,subject,trial_start,subscribed FROM users WHERE id=?').get(s.user_id);
  return (u && u.active) ? u : null;
}

// جدول المسارات
const routes = {
  'POST /api/register': async (req, res) => {
    let { name, email, password, phone, country } = await body(req);
    email = (email || '').trim().toLowerCase();
    if (name) name = name.trim();
    phone = (phone || '').trim();
    if (!name || !email || !password) return json(res, 400, { error: 'كل الحقول مطلوبة' });
    if (!phone) return json(res, 400, { error: 'رقم الجوال مطلوب' });
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return json(res, 400, { error: 'البريد مسجّل مسبقاً' });
    const info = db.prepare('INSERT INTO users(name,email,password,phone,country,trial_start) VALUES(?,?,?,?,?,?)').run(name, email, hashPw(password), phone, country || 'السعودية', dayStr());
    const token = makeToken();
    db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(token, info.lastInsertRowid);
    const user = db.prepare('SELECT id,name,email,role,xp,streak FROM users WHERE id=?').get(info.lastInsertRowid);
    json(res, 200, { token, user });
  },
  'GET /api/profile': (req, res, u) => json(res, 200, { user: db.prepare('SELECT id,name,email,role,phone,country,city,school,region,goal FROM users WHERE id=?').get(u.id) }),
  'POST /api/profile': async (req, res, u) => {
    let { name, email, phone, country, city, school, region } = await body(req);
    email = (email || '').trim().toLowerCase(); name = (name || '').trim();
    if (!name || !email) return json(res, 400, { error: 'الاسم والبريد مطلوبان' });
    if (db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email, u.id)) return json(res, 400, { error: 'البريد مستخدم من حساب آخر' });
    db.prepare('UPDATE users SET name=?, email=?, phone=?, country=?, city=?, school=?, region=? WHERE id=?').run(name, email, phone || '', country || '', city || '', school || '', region || '', u.id);
    json(res, 200, { ok: true, user: db.prepare('SELECT id,name,email,role,phone,country,city,school,region FROM users WHERE id=?').get(u.id) });
  },
  'POST /api/login': async (req, res) => {
    let { email, password } = await body(req);
    email = (email || '').trim().toLowerCase();
    if (typeof password === 'string') password = password.trim();
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!u || !verifyPw(password, u.password)) return json(res, 400, { error: 'البريد أو كلمة المرور غير صحيحة' });
    if (!u.active) return json(res, 403, { error: 'الحساب موقوف' });
    const streak = updateStreak(u); // تحديث أيام المذاكرة عند كل دخول
    // منح تجربة مجانية تلقائياً للطالب عند أول دخول إن لم تكن مضبوطة
    if (u.role === 'student' && !u.trial_start) { db.prepare('UPDATE users SET trial_start=? WHERE id=?').run(dayStr(), u.id); u.trial_start = dayStr(); }
    const token = makeToken();
    db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(token, u.id);
    json(res, 200, { token, user: { id: u.id, name: u.name, email: u.email, role: u.role, xp: u.xp, streak, level: levelOf(u.xp), trial_start: u.trial_start || '', subscribed: u.subscribed || 0 } });
  },
  'GET /api/me': (req, res, u) => json(res, 200, { user: { ...u, level: levelOf(u.xp) } }),
  'POST /api/logout': (req, res, u) => { const t=(req.headers.authorization||'').replace('Bearer ',''); db.prepare('DELETE FROM sessions WHERE token=?').run(t); json(res,200,{ok:true}); },

  // ===== إشعارات المنصة =====
  'GET /api/notifications': (req, res, u) => json(res, 200, db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 50').all()),
  'POST /api/notifications': async (req, res, u) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    const { title, body: b } = await body(req);
    if (!title || !title.trim()) return json(res, 400, { error: 'اكتب عنوان الإشعار' });
    const info = db.prepare('INSERT INTO notifications(title,body) VALUES(?,?)').run(title.trim(), (b || '').trim());
    logActivity(u.id, u.name, 'أضاف إشعاراً');
    json(res, 200, { id: info.lastInsertRowid });
  },
  'DELETE /api/notifications/:id': (req, res, u, q, id) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    db.prepare('DELETE FROM notifications WHERE id=?').run(id); json(res, 200, { ok: true });
  },

  // ===== الدفع (Moyasar) — اشتراك 149 ر.س =====
  'POST /api/pay/create': async (req, res, u) => {
    const key = process.env.MOYASAR_SECRET;
    const amount = parseInt(process.env.SUB_PRICE_HALALAS || '14900'); // 149 ر.س
    if (!key) return json(res, 200, { configured: false, error: 'بوابة الدفع غير مفعّلة بعد. (أضف مفتاح Moyasar السري في إعدادات Railway: MOYASAR_SECRET).' });
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const base = proto + '://' + host;
    try {
      const r = await fetch('https://api.moyasar.com/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') },
        body: JSON.stringify({ amount, currency: 'SAR', description: 'اشتراك منصة فِكر — كامل فترة التحصيلي', callback_url: base + '/api/pay/callback', metadata: { user_id: String(u.id), email: u.email } })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) return json(res, 200, { configured: true, error: (d.message || 'تعذّر إنشاء فاتورة الدفع') });
      json(res, 200, { configured: true, url: d.url });
    } catch (e) { json(res, 200, { configured: true, error: 'تعذّر الاتصال ببوابة الدفع' }); }
  },
  'GET /api/pay/callback': async (req, res, u, q) => {
    const key = process.env.MOYASAR_SECRET;
    const id = q.id || q.invoice_id;
    const go = (ok) => { res.writeHead(302, { Location: ok ? '/?paid=1' : '/?paid=0' }); res.end(); };
    if (!key || !id) return go(false);
    try {
      const r = await fetch('https://api.moyasar.com/v1/invoices/' + encodeURIComponent(id), { headers: { Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') } });
      const d = await r.json().catch(() => ({}));
      const paid = d && d.status === 'paid';
      const uid = d && d.metadata && parseInt(d.metadata.user_id);
      if (paid && uid) { db.prepare('UPDATE users SET subscribed=1 WHERE id=?').run(uid); logActivity(uid, '', 'فعّل اشتراكه عبر الدفع'); }
      go(paid);
    } catch (e) { go(false); }
  },

  'GET /api/questions': (req, res, u, q) => {
    let sql = 'SELECT * FROM questions WHERE 1=1', p = [];
    if (q.subject) { sql += ' AND subject=?'; p.push(q.subject); }
    if (q.year) { sql += ' AND year=?'; p.push(q.year); }
    if (q.level) { sql += ' AND level=?'; p.push(q.level); }
    if (q.topic) { sql += ' AND topic=?'; p.push(q.topic); }
    if (q.chapter) { sql += ' AND chapter=?'; p.push(q.chapter); }
    if (q.type) { sql += ' AND type=?'; p.push(q.type); }
    if (q.grade) { sql += ' AND grade=?'; p.push(q.grade); }
    if (q.q) { sql += ' AND text LIKE ?'; p.push('%' + q.q + '%'); }
    sql += ' ORDER BY id DESC';
    if (q.limit) { sql += ' LIMIT ? OFFSET ?'; p.push(Math.min(500, +q.limit || 50), +q.offset || 0); }
    const rows = db.prepare(sql).all(...p).map(r => ({ ...r, options: JSON.parse(r.options), opt_images: r.opt_images ? JSON.parse(r.opt_images) : [] }));
    json(res, 200, rows);
  },
  // قائمة الدروس/المواضيع المميزة (لفلترة بنك الأسئلة)
  'GET /api/topics': (req, res) => {
    json(res, 200, db.prepare("SELECT DISTINCT topic FROM questions WHERE topic IS NOT NULL AND topic<>'' ORDER BY topic").all().map(r => r.topic));
  },
  // أسماء الدروس المحفوظة (مرتّبة حسب المادة والمرحلة)
  'GET /api/topic-names': (req, res, u, q) => {
    let sql = 'SELECT * FROM topic_names WHERE 1=1', p = [];
    if (q.subject) { sql += ' AND subject=?'; p.push(q.subject); }
    if (q.grade) { sql += ' AND grade=?'; p.push(q.grade); }
    sql += ' ORDER BY subject, grade, name';
    json(res, 200, db.prepare(sql).all(...p));
  },
  'POST /api/topic-names': async (req, res, u) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    const { name, subject, grade } = await body(req);
    if (!name || !name.trim()) return json(res, 400, { error: 'اكتب اسم الدرس' });
    saveTopic(name, subject, grade);
    json(res, 200, { ok: true });
  },
  'DELETE /api/topic-names/:id': (req, res, u, q, id) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    db.prepare('DELETE FROM topic_names WHERE id=?').run(id); json(res, 200, { ok: true });
  },
  'POST /api/topic-names/clear': (req, res, u) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    const n = db.prepare('SELECT COUNT(*) c FROM topic_names').get().c;
    db.prepare('DELETE FROM topic_names').run(); json(res, 200, { deleted: n });
  },
  'POST /api/questions/clear': (req, res, u) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    const n = db.prepare('SELECT COUNT(*) c FROM questions').get().c;
    db.prepare('DELETE FROM questions').run();
    db.prepare('DELETE FROM topic_names').run();
    logActivity(u.id, u.name, `حذف كل الأسئلة (${n})`);
    json(res, 200, { deleted: n });
  },
  'POST /api/questions': async (req, res, u) => {
    if (u.role !== 'admin' && u.role !== 'teacher') return json(res, 403, { error: 'صلاحية المدير أو المعلّم مطلوبة' });
    const { text, options, answer, subject, year, level, explanation, topic, grade, chapter, type, image_url, opt_images } = await body(req);
    if (u.role === 'teacher' && u.subject && subject !== u.subject) return json(res, 403, { error: 'يمكنك إضافة أسئلة لمادتك فقط (' + u.subject + ')' });
    if ((!text && !image_url) || !options || answer == null || !subject) return json(res, 400, { error: 'بيانات ناقصة' });
    logActivity(u.id, u.name, `أضاف سؤالاً في ${subject}`);
    const info = db.prepare('INSERT INTO questions(text,options,answer,subject,year,level,explanation,topic,grade,chapter,type,image_url,opt_images) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(text, JSON.stringify(options), answer, subject, year || '', level || 'متوسط', explanation || '', topic || '', grade || '', chapter || '', type || 'mcq', image_url || '', opt_images ? JSON.stringify(opt_images) : '');
    saveTopic(topic, subject, grade);
    json(res, 200, { id: info.lastInsertRowid });
  },
  // استيراد أسئلة دفعة واحدة (من ملف JSON)
  'POST /api/questions/import': async (req, res, u) => {
    if (u.role !== 'admin' && u.role !== 'teacher') return json(res, 403, { error: 'صلاحية المدير أو المعلّم مطلوبة' });
    const data = await body(req);
    const list = Array.isArray(data) ? data : (data.questions || []);
    if (!Array.isArray(list) || !list.length) return json(res, 400, { error: 'الملف لا يحتوي أسئلة صالحة' });
    const norm = s => (s || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
    // مجموعة نصوص موجودة مسبقاً لكشف التكرار (مرة واحدة)
    const existing = new Set(db.prepare('SELECT text FROM questions').all().map(r => norm(r.text)));
    const batchSeen = new Set();
    const ins = db.prepare('INSERT INTO questions(text,options,answer,subject,year,level,explanation,topic,grade,chapter,type,image_url,opt_images) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    let added = 0, skipped = 0, dupes = 0;
    db.exec('BEGIN');
    try {
      for (const it of list) {
        if (!it || !it.text || !Array.isArray(it.options) || it.answer == null || !it.subject) { skipped++; continue; }
        const key = norm(it.text);
        if (existing.has(key) || batchSeen.has(key)) { dupes++; continue; } // منع المكرر
        batchSeen.add(key); existing.add(key);
        ins.run(it.text, JSON.stringify(it.options), it.answer, it.subject, it.year || '', it.level || 'متوسط', it.explanation || '', it.topic || '', it.grade || '', it.chapter || '', it.type || 'mcq', it.image_url || '', it.opt_images ? JSON.stringify(it.opt_images) : '');
        if (it.topic) saveTopic(it.topic, it.subject, it.grade);
        added++;
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return json(res, 500, { error: 'فشل الاستيراد: ' + e.message }); }
    logActivity(u.id, u.name, `استورد ${added} سؤال`);
    json(res, 200, { added, skipped, dupes });
  },
  // عدّادات الأسئلة لكل مادة/درس/فصل
  'GET /api/qstats': (req, res, u) => {
    json(res, 200, {
      total: db.prepare('SELECT COUNT(*) c FROM questions').get().c,
      bySubject: db.prepare('SELECT subject, COUNT(*) c FROM questions GROUP BY subject ORDER BY c DESC').all(),
      byTopic: db.prepare("SELECT subject, topic, COUNT(*) c FROM questions WHERE topic<>'' GROUP BY subject,topic ORDER BY c DESC").all()
    });
  },
  // رفع صورة (للسؤال أو الخيار) — يُخزّن على القرص ويرجع رابطاً
  'POST /api/qimage': async (req, res, u) => {
    if (u.role !== 'admin' && u.role !== 'teacher') return json(res, 403, { error: 'صلاحية مطلوبة' });
    const { dataB64, origName } = await body(req);
    if (!dataB64) return json(res, 400, { error: 'لا صورة' });
    try {
      const safe = (origName || 'img.png').replace(/[^\w.؀-ۿ-]/g, '_');
      const filename = 'q' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '-' + safe;
      await writeFile(join(UPLOADS, filename), Buffer.from(dataB64.split(',').pop(), 'base64'));
      json(res, 200, { url: '/uploads/' + filename });
    } catch (e) { json(res, 500, { error: 'تعذّر حفظ الصورة' }); }
  },
  'DELETE /api/questions/:id': (req, res, u, q, id) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    db.prepare('DELETE FROM questions WHERE id=?').run(id); json(res, 200, { ok: true });
  },
  'PUT /api/questions/:id': async (req, res, u, q, id) => {
    if (u.role !== 'admin' && u.role !== 'teacher') return json(res, 403, { error: 'صلاحية المدير أو المعلّم مطلوبة' });
    const { text, options, answer, subject, year, level, explanation, topic, grade, chapter, type, image_url, opt_images } = await body(req);
    if ((!text && !image_url) || !options || answer == null || !subject) return json(res, 400, { error: 'بيانات ناقصة' });
    db.prepare('UPDATE questions SET text=?,options=?,answer=?,subject=?,year=?,level=?,explanation=?,topic=?,grade=?,chapter=?,type=?,image_url=?,opt_images=? WHERE id=?')
      .run(text || '', JSON.stringify(options), answer, subject, year || '', level || 'متوسط', explanation || '', topic || '', grade || '', chapter || '', type || 'mcq', image_url || '', opt_images ? JSON.stringify(opt_images) : '', id);
    saveTopic(topic, subject, grade);
    json(res, 200, { ok: true, id: +id });
  },

  // ===== الدروس (مقسّمة حسب القسم/المادة/المرحلة) =====
  'GET /api/lessons': (req, res, u, q) => {
    let sql = 'SELECT * FROM lessons WHERE 1=1', p = [];
    if (q.section) { sql += ' AND section=?'; p.push(q.section); }
    if (q.subject) { sql += ' AND subject=?'; p.push(q.subject); }
    if (q.grade) { sql += ' AND grade=?'; p.push(q.grade); }
    sql += ' ORDER BY ord, id';
    json(res, 200, db.prepare(sql).all(...p));
  },
  'POST /api/lessons': async (req, res, u) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    const { section, subject, grade, title, video_url } = await body(req);
    if (!section || !subject || !grade || !title) return json(res, 400, { error: 'بيانات ناقصة' });
    const ord = (db.prepare('SELECT COUNT(*) c FROM lessons WHERE section=? AND subject=? AND grade=?').get(section, subject, grade).c) + 1;
    const info = db.prepare('INSERT INTO lessons(section,subject,grade,title,video_url,ord) VALUES(?,?,?,?,?,?)')
      .run(section, subject, grade, title, video_url || '', ord);
    json(res, 200, { id: info.lastInsertRowid });
  },
  'DELETE /api/lessons/:id': (req, res, u, q, id) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    db.prepare('DELETE FROM lessons WHERE id=?').run(id); json(res, 200, { ok: true });
  },
  'PUT /api/lessons/:id': async (req, res, u, q, id) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    const { section, subject, grade, title, video_url } = await body(req);
    if (!section || !subject || !grade || !title) return json(res, 400, { error: 'بيانات ناقصة' });
    db.prepare('UPDATE lessons SET section=?,subject=?,grade=?,title=?,video_url=? WHERE id=?')
      .run(section, subject, grade, title, video_url || '', id);
    json(res, 200, { ok: true, id: +id });
  },

  'GET /api/files': (req, res) => json(res, 200, db.prepare('SELECT * FROM files ORDER BY id DESC').all()),
  'POST /api/files': async (req, res, u) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    const { title, subject, section, dataB64, origName, url } = await body(req);
    // خيار 1: رابط (Google Drive / يوتيوب) — مفضّل للملفات الكبيرة، بدون رفع
    if (url && String(url).trim()) {
      const info = db.prepare('INSERT INTO files(title,filename,subject,section,url) VALUES(?,?,?,?,?)')
        .run(title || 'ملف', '', subject || '', section || '', String(url).trim());
      return json(res, 200, { id: info.lastInsertRowid, url: String(url).trim() });
    }
    // خيار 2: رفع الملف فعلياً
    if (!dataB64) return json(res, 400, { error: 'اختر ملفاً أو الصق رابطاً' });
    try {
      const safe = (origName || 'file.pdf').replace(/[^\w.؀-ۿ-]/g, '_');
      const filename = Date.now() + '-' + safe;
      await writeFile(join(UPLOADS, filename), Buffer.from(dataB64.split(',').pop(), 'base64'));
      const info = db.prepare('INSERT INTO files(title,filename,subject,section) VALUES(?,?,?,?)')
        .run(title || safe, filename, subject || '', section || '');
      json(res, 200, { id: info.lastInsertRowid, filename });
    } catch (e) {
      console.error('upload error:', e.message);
      json(res, 500, { error: 'تعذّر حفظ الملف (قد يكون كبيراً جداً) — جرّب لصق رابط بدلاً من الرفع' });
    }
  },
  'DELETE /api/files/:id': (req, res, u, q, id) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    db.prepare('DELETE FROM files WHERE id=?').run(id); json(res, 200, { ok: true });
  },

  'POST /api/results': async (req, res, u) => {
    const { exam_name, score, total, duration } = await body(req);
    db.prepare('INSERT INTO results(user_id,exam_name,score,total,duration) VALUES(?,?,?,?,?)').run(u.id, exam_name, score, total, duration || '');
    const gain = score * 20;
    addXp(u.id, gain, 'اختبار');
    json(res, 200, { ok: true, xpGained: gain });
  },
  'GET /api/results': (req, res, u) => json(res, 200, db.prepare('SELECT * FROM results WHERE user_id=? ORDER BY id DESC').all(u.id)),

  // لوحة الطالب — كل الأرقام محسوبة فعلياً من قاعدة البيانات
  'GET /api/dashboard': (req, res, u) => {
    const results = db.prepare('SELECT * FROM results WHERE user_id=? ORDER BY id DESC').all(u.id);
    const examsCount = results.length;
    const avg = examsCount ? Math.round(results.reduce((a, r) => a + (r.score * 100 / r.total), 0) / examsCount) : 0;
    const fresh = db.prepare('SELECT xp,streak,study_minutes,goal,streak_freezes,theme FROM users WHERE id=?').get(u.id);
    const rank = db.prepare("SELECT COUNT(*)+1 c FROM users WHERE role='student' AND xp > ?").get(fresh.xp).c;
    const totalStudents = db.prepare("SELECT COUNT(*) c FROM users WHERE role='student'").get().c;
    const totalLessons = db.prepare('SELECT COUNT(*) c FROM lessons').get().c;
    const doneLessons = db.prepare('SELECT COUNT(*) c FROM progress WHERE user_id=?').get(u.id).c;
    const overall = totalLessons ? Math.round(doneLessons * 100 / totalLessons) : 0;
    // توقّع الدرجة: مزيج من متوسط الاختبارات + نسبة إنجاز الدروس + الثبات (الستريك)
    let predicted = null, confidence = 'منخفضة';
    if (examsCount > 0) {
      const streakBoost = Math.min(5, (fresh.streak || 0) * 0.3);
      predicted = Math.max(0, Math.min(100, Math.round(avg * 0.7 + overall * 0.25 + streakBoost)));
      confidence = examsCount >= 5 ? 'عالية' : examsCount >= 2 ? 'متوسطة' : 'منخفضة';
    }
    const dueMistakes = db.prepare("SELECT COUNT(*) c FROM mistakes WHERE user_id=? AND (due_at IS NULL OR due_at <= datetime('now'))").get(u.id).c;
    json(res, 200, {
      xp: fresh.xp, streak: fresh.streak, level: levelOf(fresh.xp),
      examsCount, avg, rank, totalStudents,
      studyHours: Math.round((fresh.study_minutes || 0) / 60 * 10) / 10,
      overall, doneLessons, totalLessons, predicted, confidence,
      goal: fresh.goal || null, streakFreezes: fresh.streak_freezes || 0, theme: fresh.theme || '',
      mistakes: db.prepare('SELECT COUNT(*) c FROM mistakes WHERE user_id=?').get(u.id).c,
      dueMistakes,
      favorites: db.prepare('SELECT COUNT(*) c FROM favorites WHERE user_id=?').get(u.id).c,
      recent: results.slice(0, 5)
    });
  },
  // ===== أرقام الصفحة الرئيسية + الإنجازات (بيانات حيّة) =====
  'GET /api/home-stats': (req, res, u) => {
    const sec = (s) => { const r = db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN p.user_id IS NOT NULL THEN 1 ELSE 0 END) done FROM lessons l LEFT JOIN progress p ON p.lesson_id=l.id AND p.user_id=? WHERE l.section=?").get(u.id, s); return r.total ? Math.round((r.done || 0) * 100 / r.total) : 0; };
    const foundation = sec('تأسيس'), collections = sec('تجميعات');
    const totalQ = db.prepare('SELECT COUNT(*) c FROM questions').get().c;
    const attempted = db.prepare('SELECT COUNT(DISTINCT question_id) c FROM (SELECT question_id FROM mistakes WHERE user_id=?1 UNION SELECT question_id FROM favorites WHERE user_id=?1)').get(u.id).c;
    const bank = totalQ ? Math.round(attempted * 100 / totalQ) : 0;
    const results = db.prepare('SELECT score,total FROM results WHERE user_id=?').all(u.id);
    const examsCount = results.length;
    const exams = Math.min(100, examsCount * 20);
    const highExams = results.filter(r => r.total && (r.score * 100 / r.total) >= 90).length;
    const perfectExam = results.some(r => r.total && r.score === r.total);
    json(res, 200, { foundation, collections, bank, exams, streak: u.streak || 0, level: levelOf(u.xp), examsCount, highExams, perfectExam });
  },
  // ===== تتبّع مشاهدة الدروس =====
  'GET /api/progress': (req, res, u) => json(res, 200, db.prepare('SELECT lesson_id FROM progress WHERE user_id=?').all(u.id).map(r => r.lesson_id)),
  'POST /api/progress': async (req, res, u) => {
    const { lesson_id } = await body(req);
    const has = db.prepare('SELECT 1 FROM progress WHERE user_id=? AND lesson_id=?').get(u.id, lesson_id);
    if (has) { db.prepare('DELETE FROM progress WHERE user_id=? AND lesson_id=?').run(u.id, lesson_id); json(res, 200, { completed: false }); }
    else { db.prepare('INSERT OR IGNORE INTO progress(user_id,lesson_id) VALUES(?,?)').run(u.id, lesson_id); addXp(u.id, 5, 'درس'); json(res, 200, { completed: true }); }
  },
  'GET /api/progress/summary': (req, res, u) => {
    const rows = db.prepare(`SELECT l.subject, COUNT(*) total, SUM(CASE WHEN p.user_id IS NOT NULL THEN 1 ELSE 0 END) done
      FROM lessons l LEFT JOIN progress p ON p.lesson_id=l.id AND p.user_id=? GROUP BY l.subject`).all(u.id);
    json(res, 200, rows);
  },
  // ===== بنك الأخطاء + المراجعة الذكية =====
  'GET /api/mistakes': (req, res, u) => {
    const rows = db.prepare('SELECT q.* FROM mistakes m JOIN questions q ON q.id=m.question_id WHERE m.user_id=? ORDER BY m.created_at DESC').all(u.id);
    json(res, 200, rows.map(r => ({ ...r, options: JSON.parse(r.options) })));
  },
  'POST /api/mistakes': async (req, res, u) => { const { question_id } = await body(req); db.prepare("INSERT OR IGNORE INTO mistakes(user_id,question_id,due_at) VALUES(?,?,datetime('now'))").run(u.id, question_id); json(res, 200, { ok: true }); },
  'DELETE /api/mistakes/:id': (req, res, u, q, id) => { db.prepare('DELETE FROM mistakes WHERE user_id=? AND question_id=?').run(u.id, id); json(res, 200, { ok: true }); },
  // ===== المفضلة =====
  'GET /api/favorites': (req, res, u) => {
    const ids = db.prepare('SELECT question_id FROM favorites WHERE user_id=?').all(u.id).map(r => r.question_id);
    const rows = db.prepare('SELECT q.* FROM favorites f JOIN questions q ON q.id=f.question_id WHERE f.user_id=? ORDER BY f.created_at DESC').all(u.id);
    json(res, 200, { ids, questions: rows.map(r => ({ ...r, options: JSON.parse(r.options) })) });
  },
  'POST /api/favorites': async (req, res, u) => {
    const { question_id } = await body(req);
    const has = db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND question_id=?').get(u.id, question_id);
    if (has) { db.prepare('DELETE FROM favorites WHERE user_id=? AND question_id=?').run(u.id, question_id); json(res, 200, { fav: false }); }
    else { db.prepare('INSERT OR IGNORE INTO favorites(user_id,question_id) VALUES(?,?)').run(u.id, question_id); json(res, 200, { fav: true }); }
  },
  // ===== الملاحظات =====
  'GET /api/notes': (req, res, u) => json(res, 200, db.prepare('SELECT question_id,text FROM notes WHERE user_id=?').all(u.id)),
  'POST /api/notes': async (req, res, u) => {
    const { question_id, text } = await body(req);
    if (text && text.trim()) db.prepare('INSERT INTO notes(user_id,question_id,text) VALUES(?,?,?) ON CONFLICT(user_id,question_id) DO UPDATE SET text=excluded.text').run(u.id, question_id, text.trim());
    else db.prepare('DELETE FROM notes WHERE user_id=? AND question_id=?').run(u.id, question_id);
    json(res, 200, { ok: true });
  },
  // ===== ساعات الدراسة (المؤقّت) =====
  'POST /api/study': async (req, res, u) => {
    let { minutes } = await body(req);
    minutes = Math.max(0, Math.min(180, parseInt(minutes) || 0));
    db.prepare('UPDATE users SET study_minutes = COALESCE(study_minutes,0) + ? WHERE id=?').run(minutes, u.id);
    addXp(u.id, minutes, 'مذاكرة');
    json(res, 200, { ok: true });
  },
  // ===== بحث شامل (دروس + أسئلة) =====
  'GET /api/search': (req, res, u, q) => {
    const term = '%' + (q.q || '') + '%';
    if (!q.q || q.q.trim().length < 2) return json(res, 200, { lessons: [], questions: [] });
    const lessons = db.prepare('SELECT id,title,subject,grade,section,video_url FROM lessons WHERE title LIKE ? LIMIT 15').all(term);
    const questions = db.prepare('SELECT id,text,subject,topic,level FROM questions WHERE text LIKE ? OR topic LIKE ? LIMIT 15').all(term, term);
    json(res, 200, { lessons, questions });
  },
  // ===== سؤال اليوم =====
  'GET /api/daily': (req, res, u) => {
    const cnt = db.prepare('SELECT COUNT(*) c FROM questions').get().c;
    if (!cnt) return json(res, 200, { question: null });
    const dayNum = Math.floor(Date.now() / 86400000);
    const all = db.prepare('SELECT * FROM questions ORDER BY id').all();
    const it = all[dayNum % all.length];
    const today = dayStr();
    const ans = db.prepare('SELECT correct FROM daily_answers WHERE user_id=? AND day=?').get(u.id, today);
    json(res, 200, { question: { id: it.id, text: it.text, options: JSON.parse(it.options), subject: it.subject, topic: it.topic, answer: ans ? it.answer : undefined, explanation: ans ? it.explanation : undefined }, answered: !!ans, wasCorrect: ans ? !!ans.correct : null });
  },
  'POST /api/daily': async (req, res, u) => {
    const { answer } = await body(req);
    const today = dayStr();
    if (db.prepare('SELECT 1 FROM daily_answers WHERE user_id=? AND day=?').get(u.id, today)) return json(res, 400, { error: 'أجبت على سؤال اليوم مسبقاً' });
    const all = db.prepare('SELECT * FROM questions ORDER BY id').all();
    if (!all.length) return json(res, 400, { error: 'لا أسئلة' });
    const it = all[Math.floor(Date.now() / 86400000) % all.length];
    const correct = answer === it.answer;
    db.prepare('INSERT OR IGNORE INTO daily_answers(user_id,day,question_id,correct) VALUES(?,?,?,?)').run(u.id, today, it.id, correct ? 1 : 0);
    if (correct) addXp(u.id, 30, 'سؤال اليوم'); else db.prepare("INSERT OR IGNORE INTO mistakes(user_id,question_id,due_at) VALUES(?,?,datetime('now'))").run(u.id, it.id);
    json(res, 200, { correct, answer: it.answer, explanation: it.explanation, xp: correct ? 30 : 0 });
  },
  // ===== تقييم صعوبة السؤال =====
  'POST /api/questions/:id/rate': async (req, res, u, q, id) => {
    const { difficulty } = await body(req);
    db.prepare('INSERT INTO ratings(user_id,question_id,difficulty) VALUES(?,?,?) ON CONFLICT(user_id,question_id) DO UPDATE SET difficulty=excluded.difficulty').run(u.id, id, difficulty);
    const avg = db.prepare('SELECT ROUND(AVG(difficulty),1) a, COUNT(*) c FROM ratings WHERE question_id=?').get(id);
    json(res, 200, { avg: avg.a, count: avg.c });
  },
  // ===== الإبلاغ عن خطأ في سؤال =====
  'POST /api/reports': async (req, res, u) => {
    const { question_id, reason } = await body(req);
    db.prepare('INSERT INTO reports(user_id,name,question_id,reason) VALUES(?,?,?,?)').run(u.id, u.name, question_id, (reason || '').trim());
    json(res, 200, { ok: true });
  },
  'GET /api/reports': (req, res, u) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    json(res, 200, db.prepare("SELECT r.*, q.text qtext FROM reports r LEFT JOIN questions q ON q.id=r.question_id WHERE r.status='open' ORDER BY r.id DESC LIMIT 50").all());
  },
  'POST /api/reports/:id/resolve': (req, res, u, q, id) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    db.prepare("UPDATE reports SET status='resolved' WHERE id=?").run(id); json(res, 200, { ok: true });
  },
  // ===== هدف الدرجة =====
  'POST /api/goal': async (req, res, u) => {
    let { goal } = await body(req); goal = Math.max(0, Math.min(100, parseInt(goal) || 0));
    db.prepare('UPDATE users SET goal=? WHERE id=?').run(goal, u.id); json(res, 200, { goal });
  },
  // ===== متجر المكافآت =====
  'GET /api/store': (req, res, u) => {
    const f = db.prepare('SELECT xp, streak_freezes, theme FROM users WHERE id=?').get(u.id);
    json(res, 200, { xp: f.xp, streak_freezes: f.streak_freezes || 0, theme: f.theme || '', items: [
      { id: 'freeze', name: 'حماية الستريك ❄️', desc: 'يحميك من كسر السلسلة ليوم واحد', cost: 200 },
      { id: 'theme_emerald', name: 'ثيم الزمرّد 💚', desc: 'لون أخضر مميز للواجهة', cost: 500 },
      { id: 'theme_purple', name: 'ثيم البنفسج 💜', desc: 'لون بنفسجي مميز للواجهة', cost: 500 },
    ] });
  },
  'POST /api/store/buy': async (req, res, u) => {
    const { item } = await body(req);
    const costs = { freeze: 200, theme_emerald: 500, theme_purple: 500 };
    const cost = costs[item]; if (!cost) return json(res, 400, { error: 'عنصر غير معروف' });
    const f = db.prepare('SELECT xp FROM users WHERE id=?').get(u.id);
    if (f.xp < cost) return json(res, 400, { error: 'نقاطك غير كافية' });
    db.prepare('UPDATE users SET xp = xp - ? WHERE id=?').run(cost, u.id);
    db.prepare('INSERT INTO points_log(user_id,points,reason) VALUES(?,?,?)').run(u.id, -cost, 'متجر');
    if (item === 'freeze') db.prepare('UPDATE users SET streak_freezes = COALESCE(streak_freezes,0) + 1 WHERE id=?').run(u.id);
    else db.prepare('UPDATE users SET theme=? WHERE id=?').run(item.replace('theme_', ''), u.id);
    json(res, 200, { ok: true });
  },
  // ===== النسخة الزمنية (تطوّرك شهرياً) =====
  'GET /api/timeline': (req, res, u) => {
    const rows = db.prepare("SELECT substr(created_at,1,7) m, ROUND(AVG(score*100.0/total)) avg, COUNT(*) c FROM results WHERE user_id=? GROUP BY m ORDER BY m").all(u.id);
    let bestUp = null, bestDown = null;
    for (let i = 1; i < rows.length; i++) { const diff = rows[i].avg - rows[i - 1].avg; if (bestUp === null || diff > bestUp.diff) bestUp = { m: rows[i].m, diff }; if (bestDown === null || diff < bestDown.diff) bestDown = { m: rows[i].m, diff }; }
    json(res, 200, { months: rows, bestUp, bestDown });
  },
  // ===== خريطة المملكة (ترتيبك جغرافياً) =====
  'GET /api/ranking': (req, res, u) => {
    const me = db.prepare('SELECT xp,city,school,region FROM users WHERE id=?').get(u.id);
    const rankIn = (field, val) => {
      if (!val) return null;
      const total = db.prepare(`SELECT COUNT(*) c FROM users WHERE role='student' AND ${field}=?`).get(val).c;
      const rank = db.prepare(`SELECT COUNT(*)+1 c FROM users WHERE role='student' AND ${field}=? AND xp>?`).get(val, me.xp).c;
      return { rank, total, name: val };
    };
    const kTotal = db.prepare("SELECT COUNT(*) c FROM users WHERE role='student'").get().c;
    const kRank = db.prepare("SELECT COUNT(*)+1 c FROM users WHERE role='student' AND xp>?").get(me.xp).c;
    json(res, 200, { kingdom: { rank: kRank, total: kTotal }, region: rankIn('region', me.region), city: rankIn('city', me.city), school: rankIn('school', me.school), xp: me.xp });
  },
  // ===== البطاقات التعليمية (Flashcards) =====
  'GET /api/flashcards': (req, res, u, q) => {
    let sql = 'SELECT * FROM flashcards WHERE 1=1', p = [];
    if (q.subject) { sql += ' AND subject=?'; p.push(q.subject); }
    if (q.grade) { sql += ' AND grade=?'; p.push(q.grade); }
    sql += ' ORDER BY id DESC';
    json(res, 200, db.prepare(sql).all(...p));
  },
  'POST /api/flashcards': async (req, res, u) => {
    if (u.role !== 'admin' && u.role !== 'teacher') return json(res, 403, { error: 'صلاحية المدير أو المعلّم مطلوبة' });
    const { subject, grade, front, back } = await body(req);
    if (!subject || !front || !back) return json(res, 400, { error: 'بيانات ناقصة' });
    const info = db.prepare('INSERT INTO flashcards(subject,grade,front,back) VALUES(?,?,?,?)').run(subject, grade || '', front, back);
    logActivity(u.id, u.name, `أضاف بطاقة تعليمية في ${subject}`);
    json(res, 200, { id: info.lastInsertRowid });
  },
  'DELETE /api/flashcards/:id': (req, res, u, q, id) => {
    if (u.role !== 'admin' && u.role !== 'teacher') return json(res, 403, { error: 'صلاحية مطلوبة' });
    db.prepare('DELETE FROM flashcards WHERE id=?').run(id); json(res, 200, { ok: true });
  },
  // ===== الملخصات والقوانين =====
  'GET /api/summaries': (req, res, u, q) => {
    let sql = 'SELECT * FROM summaries WHERE 1=1', p = [];
    if (q.subject) { sql += ' AND subject=?'; p.push(q.subject); }
    sql += ' ORDER BY id DESC';
    json(res, 200, db.prepare(sql).all(...p));
  },
  'POST /api/summaries': async (req, res, u) => {
    if (u.role !== 'admin' && u.role !== 'teacher') return json(res, 403, { error: 'صلاحية المدير أو المعلّم مطلوبة' });
    const { subject, title, content } = await body(req);
    if (!subject || !title || !content) return json(res, 400, { error: 'بيانات ناقصة' });
    const info = db.prepare('INSERT INTO summaries(subject,title,content) VALUES(?,?,?)').run(subject, title, content);
    json(res, 200, { id: info.lastInsertRowid });
  },
  'DELETE /api/summaries/:id': (req, res, u, q, id) => {
    if (u.role !== 'admin' && u.role !== 'teacher') return json(res, 403, { error: 'صلاحية مطلوبة' });
    db.prepare('DELETE FROM summaries WHERE id=?').run(id); json(res, 200, { ok: true });
  },
  // ===== المساعد الذكي (يحلّل سؤالاً أو صورة حلّ) =====
  'POST /api/assistant': async (req, res, u) => {
    const { text, image } = await body(req);
    const key = process.env.AI_API_KEY;
    if (!key) return json(res, 200, { configured: false, reply: 'مساعد فِكر الذكي جاهز تقنياً ✅\nلتفعيله: شغّل الخادم بمتغيّر AI_API_KEY (مفتاح من OpenAI أو أي خدمة متوافقة) + إنترنت. بعدها أقدر أحلّل صورة حلّك وأشرح الخطأ خطوة بخطوة.' });
    try {
      const base = process.env.AI_BASE || 'https://api.openai.com/v1';
      const model = process.env.AI_MODEL || 'gpt-4o-mini';
      const content = [{ type: 'text', text: text || 'حلّل صورة حلّ الطالب: حدّد أين الخطأ بالضبط، في أي خطوة وقع، ما المفهوم الناقص، ثم اشرح الحل الصحيح خطوة بخطوة بالعربية، واقترح نوع أسئلة مشابهة للتدرّب.' }];
      if (image) content.push({ type: 'image_url', image_url: { url: image } });
      const payload = { model, max_tokens: 900, messages: [
        { role: 'system', content: 'أنت "مساعد فِكر" الذكي لطلاب اختبار التحصيلي السعودي. اشرح بالعربية الفصحى المبسّطة، خطوة بخطوة، وركّز على ترسيخ المفهوم. كن دقيقاً ومشجّعاً.' },
        { role: 'user', content }
      ] };
      const r = await fetch(base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(payload) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return json(res, 200, { configured: true, reply: 'تعذّر الاتصال بخدمة الذكاء: ' + ((d.error && d.error.message) || r.status) });
      logActivity(u.id, u.name, 'استخدم المساعد الذكي');
      json(res, 200, { configured: true, reply: (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || 'لم أستطع توليد رد.' });
    } catch (e) { json(res, 200, { configured: true, reply: 'خطأ في الاتصال: ' + e.message } ); }
  },
  // ===== بوابة ولي الأمر =====
  'POST /api/parent-code': (req, res, u) => {
    let row = db.prepare('SELECT parent_code FROM users WHERE id=?').get(u.id);
    let code = row.parent_code;
    if (!code) { code = 'P' + crypto.randomBytes(4).toString('hex').toUpperCase(); db.prepare('UPDATE users SET parent_code=? WHERE id=?').run(code, u.id); }
    json(res, 200, { code });
  },
  'GET /api/parent/:code': (req, res, u, q, code) => {
    const s = db.prepare('SELECT id,name,xp,streak,study_minutes,goal FROM users WHERE parent_code=?').get(code);
    if (!s) return json(res, 404, { error: 'رمز غير صحيح' });
    const results = db.prepare('SELECT * FROM results WHERE user_id=? ORDER BY id DESC').all(s.id);
    const examsCount = results.length;
    const avg = examsCount ? Math.round(results.reduce((a, r) => a + r.score * 100 / r.total, 0) / examsCount) : 0;
    const totalLessons = db.prepare('SELECT COUNT(*) c FROM lessons').get().c;
    const done = db.prepare('SELECT COUNT(*) c FROM progress WHERE user_id=?').get(s.id).c;
    json(res, 200, { name: s.name, xp: s.xp, level: levelOf(s.xp), streak: s.streak, studyHours: Math.round((s.study_minutes || 0) / 60 * 10) / 10, examsCount, avg, goal: s.goal, overall: totalLessons ? Math.round(done * 100 / totalLessons) : 0, recent: results.slice(0, 8).map(r => ({ exam_name: r.exam_name, pct: Math.round(r.score * 100 / r.total) })) });
  },

  // تغيير كلمة المرور (لأي مستخدم مسجّل دخوله — بما فيهم المدير)
  'POST /api/change-password': async (req, res, u) => {
    const { oldPassword, newPassword } = await body(req);
    const row = db.prepare('SELECT password FROM users WHERE id=?').get(u.id);
    if (!verifyPw(oldPassword || '', row.password)) return json(res, 400, { error: 'كلمة المرور الحالية غير صحيحة' });
    if (!newPassword || newPassword.length < 6) return json(res, 400, { error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
    db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPw(newPassword), u.id);
    json(res, 200, { ok: true });
  },

  'GET /api/students': (req, res, u) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    json(res, 200, db.prepare(`SELECT u.id,u.name,u.email,u.xp,u.streak,u.active,u.subscribed,u.trial_start,
        (SELECT COUNT(*) FROM results r WHERE r.user_id=u.id) AS exams,
        (SELECT ROUND(AVG(r.score*100.0/r.total),1) FROM results r WHERE r.user_id=u.id) AS avg_score
      FROM users u WHERE u.role='student' ORDER BY u.xp DESC`).all());
  },
  'PATCH /api/students/:id/toggle': (req, res, u, q, id) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    const s = db.prepare('SELECT active FROM users WHERE id=?').get(id);
    db.prepare('UPDATE users SET active=? WHERE id=?').run(s.active ? 0 : 1, id);
    json(res, 200, { active: s.active ? 0 : 1 });
  },
  'PATCH /api/students/:id/subscription': (req, res, u, q, id) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    const s = db.prepare('SELECT subscribed FROM users WHERE id=?').get(id);
    const nv = s.subscribed ? 0 : 1;
    db.prepare('UPDATE users SET subscribed=? WHERE id=?').run(nv, id);
    json(res, 200, { subscribed: nv });
  },
  // ===== العملاء (كل المسجّلين) =====
  'GET /api/customers': (req, res, u) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    json(res, 200, db.prepare(`SELECT u.id,u.name,u.email,u.role,u.phone,u.country,u.city,u.school,u.region,u.xp,u.streak,u.subscribed,u.trial_start,u.active,u.created_at,
        (SELECT COUNT(*) FROM results r WHERE r.user_id=u.id) AS exams
      FROM users u WHERE u.role IN ('student','teacher') ORDER BY datetime(u.created_at) DESC, u.id DESC`).all());
  },
  'GET /api/stats': (req, res, u) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    json(res, 200, {
      users: db.prepare("SELECT COUNT(*) c FROM users WHERE role='student'").get().c,
      questions: db.prepare('SELECT COUNT(*) c FROM questions').get().c,
      files: db.prepare('SELECT COUNT(*) c FROM files').get().c,
      exams: db.prepare('SELECT COUNT(*) c FROM results').get().c,
      bySubject: db.prepare('SELECT subject, COUNT(*) c FROM questions GROUP BY subject').all()
    });
  },
  'GET /api/leaderboard': (req, res, u, q) => {
    const period = q.period || 'all';
    if (period === 'all') return json(res, 200, db.prepare("SELECT name,xp FROM users WHERE role='student' ORDER BY xp DESC LIMIT 15").all());
    const since = period === 'week' ? "datetime('now','-7 days')" : "date('now')";
    const rows = db.prepare(`SELECT u.name, COALESCE(SUM(p.points),0) xp FROM users u
      LEFT JOIN points_log p ON p.user_id=u.id AND p.created_at >= ${since}
      WHERE u.role='student' GROUP BY u.id HAVING xp > 0 ORDER BY xp DESC LIMIT 15`).all();
    json(res, 200, rows);
  },
  // ===== المراجعة المتباعدة =====
  'GET /api/mistakes/due': (req, res, u) => {
    const rows = db.prepare("SELECT q.* FROM mistakes m JOIN questions q ON q.id=m.question_id WHERE m.user_id=? AND (m.due_at IS NULL OR m.due_at <= datetime('now')) ORDER BY m.due_at").all(u.id);
    json(res, 200, rows.map(r => ({ ...r, options: JSON.parse(r.options) })));
  },
  'POST /api/mistakes/:id/review': async (req, res, u, q, id) => {
    const { correct } = await body(req);
    const m = db.prepare('SELECT reps FROM mistakes WHERE user_id=? AND question_id=?').get(u.id, id);
    if (!m) return json(res, 404, { error: 'غير موجود' });
    if (correct) {
      const reps = (m.reps || 0) + 1;
      if (reps >= SR_INTERVALS.length) { db.prepare('DELETE FROM mistakes WHERE user_id=? AND question_id=?').run(u.id, id); return json(res, 200, { mastered: true }); }
      const days = SR_INTERVALS[reps];
      db.prepare("UPDATE mistakes SET reps=?, due_at=datetime('now','+'||?||' days') WHERE user_id=? AND question_id=?").run(reps, days, u.id, id);
      json(res, 200, { reps, nextDays: days });
    } else {
      db.prepare("UPDATE mistakes SET reps=0, due_at=datetime('now','+1 days') WHERE user_id=? AND question_id=?").run(u.id, id);
      json(res, 200, { reps: 0 });
    }
  },
  // ===== المعلّمون (إدارة) =====
  'GET /api/teachers': (req, res, u) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    json(res, 200, db.prepare("SELECT id,name,email,subject,active FROM users WHERE role='teacher' ORDER BY id DESC").all());
  },
  'POST /api/teachers': async (req, res, u) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    let { name, email, password, subject } = await body(req);
    email = (email || '').trim().toLowerCase(); name = (name || '').trim();
    if (!name || !email || !password) return json(res, 400, { error: 'كل الحقول مطلوبة' });
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return json(res, 400, { error: 'البريد مسجّل مسبقاً' });
    const info = db.prepare("INSERT INTO users(name,email,password,role,subject) VALUES(?,?,?,'teacher',?)").run(name, email, hashPw(password), subject || '');
    logActivity(u.id, u.name, `أنشأ حساب معلّم: ${name} (${subject || 'كل المواد'})`);
    json(res, 200, { id: info.lastInsertRowid });
  },
  'GET /api/activity': (req, res, u) => {
    if (u.role !== 'admin') return json(res, 403, { error: 'صلاحية المدير مطلوبة' });
    json(res, 200, db.prepare('SELECT name,action,created_at FROM activity_log ORDER BY id DESC LIMIT 40').all());
  },
};

const PUBLIC_ROUTES = new Set(['POST /api/register', 'POST /api/login', 'GET /api/questions', 'GET /api/files', 'GET /api/leaderboard', 'GET /api/parent/:code', 'GET /api/pay/callback']);

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  let base = PUBLIC, rel = urlPath;
  if (urlPath.startsWith('/uploads/')) { base = UPLOADS; rel = urlPath.slice('/uploads'.length); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = normalize(join(base, rel));
  if (!filePath.startsWith(base)) { res.writeHead(403); return res.end('forbidden'); }
  if (base === __dirname && DENY.has(filePath.split('/').pop().toLowerCase())) { res.writeHead(404); return res.end('غير موجود'); }
  if (!existsSync(filePath)) { res.writeHead(404); return res.end('غير موجود'); }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(500); res.end('error'); }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const path = u.pathname;
  if (!path.startsWith('/api/')) return serveStatic(req, res);

  // مطابقة المسار (مع دعم :id)
  let handler = routes[`${req.method} ${path}`], params = null;
  if (!handler) {
    for (const key in routes) {
      const [m, pat] = key.split(' ');
      if (m !== req.method || !pat.includes(':')) continue;
      const re = new RegExp('^' + pat.replace(/:[^/]+/g, '([^/]+)') + '$');
      const match = path.match(re);
      if (match) { handler = routes[key]; params = match[1]; break; }
    }
  }
  if (!handler) return json(res, 404, { error: 'مسار غير موجود' });

  const routeKey = Object.keys(routes).find(k => routes[k] === handler);
  let user = null;
  if (!PUBLIC_ROUTES.has(routeKey)) {
    user = getUser(req);
    if (!user) return json(res, 401, { error: 'يجب تسجيل الدخول' });
  }
  const query = Object.fromEntries(u.searchParams);
  try { await handler(req, res, user, query, params); }
  catch (e) { console.error(e); json(res, 500, { error: 'خطأ في الخادم' }); }
});

server.listen(PORT, () => {
  console.log('\n=================================================');
  console.log('  ✅ منصة تحصيلي بلس تعمل الآن!');
  console.log(`  🌐 افتح المتصفح على:  http://localhost:${PORT}`);
  console.log('  👤 مدير:  admin@tahsili.sa / admin123');
  console.log('  🎓 طالب:  faris@tahsili.sa / 123456');
  console.log('  (لإيقاف الخادم اضغط Ctrl + C)');
  console.log('=================================================\n');
});
