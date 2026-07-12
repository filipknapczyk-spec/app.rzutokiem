const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const bcrypt = require("bcrypt");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const csrf = require("csurf");
const csrfProtection = csrf({
  cookie: { httpOnly: true, secure: IS_PRODUCTION, signed: true },
});

// --- KONFIGURACJA BEZPIECZEŃSTWA ---
const COOKIE_SECRET = process.env.COOKIE_SECRET || "super-tajny-klucz-fallback";
app.use(
  helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }),
);
app.use(cookieParser(COOKIE_SECRET));
app.use(express.json({ limit: "50mb" }));

// Globalna funkcja sanitize (dostępna wszędzie)
const sanitize = (name) =>
    name ? String(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, "") : "";

// Ochrona przed brute-force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Za dużo prób logowania. Spróbuj za 15 minut.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Ścieżki do plików danych
const configPath = path.join(__dirname, "config.json");
const companiesPath = path.join(__dirname, "companies.json");
const usersPath = path.join(__dirname, "users.json");

// Inicjalizacja plików (jeśli nie istnieją)
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        adminLogin: "superadmin",
        adminPass:
          "$2b$10$CBMQ/7tOPd/qBQL9rTjQSu2gJTen4Am3oBz4J31JoWZo4IKfzptHm",
      },
      null,
      2,
    ),
  );
}
if (!fs.existsSync(companiesPath)) fs.writeFileSync(companiesPath, "[]");
if (!fs.existsSync(usersPath)) fs.writeFileSync(usersPath, "[]");

const fileStore = require("./fileStore");

// Pomocnicze: sprawdzenie unikalności e-maila w całej aplikacji
async function isEmailTaken(email, excludeId = null) {
  const normalized = email.toLowerCase();
  const companies = await fileStore.readJSON(companiesPath, []);
  const users = await fileStore.readJSON(usersPath, []);
  const inCompanies = companies.some(
    (c) => c.adminEmail === normalized && c.id !== excludeId,
  );
  const inUsers = users.some(
    (u) => u.email === normalized && u.id !== excludeId,
  );
  return inCompanies || inUsers;
}

// --- MIDDLEWARE AUTORYZACJI ---
const checkAuth = (req, res, next) => {
  const token = req.signedCookies.authToken;
  if (token) {
    req.user = token;
    // Backward compat: devId = companyId (dla endpointów danych/plików)
    if (req.user.role !== "superadmin" && req.user.companyId) {
      req.user.devId = req.user.companyId;
    }
    next();
  } else {
    if (req.accepts("html")) {
      res.redirect("/index.html");
    } else {
      res.status(401).json({ error: "Nieautoryzowany dostęp" });
    }
  }
};

// Middleware sprawdzający uprawnienia do panelu
const checkPermission = (perm) => (req, res, next) => {
  const u = req.user;
  if (u.role === "superadmin") return next();
  if (u.role === "companyAdmin") return next();
  if (u.role === "user" && u.permissions && u.permissions.includes(perm))
    return next();
  if (req.accepts("html")) return res.redirect("/dashboard.html");
  return res.status(403).json({ error: "Brak uprawnień" });
};

// --- SERWOWANIE PLIKÓW UPLOADS (CHRONIONE) ---
app.get(/^\/uploads\/([^\/]+)\/(.*)$/, checkAuth, (req, res) => {
  const requestDevId = req.params[0];
  const filePath = req.params[1];
  if (req.user.role === "superadmin" || req.user.devId === requestDevId) {
    const safePath = path.normalize(
      path.join(__dirname, "uploads", requestDevId, filePath),
    );
    if (!safePath.startsWith(path.join(__dirname, "uploads", requestDevId))) {
      return res.status(403).send("Próba ataku.");
    }
    if (fs.existsSync(safePath)) res.sendFile(safePath);
    else res.status(404).send("Plik nie istnieje");
  } else {
    res.status(403).send("Brak dostępu do plików tej firmy.");
  }
});

// --- PUBLICZNE STRONY ---
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/index.html", (req, res) =>
  res.sendFile(path.join(__dirname, "index.html")),
);

// --- CHRONIONE STRONY ---
app.get("/dashboard.html", checkAuth, (req, res) =>
  res.sendFile(path.join(__dirname, "dashboard.html")),
);

app.get("/admin.html", checkAuth, checkPermission("admin"), (req, res) =>
  res.sendFile(path.join(__dirname, "admin.html")),
);

app.get("/developer.html", checkAuth, checkPermission("sales"), (req, res) =>
  res.sendFile(path.join(__dirname, "developer.html")),
);

app.get("/superadmin.html", checkAuth, (req, res) => {
  if (req.user.role !== "superadmin") return res.redirect("/dashboard.html");
  res.sendFile(path.join(__dirname, "superadmin.html"));
});

app.get(
  "/inwestycje.html",
  checkAuth,
  checkPermission("inwestycje"),
  (req, res) => res.sendFile(path.join(__dirname, "inwestycje.html")),
);

app.get("/projekt.html", checkAuth, checkPermission("projekt"), (req, res) =>
  res.sendFile(path.join(__dirname, "projekt.html")),
);

app.get("/kontakty.html", checkAuth, checkPermission("kontakty"), (req, res) =>
  res.sendFile(path.join(__dirname, "kontakty.html")),
);

app.get("/usterki.html", checkAuth, checkPermission("usterki"), (req, res) =>
  res.sendFile(path.join(__dirname, "usterki.html")),
);

app.get(
  "/harmonogram.html",
  checkAuth,
  checkPermission("harmonogram"),
  (req, res) => res.sendFile(path.join(__dirname, "harmonogram.html")),
);

app.get(
  "/zakres.html",
  checkAuth,
  checkPermission("zakres"),
  (req, res) => res.sendFile(path.join(__dirname, "zakres.html")),
);

app.get("/company-admin.html", checkAuth, (req, res) => {
  if (req.user.role !== "companyAdmin" && req.user.role !== "superadmin")
    return res.redirect("/dashboard.html");
  res.sendFile(path.join(__dirname, "company-admin.html"));
});

// CSRF token
app.get("/api/csrf-token", csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Blokada bezpośredniego dostępu do HTML
app.use((req, res, next) => {
  if (req.path.endsWith(".html"))
    return res.status(403).send("Bezpośredni dostęp zabroniony.");
  next();
});
app.use(express.static(__dirname));

// --- MULTER (KONFIGURACJA UPLOADU) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let { devId, investId, buildingId, type, floorId } = req.body;
    if (req.user.role !== "superadmin") devId = req.user.devId;
    if (!devId || !investId) return cb(new Error("Brak danych"), null);
    const safeDevId = sanitize(devId);
    const safeInvestId = sanitize(investId);
    let aptNumber = req.body.aptNumber;
    const folderMap = { km: "cards_km", ki: "cards_ki", kz: "KZ", contract: "contracts" };

    let dir;
    if (type === "floorPlan") {
      // Nowa architektura: rzuty trafiają do _floors/ na poziomie inwestycji
      dir = path.join(__dirname, "uploads", safeDevId, safeInvestId, "_floors");
    } else {
      // Pliki lokali (km, ki, kz, contract) — nadal per-budynek
      if (!buildingId) return cb(new Error("Brak buildingId"), null);
      const safeBuildingId = sanitize(buildingId);
      let subFolder = folderMap[type] || "misc";
      if (type === "kz") subFolder = `KZ/mieszkanie_${sanitize(aptNumber)}`;
      dir = path.join(__dirname, "uploads", safeDevId, safeInvestId, safeBuildingId, subFolder);
    }
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const { type, floorName, aptNumber } = req.body;
    file.originalname = Buffer.from(file.originalname, "latin1").toString("utf8");
    if (type === "floorPlan") {
      cb(null, `${sanitize(floorName)}.jpg`);
    } else if (type === "contract" || type === "kz") {
      cb(null, sanitize(file.originalname));
    } else {
      cb(null, `apt_${sanitize(aptNumber)}.pdf`);
    }
  },
});
const upload = multer({ storage });

