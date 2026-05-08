-- ════════════════════════════════════════════════════════════════
--  VENDOR DATABASE — шинээр бичсэн (Номин дэлгүүрүүд)
--  MySQL Workbench дээр энэ файлыг бүхэлд нь нээж "Run" дарна уу.
-- ════════════════════════════════════════════════════════════════

DROP DATABASE IF EXISTS vendor;
CREATE DATABASE vendor DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE vendor;

-- Сесийн цагийн бүсийг Монголд тохируулна (UTC+8)
SET time_zone = '+08:00';

-- ─── EMPLOYEE ────────────────────────────────────────────────────
CREATE TABLE Employee (
  employeeID INT AUTO_INCREMENT PRIMARY KEY,
  eName      VARCHAR(100) NOT NULL,
  phone      VARCHAR(20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── USERS ───────────────────────────────────────────────────────
CREATE TABLE users (
  userID     INT AUTO_INCREMENT PRIMARY KEY,
  userName   VARCHAR(50)  NOT NULL UNIQUE,
  Pass       VARCHAR(100) NOT NULL,
  role       VARCHAR(20)  NOT NULL DEFAULT 'staff',
  employeeID INT,
  CONSTRAINT fk_user_emp FOREIGN KEY (employeeID)
    REFERENCES Employee(employeeID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── STORE ───────────────────────────────────────────────────────
CREATE TABLE Store (
  storeID  INT AUTO_INCREMENT PRIMARY KEY,
  sName    VARCHAR(150) NOT NULL,
  address  VARCHAR(255),
  city     VARCHAR(80),
  manager  VARCHAR(100),
  phone    VARCHAR(20),
  openDate DATE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── PRODUCT ─────────────────────────────────────────────────────
CREATE TABLE Product (
  productID INT AUTO_INCREMENT PRIMARY KEY,
  pName     VARCHAR(150) NOT NULL,
  category  VARCHAR(80)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── INVENTORY (бараа тус бүрд нэг мөр) ─────────────────────────
CREATE TABLE Inventory (
  productID  INT NOT NULL PRIMARY KEY,
  stock      INT NOT NULL DEFAULT 0,
  expiryDate DATE,
  CONSTRAINT fk_inv_prod FOREIGN KEY (productID)
    REFERENCES Product(productID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── DELIVERY (хүргэлт/борлуулалт) ──────────────────────────────
CREATE TABLE Delivery (
  deliveryID   INT AUTO_INCREMENT PRIMARY KEY,
  storeID      INT NOT NULL,
  productID    INT NOT NULL,
  employeeID   INT,
  quantity     INT            NOT NULL DEFAULT 0,
  unitPrice    DECIMAL(12,2)  NOT NULL DEFAULT 0,
  totalPrice   DECIMAL(14,2)  NOT NULL DEFAULT 0,
  deliveryDate DATE,
  notes        TEXT,
  INDEX idx_del_date  (deliveryDate),
  INDEX idx_del_store (storeID),
  INDEX idx_del_prod  (productID),
  CONSTRAINT fk_del_store FOREIGN KEY (storeID)    REFERENCES Store(storeID)       ON DELETE CASCADE,
  CONSTRAINT fk_del_prod  FOREIGN KEY (productID)  REFERENCES Product(productID)   ON DELETE CASCADE,
  CONSTRAINT fk_del_emp   FOREIGN KEY (employeeID) REFERENCES Employee(employeeID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── RETURN (буцаалт) — Return нь reserved word тул backtick хэрэгтэй
CREATE TABLE `Return` (
  returnID    INT AUTO_INCREMENT PRIMARY KEY,
  storeID     INT NOT NULL,
  productID   INT NOT NULL,
  employeeID  INT,
  quantity    INT            NOT NULL DEFAULT 0,
  unitPrice   DECIMAL(12,2)  NOT NULL DEFAULT 0,
  totalAmount DECIMAL(14,2)  NOT NULL DEFAULT 0,
  returnDate  DATE,
  reason      TEXT,
  INDEX idx_ret_date  (returnDate),
  INDEX idx_ret_store (storeID),
  INDEX idx_ret_prod  (productID),
  CONSTRAINT fk_ret_store FOREIGN KEY (storeID)    REFERENCES Store(storeID)       ON DELETE CASCADE,
  CONSTRAINT fk_ret_prod  FOREIGN KEY (productID)  REFERENCES Product(productID)   ON DELETE CASCADE,
  CONSTRAINT fk_ret_emp   FOREIGN KEY (employeeID) REFERENCES Employee(employeeID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── RETURN INVENTORY (буцаалтын тусдаа агуулах) ───────────────
CREATE TABLE ReturnInventory (
  productID   INT NOT NULL PRIMARY KEY,
  returnStock INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_retinv_prod FOREIGN KEY (productID)
    REFERENCES Product(productID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── PAYMENT (төлбөр) ───────────────────────────────────────────
CREATE TABLE Payment (
  paymentID   INT AUTO_INCREMENT PRIMARY KEY,
  storeID     INT NOT NULL,
  amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  paymentDate DATE,
  notes       TEXT,
  INDEX idx_pay_store (storeID),
  INDEX idx_pay_date  (paymentDate),
  CONSTRAINT fk_pay_store FOREIGN KEY (storeID)
    REFERENCES Store(storeID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── STOCK CHANGE (гэмтэл/хорогдол лог) ─────────────────────────
CREATE TABLE StockChange (
  changeID   INT AUTO_INCREMENT PRIMARY KEY,
  productID  INT NOT NULL,
  changeType VARCHAR(50),
  quantity   INT NOT NULL DEFAULT 0,
  changeDate DATE,
  reason     TEXT,
  INDEX idx_sc_date (changeDate),
  CONSTRAINT fk_sc_prod FOREIGN KEY (productID)
    REFERENCES Product(productID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── STORE PRICE (дэлгүүр-бараа тохирсон үнэ) ──────────────────
CREATE TABLE StorePrice (
  storeID     INT NOT NULL,
  productID   INT NOT NULL,
  agreedPrice DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes       TEXT,
  PRIMARY KEY (storeID, productID),
  CONSTRAINT fk_sp_store FOREIGN KEY (storeID)   REFERENCES Store(storeID)     ON DELETE CASCADE,
  CONSTRAINT fk_sp_prod  FOREIGN KEY (productID) REFERENCES Product(productID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── VIEW: v_store_balance (дэлгүүрийн өрийн харагдац) ──────────
CREATE OR REPLACE VIEW v_store_balance AS
SELECT
  s.storeID, s.sName, s.address, s.city, s.manager, s.phone, s.openDate,
  IFNULL((SELECT SUM(d.totalPrice)  FROM Delivery  d WHERE d.storeID = s.storeID), 0) AS totalDelivered,
  IFNULL((SELECT COUNT(d.deliveryID) FROM Delivery d WHERE d.storeID = s.storeID), 0) AS deliveryCount,
  IFNULL((SELECT SUM(r.totalAmount) FROM `Return`  r WHERE r.storeID = s.storeID), 0) AS totalReturned,
  IFNULL((SELECT SUM(p.amount)      FROM Payment   p WHERE p.storeID = s.storeID), 0) AS totalPaid,
  ( IFNULL((SELECT SUM(d.totalPrice)  FROM Delivery d WHERE d.storeID = s.storeID), 0)
  - IFNULL((SELECT SUM(r.totalAmount) FROM `Return` r WHERE r.storeID = s.storeID), 0)
  - IFNULL((SELECT SUM(p.amount)      FROM Payment  p WHERE p.storeID = s.storeID), 0)
  ) AS balance
FROM Store s;

-- ════════════════════════════════════════════════════════════════
--  SEED DATA
-- ════════════════════════════════════════════════════════════════

-- Ажилтан
INSERT INTO Employee (eName, phone) VALUES
('Админ',         '99119911'),
('Борлуулагч 1',  '99220011');

-- Хэрэглэгч (нэвтрэх): admin/admin123, staff1/123
INSERT INTO users (userName, Pass, role, employeeID) VALUES
('admin',  'admin123', 'admin', 1),
('staff1', '123',      'staff', 2);

-- ─── ДЭЛГҮҮР (39) ───────────────────────────────────────────────
INSERT INTO Store (sName, city) VALUES
('Номин Энхэт Билэг',                'Улаанбаатар'),
('Номин Москва /Хөрс/',              'Улаанбаатар'),
('Номин 1-р хороолол /Өнөр плаза/',  'Улаанбаатар'),
('Номин Сентоза',                    'Улаанбаатар'),
('Номин Драгон',                     'Улаанбаатар'),
('Номин Зүүнмод',                    'Зүүнмод'),
('Номин Андууд',                     'Улаанбаатар'),
('Номин Зүүн',                       'Улаанбаатар'),
('Номин Вайт хилл',                  'Улаанбаатар'),
('Номин Скай таун',                  'Улаанбаатар'),
('Номин Юнайтед',                    'Улаанбаатар'),
('Номин Өнөр хороолол',              'Улаанбаатар'),
('Номин 32-ын тойрог',               'Улаанбаатар'),
('Номин 13-р хороолол',              'Улаанбаатар'),
('Номин УИД',                        'Улаанбаатар'),
('Номин Плаза',                      'Улаанбаатар'),
('Номин И шоп',                      'Улаанбаатар'),
('Номин Наадам центр',               'Улаанбаатар'),
('Номин Седар Юнайт',                'Улаанбаатар'),
('Номин Яармаг',                     'Улаанбаатар'),
('Номин Нисэх',                      'Улаанбаатар'),
('Номин УБИ',                        'Улаанбаатар'),
('Номин 10-р хороолол',              'Улаанбаатар'),
('Номин Зүүн 4 зам /Оргил/',         'Улаанбаатар'),
('Номин Нарны хороолол',             'Улаанбаатар'),
('Номин Жуков',                      'Улаанбаатар'),
('Номин Нарны гүүр',                 'Улаанбаатар'),
('Номин Аз жаргал /Хангай/',         'Улаанбаатар'),
('Номин 7 буудал',                   'Улаанбаатар'),
('Номин Их монгол',                  'Улаанбаатар'),
('Номин 11-р хороолол',              'Улаанбаатар'),
('Номин Нарны зам',                  'Улаанбаатар'),
('Номин Ривер гарден',               'Улаанбаатар'),
('Номин Шүр',                        'Улаанбаатар'),
('Номин Эко экспресс дорнод',        'Улаанбаатар'),
('Номин Сэлбэ',                      'Улаанбаатар'),
('Номин Рапид',                      'Улаанбаатар'),
('Номин Хүүхдийн 100',               'Улаанбаатар'),
('Номин Архангай',                   'Архангай');

-- ════════════════════════════════════════════════════════════════
--  Шалгах
-- ════════════════════════════════════════════════════════════════
SELECT COUNT(*) AS storeCount FROM Store;
SELECT userName, role FROM users;
