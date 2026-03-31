const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

app.post('/webhook', async (req, res) => {
    const { device, sender, message } = req.body;

    try {
        // 1. Tanya Gemini
        const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`, {
            contents: [{ parts: [{ text: `Kamu adalah Jarvis, asisten pribadi. Jawab pesan ini: ${message}` }] }]
        });

        const jawapanJarvis = response.data.candidates[0].content.parts[0].text;

        // 2. Balas ke Fonnte
        await axios.post('https://api.fonnte.com/send', {
            target: sender,
            message: jawapanJarvis,
            delay: "2"
        }, {
            headers: { 'Authorization': FONNTE_TOKEN }
        });

        res.status(200).send('OK');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error');
    }
});

app.listen(process.env.PORT || 3000, () => console.log('Jarvis Online!'));