// ============================================================
// --- LOGOWANIE I WYLOGOWANIE ---
// ============================================================

app.post("/api/login", loginLimiter, async (req, res) => {
  const { login, password } = req.body;
  let user = null;

  // 1. Superadmin (specjalny login tekstowy, nie e-mail)
  const config = await fileStore.readJSON(configPath, { adminLogin: "superadmin", adminPass: "" });
  if (login === config.adminLogin || login === process.env.ADMIN_LOGIN) {
    const match = await bcrypt.compare(password, config.adminPass);
    if (match) user = { role: "superadmin", name: "SuperAdmin" };
  }

  // 2. Administrator firmy (e-mail w companies.json)
  if (!user) {
    const companies = await fileStore.readJSON(companiesPath, []);
    const company = companies.find((c) => c.adminEmail === login.toLowerCase());
    if (company) {
      const match = await bcrypt.compare(password, company.adminPasswordHash);
      if (match)
        user = {
          role: "companyAdmin",
          companyId: company.id,
          name: company.name,
          email: company.adminEmail,
        };
    }
  }

  // 3. Pracownik firmy (e-mail w users.json)
  if (!user) {
    const users = await fileStore.readJSON(usersPath, []);
    const found = users.find((u) => u.email === login.toLowerCase());
    if (found) {
      const match = await bcrypt.compare(password, found.password);
      if (match)
        user = {
          role: "user",
          companyId: found.companyId,
          userId: found.id,
          email: found.email,
          name: found.name,
          permissions: found.permissions || [],
        };
    }
  }

  if (user) {
    const cookieOptions = {
      httpOnly: true,
      signed: true,
      maxAge: 24 * 60 * 60 * 1000,
      secure: IS_PRODUCTION, // true na serwerze (HTTPS), false lokalnie (HTTP)
      sameSite: IS_PRODUCTION ? "strict" : "lax",
    };
    res.cookie("authToken", user, cookieOptions);
    res.json({ success: true, redirectUrl: "/dashboard.html" });
  } else {
    res.status(401).json({ success: false, message: "Błędny login lub hasło" });
  }
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("authToken");
  res.json({ success: true });
});

// Zmiana hasła przez administratora firmy
app.post("/api/change-password", checkAuth, async (req, res) => {
  if (req.user.role !== "companyAdmin")
    return res.status(403).json({ error: "Tylko administrator firmy może zmienić hasło." });

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: "Podaj obecne i nowe hasło." });
  if (newPassword.length < 6)
    return res.status(400).json({ error: "Nowe hasło musi mieć co najmniej 6 znaków." });

  const companies = await fileStore.readJSON(companiesPath, []);
  const company = companies.find((c) => c.id === req.user.companyId);
  if (!company)
    return res.status(404).json({ error: "Nie znaleziono firmy." });

  const match = await bcrypt.compare(currentPassword, company.adminPasswordHash);
  if (!match)
    return res.status(401).json({ error: "Obecne hasło jest nieprawidłowe." });

  await fileStore.updateJSON(companiesPath, async (comps) => {
    const compToUpdate = comps.find((c) => c.id === req.user.companyId);
    if (compToUpdate) {
      compToUpdate.adminPasswordHash = await bcrypt.hash(newPassword, 10);
    }
    return comps;
  });
  res.json({ success: true, message: "Hasło zostało zmienione pomyślnie." });
});

app.get("/api/me", checkAuth, async (req, res) => {
  const u = req.user;
  let companyApps = [
    "sales",
    "admin",
    "inwestycje",
    "projekt",
    "kontakty",
    "usterki",
    "harmonogram",
    "company",
  ];
  if (u.role !== "superadmin" && (u.companyId || u.devId)) {
    try {
      const companies = await fileStore.readJSON(companiesPath, []);
      const company = companies.find((c) => c.id === (u.companyId || u.devId));
      if (company && company.apps) {
        companyApps = company.apps;
      }
    } catch (e) {}
  }

  res.json({
    role: u.role,
    name: u.name,
    email: u.email || null,
    companyId: u.companyId || null,
    devId: u.devId || null,
    userId: u.userId || null,
    permissions: u.permissions || [],
    companyApps: companyApps,
  });
});

// ============================================================
// --- ZARZĄDZANIE FIRMAMI (tylko SuperAdmin) ---
// ============================================================

app.get("/api/companies", checkAuth, async (req, res) => {
  if (req.user.role !== "superadmin")
    return res.status(403).json({ error: "Brak uprawnień" });
  const companies = await fileStore.readJSON(companiesPath, []);
  
  const responseData = await Promise.all(
    companies.map(async (c) => {
      // Policz aktualne inwestycje dewelopera
      let currentInvestments = 0;
      try {
        const dataPath = path.join(__dirname, "data", `${c.id}.json`);
        const data = await fileStore.readJSON(dataPath, {});
        currentInvestments = Object.keys(data.investments || {}).length;
      } catch (e) {}
      return {
        id: c.id,
        name: c.name,
        adminEmail: c.adminEmail,
        apps: c.apps || [
          "sales",
          "admin",
          "inwestycje",
          "projekt",
          "kontakty",
          "usterki",
          "harmonogram",
          "company",
        ],
        maxInvestments: c.maxInvestments ?? 1,
        currentInvestments,
      };
    })
  );
  
  res.json(responseData);
});

app.post("/api/companies", checkAuth, async (req, res) => {
  if (req.user.role !== "superadmin")
    return res.status(403).json({ error: "Brak uprawnień" });
  const { name, adminEmail, adminPassword } = req.body;
  if (!name || !adminEmail || !adminPassword)
    return res.status(400).json({ error: "Wypełnij wszystkie pola" });
  
  const isTaken = await isEmailTaken(adminEmail);
  if (isTaken)
    return res.status(409).json({ error: "Ten e-mail jest już zajęty" });
    
  const hashed = await bcrypt.hash(adminPassword, 10);
  
  await fileStore.updateJSON(companiesPath, (companies) => {
    const newCompany = {
      id: "DEV_" + Date.now(),
      name,
      adminEmail: adminEmail.toLowerCase(),
      adminPasswordHash: hashed,
      apps: [
        "sales",
        "admin",
        "inwestycje",
        "projekt",
        "kontakty",
        "usterki",
        "harmonogram",
        "company",
      ],
      maxInvestments: 1,
    };
    companies.push(newCompany);
    return companies;
  }, []);
  
  res.json({ success: true });
});

