const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { body, validationResult } = require('express-validator');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tarven_pro_secret_2025_change_in_production';

// ===================== DATABASE =====================
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, '../tarven.db'));
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
    avatar TEXT,
    is_verified INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '📦',
    slug TEXT UNIQUE NOT NULL,
    parent_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    old_price REAL,
    stock INTEGER DEFAULT 0,
    category_id INTEGER,
    image TEXT DEFAULT '📦',
    images TEXT DEFAULT '[]',
    badge TEXT,
    is_featured INTEGER DEFAULT 0,
    is_bestseller INTEGER DEFAULT 0,
    rating REAL DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    sku TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );
  CREATE TABLE IF NOT EXISTS cart (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    session_id TEXT,
    product_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
  CREATE TABLE IF NOT EXISTS wishlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    user_id INTEGER,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    address TEXT,
    city TEXT,
    subtotal REAL NOT NULL,
    discount REAL DEFAULT 0,
    shipping_cost REAL DEFAULT 0,
    total REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    payment_method TEXT DEFAULT 'cash',
    payment_status TEXT DEFAULT 'unpaid',
    coupon_code TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    product_image TEXT,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    user_id INTEGER,
    user_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment TEXT,
    is_approved INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
  CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    discount_type TEXT NOT NULL,
    discount_value REAL NOT NULL,
    min_order REAL DEFAULT 0,
    max_uses INTEGER DEFAULT 100,
    used_count INTEGER DEFAULT 0,
    expires_at DATETIME,
    is_active INTEGER DEFAULT 1,
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

// Seed data
function seedDB() {
  const adminExists = db.prepare('SELECT id FROM admins WHERE username=?').get('admin');
  if (!adminExists) {
    db.prepare('INSERT INTO admins (username,password) VALUES (?,?)').run('admin', bcrypt.hashSync('admin123', 10));
  }
  const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
  if (catCount === 0) {
    [['إلكترونيات','📱','electronics'],['أزياء','👗','fashion'],['المنزل','🏡','home'],['الجمال','💄','beauty'],['الرياضة','🏋️','sports'],['الأطفال','🧸','kids']].forEach(c=>db.prepare('INSERT INTO categories(name,icon,slug)VALUES(?,?,?)').run(...c));
  }
  const prodCount = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  if (prodCount === 0) {
    [
      ['Samsung Galaxy S24 Ultra','هاتف ذكي بكاميرا 200 ميجابكسل',3299,5099,15,1,'📱','خصم',1,0,4.9,2341,'SKU-001'],
      ['MacBook Pro M3','لابتوب احترافي بمعالج Apple M3',7999,8999,8,1,'💻','جديد',1,0,4.8,856,'SKU-002'],
      ['Sony WH-1000XM5','سماعات لاسلكية بإلغاء الضوضاء',1199,1499,25,1,'🎧',null,1,1,4.7,1203,'SKU-003'],
      ['Nike Air Max 270','حذاء رياضي مريح وعصري',449,599,50,5,'👟',null,0,1,4.6,3421,'SKU-004'],
      ['PlayStation 5 Slim','جهاز ألعاب من الجيل الجديد',1999,null,5,1,'🎮',null,0,1,4.9,987,'SKU-005'],
      ['iPad Pro 12.9"','تابلت احترافي بشريحة M2',4999,5999,12,1,'📱','مميز',1,0,4.8,654,'SKU-006'],
    ].forEach(p=>db.prepare('INSERT INTO products(name,description,price,old_price,stock,category_id,image,badge,is_featured,is_bestseller,rating,review_count,sku)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...p));
  }
  const couponCount = db.prepare('SELECT COUNT(*) as c FROM coupons').get().c;
  if (couponCount === 0) {
    [['TARVEN10','percent',10,0,1000],['TARVEN20','percent',20,200,500],['WELCOME','percent',15,0,999],['SAVE50','fixed',50,100,200]].forEach(c=>db.prepare('INSERT INTO coupons(code,discount_type,discount_value,min_order,max_uses)VALUES(?,?,?,?,?)').run(...c));
  }
  [['store_name','TARVEN'],['store_slogan','متجرك في كل مكان'],['free_shipping_min','200'],['whatsapp','01112641854'],['email','tarven2025@gmail.com'],['shipping_cost','30']].forEach(s=>db.prepare('INSERT OR IGNORE INTO settings(key,value)VALUES(?,?)').run(...s));
  const demoUser = db.prepare('SELECT id FROM users WHERE email=?').get('demo@tarven.com');
  if (!demoUser) db.prepare('INSERT INTO users(name,email,phone,password,is_verified)VALUES(?,?,?,?,1)').run('مستخدم تجريبي','demo@tarven.com','01112641854',bcrypt.hashSync('demo123',10));
}
seedDB();

// ===================== SECURITY MIDDLEWARE =====================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

const limiter = rateLimit({ windowMs: 15*60*1000, max: 200, message: { error: 'طلبات كثيرة، انتظر قليلاً' } });
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, message: { error: 'محاولات كثيرة، انتظر 15 دقيقة' } });
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// ===================== AUTH MIDDLEWARE =====================
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'جلسة منتهية' }); }
}
function adminMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'غير مصرح' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'صلاحيات غير كافية' });
    req.admin = decoded; next();
  } catch { res.status(401).json({ error: 'جلسة منتهية' }); }
}

