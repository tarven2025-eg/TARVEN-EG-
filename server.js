const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tarven_secret_2025';

// ===== DATABASE =====
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, 'tarven.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'customer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '📦',
    slug TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    old_price REAL,
    stock INTEGER DEFAULT 10,
    category_id INTEGER,
    image TEXT DEFAULT '📦',
    badge TEXT,
    rating REAL DEFAULT 4.5,
    review_count INTEGER DEFAULT 0,
    featured INTEGER DEFAULT 0,
    bestseller INTEGER DEFAULT 0,
    sku TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );
  CREATE TABLE IF NOT EXISTS cart (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    user_id INTEGER,
    product_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    payment_method TEXT DEFAULT 'cash',
    status TEXT DEFAULT 'pending',
    subtotal REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    shipping REAL DEFAULT 0,
    total REAL DEFAULT 0,
    coupon_code TEXT,
    notes TEXT,
    user_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );
  CREATE TABLE IF NOT EXISTS wishlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    type TEXT DEFAULT 'percent',
    value REAL NOT NULL,
    min_order REAL DEFAULT 0,
    max_uses INTEGER DEFAULT 100,
    used_count INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    user_id INTEGER,
    user_name TEXT DEFAULT 'مجهول',
    rating INTEGER NOT NULL,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ===== SEED DATA =====