// Aktualizacja limitu inwestycji
app.post(
  "/api/companies/:id/max-investments",
  checkAuth,
  csrfProtection,
  async (req, res) => {
    if (req.user.role !== "superadmin")
      return res.status(403).json({ error: "Brak uprawnień" });
    const { maxInvestments } = req.body;
    const limit = parseInt(maxInvestments, 10);
    if (isNaN(limit) || limit < 1)
      return res
        .status(400)
        .json({ error: "Podaj prawidłową liczbę (min. 1)" });

    const companies = await fileStore.readJSON(companiesPath, []);
    const company = companies.find((c) => c.id === req.params.id);
    if (!company)
      return res.status(404).json({ error: "Nie znaleziono firmy" });

    // Sprawdź ile inwestycji firma już ma
    let currentInvestments = 0;
    try {
      const dataPath = path.join(__dirname, "data", `${company.id}.json`);
      const data = await fileStore.readJSON(dataPath, {});
      currentInvestments = Object.keys(data.investments || {}).length;
    } catch (e) {}

    if (limit < currentInvestments) {
      return res.status(409).json({
        error: `Nie można zmniejszyć limitu do ${limit}. Firma ma już ${currentInvestments} ${currentInvestments === 1 ? "inwestycję" : currentInvestments < 5 ? "inwestycje" : "inwestycji"}. Deweloper musi najpierw usunąć inwestycje w swoim panelu.`,
        currentInvestments,
      });
    }

    await fileStore.updateJSON(companiesPath, (comps) => {
      const comp = comps.find((c) => c.id === req.params.id);
      if (comp) comp.maxInvestments = limit;
      return comps;
    });
    
    res.json({ success: true, maxInvestments: limit });
  },
);

// Endpoint sprawdzający limit inwestycji dla dewelopera
app.get("/api/investments/:devId/limit", checkAuth, async (req, res) => {
  const { devId } = req.params;
  if (req.user.role !== "superadmin" && req.user.devId !== devId) {
    return res.status(403).json({ error: "Brak uprawnień" });
  }
  const companies = await fileStore.readJSON(companiesPath, []);
  const company = companies.find((c) => c.id === devId);
  const maxInvestments = company ? (company.maxInvestments ?? 1) : 1;
  let currentInvestments = 0;
  try {
    const dataPath = path.join(__dirname, "data", `${devId}.json`);
    const data = await fileStore.readJSON(dataPath, {});
    currentInvestments = Object.keys(data.investments || {}).length;
  } catch (e) {}
  res.json({
    maxInvestments,
    currentInvestments,
    canAdd: currentInvestments < maxInvestments,
  });
});

app.delete("/api/companies/:id", checkAuth, async (req, res) => {
  if (req.user.role !== "superadmin")
    return res.status(403).json({ error: "Brak uprawnień" });
  
  await fileStore.updateJSON(companiesPath, (comps) => {
    return comps.filter((c) => c.id !== req.params.id);
  });
  
  res.json({ success: true });
});

// Edycja danych firmy (nazwa + e-mail admina) przez superadmina
app.patch("/api/companies/:id", checkAuth, csrfProtection, async (req, res) => {
  if (req.user.role !== "superadmin")
    return res.status(403).json({ error: "Brak uprawnień" });
  const { name, adminEmail } = req.body;
  if (!name || !adminEmail)
    return res.status(400).json({ error: "Podaj nazwę firmy i e-mail admina." });

  const normalizedEmail = adminEmail.toLowerCase().trim();
  // Sprawdź unikalność e-maila (z wyłączeniem tej firmy)
  const isTaken = await isEmailTaken(normalizedEmail, req.params.id);
  if (isTaken)
    return res.status(409).json({ error: "Ten e-mail jest już używany przez inną firmę lub użytkownika." });

  await fileStore.updateJSON(companiesPath, (comps) => {
    const company = comps.find((c) => c.id === req.params.id);
    if (company) {
      company.name = name.trim();
      company.adminEmail = normalizedEmail;
    }
    return comps;
  });
  res.json({ success: true });
});

app.post("/api/companies/:id/reset-password", checkAuth, async (req, res) => {
  if (req.user.role !== "superadmin")
    return res.status(403).json({ error: "Brak uprawnień" });
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4)
    return res.status(400).json({ error: "Hasło musi mieć min. 4 znaki" });

  const hashed = await bcrypt.hash(newPassword, 10);
  await fileStore.updateJSON(companiesPath, (comps) => {
    const company = comps.find((c) => c.id === req.params.id);
    if (company) company.adminPasswordHash = hashed;
    return comps;
  });
  res.json({ success: true });
});

app.post("/api/companies/:id/apps", checkAuth, async (req, res) => {
  if (req.user.role !== "superadmin")
    return res.status(403).json({ error: "Brak uprawnień" });
  const { apps } = req.body;
  if (!Array.isArray(apps))
    return res.status(400).json({ error: "Nieprawidłowy format aplikacji" });

  await fileStore.updateJSON(companiesPath, (comps) => {
    const company = comps.find((c) => c.id === req.params.id);
    if (company) company.apps = apps;
    return comps;
  });
  res.json({ success: true });
});