// ===================== FILE UPLOAD =====================
const storage = multer.diskStorage({
  destination: (req, file, cb) => { require('fs').mkdirSync(path.join(__dirname,'../uploads'), {recursive:true}); cb(null,'uploads/'); },
  filename: (req, file, cb) => cb(null, Date.now()+'-'+file.originalname.replace(/[^a-zA-Z0-9.]/g,'_'))
});
const upload = multer({ storage, limits:{fileSize:5*1024*1024}, fileFilter:(req,file,cb)=>{ if(file.mimetype.startsWith('image/'))cb(null,true); else cb(new Error('صور فقط')); } });

// ===================== USER AUTH =====================
app.post('/api/auth/register', [
  body('email').isEmail().withMessage('بريد إلكتروني غير صحيح'),
  body('password').isLength({min:6}).withMessage('كلمة المرور 6 أحرف على الأقل'),
  body('name').notEmpty().withMessage('الاسم مطلوب')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  const { name, email, phone, password } = req.body;
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (existing) return res.status(400).json({ error: 'البريد الإلكتروني مسجل مسبقاً' });
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users(name,email,phone,password,is_verified)VALUES(?,?,?,?,1)').run(name,email,phone||null,hash);
  const token = jwt.sign({ id: result.lastInsertRowid, email, name, role: 'customer' }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: result.lastInsertRowid, name, email, role: 'customer' } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(400).json({ error: 'بيانات غير صحيحة' });
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id,name,email,phone,role,created_at FROM users WHERE id=?').get(req.user.id);
  res.json(user);
});

app.put('/api/auth/profile', authMiddleware, (req, res) => {
  const { name, phone } = req.body;
  db.prepare('UPDATE users SET name=?,phone=? WHERE id=?').run(name,phone,req.user.id);
  res.json({ success: true });
});

app.post('/api/auth/change-password', authMiddleware, (req, res) => {
  const { current, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(current, user.password)) return res.status(400).json({ error: 'كلمة المرور الحالية خاطئة' });
  db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPassword,10), req.user.id);
  res.json({ success: true });
});

// Admin Auth
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password)) return res.status(400).json({ error: 'بيانات خاطئة' });
  const token = jwt.sign({ id: admin.id, username: admin.username, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: admin.username });
});

