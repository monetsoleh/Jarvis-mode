const express = require('express');
const app = express();
app.use(express.json());

// 1. Ini buat ngetes di Browser HP lo
app.get('/', (req, res) => {
    res.send('JARVIS UDAH BANGUN BOS!');
});

// 2. Ini pintu masuk buat data Fonnte
app.post('/webhook', (req, res) => {
    console.log("ADA DATA MASUK DARI FONNTE:", req.body);
    res.status(200).send("OK");
});

// 3. WAJIB PAKE '0.0.0.0' BIAR RAILWAY BISA BACA
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=== SERVER NYALA DI PORT ${PORT} ===`);
});