// Zapis metadanych inwestycji (adres, działki)
app.post(
  "/api/investments/:devId/meta",
  checkAuth,
  csrfProtection,
  async (req, res) => {
    const { devId } = req.params;
    if (req.user.role !== "superadmin" && req.user.devId !== devId) {
      return res.status(403).json({ error: "Brak uprawnień" });
    }
    const { investmentName, meta } = req.body;
    if (!investmentName || typeof meta !== "object") {
      return res.status(400).json({ error: "Nieprawidłowe dane" });
    }
    const dataDir = path.join(__dirname, "data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const dataPath = path.join(dataDir, `${devId}.json`);
    
    try {
      await fileStore.updateJSON(dataPath, (db) => {
        if (!db.investmentsMeta) db.investmentsMeta = {};
        db.investmentsMeta[investmentName] = meta;
        return db;
      }, { investments: {}, investmentsMeta: {}, deletedInvestments: [] });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Błąd zapisu" });
    }
  },
);

// ============================================================
// --- ZARZĄDZANIE PRACOWNIKAMI (CompanyAdmin / SuperAdmin) ---
// ============================================================

app.get("/api/users", checkAuth, async (req, res) => {
  if (req.user.role !== "superadmin" && req.user.role !== "companyAdmin")
    return res.status(403).json({ error: "Brak uprawnień" });
  const users = await fileStore.readJSON(usersPath, []);
  const filtered =
    req.user.role === "superadmin"
      ? users
      : users.filter((u) => u.companyId === req.user.companyId);
  res.json(
    filtered.map((u) => ({
      id: u.id,
      companyId: u.companyId,
      email: u.email,
      name: u.name,
      permissions: u.permissions,
    })),
  );
});

app.post("/api/users", checkAuth, async (req, res) => {
  if (req.user.role !== "superadmin" && req.user.role !== "companyAdmin")
    return res.status(403).json({ error: "Brak uprawnień" });
  let { companyId, email, password, name, permissions } = req.body;
  if (req.user.role === "companyAdmin") companyId = req.user.companyId;
  if (!email || !password || !name || !companyId)
    return res.status(400).json({ error: "Wypełnij wszystkie pola" });
    
  const isTaken = await isEmailTaken(email);
  if (isTaken)
    return res.status(409).json({ error: "Ten e-mail jest już zajęty" });
    
  const hashed = await bcrypt.hash(password, 10);
  
  await fileStore.updateJSON(usersPath, (users) => {
    users.push({
      id: "USR_" + Date.now(),
      companyId,
      email: email.toLowerCase(),
      password: hashed,
      name,
      permissions: permissions || [],
    });
    return users;
  }, []);
  
  res.json({ success: true });
});

app.delete("/api/users/:id", checkAuth, async (req, res) => {
  if (req.user.role !== "superadmin" && req.user.role !== "companyAdmin")
    return res.status(403).json({ error: "Brak uprawnień" });
    
  const users = await fileStore.readJSON(usersPath, []);
  const user = users.find((u) => u.id === req.params.id);
  if (!user)
    return res.status(404).json({ error: "Nie znaleziono użytkownika" });
  if (req.user.role === "companyAdmin" && user.companyId !== req.user.companyId)
    return res.status(403).json({ error: "Brak uprawnień" });
    
  await fileStore.updateJSON(usersPath, (currentUsers) => {
    return currentUsers.filter((u) => u.id !== req.params.id);
  });
  
  res.json({ success: true });
});

// ============================================================
// --- ENDPOINTY DANYCH INWESTYCJI ---
// ============================================================

app.get("/api/data/:devId", checkAuth, async (req, res) => {
  if (req.user.role !== "superadmin" && req.user.devId !== req.params.devId) {
    return res.status(403).json({ error: "Brak dostępu do tych danych!" });
  }
  const dataPath = path.join(__dirname, "data", `${req.params.devId}.json`);
  const { data: db, version } = await fileStore.readJSON(
    dataPath,
    { investments: {}, investmentsMeta: {}, deletedInvestments: [] },
    true  // withVersion=true → zwraca {data, version}
  );

  // AUTO-MIGRACJA dla starych środowisk bez _floors
  if (db && db.investments) {
    Object.keys(db.investments).forEach(inv => {
      let iData = db.investments[inv];
      if (!iData._floors) iData._floors = {};
      Object.keys(iData).forEach(key => {
        if (key.startsWith("_") || key === "globalConfig" || key === "deleted" || key === "defaultZoom") return;
        let bObj = iData[key];
        if (typeof bObj === "object" && bObj !== null) {
          Object.keys(bObj).forEach(floorName => {
            let fObj = bObj[floorName];
            // w starych budynkach rzuty to obiekty z tabelą "apartments" (lub listą pdf etc)
            if (typeof fObj === "object" && fObj !== null) {
              if (!iData._floors[floorName]) {
                iData._floors[floorName] = fObj;
                fObj.building = key; // zachowanie nazwy budynku
                fObj.group = "nad";  // stary domyślny
              }
            }
          });
          delete iData[key];
        }
      });
    });
  }

  // _dbVersion trafia do frontendu – przechowywany i odsyłany przy zapisie
  res.json({ ...db, _dbVersion: version });
});

app.post("/api/save/:devId", checkAuth, csrfProtection, async (req, res) => {
  if (req.user.role !== "superadmin" && req.user.devId !== req.params.devId) {
    return res.status(403).json({ error: "Brak uprawnień" });
  }
  const dataDir = path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const dataPath = path.join(dataDir, `${req.params.devId}.json`);

  const { _dbVersion: clientVersion, ...body } = req.body;
  try {
    const result = await fileStore.updateJSON(dataPath, (existing) => {
      // Zachowaj deletedInvestments z serwera (klient nie zarządza tą listą)
      body.deletedInvestments = existing.deletedInvestments || [];
      return body;
    }, { investments: {}, investmentsMeta: {}, deletedInvestments: [] }, clientVersion || null);
    // Odsyłamy nową wersję pliku – frontend ją przechowuje do kolejnego zapisu
    res.json({ success: true, _dbVersion: result.version });
  } catch (err) {
    if (err.code === 'CONFLICT_VERSION') {
      return res.status(409).json({
        error: "Dane zostały zmienione przez innego użytkownika od czasu ostatniego odświeżenia. Odśwież stronę, aby pobrać aktualne dane, a następnie ponów import.",
        conflict: true
      });
    }
    console.error("[Save] Błąd zapisu:", err);
    res.status(500).send("Błąd");
  }
});

// ============================================================
// --- GRANULARNY ZAPIS DANYCH (Zabezpieczenie przed lost-update) ---
// ============================================================

app.post("/api/save-apt/:devId", checkAuth, csrfProtection, async (req, res) => {
  if (req.user.role !== "superadmin" && req.user.devId !== req.params.devId) {
    return res.status(403).json({ error: "Brak uprawnień" });
  }
  const { devId } = req.params;
  const { investId, buildingId, floorId, aptData } = req.body;
  const aptsToSave = req.body.aptsToSave || [aptData]; // obsługa jednego lub wielu (dla powiązanych)
  
  if (!investId || !buildingId || (!floorId && !req.body.aptsToSave) || (!aptData && !req.body.aptsToSave)) {
    return res.status(400).json({ error: "Brakuje danych do identyfikacji mieszkania." });
  }

  const dataPath = path.join(__dirname, "data", `${devId}.json`);
  let updatedVersions = {};

  try {
    await fileStore.updateJSON(dataPath, (db) => {
      if (!db.investments) db.investments = {};
      if (!db.investments[investId]) db.investments[investId] = {};
      
      // Krok 1: Walidacja wersji wszystkich zapisywanych lokali
      aptsToSave.forEach(apt => {
        if (!apt) return;
        let dbApt = null;
        
        // Szukaj aktualnego stanu lokalu w bazie
        Object.keys(db.investments[investId]).forEach(b => {
          Object.keys(db.investments[investId][b]).forEach(f => {
            if (db.investments[investId][b][f].apartments) {
              const found = db.investments[investId][b][f].apartments.find(a => a.id === apt.id);
              if (found) dbApt = found;
            }
          });
        });

        if (dbApt) {
          const dbVer = dbApt.version || 0;
          const clientVer = apt.version || 0;
          if (dbVer !== clientVer) {
            const err = new Error("Conflict");
            err.code = "CONFLICT";
            err.aptNumber = dbApt.number;
            throw err;
          }
          apt.version = dbVer + 1;
        } else {
          apt.version = 1;
        }
        updatedVersions[apt.id] = apt.version;
      });

      // Krok 2: Zapisanie zmian w bazie
      aptsToSave.forEach(apt => {
        if (!apt) return;
        let targetBuilding = buildingId;
        let targetFloor = floorId;
        let found = false;
        
        Object.keys(db.investments[investId]).forEach(b => {
          Object.keys(db.investments[investId][b]).forEach(f => {
            if (db.investments[investId][b][f].apartments) {
              const idx = db.investments[investId][b][f].apartments.findIndex(a => a.id === apt.id);
              if (idx !== -1) {
                targetBuilding = b;
                targetFloor = f;
                found = true;
                db.investments[investId][b][f].apartments[idx] = apt;
              }
            }
          });
        });
        
        if (!found && targetBuilding && targetFloor) {
          if (!db.investments[investId][targetBuilding]) db.investments[investId][targetBuilding] = {};
          if (!db.investments[investId][targetBuilding][targetFloor]) db.investments[investId][targetBuilding][targetFloor] = { apartments: [] };
          if (!db.investments[investId][targetBuilding][targetFloor].apartments) db.investments[investId][targetBuilding][targetFloor].apartments = [];
          
          db.investments[investId][targetBuilding][targetFloor].apartments.push(apt);
        }
      });
      
      return db;
    }, { investments: {}, investmentsMeta: {}, deletedInvestments: [] });
    
    res.json({ success: true, updatedVersions });
  } catch (err) {
    if (err.code === "CONFLICT") {
      return res.status(409).json({
        error: `Lokal nr ${err.aptNumber} został zmodyfikowany w międzyczasie przez innego użytkownika. Odśwież stronę, aby pobrać aktualne dane.`
      });
    }
    console.error("[Granular Save Apt] Błąd zapisu: ", err);
    res.status(500).send("Błąd zapisu");
  }
});

app.post("/api/delete-apt/:devId", checkAuth, csrfProtection, async (req, res) => {
  if (req.user.role !== "superadmin" && req.user.devId !== req.params.devId) {
    return res.status(403).json({ error: "Brak uprawnień" });
  }
  const { devId } = req.params;
  const { investId, buildingId, floorId, aptId } = req.body;

  if (!investId || !buildingId || !floorId || !aptId) {
    return res.status(400).json({ error: "Brakuje parametrów mieszkania." });
  }

  const dataPath = path.join(__dirname, "data", `${devId}.json`);

  try {
    await fileStore.updateJSON(dataPath, (db) => {
      if (
        db.investments &&
        db.investments[investId] &&
        db.investments[investId][buildingId] &&
        db.investments[investId][buildingId][floorId] &&
        db.investments[investId][buildingId][floorId].apartments
      ) {
        db.investments[investId][buildingId][floorId].apartments = 
          db.investments[investId][buildingId][floorId].apartments.filter(a => a.id !== aptId);
      }
      return db;
    }, { investments: {}, investmentsMeta: {}, deletedInvestments: [] });
    res.send("OK");
  } catch (err) {
    res.status(500).send("Błąd");
  }
});

// ============================================================
// --- ZARZĄDZANIE STRUKTURĄ PLIKÓW ---
// ============================================================

app.post("/api/rename-investment", checkAuth, csrfProtection, (req, res) => {
  let { devId, oldName, newName } = req.body;
  if (req.user.role !== "superadmin") devId = req.user.devId;
  oldName = sanitize(oldName);
  newName = sanitize(newName);
  const oldPath = path.join(__dirname, "uploads", devId, oldName);
  const newPath = path.join(__dirname, "uploads", devId, newName);
  if (fs.existsSync(oldPath)) {
    fs.rename(oldPath, newPath, (err) => {
      if (err) return res.status(500).send("Błąd");
      res.send("OK");
    });
  } else res.send("OK");
});

// SOFT DELETE: Przeń inwestycję do kosza (bez usuwania plików)
app.post("/api/delete-investment", checkAuth, csrfProtection, async (req, res) => {
  let { devId, investId } = req.body;
  if (req.user.role !== "superadmin") devId = req.user.devId;

  const dataPath = path.join(__dirname, "data", `${devId}.json`);
  let permanentlyDeleteFiles = false;

  try {
    await fileStore.updateJSON(dataPath, (db) => {
      if (!db.deletedInvestments) db.deletedInvestments = [];
      if (!db.investmentsMeta) db.investmentsMeta = {};

      if (!db.investments[investId]) {
        throw new Error("NOT_FOUND");
      }

      const hasBuildings = Object.keys(db.investments[investId]).length > 0;

      if (hasBuildings) {
        db.deletedInvestments.push({
          name: investId,
          deletedAt: new Date().toISOString(),
          data: db.investments[investId],
          meta: db.investmentsMeta[investId] || {},
        });
      } else {
        permanentlyDeleteFiles = true;
      }

      delete db.investments[investId];
      delete db.investmentsMeta[investId];

      return db;
    }, { investments: {}, investmentsMeta: {}, deletedInvestments: [] });

    if (permanentlyDeleteFiles) {
      const uploadPath = path.join(__dirname, "uploads", devId, sanitize(investId));
      if (fs.existsSync(uploadPath)) {
        fs.rm(uploadPath, { recursive: true, force: true }, () => {});
      }
    }

    res.json({ success: true });
  } catch (err) {
    if (err.message === "NOT_FOUND") return res.status(404).json({ error: "Inwestycja nie istnieje" });
    res.status(500).json({ error: "Błąd zapisu" });
  }
});

// Przywróć inwestycję z kosza
app.post("/api/restore-investment", checkAuth, csrfProtection, async (req, res) => {
  let { devId, investId } = req.body;
  if (req.user.role !== "superadmin") devId = req.user.devId;

  const dataPath = path.join(__dirname, "data", `${devId}.json`);

  try {
    const companies = await fileStore.readJSON(companiesPath, []);
    const company = companies.find((c) => c.id === devId);
    const maxInvestments = company ? (company.maxInvestments ?? 1) : 1;

    await fileStore.updateJSON(dataPath, (db) => {
      if (!db.deletedInvestments) db.deletedInvestments = [];

      const idx = db.deletedInvestments.findIndex((d) => d.name === investId);
      if (idx === -1) throw new Error("NOT_FOUND");

      const currentCount = Object.keys(db.investments || {}).length;
      if (currentCount >= maxInvestments) {
        throw new Error("LIMIT_REACHED");
      }

      const item = db.deletedInvestments[idx];
      db.investments[item.name] = item.data;
      db.investmentsMeta[item.name] = item.meta || {};
      db.deletedInvestments.splice(idx, 1);

      return db;
    }, { investments: {}, investmentsMeta: {}, deletedInvestments: [] });

    res.json({ success: true });
  } catch (err) {
    if (err.message === "NOT_FOUND") return res.status(404).json({ error: "Nie znaleziono w koszu" });
    if (err.message === "LIMIT_REACHED") return res.status(409).json({ error: "Osiągnięto limit aktywnych inwestycji. Zwiększ limit lub usuń jedną z aktywnych inwestycji." });
    res.status(500).json({ error: "Błąd zapisu" });
  }
});

// Pobierz kosz inwestycji
app.get("/api/deleted-investments/:devId", checkAuth, async (req, res) => {
  const { devId } = req.params;
  if (req.user.role !== "superadmin" && req.user.devId !== devId) {
    return res.status(403).json({ error: "Brak uprawnień" });
  }
  const dataPath = path.join(__dirname, "data", `${devId}.json`);
  const db = await fileStore.readJSON(dataPath, { deletedInvestments: [] });
  let deletedInvestments = db.deletedInvestments || [];
  
  // Dodaj ile dni zostało do trwałego usunięcia
  const now = Date.now();
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  deletedInvestments = deletedInvestments.map((d) => ({
    name: d.name,
    deletedAt: d.deletedAt,
    meta: d.meta || {},
    daysLeft: Math.max(
      0,
      Math.ceil(
        (new Date(d.deletedAt).getTime() + THIRTY_DAYS - now) /
          (24 * 60 * 60 * 1000),
      ),
    ),
  }));
  res.json(deletedInvestments);
});

app.post("/api/rename-building", checkAuth, csrfProtection, (req, res) => {
  let { devId, investId, oldName, newName } = req.body;
  if (req.user.role !== "superadmin") devId = req.user.devId;
  investId = sanitize(investId);
  oldName = sanitize(oldName);
  newName = sanitize(newName);
  const oldPath = path.join(__dirname, "uploads", devId, investId, oldName);
  const newPath = path.join(__dirname, "uploads", devId, investId, newName);
  if (fs.existsSync(oldPath)) {
    fs.rename(oldPath, newPath, (err) => {
      if (err) return res.status(500).send("Błąd");
      res.send("OK");
    });
  } else res.send("OK");
});

app.post("/api/delete-building", checkAuth, csrfProtection, (req, res) => {
  let { devId, investId, buildingId } = req.body;
  if (req.user.role !== "superadmin") devId = req.user.devId;
  investId = sanitize(investId);
  buildingId = sanitize(buildingId);
  const targetPath = path.join(
    __dirname,
    "uploads",
    devId,
    investId,
    buildingId,
  );
  if (fs.existsSync(targetPath))
    fs.rm(targetPath, { recursive: true, force: true }, () => res.send("OK"));
  else res.send("OK");
});

app.post("/api/rename-floor", checkAuth, csrfProtection, (req, res) => {
  let { devId, investId, buildingId, oldName, newName } = req.body;
  if (req.user.role !== "superadmin") devId = req.user.devId;
  investId = sanitize(investId);
  oldName = sanitize(oldName);
  newName = sanitize(newName);

  // Nowa ścieżka: _floors/
  const floorsDir = path.join(__dirname, "uploads", devId, investId, "_floors");
  const newPath = path.join(floorsDir, `${newName}.jpg`);
  const oldPath = path.join(floorsDir, `${oldName}.jpg`);

  if (fs.existsSync(oldPath)) {
    fs.rename(oldPath, newPath, (err) => {
      if (err) return res.status(500).send("Błąd");
      res.send("OK");
    });
  } else {
    // Fallback: stara ścieżka building/plans/
    if (buildingId) {
      buildingId = sanitize(buildingId);
      const oldLegacyPath = path.join(__dirname, "uploads", devId, investId, buildingId, "plans", `${oldName}.jpg`);
      const newLegacyPath = path.join(__dirname, "uploads", devId, investId, buildingId, "plans", `${newName}.jpg`);
      if (fs.existsSync(oldLegacyPath)) {
        fs.rename(oldLegacyPath, newLegacyPath, (err) => {
          if (err) return res.status(500).send("Błąd");
          res.send("OK");
        });
        return;
      }
    }
    res.send("OK");
  }
});

app.post("/api/delete-floor", checkAuth, csrfProtection, (req, res) => {
  let { devId, investId, buildingId, floorName } = req.body;
  if (req.user.role !== "superadmin") devId = req.user.devId;
  investId = sanitize(investId);
  floorName = sanitize(floorName);

  // Nowa ścieżka: _floors/
  const newPath = path.join(__dirname, "uploads", devId, investId, "_floors", `${floorName}.jpg`);
  if (fs.existsSync(newPath)) {
    fs.unlink(newPath, () => res.send("OK"));
    return;
  }
  // Fallback: stara ścieżka
  if (buildingId) {
    buildingId = sanitize(buildingId);
    const legacyPath = path.join(__dirname, "uploads", devId, investId, buildingId, "plans", `${floorName}.jpg`);
    if (fs.existsSync(legacyPath)) {
      fs.unlink(legacyPath, () => res.send("OK"));
      return;
    }
  }
  res.send("OK");
});

app.post(
  "/api/duplicate-floor-image",
  checkAuth,
  csrfProtection,
  (req, res) => {
    let { devId, investId, buildingId, sourceFloor, newFloor } = req.body;
    if (req.user.role !== "superadmin") devId = req.user.devId;
    investId = sanitize(investId);
    sourceFloor = sanitize(sourceFloor);
    newFloor = sanitize(newFloor);

    const floorsDir = path.join(__dirname, "uploads", devId, investId, "_floors");
    const srcPath = path.join(floorsDir, `${sourceFloor}.jpg`);
    const destPath = path.join(floorsDir, `${newFloor}.jpg`);

    const tryCopy = (src, dest) => {
      if (!fs.existsSync(dest.replace(`${newFloor}.jpg`, ""))) {
        fs.mkdirSync(dest.replace(`${newFloor}.jpg`, ""), { recursive: true });
      }
      fs.copyFile(src, dest, (err) => {
        if (err) return res.status(500).send("Błąd serwera podczas kopiowania");
        res.send("OK");
      });
    };

    if (fs.existsSync(srcPath)) {
      tryCopy(srcPath, destPath);
    } else if (buildingId) {
      // Fallback: stara ścieżka
      buildingId = sanitize(buildingId);
      const legacyDir = path.join(__dirname, "uploads", devId, investId, buildingId, "plans");
      const legacySrc = path.join(legacyDir, `${sourceFloor}.jpg`);
      if (fs.existsSync(legacySrc)) {
        if (!fs.existsSync(floorsDir)) fs.mkdirSync(floorsDir, { recursive: true });
        tryCopy(legacySrc, destPath);
      } else {
        return res.status(404).send("Plik źródłowy nie istnieje");
      }
    } else {
      return res.status(404).send("Plik źródłowy nie istnieje");
    }
  },
);

// Migracja pliku rzutu ze starej ścieżki (building/plans/) do nowej (_floors/)
app.post("/api/migrate-floor-file", checkAuth, csrfProtection, (req, res) => {
  let { devId, investId, buildingId, floorName } = req.body;
  if (req.user.role !== "superadmin") devId = req.user.devId;
  investId = sanitize(investId);
  buildingId = sanitize(buildingId);
  floorName = sanitize(floorName);

  const srcPath = path.join(__dirname, "uploads", devId, investId, buildingId, "plans", `${floorName}.jpg`);
  const destDir = path.join(__dirname, "uploads", devId, investId, "_floors");
  const destPath = path.join(destDir, `${floorName}.jpg`);

  if (!fs.existsSync(srcPath)) {
    return res.json({ success: true, skipped: true, reason: "source_not_found" });
  }
  if (fs.existsSync(destPath)) {
    return res.json({ success: true, skipped: true, reason: "already_exists" });
  }

  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.copyFile(srcPath, destPath, (err) => {
    if (err) return res.status(500).json({ error: "Błąd kopiowania pliku" });
    res.json({ success: true });
  });
});

app.post("/api/delete-file", checkAuth, csrfProtection, (req, res) => {
  let { devId, investId, buildingId, type, aptNumber, filename } = req.body;
  if (req.user.role !== "superadmin") devId = req.user.devId;
  investId = sanitize(investId);
  buildingId = sanitize(buildingId);
  aptNumber = sanitize(aptNumber);
  filename = sanitize(filename);
  const folderMap = {
    km: "cards_km",
    ki: "cards_ki",
    kz: "cards_kz",
    contract: "contracts",
  };
  const subFolder = folderMap[type];
  let filePath;
  if (type === "contract")
    filePath = path.join(
      __dirname,
      "uploads",
      devId,
      investId,
      buildingId,
      subFolder,
      filename,
    );
  else if (type === "kz")
    filePath = path.join(
      __dirname,
      "uploads",
      devId,
      investId,
      buildingId,
      `KZ/mieszkanie_${aptNumber}`,
      filename,
    );
  else
    filePath = path.join(
      __dirname,
      "uploads",
      devId,
      investId,
      buildingId,
      subFolder,
      `apt_${aptNumber}.pdf`,
    );
  if (fs.existsSync(filePath))
    fs.unlink(filePath, (err) => {
      if (err) console.error("Błąd usuwania pliku:", err);
    });
  res.send({ success: true });
});

// ============================================================
// --- UPLOAD ---
// ============================================================

app.post(
  "/api/upload-card",
  checkAuth,
  upload.single("file"),
  csrfProtection,
  (req, res) => {
    if (!req.file) return res.status(400).send("Błąd przesyłania");
    res.send({ message: "OK", filename: req.file.originalname });
  },
);

app.post(
  "/api/upload-floor",
  checkAuth,
  upload.single("floorImage"),
  csrfProtection,
  (req, res) => {
    if (!req.file) return res.status(400).send("Błąd przesyłania");
    res.send("OK");
  },
);

// ============================================================
// --- ZMIANA HASŁA ---
// ============================================================

// Superadmin zmienia własne hasło
app.post("/api/admin/change-password", checkAuth, async (req, res) => {
  if (req.user.role !== "superadmin")
    return res.status(403).json({ error: "Tylko SuperAdmin może to zrobić." });
  const { newPass } = req.body;
  if (!newPass) return res.status(400).json({ error: "Brak hasła" });
  try {
    const hashed = await bcrypt.hash(newPass, 10);
    await fileStore.updateJSON(configPath, (currentConfig) => {
      currentConfig.adminPass = hashed;
      return currentConfig;
    }, { adminLogin: "superadmin", adminPass: "" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Błąd serwera" });
  }
});

// Admin firmy zmienia własne hasło
app.post("/api/company/change-password", checkAuth, async (req, res) => {
  if (req.user.role !== "companyAdmin")
    return res.status(403).json({ error: "Brak uprawnień" });
  const { newPass } = req.body;
  if (!newPass || newPass.length < 4)
    return res.status(400).json({ error: "Hasło musi mieć min. 4 znaki" });
  try {
    const hashed = await bcrypt.hash(newPass, 10);
    await fileStore.updateJSON(companiesPath, (companies) => {
      const idx = companies.findIndex((c) => c.id === req.user.companyId);
      if (idx !== -1) companies[idx].adminPasswordHash = hashed;
      return companies;
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Błąd serwera" });
  }
});

// Zachowana kompatybilność wsteczna z developers API
app.get("/api/developers", checkAuth, async (req, res) => {
  if (req.user.role !== "superadmin")
    return res.status(403).send("Brak uprawnień");
  const companies = await fileStore.readJSON(companiesPath, []);
  res.json(
    companies.map((c) => ({ id: c.id, name: c.name, login: c.adminEmail })),
  );
});

// ============================================================
// --- ZARZĄDZANIE KOPIAMI ZAPASOWYMI ---
// ============================================================

app.get("/api/admin/backups", checkAuth, async (req, res) => {
  if (req.user.role !== "superadmin") {
    return res.status(403).json({ error: "Brak uprawnień" });
  }
  
  try {
    const backupDir = path.join(__dirname, "data", "backups");
    if (!fs.existsSync(backupDir)) {
      return res.json({});
    }

    const backups = fs.readdirSync(backupDir).filter(f => fs.statSync(path.join(backupDir, f)).isDirectory());
    // Sort malejąco (najnowsze na górze)
    backups.sort((a, b) => b.localeCompare(a));

    const result = {}; // { companyId: [backup1, backup2] }
    
    for (const b of backups) {
      const bPath = path.join(backupDir, b);
      const files = fs.readdirSync(bPath).filter(f => f.startsWith("DEV_") && f.endsWith(".json"));
      for (const f of files) {
        const companyId = f.replace(".json", "");
        if (!result[companyId]) result[companyId] = [];
        result[companyId].push(b);
      }
    }
    
    res.json(result);
  } catch (err) {
    console.error("[Backup API] Błąd pobierania list kopii zapasowych:", err);
    res.status(500).json({ error: "Wewnętrzny błąd serwera" });
  }
});

app.post("/api/admin/backups/restore", checkAuth, async (req, res) => {
  if (req.user.role !== "superadmin") {
    return res.status(403).json({ error: "Brak uprawnień" });
  }

  const { companyId, backupId, createSafeBackup } = req.body;
  if (!companyId || !backupId) {
    return res.status(400).json({ error: "Brak wymaganych parametrów." });
  }

  try {
    const dataDir = path.join(__dirname, "data");
    const targetFile = path.join(dataDir, `${companyId}.json`);
    const backupSourceFile = path.join(dataDir, "backups", backupId, `${companyId}.json`);

    if (!fs.existsSync(backupSourceFile)) {
      return res.status(404).json({ error: "Wskazana kopia zapasowa nie istnieje." });
    }

    // 1. Zabezpieczenie obecnych danych jako "najbardziej aktualne"
    if (createSafeBackup && fs.existsSync(targetFile)) {
      const now = new Date();
      // Format: YYYY-MM-DD_HH-mm-ss_Aktualne
      const pad = n => String(n).padStart(2, '0');
      const timeStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}_Aktualne`;
      
      const safeBackupDir = path.join(dataDir, "backups", timeStr);
      if (!fs.existsSync(safeBackupDir)) {
        fs.mkdirSync(safeBackupDir, { recursive: true });
      }
      fs.copyFileSync(targetFile, path.join(safeBackupDir, `${companyId}.json`));
      console.log(`[Backup API] Wykonano bezpieczną kopię pliku ${companyId} przed przywróceniem -> ${timeStr}`);
    }

    // 2. Przywrócenie z wybranej kopii
    // Użyjemy temp file aby uniknąć uszkodzeń w trakcie kopiowania
    const tempTarget = `${targetFile}.restore.tmp`;
    fs.copyFileSync(backupSourceFile, tempTarget);
    fs.renameSync(tempTarget, targetFile);

    console.log(`[Backup API] Przywrócono dane dla ${companyId} z kopii: ${backupId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("[Backup API] Błąd podczas przywracania kopii:", err);
    res.status(500).json({ error: "Wewnętrzny błąd serwera podczas przywracania." });
  }
});

// ============================================================
// --- SIECI I DROGI — PLANSZA I ZAKRESY ---
// ============================================================

// Multer dla planszy zagospodarowania terenu
const scopeBoardStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    let devId = req.user.role !== "superadmin" ? req.user.devId : req.params.devId;
    const { investId } = req.body;
    if (!devId || !investId) return cb(new Error("Brak danych"), null);
    const dir = path.join(__dirname, "uploads", sanitize(devId), sanitize(investId), "scopes");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    file.originalname = Buffer.from(file.originalname, "latin1").toString("utf8");
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, "plansza" + ext);
  }
});
const scopeBoardUpload = multer({
  storage: scopeBoardStorage,
  fileFilter: (req, file, cb) => {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) return cb(new Error("Niedozwolony format pliku"), false);
    cb(null, true);
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});

// Upload planszy
app.post("/api/upload-scope-board/:devId", checkAuth, checkPermission("zakres"), (req, res) => {
  scopeBoardUpload.single("board")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "Brak pliku" });

    let devId = req.user.role !== "superadmin" ? req.user.devId : req.params.devId;
    const { investId } = req.body;
    const ext = path.extname(req.file.originalname).toLowerCase() || path.extname(req.file.filename).toLowerCase();
    const boardFile = "plansza" + ext;
    const boardType = ext === ".pdf" ? "pdf" : "image";

    const dataPath = path.join(__dirname, "data", `${devId}.json`);
    try {
      await fileStore.updateJSON(dataPath, (db) => {
        if (!db.projectScopes) db.projectScopes = {};
        if (!db.projectScopes[investId]) db.projectScopes[investId] = { boardFile: null, boardType: null, scopes: [], boardOffset: { x: 0, y: 0 }, boardScale: 1 };
        db.projectScopes[investId].boardFile = boardFile;
        db.projectScopes[investId].boardType = boardType;
        return db;
      }, { investments: {}, investmentsMeta: {}, deletedInvestments: [] });
      res.json({ success: true, boardFile, boardType });
    } catch (e) {
      res.status(500).json({ error: "Błąd zapisu" });
    }
  });
});