// ===================== PRODUCTS =====================
app.get('/api/products', (req, res) => {
  const { category, featured, bestseller, search, limit, sort, min_price, max_price } = req.query;
  let q = 'SELECT p.*,c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE 1=1';
  const params = [];
  if (category) { q += ' AND p.category_id=?'; params.push(category); }
  if (featured==='1') q += ' AND p.is_featured=1';
  if (bestseller==='1') q += ' AND p.is_bestseller=1';
  if (search) { q += ' AND p.name LIKE ?'; params.push(`%${search}%`); }
  if (min_price) { q += ' AND p.price>=?'; params.push(min_price); }
  if (max_price) { q += ' AND p.price<=?'; params.push(max_price); }
  const sortMap = { price_asc:'p.price ASC', price_desc:'p.price DESC', newest:'p.created_at DESC', rating:'p.rating DESC', bestseller:'p.review_count DESC' };
  q += ' ORDER BY ' + (sortMap[sort]||'p.created_at DESC');
  if (limit) { q += ' LIMIT ?'; params.push(parseInt(limit)); }
  res.json(db.prepare(q).all(...params));
});

app.get('/api/products/:id', (req, res) => {
  const p = db.prepare('SELECT p.*,c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'المنتج غير موجود' });
  const reviews = db.prepare('SELECT * FROM reviews WHERE product_id=? AND is_approved=1 ORDER BY created_at DESC LIMIT 10').all(req.params.id);
  const related = db.prepare('SELECT * FROM products WHERE category_id=? AND id!=? LIMIT 4').all(p.category_id, p.id);
  res.json({ ...p, reviews, related });
});

// Admin Products
app.post('/api/admin/products', adminMiddleware, upload.single('image_file'), (req, res) => {
  const { name, description, price, old_price, stock, category_id, image, badge, is_featured, is_bestseller, sku } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'الاسم والسعر مطلوبان' });
  const imgPath = req.file ? `/uploads/${req.file.filename}` : (image||'📦');
  const r = db.prepare('INSERT INTO products(name,description,price,old_price,stock,category_id,image,badge,is_featured,is_bestseller,sku)VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(name,description,parseFloat(price),old_price?parseFloat(old_price):null,parseInt(stock)||0,category_id||null,imgPath,badge||null,is_featured?1:0,is_bestseller?1:0,sku||null);
  res.json({ id: r.lastInsertRowid, success: true });
});

