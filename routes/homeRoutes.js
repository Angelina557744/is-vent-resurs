const express = require('express');
const router = express.Router();

const homeController = require('../controllers/homeController');

router.get('/', homeController.getHomePage);
// ========== ПРОЕКТЫ (ПОРТФОЛИО) ==========
router.get('/projects', homeController.getProjects);

// ========== КОНТАКТЫ ==========
router.get('/contacts', homeController.getContacts);

// ========== ДЕТАЛЬНАЯ СТРАНИЦА ПРОЕКТА ==========
router.get('/projects/:year/:slug', homeController.getProjectDetail);

module.exports = router;