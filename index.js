const express = require('express');
const axios   = require('axios');
const fs      = require('fs');
const app     = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const GROQ_KEY        = (process.env.GROQ_API_KEY       || '').trim();
const FONNTE_TOKEN    = (process.env.FONNTE_TOKEN        || '').trim();
const MUSTIKA_API_KEY = (process.env.MUSTIKAPAY_API_KEY  || '').trim();

// ─── Konfigurasi Owner ───────────────────────
const OWNER_NAMA    = 'Corpomind';
const OWNER_NOMOR   = '6282240400388';
const OWNER_WA_LINK = 'https://wa.me/6282240400388';
const BASE_URL      = process.env.BASE_URL || 'https://jarvis-mode-production.up.railway.app';
const HARGA         = 50000;

// ─────────────────────────────────────────────
//  MustikaPay Helper — sesuai docs v1.6
//  Base URL   : https://mustikapayment.com
//  Auth       : X-Api-Key header
//  POST type  : application/x-www-form-urlencoded
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
//  Helpers: baca / tulis users.json
// ─────────────────────────────────────────────
function readUsers() {
    try { return JSON.parse(fs.readFileSync('./users.json', 'utf8')); }
    catch { return {}; }
}
function writeUsers(data) {
    fs.writeFileSync('./users.json', JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────────
//  Session pendaftaran sementara
// ─────────────────────────────────────────────
const regSession = {};

// ─────────────────────────────────────────────
//  Cache Google Sheets
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
//  Icon & Menu
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
//  Catat transaksi
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
//  History chat
// ─────────────────────────────────────────────
const chatHistory = {};
const MAX_HISTORY = 10;
function addHistory(key, role, text) {
    if (!chatHistory[key]) chatHistory[key] = [];
    chatHistory[key].push({ role, parts: [{ text }] });
    if (chatHistory[key].length > MAX_HISTORY) chatHistory[key].shift();
}

// ─────────────────────────────────────────────
//  Kirim WA via Fonnte
// ─────────────────────────────────────────────
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
    const sess = regSession[senderKey];

    // Batalkan sesi
    if (sess && /^(batal|cancel|stop)$/i.test(msg)) {
        delete regSession[senderKey];
        await kirim(senderKey, '❌ Pendaftaran dibatalkan. Ketik *daftar* kapan saja untuk memulai lagi.');
        return true;
    }

    // Mulai daftar
    if (!sess && /^(daftar|register|subscribe|langganan)$/i.test(msg)) {
        regSession[senderKey] = { step: 'nama' };
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
        regSession[senderKey].nama = msg;
        regSession[senderKey].step = 'nomorBot';
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
        regSession[senderKey].nomorBot = nomor;
        regSession[senderKey].step     = 'sheet';
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
        regSession[senderKey].sheet = msg;
        regSession[senderKey].step  = 'bayar';

        try {
            // Buat QRIS sesuai docs v1.6 — POST /api/createpay
            const qris = await createQRIS(HARGA, name || 'Pelanggan', 'Berlangganan Corpo');

            if (qris.status !== 'success') throw new Error(qris.message || 'Gagal membuat QRIS');

            // Simpan ref_no untuk dicocokkan saat webhook callback masuk
            regSession[senderKey].refNo = qris.ref_no;

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
            delete regSession[senderKey];
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
//  Docs: POST payload berisi { status, service, amount,
//        reference, order_id, timestamp,
//        data: { ref_no, amount, issuer, rrn } }
// ═══════════════════════════════════════════════════════
app.post('/payment/callback', async (req, res) => {
    res.status(200).send('OK'); // Wajib balas 200 sesuai docs
    console.log('[CALLBACK] MustikaPay:', JSON.stringify(req.body));

    const body   = req.body;
    const status = (body.status || '').toLowerCase();

    // Hanya proses jika status success
    if (status !== 'success' && status !== 'paid') {
        console.log('[CALLBACK] Status bukan success, diabaikan:', status);
        return;
    }

    // Ambil ref_no dari root (reference) atau dari data.ref_no — sesuai docs
    const refNo = body.reference || (body.data && body.data.ref_no) || body.ref_no;
    if (!refNo) {
        console.warn('[CALLBACK] ref_no tidak ditemukan di payload');
        return;
    }

    console.log('[CALLBACK] ref_no diterima:', refNo);

    // Cari sesi pendaftaran yang cocok
    const senderKey = Object.keys(regSession).find(k => regSession[k].refNo === refNo);
    if (!senderKey) {
        console.warn('[CALLBACK] Tidak ada sesi untuk ref_no:', refNo);
        return;
    }

    const sess  = regSession[senderKey];
    const users = readUsers();

    // Simpan ke users.json
    users[sess.nomorBot] = {
        sheet : sess.sheet,
        admin : '',           // owner isi manual
        nama  : sess.nama,
        aktif : true,
        daftar: new Date().toISOString()
    };
    writeUsers(users);
    delete regSession[senderKey];

    console.log(`[REGISTRASI SUKSES] nomor: ${sess.nomorBot} | bisnis: ${sess.nama}`);

    // Notif ke pendaftar
    await kirim(senderKey,
`╔══════════════════════╗
║  ✅  PEMBAYARAN OK!  ║
╚══════════════════════╝

Yeay! Pembayaran berhasil 🎉
*Akun Corpo Anda sudah AKTIF!*

┌──────────────────────
┃ 🏢 *Bisnis :* ${sess.nama}
┃ 📱 *Bot    :* ${sess.nomorBot}
┃ 📅 *Aktif  :* ${new Date().toLocaleDateString('id-ID')}
└──────────────────────

*Langkah selanjutnya:*
1️⃣ Hubungkan nomor *${sess.nomorBot}* ke Fonnte
2️⃣ Hubungi kami untuk set nomor admin:

📱 *+62 822-4040-0388*
🔗 ${OWNER_WA_LINK}

━━━━━━━━━━━━━━━━━━━━━━
Terima kasih sudah bergabung! 🚀
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
⚠️ Set nomor *admin* di users.json untuk nomor bot *${sess.nomorBot}*`);
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
        // Cek sesi registrasi dulu
        const handled = await handleRegistrasi(senderKey, message, name);
        if (handled) return;

        const userData = readUsers();
        const config   = userData[deviceKey];

        // Nomor belum terdaftar / tidak aktif
        if (!config || !config.sheet || !config.aktif) {
            await kirim(senderKey,
`╔══════════════════════╗
║   🤖  *C O R P O*   ║
║  Asisten AI Bisnis   ║
╚══════════════════════╝

Halo! 👋 Selamat datang di *${OWNER_NAMA}*!

Saya *Corpo* — Asisten AI Bisnis yang siap membuat usaha Anda lebih *cerdas & efisien* 🚀

*✨ Dengan Corpo, Anda bisa:*
┌──────────────────────
┃ 📦  Cek stok real-time
┃ 📊  Pantau data bisnis
┃ 👥  Monitor absensi
┃ 💸  Catat transaksi
┃ 💬  Semua via WhatsApp!
└──────────────────────

*🎯 Daftar sekarang, ketik:*
👉 *daftar*

Atau hubungi kami:
📱 *+62 822-4040-0388*
🔗 ${OWNER_WA_LINK}

━━━━━━━━━━━━━━━━━━━━━━
_Bisnis lebih pintar dimulai dari satu pesan_ 💡`);
            return;
        }

        const isAdmin = senderKey === config.admin || senderKey.includes(config.admin);
        const sheets  = await getSheetNames(config.sheet);

        // ── 1. PILIH MENU ANGKA ──
        const sheetDipilih = deteksiPilihMenu(message, sheets);
        if (sheetDipilih) {
            const dataBisnis = await getSheetData(config.sheet);
            const icon = getIcon(sheetDipilih);
            const role = isAdmin ? 'AKSES: ADMIN. Boleh tampilkan semua data.' : 'AKSES: CUSTOMER. Rahasiakan modal dan gaji.';
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
                { model:'llama-3.3-70b-versatile', messages:[{role:'system',content:promptFokus},{role:'user',content:`Tampilkan data ${sheetDipilih}`}], max_tokens:1024, temperature:0.7 },
                { headers:{ Authorization:`Bearer ${GROQ_KEY}`, 'Content-Type':'application/json' } }
            );
            const jawaban = ai.data.choices[0].message.content;
            addHistory(senderKey,'user',`Pilih menu: ${sheetDipilih}`);
            addHistory(senderKey,'assistant',jawaban);
            await kirim(senderKey, jawaban);
            return;
        }

        // ── 2. SAPAAN → menu ──
        if (isSapaan(message)) {
            const menu = buildMenu(sheets, name);
            await kirim(senderKey, menu);
            addHistory(senderKey,'assistant',menu);
            return;
        }

        // ── 3. CATAT TRANSAKSI (admin) ──
        if (isAdmin) {
            const transaksi = deteksiTransaksi(message);
            if (transaksi) {
                const hasil = await catatTransaksi(config.sheet, {
                    action:'catat', sheet:transaksi.sheet, tipe:transaksi.tipe,
                    kategori:'Umum', keterangan:transaksi.keterangan||message, nominal:transaksi.nominal
                });
                const ikon  = transaksi.tipe === 'Pemasukan' ? '💰' : '💸';
                const balas = hasil.status === 'ok'
                    ? `╔══════════════════════╗\n║  ✅  BERHASIL DICATAT  ║\n╚══════════════════════╝\n\n${ikon} *${transaksi.tipe}*\n──────────────────────\n💵 *Nominal    :* Rp ${transaksi.nominal.toLocaleString('id-ID')}\n📝 *Keterangan :* ${transaksi.keterangan||'-'}\n📅 *Waktu      :* ${new Date().toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})}\n──────────────────────\n📊 Data sudah masuk ke spreadsheet Bos!`
                    : `⚠️ Gagal catat: ${hasil.pesan}`;
                await kirim(senderKey, balas);
                addHistory(senderKey,'assistant',balas);
                return;
            }
        }

        // ── 4. CHAT UMUM → AI ──
        const dataBisnis = await getSheetData(config.sheet);
        const role = isAdmin ? 'AKSES: ADMIN. Boleh tampilkan semua data.' : 'AKSES: CUSTOMER. Rahasiakan modal dan gaji.';
        const systemPrompt =
`Anda adalah "Corpo" (Corpomind), asisten AI bisnis cerdas dan friendly. Panggil pengguna "Bos".
KEPRIBADIAN: Profesional, santai, hangat, sedikit humoris.
ATURAN: Jawab sesuai yang ditanya saja. Tanya dulu jika kurang detail. Beritahu sopan jika data tidak ada.
FORMAT (WhatsApp): Header+icon, garis ──────, field pakai icon+*label* tebal, pisah entri ─ ─ ─, DILARANG tabel markdown.
DATA: ${dataBisnis}
${role}`;

        addHistory(senderKey,'user',message);
        const messages = [
            { role:'system', content:systemPrompt },
            ...chatHistory[senderKey].map(m => ({ role: m.role==='model'?'assistant':m.role, content:m.parts[0].text }))
        ];
        const ai = await axios.post('https://api.groq.com/openai/v1/chat/completions',
            { model:'llama-3.3-70b-versatile', messages, max_tokens:1024, temperature:0.7 },
            { headers:{ Authorization:`Bearer ${GROQ_KEY}`, 'Content-Type':'application/json' } }
        );
        const jawaban = ai.data.choices[0].message.content;
        addHistory(senderKey,'assistant',jawaban);
        await kirim(senderKey, jawaban);

    } catch (err) {
        console.error('[ERROR]', err.message);
        if (err.response) console.error('[ERROR DETAIL]', JSON.stringify(err.response.data));
    }
});

app.get('/', (req, res) => res.send(`${OWNER_NAMA} Bot LIVE ✅`));
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`${OWNER_NAMA} LIVE ON PORT ${PORT}`));
