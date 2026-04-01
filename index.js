const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
app.use(express.json());

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');

    // ====== DEBUG LOG (hapus setelah bot jalan normal) ======
    console.log('[WEBHOOK RAW]', JSON.stringify(req.body));

    const { sender, message, device, name } = req.body;

    // 1. Anti-Loop: Jangan balas chat dari bot sendiri
    if (!message || name === 'Corpomind') return;

    // --- FIX #1: Normalisasi format nomor dari Fonnte ---
    // Fonnte kadang kirim format "628xxx@s.whatsapp.net", kita strip suffix-nya
    const normalize = (num) => {
        if (!num) return num;
        return num.replace('@s.whatsapp.net', '').replace('@g.us', '').trim();
    };

    const deviceKey = normalize(device);   // key untuk cari config
    const senderKey = normalize(sender);   // nomor pengirim bersih

    console.log(`[INFO] device="${device}" → deviceKey="${deviceKey}" | sender="${sender}" → senderKey="${senderKey}"`);

    try {
        // 2. Baca Database Pembeli (users.json)
        const userData = JSON.parse(fs.readFileSync('./users.json', 'utf8'));
        const config = userData[deviceKey]; // Ambil config berdasarkan nomor bot

        if (!config || !config.sheet) {
            console.log(`[ALERT] Nomor bot "${deviceKey}" belum terdaftar di users.json`);
            console.log(`[ALERT] Key yang tersedia:`, Object.keys(userData));
            return;
        }

        // 3. Ambil data dari Google Sheets pembeli tersebut
        const sheetRes = await axios.get(config.sheet);
        const dataBisnis = JSON.stringify(sheetRes.data);

        // 4. Logika Admin & Prompt Jarvis
        // --- FIX #2: Bandingkan nomor yang sudah dinormalisasi ---
        const isAdmin = senderKey === config.admin || senderKey.includes(config.admin);

        let roleInstruction = isAdmin
            ? "PERAN: Asisten Pribadi Elit. Buka semua data (modal/gaji) karena ini Bos Gigs."
            : "PERAN: Customer Service. Rahasiakan modal/gaji. Fokus ke stok dan harga jual.";

        const systemPrompt = `
        Anda adalah "Jarvis" (atau "Corpomind"), asisten AI elit milik "Bos Gigs".
        
        # GAYA BAHASA:
        - Jika disapa (Woi, Jing, P, Jarvis, dll): Balas dengan sangat sopan: "Siap Bos Gigs! Jarvis siap melayani. Ada perintah atau data yang mau dicek? 🫡"
        - Selalu panggil "Bos" atau "Bos Gigs".
        
        # FORMAT DATA:
        - Jika Bos tanya stok/data: Langsung tampilkan datanya dengan RAPI.
        - Gunakan Emoji (📦, 📊, ✅, ⚠️).
        - Gunakan Garis Pembatas (-------------------------).
        - Gunakan BOLD (*) untuk poin penting.
        
        # DATA SPREADSHEET:
        ${dataBisnis}
        
        # TINGKAT AKSES:
        ${roleInstruction}
        
        # PERTANYAAN:
        "${message}"
        `;

        const aiResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
            { contents: [{ parts: [{ text: systemPrompt }] }] }
        );

        const jawaban = aiResponse.data.candidates[0].content.parts[0].text;

        // 5. Kirim ke WhatsApp via Fonnte
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

// Endpoint health check (opsional, berguna di Railway)
app.get('/', (req, res) => res.send('Jarvis Bot LIVE ✅'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`SYSTEM SaaS LIVE ON PORT ${PORT}`));
