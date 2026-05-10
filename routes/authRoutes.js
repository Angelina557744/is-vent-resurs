const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');

// Регистрация
router.get('/register', authController.getRegister);
router.post('/register', authController.postRegister);

// Вход
router.get('/login', authController.getLogin);
router.post('/login', authController.postLogin);

// Выход
router.get('/logout', authController.logout);

module.exports = router;