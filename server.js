const express = require("express");
const mysql   = require("mysql2");
const cors    = require("cors");
const path    = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = mysql.createConnection({
  host: "localhost", user: "root", password: "P@ssw0rd", database: "vendor",
  // ⏰ Монголын цагийн бүс (UTC+8) — CURDATE()/NOW() өнөөдрийн зөв огноог буцаана
  timezone: "+08:00",
  dateStrings: true,
});

db.connect(err => {
  if (err) {
    console.log("\n❌ DB АЛДАА:", err.message);
    console.log("→ vendor.sql-ийг MySQL Workbench дээр ажиллуулсан уу?");
    console.log("→ MySQL Server асаалттай эсэхийг шалгана уу.\n");
  } else {
    console.log("✓ MySQL холбогдлоо");
    // Сесийн цагийн бүсийг МН болгож тогтооно (CURDATE() яг өнөөдрийн огноог өгнө)
    db.query("SET time_zone = '+08:00'", e => {
      if (e) console.log("⚠ time_zone тохируулж чадсангүй:", e.message);
      else   console.log("✓ Цагийн бүс: +08:00 (Улаанбаатар)");
    });
    db.query("SELECT CURDATE() AS today, NOW() AS nowTime", (e, r) => {
      if (!e && r.length) console.log(`✓ Серверийн өнөөдөр: ${r[0].today} (${r[0].nowTime})`);
    });
    db.query("SELECT userName, role FROM users", (e, r) => {
      if (e) console.log("⚠ users хүснэгт алдаа:", e.message);
      else   console.log("✓ Хэрэглэгчид:", r.map(u=>`${u.userName}(${u.role})`).join(", "));
    });
  }
});

const ok   = (res, r) => res.json({ success: true,  ...(r||{}) });
const fail = (res, e) => res.status(500).json({ success: false, error: e.message });

// ─── HEALTH ──────────────────────────────────────
app.get("/api/health", (req, res) => {
  db.query("SELECT COUNT(*) AS c FROM users", (e, r) =>
    e ? res.status(500).json({ ok:false, error:e.message }) : res.json({ ok:true, userCount:r[0].c }));
});

// ─── LOGIN ────────────────────────────────────────
app.post("/login", (req, res) => {
  const { userName, password } = req.body;
  if (!userName || !password)
    return res.json({ success:false, error:"Нэр болон нууц үг оруулна уу" });
  db.query(`SELECT u.*, e.eName FROM users u
            LEFT JOIN Employee e ON u.employeeID=e.employeeID
            WHERE u.userName=? AND u.Pass=?`, [userName, password], (err, r) => {
    if (err) return res.status(500).json({ success:false, error:"DB алдаа: "+err.message });
    if (r.length) {
      console.log(`✓ Login: ${userName} (${r[0].role})`);
      res.json({ success:true, role:r[0].role, userName:r[0].userName,
                 employeeID:r[0].employeeID, eName:r[0].eName });
    } else {
      console.log(`✗ Failed: ${userName}`);
      res.json({ success:false, error:"Нэр эсвэл нууц үг буруу" });
    }
  });
});

// ─── USER MANAGEMENT ─────────────────────────────
app.get("/api/users", (req, res) => {
  db.query(`SELECT u.userID, u.userName, u.role, u.employeeID, e.eName
            FROM users u LEFT JOIN Employee e ON u.employeeID=e.employeeID
            ORDER BY u.userName`, (e, r) => e ? fail(res,e) : res.json(r));
});
app.post("/api/users", (req, res) => {
  const { userName, password, role, employeeID } = req.body;
  if (!userName || !password) return fail(res, new Error("Нэр болон нууц үг шаардлагатай"));
  db.query("INSERT INTO users (userName, Pass, role, employeeID) VALUES (?,?,?,?)",
    [userName, password, role||'staff', employeeID||null],
    (e, r) => e ? fail(res,e) : ok(res, { id: r.insertId }));
});
app.put("/api/users/:id", (req, res) => {
  const { userName, password, role, employeeID } = req.body;
  if (password) {
    db.query("UPDATE users SET userName=?, Pass=?, role=?, employeeID=? WHERE userID=?",
      [userName, password, role||'staff', employeeID||null, req.params.id], e => e ? fail(res,e) : ok(res));
  } else {
    db.query("UPDATE users SET userName=?, role=?, employeeID=? WHERE userID=?",
      [userName, role||'staff', employeeID||null, req.params.id], e => e ? fail(res,e) : ok(res));
  }
});
app.delete("/api/users/all", (req, res) => {
  const keepUser = req.query.keepUser;
  const sql = keepUser ? "DELETE FROM users WHERE userName != ?" : "DELETE FROM users WHERE role != 'admin'";
  const params = keepUser ? [keepUser] : [];
  db.query(sql, params, e => e ? fail(res,e) : ok(res));
});
app.delete("/api/users/:id", (req, res) => {
  db.query("DELETE FROM users WHERE userID=?", [req.params.id], e => e ? fail(res,e) : ok(res));
});

// ─── OPTIONS ──────────────────────────────────────
app.get("/api/options", (req, res) => {
  const out = {};
  db.query("SELECT productID, pName, category FROM Product ORDER BY pName", (e1, products) => {
    out.products  = products || [];
    db.query("SELECT storeID, sName, city, phone FROM Store ORDER BY sName", (e2, stores) => {
      out.stores    = stores || [];
      db.query("SELECT employeeID, eName FROM Employee ORDER BY eName", (e3, emps) => {
        out.employees  = emps || [];
        out.categories = [...new Set((products||[]).map(p=>p.category).filter(Boolean))];
        res.json(out);
      });
    });
  });
});

// ─── ДЭЛГҮҮР ХУРДАН ХАЙХ ─────────────────────────
app.get("/api/stores/quick", (req, res) => {
  const q = (req.query.q||"").trim();
  if (q.length < 2) return res.json([]);
  db.query("SELECT storeID, sName, city, phone FROM Store WHERE sName LIKE ? OR city LIKE ? LIMIT 10",
    [`%${q}%`, `%${q}%`], (e, r) => e ? fail(res,e) : res.json(r));
});

// ─── STATS ────────────────────────────────────────
function buildFilter(q, dateField = "d.deliveryDate") {
  const c = [], p = [];
  if (q.from)      { c.push(`${dateField} >= ?`); p.push(q.from); }
  if (q.to)        { c.push(`${dateField} <= ?`); p.push(q.to); }
  if (q.storeID)   { c.push("d.storeID = ?");     p.push(q.storeID); }
  if (q.productID) { c.push("d.productID = ?");   p.push(q.productID); }
  if (q.quarter)   { c.push(`QUARTER(${dateField}) = ?`); p.push(q.quarter); }
  return { where: c.length ? "WHERE " + c.join(" AND ") : "", params: p };
}

