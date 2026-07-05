const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Persistent MongoDB Connection Handler
let dbClient = null;
async function getDb() {
    if (dbClient) return dbClient.db('moonwitch');
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('Missing MONGODB_URI environment variable.');
    dbClient = new MongoClient(uri);
    await dbClient.connect();
    return dbClient.db('moonwitch');
}

// Helper to generate unique secure identifiers
const generateKey = () => 'moonwitch_' + Math.random().toString(36).substr(2, 9).toUpperCase();

// --- REVENUE & SECURITY KEY ADMINISTRATION ENDPOINTS ---

// Get all keys saved within MongoDB instance
app.get('/api/admin/keys', async (req, res) => {
    try {
        const db = await getDb();
        const keys = await db.collection('api_keys').find({}).toArray();
        res.json(keys);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a configured key bound to target specifications
app.post('/api/admin/keys', async (req, res) => {
    try {
        const { label, allowedLookup, expiresAt } = req.body;
        const db = await getDb();
        
        const newKeyDoc = {
            key: generateKey(),
            label: label || 'Unnamed Key',
            allowedLookup: allowedLookup || 'all', // 'all', 'number', 'aadhar', 'upi', 'pan', 'vehicle', 'tg'
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            createdAt: new Date()
        };
        
        await db.collection('api_keys').insertOne(newKeyDoc);
        res.json(newKeyDoc);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Revoke and delete a key
app.delete('/api/admin/keys/:key', async (req, res) => {
    try {
        const db = await getDb();
        await db.collection('api_keys').deleteOne({ key: req.params.key });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- UNIVERSAL OSINT GATEWAY PROXY ---
app.get('/api/:endpoint', async (req, res) => {
    const endpoint = req.params.endpoint;
    if (endpoint === 'admin') return; // Prevent blocking static admin sub-routes

    const clientKey = req.query.key;
    if (!clientKey) {
        return res.status(401).json({ error: 'Missing MoonWitch Authorization Key.' });
    }

    try {
        const db = await getDb();
        const keyRecord = await db.collection('api_keys').findOne({ key: clientKey });

        // 1. Validate Existential Status
        if (!keyRecord) {
            return res.status(401).json({ error: 'Invalid MoonWitch API Token.' });
        }

        // 2. Enforce Temporal Validity (Expiration Checks)
        if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
            return res.status(403).json({ error: 'This MoonWitch key has expired.' });
        }

        // 3. Enforce Scope Isolation (Lookup Path Authorization Check)
        if (keyRecord.allowedLookup !== 'all' && keyRecord.allowedLookup !== endpoint) {
            return res.status(403).json({ error: `This key is not authorized for the /api/${endpoint} lookup path.` });
        }

        // 4. Resolve Target Parameters
        const masterApiUrl = process.env.MASTER_API_URL || 'https://ft-osint-api.duckdns.org/api';
        const masterApiKey = process.env.MASTER_API_KEY || 'bot-new';

        const url = new URL(`${masterApiUrl}/${endpoint === 'veh2num' ? 'veh2num' : endpoint}`);
        
        // Rewrite keys while passing queries forward cleanly
        for (const [key, value] of Object.entries(req.query)) {
            if (key === 'key') {
                url.searchParams.append('key', masterApiKey);
            } else {
                url.searchParams.append(key, value);
            }
        }

        // 5. Secure Upstream Fetch Operation
        const targetRes = await fetch(url.toString(), { method: 'GET' });
        const payload = await targetRes.json();
        
        res.status(targetRes.status).json(payload);
    } catch (error) {
        res.status(500).json({ error: 'Gateway upstream connection mapping failure.' });
    }
});

// Self-bootloader fallback mechanism for isolated Local Testing environments
if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Local Execution Interface Context initialized on http://localhost:${PORT}`));
}

module.exports = app;
