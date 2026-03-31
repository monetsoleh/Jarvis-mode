const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

app.post('/webhook', async (req, res) => {
    // Ambil data dari Fonnte
    const { sender, message } = req.body;
    
    console.log(`[MASUK] Chat dari: ${sender} | Isi: ${message}`);

    try {
        // Balas langsung TANPA Gemini
        const response = await axios.post('https://api.fonnte.com/send', {
            target: sender,
            message: `Lapor Bos Gigs! Sistem ngebaca lo ngetik: "${message}"`
        }, {
            headers: { 
                'Authorization': FONNTE_TOKEN.trim() 
            }
        });

        console.log(`[SUKSES] Status Fonnte:`, response.data);
        res.status(200).send('OK');

    } catch (error) {
        console.error(`[GAGAL BALES] Error dari Fonnte:`, error.response ? error.response.data : error.message);
        res.status(500).send('Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`=== TES GEMA STANDBY DI PORT ${PORT} ===`));