app.get("/api/stats", (req, res) => {
  const f = buildFilter(req.query);
  db.query(`SELECT
      (SELECT COUNT(*) FROM Store)    AS totalStores,
      (SELECT COUNT(*) FROM Product)  AS totalProducts,
      (SELECT IFNULL(SUM(stock),0)    FROM Inventory) AS totalStock,
      IFNULL(SUM(d.totalPrice), 0) AS totalDelivered,
      IFNULL(SUM(d.quantity),   0) AS totalQuantity,
      COUNT(d.deliveryID)          AS deliveryCount,
      IFNULL(AVG(d.totalPrice), 0) AS avgDelivery,
      (SELECT IFNULL(SUM(amount),0)      FROM Payment)    AS totalPaid,
      (SELECT IFNULL(SUM(returnStock),0) FROM ReturnInventory) AS totalReturnStock,
      (SELECT IFNULL(SUM(totalAmount),0) FROM \`Return\`) AS totalReturned,
      (SELECT IFNULL(SUM(totalPrice),0)  FROM Delivery)
       - (SELECT IFNULL(SUM(totalAmount),0) FROM \`Return\`)
       - (SELECT IFNULL(SUM(amount),0)      FROM Payment) AS totalDebt
    FROM Delivery d ${f.where}`, f.params, (e, r) => e ? fail(res,e) : res.json(r[0]));
});

app.get("/api/trend", (req, res) => {
  const period = req.query.period || "month";
  const f = buildFilter(req.query);
  let label, group;
  if (period === "day")        { label = "DATE_FORMAT(d.deliveryDate,'%Y-%m-%d')"; group = label; }
  else if (period === "month") { label = "DATE_FORMAT(d.deliveryDate,'%Y-%m')";    group = label; }
  else if (period === "quarter"){ label = "CONCAT(YEAR(d.deliveryDate),'-Q',QUARTER(d.deliveryDate))"; group = "YEAR(d.deliveryDate),QUARTER(d.deliveryDate)"; }
  else                          { label = "YEAR(d.deliveryDate)"; group = label; }
  db.query(`SELECT ${label} AS label, IFNULL(SUM(d.totalPrice),0) AS totalSales,
            COUNT(d.deliveryID) AS saleCount FROM Delivery d ${f.where}
            GROUP BY ${group} ORDER BY ${group}`, f.params, (e, r) => e ? fail(res,e) : res.json(r));
});

app.get("/api/sales-by-store", (req, res) => {
  const f = buildFilter(req.query);
  db.query(`SELECT st.storeID, st.sName, st.city, IFNULL(SUM(d.totalPrice),0) AS totalSales,
            IFNULL(SUM(d.quantity),0) AS totalQuantity, COUNT(d.deliveryID) AS saleCount
            FROM Store st LEFT JOIN Delivery d ON st.storeID=d.storeID
            ${f.where} GROUP BY st.storeID ORDER BY totalSales DESC`,
    f.params, (e, r) => e ? fail(res,e) : res.json(r));
});

app.get("/api/sales-by-product", (req, res) => {
  const f = buildFilter(req.query);
  db.query(`SELECT p.productID, p.pName, p.category, IFNULL(SUM(d.totalPrice),0) AS totalSales,
            IFNULL(SUM(d.quantity),0) AS totalQuantity
            FROM Product p LEFT JOIN Delivery d ON p.productID=d.productID
            ${f.where} GROUP BY p.productID HAVING totalSales > 0 ORDER BY totalSales DESC`,
    f.params, (e, r) => e ? fail(res,e) : res.json(r));
});

app.get("/api/top-stores", (req, res) => {
  const f = buildFilter(req.query);
  db.query(`SELECT st.sName, st.city, IFNULL(SUM(d.totalPrice),0) AS totalSales,
            IFNULL(SUM(d.quantity),0) AS totalQuantity
            FROM Store st LEFT JOIN Delivery d ON st.storeID=d.storeID
            ${f.where} GROUP BY st.storeID ORDER BY totalSales DESC LIMIT 10`,
    f.params, (e, r) => e ? fail(res,e) : res.json(r));
});

app.get("/api/top-products", (req, res) => {
  const f = buildFilter(req.query);
  db.query(`SELECT p.pName, p.category, IFNULL(SUM(d.totalPrice),0) AS totalSales,
            IFNULL(SUM(d.quantity),0) AS totalQuantity
            FROM Product p LEFT JOIN Delivery d ON p.productID=d.productID
            ${f.where} GROUP BY p.productID ORDER BY totalSales DESC LIMIT 10`,
    f.params, (e, r) => e ? fail(res,e) : res.json(r));
});

app.get("/api/growth", (req, res) => {
  db.query(`SELECT
    (SELECT IFNULL(SUM(totalPrice),0) FROM Delivery WHERE DATE_FORMAT(deliveryDate,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m'))           AS thisMonth,
    (SELECT IFNULL(SUM(totalPrice),0) FROM Delivery WHERE DATE_FORMAT(deliveryDate,'%Y-%m')=DATE_FORMAT(DATE_SUB(CURDATE(),INTERVAL 1 MONTH),'%Y-%m')) AS lastMonth,
    (SELECT IFNULL(SUM(totalPrice),0) FROM Delivery WHERE YEAR(deliveryDate)=YEAR(CURDATE()) AND QUARTER(deliveryDate)=QUARTER(CURDATE()))    AS thisQuarter,
    (SELECT IFNULL(SUM(totalPrice),0) FROM Delivery WHERE YEAR(deliveryDate)=YEAR(CURDATE()) AND QUARTER(deliveryDate)=QUARTER(CURDATE())-1)  AS lastQuarter,
    (SELECT IFNULL(SUM(totalPrice),0) FROM Delivery WHERE YEAR(deliveryDate)=YEAR(CURDATE()))       AS thisYear,
    (SELECT IFNULL(SUM(totalPrice),0) FROM Delivery WHERE YEAR(deliveryDate)=YEAR(CURDATE())-1)     AS lastYear`,
    (err, rows) => {
      if (err) return fail(res, err);
      const r = rows[0];
      const pct = (c,p) => p>0 ? Number(((c-p)/p*100).toFixed(2)) : 0;
      res.json({ ...r, monthGrowth:pct(r.thisMonth,r.lastMonth),
        quarterGrowth:pct(r.thisQuarter,r.lastQuarter), yearGrowth:pct(r.thisYear,r.lastYear) });
    });
});

