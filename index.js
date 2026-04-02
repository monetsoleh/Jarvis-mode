const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
app.use(express.json());

const GROQ_KEY = (process.env.GROQ_API_KEY || "").trim();
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

// ─────────────────────────────────────────────
//  Cache Google Sheets — refresh setiap 5 menit
// ─────────────────────────────────────────────
const sheetsCache = {};
const CACHE_TTL = 5 * 60 * 1000;

async function getSheetData(url) {
    const now = Date.now();
    if (sheetsCache[url] && (now - sheetsCache[url].time) < CACHE_TTL) {
        console.log("[CACHE] Pakai data Sheets dari cache");
        return sheetsCache[url].data;
    }
    const res = await axios.get(url);
    sheetsCache[url] = { data: JSON.stringify(res.data), time: now };
    console.log("[CACHE] Data Sheets diperbarui");
    return sheetsCache[url].data;
}

// ─────────────────────────────────────────────
//  Ambil daftar nama sheet dari Apps Script
// ─────────────────────────────────────────────
async function getSheetNames(url) {
    const res = await axios.get(url, { params: { action: 'sheets' } });
    return res.data.sheets || [];
}

// ─────────────────────────────────────────────
//  Mapping icon otomatis berdasarkan nama sheet
// ─────────────────────────────────────────────
const ICON_FALLBACK = ['🗂️','📂','🗃️','📁','🔖','📎','🗄️','📃'];
let fallbackIndex = 0;

function getIcon(namaSheet) {
    const n = namaSheet.toLowerCase();
    if (/stok|barang|inventori|gudang|produk/.test(n))          return '📦';
    if (/absensi|karyawan|pegawai|staff|hadir/.test(n))         return '👥';
    if (/pengeluaran|keluar|biaya|expense/.test(n))             return '💸';
    if (/pemasukan|masuk|income|revenue/.test(n))               return '💰';
    if (/keuangan|finansial|kas|cashflow/.test(n))              return '📊';
    if (/pelanggan|customer|klien|client/.test(n))              return '🤝';
    if (/purchase order|po/.test(n))                            return '📋';
    if (/order|pesanan|transaksi|penjualan|sales/.test(n))      return '🛒';
    if (/pajak|tax/.test(n))                                    return '🧾';
    if (/gaji|salary|payroll/.test(n))                          return '💵';
    if (/jadwal|schedule|agenda|kalender/.test(n))              return '📅';
    if (/tugas|task|todo|pekerjaan/.test(n))                    return '✅';
    if (/laporan|report|rekap/.test(n))                         return '📝';
    if (/supplier|vendor|pemasok/.test(n))                      return '🏭';
    if (/aset|asset|inventaris/.test(n))                        return '🏷️';
    if (/makanan|food|minuman|drink/.test(n))                   return '🍽️';
    if (/proyek|project/.test(n))                               return '🚀';
    if (/catatan|note|memo/.test(n))                            return '📌';
    if (/hutang|piutang|pinjam/.test(n))                        return '🏦';
    if (/diskon|promo|voucher/.test(n))                         return '🎫';
    return ICON_FALLBACK[(fallbackIndex++) % ICON_FALLBACK.length];
}

