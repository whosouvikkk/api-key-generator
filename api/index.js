const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// --- IN-MEMORY STORAGE ---
// This array holds your keys temporarily.
let generatedKeys = [];

// Helper function to generate a random MoonWitch key
const generateKey = () => 'moonwitch_' + Math.random().toString(36).substr(2, 9);

// --- ADMIN DASHBOARD ROUTES ---

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
        generatedKeys[index] = newKey; // Replace the old key
        res.json({ key: newKey });
    } else {
        res.status(404).json({ error: 'Key not found' });
    }
});

// --- PROXY ROUTE ---
// This catches requests like /api/number or /api/veh2num
app.get('/api/:endpoint', async (req, res) => {
    const endpoint = req.params.endpoint;
    const clientKey = req.query.key;

    // 1. Verify the MoonWitch key exists in our array
    if (!clientKey || !generatedKeys.includes(clientKey)) {
        return res.status(401).json({ error: 'Invalid or missing MoonWitch API key.' });
    }

    // 2. Fetch secrets from Environment Variables
    const masterApiUrl = process.env.MASTER_API_URL;
    const masterApiKey = process.env.MASTER_API_KEY;

    if (!masterApiUrl || !masterApiKey) {
        return res.status(500).json({ error: 'Server configuration error.' });
    }

    try {
        // 3. Build the URL for the original API
        const url = new URL(`${masterApiUrl}/${endpoint}`);

        // 4. Copy all parameters from the user's request, but swap the key
        for (const [key, value] of Object.entries(req.query)) {
            if (key === 'key') {
                url.searchParams.append('key', masterApiKey); // Inject hidden master key
            } else {
                url.searchParams.append(key, value); // Keep things like 'num=' or 'vehicle='
            }
        }

        // 5. Fetch the data from the master API (Native fetch is built into Node 18+)
        const response = await fetch(url.toString());
        const data = await response.json();

        // 6. Return the exact response to the user
        res.status(response.status).json(data);

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch data from master API.' });
    }
});

module.exports = app;
