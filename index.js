const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

// 1. Cek Status di Browser
app.get('/', (req, res) => {
    res.send('JARVIS 2.5 FLASH ONLINE!');
});

// 2. Webhook Utama
app.post('/webhook', async (req, res) => {
    // Balas 'OK' instan ke Fonnte supaya tidak ada pengiriman ulang (retry)
    res.status(200).send('OK');

    const { sender, message, name } = req.body;

    // Filter agar tidak memproses pesan kosong atau pesan dari bot sendiri (Anti-Loop)
    if (!message || name === 'Corpomind') {
        return;
    }

    console.log(`[MASUK] Dari: ${sender} | Pesan: ${message}`);

    try {
        // A. Panggil API Gemini 2.5 Flash
        const aiResponse = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
            contents: [{ 
                parts: [{ 
                    text: `Kamu adalah Jarvis, asisten pribadi Bos Gigs yang cerdas dan asik. Jawab ini: ${message}` 
                }] 
            }]
        });

        const jawabanJarvis = aiResponse.data.candidates[0].content.parts[0].text;
        console.log(`[JARVIS 2.5] Menjawab: ${jawabanJarvis}`);

        // B. Kirim Balik ke WA via Fonnte
        await axios.post('https://api.fonnte.com/send', {
            target: sender.replace('@s.whatsapp.net', '').replace('@g.us', ''),
            message: jawabanJarvis
        }, {
            headers: { 'Authorization': FONNTE_TOKEN.trim() }
        });

        console.log(`[SUKSES] Pesan terkirim ke WhatsApp.`);

    } catch (error) {
        // Log error jika API Gemini atau Fonnte bermasalah
        console.error(`[ERROR]`, error.response ? error.response.data : error.message);
    }
});

// 3. Konfigurasi Port Railway
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=== JARVIS 2.5 FLASH STANDBY DI PORT ${PORT} ===`);
});
