const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
app.use(express.json());

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');
    const { sender, message, device, name } = req.body;

    // 1. Anti-Loop: Jangan balas chat dari bot sendiri
    if (!message || name === 'Corpomind') return;

    try {
        // 2. Baca Database Pembeli (users.json)
        const userData = JSON.parse(fs.readFileSync('./users.json', 'utf8'));
        const config = userData[device]; // Ambil config berdasarkan nomor bot

        if (!config || !config.sheet) {
            console.log(`[ALERT] Nomor bot ${device} belum terdaftar di users.json`);
            return;
        }

        // 3. Ambil data dari Google Sheets pembeli tersebut
        const sheetRes = await axios.get(config.sheet);
        const dataBisnis = JSON.stringify(sheetRes.data);

        // 4. Logika Admin & Prompt Jarvis (Sopan & Rapi)
        const isAdmin = sender.includes(config.admin); 
        
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

        const aiResponse = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
            contents: [{ parts: [{ text: systemPrompt }] }]
        });

        const jawaban = aiResponse.data.candidates[0].content.parts[0].text;

        // 5. Kirim ke WhatsApp via Fonnte
        await axios.post('https://api.fonnte.com/send', {
            target: sender.replace('@s.whatsapp.net', '').replace('@g.us', ''),
            message: jawaban
        }, {
            headers: { 'Authorization': FONNTE_TOKEN.trim() }
        });

        console.log(`[SUKSES] Pesan dari ${sender} diproses. Admin: ${isAdmin}`);

    } catch (error) {
        console.error("[ERROR]", error.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`SYSTEM SaaS LIVE ON PORT ${PORT}`));