// ─── PRODUCTS ─────────────────────────────────────
app.get("/api/products", (req, res) => {
  db.query("SELECT * FROM Product ORDER BY pName", (e, r) => e ? fail(res,e) : res.json(r));
});
app.post("/api/products", (req, res) => {
  const { pName, category } = req.body;
  if (!pName) return fail(res, new Error("Барааны нэр шаардлагатай"));
  db.query("INSERT INTO Product (pName, category) VALUES (?,?)",
    [pName, category||null], (e, r) => e ? fail(res,e) : ok(res, { id: r.insertId }));
});
app.put("/api/products/:id", (req, res) => {
  const { pName, category } = req.body;
  db.query("UPDATE Product SET pName=?, category=? WHERE productID=?",
    [pName, category||null, req.params.id], e => e ? fail(res,e) : ok(res));
});
app.delete("/api/products/all", (req, res) => {
  db.query("DELETE FROM Product", e => e ? fail(res,e) : ok(res));
});
app.delete("/api/products/:id", (req, res) => {
  db.query("DELETE FROM Product WHERE productID=?", [req.params.id], e => e ? fail(res,e) : ok(res));
});

// Шинэ бараа + агуулахын үлдэгдэл нэгт
app.post("/api/products-with-stock", (req, res) => {
  const { pName, category, stock, expiryDate } = req.body;
  if (!pName) return fail(res, new Error("Барааны нэр шаардлагатай"));
  // Адилхан нэртэй бараа байвал шинэчлэх
  db.query("SELECT productID FROM Product WHERE pName=?", [pName], (e, existing) => {
    if (e) return fail(res, e);
    if (existing.length) {
      const pid = existing[0].productID;
      db.query(`INSERT INTO Inventory (productID, stock, expiryDate) VALUES (?,?,?)
                ON DUPLICATE KEY UPDATE stock=stock+VALUES(stock), expiryDate=VALUES(expiryDate)`,
        [pid, stock||0, expiryDate||null], e2 => e2 ? fail(res,e2) : ok(res,{productID:pid,merged:true}));
    } else {
      db.query("INSERT INTO Product (pName, category) VALUES (?,?)",
        [pName, category||null], (e2, r) => {
          if (e2) return fail(res, e2);
          const pid = r.insertId;
          db.query("INSERT INTO Inventory (productID, stock, expiryDate) VALUES (?,?,?)",
            [pid, stock||0, expiryDate||null], e3 => e3 ? fail(res,e3) : ok(res,{productID:pid}));
        });
    }
  });
});

// ─── INVENTORY ────────────────────────────────────
app.get("/api/inventory", (req, res) => {
  const search = req.query.search ? `%${req.query.search}%` : null;
  const sql = `SELECT p.productID, p.pName, p.category,
           IFNULL(i.stock, 0) AS stock, i.expiryDate,
           CASE WHEN i.expiryDate IS NULL            THEN 'none'
                WHEN i.expiryDate < CURDATE()        THEN 'expired'
                WHEN DATEDIFF(i.expiryDate, CURDATE()) <= 30 THEN 'soon'
                ELSE 'ok' END AS expiryStatus
    FROM Product p LEFT JOIN Inventory i ON p.productID = i.productID
    ${search ? "WHERE p.pName LIKE ? OR p.category LIKE ?" : ""}
    ORDER BY p.pName`;
  db.query(sql, search ? [search, search] : [], (e, r) => e ? fail(res,e) : res.json(r));
});

app.get("/api/inventory/summary", (req, res) => {
  db.query(`SELECT
    COUNT(*)                                                                         AS rowCount,
    IFNULL(SUM(i.stock), 0)                                                          AS totalUnits,
    SUM(CASE WHEN i.stock <= 0  THEN 1 ELSE 0 END)                                  AS emptyCount,
    SUM(CASE WHEN i.stock > 0 AND i.stock < 10 THEN 1 ELSE 0 END)                  AS lowStockCount,
    SUM(CASE WHEN i.expiryDate IS NOT NULL AND i.expiryDate < CURDATE() THEN 1 ELSE 0 END) AS expiredCount,
    SUM(CASE WHEN i.expiryDate IS NOT NULL AND i.expiryDate >= CURDATE()
             AND DATEDIFF(i.expiryDate, CURDATE()) <= 30 THEN 1 ELSE 0 END)         AS expiringSoon
    FROM Inventory i`, (e, r) => e ? fail(res,e) : res.json(r[0]));
});

app.post("/api/inventory", (req, res) => {
  const { productID, stock, expiryDate } = req.body;
  db.query(`INSERT INTO Inventory (productID, stock, expiryDate) VALUES (?,?,?)
            ON DUPLICATE KEY UPDATE stock=VALUES(stock), expiryDate=VALUES(expiryDate)`,
    [productID, stock||0, expiryDate||null], e => e ? fail(res,e) : ok(res));
});
app.put("/api/inventory/:productID", (req, res) => {
  const { stock, expiryDate } = req.body;
  db.query(`INSERT INTO Inventory (productID, stock, expiryDate) VALUES (?,?,?)
            ON DUPLICATE KEY UPDATE stock=VALUES(stock), expiryDate=VALUES(expiryDate)`,
    [req.params.productID, stock||0, expiryDate||null], e => e ? fail(res,e) : ok(res));
});
app.delete("/api/inventory/all", (req, res) => {
  db.query("UPDATE Inventory SET stock=0, expiryDate=NULL", e => e ? fail(res,e) : ok(res));
});
app.delete("/api/inventory/:productID", (req, res) => {
  db.query("DELETE FROM Inventory WHERE productID=?", [req.params.productID], e => e ? fail(res,e) : ok(res));
});

// ─── STOCK CHANGES (гэмтэл/хорогдол) ─────────────
app.get("/api/stock-changes", (req, res) => {
  db.query(`SELECT sc.*, p.pName FROM StockChange sc LEFT JOIN Product p ON sc.productID=p.productID
            ORDER BY sc.changeDate DESC, sc.changeID DESC`, (e, r) => e ? fail(res,e) : res.json(r));
});
app.post("/api/stock-changes", (req, res) => {
  const { productID, changeType, quantity, changeDate, reason } = req.body;
  const qty = Number(quantity)||0;
  db.query("INSERT INTO StockChange (productID, changeType, quantity, changeDate, reason) VALUES (?,?,?,?,?)",
    [productID, changeType, qty, changeDate||null, reason||null], (e, r) => {
      if (e) return fail(res, e);
      db.query("UPDATE Inventory SET stock = GREATEST(0, stock + ?) WHERE productID=?",
        [qty, productID], () => ok(res, { id: r.insertId }));
    });
});
app.delete("/api/stock-changes/all", (req, res) => {
  db.query("DELETE FROM StockChange", e => e ? fail(res,e) : ok(res));
});
app.delete("/api/stock-changes/:id", (req, res) => {
  db.query("SELECT * FROM StockChange WHERE changeID=?", [req.params.id], (e, r) => {
    if (e || !r.length) return fail(res, e || new Error("Not found"));
    const c = r[0];
    db.query("DELETE FROM StockChange WHERE changeID=?", [req.params.id], e2 => {
      if (e2) return fail(res, e2);
      db.query("UPDATE Inventory SET stock = GREATEST(0, stock - ?) WHERE productID=?",
        [Number(c.quantity)||0, c.productID], () => ok(res));
    });
  });
});