const seedDone = db.prepare("SELECT COUNT(*) as c FROM categories").get();
if (seedDone.c === 0) {
  // Categories
  const cats = [
    ['إلكترونيات','📱','electronics'],
    ['أزياء','👗','fashion'],
    ['منزل وديكور','🏠','home'],
    ['رياضة','⚽','sports'],
    ['جمال وعناية','💄','beauty'],
    ['كتب وتعليم','📚','books'],
  ];
  const insertCat = db.prepare("INSERT INTO categories (name,icon,slug) VALUES (?,?,?)");
  cats.forEach(c => insertCat.run(...c));

  // Products
  const products = [
    ['آيفون 15 Pro Max','أحدث إصدار من Apple بكاميرا 48MP وشاشة 6.7 بوصة',45999,52000,15,1,'📱','الأكثر مبيعاً',4.9,1243,1,1],
    ['سامسونج Galaxy S24 Ultra','أقوى هاتف أندرويد بقلم S Pen مدمج',38500,44000,8,1,'📱','مميز',4.8,876,1,0],
    ['لابتوب Dell XPS 15','معالج Intel i7 الجيل الـ13، شاشة OLED 4K',35000,42000,5,1,'💻','خصم',4.7,456,1,0],
    ['سماعات Sony WH-1000XM5','أفضل سماعات إلغاء الضوضاء في العالم',12999,16000,20,1,'🎧','خصم',4.9,2341,1,1],
    ['Apple Watch Series 9','ساعة ذكية بميزة الأكسجين في الدم',18500,22000,12,1,'⌚','جديد',4.7,567,0,1],
    ['آيباد Pro M2','شاشة Liquid Retina XDR 11 بوصة',28000,32000,7,1,'📱','مميز',4.8,234,1,0],
    ['تيشيرت قطن بريميوم','قطن 100% مريح ومتوفر بألوان متعددة',299,450,100,2,'👕','خصم',4.6,892,0,1],
    ['فستان سواريه','فستان أنيق مناسب للمناسبات الرسمية',1850,2400,30,2,'👗','مميز',4.8,156,1,0],
    ['حقيبة جلد أصلي','حقيبة يد نسائية من الجلد الطبيعي',2200,2800,25,2,'👜','جديد',4.7,203,0,0],
    ['مكنسة روبوت ذكية','روبوت تنظيف ذكي بخرائط ليزر',4299,5500,15,3,'🤖','خصم',4.7,445,1,1],
    ['طقم غرفة نوم','طقم كامل 6 قطع قطن مصري فاخر',1200,1600,40,3,'🛏️','الأكثر مبيعاً',4.8,678,0,1],
    ['حذاء رياضي Nike','حذاء جري احترافي خفيف الوزن',1850,2200,50,4,'👟','جديد',4.6,334,0,0],
  ];
  const insertProd = db.prepare(`INSERT INTO products (name,description,price,old_price,stock,category_id,image,badge,rating,review_count,featured,bestseller) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  products.forEach(p => insertProd.run(...p));

  // Coupons
  const coupons = [
    ['TARVEN10','percent',10,0],
    ['TARVEN20','percent',20,100],
    ['WELCOME','percent',15,0],
    ['SAVE50','fixed',50,150],
  ];
  const insertCoupon = db.prepare("INSERT INTO coupons (code,type,value,min_order) VALUES (?,?,?,?)");
  coupons.forEach(c => insertCoupon.run(...c));

  // Demo user
  const hash = bcrypt.hashSync('demo123', 10);
  db.prepare("INSERT OR IGNORE INTO users (name,email,phone,password) VALUES (?,?,?,?)").run('مستخدم تجريبي','demo@tarven.com','01112641854',hash);

  // Admin
  const adminHash = bcrypt.hashSync('admin123', 10);
  db.prepare("INSERT OR IGNORE INTO admins (username,password) VALUES (?,?)").run('admin', adminHash);

  // Settings
  const settingsData = [
    ['store_name','TARVEN'],['store_slogan','متجرك في كل مكان'],
    ['whatsapp','01112641854'],['email','tarven2025@gmail.com'],
    ['shipping_cost','30'],['free_shipping_min','200'],
  ];
  const insertSetting = db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)");
  settingsData.forEach(s => insertSetting.run(...s));

  console.log('✅ Seed data created');
}

// ===== MIDDLEWARE =====
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 15*60*1000, max: 500 }));

// ===== STATIC FILES (flat structure) =====
app.use(express.static(__dirname));

// ===== AUTH MIDDLEWARE =====
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'غير مصرح' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'جلسة منتهية' }); }
};

const adminMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'غير مصرح' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'ممنوع' });
    req.admin = decoded; next();
  } catch { res.status(401).json({ error: 'جلسة منتهية' }); }
};

const optionalAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) { try { req.user = jwt.verify(token, JWT_SECRET); } catch {} }
  next();
};

// ===== CATEGORIES =====
app.get('/api/categories', (req, res) => {
  res.json(db.prepare("SELECT * FROM categories ORDER BY id").all());
});

app.post('/api/admin/categories', adminMiddleware, (req, res) => {
  const { name, icon, slug } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'اسم والرابط مطلوبان' });
  const r = db.prepare("INSERT INTO categories (name,icon,slug) VALUES (?,?,?)").run(name, icon||'📦', slug);
  res.json({ id: r.lastInsertRowid, name, icon, slug });
});

// ===== PRODUCTS =====
app.get('/api/products', (req, res) => {
  const { search, category, featured, bestseller, sort, min_price, max_price, limit } = req.query;
  let sql = `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE 1=1`;
  const params = [];
  if (search) { sql += ` AND (p.name LIKE ? OR p.description LIKE ?)`; params.push(`%${search}%`,`%${search}%`); }
  if (category) { sql += ` AND (c.id=? OR c.name=?)`; params.push(category, category); }
  if (featured) { sql += ` AND p.featured=1`; }
  if (bestseller) { sql += ` AND p.bestseller=1`; }
  if (min_price) { sql += ` AND p.price>=?`; params.push(min_price); }
  if (max_price) { sql += ` AND p.price<=?`; params.push(max_price); }
  const sortMap = { price_asc:'p.price ASC', price_desc:'p.price DESC', rating:'p.rating DESC', bestseller:'p.bestseller DESC' };
  sql += ` ORDER BY ${sortMap[sort]||'p.created_at DESC'}`;
  if (limit) { sql += ` LIMIT ?`; params.push(parseInt(limit)); }
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/products/:id', (req, res) => {
  const p = db.prepare(`SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.id=?`).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'المنتج غير موجود' });
  p.reviews = db.prepare("SELECT * FROM reviews WHERE product_id=? ORDER BY created_at DESC LIMIT 10").all(req.params.id);
  p.related = db.prepare(`SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.category_id=? AND p.id!=? LIMIT 4`).all(p.category_id, p.id);
  res.json(p);
});

app.post('/api/admin/products', adminMiddleware, (req, res) => {
  const { name, description, price, old_price, stock, category_id, image, badge, featured, bestseller } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'الاسم والسعر مطلوبان' });
  const r = db.prepare(`INSERT INTO products (name,description,price,old_price,stock,category_id,image,badge,featured,bestseller) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(name,description||null,price,old_price||null,stock||10,category_id||null,image||'📦',badge||null,featured?1:0,bestseller?1:0);
  res.json({ id: r.lastInsertRowid, ...req.body });
});

