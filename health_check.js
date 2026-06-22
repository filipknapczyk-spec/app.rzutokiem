#!/usr/bin/env node
/**
 * health_check.js — Sprawdzenie stanu aplikacji po deploymencie
 * 
 * Użycie:
 *   node health_check.js              — sprawdza pliki + odpytuje serwer
 *   node health_check.js --files-only — sprawdza tylko pliki (bez HTTP)
 * 
 * Exit code 0 = OK, 1 = błąd
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const APP_DIR = __dirname;
const DATA_DIR = path.join(APP_DIR, 'data');
const PORT = process.env.PORT || 3000;
const FILES_ONLY = process.argv.includes('--files-only');

let errors = 0;
let warnings = 0;

function ok(msg)   { console.log(`  ✅ ${msg}`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); warnings++; }
function fail(msg) { console.log(`  ❌ ${msg}`); errors++; }

// ============================================================
// KROK 1: Sprawdź wymagane pliki kodu
// ============================================================
console.log('\n=== [1/4] Pliki kodu ===');

const REQUIRED_FILES = [
  'server.js',
  'fileStore.js',
  'package.json',
  '.env',
  'index.html',
  'developer.html',
  'admin.html',
  'dashboard.html',
];

for (const f of REQUIRED_FILES) {
  const fullPath = path.join(APP_DIR, f);
  if (fs.existsSync(fullPath)) {
    ok(f);
  } else {
    fail(`Brakuje pliku: ${f}`);
  }
}

// ============================================================
// KROK 2: Sprawdź pliki danych (JSON)
// ============================================================
console.log('\n=== [2/4] Pliki danych ===');

const DATA_FILES = ['companies.json', 'users.json', 'config.json'];

for (const f of DATA_FILES) {
  const fullPath = path.join(APP_DIR, f);
  if (!fs.existsSync(fullPath)) {
    warn(`Brak ${f} (zostanie utworzony przy starcie)`);
    continue;
  }
  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    if (content.trim() === '') {
      warn(`${f} jest pusty`);
    } else {
      const parsed = JSON.parse(content);
      ok(`${f} — poprawny JSON`);
    }
  } catch (e) {
    fail(`${f} — USZKODZONY JSON: ${e.message}`);
  }
}

// Sprawdź pliki DEV_*.json w data/
if (fs.existsSync(DATA_DIR)) {
  const devFiles = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('DEV_') && f.endsWith('.json'));
  if (devFiles.length === 0) {
    warn('Brak plików DEV_*.json w data/ (OK jeśli nie dodano jeszcze firm)');
  } else {
    console.log(`\n  Pliki deweloperów (${devFiles.length}):`);
    for (const f of devFiles) {
      const fullPath = path.join(DATA_DIR, f);
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const parsed = JSON.parse(content);
        const investCount = Object.keys(parsed.investments || {}).length;
        const aptCount = Object.values(parsed.investments || {}).reduce((acc, inv) => {
          return acc + Object.values(inv).reduce((a, b) => {
            return a + Object.values(b).reduce((x, floor) => x + (floor.apartments || []).length, 0);
          }, 0);
        }, 0);
        ok(`${f} — ${investCount} inwestycji, ~${aptCount} lokali`);
      } catch (e) {
        fail(`${f} — USZKODZONY JSON: ${e.message}`);
      }
    }
  }
} else {
  warn('Folder data/ nie istnieje (zostanie utworzony przy starcie)');
}

// ============================================================
// KROK 3: Sprawdź zmienne środowiskowe
// ============================================================
console.log('\n=== [3/4] Zmienne środowiskowe ===');

try { require('dotenv').config(); } catch(e) {}

if (process.env.COOKIE_SECRET && process.env.COOKIE_SECRET.length >= 16) {
  ok(`COOKIE_SECRET — ustawiony (${process.env.COOKIE_SECRET.length} znaków)`);
} else {
  fail('COOKIE_SECRET — nie ustawiony lub za krótki (min. 16 znaków)!');
}

if (process.env.ADMIN_LOGIN) {
  ok(`ADMIN_LOGIN — ${process.env.ADMIN_LOGIN}`);
} else {
  warn('ADMIN_LOGIN — nie ustawiony (użyje domyślnego "superadmin")');
}

ok(`PORT — ${PORT}`);
ok(`NODE_ENV — ${process.env.NODE_ENV || 'development'}`);

// ============================================================
// KROK 4: Odpytaj serwer HTTP (jeśli nie --files-only)
// ============================================================
if (FILES_ONLY) {
  console.log('\n=== [4/4] Test HTTP — pominięty (--files-only) ===');
  printSummary();
} else {
  console.log(`\n=== [4/4] Test HTTP (port ${PORT}) ===`);
  const req = http.get(`http://localhost:${PORT}/`, (res) => {
    if (res.statusCode === 200 || res.statusCode === 302) {
      ok(`Serwer odpowiada — HTTP ${res.statusCode}`);
    } else {
      warn(`Serwer odpowiada, ale status: ${res.statusCode}`);
    }
    printSummary();
  });
  req.on('error', (e) => {
    fail(`Serwer nie odpowiada na porcie ${PORT}: ${e.message}`);
    warn('Jeśli serwer dopiero startuje, poczekaj kilka sekund i uruchom ponownie.');
    printSummary();
  });
  req.setTimeout(5000, () => {
    fail(`Timeout — serwer nie odpowiedział w 5 sekund na porcie ${PORT}`);
    req.destroy();
    printSummary();
  });
}

function printSummary() {
  console.log('\n' + '='.repeat(40));
  if (errors === 0 && warnings === 0) {
    console.log('✅ WSZYSTKO OK — aplikacja gotowa!');
    process.exit(0);
  } else if (errors === 0) {
    console.log(`⚠️  OK z ostrzeżeniami: ${warnings} ostrzeżeń, 0 błędów`);
    process.exit(0);
  } else {
    console.log(`❌ BŁĄD: ${errors} błędów, ${warnings} ostrzeżeń`);
    console.log('   Sprawdź logi powyżej i napraw błędy przed deploymentem!');
    process.exit(1);
  }
}