app.put('/api/admin/products/:id', adminMiddleware, upload.single('image_file'), (req, res) => {
  const ex = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!ex) return res.status(404).json({ error: 'غير موجود' });
  const { name, description, price, old_price, stock, category_id, image, badge, is_featured, is_bestseller } = req.body;
  const imgPath = req.file ? `/uploads/${req.file.filename}` : (image||ex.image);
  db.prepare('UPDATE products SET name=?,description=?,price=?,old_price=?,stock=?,category_id=?,image=?,badge=?,is_featured=?,is_bestseller=? WHERE id=?').run(name,description,parseFloat(price),old_price?parseFloat(old_price):null,parseInt(stock)||0,category_id||null,imgPath,badge||null,is_featured?1:0,is_bestseller?1:0,req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/products/:id', adminMiddleware, (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ===================== CATEGORIES =====================
app.get('/api/categories', (req, res) => res.json(db.prepare('SELECT * FROM categories ORDER BY name').all()));

app.post('/api/admin/categories', adminMiddleware, (req, res) => {
  const { name, icon, slug } = req.body;
  if (!name||!slug) return res.status(400).json({ error: 'الاسم والرابط مطلوبان' });
  const r = db.prepare('INSERT INTO categories(name,icon,slug)VALUES(?,?,?)').run(name,icon||'📦',slug);
  res.json({ id: r.lastInsertRowid, success: true });
});

app.delete('/api/admin/categories/:id', adminMiddleware, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ===================== CART =====================
app.get('/api/cart', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  let userId = null, sessionId = req.headers['x-session-id']||'guest';
  try { if (token) { const d = jwt.verify(token,JWT_SECRET); userId = d.id; } } catch {}
  const items = userId
    ? db.prepare('SELECT c.*,p.name,p.price,p.image,p.stock FROM cart c JOIN products p ON c.product_id=p.id WHERE c.user_id=?').all(userId)
    : db.prepare('SELECT c.*,p.name,p.price,p.image,p.stock FROM cart c JOIN products p ON c.product_id=p.id WHERE c.session_id=?').all(sessionId);
  res.json(items);
});

app.post('/api/cart', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  let userId = null, sessionId = req.headers['x-session-id']||'guest';
  try { if (token) { const d = jwt.verify(token,JWT_SECRET); userId = d.id; } } catch {}
  const { product_id, quantity=1 } = req.body;
  const product = db.prepare('SELECT * FROM products WHERE id=?').get(product_id);
  if (!product) return res.status(404).json({ error: 'المنتج غير موجود' });
  if (product.stock < quantity) return res.status(400).json({ error: 'الكمية غير متوفرة في المخزون' });
  const existing = userId
    ? db.prepare('SELECT * FROM cart WHERE user_id=? AND product_id=?').get(userId, product_id)
    : db.prepare('SELECT * FROM cart WHERE session_id=? AND product_id=?').get(sessionId, product_id);
  if (existing) {
    db.prepare('UPDATE cart SET quantity=quantity+? WHERE id=?').run(quantity, existing.id);
  } else {
    if (userId) db.prepare('INSERT INTO cart(user_id,product_id,quantity)VALUES(?,?,?)').run(userId,product_id,quantity);
    else db.prepare('INSERT INTO cart(session_id,product_id,quantity)VALUES(?,?,?)').run(sessionId,product_id,quantity);
  }
  res.json({ success: true });
});

app.put('/api/cart/:id', (req, res) => {
  const { quantity } = req.body;
  if (quantity < 1) { db.prepare('DELETE FROM cart WHERE id=?').run(req.params.id); }
  else db.prepare('UPDATE cart SET quantity=? WHERE id=?').run(quantity, req.params.id);
  res.json({ success: true });
});

app.delete('/api/cart/:id', (req, res) => {
  db.prepare('DELETE FROM cart WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ===================== WISHLIST =====================
app.get('/api/wishlist', authMiddleware, (req, res) => {
  const items = db.prepare('SELECT w.*,p.name,p.price,p.image,p.old_price FROM wishlist w JOIN products p ON w.product_id=p.id WHERE w.user_id=?').all(req.user.id);
  res.json(items);
});

app.post('/api/wishlist', authMiddleware, (req, res) => {
  const { product_id } = req.body;
  try { db.prepare('INSERT INTO wishlist(user_id,product_id)VALUES(?,?)').run(req.user.id,product_id); }
  catch { db.prepare('DELETE FROM wishlist WHERE user_id=? AND product_id=?').run(req.user.id,product_id); return res.json({ removed: true }); }
  res.json({ added: true });
});

// ===================== ORDERS =====================
app.post('/api/orders', (req, res) => {
  const { customer_name, customer_phone, customer_email, address, city, payment_method, items, notes, coupon_code } = req.body;
  if (!customer_name||!customer_phone||!items?.length) return res.status(400).json({ error: 'بيانات ناقصة' });

  let subtotal = 0;
  const processedItems = [];
  for (const item of items) {
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(item.id);
    if (!p) return res.status(400).json({ error: `منتج غير موجود: ${item.id}` });
    if (p.stock < item.quantity) return res.status(400).json({ error: `${p.name}: الكمية غير متوفرة` });
    subtotal += p.price * item.quantity;
    processedItems.push({ product: p, quantity: item.quantity });
  }

  let discount = 0;
  const settings = {};
  db.prepare('SELECT * FROM settings').all().forEach(s => settings[s.key] = s.value);
  const freeShipMin = parseFloat(settings.free_shipping_min||200);
  const shippingCost = subtotal >= freeShipMin ? 0 : parseFloat(settings.shipping_cost||30);

  if (coupon_code) {
    const coupon = db.prepare('SELECT * FROM coupons WHERE code=? AND is_active=1').get(coupon_code.toUpperCase());
    if (coupon && coupon.used_count < coupon.max_uses && subtotal >= coupon.min_order) {
      discount = coupon.discount_type==='percent' ? Math.round(subtotal*coupon.discount_value/100) : coupon.discount_value;
      db.prepare('UPDATE coupons SET used_count=used_count+1 WHERE id=?').run(coupon.id);
    }
  }

  const total = subtotal - discount + shippingCost;
  const orderNum = 'TRV-' + Date.now().toString().slice(-6);

  const order = db.prepare('INSERT INTO orders(order_number,customer_name,customer_phone,customer_email,address,city,subtotal,discount,shipping_cost,total,payment_method,coupon_code,notes)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(orderNum,customer_name,customer_phone,customer_email,address,city,subtotal,discount,shippingCost,total,payment_method||'cash',coupon_code||null,notes||null);

  const insItem = db.prepare('INSERT INTO order_items(order_id,product_id,product_name,product_image,price,quantity)VALUES(?,?,?,?,?,?)');
  const updStock = db.prepare('UPDATE products SET stock=stock-? WHERE id=?');
  processedItems.forEach(({ product: p, quantity: q }) => {
    insItem.run(order.lastInsertRowid, p.id, p.name, p.image, p.price, q);
    updStock.run(q, p.id);
  });

  res.json({ order_number: orderNum, total, subtotal, discount, shipping_cost: shippingCost, success: true });
});

app.get('/api/orders/:orderNumber', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_number=?').get(req.params.orderNumber);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
  res.json({ ...order, items });
});

app.get('/api/my-orders', authMiddleware, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE customer_email=? ORDER BY created_at DESC').all(req.user.email);
  res.json(orders);
});

// Admin Orders
app.get('/api/admin/orders', adminMiddleware, (req, res) => {
  const { status, limit=50, offset=0 } = req.query;
  let q = 'SELECT * FROM orders';
  const params = [];
  if (status) { q += ' WHERE status=?'; params.push(status); }
  q += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));
  const orders = db.prepare(q).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM orders' + (status?' WHERE status=?':'')).get(...(status?[status]:[])).c;
  res.json({ orders, total });
});

app.get('/api/admin/orders/:id', adminMiddleware, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'غير موجود' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(req.params.id);
  res.json({ ...order, items });
});

