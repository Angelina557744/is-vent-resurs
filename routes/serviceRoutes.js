const express = require('express');
const router = express.Router();

const serviceController = require('../controllers/serviceController');

// Список услуг
router.get('/services', serviceController.getServices);

// Страница отдельной услуги
router.get('/services/:id', serviceController.getSingleService);

module.exports = router;