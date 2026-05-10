const express = require('express');
const router = express.Router();

const profileController = require('../controllers/profileController');
const { isAuth } = require('../middleware/authMiddleware');

// Личный кабинет
router.get('/profile', isAuth, profileController.getProfile);

// Проекты в личном кабинете
router.get('/profile/projects/:id', isAuth, profileController.getProject);
router.post('/profile/projects/:id/message', isAuth, profileController.sendProjectMessage);

// Квиз
router.get('/profile/quiz', isAuth, profileController.getQuiz);

module.exports = router;