// ─────────────────────────────────────────────
//  Bangun teks menu — gaya campuran profesional
// ─────────────────────────────────────────────
function buildMenu(sheets, namaUser) {
    fallbackIndex = 0;
    const baris = sheets.map((s, i) => {
        const icon = getIcon(s);
        const nomor = String(i + 1).padStart(2, ' ');
        return `┃ ${nomor}. ${icon}  ${s}`;
    });

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

// ─────────────────────────────────────────────
//  Deteksi sapaan
// ─────────────────────────────────────────────
function isSapaan(message) {
    const msg = message.trim().toLowerCase();

    // Pesan sangat pendek (1-4 karakter) → langsung anggap sapaan
    if (msg.length <= 4) return true;

    // Kata kunci sapaan eksplisit
    return /^(halo|hai|hi|hei|oi|ping|assalam|selamat|pagi|siang|sore|malam|menu|help|bantuan|start|mulai|hallo|hello|hey|corpo|corpomind|bot|p+|h+|hei+|test|tes|coba|cobain|buka|open)\b/i.test(msg);
}

// ─────────────────────────────────────────────
//  Deteksi pilihan menu (angka)
// ─────────────────────────────────────────────
function deteksiPilihMenu(message, sheets) {
    const angka = parseInt(message.trim());
    if (!isNaN(angka) && angka >= 1 && angka <= sheets.length) {
        return sheets[angka - 1];
    }
    return null;
}

// ─────────────────────────────────────────────
//  Catat transaksi ke Google Sheets via doPost
// ─────────────────────────────────────────────
async function catatTransaksi(sheetUrl, payload) {
    const res = await axios.post(sheetUrl, payload, {
        headers: { 'Content-Type': 'application/json' }
    });
    delete sheetsCache[sheetUrl];
    return res.data;
}

// ─────────────────────────────────────────────
//  Deteksi perintah catat transaksi
// ─────────────────────────────────────────────
function deteksiTransaksi(message) {
    const msg = message.toLowerCase();
    const polaPengeluaran = /\b(beli|bayar|keluar|pengeluaran|belanja|setor|bayarin|biaya)\b/i;
    const polaPemasukan   = /\b(terima|masuk|pemasukan|untung|laba|dapat|penjualan|terjual)\b/i;
    const polaAngka       = /(\d[\d.,]*)\s*(rb|ribu|rbu|jt|juta|k)?/i;

    const adaPengeluaran = polaPengeluaran.test(msg);
    const adaPemasukan   = polaPemasukan.test(msg);
    const matchAngka     = msg.match(polaAngka);

    if (!matchAngka || (!adaPengeluaran && !adaPemasukan)) return null;

    let nominal = parseFloat(matchAngka[1].replace(/[.,]/g, ''));
    const satuan = (matchAngka[2] || '').toLowerCase();
    if (/^(rb|ribu|rbu|k)$/.test(satuan)) nominal *= 1000;
    if (/^(jt|juta)$/.test(satuan))       nominal *= 1_000_000;

    const tipe = adaPemasukan ? 'Pemasukan' : 'Pengeluaran';
    const keterangan = message
        .replace(polaAngka, '')
        .replace(polaPengeluaran, '')
        .replace(polaPemasukan, '')
        .replace(/catat|tolong|dong|ya|yuk/gi, '')
        .trim();

    return { tipe, nominal, keterangan, sheet: tipe };
}

// ─────────────────────────────────────────────
//  History percakapan per pengirim (maks 10)
// ─────────────────────────────────────────────
const chatHistory = {};
const MAX_HISTORY = 10;

function addHistory(senderKey, role, text) {
    if (!chatHistory[senderKey]) chatHistory[senderKey] = [];
    chatHistory[senderKey].push({ role, parts: [{ text }] });
    if (chatHistory[senderKey].length > MAX_HISTORY) chatHistory[senderKey].shift();
}

// ─────────────────────────────────────────────
//  WEBHOOK UTAMA
// ─────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');
    console.log('[WEBHOOK RAW]', JSON.stringify(req.body));

    const { sender, message, device, name } = req.body;
    if (!message || name === 'Corpomind') return;

    const normalize = (num) => {
        if (!num) return num;
        return num.replace('@s.whatsapp.net', '').replace('@g.us', '').trim();
    };

    const deviceKey = normalize(device);
    const senderKey = normalize(sender);
    console.log(`[INFO] deviceKey="${deviceKey}" | senderKey="${senderKey}"`);

    try {
        const userData = JSON.parse(fs.readFileSync('./users.json', 'utf8'));
        const config   = userData[deviceKey];

        // ── Nomor belum terdaftar ──
        if (!config || !config.sheet) {
            console.log(`[ALERT] Nomor bot "${deviceKey}" belum terdaftar`);
            const pesanMarketing =
`╔══════════════════════╗
║   🤖  *C O R P O*   ║
║  Asisten AI Bisnis   ║
╚══════════════════════╝

Halo! 👋 Senang berkenalan dengan Anda!

Saya *Corpo* — Asisten AI Bisnis yang siap membuat usaha Anda lebih *cerdas & efisien* 🚀

*✨ Dengan Corpo, Anda bisa:*
┌──────────────────────
┃ 📦  Cek stok real-time
┃ 📊  Pantau data bisnis
┃ 👥  Monitor absensi
┃ 💸  Catat transaksi
┃ 💬  Semua via WhatsApp!
└──────────────────────

*🎯 Tertarik berlangganan?*
Hubungi admin kami:

📱 *+62 822-4040-0388*
🔗 https://wa.me/6282240400388

━━━━━━━━━━━━━━━━━━━━━━
_Bisnis lebih pintar dimulai dari satu pesan_ 💡`;
            await axios.post("https://api.fonnte.com/send", {
                target: senderKey,
                message: pesanMarketing
            }, { headers: { "Authorization": FONNTE_TOKEN.trim() } });
            return;
        }

        const isAdmin = senderKey === config.admin || senderKey.includes(config.admin);

        // ── 1. SAPAAN → tampilkan menu otomatis ──
        if (isSapaan(message)) {
            console.log(`[MENU] Sapaan terdeteksi dari ${senderKey}`);
            const sheets = await getSheetNames(config.sheet);
            const menu   = buildMenu(sheets, name);
            await axios.post('https://api.fonnte.com/send', {
                target : senderKey,
                message: menu
            }, { headers: { 'Authorization': FONNTE_TOKEN.trim() } });
            addHistory(senderKey, 'assistant', menu);
            return;
        }

        // ── 2. PILIH MENU ANGKA → AI fokus ke sheet itu ──
        const sheets = await getSheetNames(config.sheet);
        const sheetDipilih = deteksiPilihMenu(message, sheets);
        if (sheetDipilih) {
            console.log(`[MENU] User pilih sheet: ${sheetDipilih}`);
            const dataBisnis = await getSheetData(config.sheet);
            const roleInstruction = isAdmin
                ? "AKSES: ADMIN. Boleh tampilkan semua data termasuk modal dan gaji."
                : "AKSES: CUSTOMER. Rahasiakan modal dan gaji. Hanya tampilkan stok dan harga jual.";

            const icon = getIcon(sheetDipilih);

            const promptFokus =
`Anda adalah "Corpo" asisten AI bisnis profesional dan friendly.
Pengguna memilih menu *${sheetDipilih}* ${icon}.

Tampilkan data dari sheet "${sheetDipilih}" dengan format berikut:

ATURAN FORMAT WAJIB (WhatsApp):
- Mulai dengan header: ${icon} *${sheetDipilih.toUpperCase()}*
- Gunakan garis pemisah: ──────────────────
- Setiap item/baris data tampilkan dengan icon label yang relevan, contoh:
    📌 *Nama:* Budi
    💰 *Harga:* Rp 50.000
    📦 *Stok:* 12 pcs
    📅 *Tanggal:* 1 Jan 2025
- Pisahkan tiap entri dengan: ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
- Tutup dengan ringkasan singkat jika relevan (total, jumlah, dsb)
- DILARANG tabel markdown (| col |)
- Gunakan *teks* untuk tebal
- Ringkas, rapi, enak dibaca di HP

DATA SPREADSHEET:
${dataBisnis}

${roleInstruction}`;

            const aiResponse = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: promptFokus },
                        { role: 'user',   content: `Tampilkan semua data dari sheet ${sheetDipilih}` }
                    ],
                    max_tokens: 1024,
                    temperature: 0.7
                },
                { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } }
            );
            const jawaban = aiResponse.data.choices[0].message.content;
            addHistory(senderKey, 'user', `Pilih menu: ${sheetDipilih}`);
            addHistory(senderKey, 'assistant', jawaban);
            await axios.post('https://api.fonnte.com/send', {
                target: senderKey, message: jawaban
            }, { headers: { 'Authorization': FONNTE_TOKEN.trim() } });
            return;
        }

        // ── 3. CATAT TRANSAKSI (khusus admin) ──
        if (isAdmin) {
            const transaksi = deteksiTransaksi(message);
            if (transaksi) {
                console.log(`[CATAT] Transaksi terdeteksi:`, transaksi);
                const hasilCatat = await catatTransaksi(config.sheet, {
                    action     : 'catat',
                    sheet      : transaksi.sheet,
                    tipe       : transaksi.tipe,
                    kategori   : 'Umum',
                    keterangan : transaksi.keterangan || message,
                    nominal    : transaksi.nominal
                });
                const ikonTipe = transaksi.tipe === 'Pemasukan' ? '💰' : '💸';
                const pesanBalas = hasilCatat.status === 'ok'
                    ? `╔══════════════════════╗
║  ✅  BERHASIL DICATAT  ║
╚══════════════════════╝

${ikonTipe} *${transaksi.tipe}*
──────────────────────
💵 *Nominal  :* Rp ${transaksi.nominal.toLocaleString('id-ID')}
📝 *Keterangan:* ${transaksi.keterangan || '-'}
📅 *Waktu    :* ${new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
──────────────────────
📊 Data sudah masuk ke spreadsheet Bos!`
                    : `⚠️ *Gagal catat transaksi*\n\n${hasilCatat.pesan}`;
                await axios.post('https://api.fonnte.com/send', {
                    target: senderKey, message: pesanBalas
                }, { headers: { 'Authorization': FONNTE_TOKEN.trim() } });
                addHistory(senderKey, 'assistant', pesanBalas);
                return;
            }
        }

        // ── 4. CHAT UMUM → AI ──
        const dataBisnis = await getSheetData(config.sheet);
        const roleInstruction = isAdmin
            ? "AKSES: ADMIN (pemilik bisnis). Boleh tampilkan semua data termasuk modal dan gaji jika ditanya."
            : "AKSES: CUSTOMER. Rahasiakan data modal dan gaji. Hanya tampilkan stok dan harga jual jika ditanya.";

        const systemPrompt =