// Usunięcie planszy
app.delete("/api/scope-board/:devId/:investId", checkAuth, checkPermission("zakres"), async (req, res) => {
  let devId = req.user.role !== "superadmin" ? req.user.devId : req.params.devId;
  const { investId } = req.params;
  const dataPath = path.join(__dirname, "data", `${devId}.json`);
  try {
    let boardFile = null;
    await fileStore.updateJSON(dataPath, (db) => {
      if (db.projectScopes && db.projectScopes[investId]) {
        boardFile = db.projectScopes[investId].boardFile;
        db.projectScopes[investId].boardFile = null;
        db.projectScopes[investId].boardType = null;
      }
      return db;
    }, { investments: {}, investmentsMeta: {}, deletedInvestments: [] });

    if (boardFile) {
      const filePath = path.join(__dirname, "uploads", sanitize(devId), sanitize(investId), "scopes", boardFile);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Błąd usuwania pliku" });
  }
});

// Odczyt zakresów
app.get("/api/scopes/:devId", checkAuth, checkPermission("zakres"), async (req, res) => {
  let devId = req.user.role !== "superadmin" ? req.user.devId : req.params.devId;
  const dataPath = path.join(__dirname, "data", `${devId}.json`);
  try {
    const db = await fileStore.readJSON(dataPath, { investments: {}, investmentsMeta: {}, deletedInvestments: [] });
    res.json(db.projectScopes || {});
  } catch (e) {
    res.status(500).json({ error: "Błąd odczytu" });
  }
});

// Zapis zakresów
app.post("/api/scopes/:devId", checkAuth, checkPermission("zakres"), async (req, res) => {
  let devId = req.user.role !== "superadmin" ? req.user.devId : req.params.devId;
  const { investId, scopeData } = req.body;
  if (!investId || !scopeData) return res.status(400).json({ error: "Brak danych" });
  const dataPath = path.join(__dirname, "data", `${devId}.json`);
  try {
    await fileStore.updateJSON(dataPath, (db) => {
      if (!db.projectScopes) db.projectScopes = {};
      if (!db.projectScopes[investId]) db.projectScopes[investId] = {};
      // Zachowaj boardFile i boardType (nie nadpisuj)
      const existing = db.projectScopes[investId] || {};
      db.projectScopes[investId] = {
        boardFile: existing.boardFile || null,
        boardType: existing.boardType || null,
        boardOffset: scopeData.boardOffset || existing.boardOffset || { x: 0, y: 0 },
        boardScale: scopeData.boardScale !== undefined ? scopeData.boardScale : (existing.boardScale || 1),
        scopes: scopeData.scopes || []
      };
      return db;
    }, { investments: {}, investmentsMeta: {}, deletedInvestments: [] });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Błąd zapisu" });
  }
});

// --- START SERWERA ---
const HOST = IS_PRODUCTION ? "127.0.0.1" : "localhost";
app.listen(PORT, HOST, () => {
  const mode = IS_PRODUCTION ? "PRODUKCJA" : "Środowisko lokalne";
  console.log(`[${mode}] Serwer uruchomiony: http://${HOST}:${PORT}`);
  if (IS_PRODUCTION) {
    console.log(
      "Tryb produkcyjny: bezpieczne ciasteczka (secure=true) WŁĄCZONE.",
    );
  }
  if (!fs.existsSync(path.join(__dirname, "data")))
    fs.mkdirSync(path.join(__dirname, "data"));
  if (!fs.existsSync(path.join(__dirname, "uploads")))
    fs.mkdirSync(path.join(__dirname, "uploads"));

  // Uruchom czyszczenie kosza przy starcie i co 24h
  cleanupDeletedInvestments();
  setInterval(cleanupDeletedInvestments, 24 * 60 * 60 * 1000);
  
  // Uruchom codzienny backup
  startDailyBackup();
});

// Automatyczne trwałe usuwanie inwestycji po 30 dniach
async function cleanupDeletedInvestments() {
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const dataDir = path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) return;

  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json"));
  let cleaned = 0;

  for (const file of files) {
    const devId = file.replace(".json", "");
    const dataPath = path.join(dataDir, file);
    try {
      let pathsToDelete = [];
      await fileStore.updateJSON(dataPath, (db) => {
        if (!db.deletedInvestments || !db.deletedInvestments.length) return db;

        const before = db.deletedInvestments.length;
        db.deletedInvestments = db.deletedInvestments.filter((d) => {
          const age = now - new Date(d.deletedAt).getTime();
          if (age >= THIRTY_DAYS) {
            pathsToDelete.push(path.join(__dirname, "uploads", devId, sanitize(d.name)));
            cleaned++;
            return false;
          }
          return true;
        });
        return db;
      }, { investments: {}, investmentsMeta: {}, deletedInvestments: [] });
      
      for (const uploadPath of pathsToDelete) {
        if (fs.existsSync(uploadPath)) {
          fs.rm(uploadPath, { recursive: true, force: true }, () => {});
        }
      }
    } catch (e) {
      console.error(`[Cleanup] Błąd przy przetwarzaniu ${file}:`, e.message);
    }
  }

  if (cleaned > 0) {
    console.log(`[Cleanup] Trwale usunięto ${cleaned} inwestycji z kosza (starszych niż 30 dni).`);
  }
}