// ─── STORES ───────────────────────────────────────
app.get("/api/stores", (req, res) => {
  db.query("SELECT * FROM v_store_balance ORDER BY sName", (e, r) => e ? fail(res,e) : res.json(r));
});
app.post("/api/stores", (req, res) => {
  const { sName, address, city, manager, phone, openDate } = req.body;
  db.query("INSERT INTO Store (sName, address, city, manager, phone, openDate) VALUES (?,?,?,?,?,?)",
    [sName, address||null, city||null, manager||null, phone||null, openDate||null],
    (e, r) => e ? fail(res,e) : ok(res, { id: r.insertId }));
});
app.put("/api/stores/:id", (req, res) => {
  const { sName, address, city, manager, phone, openDate } = req.body;
  db.query("UPDATE Store SET sName=?, address=?, city=?, manager=?, phone=?, openDate=? WHERE storeID=?",
    [sName, address||null, city||null, manager||null, phone||null, openDate||null, req.params.id],
    e => e ? fail(res,e) : ok(res));
});
app.delete("/api/stores/all", (req, res) => {
  db.query("DELETE FROM Store", e => e ? fail(res,e) : ok(res));
});
app.delete("/api/stores/:id", (req, res) => {
  db.query("DELETE FROM Store WHERE storeID=?", [req.params.id], e => e ? fail(res,e) : ok(res));
});

app.get("/api/stores/:id/details", (req, res) => {
  const id = req.params.id;
  const out = {};
  db.query("SELECT * FROM v_store_balance WHERE storeID=?", [id], (e1, st) => {
    if (e1) return fail(res, e1);
    out.store = st[0] || null;
    db.query(`SELECT d.*, p.pName, e.eName AS employeeName FROM Delivery d
              LEFT JOIN Product p ON d.productID=p.productID
              LEFT JOIN Employee e ON d.employeeID=e.employeeID
              WHERE d.storeID=? ORDER BY d.deliveryDate DESC`, [id], (e2, deliveries) => {
      out.deliveries = deliveries || [];
      db.query(`SELECT r.*, p.pName, e.eName AS employeeName FROM \`Return\` r
                LEFT JOIN Product p ON r.productID=p.productID
                LEFT JOIN Employee e ON r.employeeID=e.employeeID
                WHERE r.storeID=? ORDER BY r.returnDate DESC`, [id], (e3, returns) => {
        out.returns = returns || [];
        db.query("SELECT * FROM Payment WHERE storeID=? ORDER BY paymentDate DESC", [id], (e4, payments) => {
          out.payments = payments || [];
          db.query(`SELECT sp.*, p.pName FROM StorePrice sp
                    LEFT JOIN Product p ON sp.productID=p.productID
                    WHERE sp.storeID=? ORDER BY p.pName`, [id], (e5, prices) => {
            out.prices = prices || [];
            res.json(out);
          });
        });
      });
    });
  });
});

// Store prices
app.post("/api/store-prices", (req, res) => {
  const { storeID, productID, agreedPrice, notes } = req.body;
  db.query(`INSERT INTO StorePrice (storeID, productID, agreedPrice, notes) VALUES (?,?,?,?)
            ON DUPLICATE KEY UPDATE agreedPrice=VALUES(agreedPrice), notes=VALUES(notes)`,
    [storeID, productID, agreedPrice||0, notes||null], e => e ? fail(res,e) : ok(res));
});
app.put("/api/store-prices/:storeID/:productID", (req, res) => {
  const { agreedPrice, notes } = req.body;
  db.query("UPDATE StorePrice SET agreedPrice=?, notes=? WHERE storeID=? AND productID=?",
    [agreedPrice||0, notes||null, req.params.storeID, req.params.productID], e => e ? fail(res,e) : ok(res));
});
app.delete("/api/store-prices/:storeID/:productID", (req, res) => {
  db.query("DELETE FROM StorePrice WHERE storeID=? AND productID=?",
    [req.params.storeID, req.params.productID], e => e ? fail(res,e) : ok(res));
});

// ─── DELIVERIES ───────────────────────────────────
app.get("/api/today-sales", (req, res) => {
  const empID = req.query.employeeID;
  const cond   = empID ? "AND d.employeeID=?" : "";
  const params = empID ? [empID] : [];
  db.query(`SELECT d.*, p.pName, p.category, st.sName AS storeName, st.city AS storeCity
            FROM Delivery d
            LEFT JOIN Product p  ON d.productID=p.productID
            LEFT JOIN Store   st ON d.storeID=st.storeID
            WHERE d.deliveryDate=CURDATE() ${cond}
            ORDER BY d.deliveryID DESC`, params, (e, r) => e ? fail(res,e) : res.json(r));
});

