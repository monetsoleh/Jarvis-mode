const express = require('express');
const axios   = require('axios');
const { Pool } = require('pg');
const app     = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── ENV ─────────────────────────────────────
const GROQ_KEY        = (process.env.GROQ_API_KEY      || '').trim();
const FONNTE_TOKEN    = (process.env.FONNTE_TOKEN       || '').trim();
const MUSTIKA_API_KEY = (process.env.MUSTIKAPAY_API_KEY || '').trim();

// ─── Konfigurasi Owner ───────────────────────
const OWNER_NAMA    = 'Corpomind';
const OWNER_NOMOR   = '6282240400388';
const OWNER_WA_LINK = 'https://wa.me/6282240400388';
const BASE_URL      = process.env.BASE_URL || 'https://jarvis-mode-production.up.railway.app';
const HARGA         = 50000;

// ═══════════════════════════════════════════════════════
//  POSTGRESQL — Railway auto-set DATABASE_URL
// ═══════════════════════════════════════════════════════
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            nomor_bot  TEXT PRIMARY KEY,
            sheet      TEXT,
            admin      TEXT DEFAULT '',
            nama       TEXT,
            aktif      BOOLEAN DEFAULT true,
            daftar     TIMESTAMPTZ DEFAULT NOW(),
            expired_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
            warned_exp BOOLEAN DEFAULT false
        )
    `);
    // Migrasi: tambah kolom jika belum ada (untuk user lama)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')`).catch(()=>{});
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS warned_exp BOOLEAN DEFAULT false`).catch(()=>{});
    await pool.query(`
        CREATE TABLE IF NOT EXISTS reg_sessions (
            sender_key TEXT PRIMARY KEY,
            data       JSONB,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS token_usage (
            sender_key  TEXT PRIMARY KEY,
            tokens_used INTEGER DEFAULT 0,
            reset_date  DATE DEFAULT CURRENT_DATE,
            warned      BOOLEAN DEFAULT false
        )
    `);
    console.log('[DB] Tabel siap.');
}
initDB().catch(err => console.error('[DB ERROR] initDB:', err.message));

// ═══════════════════════════════════════════════════════
//  TOKEN USAGE — Batas 500.000 token/hari per user
// ═══════════════════════════════════════════════════════
const TOKEN_LIMIT      = 500_000;
const TOKEN_WARN_AT    = 450_000; // Peringatan saat tersisa ~50.000 token

async function getTokenUsage(senderKey) {
    const r = await pool.query(
        'SELECT * FROM token_usage WHERE sender_key = $1',
        [senderKey]
    );
    if (!r.rows[0]) return { tokens_used: 0, reset_date: new Date().toISOString().slice(0,10), warned: false };
    return r.rows[0];
}

async function addTokenUsage(senderKey, tokensToAdd) {
    const today = new Date().toISOString().slice(0,10);
    await pool.query(`
        INSERT INTO token_usage (sender_key, tokens_used, reset_date, warned)
        VALUES ($1, $2, $3, false)
        ON CONFLICT (sender_key) DO UPDATE
        SET tokens_used = CASE
            WHEN token_usage.reset_date < $3 THEN $2
            ELSE token_usage.tokens_used + $2
        END,
        reset_date = CASE
            WHEN token_usage.reset_date < $3 THEN $3
            ELSE token_usage.reset_date
        END,
        warned = CASE
            WHEN token_usage.reset_date < $3 THEN false
            ELSE token_usage.warned
        END
    `, [senderKey, tokensToAdd, today]);
}

async function setWarned(senderKey) {
    await pool.query(
        'UPDATE token_usage SET warned = true WHERE sender_key = $1',
        [senderKey]
    );
}

// Estimasi token: ~1 token ≈ 4 karakter (perkiraan kasar)
function estimasiToken(text) {
    return Math.ceil((text || '').length / 4);
}

// ═══════════════════════════════════════════════════════
//  LANGGANAN — Timer 30 hari per user
// ═══════════════════════════════════════════════════════
function pesanPeringatanExpired(sisaHari, expiredAt) {
    const tgl = new Date(expiredAt).toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' });
    return `\n⏰ *Peringatan Langganan*\nLangganan kamu akan berakhir dalam *${sisaHari} hari* (${tgl}).\n\nSegera perpanjang agar bot tetap aktif!\n📱 Hubungi: *+62 822-4040-0388*\n🔗 ${OWNER_WA_LINK}\n`;
}

function pesanExpired() {
    return `╔══════════════════════╗\n║  ⛔  LANGGANAN HABIS  ║\n╚══════════════════════╝\n\nMaaf, masa langganan kamu sudah berakhir 😔\n\nUntuk melanjutkan menggunakan Corpo, silakan perpanjang langganan:\n\n📱 *+62 822-4040-0388*\n🔗 ${OWNER_WA_LINK}\n\n━━━━━━━━━━━━━━━━━━━━━━\n_Terima kasih sudah menggunakan Corpo!_ 🤖`;
}

// Cron harian — cek langganan hampir habis & yang sudah expired
async function cekLanggananHarian() {
    try {
        const now = new Date();

        // 1. Kirim peringatan user yang expire dalam 3 hari dan belum diperingatkan
        const hampirHabis = await pool.query(`
            SELECT nomor_bot, nama, admin, expired_at
            FROM users
            WHERE aktif = true
              AND warned_exp = false
              AND expired_at BETWEEN NOW() AND NOW() + INTERVAL '3 days'
        `);
        for (const user of hampirHabis.rows) {
            const sisaHari = Math.ceil((new Date(user.expired_at) - now) / (1000 * 60 * 60 * 24));
            const target   = user.admin || user.nomor_bot;
            await kirim(target, pesanPeringatanExpired(sisaHari, user.expired_at));
            await pool.query(`UPDATE users SET warned_exp = true WHERE nomor_bot = $1`, [user.nomor_bot]);
            console.log(`[CRON] Peringatan exp dikirim ke ${target} (${user.nama}), sisa ${sisaHari} hari`);
        }

        // 2. Nonaktifkan user yang sudah expired
        const expired = await pool.query(`
            SELECT nomor_bot, nama, admin
            FROM users
            WHERE aktif = true AND expired_at < NOW()
        `);
        for (const user of expired.rows) {
            await pool.query(`UPDATE users SET aktif = false WHERE nomor_bot = $1`, [user.nomor_bot]);
            const target = user.admin || user.nomor_bot;
            await kirim(target, pesanExpired());
            // Notif owner
            await kirim(OWNER_NOMOR,
`🔔 *Langganan Habis*\n\n┌──────────────────────\n┃ 🏢 *Bisnis :* ${user.nama}\n┃ 📱 *Bot    :* ${user.nomor_bot}\n┃ 📞 *Admin  :* ${user.admin||'-'}\n└──────────────────────\nUser sudah dinonaktifkan otomatis.`);
            console.log(`[CRON] User ${user.nomor_bot} (${user.nama}) dinonaktifkan — expired`);
        }
    } catch (err) {
        console.error('[CRON ERROR]', err.message);
    }
}

// Jalankan cron setiap jam 00:05 WIB (UTC+7 → UTC 17:05)
function jadwalkanCron() {
    const jalankanCronHarian = () => {
        const now  = new Date();
        // Target: 00:05 WIB = 17:05 UTC
        const next = new Date(now);
        next.setUTCHours(17, 5, 0, 0);
        if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
        const delay = next - now;
        console.log(`[CRON] Cek langganan berikutnya: ${next.toISOString()} (${Math.round(delay/60000)} menit lagi)`);
        setTimeout(() => {
            cekLanggananHarian();
            setInterval(cekLanggananHarian, 24 * 60 * 60 * 1000);
        }, delay);
    };
    jalankanCronHarian();
}


// ── CRUD users ──────────────────────────────
async function getUser(nomorBot) {
    const r = await pool.query('SELECT * FROM users WHERE nomor_bot = $1', [nomorBot]);
    return r.rows[0] || null;
}

async function saveUser(nomorBot, data) {
    await pool.query(
        `INSERT INTO users (nomor_bot, sheet, admin, nama, aktif, daftar, expired_at, warned_exp)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '30 days', false)
         ON CONFLICT (nomor_bot) DO UPDATE
         SET sheet      = $2,
             admin      = $3,
             nama       = $4,
             aktif      = $5,
             warned_exp = false,
             expired_at = CASE
                 WHEN users.expired_at > NOW() THEN users.expired_at + INTERVAL '30 days'
                 ELSE NOW() + INTERVAL '30 days'
             END`,
        [nomorBot, data.sheet, data.admin || '', data.nama, data.aktif]
    );
}

// ── CRUD reg_sessions ────────────────────────
async function getSession(senderKey) {
    const r = await pool.query('SELECT data FROM reg_sessions WHERE sender_key = $1', [senderKey]);
    return r.rows[0]?.data || null;
}

async function setSession(senderKey, data) {
    await pool.query(`
        INSERT INTO reg_sessions (sender_key, data, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (sender_key) DO UPDATE SET data = $2, updated_at = NOW()
    `, [senderKey, JSON.stringify(data)]);
}

async function deleteSession(senderKey) {
    await pool.query('DELETE FROM reg_sessions WHERE sender_key = $1', [senderKey]);
}

// ═══════════════════════════════════════════════════════
//  MUSTIKPAY HELPER
//  Docs v1.6 — Base URL: https://mustikapayment.com
//  Auth    : X-Api-Key header
//  POST    : application/x-www-form-urlencoded
//  Webhook : POST JSON → { status, service, amount,
//            reference, order_id, timestamp,
//            data: { ref_no, amount, issuer, rrn } }
// ═══════════════════════════════════════════════════════
const MUSTIKA_BASE = 'https://mustikapayment.com';

async function createQRIS(amount, customerName = 'Pelanggan', productName = 'Berlangganan Corpo') {
    const res = await axios.post(
        `${MUSTIKA_BASE}/api/createpay`,
        new URLSearchParams({
            amount       : String(amount),
            product_name : productName,
            customer_name: customerName,
            redirect_url : `${BASE_URL}/payment/success`
        }),
        {
            headers: {
                'X-Api-Key'   : MUSTIKA_API_KEY,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );
    // Response: { status, ref_no, qr_content, qr_url, payment_link, amount }
    return res.data;
}

async function cekStatusQRIS(refNo) {
    const res = await axios.get(
        `${MUSTIKA_BASE}/api/cekpay`,
        {
            params : { ref_no: refNo },
            headers: { 'X-Api-Key': MUSTIKA_API_KEY }
        }
    );
    return res.data;
}

// ═══════════════════════════════════════════════════════
//  CACHE GOOGLE SHEETS
// ═══════════════════════════════════════════════════════
const sheetsCache = {};
const CACHE_TTL   = 5 * 60 * 1000;

async function getSheetData(url) {
    const now = Date.now();
    if (sheetsCache[url] && (now - sheetsCache[url].time) < CACHE_TTL) return sheetsCache[url].data;
    const res = await axios.get(url);
    sheetsCache[url] = { data: JSON.stringify(res.data), time: now };
    return sheetsCache[url].data;
}

async function getSheetNames(url) {
    const res = await axios.get(url, { params: { action: 'sheets' } });
    return res.data.sheets || [];
}

// ═══════════════════════════════════════════════════════
//  ICON & MENU
// ═══════════════════════════════════════════════════════
const ICON_FALLBACK = ['🗂️','📂','🗃️','📁','🔖','📎','🗄️','📃'];
let fallbackIndex = 0;

function getIcon(n) {
    n = n.toLowerCase();
    if (/stok|barang|inventori|gudang|produk/.test(n))     return '📦';
    if (/absensi|karyawan|pegawai|staff|hadir/.test(n))    return '👥';
    if (/pengeluaran|keluar|biaya|expense/.test(n))        return '💸';
    if (/pemasukan|masuk|income|revenue/.test(n))          return '💰';
    if (/keuangan|finansial|kas|cashflow/.test(n))         return '📊';
    if (/pelanggan|customer|klien|client/.test(n))         return '🤝';
    if (/purchase order|po/.test(n))                       return '📋';
    if (/order|pesanan|transaksi|penjualan|sales/.test(n)) return '🛒';
    if (/pajak|tax/.test(n))                               return '🧾';
    if (/gaji|salary|payroll/.test(n))                     return '💵';
    if (/jadwal|schedule|agenda|kalender/.test(n))         return '📅';
    if (/tugas|task|todo|pekerjaan/.test(n))               return '✅';
    if (/laporan|report|rekap/.test(n))                    return '📝';
    if (/supplier|vendor|pemasok/.test(n))                 return '🏭';
    if (/aset|asset|inventaris/.test(n))                   return '🏷️';
    if (/makanan|food|minuman|drink/.test(n))              return '🍽️';
    if (/proyek|project/.test(n))                          return '🚀';
    if (/catatan|note|memo/.test(n))                       return '📌';
    if (/hutang|piutang|pinjam/.test(n))                   return '🏦';
    if (/diskon|promo|voucher/.test(n))                    return '🎫';
    return ICON_FALLBACK[(fallbackIndex++) % ICON_FALLBACK.length];
}

function buildMenu(sheets, namaUser) {
    fallbackIndex = 0;
    const baris = sheets.map((s, i) => `┃ ${String(i+1).padStart(2,' ')}. ${getIcon(s)}  ${s}`);
    return `╔══════════════════════╗
║   🤖  *C O R P O*   ║
║  Asisten AI Bisnis   ║
╚══════════════════════╝

Halo${namaUser ? ', *' + namaUser + '*' : ''} 👋

Selamat datang! Saya siap membantu bisnis Anda hari ini 💼✨

*📋 MENU UTAMA*
┌──────────────────────
${baris.join('\n')}
└──────────────────────

💡 *Cara pakai:*
   Ketik *angka* untuk pilih menu
   atau langsung tanya ke saya!

_Contoh: ketik *"1"* untuk ${sheets[0] || 'menu pertama'}_

━━━━━━━━━━━━━━━━━━━━━━
🕐 Siap melayani 24 jam!`;
}

function pesanInfoToken() {
    return `\nℹ️ *Info Penggunaan*\nBatas pemakaian harian kamu setara dengan sekitar 400.000 – 500.000 kata.\nItu kira-kira setara dengan ratusan percakapan normal 💬\nGunakan dengan bijak ya supaya tidak cepat habis 🙏\n`;
}

function pesanPeringatanToken(sisaToken) {
    const sisaKata = Math.floor(sisaToken / 1.25).toLocaleString('id-ID');
    return `\n⚠️ *Peringatan Kuota*\nKuota harian kamu hampir habis!\nSisa kira-kira *${sisaKata} kata* lagi hari ini.\nBesok kuota akan otomatis direset 🔄\n`;
}

function pesanHabisToken() {
    return `╔══════════════════════╗\n║  ⛔  KUOTA HABIS!    ║\n╚══════════════════════╝\n\nMaaf, kuota harian kamu sudah habis hari ini 😔\n\nKuota akan direset otomatis besok pagi.\n\n━━━━━━━━━━━━━━━━━━━━━━\n_Terima kasih sudah menggunakan Corpo!_ 🤖`;
}


function isSapaan(msg) {
    msg = msg.trim();
    if (/^\d+$/.test(msg)) return false;
    if (msg.length <= 3)   return true;
    return /^(halo|hai|hi|hei|oi|ping|assalam|selamat|pagi|siang|sore|malam|menu|help|bantuan|start|mulai|hallo|hello|hey|corpo|corpomind|bot|test|tes|coba|buka|open)\b/i.test(msg);
}

function deteksiPilihMenu(message, sheets) {
    const angka = parseInt(message.trim());
    if (!isNaN(angka) && angka >= 1 && angka <= sheets.length) return sheets[angka - 1];
    return null;
}

// ═══════════════════════════════════════════════════════
//  CATAT TRANSAKSI
// ═══════════════════════════════════════════════════════
async function catatTransaksi(sheetUrl, payload) {
    const res = await axios.post(sheetUrl, payload, { headers: { 'Content-Type': 'application/json' } });
    delete sheetsCache[sheetUrl];
    return res.data;
}

function deteksiTransaksi(message) {
    const msg             = message.toLowerCase();
    const polaPengeluaran = /\b(beli|bayar|keluar|pengeluaran|belanja|setor|bayarin|biaya)\b/i;
    const polaPemasukan   = /\b(terima|masuk|pemasukan|untung|laba|dapat|penjualan|terjual)\b/i;
    const polaAngka       = /(\d[\d.,]*)\s*(rb|ribu|rbu|jt|juta|k)?/i;
    const adaPengeluaran  = polaPengeluaran.test(msg);
    const adaPemasukan    = polaPemasukan.test(msg);
    const matchAngka      = msg.match(polaAngka);
    if (!matchAngka || (!adaPengeluaran && !adaPemasukan)) return null;
    let nominal = parseFloat(matchAngka[1].replace(/[.,]/g, ''));
    const satuan = (matchAngka[2] || '').toLowerCase();
    if (/^(rb|ribu|rbu|k)$/.test(satuan)) nominal *= 1000;
    if (/^(jt|juta)$/.test(satuan))       nominal *= 1_000_000;
    const tipe       = adaPemasukan ? 'Pemasukan' : 'Pengeluaran';
    const keterangan = message.replace(polaAngka,'').replace(polaPengeluaran,'').replace(polaPemasukan,'').replace(/catat|tolong|dong|ya|yuk/gi,'').trim();
    return { tipe, nominal, keterangan, sheet: tipe };
}

// ═══════════════════════════════════════════════════════
//  HISTORY CHAT (in-memory, tidak kritis jika hilang)
// ═══════════════════════════════════════════════════════
const chatHistory = {};
const MAX_HISTORY = 10;

function addHistory(key, role, text) {
    if (!chatHistory[key]) chatHistory[key] = [];
    chatHistory[key].push({ role, parts: [{ text }] });
    if (chatHistory[key].length > MAX_HISTORY) chatHistory[key].shift();
}

// ═══════════════════════════════════════════════════════
//  KIRIM WA via Fonnte
// ═══════════════════════════════════════════════════════
async function kirim(target, message) {
    await axios.post('https://api.fonnte.com/send',
        { target, message },
        { headers: { Authorization: FONNTE_TOKEN } }
    );
}

// ═══════════════════════════════════════════════════════
//  ALUR PENDAFTARAN VIA WHATSAPP
// ═══════════════════════════════════════════════════════
async function handleRegistrasi(senderKey, message, name) {
    const msg  = message.trim();
    const sess = await getSession(senderKey);

    // Batalkan sesi
    if (sess && /^(batal|cancel|stop)$/i.test(msg)) {
        await deleteSession(senderKey);
        await kirim(senderKey, '❌ Pendaftaran dibatalkan. Ketik *daftar* kapan saja untuk memulai lagi.');
        return true;
    }

    // Mulai daftar
    if (!sess && /^(daftar|register|subscribe|langganan)$/i.test(msg)) {
        await setSession(senderKey, { step: 'nama' });
        await kirim(senderKey,
`╔══════════════════════╗
║  📝  *PENDAFTARAN*   ║
║     Corpo Bot        ║
╚══════════════════════╝

Halo! Selamat datang di *${OWNER_NAMA}* 🤖

Saya akan memandu Anda dalam 3 langkah mudah.
Ketik *batal* kapan saja untuk membatalkan.

━━━━━━━━━━━━━━━━━━━━━━
*Langkah 1 dari 3* 🏢
Ketik *nama bisnis* Anda:`);
        return true;
    }

    if (!sess) return false;

    // Step 1: Nama bisnis
    if (sess.step === 'nama') {
        await setSession(senderKey, { ...sess, nama: msg, step: 'nomorBot' });
        await kirim(senderKey,
`✅ Nama bisnis: *${msg}*

━━━━━━━━━━━━━━━━━━━━━━
*Langkah 2 dari 3* 📱
Masukkan *nomor WhatsApp bot* Anda:
_(nomor yang akan dipakai Corpo menjawab)_

_Contoh: 628123456789_`);
        return true;
    }

    // Step 2: Nomor bot
    if (sess.step === 'nomorBot') {
        const nomor = msg.replace(/[^0-9]/g, '');
        if (nomor.length < 10) {
            await kirim(senderKey, '⚠️ Nomor tidak valid. Masukkan nomor WA yang benar!\n_Contoh: 628123456789_');
            return true;
        }
        await setSession(senderKey, { ...sess, nomorBot: nomor, step: 'sheet' });
        await kirim(senderKey,
`✅ Nomor bot: *${nomor}*

━━━━━━━━━━━━━━━━━━━━━━
*Langkah 3 dari 3* 📊
Masukkan *link Google Sheet* bisnis Anda:

_Contoh:_
_https://script.google.com/macros/s/xxx/exec_

⚠️ Pastikan sheet sudah di-deploy sebagai *Web App* dan akses diset ke *Anyone*`);
        return true;
    }

    // Step 3: Link sheet → buat QRIS
    if (sess.step === 'sheet') {
        if (!msg.startsWith('http')) {
            await kirim(senderKey, '⚠️ Link tidak valid. Harus dimulai dengan *https://*');
            return true;
        }

        // Simpan sheet dulu, update step ke bayar
        await setSession(senderKey, { ...sess, sheet: msg, step: 'bayar' });

        try {
            // Buat QRIS — POST /api/createpay (application/x-www-form-urlencoded)
            const qris = await createQRIS(HARGA, name || 'Pelanggan', 'Berlangganan Corpo');

            if (qris.status !== 'success') throw new Error(qris.message || 'Gagal membuat QRIS');

            // Simpan ref_no ke sesi — dipakai untuk mencocokkan webhook callback
            await setSession(senderKey, { ...sess, sheet: msg, step: 'bayar', refNo: qris.ref_no });

            console.log(`[DAFTAR] ${senderKey} | ref_no: ${qris.ref_no} | nomor bot: ${sess.nomorBot}`);

            await kirim(senderKey,
`✅ Data berhasil disimpan!

━━━━━━━━━━━━━━━━━━━━━━
*📋 RINGKASAN PENDAFTARAN*
┌──────────────────────
┃ 🏢 *Bisnis    :* ${sess.nama}
┃ 📱 *Nomor Bot :* ${sess.nomorBot}
┃ 📊 *Sheet     :* Tersimpan ✅
└──────────────────────

*💳 PEMBAYARAN QRIS*
┌──────────────────────
┃ 💰 *Total  :* Rp ${HARGA.toLocaleString('id-ID')}
┃ 🔖 *Ref No :* ${qris.ref_no}
└──────────────────────

Scan QRIS berikut untuk menyelesaikan:
🔗 ${qris.payment_link || qris.qr_url}

━━━━━━━━━━━━━━━━━━━━━━
⏳ QR berlaku *30 menit*
✅ Akun aktif *otomatis* setelah bayar`);

        } catch (err) {
            console.error('[QRIS ERROR]', err.message);
            await deleteSession(senderKey);
            await kirim(senderKey,
`⚠️ Gagal membuat QRIS. Silakan coba lagi dengan ketik *daftar*

Atau hubungi kami:
📱 *+62 822-4040-0388*
🔗 ${OWNER_WA_LINK}`);
        }
        return true;
    }

    return false;
}

// ═══════════════════════════════════════════════════════
//  WEBHOOK MUSTIKPAY CALLBACK
//
//  POST payload dari Mustika (application/json):
//  {
//    "status"    : "success",
//    "service"   : "QRIS",
//    "amount"    : 10000,
//    "reference" : "QR12345",      ← ini adalah ref_no
//    "order_id"  : "INV123",
//    "timestamp" : "2024-03-08 10:00:00",
//    "data": {
//      "ref_no"  : "QR12345",
//      "amount"  : 10000,
//      "issuer"  : "GOPAY",
//      "rrn"     : "123456789012"
//    }
//  }
// ═══════════════════════════════════════════════════════
app.post('/payment/callback', async (req, res) => {
    // Wajib balas 200 dulu sesuai docs Mustika
    res.status(200).send('OK');
    console.log('[CALLBACK] MustikaPay:', JSON.stringify(req.body));

    const body   = req.body;
    const status = (body.status || '').toLowerCase();

    // Hanya proses jika status success
    if (status !== 'success' && status !== 'paid') {
        console.log('[CALLBACK] Status bukan success, diabaikan:', status);
        return;
    }

    // Ambil ref_no: dari `reference` (root) atau `data.ref_no`
    const refNo = body.reference || (body.data && body.data.ref_no) || body.ref_no;
    if (!refNo) {
        console.warn('[CALLBACK] ref_no tidak ditemukan di payload');
        return;
    }

    console.log('[CALLBACK] ref_no diterima:', refNo);

    // Cari sesi di DB yang memiliki refNo cocok
    const r = await pool.query(
        `SELECT sender_key, data FROM reg_sessions WHERE data->>'refNo' = $1`,
        [refNo]
    );

    if (!r.rows[0]) {
        console.warn('[CALLBACK] Tidak ada sesi untuk ref_no:', refNo);
        return;
    }

    const senderKey = r.rows[0].sender_key;
    const sess      = r.rows[0].data;

    // Simpan user ke PostgreSQL
    await saveUser(sess.nomorBot, {
        sheet: sess.sheet,
        admin: '',
        nama : sess.nama,
        aktif: true
    });

    // Ambil expired_at yang baru tersimpan dari DB
    const userBaru    = await getUser(sess.nomorBot);
    const expiredAt   = userBaru?.expired_at ? new Date(userBaru.expired_at) : new Date(Date.now() + 30*24*60*60*1000);
    const tglAktif    = new Date().toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' });
    const tglExpired  = expiredAt.toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' });

    // Hapus sesi pendaftaran
    await deleteSession(senderKey);

    console.log(`[REGISTRASI SUKSES] nomor: ${sess.nomorBot} | bisnis: ${sess.nama} | expired: ${tglExpired}`);

    // Notif ke pendaftar
    await kirim(senderKey,
`╔══════════════════════╗
║  ✅  PEMBAYARAN OK!  ║
╚══════════════════════╝

Terima kasih telah berlangganan Corpo! 🙏🎉
Pembayaran kamu berhasil diterima dan akun sudah *AKTIF*!

┌──────────────────────
┃ 🏢 *Bisnis  :* ${sess.nama}
┃ 📱 *Bot     :* ${sess.nomorBot}
┃ 📅 *Aktif   :* ${tglAktif}
┃ ⏳ *Expired :* ${tglExpired}
└──────────────────────

*Langkah selanjutnya:*
1️⃣ Hubungkan nomor *${sess.nomorBot}* ke Fonnte
2️⃣ Hubungi kami untuk set nomor admin:

📱 *+62 822-4040-0388*
🔗 ${OWNER_WA_LINK}

━━━━━━━━━━━━━━━━━━━━━━
Selamat berbisnis lebih cerdas! 🚀
_Powered by ${OWNER_NAMA}_ 🤖`);

    // Notif ke owner
    await kirim(OWNER_NOMOR,
`🔔 *PENDAFTAR BARU!*

┌──────────────────────
┃ 🏢 *Bisnis :* ${sess.nama}
┃ 📱 *Bot    :* ${sess.nomorBot}
┃ 📞 *WA     :* ${senderKey}
┃ 💰 *Bayar  :* Rp ${HARGA.toLocaleString('id-ID')}
┃ 🔖 *Ref No :* ${refNo}
└──────────────────────
⚠️ Set nomor *admin* untuk nomor bot *${sess.nomorBot}* via perintah berikut:
_Kirim ke bot: setadmin_${sess.nomorBot}_NOMOR_ADMIN_`);
});

// ─── Halaman sukses setelah redirect dari QRIS ───────
app.get('/payment/success', (req, res) => {
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:50px">
        <h1>✅ Pembayaran Berhasil!</h1>
        <p>Akun Corpo Anda sedang diaktifkan.</p>
        <p>Silakan kembali ke WhatsApp untuk konfirmasi.</p>
    </body></html>`);
});

