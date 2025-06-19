const express = require('express');
const cors = require('cors');
const session = require('express-session');
const axios = require('axios');
const { google } = require('googleapis');
const {
  getAuthUrl,
  setCredentialsFromCode,
  getClient,
  refreshIfNeeded,
  isAuthenticated
} = require('./oauth2');

require('dotenv').config();

const app = express();

// ======== Middleware ========
app.use(express.json());

app.use(cors({
  origin: 'https://darkseagreen-cobra-566406.hostingersite.com', // ✅ Replace with your actual frontend domain
  credentials: true
}));

app.use(session({
  secret: 'super-strong-session-secret', // ✅ Replace with env var in production
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    sameSite: 'none'
  }
}));

// ======== Routes ========

app.get('/', (req, res) => {
  res.send('✅ Backend is running');
});

app.get('/auth', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;
  try {
    await setCredentialsFromCode(code);
    req.session.authenticated = true;
    res.redirect('https://darkseagreen-cobra-566406.hostingersite.com'); // ✅ Update to your real frontend
  } catch (error) {
    console.error('OAuth Error:', error);
    res.status(500).send('Authentication failed');
  }
});

app.get('/api/authenticated', async (req, res) => {
  try {
    if (!req.session.authenticated) {
      return res.status(401).json({ authenticated: false });
    }
    await refreshIfNeeded(); // optional safeguard
    return res.json({ authenticated: true });
  } catch (e) {
    return res.status(500).json({ authenticated: false });
  }
});

app.get('/api/properties', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).send('Unauthorized');

  const analyticsAdmin = google.analyticsadmin('v1alpha');
  try {
    const accountsResponse = await analyticsAdmin.accounts.list({ auth: getClient() });
    const accounts = accountsResponse.data.accounts || [];

    let allProperties = [];
    for (const account of accounts) {
      try {
        const propsRes = await analyticsAdmin.properties.list({
          auth: getClient(),
          filter: `parent:${account.name}`
        });
        allProperties.push(...(propsRes.data.properties || []));
      } catch (err) {
        console.warn(`Skipping account ${account.name}:`, err.message);
      }
    }

    const simplified = allProperties.map(p => ({
      id: p.name.split('/')[1],
      displayName: p.displayName
    }));

    res.json({ properties: simplified });
  } catch (err) {
    console.error('Properties fetch error:', err.message);
    res.status(500).json({ error: 'Could not list GA4 properties' });
  }
});

app.get('/api/metrics/:propertyId', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).send('Unauthorized');

  const { propertyId } = req.params;
  const { startDate, endDate, metrics = 'activeUsers', channel = '', trafficSource = '' } = req.query;
  const metricList = metrics.split(',').map(name => ({ name }));
  const keywords = trafficSource
    .split(',')
    .map(k => k.trim().toLowerCase())
    .filter(Boolean);

  try {
    const token = (await getClient().getAccessToken()).token;
    const dimensions = [
      { name: 'date' },
      { name: 'sessionDefaultChannelGroup' },
      { name: 'sessionSource' }
    ];

    const reportRequest = {
      dateRanges: [{ startDate, endDate }],
      metrics: metricList,
      dimensions
    };

    if (channel) {
      reportRequest.dimensionFilter = {
        filter: {
          fieldName: 'sessionDefaultChannelGroup',
          stringFilter: {
            value: channel,
            matchType: 'CONTAINS'
          }
        }
      };
    }

    const response = await axios.post(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      reportRequest,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const result = (response.data.rows || []).map(row => ({
      date: row.dimensionValues[0]?.value,
      channel: row.dimensionValues[1]?.value || 'Unknown',
      source: row.dimensionValues[2]?.value || 'Unknown',
      ...metrics.split(',').reduce((acc, m, i) => {
        acc[m] = row.metricValues[i]?.value || 0;
        return acc;
      }, {})
    }));

    const filtered = keywords.length > 0
      ? result.filter(row =>
          keywords.some(k =>
            (row.source || '').toLowerCase().includes(k)
          )
        )
      : result;

    res.json({ data: filtered });
  } catch (error) {
    console.error('GA4 API error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch GA4 data' });
  }
});

app.get('/api/event-comparison-multi/:propertyId', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).send('Unauthorized');

  const propertyId = req.params.propertyId;
  const today = new Date();
  const format = (d) => d.toISOString().slice(0, 10);

  const {
    startDate1 = format(new Date(today.getFullYear(), today.getMonth() - 2, 1)),
    endDate1 = format(new Date(today.getFullYear(), today.getMonth() - 1, 0)),
    startDate2 = format(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
    endDate2 = format(new Date(today.getFullYear(), today.getMonth(), 0)),
    startDate3 = format(new Date(today.getFullYear(), today.getMonth(), 1)),
    endDate3 = format(today),
    trafficSource = ''
  } = req.query;

  const keywords = trafficSource
    .split(',')
    .map(k => k.trim().toLowerCase())
    .filter(Boolean);

  const oauthClient = getClient();
  const { token } = await oauthClient.getAccessToken();

  const fetchEvents = async (startDate, endDate) => {
    const request = {
      dateRanges: [{ startDate, endDate }],
      metrics: [{ name: 'sessions' }],
      dimensions: [{ name: 'sessionSource' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
    };

    if (keywords.length > 0) {
      request.dimensions.push({ name: 'sessionSource' });
      request.dimensionFilter = {
        filter: {
          fieldName: 'sessionSource',
          stringFilter: {
            matchType: 'REGEXP',
            value: keywords.join('|'),
            caseSensitive: false
          }
        }
      };
    }

    const response = await axios.post(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      request,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return (response.data.rows || []).map(row => ({
      name: row.dimensionValues[0]?.value,
      count: Number(row.metricValues[0]?.value)
    }));
  };

  try {
    const [data1, data2, data3] = await Promise.all([
      fetchEvents(startDate1, endDate1),
      fetchEvents(startDate2, endDate2),
      fetchEvents(startDate3, endDate3)
    ]);

    const combined = {};

    data1.forEach(row => {
      combined[row.name] = { eventName: row.name, period1: row.count, period2: 0, period3: 0 };
    });

    data2.forEach(row => {
      if (!combined[row.name]) {
        combined[row.name] = { eventName: row.name, period1: 0, period2: row.count, period3: 0 };
      } else {
        combined[row.name].period2 = row.count;
      }
    });

    data3.forEach(row => {
      if (!combined[row.name]) {
        combined[row.name] = { eventName: row.name, period1: 0, period2: 0, period3: row.count };
      } else {
        combined[row.name].period3 = row.count;
      }
    });

    res.json({ data: Object.values(combined) });
  } catch (error) {
    console.error('❌ Multi-event comparison error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch multi-month event comparison' });
  }
});

// ======== Start Server ========
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