app.get("/api/deliveries", (req, res) => {
  const conds = [], params = [];
  if (req.query.search)     { conds.push("(p.pName LIKE ? OR st.sName LIKE ?)"); params.push(`%${req.query.search}%`,`%${req.query.search}%`); }
  if (req.query.from)       { conds.push("d.deliveryDate >= ?"); params.push(req.query.from); }
  if (req.query.to)         { conds.push("d.deliveryDate <= ?"); params.push(req.query.to); }
  if (req.query.storeID)    { conds.push("d.storeID = ?");       params.push(req.query.storeID); }
  if (req.query.productID)  { conds.push("d.productID = ?");     params.push(req.query.productID); }
  if (req.query.employeeID) { conds.push("d.employeeID = ?");    params.push(req.query.employeeID); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  db.query(`SELECT d.*, p.pName, p.category, st.sName AS storeName, st.phone AS storePhone,
                   st.city AS storeCity, e.eName AS employeeName
            FROM Delivery d
            LEFT JOIN Product  p  ON d.productID=p.productID
            LEFT JOIN Store    st ON d.storeID=st.storeID
            LEFT JOIN Employee e  ON d.employeeID=e.employeeID
            ${where} ORDER BY d.deliveryDate DESC, d.deliveryID DESC`,
    params, (e, r) => e ? fail(res,e) : res.json(r));
});

app.post("/api/deliveries", (req, res) => {
  const { storeID, productID, employeeID, quantity, unitPrice, deliveryDate, notes } = req.body;
  const qty   = Number(quantity)||0;
  const price = Number(unitPrice)||0;
  const total = qty * price;
  db.query(`INSERT INTO Delivery (storeID, productID, employeeID, quantity, unitPrice, totalPrice, deliveryDate, notes)
            VALUES (?,?,?,?,?,?,?,?)`,
    [storeID, productID, employeeID||null, qty, price, total, deliveryDate||null, notes||null],
    (e, r) => {
      if (e) return fail(res, e);
      // Агуулахаас хасах
      db.query("UPDATE Inventory SET stock = GREATEST(0, stock - ?) WHERE productID=?",
        [qty, productID], () => ok(res, { id: r.insertId }));
    });
});

app.put("/api/deliveries/:id", (req, res) => {
  const { storeID, productID, employeeID, quantity, unitPrice, deliveryDate, notes } = req.body;
  const newQty   = Number(quantity)||0;
  const newPrice = Number(unitPrice)||0;
  const total    = newQty * newPrice;
  // Эхлээд одоогийн хүргэлтийг авах
  db.query("SELECT productID, quantity FROM Delivery WHERE deliveryID=?", [req.params.id], (e, orig) => {
    if (e || !orig.length) return fail(res, e || new Error("Not found"));
    const origPid = orig[0].productID;
    const origQty = Number(orig[0].quantity)||0;
    db.query(`UPDATE Delivery SET storeID=?, productID=?, employeeID=?, quantity=?, unitPrice=?,
              totalPrice=?, deliveryDate=?, notes=? WHERE deliveryID=?`,
      [storeID, productID, employeeID||null, newQty, newPrice, total, deliveryDate||null, notes||null, req.params.id],
      e2 => {
        if (e2) return fail(res, e2);
        // Хуучин тоог буцаах, шинэ тоог хасах
        db.query("UPDATE Inventory SET stock = stock + ? WHERE productID=?", [origQty, origPid], () => {
          db.query("UPDATE Inventory SET stock = GREATEST(0, stock - ?) WHERE productID=?",
            [newQty, productID||origPid], () => ok(res));
        });
      });
  });
});

app.delete("/api/deliveries/all", (req, res) => {
  db.query("SELECT productID, quantity FROM Delivery", (e, rows) => {
    if (e) return fail(res, e);
    db.query("DELETE FROM Delivery", e2 => {
      if (e2) return fail(res, e2);
      let pending = rows.length;
      if (!pending) return ok(res);
      rows.forEach(r => db.query("UPDATE Inventory SET stock = stock + ? WHERE productID=?",
        [Number(r.quantity)||0, r.productID], () => { if (--pending === 0) ok(res); }));
    });
  });
});
app.delete("/api/deliveries/:id", (req, res) => {
  db.query("SELECT productID, quantity FROM Delivery WHERE deliveryID=?", [req.params.id], (e, r) => {
    if (e || !r.length) return fail(res, e || new Error("Not found"));
    const d = r[0];
    db.query("DELETE FROM Delivery WHERE deliveryID=?", [req.params.id], e2 => {
      if (e2) return fail(res, e2);
      // Агуулахд буцааж нэмэх
      db.query("UPDATE Inventory SET stock = stock + ? WHERE productID=?",
        [Number(d.quantity)||0, d.productID], () => ok(res));
    });
  });
});

// ─── БУЦААЛТ ─────────────────────────────────────
app.get("/api/returns", (req, res) => {
  const conds = [], params = [];
  if (req.query.storeID)    { conds.push("r.storeID = ?");    params.push(req.query.storeID); }
  if (req.query.employeeID) { conds.push("r.employeeID = ?"); params.push(req.query.employeeID); }
  if (req.query.date)       { conds.push("r.returnDate = ?"); params.push(req.query.date); }
  if (req.query.from)       { conds.push("r.returnDate >= ?");params.push(req.query.from); }
  if (req.query.to)         { conds.push("r.returnDate <= ?");params.push(req.query.to); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  db.query(`SELECT r.*, p.pName, p.category, st.sName AS storeName, st.city AS storeCity, e.eName AS employeeName
            FROM \`Return\` r
            LEFT JOIN Product  p  ON r.productID=p.productID
            LEFT JOIN Store    st ON r.storeID=st.storeID
            LEFT JOIN Employee e  ON r.employeeID=e.employeeID
            ${where} ORDER BY r.returnDate DESC, r.returnID DESC`,
    params, (e, rows) => e ? fail(res, e) : res.json(rows));
});

app.get("/api/today-returns", (req, res) => {
  const empID  = req.query.employeeID;
  const cond   = empID ? "AND r.employeeID=?" : "";
  const params = empID ? [empID] : [];
  db.query(`SELECT r.*, p.pName, st.sName AS storeName, st.city AS storeCity
            FROM \`Return\` r
            LEFT JOIN Product p  ON r.productID=p.productID
            LEFT JOIN Store   st ON r.storeID=st.storeID
            WHERE r.returnDate=CURDATE() ${cond}
            ORDER BY r.returnID DESC`, params, (e, rows) => e ? fail(res, e) : res.json(rows));
});

app.post("/api/returns", (req, res) => {
  const { storeID, productID, employeeID, quantity, unitPrice, returnDate, reason } = req.body;
  const qty   = Number(quantity)||0;
  const price = Number(unitPrice)||0;
  const total = qty * price;
  db.query(`INSERT INTO \`Return\` (storeID, productID, employeeID, quantity, unitPrice, totalAmount, returnDate, reason)
            VALUES (?,?,?,?,?,?,?,?)`,
    [storeID, productID, employeeID||null, qty, price, total, returnDate||null, reason||null],
    (e, r) => {
      if (e) return fail(res, e);
      // ⚠ Inventory-д нөлөөгүй — Буцаалтын тусдаа агуулахд нэмнэ
      db.query(`INSERT INTO ReturnInventory (productID, returnStock) VALUES (?, ?)
                ON DUPLICATE KEY UPDATE returnStock = returnStock + ?`,
        [productID, qty, qty], () => ok(res, { id: r.insertId }));
    });
});

app.put("/api/returns/:id", (req, res) => {
  const { storeID, productID, employeeID, quantity, unitPrice, returnDate, reason } = req.body;
  const newQty = Number(quantity)||0;
  const newPrice = Number(unitPrice)||0;
  const total = newQty * newPrice;
  db.query("SELECT productID, quantity FROM `Return` WHERE returnID=?", [req.params.id], (e, orig) => {
    if (e || !orig.length) return fail(res, e || new Error("Not found"));
    const origPid = orig[0].productID;
    const origQty = Number(orig[0].quantity)||0;
    db.query(`UPDATE \`Return\` SET storeID=?, productID=?, employeeID=?, quantity=?, unitPrice=?, totalAmount=?, returnDate=?, reason=? WHERE returnID=?`,
      [storeID, productID, employeeID||null, newQty, newPrice, total, returnDate||null, reason||null, req.params.id],
      e2 => {
        if (e2) return fail(res, e2);
        // ⚠ Inventory-д нөлөөгүй — ReturnInventory дахь хуучныг хасаж, шинийг нэмнэ
        db.query("UPDATE ReturnInventory SET returnStock = GREATEST(0, returnStock - ?) WHERE productID=?",
          [origQty, origPid], () => {
            db.query(`INSERT INTO ReturnInventory (productID, returnStock) VALUES (?, ?)
                      ON DUPLICATE KEY UPDATE returnStock = returnStock + ?`,
              [productID||origPid, newQty, newQty], () => ok(res));
          });
      });
  });
});

app.delete("/api/returns/all", (req, res) => {
  db.query("DELETE FROM `Return`", e => {
    if (e) return fail(res, e);
    // ⚠ Inventory-д нөлөөгүй — ReturnInventory-г тэглэнэ
    db.query("UPDATE ReturnInventory SET returnStock = 0", () => ok(res));
  });
});
app.delete("/api/returns/:id", (req, res) => {
  db.query("SELECT productID, quantity FROM `Return` WHERE returnID=?", [req.params.id], (e, r) => {
    if (e || !r.length) return fail(res, e || new Error("Not found"));
    const ret = r[0];
    db.query("DELETE FROM `Return` WHERE returnID=?", [req.params.id], e2 => {
      if (e2) return fail(res, e2);
      // ⚠ Inventory-д нөлөөгүй — ReturnInventory-оос хасна
      db.query("UPDATE ReturnInventory SET returnStock = GREATEST(0, returnStock - ?) WHERE productID=?",
        [Number(ret.quantity)||0, ret.productID], () => ok(res));
    });
  });
});

// ─── БУЦААЛТЫН АГУУЛАХ ────────────────────────────
app.get("/api/return-inventory", (req, res) => {
  db.query(`SELECT p.productID, p.pName, p.category,
              IFNULL(ri.returnStock, 0) AS returnStock
            FROM Product p
            LEFT JOIN ReturnInventory ri ON p.productID = ri.productID
            WHERE IFNULL(ri.returnStock, 0) > 0
            ORDER BY p.pName`, (e, r) => e ? fail(res,e) : res.json(r));
});

// ─── 14 ХОНОГИЙН ТОЙМ ────────────────────────────
app.get("/api/summary/14days", (req, res) => {
  const empID  = req.query.employeeID;
  const eCond  = empID ? "AND d.employeeID=?" : "";
  const eCond2 = empID ? "AND r.employeeID=?" : "";
  const p1 = empID ? [empID] : [];
  const p2 = empID ? [empID] : [];
  db.query(`SELECT p.productID, p.pName, p.category,
              IFNULL(SUM(d.quantity),   0) AS deliveredQty,
              IFNULL(SUM(d.totalPrice), 0) AS deliveredAmt
            FROM Product p
            LEFT JOIN Delivery d ON p.productID=d.productID
              AND d.deliveryDate >= DATE_SUB(CURDATE(), INTERVAL 14 DAY) ${eCond}
            GROUP BY p.productID HAVING deliveredQty > 0
            ORDER BY deliveredAmt DESC`, p1, (e, rows) => {
    if (e) return fail(res, e);
    db.query(`SELECT productID,
                IFNULL(SUM(quantity),   0) AS returnedQty,
                IFNULL(SUM(totalAmount),0) AS returnedAmt
              FROM \`Return\`
              WHERE returnDate >= DATE_SUB(CURDATE(), INTERVAL 14 DAY) ${eCond2}
              GROUP BY productID`, p2, (e2, rets) => {
      if (e2) return fail(res, e2);
      const retMap = {};
      rets.forEach(r => { retMap[r.productID] = r; });
      const result = rows.map(p => {
        const rq = Number(retMap[p.productID]?.returnedQty)||0;
        const ra = Number(retMap[p.productID]?.returnedAmt)||0;
        return { ...p, returnedQty:rq, returnedAmt:ra,
                 netQty: p.deliveredQty - rq, netAmt: p.deliveredAmt - ra };
      });
      res.json(result);
    });
  });
});


// ─── PAYMENTS (гараар) ────────────────────────────
app.get("/api/payments", (req, res) => {
  const conds = [], params = [];
  if (req.query.storeID) { conds.push("p.storeID = ?");      params.push(req.query.storeID); }
  if (req.query.from)    { conds.push("p.paymentDate >= ?");  params.push(req.query.from); }
  if (req.query.to)      { conds.push("p.paymentDate <= ?");  params.push(req.query.to); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  db.query(`SELECT p.*, st.sName AS storeName FROM Payment p
            LEFT JOIN Store st ON p.storeID=st.storeID ${where}
            ORDER BY p.paymentDate DESC, p.paymentID DESC`,
    params, (e, r) => e ? fail(res,e) : res.json(r));
});
app.post("/api/payments", (req, res) => {
  const { storeID, amount, paymentDate, notes } = req.body;
  db.query("INSERT INTO Payment (storeID, amount, paymentDate, notes) VALUES (?,?,?,?)",
    [storeID, amount||0, paymentDate||null, notes||null],
    (e, r) => e ? fail(res,e) : ok(res, { id: r.insertId }));
});
app.put("/api/payments/:id", (req, res) => {
  const { amount, paymentDate, notes } = req.body;
  db.query("UPDATE Payment SET amount=?, paymentDate=?, notes=? WHERE paymentID=?",
    [amount||0, paymentDate||null, notes||null, req.params.id], e => e ? fail(res,e) : ok(res));
});
app.delete("/api/payments/all", (req, res) => {
  db.query("DELETE FROM Payment", e => e ? fail(res,e) : ok(res));
});
app.delete("/api/payments/:id", (req, res) => {
  db.query("DELETE FROM Payment WHERE paymentID=?", [req.params.id], e => e ? fail(res,e) : ok(res));
});

// ─── EMPLOYEES (зөвхөн унших — auth-д хэрэглэнэ) ─
app.get("/api/employees", (req, res) => {
  db.query("SELECT * FROM Employee ORDER BY eName", (e, r) => e ? fail(res,e) : res.json(r));
});
app.post("/api/employees", (req, res) => {
  const { eName, phone } = req.body;
  db.query("INSERT INTO Employee (eName, phone) VALUES (?,?)",
    [eName, phone||null], (e, r) => e ? fail(res,e) : ok(res,{id:r.insertId}));
});
app.put("/api/employees/:id", (req, res) => {
  const { eName, phone } = req.body;
  db.query("UPDATE Employee SET eName=?, phone=? WHERE employeeID=?",
    [eName, phone||null, req.params.id], e => e ? fail(res,e) : ok(res));
});
app.delete("/api/employees/:id", (req, res) => {
  db.query("DELETE FROM Employee WHERE employeeID=?", [req.params.id], e => e ? fail(res,e) : ok(res));
});

// ─── CSV ТАЙЛАН ──────────────────────────────────
app.get("/api/export/csv", (req, res) => {
  const conds = [], params = [];
  if (req.query.search)    { conds.push("(p.pName LIKE ? OR st.sName LIKE ?)"); params.push(`%${req.query.search}%`,`%${req.query.search}%`); }
  if (req.query.from)      { conds.push("d.deliveryDate >= ?"); params.push(req.query.from); }
  if (req.query.to)        { conds.push("d.deliveryDate <= ?"); params.push(req.query.to); }
  if (req.query.storeID)   { conds.push("d.storeID = ?");       params.push(req.query.storeID); }
  if (req.query.productID) { conds.push("d.productID = ?");     params.push(req.query.productID); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  db.query(`SELECT d.deliveryID, d.deliveryDate, st.sName, p.pName, p.category,
                   e.eName, d.quantity, d.unitPrice, d.totalPrice
            FROM Delivery d
            LEFT JOIN Store    st ON d.storeID=st.storeID
            LEFT JOIN Product  p  ON d.productID=p.productID
            LEFT JOIN Employee e  ON d.employeeID=e.employeeID
            ${where} ORDER BY d.deliveryDate DESC`,
    params, (err, rows) => {
      if (err) return fail(res, err);
      const headers = ["№","Огноо","Дэлгүүр","Бүтээгдэхүүн","Ангилал","Хүргэгч","Тоо","Нэгж үнэ","Нийт"];
      const cols    = ["deliveryID","deliveryDate","sName","pName","category","eName","quantity","unitPrice","totalPrice"];
      const esc = v => { if (v==null) return ""; v=String(v); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; };
      const lines = [headers.join(",")];
      let qty=0, amt=0;
      rows.forEach(r => { lines.push(cols.map(c=>esc(r[c])).join(",")); qty+=Number(r.quantity)||0; amt+=Number(r.totalPrice)||0; });
      lines.push(""); lines.push(`,,,,,НИЙЛБЭР,${qty},,${amt}`);
      res.setHeader("Content-Type","text/csv; charset=utf-8");
      res.setHeader("Content-Disposition","attachment; filename=delivery_report.csv");
      res.write("\uFEFF"); res.end(lines.join("\n"));
    });
});

// ─── ХАЙЛТЫН САНАЛ ───────────────────────────────
app.get("/api/search-suggest", (req, res) => {
  const q = `%${req.query.q||""}%`;
  db.query(`(SELECT 'product' AS type, productID AS id, pName AS name, category AS extra FROM Product WHERE pName LIKE ?)
    UNION ALL
    (SELECT 'store' AS type, storeID AS id, sName AS name, city AS extra FROM Store WHERE sName LIKE ?)
    LIMIT 20`, [q, q], (e, r) => e ? fail(res,e) : res.json(r));
});

// ════════════════════════════════════════════════════════════════
// ─── ТООЦООНЫ ХААЛТ (SETTLEMENT) ─────────────────────────────────
// ════════════════════════════════════════════════════════════════

// Хаасан тооцооны түүх — заавал шүүлтүүрээр
app.get("/api/settlements", (req, res) => {
  const conds = [], params = [];
  if (req.query.storeID) { conds.push("st.storeID = ?"); params.push(req.query.storeID); }
  if (req.query.from)    { conds.push("st.periodEnd >= ?"); params.push(req.query.from); }
  if (req.query.to)      { conds.push("st.periodStart <= ?"); params.push(req.query.to); }
  if (req.query.status)  { conds.push("st.status = ?"); params.push(req.query.status); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  db.query(`SELECT st.*, s.sName AS storeName, s.city AS storeCity
            FROM Settlement st
            LEFT JOIN Store s ON st.storeID = s.storeID
            ${where}
            ORDER BY st.closedAt DESC, st.settlementID DESC`,
    params, (e, r) => e ? fail(res,e) : res.json(r));
});

// Хаахаас өмнө тооцооны урьдчилсан тооцоог харах
// /api/settlements/preview?storeID=1&periodStart=2024-01-01&periodEnd=2024-01-31
app.get("/api/settlements/preview", (req, res) => {
  const { storeID, periodStart, periodEnd } = req.query;
  if (!storeID || !periodStart || !periodEnd)
    return fail(res, new Error("storeID, periodStart, periodEnd шаардлагатай"));

  const sql = `SELECT
      IFNULL((SELECT SUM(d.totalPrice)  FROM Delivery d
              WHERE d.storeID=? AND d.settlementID IS NULL
              AND d.deliveryDate BETWEEN ? AND ?), 0) AS totalDelivered,
      IFNULL((SELECT COUNT(d.deliveryID) FROM Delivery d
              WHERE d.storeID=? AND d.settlementID IS NULL
              AND d.deliveryDate BETWEEN ? AND ?), 0) AS deliveryCount,
      IFNULL((SELECT SUM(r.totalAmount) FROM \`Return\` r
              WHERE r.storeID=? AND r.settlementID IS NULL
              AND r.returnDate BETWEEN ? AND ?), 0) AS totalReturned,
      IFNULL((SELECT COUNT(r.returnID) FROM \`Return\` r
              WHERE r.storeID=? AND r.settlementID IS NULL
              AND r.returnDate BETWEEN ? AND ?), 0) AS returnCount,
      IFNULL((SELECT SUM(p.amount)      FROM Payment p
              WHERE p.storeID=? AND p.settlementID IS NULL
              AND p.paymentDate BETWEEN ? AND ?), 0) AS totalPaid,
      IFNULL((SELECT COUNT(p.paymentID)  FROM Payment p
              WHERE p.storeID=? AND p.settlementID IS NULL
              AND p.paymentDate BETWEEN ? AND ?), 0) AS paymentCount`;
  const args = [storeID, periodStart, periodEnd,
                storeID, periodStart, periodEnd,
                storeID, periodStart, periodEnd,
                storeID, periodStart, periodEnd,
                storeID, periodStart, periodEnd,
                storeID, periodStart, periodEnd];
  db.query(sql, args, (e, r) => {
    if (e) return fail(res, e);
    const row = r[0];
    const finalDebt = Number(row.totalDelivered) - Number(row.totalReturned) - Number(row.totalPaid);
    res.json({ ...row, finalDebt: +finalDebt.toFixed(2),
               canClose: Math.abs(finalDebt) < 0.01 });
  });
});

// Тооцоо ХААХ (зөвхөн finalDebt = 0 байвал)
app.post("/api/settlements/close", (req, res) => {
  const { storeID, periodStart, periodEnd, closedBy, notes } = req.body;
  if (!storeID || !periodStart || !periodEnd)
    return fail(res, new Error("storeID, periodStart, periodEnd шаардлагатай"));

  // 1) Тухайн хугацааны нийт дүнг тооцох (зөвхөн settlementID IS NULL)
  const sumSql = `SELECT
      IFNULL((SELECT SUM(d.totalPrice)  FROM Delivery d
              WHERE d.storeID=? AND d.settlementID IS NULL
              AND d.deliveryDate BETWEEN ? AND ?), 0) AS totalDelivered,
      IFNULL((SELECT SUM(r.totalAmount) FROM \`Return\` r
              WHERE r.storeID=? AND r.settlementID IS NULL
              AND r.returnDate BETWEEN ? AND ?), 0) AS totalReturned,
      IFNULL((SELECT SUM(p.amount)      FROM Payment p
              WHERE p.storeID=? AND p.settlementID IS NULL
              AND p.paymentDate BETWEEN ? AND ?), 0) AS totalPaid`;
  const sumArgs = [storeID, periodStart, periodEnd,
                   storeID, periodStart, periodEnd,
                   storeID, periodStart, periodEnd];
  db.query(sumSql, sumArgs, (e1, r1) => {
    if (e1) return fail(res, e1);
    const row = r1[0];
    const totalDelivered = Number(row.totalDelivered)||0;
    const totalReturned  = Number(row.totalReturned)||0;
    const totalPaid      = Number(row.totalPaid)||0;
    const finalDebt      = totalDelivered - totalReturned - totalPaid;

    // Хязгаар: үлдсэн өртэй бол хаах боломжгүй
    if (Math.abs(finalDebt) > 0.01) {
      return res.json({ success: false,
        error: `үлдэгдэл ₮${finalDebt.toLocaleString('mn-MN')} байна. 100% төлөгдсөний дараа хаах боломжтой.`,
        finalDebt });
    }
    if (totalDelivered === 0 && totalReturned === 0 && totalPaid === 0) {
      return res.json({ success: false,
        error: "Тухайн хугацаанд гүйлгээ алга. Хаах шаардлагагүй." });
    }

    // 2) Settlement бичлэг үүсгэх
    const insSql = `INSERT INTO Settlement
      (storeID, periodStart, periodEnd, totalDelivered, totalReturned, totalPaid,
       finalDebt, status, closedBy, closedAt, notes)
      VALUES (?,?,?,?,?,?,?, 'closed', ?, NOW(), ?)`;
    db.query(insSql, [storeID, periodStart, periodEnd,
                      totalDelivered, totalReturned, totalPaid, finalDebt,
                      closedBy || null, notes || null], (e2, r2) => {
      if (e2) return fail(res, e2);
      const settlementID = r2.insertId;

      // 3) Тухайн хугацааны Delivery, Return, Payment-д settlementID тэмдэглэх
      const tagDel = `UPDATE Delivery SET settlementID=? WHERE storeID=? AND settlementID IS NULL
                      AND deliveryDate BETWEEN ? AND ?`;
      const tagRet = `UPDATE \`Return\` SET settlementID=? WHERE storeID=? AND settlementID IS NULL
                      AND returnDate BETWEEN ? AND ?`;
      const tagPay = `UPDATE Payment SET settlementID=? WHERE storeID=? AND settlementID IS NULL
                      AND paymentDate BETWEEN ? AND ?`;
      db.query(tagDel, [settlementID, storeID, periodStart, periodEnd], () => {
        db.query(tagRet, [settlementID, storeID, periodStart, periodEnd], () => {
          db.query(tagPay, [settlementID, storeID, periodStart, periodEnd], () => {
            ok(res, { settlementID, totalDelivered, totalReturned, totalPaid, finalDebt });
          });
        });
      });
    });
  });
});

// Тооцоо буцаан НЭЭХ (admin only — алдаа засахад)
app.delete("/api/settlements/:id/reopen", (req, res) => {
  const id = req.params.id;
  // Эхлээд гүйлгээний бүртгэлийн settlementID-г NULL болгох
  db.query("UPDATE Delivery SET settlementID=NULL WHERE settlementID=?", [id], () => {
    db.query("UPDATE `Return` SET settlementID=NULL WHERE settlementID=?", [id], () => {
      db.query("UPDATE Payment SET settlementID=NULL WHERE settlementID=?", [id], () => {
        // Дараа нь Settlement бичлэгийг устгах
        db.query("DELETE FROM Settlement WHERE settlementID=?", [id],
          e => e ? fail(res,e) : ok(res));
      });
    });
  });
});

// Тооцооны дэлгэрэнгүй харах (хэвлэх/баталгаажуулах хуудсанд хэрэглэнэ)
app.get("/api/settlements/:id/details", (req, res) => {
  const id = req.params.id;
  db.query(`SELECT st.*, s.sName AS storeName, s.city AS storeCity, s.phone AS storePhone, s.manager AS storeManager
            FROM Settlement st LEFT JOIN Store s ON st.storeID=s.storeID
            WHERE st.settlementID=?`, [id], (e1, sRows) => {
    if (e1) return fail(res, e1);
    if (!sRows.length) return fail(res, new Error("Settlement олдсонгүй"));
    const out = { settlement: sRows[0] };
    db.query(`SELECT d.*, p.pName, p.category, e.eName AS employeeName
              FROM Delivery d
              LEFT JOIN Product  p ON d.productID=p.productID
              LEFT JOIN Employee e ON d.employeeID=e.employeeID
              WHERE d.settlementID=? ORDER BY d.deliveryDate`, [id], (e2, dels) => {
      out.deliveries = dels || [];
      db.query(`SELECT r.*, p.pName, e.eName AS employeeName
                FROM \`Return\` r
                LEFT JOIN Product  p ON r.productID=p.productID
                LEFT JOIN Employee e ON r.employeeID=e.employeeID
                WHERE r.settlementID=? ORDER BY r.returnDate`, [id], (e3, rets) => {
        out.returns = rets || [];
        db.query(`SELECT * FROM Payment WHERE settlementID=? ORDER BY paymentDate`, [id], (e4, pays) => {
          out.payments = pays || [];
          res.json(out);
        });
      });
    });
  });
});

app.listen(3000, () => console.log("✓ http://localhost:3000"));