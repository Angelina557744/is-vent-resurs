const express = require('express');
const router = express.Router();

const homeController = require('../controllers/homeController');

router.get('/', homeController.getHomePage);
router.get('/projects', homeController.getProjects);

router.get('/contacts', homeController.getContacts);
router.get('/projects/:year/:slug', homeController.getProjectDetail);

module.exports = router;