app.put('/api/admin/orders/:id/status', adminMiddleware, (req, res) => {
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(req.body.status, req.params.id);
  res.json({ success: true });
});

// ===================== REVIEWS =====================
app.post('/api/products/:id/reviews', authMiddleware, (req, res) => {
  const { rating, comment } = req.body;
  if (!rating||rating<1||rating>5) return res.status(400).json({ error: 'تقييم غير صحيح' });
  db.prepare('INSERT INTO reviews(product_id,user_id,user_name,rating,comment)VALUES(?,?,?,?,?)').run(req.params.id,req.user.id,req.user.name,rating,comment||null);
  const stats = db.prepare('SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews WHERE product_id=? AND is_approved=1').get(req.params.id);
  db.prepare('UPDATE products SET rating=?,review_count=? WHERE id=?').run(Math.round(stats.avg*10)/10,stats.cnt,req.params.id);
  res.json({ success: true });
});

// ===================== COUPONS =====================
app.post('/api/coupons/validate', (req, res) => {
  const { code, subtotal } = req.body;
  const coupon = db.prepare('SELECT * FROM coupons WHERE code=? AND is_active=1').get((code||'').toUpperCase());
  if (!coupon) return res.status(400).json({ error: 'كوبون غير صحيح' });
  if (coupon.used_count >= coupon.max_uses) return res.status(400).json({ error: 'الكوبون استُنفد' });
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return res.status(400).json({ error: 'الكوبون منتهي الصلاحية' });
  if (subtotal < coupon.min_order) return res.status(400).json({ error: `الحد الأدنى للطلب ${coupon.min_order} ج.م` });
  const discount = coupon.discount_type==='percent' ? Math.round(subtotal*coupon.discount_value/100) : coupon.discount_value;
  res.json({ valid: true, discount, type: coupon.discount_type, value: coupon.discount_value, label: coupon.discount_type==='percent'?`خصم ${coupon.discount_value}%`:`خصم ${coupon.discount_value} ج.م` });
});