// ═══════════════════════════════════════════════════════
//  WEBHOOK WHATSAPP UTAMA
// ═══════════════════════════════════════════════════════
app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');
    const { sender, message, device, name } = req.body;
    if (!message || name === 'Corpomind') return;

    const normalize = n => n ? n.replace('@s.whatsapp.net','').replace('@g.us','').trim() : n;
    const deviceKey = normalize(device);
    const senderKey = normalize(sender);

    try {
        // ── Cek sesi registrasi dulu ──
        const handled = await handleRegistrasi(senderKey, message, name);
        if (handled) return;

        // ── Cek perintah owner: setadmin ──
        if (senderKey === OWNER_NOMOR && message.startsWith('setadmin_')) {
            const parts = message.split('_');
            // format: setadmin_NOMORBOT_NOMORADMIN
            if (parts.length === 3) {
                const targetBot   = parts[1];
                const targetAdmin = parts[2];
                const user = await getUser(targetBot);
                if (user) {
                    await saveUser(targetBot, { ...user, admin: targetAdmin });
                    await kirim(OWNER_NOMOR, `✅ Admin untuk bot *${targetBot}* diset ke *${targetAdmin}*`);
                } else {
                    await kirim(OWNER_NOMOR, `⚠️ Nomor bot *${targetBot}* tidak ditemukan di database.`);
                }
            }
            return;
        }

        // ── Ambil config user dari DB ──
        const config = await getUser(deviceKey);

        // Nomor belum terdaftar / tidak aktif — BLOKIR SEMUA PESAN, arahkan bayar
        if (!config || !config.sheet || !config.aktif) {
            await kirim(senderKey,
`╔══════════════════════╗
║   🤖  *C O R P O*   ║
║  Asisten AI Bisnis   ║
╚══════════════════════╝

⛔ *Akses Ditolak*

Nomor ini belum terdaftar atau belum aktif.
Bot tidak dapat digunakan sebelum melakukan pembayaran langganan.

━━━━━━━━━━━━━━━━━━━━━━
*💳 Cara Berlangganan:*
┌──────────────────────
┃ 💰 *Harga :* Rp 50.000 / bulan
┃ ✅ *Aktif :* Otomatis setelah bayar
└──────────────────────

Ketik *daftar* untuk mulai pendaftaran
atau hubungi kami langsung:

📱 *+62 822-4040-0388*
🔗 ${OWNER_WA_LINK}

━━━━━━━━━━━━━━━━━━━━━━
_Daftar sekarang, bisnis makin cerdas!_ 🚀`);
            return;
        }

        const isAdmin = senderKey === config.admin || senderKey.includes(config.admin);
        const sheets  = await getSheetNames(config.sheet);

        // ── CEK MASA LANGGANAN ──
        if (config.expired_at && new Date(config.expired_at) < new Date()) {
            // Nonaktifkan jika belum
            if (config.aktif) {
                await pool.query(`UPDATE users SET aktif = false WHERE nomor_bot = $1`, [deviceKey]);
            }
            await kirim(senderKey, pesanExpired());
            return;
        }

        // Cek apakah perlu kirim peringatan expired (3 hari sebelum) saat user aktif chat
        if (config.expired_at && !config.warned_exp) {
            const sisaMs   = new Date(config.expired_at) - new Date();
            const sisaHari = Math.ceil(sisaMs / (1000 * 60 * 60 * 24));
            if (sisaHari <= 3 && sisaHari > 0) {
                await kirim(senderKey, pesanPeringatanExpired(sisaHari, config.expired_at));
                await pool.query(`UPDATE users SET warned_exp = true WHERE nomor_bot = $1`, [deviceKey]);
            }
        }

        // ── CEK TOKEN USAGE ──
        const usage   = await getTokenUsage(senderKey);
        const today   = new Date().toISOString().slice(0,10);
        const tokensHariIni = usage.reset_date === today ? usage.tokens_used : 0;

        if (tokensHariIni >= TOKEN_LIMIT) {
            await kirim(senderKey, pesanHabisToken());
            return;
        }

        // ── 1. PILIH MENU ANGKA ──
        const sheetDipilih = deteksiPilihMenu(message, sheets);
        if (sheetDipilih) {
            const dataBisnis = await getSheetData(config.sheet);
            const icon = getIcon(sheetDipilih);
            const role = isAdmin
                ? 'AKSES: ADMIN. Boleh tampilkan semua data.'
                : 'AKSES: CUSTOMER. Rahasiakan modal dan gaji.';
            const promptFokus =
`Anda adalah "Corpo" asisten AI bisnis profesional dan friendly.
Pengguna memilih menu *${sheetDipilih}* ${icon}.
Tampilkan data dari sheet "${sheetDipilih}".
FORMAT WAJIB (WhatsApp):
- Header: ${icon} *${sheetDipilih.toUpperCase()}*
- Garis: ──────────────────
- Field: icon + *label* + spasi rapi (contoh: 📌 *Nama :* Budi)
- Pisah entri: ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
- Ringkasan di akhir jika relevan
- DILARANG tabel markdown
DATA: ${dataBisnis}
${role}`;
            const ai = await axios.post('https://api.groq.com/openai/v1/chat/completions',
                {
                    model   : 'llama-3.1-8b-instant',
                    messages: [
                        { role: 'system', content: promptFokus },
                        { role: 'user',   content: `Tampilkan data ${sheetDipilih}` }
                    ],
                    max_tokens : 1024,
                    temperature: 0.7
                },
                { headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } }
            );
            const jawaban = ai.data.choices[0].message.content;

            // Hitung & simpan token
            const tokensRequest  = estimasiToken(promptFokus) + estimasiToken(`Tampilkan data ${sheetDipilih}`);
            const tokensResponse = estimasiToken(jawaban);
            const tokensTotal    = tokensRequest + tokensResponse;
            await addTokenUsage(senderKey, tokensTotal);

            // Cek apakah perlu peringatan hampir habis
            const usageSetelah = tokensHariIni + tokensTotal;
            let pesanAkhir     = jawaban;
            if (usageSetelah >= TOKEN_WARN_AT && !usage.warned) {
                pesanAkhir += '\n' + pesanPeringatanToken(TOKEN_LIMIT - usageSetelah);
                await setWarned(senderKey);
            }

            addHistory(senderKey, 'user',      `Pilih menu: ${sheetDipilih}`);
            addHistory(senderKey, 'assistant', jawaban);
            await kirim(senderKey, pesanAkhir);
            return;
        }

        // ── 2. SAPAAN → tampilkan menu + info token (hanya jika belum pernah dapat info hari ini) ──
        if (isSapaan(message)) {
            const menu   = buildMenu(sheets, name);
            const isNew  = (usage.reset_date !== today) || (tokensHariIni === 0 && !usage.warned);
            const balasan = isNew ? pesanInfoToken() + '\n' + menu : menu;
            await kirim(senderKey, balasan);
            addHistory(senderKey, 'assistant', balasan);
            // Hitung token sapaan (kecil, pakai estimasi)
            await addTokenUsage(senderKey, estimasiToken(balasan));
            return;
        }

        // ── 3. CATAT TRANSAKSI (admin only) ──
        if (isAdmin) {
            const transaksi = deteksiTransaksi(message);
            if (transaksi) {
                const hasil = await catatTransaksi(config.sheet, {
                    action     : 'catat',
                    sheet      : transaksi.sheet,
                    tipe       : transaksi.tipe,
                    kategori   : 'Umum',
                    keterangan : transaksi.keterangan || message,
                    nominal    : transaksi.nominal
                });
                const ikon  = transaksi.tipe === 'Pemasukan' ? '💰' : '💸';
                const balas = hasil.status === 'ok'
                    ? `╔══════════════════════╗\n║  ✅  BERHASIL DICATAT  ║\n╚══════════════════════╝\n\n${ikon} *${transaksi.tipe}*\n──────────────────────\n💵 *Nominal    :* Rp ${transaksi.nominal.toLocaleString('id-ID')}\n📝 *Keterangan :* ${transaksi.keterangan||'-'}\n📅 *Waktu      :* ${new Date().toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})}\n──────────────────────\n📊 Data sudah masuk ke spreadsheet Bos!`
                    : `⚠️ Gagal catat: ${hasil.pesan}`;
                await kirim(senderKey, balas);
                addHistory(senderKey, 'assistant', balas);
                return;
            }
        }

        // ── 4. CHAT UMUM → AI ──
        const dataBisnis = await getSheetData(config.sheet);
        const role = isAdmin
            ? 'AKSES: ADMIN. Boleh tampilkan semua data.'
            : 'AKSES: CUSTOMER. Rahasiakan modal dan gaji.';
        const systemPrompt =
