const express = require('express');
const router = express.Router();

const serviceController = require('../controllers/serviceController');

router.get('/services', serviceController.getServices);

router.get('/services/:id', serviceController.getSingleService);

module.exports = router;