'use strict';

const express = require('express');
const router = express.Router();
const { register } = require('../config/metrics');

router.get('/', async (req, res) => {
  try {
    const metrics = await register.metrics();
    res.set('Content-Type', register.contentType);
    res.end(metrics);
  } catch (err) {
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});

module.exports = router;