`Anda adalah "Corpo" (Corpomind), asisten AI bisnis cerdas dan friendly. Panggil pengguna "Bos".
KEPRIBADIAN: Profesional, santai, hangat, sedikit humoris.
ATURAN: Jawab sesuai yang ditanya saja. Tanya dulu jika kurang detail. Beritahu sopan jika data tidak ada.
FORMAT (WhatsApp): Header+icon, garis ──────, field pakai icon+*label* tebal, pisah entri ─ ─ ─, DILARANG tabel markdown.
DATA: ${dataBisnis}
${role}`;

        addHistory(senderKey, 'user', message);
        const messages = [
            { role: 'system', content: systemPrompt },
            ...chatHistory[senderKey].map(m => ({
                role   : m.role === 'model' ? 'assistant' : m.role,
                content: m.parts[0].text
            }))
        ];
        const ai = await axios.post('https://api.groq.com/openai/v1/chat/completions',
            {
                model   : 'llama-3.1-8b-instant',
                messages,
                max_tokens : 1024,
                temperature: 0.7
            },
            { headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } }
        );
        const jawaban = ai.data.choices[0].message.content;

        // Hitung & simpan token
        const tokensRequest2  = messages.reduce((acc, m) => acc + estimasiToken(typeof m.content === 'string' ? m.content : ''), 0);
        const tokensResponse2 = estimasiToken(jawaban);
        const tokensTotal2    = tokensRequest2 + tokensResponse2;
        await addTokenUsage(senderKey, tokensTotal2);

        // Cek apakah perlu peringatan hampir habis
        const usageSetelah2 = tokensHariIni + tokensTotal2;
        let pesanAkhir2     = jawaban;
        if (usageSetelah2 >= TOKEN_WARN_AT && !usage.warned) {
            pesanAkhir2 += '\n' + pesanPeringatanToken(TOKEN_LIMIT - usageSetelah2);
            await setWarned(senderKey);
        }

        addHistory(senderKey, 'assistant', jawaban);
        await kirim(senderKey, pesanAkhir2);

    } catch (err) {
        console.error('[ERROR]', err.message);
        if (err.response) console.error('[ERROR DETAIL]', JSON.stringify(err.response.data));
    }
});

