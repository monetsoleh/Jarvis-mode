const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

// 1. Cek Status Browser
app.get('/', (req, res) => {
    res.send('JARVIS FULL SYSTEM ONLINE!');
});

// 2. Otak Utama Webhook
app.post('/webhook', async (req, res) => {
    const { sender, message } = req.body;
    
    // Bypass kalau Fonnte cuma ngirim report (sent/delivered)
    if (!message) return res.status(200).send('OK');

    console.log(`[MASUK] Pesan dari ${sender}: ${message}`);

    try {
        // A. Proses ke Gemini 2.5 Flash
        const aiResponse = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
            contents: [{ parts: [{ text: `Kamu adalah Jarvis, asisten pribadi. Jawab pesan ini secara singkat dan asik: ${message}` }] }]
        });
        const jawabanJarvis = aiResponse.data.candidates[0].content.parts[0].text;
        console.log(`[JARVIS] Berpikir: ${jawabanJarvis}`);

        // B. Kirim Balik ke WA via Fonnte
        const fonnteRes = await axios.post('https://api.fonnte.com/send', {
            target: sender.replace('@s.whatsapp.net', ''), // Pembersih ID WA
            message: jawabanJarvis
        }, {
            headers: { 'Authorization': FONNTE_TOKEN.trim() }
        });

        console.log(`[SUKSES] Terkirim! Status:`, fonnteRes.data);
        res.status(200).send('OK');

    } catch (error) {
        console.error(`[ERROR FATAL]`, error.response ? error.response.data : error.message);
        res.status(500).send('Error');
    }
});

// 3. Pintu Akses Railway (JANGAN DIUBAH)
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=== JARVIS STANDBY DI PORT ${PORT} ===`);
});
