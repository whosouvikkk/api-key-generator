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

const requireAdminAuth = (req, res, next) => {
    const password = req.headers['x-admin-password'] || req.body.password;
    // Uses Vercel Secret. If you forget to add it in Vercel, it defaults back to kaddulele so you don't get locked out.
    const validPassword = process.env.ADMIN_PASSWORD || 'kaddulele'; 
    
    if (password !== validPassword) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }
    next();
};

const generateRandomKey = () => 'moonwitch_' + Math.random().toString(36).substr(2, 9).toUpperCase();

// --- SECURE CONSOLE MANAGEMENT ---
app.post('/api/admin/verify', requireAdminAuth, (req, res) => {
    res.json({ success: true });
});

app.post('/api/admin/keys/list', requireAdminAuth, async (req, res) => {
    try {
        const db = await getDb();
        const keys = await db.collection('api_keys').find({}).toArray();
        res.json(keys);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/keys/create', requireAdminAuth, async (req, res) => {
    try {
        const { label, customKey, allowedLookup, daysValid } = req.body;
        const db = await getDb();

        let finalKey = customKey ? customKey.trim() : generateRandomKey();
        if (customKey && !finalKey.startsWith('moonwitch_')) {
            finalKey = 'moonwitch_' + finalKey;
        }

        const existing = await db.collection('api_keys').findOne({ key: finalKey });
        if (existing) {
            return res.status(400).json({ error: 'Key alias already exists.' });
        }

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

// --- SAFE PROXY HOOK WITH RESPONSE FILTER ---
app.get('/api/:endpoint', async (req, res) => {
    const endpoint = req.params.endpoint;
    if (['admin', 'keys', 'verify'].includes(endpoint)) return;

    const clientKey = req.query.key;
    if (!clientKey) return res.status(401).json({ error: 'Missing API key.' });

    try {
        const db = await getDb();
        const keyRecord = await db.collection('api_keys').findOne({ key: clientKey });

        if (!keyRecord) return res.status(401).json({ error: 'Invalid API key.' });
        if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
            return res.status(403).json({ error: 'Key has expired.' });
        }
        if (keyRecord.allowedLookup !== 'all' && keyRecord.allowedLookup !== endpoint) {
            return res.status(403).json({ error: 'Unauthorized endpoint scope.' });
        }

        const masterApiUrl = process.env.MASTER_API_URL || 'https://ft-osint-api.duckdns.org/api';
        const masterApiKey = process.env.MASTER_API_KEY || 'bot-new';

        const url = new URL(`${masterApiUrl}/${endpoint === 'veh2num' ? 'veh2num' : endpoint}`);
        for (const [key, value] of Object.entries(req.query)) {
            url.searchParams.append(key === 'key' ? 'key' : key, key === 'key' ? masterApiKey : value);
        }

        const targetRes = await fetch(url.toString(), { method: 'GET' });
        let payload = await targetRes.json();

        // SCRUB THE SPECIFIED BRANDING LINE AUTOMATICALLY
        if (payload && typeof payload === 'object') {
            if (Array.isArray(payload)) {
                payload.forEach(item => { if (item) delete item.owner; });
            } else {
                delete payload.owner;
            }
        }

        res.status(targetRes.status).json(payload);
    } catch (error) {
        res.status(500).json({ error: 'Proxy communication error.' });
    }
});

if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Online on port ${PORT}`));
}

module.exports = app;
