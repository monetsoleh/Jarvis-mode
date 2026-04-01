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
        const userSheetUrl = userData[device]; // 'device' adalah nomor bot penerima

        if (!userSheetUrl) {
            console.log(`[ALERT] Nomor ${device} belum terdaftar di users.json`);
            return;
        }

        // 3. Ambil data dari Google Sheets pembeli tersebut
        const sheetRes = await axios.get(userSheetUrl);
        const dataBisnis = JSON.stringify(sheetRes.data);

        // 4. Prompt Gemini (Logika Sales & Admin)
        const isAdmin = sender.includes("6282240400388"); // Ganti nomor lo
        let instruksi = `Data Bisnis: ${dataBisnis}. User bertanya: "${message}". `;
        
        if (isAdmin) {
            instruksi += "Jawab sebagai asisten pribadi yang jujur dan detail (tampilkan modal/gaji).";
        } else {
            instruksi += "Jawab sebagai Customer Service yang ramah. JANGAN kasih tahu harga modal/gaji. Fokus ke harga jual dan stok.";
        }

        const aiResponse = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
            contents: [{ parts: [{ text: instruksi }] }]
        });

        const jawaban = aiResponse.data.candidates[0].content.parts[0].text;

        // 5. Kirim ke WhatsApp via Fonnte
        await axios.post('https://api.fonnte.com/send', {
            target: sender.replace('@s.whatsapp.net', '').replace('@g.us', ''),
            message: jawaban
        }, {
            headers: { 'Authorization': FONNTE_TOKEN.trim() }
        });

        console.log(`[SUKSES] Pesan dari ${sender} diproses menggunakan data dari ${device}`);

    } catch (error) {
        console.error("[ERROR]", error.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`SYSTEM SaaS LIVE ON PORT ${PORT}`));