// ─── Health check ─────────────────────────────────────
app.get('/', (req, res) => res.send(`${OWNER_NAMA} Bot LIVE ✅`));

// ─── Admin: tambah user manual (tanpa bayar) ──────────
// Akses: /admin/adduser?secret=xxx&nomor=xxx&admin=xxx&nama=xxx&sheet=xxx
app.get('/admin/adduser', async (req, res) => {
    const { secret, nomor, admin, nama, sheet } = req.query;

    // Ganti 'rahasiakamu123' dengan password kamu sendiri
    if (secret !== 'Versacy94') {
        return res.status(401).send('❌ Unauthorized');
    }
    if (!nomor || !sheet) {
        return res.status(400).send('❌ Parameter nomor dan sheet wajib diisi');
    }

    try {
        await saveUser(nomor, {
            sheet: sheet,
            admin: admin || nomor,
            nama : nama  || 'Owner',
            aktif: true
        });
        res.send(`✅ User berhasil ditambahkan!<br><br>
            <b>Nomor Bot:</b> ${nomor}<br>
            <b>Admin:</b> ${admin || nomor}<br>
            <b>Nama:</b> ${nama || 'Owner'}<br>
            <b>Sheet:</b> ${sheet}`);
    } catch (err) {
        console.error('[ADDUSER ERROR]', err.message);
        res.status(500).send('❌ Gagal: ' + err.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`${OWNER_NAMA} LIVE ON PORT ${PORT}`);
    jadwalkanCron();
});
