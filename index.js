const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ambil Kunci dari Environment Variables
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

app.post('/webhook', async (req, res) => {
    // Data dari Fonnte
    const { device, sender, message } = req.body;

    console.log(`--- Ada Chat Masuk ---`);
    console.log(`Dari: ${sender}`);
    console.log(`Pesan: ${message}`);

    try {
        // 1. KIRIM KE GEMINI AI
        const aiResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
            {
                contents: [{ parts: [{ text: `Kamu adalah Jarvis, asisten pribadi Bos Gigs yang cerdas dan to-the-point. Jawab pesan ini: ${message}` }] }]
            }
        );

        const textJawaban = aiResponse.data.candidates[0].content.parts[0].text;
        console.log(`Jawaban AI: ${textJawaban}`);

        // 2. KIRIM BALIK KE WHATSAPP VIA FONNTE
        const fonnteRes = await axios.post('https://api.fonnte.com/send', {
            target: sender,
            message: textJawaban,
            delay: "2"
        }, {
            headers: { 
                'Authorization': FONNTE_TOKEN.trim() 
            }
        });

        console.log(`Status Fonnte:`, fonnteRes.data);
        res.status(200).send({ status: 'success', data: fonnteRes.data });

    } catch (error) {
        console.error('--- ERROR TERDETEKSI ---');
        if (error.response) {
            console.error('Data Error:', error.response.data);
            console.error('Status Error:', error.response.status);
        } else {
            console.error('Pesan Error:', error.message);
        }
        res.status(500).send({ status: 'error', message: error.message });
    }
});

// Jalankan Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`====================================`);
    console.log(`JARVIS ONLINE DI PORT ${PORT}`);
    console.log(`URL Webhook: /webhook`);
    console.log(`====================================`);
});
