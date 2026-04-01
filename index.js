const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
app.use(express.json());

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');

    console.log('[WEBHOOK RAW]', JSON.stringify(req.body));

    const { sender, message, device, name } = req.body;

    // Anti-Loop: Jangan balas chat dari bot sendiri
    if (!message || name === 'Corpomind') return;

    // Normalisasi format nomor dari Fonnte
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

        const sheetRes = await axios.get(config.sheet);
        const dataBisnis = JSON.stringify(sheetRes.data);

        const isAdmin = senderKey === config.admin || senderKey.includes(config.admin);

        const roleInstruction = isAdmin
            ? "AKSES: ADMIN (pemilik bisnis). Tampilkan semua data termasuk modal dan gaji."
            : "AKSES: CUSTOMER. Rahasiakan data modal dan gaji. Hanya tampilkan stok dan harga jual.";

        const systemPrompt = `Anda adalah "Jarvis", asisten AI bisnis. Panggil pengguna cukup dengan "Bos".

# ATURAN FORMAT PESAN — WAJIB DIIKUTI:
Pesan ini dikirim lewat WhatsApp. DILARANG menggunakan format tabel markdown (format | kolom | kolom | akan tampil acak-acakan di WhatsApp).

Gunakan format daftar seperti contoh berikut untuk menampilkan data:

──────────────────
📦 *Kain Jeans Denim*
   Kategori  : Bahan Baku
   Stok Sisa : 75 Roll
   Harga Jual: Rp 1.500.000
   Lokasi    : Gudang A
──────────────────

Aturan tambahan:
- Gunakan *teks* untuk cetak tebal
- Gunakan emoji yang sesuai (📦 ✅ ⚠️ 📊 💰)
- Pisahkan setiap item dengan garis ──────────────────
- Jangan gunakan bullet *, -, atau numbering di awal baris data
- Jawaban harus singkat, jelas, dan mudah dibaca di layar HP

# GAYA BAHASA:
- Sapaan: "Siap Bos! 🫡"
- Sopan, ringkas, dan to the point

# DATA SPREADSHEET:
${dataBisnis}

# ${roleInstruction}

# PERTANYAAN DARI PENGGUNA:
"${message}"`;

        const aiResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
            { contents: [{ parts: [{ text: systemPrompt }] }] }
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

app.get('/', (req, res) => res.send('Jarvis Bot LIVE ✅'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`SYSTEM SaaS LIVE ON PORT ${PORT}`));
