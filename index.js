const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
app.use(express.json());
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;
// Cache Google Sheets — refresh setiap 5 menit
const sheetsCache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 menit
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
app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');
    console.log('[WEBHOOK RAW]', JSON.stringify(req.body));
    const { sender, message, device, name } = req.body;
    // Anti-Loop: Jangan balas chat dari bot sendiri
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
        const config = userData[deviceKey];
        if (!config || !config.sheet) {
            console.log(`[ALERT] Nomor bot "${deviceKey}" belum terdaftar di users.json`);
            console.log(`[ALERT] Key yang tersedia:`, Object.keys(userData));
            return;
        }
        const dataBisnis = await getSheetData(config.sheet);
        const isAdmin = senderKey === config.admin || senderKey.includes(config.admin);
        const roleInstruction = isAdmin
            ? "AKSES: ADMIN (pemilik bisnis). Boleh tampilkan semua data termasuk modal dan gaji jika ditanya."
            : "AKSES: CUSTOMER. Rahasiakan data modal dan gaji. Hanya tampilkan stok dan harga jual jika ditanya.";
        const systemPrompt = `Anda adalah "Corpo" (Corpomind), asisten AI bisnis. Panggil pengguna dengan "Bos".
# ATURAN UTAMA — WAJIB DIIKUTI:
1. JANGAN PERNAH menampilkan semua data sekaligus tanpa diminta.
2. Jawab HANYA sesuai pertanyaan yang diajukan.
3. Jika pesan hanya sapaan (contoh: "oi", "halo", "hai", "p", "woi", dll):
   Balas HANYA dengan sapaan sopan seperti:
   "Siap Bos! 🫡 Ada yang bisa Corpo bantu?"
   JANGAN tampilkan data apapun.
4. Jika ditanya tentang satu item/orang/data tertentu, jawab hanya item itu saja.
5. Jika ditanya ringkasan atau semua data, baru tampilkan semuanya.
# CONTOH YANG BENAR:
Pengguna: "oi"
Corpo: "Siap Bos! 🫡 Ada yang bisa Corpo bantu?"
Pengguna: "stok kain hari ini"
Corpo:
"📦 *Kain Jeans Denim*
   Stok Sisa : 75 Roll
   Lokasi    : Gudang A ✅"
Pengguna: "absensi agus bulan ini"
Corpo:
"📊 *Absensi - Agus*
   Hadir : 28 hari
   Bulan : April 2026 ✅"
# ATURAN FORMAT PESAN:
- Ini pesan WhatsApp. DILARANG format tabel markdown (| kolom | kolom |).
- Gunakan *teks* untuk cetak tebal.
- Gunakan emoji yang sesuai (📦 ✅ ⚠️ 📊 💰 🫡).
- Pisahkan item dengan garis ──────────────────
- Jawaban singkat, jelas, mudah dibaca di layar HP.
# DATA SPREADSHEET:
${dataBisnis}
# ${roleInstruction}
# PESAN DARI PENGGUNA:
"${message}"`;
        const aiResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
            { contents: [{ parts: [{ text: systemPrompt }] }], generationConfig: { thinkingConfig: { thinkingBudget: 0 } } }
        );
        const jawaban = aiResponse.data.candidates[0].content.parts[0].text;
        await axios.post('https://api.fonnte.com/send', {
            target: senderKey,
            message: jawaban
        }, {
            headers: { 'Authorization': FONNTE_TOKEN.trim() }
        });
        console.log(`[SUKSES] Pesan dari ${senderKey} diproses. Admin: ${isAdmin}`);
    } catch (error) {
        console.error("[ERROR]", error.message);
        if (error.response) {
            console.error("[ERROR DETAIL]", JSON.stringify(error.response.data));
        }
    }
});
app.get('/', (req, res) => res.send('Corpo Bot LIVE ✅'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`SYSTEM SaaS LIVE ON PORT ${PORT}`));
