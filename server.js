const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

// 1. SERVE THE FRONTEND
// This tells Express to serve your index.html file on localhost:3000
app.use(express.static(path.join(__dirname, 'public')));

// 2. IN-MEMORY STORAGE (You can replace this with MongoDB later)
let generatedKeys = [];

const generateKey = () => 'moonwitch_' + Math.random().toString(36).substr(2, 9);

// 3. ADMIN DASHBOARD ROUTES
// Get all keys
app.get('/api/admin/keys', (req, res) => {
    res.json(generatedKeys);
});

// Generate a new key
app.post('/api/admin/keys', (req, res) => {
    const newKey = generateKey();
    generatedKeys.push(newKey);
    res.json({ key: newKey });
});

// Delete a key
app.delete('/api/admin/keys/:key', (req, res) => {
    const keyToDelete = req.params.key;
    generatedKeys = generatedKeys.filter(k => k !== keyToDelete);
    res.json({ success: true });
});

// Regenerate a key
app.put('/api/admin/keys/:oldKey', (req, res) => {
    const oldKey = req.params.oldKey;
    const newKey = generateKey();
    const index = generatedKeys.indexOf(oldKey);

    if (index !== -1) {
        generatedKeys[index] = newKey; 
        res.json({ key: newKey });
    } else {
        res.status(404).json({ error: 'Key not found' });
    }
});

// 4. THE PROXY ROUTE
app.get('/api/:endpoint', async (req, res) => {
    // If the endpoint is "admin", ignore it so we don't break the dashboard
    if (req.params.endpoint === 'admin') return;

    const endpoint = req.params.endpoint;
    const clientKey = req.query.key;

    if (!clientKey || !generatedKeys.includes(clientKey)) {
        return res.status(401).json({ error: 'Invalid or missing MoonWitch API key.' });
    }

    // For local testing, you can hardcode these or use a .env file
    const masterApiUrl = process.env.MASTER_API_URL || 'https://ft-osint-api.duckdns.org/api';
    const masterApiKey = process.env.MASTER_API_KEY || 'bot-new';

    try {
        const url = new URL(`${masterApiUrl}/${endpoint}`);

        for (const [key, value] of Object.entries(req.query)) {
            if (key === 'key') {
                url.searchParams.append('key', masterApiKey);
            } else {
                url.searchParams.append(key, value);
            }
        }

        const response = await fetch(url.toString());
        const data = await response.json();
        res.status(response.status).json(data);

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch data from master API.' });
    }
});

// 5. START LOCAL SERVER
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`MoonWitch Gateway is running!`);
    console.log(`Open your browser to: http://localhost:${PORT}`);
});
