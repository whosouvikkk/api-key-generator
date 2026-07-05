const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

let dbClient = null;
async function getDb() {
    if (dbClient) return dbClient.db('moonwitch');
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('Missing MONGODB_URI environment variable.');
    dbClient = new MongoClient(uri);
    await dbClient.connect();
    return dbClient.db('moonwitch');
}

// Simple Admin Authentication Middleware
const requireAdminAuth = (req, res, next) => {
    const password = req.headers['x-admin-password'] || req.body.password;
    if (password !== 'kaddulele') {
        return res.status(401).json({ error: 'Unauthorized. Invalid admin password.' });
    }
    next();
};

// Helper to generate a random key if no custom key name is provided
const generateRandomKey = () => 'moonwitch_' + Math.random().toString(36).substr(2, 9).toUpperCase();

// --- ADMIN PORTAL ENDPOINTS (PROTECTED) ---

// Verify password validity
app.post('/api/admin/verify', requireAdminAuth, (req, res) => {
    res.json({ success: true });
});

// Fetch all keys from MongoDB
app.post('/api/admin/keys/list', requireAdminAuth, async (req, res) => {
    try {
        const db = await getDb();
        const keys = await db.collection('api_keys').find({}).toArray();
        res.json(keys);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Provision a new custom or randomized key
app.post('/api/admin/keys/create', requireAdminAuth, async (req, res) => {
    try {
        const { label, customKey, allowedLookup, daysValid } = req.body;
        const db = await getDb();

        // Use custom key name if provided, otherwise generate a random one
        let finalKey = customKey ? customKey.trim() : generateRandomKey();
        
        // Ensure the custom key prefix matches your branding if it doesn't have one
        if (customKey && !finalKey.startsWith('moonwitch_')) {
            finalKey = 'moonwitch_' + finalKey;
        }

        // Check if key already exists
        const existing = await db.collection('api_keys').findOne({ key: finalKey });
        if (existing) {
            return res.status(400).json({ error: 'This API key name already exists.' });
        }

        // Calculate dynamic expiration date based on days from today
        let expiresAt = null;
        if (daysValid && parseInt(daysValid) > 0) {
            expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + parseInt(daysValid));
        }

        const newKeyDoc = {
            key: finalKey,
            label: label || 'Custom Token',
            allowedLookup: allowedLookup || 'all',
            expiresAt: expiresAt,
            createdAt: new Date()
        };

        await db.collection('api_keys').insertOne(newKeyDoc);
        res.json(newKeyDoc);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Revoke an active key
app.post('/api/admin/keys/revoke', requireAdminAuth, async (req, res) => {
    try {
        const { keyToDelete } = req.body;
        const db = await getDb();
        await db.collection('api_keys').deleteOne({ key: keyToDelete });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- UNIVERSAL OSINT GATEWAY PROXY ---
app.get('/api/:endpoint', async (req, res) => {
    const endpoint = req.params.endpoint;
    if (['admin', 'keys', 'verify'].includes(endpoint)) return; 

    const clientKey = req.query.key;
    if (!clientKey) {
        return res.status(401).json({ error: 'Missing MoonWitch Authorization Key.' });
    }

    try {
        const db = await getDb();
        const keyRecord = await db.collection('api_keys').findOne({ key: clientKey });

        if (!keyRecord) {
            return res.status(401).json({ error: 'Invalid MoonWitch API Token.' });
        }

        if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
            return res.status(403).json({ error: 'This MoonWitch key has expired.' });
        }

        if (keyRecord.allowedLookup !== 'all' && keyRecord.allowedLookup !== endpoint) {
            return res.status(403).json({ error: `This key is not authorized for the /api/${endpoint} lookup path.` });
        }

        const masterApiUrl = process.env.MASTER_API_URL || 'https://ft-osint-api.duckdns.org/api';
        const masterApiKey = process.env.MASTER_API_KEY || 'bot-new';

        const url = new URL(`${masterApiUrl}/${endpoint === 'veh2num' ? 'veh2num' : endpoint}`);
        
        for (const [key, value] of Object.entries(req.query)) {
            if (key === 'key') {
                url.searchParams.append('key', masterApiKey);
            } else {
                url.searchParams.append(key, value);
            }
        }

        const targetRes = await fetch(url.toString(), { method: 'GET' });
        const payload = await targetRes.json();
        
        res.status(targetRes.status).json(payload);
    } catch (error) {
        res.status(500).json({ error: 'Gateway upstream connection mapping failure.' });
    }
});

if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Local environment interface online at http://localhost:${PORT}`));
}

module.exports = app;
