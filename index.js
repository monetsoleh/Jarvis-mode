const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

// 1. Cek Status di Browser
app.get('/', (req, res) => {
    res.send('JARVIS FULL SYSTEM ONLINE & ANTI-SPAM!');
});

// 2. Webhook Utama
app.post('/webhook', async (req, res) => {
    // LANGSUNG respon OK ke Fonnte biar gak dikirim ulang (Anti-Pending/Retry)
    res.status(200).send('OK');

    const { sender, message, name } = req.body;

    // FILTER: Jangan proses kalau pesan kosong atau dari diri sendiri (Corpomind)
    if (!message || name === 'Corpomind') {
        return;
    }

    console.log(`[MASUK] Dari: ${sender} (${name}) | Pesan: ${message}`);

    try {
        // A. Tanya Gemini (Versi 1.5 Flash biar stabil)
        const aiResponse = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`, {
            contents: [{ 
                parts: [{ 
                    text: `Kamu adalah Jarvis, asisten pribadi Bos Gigs. Jawab pesan ini secara singkat, asik, dan membantu: ${message}` 
                }] 
            }]
        });

        const jawabanJarvis = aiResponse.data.candidates[0].content.parts[0].text;
        console.log(`[JARVIS] Menjawab: ${jawabanJarvis}`);

        // B. Kirim Balik ke WA via Fonnte
        const config = {
            headers: { 'Authorization': FONNTE_TOKEN.trim() }
        };

        const payload = {
            target: sender.replace('@s.whatsapp.net', '').replace('@g.us', ''),
            message: jawabanJarvis
        };

        const fonnteRes = await axios.post('https://api.fonnte.com/send', payload, config);
        console.log(`[SUKSES] Status Fonnte:`, fonnteRes.data.status);

    } catch (error) {
        console.error(`[ERROR]`, error.response ? error.response.data : error.message);
    }
});

// 3. Port Railway (0.0.0.0 itu wajib)
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=== JARVIS ONLINE DI PORT ${PORT} ===`);
});