// Mechanizm codziennego backupu danych
function startDailyBackup() {
  // Wywołaj od razu przy starcie, jeśli dzisiaj jeszcze nie było backupu (uproszczone do samego timer'a w naszym przypadku)
  // Robimy backup po starcie z opóźnieniem minuty, potem co 24h
  setTimeout(performBackup, 60 * 1000);
  setInterval(performBackup, 24 * 60 * 60 * 1000);

  function performBackup() {
    try {
      const dataDir = path.join(__dirname, "data");
      const backupDir = path.join(dataDir, "backups");
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const dateStr = new Date().toISOString().split('T')[0];
      const todayBackup = path.join(backupDir, dateStr);
      if (!fs.existsSync(todayBackup)) fs.mkdirSync(todayBackup, { recursive: true });

      // Kopiowanie głównych plików konfiguracyjnych
      const rootFiles = ['companies.json', 'users.json', 'config.json'];
      rootFiles.forEach(f => {
        const src = path.join(__dirname, f);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(todayBackup, f));
      });

      // Kopiowanie bazy danych inwestycji
      const dbFiles = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json"));
      dbFiles.forEach(f => {
        const src = path.join(dataDir, f);
        fs.copyFileSync(src, path.join(todayBackup, f));
      });
      
      console.log(`[Backup] Wykonano kopię zapasową bazy danych do folderu data/backups/${dateStr}`);

      // Retencja: usuwamy foldery starsze niż 30 dni
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const backups = fs.readdirSync(backupDir).filter(f => fs.statSync(path.join(backupDir, f)).isDirectory());
      for (const b of backups) {
        const d = new Date(b).getTime();
        if (!isNaN(d) && (now - d) > THIRTY_DAYS) {
          fs.rm(path.join(backupDir, b), { recursive: true, force: true }, () => {});
          console.log(`[Backup] Usunięto przestarzałą kopię zapasową: ${b}`);
        }
      }
    } catch (err) {
      console.error("[Backup] Błąd podczas wykonywania backupu:", err);
    }
  }
}