app.get('/api/admin/coupons', adminMiddleware, (req, res) => res.json(db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all()));
app.post('/api/admin/coupons', adminMiddleware, (req, res) => {
  const { code, discount_type, discount_value, min_order, max_uses } = req.body;
  const r = db.prepare('INSERT INTO coupons(code,discount_type,discount_value,min_order,max_uses)VALUES(?,?,?,?,?)').run(code.toUpperCase(),discount_type,discount_value,min_order||0,max_uses||100);
  res.json({ id: r.lastInsertRowid, success: true });
});
app.delete('/api/admin/coupons/:id', adminMiddleware, (req, res) => { db.prepare('DELETE FROM coupons WHERE id=?').run(req.params.id); res.json({ success: true }); });

// ===================== USERS ADMIN =====================
app.get('/api/admin/users', adminMiddleware, (req, res) => {
  const users = db.prepare('SELECT id,name,email,phone,role,created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

// ===================== SETTINGS =====================
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const s = {}; rows.forEach(r => s[r.key]=r.value);
  res.json(s);
});
app.post('/api/admin/settings', adminMiddleware, (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings(key,value)VALUES(?,?)');
  Object.entries(req.body).forEach(([k,v])=>upsert.run(k,v));
  res.json({ success: true });
});

app.post('/api/admin/change-password', adminMiddleware, (req, res) => {
  const { current, newPassword } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE id=?').get(req.admin.id);
  if (!bcrypt.compareSync(current, admin.password)) return res.status(400).json({ error: 'كلمة المرور الحالية خاطئة' });
  db.prepare('UPDATE admins SET password=? WHERE id=?').run(bcrypt.hashSync(newPassword,10), req.admin.id);
  res.json({ success: true });
});

// ===================== DASHBOARD STATS =====================
app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  const totalSales = db.prepare("SELECT COALESCE(SUM(total),0) as v FROM orders WHERE status!='cancelled'").get().v;
  const totalOrders = db.prepare('SELECT COUNT(*) as v FROM orders').get().v;
  const newOrders = db.prepare("SELECT COUNT(*) as v FROM orders WHERE status='pending'").get().v;
  const totalProducts = db.prepare('SELECT COUNT(*) as v FROM products').get().v;
  const totalUsers = db.prepare('SELECT COUNT(*) as v FROM users').get().v;
  const lowStock = db.prepare('SELECT COUNT(*) as v FROM products WHERE stock<5').get().v;
  const recentOrders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 10').all();
  const topProducts = db.prepare('SELECT p.name,p.image,SUM(oi.quantity) as sold,SUM(oi.price*oi.quantity) as revenue FROM order_items oi JOIN products p ON oi.product_id=p.id GROUP BY oi.product_id ORDER BY sold DESC LIMIT 5').all();
  const salesByDay = db.prepare("SELECT DATE(created_at) as date,SUM(total) as total,COUNT(*) as count FROM orders WHERE created_at>=DATE('now','-7 days') GROUP BY DATE(created_at) ORDER BY date").all();
  res.json({ totalSales, totalOrders, newOrders, totalProducts, totalUsers, lowStock, recentOrders, topProducts, salesByDay });
});

// ===================== SERVE PAGES =====================
app.get('/admin*', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'حدث خطأ في الخادم' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 TARVEN Server: http://localhost:${PORT}`);
  console.log(`📊 Admin Panel: http://localhost:${PORT}/admin`);
  console.log(`👤 Admin: username=admin, password=admin123\n`);
});