`Anda adalah "Corpo" (Corpomind), asisten AI bisnis yang cerdas, profesional, dan friendly. Panggil pengguna dengan "Bos".

# KEPRIBADIAN:
- Profesional tapi santai dan hangat.
- Boleh balas lucu/santai kalau Bos kirim pesan di luar konteks bisnis.
- Tetap sopan, tidak lebay.

# ATURAN JAWAB — WAJIB DIIKUTI:
1. JANGAN tampilkan semua data sekaligus tanpa diminta.
2. Jawab HANYA sesuai yang ditanya.
3. Sapaan saja → balas ramah, tanpa tampilkan data.
4. Pesan tidak berkaitan bisnis → balas singkat lucu/santai, lalu tawarkan bantuan bisnis.
5. Pertanyaan kurang detail → WAJIB tanya dulu, jangan tebak.
6. Data tidak ada di spreadsheet → beritahu sopan.
7. Data ditemukan → tampilkan HANYA yang diminta.

# FORMAT WAJIB SETIAP TAMPILKAN DATA (WhatsApp):
- Header dengan icon dan nama data: misal 📦 *STOK BARANG*
- Garis pemisah: ──────────────────
- Setiap field pakai icon + label tebal, contoh:
    📌 *Nama     :* Sabun Mandi
    💰 *Harga    :* Rp 5.000
    📦 *Stok     :* 30 pcs
    ⚠️ *Status   :* Hampir habis
- Pisahkan tiap entri dengan: ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
- Tutup dengan ringkasan jika relevan
- DILARANG tabel markdown (| col |)
- Ringkas dan enak dibaca di layar HP

# DATA SPREADSHEET:
${dataBisnis}

# ${roleInstruction}`;

        addHistory(senderKey, 'user', message);
        const messages = [
            { role: 'system', content: systemPrompt },
            ...chatHistory[senderKey].map(m => ({
                role   : m.role === 'model' ? 'assistant' : m.role,
                content: m.parts[0].text
            }))
        ];

        const aiResponse = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            { model: 'llama-3.3-70b-versatile', messages, max_tokens: 1024, temperature: 0.7 },
            { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } }
        );

        const jawaban = aiResponse.data.choices[0].message.content;
        addHistory(senderKey, 'assistant', jawaban);

        await axios.post('https://api.fonnte.com/send', {
            target: senderKey, message: jawaban
        }, { headers: { 'Authorization': FONNTE_TOKEN.trim() } });

        console.log(`[SUKSES] Pesan dari ${senderKey} diproses. Admin: ${isAdmin}`);

    } catch (error) {
        console.error("[ERROR]", error.message);
        if (error.response) console.error("[ERROR DETAIL]", JSON.stringify(error.response.data));
    }
});

app.get('/', (req, res) => res.send('Corpo Bot LIVE ✅'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`SYSTEM SaaS LIVE ON PORT ${PORT}`));