app.put('/api/admin/products/:id', adminMiddleware, (req, res) => {
  const { name, description, price, old_price, stock, category_id, image, badge, featured, bestseller } = req.body;
  db.prepare(`UPDATE products SET name=?,description=?,price=?,old_price=?,stock=?,category_id=?,image=?,badge=?,featured=?,bestseller=? WHERE id=?`).run(name,description,price,old_price||null,stock,category_id||null,image,badge||null,featured?1:0,bestseller?1:0,req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/products/:id', adminMiddleware, (req, res) => {
  db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

// ===== AUTH =====
app.post('/api/auth/register', (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  if (password.length < 6) return res.status(400).json({ error: 'كلمة المرور 6 أحرف على الأقل' });
  const exists = db.prepare("SELECT id FROM users WHERE email=?").get(email);
  if (exists) return res.status(400).json({ error: 'البريد الإلكتروني مستخدم بالفعل' });
  const hash = bcrypt.hashSync(password, 10);
  const r = db.prepare("INSERT INTO users (name,email,phone,password) VALUES (?,?,?,?)").run(name,email,phone||null,hash);
  const user = { id: r.lastInsertRowid, name, email, phone };
  const token = jwt.sign({ id: user.id, email, role: 'customer' }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'بيانات خاطئة' });
  const token = jwt.sign({ id: user.id, email, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare("SELECT id,name,email,phone FROM users WHERE id=?").get(req.user.id);
  res.json(user);
});

app.put('/api/auth/profile', authMiddleware, (req, res) => {
  const { name, phone } = req.body;
  db.prepare("UPDATE users SET name=?,phone=? WHERE id=?").run(name,phone,req.user.id);
  res.json({ success: true });
});

// ===== CART =====
app.get('/api/cart', optionalAuth, (req, res) => {
  const sid = req.headers['x-session-id'];
  const uid = req.user?.id;
  let cart;
  if (uid) cart = db.prepare(`SELECT c.id, c.product_id, c.quantity, p.name, p.price, p.old_price, p.image, p.stock FROM cart c JOIN products p ON c.product_id=p.id WHERE c.user_id=?`).all(uid);
  else cart = db.prepare(`SELECT c.id, c.product_id, c.quantity, p.name, p.price, p.old_price, p.image, p.stock FROM cart c JOIN products p ON c.product_id=p.id WHERE c.session_id=?`).all(sid||'');
  res.json(cart);
});

app.post('/api/cart', optionalAuth, (req, res) => {
  const { product_id, quantity = 1 } = req.body;
  const sid = req.headers['x-session-id'];
  const uid = req.user?.id;
  const prod = db.prepare("SELECT * FROM products WHERE id=?").get(product_id);
  if (!prod) return res.status(404).json({ error: 'المنتج غير موجود' });
  if (prod.stock < 1) return res.status(400).json({ error: 'نفد المخزون' });
  const existing = uid
    ? db.prepare("SELECT * FROM cart WHERE user_id=? AND product_id=?").get(uid, product_id)
    : db.prepare("SELECT * FROM cart WHERE session_id=? AND product_id=?").get(sid||'', product_id);
  if (existing) {
    db.prepare("UPDATE cart SET quantity=quantity+? WHERE id=?").run(quantity, existing.id);
  } else {
    db.prepare("INSERT INTO cart (session_id,user_id,product_id,quantity) VALUES (?,?,?,?)").run(sid||null, uid||null, product_id, quantity);
  }
  res.json({ success: true });
});

app.put('/api/cart/:id', optionalAuth, (req, res) => {
  const { quantity } = req.body;
  if (quantity < 1) { db.prepare("DELETE FROM cart WHERE id=?").run(req.params.id); return res.json({ success: true }); }
  db.prepare("UPDATE cart SET quantity=? WHERE id=?").run(quantity, req.params.id);
  res.json({ success: true });
});

app.delete('/api/cart/:id', (req, res) => {
  db.prepare("DELETE FROM cart WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

// ===== WISHLIST =====
app.post('/api/wishlist', authMiddleware, (req, res) => {
  const { product_id } = req.body;
  const exists = db.prepare("SELECT id FROM wishlist WHERE user_id=? AND product_id=?").get(req.user.id, product_id);
  if (exists) { db.prepare("DELETE FROM wishlist WHERE id=?").run(exists.id); return res.json({ added: false }); }
  db.prepare("INSERT INTO wishlist (user_id,product_id) VALUES (?,?)").run(req.user.id, product_id);
  res.json({ added: true });
});

app.get('/api/wishlist', authMiddleware, (req, res) => {
  const items = db.prepare(`SELECT w.id, w.product_id, p.name, p.price, p.old_price, p.image, p.rating FROM wishlist w JOIN products p ON w.product_id=p.id WHERE w.user_id=?`).all(req.user.id);
  res.json(items);
});

// ===== COUPONS =====
app.post('/api/coupons/validate', (req, res) => {
  const { code, subtotal = 0 } = req.body;
  const c = db.prepare("SELECT * FROM coupons WHERE code=? AND active=1").get(code?.toUpperCase());
  if (!c) return res.status(400).json({ error: 'كود الخصم غير صحيح' });
  if (c.used_count >= c.max_uses) return res.status(400).json({ error: 'تم استنفاد هذا الكود' });
  if (subtotal < c.min_order) return res.status(400).json({ error: `الحد الأدنى للطلب ${c.min_order} ج.م` });
  const discount = c.type === 'percent' ? (subtotal * c.value / 100) : c.value;
  res.json({ discount: Math.min(discount, subtotal), label: c.type==='percent'?`خصم ${c.value}%`:`خصم ${c.value} ج.م` });
});

app.get('/api/admin/coupons', adminMiddleware, (req, res) => {
  res.json(db.prepare("SELECT * FROM coupons ORDER BY created_at DESC").all());
});

app.post('/api/admin/coupons', adminMiddleware, (req, res) => {
  const { code, type, value, min_order, max_uses } = req.body;
  const r = db.prepare("INSERT INTO coupons (code,type,value,min_order,max_uses) VALUES (?,?,?,?,?)").run(code?.toUpperCase(),type||'percent',value,min_order||0,max_uses||100);
  res.json({ id: r.lastInsertRowid });
});

app.delete('/api/admin/coupons/:id', adminMiddleware, (req, res) => {
  db.prepare("DELETE FROM coupons WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

// ===== ORDERS =====
app.post('/api/orders', optionalAuth, (req, res) => {
  const { customer_name, customer_phone, customer_email, address, city, payment_method, coupon_code, items, notes } = req.body;
  if (!customer_name || !customer_phone || !address || !city) return res.status(400).json({ error: 'بيانات ناقصة' });
  if (!items?.length) return res.status(400).json({ error: 'السلة فارغة' });

  const orderNum = 'TRV-' + Date.now().toString().slice(-6);
  let subtotal = 0;
  const orderItems = items.map(item => {
    const p = db.prepare("SELECT * FROM products WHERE id=?").get(item.id);
    if (!p) throw new Error('منتج غير موجود');
    subtotal += p.price * item.quantity;
    return { product_id: p.id, name: p.name, price: p.price, quantity: item.quantity };
  });

  let discount = 0;
  if (coupon_code) {
    const c = db.prepare("SELECT * FROM coupons WHERE code=? AND active=1").get(coupon_code.toUpperCase());
    if (c) {
      discount = c.type==='percent' ? subtotal*c.value/100 : c.value;
      db.prepare("UPDATE coupons SET used_count=used_count+1 WHERE id=?").run(c.id);
    }
  }

  const settings = {};
  db.prepare("SELECT * FROM settings").all().forEach(s => settings[s.key] = s.value);
  const freeMin = parseFloat(settings.free_shipping_min || 200);
  const shipping = subtotal >= freeMin ? 0 : parseFloat(settings.shipping_cost || 30);
  const total = subtotal - discount + shipping;

  const r = db.prepare(`INSERT INTO orders (order_number,customer_name,customer_phone,customer_email,address,city,payment_method,subtotal,discount,shipping,total,coupon_code,notes,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(orderNum,customer_name,customer_phone,customer_email||null,address,city,payment_method||'cash',subtotal,discount,shipping,total,coupon_code||null,notes||null,req.user?.id||null);

  const insertItem = db.prepare("INSERT INTO order_items (order_id,product_id,name,price,quantity) VALUES (?,?,?,?,?)");
  orderItems.forEach(item => insertItem.run(r.lastInsertRowid, item.product_id, item.name, item.price, item.quantity));

  // Clear cart
  const sid = req.headers['x-session-id'];
  if (req.user?.id) db.prepare("DELETE FROM cart WHERE user_id=?").run(req.user.id);
  else if (sid) db.prepare("DELETE FROM cart WHERE session_id=?").run(sid);

  res.json({ order_number: orderNum, total, status: 'pending' });
});

app.get('/api/orders/:orderNumber', (req, res) => {
  const order = db.prepare
