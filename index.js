const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
app.use(express.json());
const GROQ_KEY = (process.env.GROQ_API_KEY || "").trim();
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
// History percakapan per pengirim (maks 10 pesan terakhir)
const chatHistory = {};
const MAX_HISTORY = 10;

function addHistory(senderKey, role, text) {
    if (!chatHistory[senderKey]) chatHistory[senderKey] = [];
    chatHistory[senderKey].push({ role, parts: [{ text }] });
    if (chatHistory[senderKey].length > MAX_HISTORY) {
        chatHistory[senderKey].shift();
    }
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
            console.log(`[ALERT] Nomor bot "${deviceKey}" belum terdaftar`);
            const pesanMarketing = `Halo! 👋 Senang bisa berkenalan dengan Anda.

Saya *Corpo* — Asisten AI Bisnis yang siap membantu usaha Anda jadi lebih cerdas & efisien. 🤖✨

Dengan Corpo, Anda bisa:
📦 Cek stok barang secara real-time
📊 Pantau data bisnis kapan saja
👥 Monitor absensi karyawan
💬 Semua lewat WhatsApp, tanpa ribet!

Tertarik? Hubungi admin kami sekarang untuk berlangganan:

👉 *+62 822-4040-0388*
atau klik: https://wa.me/6282240400388

_Bisnis lebih pintar dimulai dari satu pesan._ 🚀`;
            await axios.post("https://api.fonnte.com/send", {
                target: senderKey,
                message: pesanMarketing
            }, { headers: { "Authorization": FONNTE_TOKEN.trim() } });
            return;
        }
        const dataBisnis = await getSheetData(config.sheet);
        const isAdmin = senderKey === config.admin || senderKey.includes(config.admin);
        const roleInstruction = isAdmin
            ? "AKSES: ADMIN (pemilik bisnis). Boleh tampilkan semua data termasuk modal dan gaji jika ditanya."
            : "AKSES: CUSTOMER. Rahasiakan data modal dan gaji. Hanya tampilkan stok dan harga jual jika ditanya.";
        const systemPrompt = `Anda adalah "Corpo" (Corpomind), asisten AI bisnis yang cerdas dan sedikit humoris. Panggil pengguna dengan "Bos".

# KEPRIBADIAN:
- Profesional tapi santai dan hangat.
- Boleh balas lucu/santai kalau Bos kirim pesan di luar konteks bisnis.
- Tetap sopan, tidak lebay.

# ATURAN JAWAB — WAJIB DIIKUTI:

1. JANGAN tampilkan semua data sekaligus tanpa diminta.
2. Jawab HANYA sesuai yang ditanya.
3. Sapaan saja ("oi", "halo", "p", dll) → balas sapaan sopan saja, tanpa tampilkan data apapun.

4. Pesan TIDAK BERKAITAN bisnis (curhat, ajak jalan, nanya cuaca, bercanda, dll) → balas singkat dengan nada lucu/santai, lalu tawarkan bantuan bisnis. Contoh:
   Bos: "nongkrong yuk"
   Corpo: "Aduh Bos, Corpo mah 24 jam di sini jagain data bisnis 😅 Bos yang nongkrong duluan aja, nanti kalau mau cek stok Corpo siap! 🫡"

5. Pertanyaan KURANG DETAIL (tidak ada nama/spesifikasi) → WAJIB tanya dulu, jangan tebak. Contoh:
   Bos: "minta absensi dong"
   Corpo: "Absensi siapa nih Bos? Sebutkan namanya ya 😊"
   Bos: "cek stok"
   Corpo: "Stok barang apa Bos? Sebutkan nama barangnya 📦"

6. Nama/data TIDAK ADA di spreadsheet → beritahu sopan. Contoh:
   Bos: "absensi budi"
   Corpo: "Hmm, Corpo udah cari tapi kayaknya Budi bukan karyawan di sini Bos, datanya gak ketemu nih 🤔 Coba cek lagi nama lengkapnya?"

7. Data DITEMUKAN → tampilkan HANYA data yang diminta, rapi dan ringkas.

# FORMAT PESAN (WhatsApp):
- DILARANG tabel markdown (| kolom | kolom |) — akan acak-acakan di WA.
- Gunakan *teks* untuk tebal.
- Emoji secukupnya (📦 ✅ ⚠️ 📊 💰 🫡 😅 💪).
- Pisahkan item dengan ──────────────────
- Ringkas dan enak dibaca di layar HP.

# DATA SPREADSHEET:
\${dataBisnis}

# \${roleInstruction}`;


        // Tambah pesan user ke history
        addHistory(senderKey, 'user', message);

        // Bangun messages format OpenAI/Groq
        const messages = [
            { role: 'system', content: systemPrompt },
            ...chatHistory[senderKey].map(m => ({
                role: m.role === 'model' ? 'assistant' : m.role,
                content: m.parts[0].text
            }))
        ];

        const aiResponse = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.3-70b-versatile',
                messages: messages,
                max_tokens: 1024,
                temperature: 0.7
            },
            { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } }
        );
        const jawaban = aiResponse.data.choices[0].message.content;

        // Simpan jawaban bot ke history
        addHistory(senderKey, 'assistant', jawaban);


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
