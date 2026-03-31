const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const FONNTE_TOKEN = process.env.FONNTE_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

app.post('/webhook', async (req, res) => {
    const { sender, message } = req.body;
    console.log(`[LOG] Ada chat masuk dari ${sender}: ${message}`);

    try {
        // 1. Tanya Gemini
        const ai = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`, {
            contents: [{ parts: [{ text: message }] }]
        });
        const jawaban = ai.data.candidates[0].content.parts[0].text;

        // 2. Balas ke Fonnte (Gue perbaiki formatnya di sini)
        const kirim = await axios.post('https://api.fonnte.com/send', {
            target: sender.replace('@s.whatsapp.net', ''), // Bersihin format nomor
            message: jawaban
        }, {
            headers: { 'Authorization': FONNTE_TOKEN.trim() }
        });

        console.log(`[SUKSES] Fonnte bilang: ${JSON.stringify(kirim.data)}`);
        res.status(200).send('OK');
    } catch (err) {
        console.error(`[ERROR]`, err.response ? err.response.data : err.message);
        res.status(500).send('Error');
    }
});

app.listen(process.env.PORT || 3000, () => console.log('JARVIS AKTIF!'));
