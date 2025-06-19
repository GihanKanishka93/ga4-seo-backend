const express = require('express');
const analyticsDataClient = require('../lib/ga4Client'); // GA4 client from step 1.2
const buildFilterExpression = require('../utils/buildGA4Filters'); // Filter helper from step 1.3

const router = express.Router();

router.post('/custom-report', async (req, res) => {
  try {
    const {
      metrics,
      dimensions,
      filters,
      startDate,
      endDate,
    } = req.body;

    const [response] = await analyticsDataClient.runReport({
      property: `properties/${process.env.GA4_PROPERTY_ID}`,
      dateRanges: [{ startDate, endDate }],
      dimensions: dimensions.map(name => ({ name })),
      metrics: metrics.map(name => ({ name })),
      dimensionFilter: buildFilterExpression(filters),
    });

    const headers = [
      ...(response.dimensionHeaders || []).map(d => d.name),
      ...(response.metricHeaders || []).map(m => m.name),
    ];

    const rows = (response.rows || []).map(row => [
      ...(row.dimensionValues || []).map(d => d.value),
      ...(row.metricValues || []).map(m => m.value),
    ]);

    res.json({ headers, rows });
  } catch (error) {
    console.error('GA4 Report Error:', error);
    res.status(500).json({ error: 'Failed to generate custom report.' });
  }
});

module.exports = router;
